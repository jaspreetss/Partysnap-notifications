/**
 * Unified Caching API
 * Handles: All caching operations for participants and photo URLs
 * Routes:
 * - GET  /api/cache?type=participants&eventId=X
 * - POST /api/cache?type=participants&eventId=X
 * - GET  /api/cache?type=photo-urls&eventId=X
 * - POST /api/cache?type=photo-urls-batch
 * - GET  /api/cache?type=health
 */

import {
  getEventParticipants,
  getParticipantMetadata,
  addParticipant,
  removeParticipant,
  checkRateLimit as checkParticipantRateLimit,
  checkEventAccess
} from '../lib/participants-cache.js';

import {
  batchGenerateSignedUrls,
  getEventPhotoUrls,
  invalidateEventPhotoCache,
  checkPhotoUrlRateLimit
} from '../lib/photo-url-cache.js';

import { redisHealthCheck } from '../lib/redis.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { type, eventId } = req.query;
  const startTime = Date.now();

  // Add request logging
  console.log(`📥 Cache API Request: ${req.method} ${req.url} - Type: ${type}, Event: ${eventId}`);

  try {
    // Route to appropriate handler based on type
    switch (type) {
      case 'participants':
        return await handleParticipants(req, res, eventId, startTime);
      case 'photo-urls':
        return await handlePhotoUrls(req, res, eventId, startTime);
      case 'photo-urls-batch':
        return await handlePhotoUrlsBatch(req, res, startTime);
      case 'health':
        return await handleHealth(req, res, startTime);
      case 'test':
        return res.status(200).json({
          message: 'Cache API is working',
          timestamp: new Date().toISOString(),
          method: req.method,
          query: req.query,
          performance: { response_time_ms: Date.now() - startTime }
        });
      default:
        return res.status(400).json({
          error: 'Invalid type parameter',
          code: 'INVALID_TYPE',
          allowed_types: ['participants', 'photo-urls', 'photo-urls-batch', 'health'],
          timestamp: new Date().toISOString()
        });
    }

  } catch (error) {
    console.error('Cache API error:', error);
    
    const responseTime = Date.now() - startTime;
    const errorResponse = {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      type,
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
 * Handle participant operations
 */
async function handleParticipants(req, res, eventId, startTime) {
  // Input validation
  if (!eventId || typeof eventId !== 'string') {
    return res.status(400).json({ 
      error: 'Invalid event ID',
      code: 'INVALID_EVENT_ID'
    });
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  try {
    await checkParticipantRateLimit(clientIp);
  } catch (rateLimitError) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }

  // Get user info
  let user = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const token = authHeader.replace('Bearer ', '');
      // user = await verifyToken(token);
      console.log('Authenticated participants request');
    } catch (authError) {
      console.log('Anonymous participants request');
    }
  }

  // Check access permissions
  if (user) {
    const hasAccess = await checkEventAccess(eventId, user.id);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied to this event',
        code: 'ACCESS_DENIED'
      });
    }
  }

  const responseTime = Date.now() - startTime;

  // Handle different HTTP methods
  switch (req.method) {
    case 'GET':
      const { page = 1, limit = 20, refresh = false, metadata_only = false } = req.query;

      if (metadata_only === 'true') {
        const metadata = await getParticipantMetadata(eventId, user?.id);
        return res.status(200).json({
          ...metadata,
          event_id: eventId,
          request_type: 'metadata_only',
          performance: { response_time_ms: responseTime }
        });
      }

      const participants = await getEventParticipants(eventId, {
        page: parseInt(page),
        limit: parseInt(limit),
        forceRefresh: refresh === 'true',
        userId: user?.id
      });

      return res.status(200).json({
        ...participants,
        event_id: eventId,
        request_type: 'participants',
        pagination: {
          current_page: participants.page,
          total_pages: participants.total_pages,
          has_next: participants.page < participants.total_pages,
          has_previous: participants.page > 1
        },
        performance: { response_time_ms: responseTime }
      });

    case 'POST':
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId, bulk_users = [] } = req.body;

      if (userId) {
        const result = await addParticipant(eventId, userId, user.id);
        return res.status(result.success ? 201 : 400).json({
          ...result,
          event_id: eventId,
          added_by: user.id,
          operation: 'add_single_participant',
          performance: { response_time_ms: responseTime }
        });
      }

      if (bulk_users.length > 0) {
        if (bulk_users.length > 50) {
          return res.status(400).json({
            error: 'Too many participants in bulk request',
            code: 'BULK_LIMIT_EXCEEDED',
            max_allowed: 50
          });
        }

        const results = [];
        for (const bulkUserId of bulk_users) {
          try {
            const result = await addParticipant(eventId, bulkUserId, user.id);
            results.push({ user_id: bulkUserId, ...result });
          } catch (error) {
            results.push({ user_id: bulkUserId, success: false, error: error.message });
          }
        }

        const successCount = results.filter(r => r.success).length;
        return res.status(successCount > 0 ? 201 : 400).json({
          event_id: eventId,
          operation: 'add_bulk_participants',
          total_requested: bulk_users.length,
          successful: successCount,
          failed: bulk_users.length - successCount,
          results,
          performance: { response_time_ms: responseTime }
        });
      }

      return res.status(400).json({
        error: 'Invalid request body',
        code: 'INVALID_BODY'
      });

    case 'DELETE':
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const { userId: removeUserId } = req.body;
      const targetUserId = removeUserId || user.id;

      const removeResult = await removeParticipant(eventId, targetUserId, user.id);
      return res.status(removeResult.success ? 200 : 400).json({
        ...removeResult,
        event_id: eventId,
        removed_user: targetUserId,
        removed_by: user.id,
        operation: 'remove_participant',
        performance: { response_time_ms: responseTime }
      });

    default:
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Handle photo URL operations for events
 */
