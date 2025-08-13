/**
 * Album Caching Service
 * High-performance album data and photo URL caching with Redis
 * 
 * Handles:
 * - Album metadata caching
 * - Batch photo URL generation for album photos
 * - Album photo reordering and updates
 * - Cache invalidation on album changes
 */

import { supabase } from './supabase.js';
import { 
  getCachedData, 
  setCachedData, 
  setWithAutoExpiry,
  getWithAge,
  deleteCachePattern,
  incrementCounter,
  getBatch,
  setBatch
} from './redis.js';

/**
 * Get cached album data with photos and signed URLs
 */
export async function getEventAlbums(eventId, options = {}) {
  const {
    page = 1,
    limit = 50,
    forceRefresh = false,
    includePhotos = true,
    userId = null
  } = options;

  const cacheKey = `album:${eventId}:page:${page}:limit:${limit}`;
  const startTime = Date.now();

  try {
    console.log(`🎯 Loading albums for event: ${eventId}`);

    // Check cache first
    if (!forceRefresh) {
      const cached = await getWithAge(cacheKey);
      if (cached && !cached.is_expired) {
        console.log(`✅ Album cache hit for event: ${eventId} (age: ${cached.cache_age}s)`);
        
        return {
          ...cached,
          cache_hit: true,
          source: 'redis_cache',
          performance: {
            response_time_ms: Date.now() - startTime,
            cache_age: cached.cache_age
          }
        };
      }
    }

    // Fetch from database
    console.log(`🔄 Fetching albums from database: ${eventId}`);
    
    const offset = (page - 1) * limit;
    const { data: albums, error, count } = await supabase
      .from('albums')
      .select('*', { count: 'exact' })
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Database query error:', error);
      throw error;
    }

    if (!albums || albums.length === 0) {
      console.log(`📭 No albums found for event: ${eventId}`);
      
      const emptyResult = {
        albums: [],
        total_count: 0,
        page,
        total_pages: 0,
        has_next: false,
        has_previous: false,
        cache_hit: false,
        source: 'database_empty',
        performance: {
          response_time_ms: Date.now() - startTime
        }
      };

      // Cache empty result for 5 minutes
      await setWithAutoExpiry(cacheKey, emptyResult, 300);
      return emptyResult;
    }

    console.log(`📸 Processing ${albums.length} albums with photos`);

    // Process albums and batch generate photo URLs if needed
    const processedAlbums = await Promise.all(
      albums.map(async (album) => await processAlbumPhotos(album, { userId, includePhotos }))
    );

    const result = {
      albums: processedAlbums,
      total_count: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil((count || 0) / limit),
      has_next: page < Math.ceil((count || 0) / limit),
      has_previous: page > 1,
      event_id: eventId,
      cache_hit: false,
      source: 'database',
      performance: {
        response_time_ms: Date.now() - startTime,
        albums_processed: albums.length
      }
    };

    // Cache the result for 1 hour
    await setWithAutoExpiry(cacheKey, result, 3600);
    
    console.log(`✅ Albums cached for event: ${eventId} (${result.albums.length} albums)`);
    return result;

  } catch (error) {
    console.error('Error loading event albums:', error);
    throw error;
  }
}

/**
 * Process album photos and batch generate signed URLs
 */
async function processAlbumPhotos(album, options = {}) {
  const { userId = null, includePhotos = true } = options;

  try {
    if (!includePhotos || !album.photos || album.photos.length === 0) {
      return {
        ...album,
        processed_photos: [],
        photo_count: 0,
        url_stats: { cached: 0, generated: 0, errors: 0 }
      };
    }

    const photos = album.photos || [];
    console.log(`🔄 Processing ${photos.length} photos for album: ${album.id}`);

    // Extract photo paths that need URL generation
    const photosNeedingUrls = [];
    const photoPathMap = new Map();

    photos.forEach((photo, index) => {
      if (!photo.url) return;

      // Check if URL needs conversion (public URLs, expired signed URLs, etc.)
      if (needsUrlConversion(photo.url)) {
        const path = extractStoragePath(photo.url);
        if (path) {
          photosNeedingUrls.push(path);
          photoPathMap.set(path, { photo, index });
        }
      }
    });

    let urlResults = {};
    let urlStats = { cached: 0, generated: 0, errors: 0 };

    if (photosNeedingUrls.length > 0) {
      console.log(`🔗 Batch generating URLs for ${photosNeedingUrls.length} album photos`);
      
      try {
        urlResults = await batchGenerateSignedUrls(photosNeedingUrls, {
          expiresIn: 86400, // 24 hours
          eventId: album.event_id,
          albumId: album.id,
          userId,
          bucket: 'photos'
        });

        urlStats = {
          cached: urlResults.cached_count || 0,
          generated: urlResults.generated_count || 0,
          errors: photosNeedingUrls.length - Object.keys(urlResults.urls || {}).length
        };

      } catch (urlError) {
        console.warn('Batch URL generation failed for album photos:', urlError.message);
        urlStats.errors = photosNeedingUrls.length;
      }
    }

    // Apply signed URLs to photos
    const processedPhotos = photos.map((photo, index) => {
      let finalUrl = photo.url;

      if (photo.url && needsUrlConversion(photo.url)) {
        const path = extractStoragePath(photo.url);
        if (path && urlResults.urls && urlResults.urls[path]) {
          finalUrl = urlResults.urls[path];
        }
      }

      return {
        id: `${album.id}-${index}`,
        photo_url: finalUrl,
        original_url: photo.url,
        caption: photo.caption || '',
        display_order: photo.display_order || index,
        crop_data: photo.crop_data || { scale: 1, x: 0, y: 0 },
        created_at: album.created_at,
        url_converted: finalUrl !== photo.url
      };
    });

    return {
      ...album,
      processed_photos: processedPhotos,
      photo_count: processedPhotos.length,
      url_stats: urlStats
    };

  } catch (error) {
    console.error(`Error processing album photos for album ${album.id}:`, error);
    
    return {
      ...album,
      processed_photos: album.photos || [],
      photo_count: album.photos?.length || 0,
      url_stats: { cached: 0, generated: 0, errors: album.photos?.length || 0 },
      processing_error: error.message
    };
  }
}

