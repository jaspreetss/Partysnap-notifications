/**
 * Participants Caching Service
 * High-performance participant data management with Redis caching
 * 
 * Performance Goals:
 * - Reduce participant loading from 1,046ms to <50ms
 * - Handle large participant lists (>1000 participants)
 * - Support pagination and real-time updates
 * - Graceful fallback for cache misses
 */

import { supabase } from './supabase.js';
import { 
  getCachedData, 
  setCachedData, 
  deleteCachePattern, 
  incrementCounter,
  setWithAutoExpiry,
  getWithAge,
  getBatch,
  setBatch 
} from './redis.js';

// Cache configuration
const CACHE_CONFIG = {
  PARTICIPANTS: {
    TTL: 30 * 60, // 30 minutes
    PREFIX: 'participants:',
    METADATA_TTL: 15 * 60 // 15 minutes for metadata
  },
  RATE_LIMIT: {
    WINDOW: 60, // 1 minute
    MAX_REQUESTS: 100 // per IP
  }
};

/**
 * Get participants for an event with pagination and caching
 */
export async function getEventParticipants(eventId, options = {}) {
  const { 
    page = 1, 
    limit = 20, 
    forceRefresh = false,
    userId = null 
  } = options;

  // Validate inputs
  if (!eventId || page < 1 || limit < 1 || limit > 100) {
    throw new Error('Invalid parameters');
  }

  const cacheKey = `${CACHE_CONFIG.PARTICIPANTS.PREFIX}${eventId}:page:${page}:${limit}`;

  try {
    // Check cache first (unless refresh requested)
    if (!forceRefresh) {
      const cachedData = await getWithAge(cacheKey);
      if (cachedData && !cachedData.is_expired) {
        // Update access time for cache analytics
        recordCacheHit(eventId, 'participants');
        
        return {
          ...cachedData,
          cached: true,
          cache_source: 'redis'
        };
      }
    }

    // Fetch from database
    console.log(`🔄 Fetching participants from database for event ${eventId}, page ${page}`);
    const result = await fetchParticipantsFromDatabase(eventId, page, limit, userId);
    
    // Cache the result
    await setWithAutoExpiry(cacheKey, result, CACHE_CONFIG.PARTICIPANTS.TTL);
    
    // Also update metadata cache
    await updateParticipantMetadataCache(eventId, result);
    
    recordCacheMiss(eventId, 'participants');
    
    return {
      ...result,
      cached: false,
      cache_source: 'database'
    };

  } catch (error) {
    console.error(`Error getting participants for event ${eventId}:`, error);
    
    // Try to serve stale cache on error
    const staleData = await getCachedData(cacheKey);
    if (staleData) {
      console.log('📦 Serving stale cache due to database error');
      return {
        ...staleData,
        cached: true,
        stale: true,
        cache_source: 'stale_redis',
        warning: 'Serving cached data due to temporary database issues'
      };
    }
    
    throw error;
  }
}

/**
 * Get participant metadata (count, stats) with caching
 */
export async function getParticipantMetadata(eventId, userId = null) {
  const cacheKey = `${CACHE_CONFIG.PARTICIPANTS.PREFIX}${eventId}:metadata`;

  try {
    // Check cache first
    const cachedData = await getWithAge(cacheKey);
    if (cachedData && !cachedData.is_expired) {
      recordCacheHit(eventId, 'metadata');
      return {
        ...cachedData,
        cached: true
      };
    }

    // Generate fresh metadata
    console.log(`🔄 Generating metadata for event ${eventId}`);
    const metadata = await generateParticipantMetadata(eventId, userId);
    
    // Cache with shorter TTL for metadata
    await setWithAutoExpiry(cacheKey, metadata, CACHE_CONFIG.PARTICIPANTS.METADATA_TTL);
    
    recordCacheMiss(eventId, 'metadata');
    
    return {
      ...metadata,
      cached: false
    };

  } catch (error) {
    console.error(`Error getting participant metadata for event ${eventId}:`, error);
    
    // Try stale cache
    const staleData = await getCachedData(cacheKey);
    if (staleData) {
      return {
        ...staleData,
        cached: true,
        stale: true,
        warning: 'Serving cached metadata due to database issues'
      };
    }
    
    throw error;
  }
}

/**
 * Add participant and invalidate cache
 */