async function handlePhotoUrls(req, res, eventId, startTime) {
  // Input validation
  if (!eventId || typeof eventId !== 'string') {
    return res.status(400).json({ 
      error: 'Invalid event ID',
      code: 'INVALID_EVENT_ID'
    });
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  try {
    await checkPhotoUrlRateLimit(clientIp);
  } catch (rateLimitError) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }

  // Get user info
  let user = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const token = authHeader.replace('Bearer ', '');
      // user = await verifyToken(token);
    } catch (authError) {
      // Continue as anonymous
    }
  }

  const responseTime = Date.now() - startTime;

  // Handle different HTTP methods
  switch (req.method) {
    case 'GET':
      const { 
        page = 1, 
        limit = 50, 
        refresh = false,
        expires_in = 3600,
        urls_only = false 
      } = req.query;

      // Validate parameters
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const expiresIn = parseInt(expires_in);

      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          error: 'Invalid pagination parameters',
          code: 'INVALID_PAGINATION'
        });
      }

      if (expiresIn < 300 || expiresIn > 86400) {
        return res.status(400).json({
          error: 'Invalid expires_in parameter',
          code: 'INVALID_EXPIRY'
        });
      }

      const result = await getEventPhotoUrls(eventId, {
        page: pageNum,
        limit: limitNum,
        forceRefresh: refresh === 'true',
        expiresIn,
        userId: user?.id
      });

      if (urls_only === 'true') {
        return res.status(200).json({
          event_id: eventId,
          urls: result.urls,
          url_count: Object.keys(result.urls).length,
          url_stats: result.url_stats,
          cached: result.cached,
          request_type: 'urls_only',
          performance: { response_time_ms: responseTime }
        });
      }

      return res.status(200).json({
        ...result,
        event_id: eventId,
        request_type: 'photos_with_urls',
        pagination: {
          current_page: result.page,
          total_pages: result.total_pages,
          has_next: result.page < result.total_pages,
          has_previous: result.page > 1,
          total_photos: result.total_count
        },
        performance: { response_time_ms: responseTime }
      });

    case 'DELETE':
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const { photo_paths = null } = req.body;
      await invalidateEventPhotoCache(eventId, photo_paths);

      return res.status(200).json({
        event_id: eventId,
        operation: 'cache_invalidation',
        invalidated_paths: photo_paths ? photo_paths.length : 'all',
        message: 'Cache invalidated successfully',
        performance: { response_time_ms: responseTime }
      });

    default:
      res.setHeader('Allow', ['GET', 'DELETE']);
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Handle batch photo URL generation
 */
