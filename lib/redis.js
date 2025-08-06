/**
 * Redis Client for PartySnap Caching
 * Handles connection, error recovery, and utility functions
 */

import Redis from 'ioredis';

let redisClient = null;

/**
 * Initialize Redis client with error handling
 */
function initializeRedis() {
  if (redisClient) {
    return redisClient;
  }

  try {
    // Use Vercel KV or fallback to Redis URL
    const redisUrl = process.env.KV_URL || 
                     process.env.REDIS_URL || 
                     'redis://localhost:6379';

    redisClient = new Redis(redisUrl, {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 10000,
      commandTimeout: 5000
    });

    redisClient.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    redisClient.on('connect', () => {
      console.log('🔗 Redis connected successfully');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis ready for operations');
    });

    redisClient.on('close', () => {
      console.log('❌ Redis connection closed');
    });

    return redisClient;

  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    return null;
  }
}

/**
 * Get Redis client instance
 */
export function getRedisClient() {
  if (!redisClient) {
    return initializeRedis();
  }
  return redisClient;
}

/**
 * Safe Redis operation wrapper
 */
export async function safeRedisOperation(operation, fallback = null) {
  try {
    const client = getRedisClient();
    if (!client) {
      console.warn('Redis client not available, using fallback');
      return fallback;
    }

    return await operation(client);
  } catch (error) {
    console.error('Redis operation failed:', error);
    return fallback;
  }
}

/**
 * Cache get with JSON parsing
 */
export async function getCachedData(key) {
  return await safeRedisOperation(async (client) => {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  });
}

/**
 * Cache set with JSON stringify and TTL
 */
export async function setCachedData(key, data, ttlSeconds = 3600) {
  return await safeRedisOperation(async (client) => {
    await client.setex(key, ttlSeconds, JSON.stringify(data));
    return true;
  }, false);
}

/**
 * Delete cache keys by pattern
 */
export async function deleteCachePattern(pattern) {
  return await safeRedisOperation(async (client) => {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
      return keys.length;
    }
    return 0;
  }, 0);
}

/**
 * Increment counter with TTL
 */
export async function incrementCounter(key, ttlSeconds = 60) {
  return await safeRedisOperation(async (client) => {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, ttlSeconds);
    }
    return count;
  }, 0);
}

/**
 * Set cache with automatic expiry management
 */
export async function setWithAutoExpiry(key, data, ttlSeconds = 3600) {
  const dataWithTimestamp = {
    ...data,
    cached_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + (ttlSeconds * 1000)).toISOString()
  };

  return await setCachedData(key, dataWithTimestamp, ttlSeconds);
}

/**
 * Get cache with age information
 */
export async function getWithAge(key) {
  const data = await getCachedData(key);
  
  if (!data || !data.cached_at) {
    return null;
  }

  const age = Math.floor((Date.now() - new Date(data.cached_at).getTime()) / 1000);
  const ttl = data.expires_at ? 
    Math.max(0, Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000)) : 
    0;

  return {
    ...data,
    cache_age: age,
    cache_ttl: ttl,
    is_expired: ttl <= 0
  };
}

/**
 * Batch get operation
 */
export async function getBatch(keys) {
  return await safeRedisOperation(async (client) => {
    if (keys.length === 0) return {};
    
    const values = await client.mget(...keys);
    const result = {};
    
    keys.forEach((key, index) => {
      if (values[index]) {
        try {
          result[key] = JSON.parse(values[index]);
        } catch (error) {
          console.error(`Error parsing cached data for key ${key}:`, error);
          result[key] = null;
        }
      } else {
        result[key] = null;
      }
    });
    
    return result;
  }, {});
}

/**
 * Batch set operation
 */
export async function setBatch(dataMap, ttlSeconds = 3600) {
  return await safeRedisOperation(async (client) => {
    const pipeline = client.pipeline();
    
    Object.entries(dataMap).forEach(([key, data]) => {
      pipeline.setex(key, ttlSeconds, JSON.stringify(data));
    });
    
    await pipeline.exec();
    return true;
  }, false);
}

/**
 * Health check for Redis connection
 */
export async function redisHealthCheck() {
  return await safeRedisOperation(async (client) => {
    const start = Date.now();
    await client.ping();
    const latency = Date.now() - start;
    
    return {
      status: 'healthy',
      latency: `${latency}ms`,
      timestamp: new Date().toISOString()
    };
  }, {
    status: 'unhealthy',
    error: 'Redis not available',
    timestamp: new Date().toISOString()
  });
}

/**
 * Cleanup expired keys (maintenance operation)
 */
export async function cleanupExpiredKeys(pattern = '*') {
  return await safeRedisOperation(async (client) => {
    const keys = await client.keys(pattern);
    let cleaned = 0;
    
    for (const key of keys) {
      const ttl = await client.ttl(key);
      if (ttl === -1) { // No expiry set, but might be old data
        const data = await client.get(key);
        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.expires_at && new Date(parsed.expires_at) < new Date()) {
              await client.del(key);
              cleaned++;
            }
          } catch (error) {
            // Invalid JSON, might be old data
            console.warn(`Cleaning up invalid cached data for key: ${key}`);
            await client.del(key);
            cleaned++;
          }
        }
      }
    }
    
    return cleaned;
  }, 0);
}

export default {
  getRedisClient,
  safeRedisOperation,
  getCachedData,
  setCachedData,
  deleteCachePattern,
  incrementCounter,
  setWithAutoExpiry,
  getWithAge,
  getBatch,
  setBatch,
  redisHealthCheck,
  cleanupExpiredKeys
};