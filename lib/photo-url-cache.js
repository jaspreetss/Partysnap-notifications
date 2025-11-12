/**
 * Photo URL Caching Service
 * High-performance signed URL generation and caching with Redis
 * 
 * Performance Goals:
 * - Replace 73 individual signed URL calls with 1 batch request
 * - Reduce photo loading from 1,974ms to <200ms
 * - Cache signed URLs with smart expiration (1 hour default)
 * - Handle security and invalidation properly
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
  PHOTO_URLS: {
    TTL: 60 * 60, // 1 hour (same as signed URL expiry)
    PREFIX: 'photo_urls:',
    BATCH_PREFIX: 'photo_batch:',
    EVENT_PREFIX: 'event_photos:'
  },
  RATE_LIMIT: {
    WINDOW: 60, // 1 minute
    MAX_REQUESTS: 200 // per IP (higher for photo operations)
  },
  SECURITY: {
    MAX_URLS_PER_REQUEST: 100,
    DEFAULT_EXPIRY: 3600, // 1 hour
    MAX_EXPIRY: 24 * 60 * 60 // 24 hours
  }
};

/**
 * Generate signed URLs for multiple photos in batch
 */
export async function batchGenerateSignedUrls(photoPaths, options = {}) {
  const { 
    expiresIn = CACHE_CONFIG.SECURITY.DEFAULT_EXPIRY,
    eventId = null,
    userId = null,
    forceRefresh = false 
  } = options;

  // Validate inputs
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) {
    throw new Error('Invalid photo paths array');
  }

  if (photoPaths.length > CACHE_CONFIG.SECURITY.MAX_URLS_PER_REQUEST) {
    throw new Error(`Too many URLs requested. Max: ${CACHE_CONFIG.SECURITY.MAX_URLS_PER_REQUEST}`);
  }

  if (expiresIn > CACHE_CONFIG.SECURITY.MAX_EXPIRY) {
    throw new Error(`Expiry too long. Max: ${CACHE_CONFIG.SECURITY.MAX_EXPIRY} seconds`);
  }

  try {
    console.log(`🔄 Batch generating ${photoPaths.length} signed URLs`);
    
    // Create cache keys for each path
    const cacheKeys = photoPaths.map(path => 
      `${CACHE_CONFIG.PHOTO_URLS.PREFIX}${cleanPath(path)}`
    );

    let cachedUrls = {};
    let pathsToGenerate = [...photoPaths];

    // Check cache first (unless refresh requested)
    if (!forceRefresh) {
      cachedUrls = await getBatch(cacheKeys);
      
      // Filter out expired or missing URLs
      const validCachedUrls = {};
      pathsToGenerate = [];
      
      photoPaths.forEach((path, index) => {
        const cacheKey = cacheKeys[index];
        const cached = cachedUrls[cacheKey];
        
        if (cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
          validCachedUrls[path] = cached.signed_url;
          recordCacheHit('photo_urls');
        } else {
          pathsToGenerate.push(path);
        }
      });
      
      cachedUrls = validCachedUrls;
      console.log(`🎯 Found ${Object.keys(cachedUrls).length} cached URLs, generating ${pathsToGenerate.length} new ones`);
    }

    // Generate missing URLs
    let newUrls = {};
    if (pathsToGenerate.length > 0) {
      newUrls = await generateSignedUrlsBatch(pathsToGenerate, expiresIn, userId);
      
      // Cache the new URLs
      await cacheSignedUrls(newUrls, expiresIn);
      
      recordCacheMiss('photo_urls', pathsToGenerate.length);
    }

    // Combine cached and new URLs
    const allUrls = { ...cachedUrls, ...newUrls };
    
    // Cache event-level batch for quick access
    if (eventId) {
      await cacheEventPhotoBatch(eventId, allUrls, expiresIn);
    }

    console.log(`✅ Batch URL generation complete: ${Object.keys(allUrls).length} URLs ready`);
    
    return {
      urls: allUrls,
      cached_count: Object.keys(cachedUrls).length,
      generated_count: Object.keys(newUrls).length,
      total_count: Object.keys(allUrls).length,
      cache_hit_rate: Math.round((Object.keys(cachedUrls).length / photoPaths.length) * 100),
      expires_in: expiresIn,
      generated_at: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error in batch signed URL generation:', error);
    throw error;
  }
}