async function handlePhotoUrlsBatch(req, res, startTime) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  try {
    await checkPhotoUrlRateLimit(clientIp);
  } catch (rateLimitError) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }

  const { 
    photo_paths = [],
    event_id = null,
    expires_in = 3600,
    force_refresh = false 
  } = req.body;

  // Input validation
  if (!Array.isArray(photo_paths) || photo_paths.length === 0) {
    return res.status(400).json({
      error: 'Invalid photo_paths array',
      code: 'INVALID_PHOTO_PATHS'
    });
  }

  if (photo_paths.length > 100) {
    return res.status(400).json({
      error: 'Too many photo paths in batch request',
      code: 'BATCH_LIMIT_EXCEEDED',
      max_allowed: 100,
      requested: photo_paths.length
    });
  }

  const expiresIn = parseInt(expires_in);
  if (expiresIn < 300 || expiresIn > 86400) {
    return res.status(400).json({
      error: 'Invalid expires_in parameter',
      code: 'INVALID_EXPIRY'
    });
  }

  // Get user info
  let user = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const token = authHeader.replace('Bearer ', '');
      // user = await verifyToken(token);
    } catch (authError) {
      // Continue as anonymous
    }
  }

  // Clean and validate photo paths
  const validPaths = photo_paths
    .filter(path => path && typeof path === 'string' && path.trim() !== '')
    .map(path => path.trim());

  if (validPaths.length === 0) {
    return res.status(400).json({
      error: 'No valid photo paths provided',
      code: 'NO_VALID_PATHS'
    });
  }

  console.log(`🔄 Processing batch URL request for ${validPaths.length} photos`);

  let result;
  try {
    result = await batchGenerateSignedUrls(validPaths, {
      expiresIn,
      eventId: event_id,
      userId: user?.id,
      forceRefresh: force_refresh
    });
  } catch (batchError) {
    console.error('Batch URL generation failed:', batchError);
    
    const responseTime = Date.now() - startTime;
    return res.status(500).json({
      error: 'Batch URL generation failed',
      code: 'BATCH_GENERATION_ERROR',
      details: batchError.message,
      photo_count: validPaths.length,
      performance: {
        response_time_ms: responseTime,
        failed: true
      }
    });
  }

  const responseTime = Date.now() - startTime;

  const response = {
    ...result,
    event_id: event_id,
    operation: 'batch_url_generation',
    performance: {
      response_time_ms: responseTime,
      avg_time_per_url: Math.round(responseTime / validPaths.length)
    }
  };

  // Set cache headers
  if (result.cached_count > 0) {
    res.setHeader('Cache-Control', 'public, max-age=300');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }

  console.log(`✅ Batch URL generation completed: ${result.total_count} URLs, ${responseTime}ms`);

  return res.status(200).json(response);
}

/**
 * Handle health check
 */
async function handleHealth(req, res, startTime) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const checks = await Promise.allSettled([
      checkDatabase(),
      redisHealthCheck(),
      checkEnvironment()
    ]);

    const [dbCheck, redisCheck, envCheck] = checks.map(result => 
      result.status === 'fulfilled' ? result.value : { status: 'failed', error: result.reason?.message }
    );

    const allHealthy = [dbCheck, redisCheck, envCheck].every(check => check.status === 'healthy');
    const responseTime = Date.now() - startTime;

    const response = {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      response_time_ms: responseTime,
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'unknown',
      checks: {
        database: dbCheck,
        redis: redisCheck,
        environment: envCheck
      },
      features: {
        participant_caching: true,
        photo_url_caching: true,
        batch_operations: true,
        unified_api: true
      }
    };

    const statusCode = allHealthy ? 200 : 503;
    return res.status(statusCode).json(response);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      response_time_ms: responseTime,
      error: 'Health check failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase() {
  try {
    const start = Date.now();
    const { data, error } = await supabase
      .from('events')
      .select('id')
      .limit(1);

    if (error) throw error;

    const latency = Date.now() - start;
    
    return {
      status: 'healthy',
      latency: `${latency}ms`,
      message: 'Database connection successful'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      message: 'Database connection failed'
    };
  }
}

/**
 * Check environment configuration
 */
function checkEnvironment() {
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY'
  ];

  const cachingEnvVars = [
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN'
  ];

  const optionalEnvVars = [
    'KV_URL',
    'REDIS_URL'
  ];

  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  const hasUpstash = cachingEnvVars.every(varName => !!process.env[varName]);
  const hasOptional = optionalEnvVars.some(varName => !!process.env[varName]);
  
  // Debug environment variables (only log presence, not values for security)
  console.log('Environment variables check:');
  console.log('- UPSTASH_REDIS_REST_URL:', !!process.env.UPSTASH_REDIS_REST_URL);
  console.log('- UPSTASH_REDIS_REST_TOKEN:', !!process.env.UPSTASH_REDIS_REST_TOKEN);
  console.log('- SUPABASE_URL:', !!process.env.SUPABASE_URL);
  console.log('- SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_KEY);

  if (missing.length > 0) {
    return {
      status: 'unhealthy',
      error: `Missing required environment variables: ${missing.join(', ')}`,
      message: 'Environment configuration incomplete'
    };
  }

  return {
    status: 'healthy',
    message: 'Environment configuration valid',
    details: {
      required_vars: requiredEnvVars.length,
      upstash_redis_available: hasUpstash,
      other_caching_available: hasOptional,
      primary_caching: hasUpstash ? 'upstash' : hasOptional ? 'other' : 'none'
    }
  };
}