/**
 * Get single album with cached photos
 */
export async function getAlbumById(albumId, options = {}) {
  const { forceRefresh = false, includePhotos = true, userId = null } = options;
  const cacheKey = `album:id:${albumId}`;
  const startTime = Date.now();

  try {
    // Check cache first
    if (!forceRefresh) {
      const cached = await getWithAge(cacheKey);
      if (cached && !cached.is_expired) {
        console.log(`✅ Album cache hit: ${albumId}`);
        return {
          ...cached,
          cache_hit: true,
          performance: { response_time_ms: Date.now() - startTime }
        };
      }
    }

    // Fetch from database
    const { data: album, error } = await supabase
      .from('albums')
      .select('*')
      .eq('id', albumId)
      .single();

    if (error) throw error;
    if (!album) {
      throw new Error(`Album not found: ${albumId}`);
    }

    const processedAlbum = await processAlbumPhotos(album, { userId, includePhotos });

    const result = {
      ...processedAlbum,
      cache_hit: false,
      source: 'database',
      performance: { response_time_ms: Date.now() - startTime }
    };

    // Cache for 1 hour
    await setWithAutoExpiry(cacheKey, result, 3600);
    
    console.log(`✅ Album cached: ${albumId}`);
    return result;

  } catch (error) {
    console.error(`Error loading album ${albumId}:`, error);
    throw error;
  }
}

/**
 * Update album data and invalidate cache
 */