export async function addParticipant(eventId, userId, addedByUserId = null) {
  try {
    // Add to database
    const { data, error } = await supabase
      .from('event_participants')
      .insert({
        event_id: eventId,
        user_id: userId,
        joined_at: new Date().toISOString(),
        added_by: addedByUserId
      })
      .select('*')
      .single();

    if (error) {
      // Handle duplicate entry gracefully
      if (error.code === '23505') {
        console.log(`User ${userId} already participant in event ${eventId}`);
        return { 
          success: true, 
          data: null, 
          message: 'User already a participant' 
        };
      }
      throw error;
    }

    // Invalidate caches
    await invalidateParticipantCache(eventId);
    
    // Trigger real-time notification
    await notifyParticipantUpdate(eventId, 'participant_added', {
      user_id: userId,
      event_id: eventId,
      added_by: addedByUserId
    });

    console.log(`✅ Added participant ${userId} to event ${eventId}`);
    
    return {
      success: true,
      data,
      message: 'Participant added successfully'
    };

  } catch (error) {
    console.error(`Error adding participant ${userId} to event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Remove participant and invalidate cache
 */
export async function removeParticipant(eventId, userId, removedByUserId = null) {
  try {
    // Remove from database
    const { error } = await supabase
      .from('event_participants')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', userId);

    if (error) throw error;

    // Invalidate caches
    await invalidateParticipantCache(eventId);
    
    // Trigger real-time notification
    await notifyParticipantUpdate(eventId, 'participant_removed', {
      user_id: userId,
      event_id: eventId,
      removed_by: removedByUserId
    });

    console.log(`✅ Removed participant ${userId} from event ${eventId}`);
    
    return {
      success: true,
      message: 'Participant removed successfully'
    };

  } catch (error) {
    console.error(`Error removing participant ${userId} from event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Batch preload participants for multiple events
 */
export async function preloadEventParticipants(eventIds, options = {}) {
  const { limit = 20, priority = 'low' } = options;

  try {
    console.log(`🔮 Preloading participants for ${eventIds.length} events`);
    
    // Check which events need loading
    const cacheKeys = eventIds.map(eventId => 
      `${CACHE_CONFIG.PARTICIPANTS.PREFIX}${eventId}:page:1:${limit}`
    );
    
    const cachedData = await getBatch(cacheKeys);
    const eventsToLoad = [];
    
    eventIds.forEach((eventId, index) => {
      const cacheKey = cacheKeys[index];
      if (!cachedData[cacheKey]) {
        eventsToLoad.push(eventId);
      }
    });

    if (eventsToLoad.length === 0) {
      console.log('✅ All events already cached');
      return;
    }

    // Load uncached events
    const loadPromises = eventsToLoad.map(async (eventId) => {
      try {
        await getEventParticipants(eventId, { page: 1, limit });
        
        // Add delay for low priority preloading
        if (priority === 'low') {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Failed to preload participants for event ${eventId}:`, error);
      }
    });

    await Promise.all(loadPromises);
    console.log(`✅ Preloaded participants for ${eventsToLoad.length} events`);

  } catch (error) {
    console.error('Error in batch preload:', error);
  }
}

/**
 * Search participants across events
 */
export async function searchParticipants(query, eventIds = [], limit = 20) {
  try {
    const { data, error } = await supabase
      .from('event_participants')
      .select(`
        *,
        users:user_id(id, name, email, profile_pic),
        events:event_id(id, name)
      `)
      .in('event_id', eventIds.length > 0 ? eventIds : [])
      .ilike('users.name', `%${query}%`)
      .limit(limit)
      .order('joined_at', { ascending: false });

    if (error) throw error;

    return {
      participants: data || [],
      query,
      total_results: data?.length || 0,
      searched_events: eventIds.length
    };

  } catch (error) {
    console.error('Error searching participants:', error);
    throw error;
  }
}

/**
 * Fetch participants from database with optimized queries
 * PRIVATE - Core database interaction
 */
async function fetchParticipantsFromDatabase(eventId, page, limit, userId) {
  const offset = (page - 1) * limit;

  try {
    // First try normalized event_participants table
    const { data: normalizedData, error: normalizedError, count } = await supabase
      .from('event_participants')
      .select(`
        *,
        users:user_id(
          id,
          name,
          email,
          profile_pic,
          created_at
        )
      `, { count: 'exact' })
      .eq('event_id', eventId)
      .order('joined_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (!normalizedError && normalizedData && normalizedData.length > 0) {
      return {
        participants: normalizedData,
        total_count: count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(count / limit),
        has_more: count > offset + limit,
        source: 'normalized',
        generated_at: new Date().toISOString()
      };
    }

    // Fallback to legacy participants array
    console.log(`📦 Using legacy participants for event ${eventId}`);
    
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('participants, participant_names')
      .eq('id', eventId)
      .single();

    if (eventError) throw eventError;

    if (!eventData?.participants || eventData.participants.length === 0) {
      return {
        participants: [],
        total_count: 0,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: 0,
        has_more: false,
        source: 'legacy_empty',
        generated_at: new Date().toISOString()
      };
    }

    // Process legacy participants with pagination
    const allParticipants = eventData.participants;
    const totalCount = allParticipants.length;
    const paginatedUserIds = allParticipants.slice(offset, offset + limit);

    // Fetch user data in batch (efficient)
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('id, name, email, profile_pic, created_at')
      .in('id', paginatedUserIds);

    if (usersError) throw usersError;

    // Create participant objects
    const participants = paginatedUserIds.map((userId, index) => {
      const userData = usersData.find(u => u.id === userId) || {
        id: userId,
        name: eventData.participant_names?.[userId] || `User ${userId}`,
        email: null,
        profile_pic: null,
        created_at: null
      };

      return {
        id: `legacy_${userId}_${offset + index}`,
        event_id: eventId,
        user_id: userId,
        joined_at: new Date().toISOString(),
        photo_count: 0,
        last_activity: null,
        users: userData
      };
    });

    return {
      participants,
      total_count: totalCount,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(totalCount / limit),
      has_more: totalCount > offset + limit,
      source: 'legacy',
      generated_at: new Date().toISOString()
    };

  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Generate comprehensive participant metadata
 * PRIVATE - Metadata generation
 */
async function generateParticipantMetadata(eventId, userId) {
  try {
    // Try normalized table first
    const { data: normalizedData, error: normalizedError } = await supabase
      .from('event_participants')
      .select(`
        user_id,
        joined_at,
        photo_count,
        last_activity,
        users:user_id(created_at)
      `)
      .eq('event_id', eventId);

    if (!normalizedError && normalizedData && normalizedData.length > 0) {
      return generateNormalizedMetadata(eventId, normalizedData);
    }

    // Fallback to legacy
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('participants, participant_names, created_at')
      .eq('id', eventId)
      .single();

    if (eventError) throw eventError;

    return generateLegacyMetadata(eventId, eventData);

  } catch (error) {
    console.error('Error generating metadata:', error);
    throw error;
  }
}

/**
 * Generate metadata from normalized data
 * PRIVATE - Metadata calculation
 */
function generateNormalizedMetadata(eventId, participants) {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const totalCount = participants.length;
  const totalPhotos = participants.reduce((sum, p) => sum + (p.photo_count || 0), 0);
  
  const activeToday = participants.filter(p => {
    if (!p.last_activity) return false;
    return new Date(p.last_activity) > oneDayAgo;
  }).length;

  const activeThisWeek = participants.filter(p => {
    if (!p.last_activity) return false;
    return new Date(p.last_activity) > oneWeekAgo;
  }).length;

  const newParticipants = participants.filter(p => {
    return new Date(p.joined_at) > oneDayAgo;
  }).length;

  const topContributors = participants
    .filter(p => p.photo_count > 0)
    .sort((a, b) => (b.photo_count || 0) - (a.photo_count || 0))
    .slice(0, 5)
    .map(p => ({
      user_id: p.user_id,
      photo_count: p.photo_count,
      last_activity: p.last_activity
    }));

  return {
    event_id: eventId,
    total_count: totalCount,
    total_photos: totalPhotos,
    active_today: activeToday,
    active_this_week: activeThisWeek,
    new_participants_today: newParticipants,
    avg_photos_per_participant: totalCount > 0 ? Math.round(totalPhotos / totalCount * 10) / 10 : 0,
    participation_rate: totalCount > 0 ? Math.round((activeThisWeek / totalCount) * 100) : 0,
    top_contributors: topContributors,
    last_participant_joined: participants.length > 0 
      ? Math.max(...participants.map(p => new Date(p.joined_at).getTime()))
      : null,
    generated_at: new Date().toISOString(),
    source: 'normalized'
  };
}

/**
 * Generate metadata from legacy data
 * PRIVATE - Legacy compatibility
 */
function generateLegacyMetadata(eventId, eventData) {
  const totalCount = eventData?.participants?.length || 0;

  return {
    event_id: eventId,
    total_count: totalCount,
    total_photos: 0,
    active_today: 0,
    active_this_week: totalCount,
    new_participants_today: 0,
    avg_photos_per_participant: 0,
    participation_rate: 100,
    top_contributors: [],
    last_participant_joined: eventData?.created_at ? new Date(eventData.created_at).getTime() : null,
    generated_at: new Date().toISOString(),
    source: 'legacy'
  };
}

/**
 * Invalidate participant cache for event
 * PRIVATE - Cache management
 */
async function invalidateParticipantCache(eventId) {
  try {
    const pattern = `${CACHE_CONFIG.PARTICIPANTS.PREFIX}${eventId}*`;
    const deletedCount = await deleteCachePattern(pattern);
    console.log(`🗑️  Invalidated ${deletedCount} cache entries for event ${eventId}`);
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
}

/**
 * Update metadata cache with latest counts
 * PRIVATE - Metadata caching
 */
async function updateParticipantMetadataCache(eventId, participantData) {
  try {
    const metadataKey = `${CACHE_CONFIG.PARTICIPANTS.PREFIX}${eventId}:metadata`;
    const metadata = {
      event_id: eventId,
      total_count: participantData.total_count,
      last_updated: new Date().toISOString(),
      source: participantData.source
    };
    
    await setWithAutoExpiry(metadataKey, metadata, CACHE_CONFIG.PARTICIPANTS.METADATA_TTL);
  } catch (error) {
    console.error('Error updating metadata cache:', error);
  }
}

/**
 * Send real-time notification for participant updates
 * PRIVATE - Real-time notifications
 */
async function notifyParticipantUpdate(eventId, action, data) {
  try {
    // This would integrate with your existing notification system
    console.log(`🔔 Participant update: ${action} for event ${eventId}`, data);
    
    // You can implement WebSocket or push notification logic here
    // For now, just log the event
    
  } catch (error) {
    console.error('Real-time notification error:', error);
  }
}

/**
 * Record cache hit for analytics
 * PRIVATE - Analytics
 */
async function recordCacheHit(eventId, type) {
  try {
    const key = `cache_stats:${eventId}:${type}:hits`;
    await incrementCounter(key, 24 * 60 * 60); // 24 hour window
  } catch (error) {
    console.error('Error recording cache hit:', error);
  }
}

/**
 * Record cache miss for analytics
 * PRIVATE - Analytics
 */
async function recordCacheMiss(eventId, type) {
  try {
    const key = `cache_stats:${eventId}:${type}:misses`;
    await incrementCounter(key, 24 * 60 * 60); // 24 hour window
  } catch (error) {
    console.error('Error recording cache miss:', error);
  }
}

/**
 * Rate limiting check
 */
export async function checkRateLimit(identifier) {
  const key = `rate_limit:participants:${identifier}`;
  const count = await incrementCounter(key, CACHE_CONFIG.RATE_LIMIT.WINDOW);
  
  if (count > CACHE_CONFIG.RATE_LIMIT.MAX_REQUESTS) {
    throw new Error('Rate limit exceeded');
  }
  
  return { remaining: CACHE_CONFIG.RATE_LIMIT.MAX_REQUESTS - count };
}

/**
 * Check user access to event
 */
export async function checkEventAccess(eventId, userId) {
  try {
    if (!userId) return false; // Anonymous users need special handling
    
    const { data, error } = await supabase
      .from('events')
      .select('id, is_private, organizer_id')
      .eq('id', eventId)
      .single();

    if (error || !data) return false;

    // Public events are accessible
    if (!data.is_private) return true;

    // Organizer has access
    if (data.organizer_id === userId) return true;

    // Check if user is participant
    const { data: participantData } = await supabase
      .from('event_participants')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .single();

    return !!participantData;

  } catch (error) {
    console.error('Access check error:', error);
    return false;
  }
}