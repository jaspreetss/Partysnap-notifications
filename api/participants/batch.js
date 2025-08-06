/**
 * Batch Participants API
 * Handles: POST /api/participants/batch
 * 
 * Purpose: Load participants for multiple events efficiently
 * Performance: Parallel processing with smart caching
 */

import { 
  getEventParticipants, 
  preloadEventParticipants, 
  checkRateLimit 
} from '../../lib/participants-cache.js';

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
      await checkRateLimit(`batch:${clientIp}`);
    } catch (rateLimitError) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString()
      });
    }

    // Parse and validate request body
    const { 
      event_ids = [], 
      limit = 10, 
      operation = 'load',
      priority = 'normal'
    } = req.body;

    // Input validation
    if (!Array.isArray(event_ids) || event_ids.length === 0) {
      return res.status(400).json({
        error: 'Invalid event_ids array',
        code: 'INVALID_EVENT_IDS',
        message: 'Provide an array of event IDs',
        timestamp: new Date().toISOString()
      });
    }

    if (event_ids.length > 50) {
      return res.status(400).json({
        error: 'Too many events in batch request',
        code: 'BATCH_LIMIT_EXCEEDED',
        max_allowed: 50,
        requested: event_ids.length,
        timestamp: new Date().toISOString()
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        error: 'Invalid limit parameter',
        code: 'INVALID_LIMIT',
        message: 'Limit must be between 1 and 100',
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
        console.log('Authenticated batch request');
      } catch (authError) {
        console.log('Anonymous batch request');
      }
    }

    // Handle different operations
    let result;
    switch (operation) {
      case 'load':
        result = await handleBatchLoad(event_ids, limit, user);
        break;
      case 'preload':
        result = await handleBatchPreload(event_ids, limit, priority);
        break;
      case 'metadata':
        result = await handleBatchMetadata(event_ids, user);
        break;
      default:
        return res.status(400).json({
          error: 'Invalid operation',
          code: 'INVALID_OPERATION',
          allowed_operations: ['load', 'preload', 'metadata'],
          timestamp: new Date().toISOString()
        });
    }

    // Add performance metrics
    const responseTime = Date.now() - startTime;
    result.performance = {
      response_time_ms: responseTime,
      events_processed: event_ids.length,
      avg_time_per_event: Math.round(responseTime / event_ids.length),
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(result);

  } catch (error) {
    console.error('Batch API error:', error);
    
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

/**
 * Handle batch loading of participants
 */
async function handleBatchLoad(eventIds, limit, user) {
  const results = {};
  const errors = {};
  const promises = eventIds.map(async (eventId) => {
    try {
      const participants = await getEventParticipants(eventId, {
        page: 1,
        limit,
        userId: user?.id
      });
      results[eventId] = participants;
    } catch (error) {
      console.error(`Failed to load participants for event ${eventId}:`, error);
      errors[eventId] = {
        error: error.message,
        code: 'LOAD_FAILED'
      };
    }
  });

  await Promise.allSettled(promises);

  const successCount = Object.keys(results).length;
  const errorCount = Object.keys(errors).length;

  return {
    operation: 'batch_load',
    total_events: eventIds.length,
    successful: successCount,
    failed: errorCount,
    results,
    errors: errorCount > 0 ? errors : undefined,
    summary: {
      success_rate: Math.round((successCount / eventIds.length) * 100),
      total_participants: Object.values(results).reduce(
        (sum, event) => sum + (event.total_count || 0), 0
      )
    }
  };
}

/**
 * Handle batch preloading of participants
 */
async function handleBatchPreload(eventIds, limit, priority) {
  try {
    await preloadEventParticipants(eventIds, { limit, priority });
    
    return {
      operation: 'batch_preload',
      total_events: eventIds.length,
      status: 'completed',
      message: 'Participants preloaded successfully',
      priority
    };
  } catch (error) {
    console.error('Batch preload error:', error);
    return {
      operation: 'batch_preload',
      total_events: eventIds.length,
      status: 'failed',
      error: error.message,
      priority
    };
  }
}

/**
 * Handle batch metadata loading
 */
async function handleBatchMetadata(eventIds, user) {
  const results = {};
  const errors = {};
  
  // Import metadata function
  const { getParticipantMetadata } = await import('../../lib/participants-cache.js');
  
  const promises = eventIds.map(async (eventId) => {
    try {
      const metadata = await getParticipantMetadata(eventId, user?.id);
      results[eventId] = {
        total_count: metadata.total_count,
        active_today: metadata.active_today,
        active_this_week: metadata.active_this_week,
        participation_rate: metadata.participation_rate,
        last_participant_joined: metadata.last_participant_joined,
        cached: metadata.cached,
        source: metadata.source
      };
    } catch (error) {
      console.error(`Failed to load metadata for event ${eventId}:`, error);
      errors[eventId] = {
        error: error.message,
        code: 'METADATA_FAILED'
      };
    }
  });

  await Promise.allSettled(promises);

  const successCount = Object.keys(results).length;
  const errorCount = Object.keys(errors).length;

  return {
    operation: 'batch_metadata',
    total_events: eventIds.length,
    successful: successCount,
    failed: errorCount,
    results,
    errors: errorCount > 0 ? errors : undefined,
    summary: {
      success_rate: Math.round((successCount / eventIds.length) * 100),
      total_participants: Object.values(results).reduce(
        (sum, event) => sum + (event.total_count || 0), 0
      ),
      total_active: Object.values(results).reduce(
        (sum, event) => sum + (event.active_this_week || 0), 0
      )
    }
  };
}