export async function updateAlbum(albumId, updates, options = {}) {
  const { userId = null } = options;
  const startTime = Date.now();

  try {
    // Update in database
    const { data, error } = await supabase
      .from('albums')
      .update(updates)
      .eq('id', albumId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate related caches
    await Promise.all([
      deleteCachePattern(`album:id:${albumId}`),
      deleteCachePattern(`album:${data.event_id}:*`),
      deleteCachePattern(`photo:url:album:${albumId}:*`)
    ]);

    console.log(`✅ Album updated and cache invalidated: ${albumId}`);

    return {
      ...data,
      cache_invalidated: true,
      performance: { response_time_ms: Date.now() - startTime }
    };

  } catch (error) {
    console.error(`Error updating album ${albumId}:`, error);
    throw error;
  }
}

/**
 * Delete album and invalidate cache
 */
export async function deleteAlbum(albumId, eventId, options = {}) {
  const { userId = null } = options;
  const startTime = Date.now();

  try {
    // Delete from database
    const { error } = await supabase
      .from('albums')
      .delete()
      .eq('id', albumId);

    if (error) throw error;

    // Invalidate related caches
    await Promise.all([
      deleteCachePattern(`album:id:${albumId}`),
      deleteCachePattern(`album:${eventId}:*`),
      deleteCachePattern(`photo:url:album:${albumId}:*`)
    ]);

    console.log(`✅ Album deleted and cache invalidated: ${albumId}`);

    return {
      deleted: true,
      album_id: albumId,
      event_id: eventId,
      cache_invalidated: true,
      performance: { response_time_ms: Date.now() - startTime }
    };

  } catch (error) {
    console.error(`Error deleting album ${albumId}:`, error);
    throw error;
  }
}

/**
 * Batch generate signed URLs for album photos
 */
async function batchGenerateSignedUrls(photoPaths, options = {}) {
  const {
    expiresIn = 3600,
    eventId = null,
    albumId = null,
    userId = null,
    bucket = 'photos'
  } = options;

  const cacheKeyPrefix = `photo:url:album:${albumId}:`;
  const urlCacheTtl = expiresIn;
  
  try {
    // Check cache for existing URLs
    const cacheKeys = photoPaths.map(path => `${cacheKeyPrefix}${path.replace(/[^a-zA-Z0-9]/g, '_')}`);
    const cachedUrls = await getBatch(cacheKeys);
    
    const urlsToGenerate = [];
    const cachedResults = {};
    
    photoPaths.forEach((path, index) => {
      const cacheKey = cacheKeys[index];
      if (cachedUrls[cacheKey] && !isUrlExpired(cachedUrls[cacheKey])) {
        cachedResults[path] = cachedUrls[cacheKey].url;
      } else {
        urlsToGenerate.push(path);
      }
    });

    let generatedUrls = {};
    if (urlsToGenerate.length > 0) {
      console.log(`🔗 Generating ${urlsToGenerate.length} fresh signed URLs for album`);
      
      // Use service role for all users - it can generate URLs that work for everyone
      const userType = !userId || userId.startsWith('anon_') ? 'anonymous' : 'authenticated';
      console.log(`🔗 Generating album URLs for ${userType} user (${userId || 'no-id'}) with service role`);
      
      // Batch generate signed URLs using Supabase service role (works for all users)
      const urlPromises = urlsToGenerate.map(async (path) => {
          try {
            const { data, error } = await supabase.storage
              .from(bucket)
              .createSignedUrl(path, expiresIn);

            if (error || !data?.signedUrl) {
              console.error(`Failed to generate URL for ${path}:`, error);
              return { path, url: null };
            }

            return { path, url: data.signedUrl };
          } catch (error) {
            console.error(`Exception generating URL for ${path}:`, error);
            return { path, url: null };
          }
        });

        const results = await Promise.allSettled(urlPromises);
        
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.url) {
            const { path, url } = result.value;
            generatedUrls[path] = url;
          }
        });
      }

      // Cache new URLs
      const urlCacheData = {};
      Object.entries(generatedUrls).forEach(([path, url]) => {
        const cacheKey = `${cacheKeyPrefix}${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
        urlCacheData[cacheKey] = {
          url,
          path,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + (expiresIn * 1000)).toISOString()
        };
      });

      if (Object.keys(urlCacheData).length > 0) {
        await setBatch(urlCacheData, urlCacheTtl);
      }
    }

    const allUrls = { ...cachedResults, ...generatedUrls };
    
    return {
      urls: allUrls,
      total_count: photoPaths.length,
      cached_count: Object.keys(cachedResults).length,
      generated_count: Object.keys(generatedUrls).length,
      cache_hit_rate: Math.round((Object.keys(cachedResults).length / photoPaths.length) * 100)
    };

  } catch (error) {
    console.error('Batch URL generation failed:', error);
    throw error;
  }
}

/**
 * Check if URL needs conversion to signed URL
 */
function needsUrlConversion(url) {
  if (!url || typeof url !== 'string') return false;
  
  // Public URLs always need signed URLs
  if (url.includes('/public/photos/')) return true;
  
  // Direct paths need full URLs
  if (!url.includes('http')) return true;
  
  // Check if signed URL is expired
  if (url.includes('token=')) {
    try {
      const parsedUrl = new URL(url);
      const expires = parsedUrl.searchParams.get('Expires');
      if (expires) {
        const expiryTime = parseInt(expires) * 1000;
        const now = Date.now();
        const buffer = 5 * 60 * 1000; // 5 minute buffer
        return now + buffer >= expiryTime;
      }
    } catch (error) {
      console.warn('Error checking URL expiry:', error);
      return true; // Assume needs refresh if we can't parse
    }
  }
  
  return false;
}

/**
 * Check if cached URL is expired
 */
function isUrlExpired(cachedUrlData) {
  if (!cachedUrlData || !cachedUrlData.expires_at) return true;
  
  try {
    const expiryTime = new Date(cachedUrlData.expires_at).getTime();
    const now = Date.now();
    const buffer = 5 * 60 * 1000; // 5 minute buffer
    
    return now + buffer >= expiryTime;
  } catch (error) {
    return true; // Assume expired if we can't parse
  }
}

/**
 * Extract storage path from photo URL
 */
function extractStoragePath(photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') return null;

  try {
    // Handle signed URLs
    if (photoUrl.includes('token=')) {
      const url = new URL(photoUrl);
      const pathMatch = url.pathname.match(/\/storage\/v1\/object\/sign\/photos\/(.+)/);
      if (pathMatch) return pathMatch[1];
    }
    
    // Handle public URLs
    const publicMatch = photoUrl.match(/\/storage\/v1\/object\/public\/photos\/(.+)/);
    if (publicMatch) return publicMatch[1];
    
    // Handle direct paths
    if (photoUrl.startsWith('photos/')) {
      return photoUrl.replace('photos/', '');
    }

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
 * Rate limiting for album operations
 */
export async function checkAlbumRateLimit(clientId, operation = 'load') {
  const key = `rate_limit:album:${operation}:${clientId}`;
  const limit = operation === 'update' ? 10 : 30; // Lower limit for updates
  const windowSeconds = 60;

  const current = await incrementCounter(key, windowSeconds);
  
  if (current > limit) {
    throw new Error(`Rate limit exceeded for album ${operation}: ${current}/${limit} per minute`);
  }

  return current;
}