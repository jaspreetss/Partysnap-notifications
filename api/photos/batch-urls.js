/**
 * Batch Photo URLs API
 * Handles: POST /api/photos/batch-urls
 * 
 * Purpose: Generate signed URLs for specific photo paths in batch
 * Use case: When EventGalleryScreen has photo paths and needs URLs
 */

import {
  batchGenerateSignedUrls,
  checkPhotoUrlRateLimit
} from '../../lib/photo-url-cache.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowed_methods: ['POST'],
      timestamp: new Date().toISOString()
    });
  }

  const startTime = Date.now();

  try {
    // Rate limiting
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    try {
      await checkPhotoUrlRateLimit(clientIp);
    } catch (rateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString()
      });
    }

    // Parse request body
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
        code: 'INVALID_PHOTO_PATHS',
        message: 'Provide an array of photo storage paths',
        timestamp: new Date().toISOString()
      });
    }

    if (photo_paths.length > 100) {
      return res.status(400).json({
        error: 'Too many photo paths in batch request',
        code: 'BATCH_LIMIT_EXCEEDED',
        max_allowed: 100,
        requested: photo_paths.length,
        timestamp: new Date().toISOString()
      });
    }

    const expiresIn = parseInt(expires_in);
    if (expiresIn < 300 || expiresIn > 86400) {
      return res.status(400).json({
        error: 'Invalid expires_in parameter',
        code: 'INVALID_EXPIRY',
        message: 'expires_in must be between 300 and 86400 seconds',
        timestamp: new Date().toISOString()
      });
    }

    // Get user info
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        // user = await verifyToken(token);
        console.log('Authenticated batch URL request');
      } catch (authError) {
        console.log('Anonymous batch URL request');
      }
    }

    // Clean and validate photo paths
    const validPaths = photo_paths
      .filter(path => path && typeof path === 'string' && path.trim() !== '')
      .map(path => path.trim());

    if (validPaths.length === 0) {
      return res.status(400).json({
        error: 'No valid photo paths provided',
        code: 'NO_VALID_PATHS',
        message: 'All provided paths were empty or invalid',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🔄 Processing batch URL request for ${validPaths.length} photos`);

    // Generate signed URLs
    const result = await batchGenerateSignedUrls(validPaths, {
      expiresIn,
      eventId: event_id,
      userId: user?.id,
      forceRefresh: force_refresh
    });

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Create response
    const response = {
      ...result,
      event_id: event_id,
      operation: 'batch_url_generation',
      performance: {
        response_time_ms: responseTime,
        avg_time_per_url: Math.round(responseTime / validPaths.length),
        timestamp: new Date().toISOString()
      },
      api_version: '1.0'
    };

    // Set cache headers for client-side caching
    if (result.cached_count > 0) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    console.log(`✅ Batch URL generation completed: ${result.total_count} URLs, ${responseTime}ms`);

    return res.status(200).json(response);

  } catch (error) {
    console.error('Batch URLs API error:', error);
    
    const responseTime = Date.now() - startTime;
    const errorResponse = {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
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