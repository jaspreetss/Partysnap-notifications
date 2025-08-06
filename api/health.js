/**
 * Health Check API
 * Handles: GET /api/health
 * 
 * Purpose: Monitor server health, cache status, and performance metrics
 */

import { redisHealthCheck } from '../lib/redis.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  
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
        batch_operations: true,
        real_time_invalidation: true,
        rate_limiting: true
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

  const optionalEnvVars = [
    'KV_URL',
    'REDIS_URL'
  ];

  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  const hasOptional = optionalEnvVars.some(varName => !!process.env[varName]);

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
      optional_vars_available: hasOptional,
      caching_available: hasOptional
    }
  };
}