/**
 * Get cached signed URLs for an entire event
 */
export async function getEventPhotoUrls(eventId, options = {}) {
  const {
    page = 1,
    limit = 50,
    forceRefresh = false,
    expiresIn = CACHE_CONFIG.SECURITY.DEFAULT_EXPIRY,
    userId = null,
    sortBy = 'most_liked'
  } = options;

  try {
    // Validate sortBy
    const VALID_SORT_MODES = ['most_liked', 'newest'];
    const validatedSortBy = VALID_SORT_MODES.includes(sortBy) ? sortBy : 'most_liked';

    // Fetch event data early to determine user role for cache key
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        created_by,
        require_moderation,
        event_organizers!left(
          user_id,
          status
        )
      `)
      .eq('id', eventId)
      .single();

    if (eventError) {
      console.error('Error fetching event for cache key:', eventError);
      throw new Error(`Failed to fetch event ${eventId}: ${eventError.message}`);
    }

    // Determine user role for cache segmentation
    const isOrganizer = event && userId && (
      userId === event.created_by ||
      event.event_organizers?.some(o => o.user_id === userId && o.status === 'active')
    );

    const userRole = !userId ? 'anonymous' : (isOrganizer ? 'organizer' : 'participant');
    const moderationMode = event?.require_moderation ? 'moderated' : 'unmoderated';

    // Cache key now includes user role and moderation mode for proper segmentation
    const cacheKey = `${CACHE_CONFIG.PHOTO_URLS.EVENT_PREFIX}${eventId}:${validatedSortBy}:${userRole}:${moderationMode}:${page}:${limit}`;

    console.log(`🔑 Cache key: eventId=${eventId}, sortBy=${validatedSortBy}, userRole=${userRole}, moderation=${moderationMode}`);

    // Check event-level cache first
    if (!forceRefresh) {
      const cachedEventUrls = await getWithAge(cacheKey);
      if (cachedEventUrls && !cachedEventUrls.is_expired) {
        // Check if cached URLs are expired
        let hasExpiredUrls = false;
        if (cachedEventUrls.urls && Object.keys(cachedEventUrls.urls).length > 0) {
          for (const [path, url] of Object.entries(cachedEventUrls.urls)) {
            if (url && url.includes('token=')) {
              try {
                const parsedUrl = new URL(url);
                const token = parsedUrl.searchParams.get('token');
                if (token) {
                  // Simple JWT expiry check
                  const parts = token.split('.');
                  if (parts.length === 3) {
                    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                    if (payload.exp) {
                      const expiryTime = payload.exp * 1000;
                      const now = Date.now();
                      const buffer = 5 * 60 * 1000; // 5 minute buffer
                      if (now + buffer >= expiryTime) {
                        hasExpiredUrls = true;
                        console.log(`⚠️ Found expired URL in cached event data`);
                        break;
                      }
                    }
                  }
                }
              } catch (e) {
                // If we can't parse, assume expired
                hasExpiredUrls = true;
                break;
              }
            }
          }
        }
        
        if (!hasExpiredUrls) {
          console.log(`🎯 Serving event photo URLs from cache for event ${eventId}`);
          recordCacheHit('event_photo_urls');
          return {
            ...cachedEventUrls,
            cached: true,
            source: 'event_cache'
          };
        } else {
          console.log(`🔄 Cached event URLs have expired, refreshing from database`);
        }
      }
    }

    // Fetch photos from database (pass event to avoid re-fetching)
    console.log(`🔄 Fetching photos for event ${eventId}, page ${page}, sortBy ${validatedSortBy}, userRole=${userRole}`);
    const { photos, totalCount } = await fetchEventPhotos(eventId, page, limit, userId, validatedSortBy, event);
    
    if (photos.length === 0) {
      return {
        photos: [],
        urls: {},
        total_count: 0,
        page,
        total_pages: 0,
        cached: false,
        source: 'database_empty'
      };
    }

    // Extract photo paths for URL generation
    const photoPaths = photos
      .map(photo => extractStoragePath(photo.photo_url))
      .filter(path => path && path.trim() !== '');

    if (photoPaths.length === 0) {
      console.warn('No valid photo paths found for URL generation');
      return {
        photos,
        urls: {},
        total_count: totalCount,
        page,
        total_pages: Math.ceil(totalCount / limit),
        cached: false,
        source: 'no_valid_paths'
      };
    }

    // Generate signed URLs in batch
    const urlResult = await batchGenerateSignedUrls(photoPaths, {
      expiresIn,
      eventId,
      userId,
      forceRefresh
    });

    // Enhance photos with signed URLs
    const enrichedPhotos = photos.map(photo => {
      const path = extractStoragePath(photo.photo_url);
      const signedUrl = path ? urlResult.urls[path] : null;
      
      return {
        ...photo,
        photo_url: signedUrl || photo.photo_url,
        url_cached: !!signedUrl,
        url_generated_at: urlResult.generated_at
      };
    });

    const result = {
      photos: enrichedPhotos,
      urls: urlResult.urls,
      total_count: totalCount,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(totalCount / limit),
      url_stats: {
        cached_count: urlResult.cached_count,
        generated_count: urlResult.generated_count,
        cache_hit_rate: urlResult.cache_hit_rate
      },
      cached: false,
      source: 'database_with_generated_urls',
      generated_at: new Date().toISOString()
    };

    // Cache the event-level result
    await setWithAutoExpiry(cacheKey, result, Math.min(expiresIn, 30 * 60)); // Max 30 min for event cache
    
    recordCacheMiss('event_photo_urls');
    
    return result;

  } catch (error) {
    console.error(`Error getting photo URLs for event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Invalidate photo URL caches for an event
 */
export async function invalidateEventPhotoCache(eventId, specificPaths = null) {
  try {
    console.log(`🗑️ Invalidating photo caches for event ${eventId}`);
    
    if (specificPaths && Array.isArray(specificPaths)) {
      // Invalidate specific photo URLs
      const cacheKeys = specificPaths.map(path => 
        `${CACHE_CONFIG.PHOTO_URLS.PREFIX}${cleanPath(path)}`
      );
      
      for (const key of cacheKeys) {
        await deleteCachePattern(key);
      }
      
      console.log(`🗑️ Invalidated ${cacheKeys.length} specific photo URLs`);
    } else {
      // Invalidate all event-related caches
      const patterns = [
        `${CACHE_CONFIG.PHOTO_URLS.EVENT_PREFIX}${eventId}*`,
        `${CACHE_CONFIG.PHOTO_URLS.BATCH_PREFIX}${eventId}*`
      ];
      
      for (const pattern of patterns) {
        const deletedCount = await deleteCachePattern(pattern);
        console.log(`🗑️ Invalidated ${deletedCount} cache entries for pattern: ${pattern}`);
      }
    }

  } catch (error) {
    console.error('Error invalidating photo cache:', error);
  }
}

/**
 * Preload photo URLs for upcoming events
 */
export async function preloadEventPhotoUrls(eventIds, options = {}) {
  const { limit = 20, priority = 'low' } = options;

  try {
    console.log(`🔮 Preloading photo URLs for ${eventIds.length} events`);
    
    for (const eventId of eventIds) {
      try {
        await getEventPhotoUrls(eventId, { limit, page: 1 });
        
        // Add delay for low priority preloading
        if (priority === 'low') {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`Failed to preload photos for event ${eventId}:`, error);
      }
    }

    console.log(`✅ Photo URL preloading completed for ${eventIds.length} events`);

  } catch (error) {
    console.error('Error in photo URL preloading:', error);
  }
}

/**
 * Generate signed URLs using Supabase storage API
 * PRIVATE - Core URL generation
 */
async function generateSignedUrlsBatch(photoPaths, expiresIn, userId) {
  const urls = {};
  
  try {
    // Use service role for all users - it can generate URLs that work for everyone
    // The service role has the authority to create signed URLs that any user can access
    const userType = !userId || userId.startsWith('anon_') ? 'anonymous' : 'authenticated';
    console.log(`🔗 Generating signed URLs for ${userType} user (${userId || 'no-id'}) with service role`);
    
    // Process in smaller batches to avoid timeouts
    const batchSize = 20;
    for (let i = 0; i < photoPaths.length; i += batchSize) {
      const batch = photoPaths.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (path) => {
        try {
          const { data, error } = await supabase.storage
            .from('photos')
            .createSignedUrl(path, expiresIn);

          if (error) {
            console.error(`Error generating signed URL for ${path}:`, error);
            return { path, url: null, error: error.message };
          }

          if (!data?.signedUrl) {
            console.error(`No signed URL returned for ${path}`);
            return { path, url: null, error: 'No URL returned' };
          }

          return { path, url: data.signedUrl, error: null };
        } catch (error) {
          console.error(`Exception generating signed URL for ${path}:`, error);
          return { path, url: null, error: error.message };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.url) {
          urls[result.value.path] = result.value.url;
        } else {
          const path = batch[index];
          console.error(`Failed to generate URL for ${path}:`, 
            result.status === 'fulfilled' ? result.value.error : result.reason);
        }
      });
    }

    console.log(`🔗 Generated ${Object.keys(urls).length}/${photoPaths.length} signed URLs`);
    return urls;

  } catch (error) {
    console.error('Error in generateSignedUrlsBatch:', error);
    throw error;
  }
}

/**
 * Cache signed URLs with expiration
 * PRIVATE - Caching utilities
 */
async function cacheSignedUrls(urls, expiresIn) {
  try {
    const cacheData = {};
    const expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();
    
    Object.entries(urls).forEach(([path, signedUrl]) => {
      const cacheKey = `${CACHE_CONFIG.PHOTO_URLS.PREFIX}${cleanPath(path)}`;
      cacheData[cacheKey] = {
        path,
        signed_url: signedUrl,
        expires_at: expiresAt,
        generated_at: new Date().toISOString()
      };
    });

    await setBatch(cacheData, expiresIn);
    console.log(`💾 Cached ${Object.keys(cacheData).length} signed URLs`);

  } catch (error) {
    console.error('Error caching signed URLs:', error);
  }
}

/**
 * Cache event-level photo batch
 * PRIVATE - Event caching
 */
async function cacheEventPhotoBatch(eventId, urls, expiresIn) {
  try {
    const cacheKey = `${CACHE_CONFIG.PHOTO_URLS.BATCH_PREFIX}${eventId}`;
    const batchData = {
      event_id: eventId,
      urls,
      url_count: Object.keys(urls).length,
      expires_in: expiresIn,
      generated_at: new Date().toISOString()
    };

    await setWithAutoExpiry(cacheKey, batchData, Math.min(expiresIn, 30 * 60));
    
  } catch (error) {
    console.error('Error caching event photo batch:', error);
  }
}

/**
 * Fetch photos from database with pagination
 * PRIVATE - Database queries
 */
async function fetchEventPhotos(eventId, page, limit, userId, sortBy = 'most_liked', event = null) {
  const offset = (page - 1) * limit;

  try {
    // If event not provided, fetch it
    if (!event) {
      const { data: fetchedEvent, error: eventError } = await supabase
        .from('events')
        .select(`
          id,
          created_by,
          require_moderation,
          event_organizers!left(
            user_id,
            status
          )
        `)
        .eq('id', eventId)
        .single();

      if (eventError) {
        console.error('Error fetching event:', eventError);
        throw new Error(`Failed to fetch event ${eventId}: ${eventError.message}`);
      }

      event = fetchedEvent;
    }

    // Validate userId to prevent string "undefined" or empty string issues
    const validUserId = userId && typeof userId === 'string' && userId.trim() !== '' && userId !== 'undefined' ? userId : null;

    // Determine if user is an organizer
    const isOrganizer = event && validUserId && (
      validUserId === event.created_by ||
      event.event_organizers?.some(o => o.user_id === validUserId && o.status === 'active')
    );

    console.log(`🔐 Moderation check: event=${eventId}, requireModeration=${event?.require_moderation}, userId=${validUserId}, isOrganizer=${isOrganizer}`);

    // Build query based on sortBy parameter
    let query = supabase
      .from('photos')
      .select(`
        id,
        photo_url,
        uploaded_by,
        uploaded_by_id,
        created_at,
        like_count,
        like_count_computed,
        moderation_status,
        moderation_reason,
        photo_stats!left(like_count)
      `, { count: 'exact' })
      .eq('event_id', eventId)
      .eq('photo_type', 'event');

    // Apply moderation filtering at database level
    if (event?.require_moderation) {
      if (isOrganizer) {
        // Organizers see all except deleted/rejected
        query = query.in('moderation_status', ['approved', 'pending', 'pending_approval']);
        console.log('🔐 Applying organizer moderation filter: approved, pending, pending_approval');
      } else {
        // Regular users and anonymous users only see approved photos
        query = query.eq('moderation_status', 'approved');
        console.log('🔐 Applying participant moderation filter: approved only');
      }
    } else {
      // No moderation required - exclude only deleted photos
      query = query.neq('moderation_status', 'deleted');
      console.log('🔐 No moderation required: excluding deleted only');
    }

    // Apply sorting based on sortBy parameter
    if (sortBy === 'most_liked') {
      // Sort by like_count_computed DESC (nulls last), then created_at DESC
      // For most_liked mode, limit to top 200 photos
      const maxPhotos = 200;

      // Check if offset is beyond the max photo limit
      if (offset >= maxPhotos) {
        console.log(`⚠️ Requested offset ${offset} exceeds maxPhotos ${maxPhotos}, returning empty result`);
        return {
          photos: [],
          totalCount: maxPhotos
        };
      }

      query = query
        .order('like_count_computed', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      // Calculate safe range that doesn't exceed 200 photos
      const safeEnd = Math.min(offset + limit - 1, maxPhotos - 1);

      query = query.range(offset, safeEnd);

      console.log(`📊 Most-liked pagination: offset=${offset}, limit=${limit}, safeEnd=${safeEnd}, maxPhotos=${maxPhotos}`);
    } else {
      // Sort by created_at DESC (newest first)
      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    }

    const { data: photos, error, count } = await query;

    if (error) throw error;

    // For most_liked mode, cap the total count to 200
    const actualTotalCount = sortBy === 'most_liked' ? Math.min(count || 0, 200) : (count || 0);

    return {
      photos: photos || [],
      totalCount: actualTotalCount
    };

  } catch (error) {
    console.error('Error fetching event photos:', error);
    throw error;
  }
}

/**
 * Extract storage path from photo URL
 * PRIVATE - URL utilities
 */
function extractStoragePath(photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') return null;

  try {
    // Handle already signed URLs
    if (photoUrl.includes('token=')) {
      const url = new URL(photoUrl);
      const pathMatch = url.pathname.match(/\/storage\/v1\/object\/sign\/photos\/(.+)/);
      if (pathMatch) return pathMatch[1];
    }
    
    // Handle public URLs
    const publicMatch = photoUrl.match(/\/storage\/v1\/object\/public\/photos\/(.+)/);
    if (publicMatch) return publicMatch[1];
    
    // Handle direct storage paths
    if (photoUrl.startsWith('photos/')) {
      return photoUrl.replace('photos/', '');
    }

    // Handle relative paths
    if (!photoUrl.includes('http') && !photoUrl.startsWith('/')) {
      return photoUrl;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting storage path:', error);
    return null;
  }
}

/**
 * Clean path for cache key
 * PRIVATE - Utilities
 */
function cleanPath(path) {
  return path.replace(/[^a-zA-Z0-9.\-_/]/g, '_');
}

/**
 * Record cache hit for analytics
 */
async function recordCacheHit(type) {
  try {
    const key = `cache_stats:photo_urls:${type}:hits`;
    await incrementCounter(key, 24 * 60 * 60);
  } catch (error) {
    console.error('Error recording cache hit:', error);
  }
}

/**
 * Record cache miss for analytics
 */
async function recordCacheMiss(type, count = 1) {
  try {
    const key = `cache_stats:photo_urls:${type}:misses`;
    for (let i = 0; i < count; i++) {
      await incrementCounter(key, 24 * 60 * 60);
    }
  } catch (error) {
    console.error('Error recording cache miss:', error);
  }
}

/**
 * Rate limiting for photo URL requests
 */
export async function checkPhotoUrlRateLimit(identifier) {
  const key = `rate_limit:photo_urls:${identifier}`;
  const count = await incrementCounter(key, CACHE_CONFIG.RATE_LIMIT.WINDOW);
  
  if (count > CACHE_CONFIG.RATE_LIMIT.MAX_REQUESTS) {
    throw new Error('Rate limit exceeded for photo URL requests');
  }
  
  return { remaining: CACHE_CONFIG.RATE_LIMIT.MAX_REQUESTS - count };
}