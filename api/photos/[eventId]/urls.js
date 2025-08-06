/**
 * Photo URLs Caching API
 * Handles: GET /api/photos/[eventId]/urls
 * 
 * Purpose: Replace individual signed URL calls with batch processing
 * Performance: Reduces 73 individual calls to 1 batch request
 * Target: 1,974ms → <200ms for photo loading
 */

import {
  getEventPhotoUrls,
  batchGenerateSignedUrls,
  invalidateEventPhotoCache,
  checkPhotoUrlRateLimit
} from '../../../lib/photo-url-cache.js';

export default async function handler(req, res) {
  const { eventId } = req.query;
  const startTime = Date.now();

  try {
    // Input validation
    if (!eventId || typeof eventId !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid event ID',
        code: 'INVALID_EVENT_ID',
        timestamp: new Date().toISOString()
      });
    }

    // Rate limiting
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    try {
      await checkPhotoUrlRateLimit(clientIp);
    } catch (rateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many photo URL requests. Please try again later.',
        timestamp: new Date().toISOString()
      });
    }

    // Extract user info from auth header
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        // user = await verifyToken(token); // Implement based on your auth system
        console.log('Authenticated photo URL request');
      } catch (authError) {
        console.log('Anonymous photo URL request');
      }
    }

    // Handle different HTTP methods
    let result;
    switch (req.method) {
      case 'GET':
        result = await handleGetPhotoUrls(req, res, eventId, user);
        break;
      case 'POST':
        result = await handleBatchUrlGeneration(req, res, eventId, user);
        break;
      case 'DELETE':
        result = await handleCacheInvalidation(req, res, eventId, user);
        break;
      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ 
          error: 'Method not allowed',
          allowed_methods: ['GET', 'POST', 'DELETE'],
          timestamp: new Date().toISOString()
        });
    }

    // Add performance metrics
    const responseTime = Date.now() - startTime;
    result.performance = {
      response_time_ms: responseTime,
      timestamp: new Date().toISOString(),
      method: req.method
    };

    return res.status(result.status || 200).json(result.data);

  } catch (error) {
    console.error('Photo URLs API error:', error);
    
    const responseTime = Date.now() - startTime;
    const errorResponse = {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      event_id: eventId,
      timestamp: new Date().toISOString(),
      performance: {
        response_time_ms: responseTime,
        failed: true
      }
    };

    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = {
        message: error.message,
        stack: error.stack
      };
    }

    return res.status(500).json(errorResponse);
  }
}

/**
 * Handle GET request - Get photos with cached URLs
 */
async function handleGetPhotoUrls(req, res, eventId, user) {
  const { 
    page = 1, 
    limit = 50, 
    refresh = false,
    expires_in = 3600,
    urls_only = false 
  } = req.query;

  try {
    // Validate parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const expiresIn = parseInt(expires_in);

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return {
        status: 400,
        data: {
          error: 'Invalid pagination parameters',
          code: 'INVALID_PAGINATION',
          message: 'Page must be >= 1, limit must be 1-100'
        }
      };
    }

    if (expiresIn < 300 || expiresIn > 86400) { // 5 minutes to 24 hours
      return {
        status: 400,
        data: {
          error: 'Invalid expires_in parameter',
          code: 'INVALID_EXPIRY',
          message: 'expires_in must be between 300 and 86400 seconds'
        }
      };
    }

    // Get photos with URLs
    const result = await getEventPhotoUrls(eventId, {
      page: pageNum,
      limit: limitNum,
      forceRefresh: refresh === 'true',
      expiresIn,
      userId: user?.id
    });

    // Handle URLs-only request
    if (urls_only === 'true') {
      return {
        status: 200,
        data: {
          event_id: eventId,
          urls: result.urls,
          url_count: Object.keys(result.urls).length,
          url_stats: result.url_stats,
          cached: result.cached,
          request_type: 'urls_only'
        }
      };
    }

    // Full response with photos and URLs
    return {
      status: 200,
      data: {
        ...result,
        event_id: eventId,
        request_type: 'photos_with_urls',
        pagination: {
          current_page: result.page,
          total_pages: result.total_pages,
          has_next: result.page < result.total_pages,
          has_previous: result.page > 1,
          total_photos: result.total_count
        }
      }
    };

  } catch (error) {
    console.error('Error in GET photo URLs:', error);
    throw error;
  }
}

/**
 * Handle POST request - Generate URLs for specific photo paths
 */
async function handleBatchUrlGeneration(req, res, eventId, user) {
  try {
    const { 
      photo_paths = [], 
      expires_in = 3600,
      cache_result = true 
    } = req.body;

    // Validate input
    if (!Array.isArray(photo_paths) || photo_paths.length === 0) {
      return {
        status: 400,
        data: {
          error: 'Invalid photo_paths array',
          code: 'INVALID_PHOTO_PATHS',
          message: 'Provide an array of photo storage paths'
        }
      };
    }

    if (photo_paths.length > 100) {
      return {
        status: 400,
        data: {
          error: 'Too many photo paths',
          code: 'BATCH_LIMIT_EXCEEDED',
          max_allowed: 100,
          requested: photo_paths.length
        }
      };
    }

    // Generate signed URLs
    const result = await batchGenerateSignedUrls(photo_paths, {
      expiresIn: parseInt(expires_in),
      eventId,
      userId: user?.id,
      forceRefresh: !cache_result
    });

    return {
      status: 200,
      data: {
        ...result,
        event_id: eventId,
        operation: 'batch_url_generation',
        cache_enabled: cache_result
      }
    };

  } catch (error) {
    console.error('Error in POST photo URLs:', error);
    throw error;
  }
}

/**
 * Handle DELETE request - Invalidate photo URL cache
 */
async function handleCacheInvalidation(req, res, eventId, user) {
  // Only allow authenticated users to invalidate cache
  if (!user) {
    return {
      status: 401,
      data: {
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
        message: 'You must be logged in to invalidate cache'
      }
    };
  }

  try {
    const { photo_paths = null } = req.body;

    // Invalidate cache
    await invalidateEventPhotoCache(eventId, photo_paths);

    return {
      status: 200,
      data: {
        event_id: eventId,
        operation: 'cache_invalidation',
        invalidated_paths: photo_paths ? photo_paths.length : 'all',
        message: 'Cache invalidated successfully'
      }
    };

  } catch (error) {
    console.error('Error in DELETE photo URLs:', error);
    throw error;
  }
}