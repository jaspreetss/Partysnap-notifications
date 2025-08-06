/**
 * Redis Client for PartySnap Caching
 * Handles connection, error recovery, and utility functions
 * Supports both Upstash REST API and traditional Redis
 */

// Redis client removed - using Upstash REST API for serverless compatibility

let redisClient = null;

/**
 * Initialize Redis client with error handling
 */
function initializeRedis() {
  if (redisClient) {
    return redisClient;
  }

  try {
    // Check for Upstash REST API credentials first (serverless-friendly)
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.log('🔗 Using Upstash REST API for Redis');
      // We'll use REST API calls instead of ioredis for Upstash
      return 'upstash-rest';
    }

    // No traditional Redis support in this serverless version
    // For traditional Redis, you'd need to install ioredis and implement connection logic
    console.warn('⚠️ No Redis connection configured. Caching disabled.');
    return null;

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
 * Make Upstash REST API call
 */
async function upstashRestCall(command, ...args) {
  try {
    const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([command, ...args])
    });

    if (!response.ok) {
      throw new Error(`Upstash API error: ${response.status}`);
    }

    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('Upstash REST API error:', error);
    throw error;
  }
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

    // Handle Upstash REST API
    if (client === 'upstash-rest') {
      return await operation({ upstashRest: true });
    }

    // Handle traditional Redis
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
    if (client.upstashRest) {
      const data = await upstashRestCall('GET', key);
      return data ? JSON.parse(data) : null;
    }
    
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  });
}

/**
 * Cache set with JSON stringify and TTL
 */
export async function setCachedData(key, data, ttlSeconds = 3600) {
  return await safeRedisOperation(async (client) => {
    if (client.upstashRest) {
      await upstashRestCall('SETEX', key, ttlSeconds, JSON.stringify(data));
      return true;
    }
    
    await client.setex(key, ttlSeconds, JSON.stringify(data));
    return true;
  }, false);
}

/**
 * Delete cache keys by pattern
 */
export async function deleteCachePattern(pattern) {
  return await safeRedisOperation(async (client) => {
    if (client.upstashRest) {
      const keys = await upstashRestCall('KEYS', pattern);
      if (keys && keys.length > 0) {
        await upstashRestCall('DEL', ...keys);
        return keys.length;
      }
      return 0;
    }
    
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
    if (client.upstashRest) {
      const count = await upstashRestCall('INCR', key);
      if (count === 1) {
        await upstashRestCall('EXPIRE', key, ttlSeconds);
      }
      return count;
    }
    
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
    
    if (client.upstashRest) {
      const values = await upstashRestCall('MGET', ...keys);
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
    }
    
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
    if (client.upstashRest) {
      // Upstash REST doesn't support pipelines, use individual SETEX calls
      const promises = Object.entries(dataMap).map(([key, data]) =>
        upstashRestCall('SETEX', key, ttlSeconds, JSON.stringify(data))
      );
      await Promise.all(promises);
      return true;
    }
    
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
    
    if (client.upstashRest) {
      await upstashRestCall('PING');
    } else {
      await client.ping();
    }
    
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
    if (client.upstashRest) {
      const keys = await upstashRestCall('KEYS', pattern);
      let cleaned = 0;
      
      if (keys && keys.length > 0) {
        for (const key of keys) {
          const ttl = await upstashRestCall('TTL', key);
          if (ttl === -1) { // No expiry set, but might be old data
            const data = await upstashRestCall('GET', key);
            if (data) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.expires_at && new Date(parsed.expires_at) < new Date()) {
                  await upstashRestCall('DEL', key);
                  cleaned++;
                }
              } catch (error) {
                // Invalid JSON, might be old data
                console.warn(`Cleaning up invalid cached data for key: ${key}`);
                await upstashRestCall('DEL', key);
                cleaned++;
              }
            }
          }
        }
      }
      
      return cleaned;
    }
    
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