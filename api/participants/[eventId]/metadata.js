/**
 * Participant Metadata API
 * Handles: GET /api/participants/[eventId]/metadata
 * 
 * Purpose: Ultra-fast participant count and statistics
 * Performance: <50ms response time via aggressive Redis caching
 */

import { getParticipantMetadata, checkRateLimit } from '../../../lib/participants-cache.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowed_methods: ['GET'],
      timestamp: new Date().toISOString()
    });
  }

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

    // Rate limiting (higher limit for metadata)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    try {
      await checkRateLimit(`metadata:${clientIp}`);
    } catch (rateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString()
      });
    }

    // Get user info (optional for metadata)
    let user = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        // user = await verifyToken(token); // Implement auth verification
        console.log('Authenticated metadata request');
      } catch (authError) {
        // Continue as anonymous - metadata is generally public
        console.log('Anonymous metadata request');
      }
    }

    // Fetch metadata
    const metadata = await getParticipantMetadata(eventId, user?.id);
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Enhanced response with performance metrics
    const response = {
      ...metadata,
      event_id: eventId,
      performance: {
        response_time_ms: responseTime,
        cached: metadata.cached,
        cache_age: metadata.cache_age,
        timestamp: new Date().toISOString()
      },
      api_version: '1.0'
    };

    // Set appropriate cache headers for client-side caching
    if (metadata.cached && !metadata.stale) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes client cache
      res.setHeader('ETag', `"${eventId}-${metadata.generated_at}"`);
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Metadata API error:', error);
    
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

    // Add error details in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = {
        message: error.message,
        stack: error.stack
      };
    }

    return res.status(500).json(errorResponse);
  }
}