import { sendFCMNotification, sendBatchFCMNotifications } from './fcm.js';
import { sendAPNSNotification, sendBatchAPNSNotifications } from './apns.js';
import { sendExpoPushNotification, sendBatchExpoPushNotifications, validateExpoPushToken } from './expo-push.js';
import { sendFCMv1Notification, sendBatchFCMv1Notifications } from './fcm-v1.js';
import { 
  getUserPushTokens, 
  getUserNotificationPreferences, 
  logNotificationHistory,
  shouldSendNotification,
  deactivatePushToken
} from './supabase.js';
import { 
  buildNotification, 
  canBatch, 
  createBatchedNotification,
  validateNotificationData,
  getPriorityWeight,
  DEFAULT_SETTINGS
} from './templates.js';

// Main notification service class
export class NotificationService {
  constructor() {
    this.pendingNotifications = new Map(); // For batching
    this.rateLimits = new Map(); // For rate limiting
  }

  // Send notification to a single user
  async sendNotification(userId, type, data = {}) {
    try {
      console.log(`📱 Sending ${type} notification to user ${userId}`);

      // Validate input data
      validateNotificationData(type, data);

      // Check if user should receive notifications
      const canSend = await shouldSendNotification(userId);
      if (!canSend) {
        console.log(`⏸️ User ${userId} has notifications disabled or in quiet hours`);
        return { success: false, reason: 'user_preferences' };
      }

      // Get user preferences
      const preferences = await getUserNotificationPreferences(userId);
      const typeEnabled = preferences[type.replace('_', '')] ?? DEFAULT_SETTINGS[type]?.enabled ?? true;
      
      if (!typeEnabled) {
        console.log(`⏸️ Notification type ${type} disabled for user ${userId}`);
        return { success: false, reason: 'type_disabled' };
      }

      // Check rate limits
      if (this.isRateLimited(userId, type)) {
        console.log(`⏸️ Rate limited for user ${userId}, type ${type}`);
        return { success: false, reason: 'rate_limited' };
      }

      // Get user's push tokens
      const tokens = await getUserPushTokens(userId);
      if (tokens.length === 0) {
        console.log(`⏸️ No active push tokens for user ${userId}`);
        return { success: false, reason: 'no_tokens' };
      }

      // Check if we should batch this notification
      if (preferences.batch_mode && DEFAULT_SETTINGS[type]?.batchEnabled) {
        const shouldBatch = await this.checkBatching(userId, type, data);
        if (shouldBatch) {
          console.log(`📦 Batching ${type} notification for user ${userId}`);
          return { success: true, reason: 'batched' };
        }
      }

      // Build notification content
      const notification = buildNotification(type, data);

      // Send to all user's devices
      const results = await this.sendToDevices(tokens, notification);

      // Log notification history
      const historyId = await logNotificationHistory({
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        eventId: data.eventId || null,
        photoId: data.photoId || null
      });

      // Update rate limiting
      this.updateRateLimit(userId, type);

      console.log(`✅ Notification sent to user ${userId}: ${results.successful}/${results.total} devices`);

      return {
        success: true,
        results,
        historyId,
        devicesReached: results.successful
      };

    } catch (error) {
      console.error(`❌ Error sending notification to user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Send notification to multiple users
  async sendBulkNotification(userIds, type, data = {}) {
    console.log(`📱 Sending bulk ${type} notification to ${userIds.length} users`);
    
    const results = {
      successful: 0,
      failed: 0,
      details: []
    };

    // Process users in batches to avoid overwhelming the system
    const batchSize = 50;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(userId => 
        this.sendNotification(userId, type, data)
          .then(result => ({ userId, ...result }))
          .catch(error => ({ userId, success: false, error: error.message }))
      );

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        if (result.success) {
          results.successful++;
        } else {
          results.failed++;
        }
        results.details.push(result);
      });

      // Small delay between batches
      if (i + batchSize < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ Bulk notification complete: ${results.successful}/${userIds.length} successful`);
    return results;
  }

  // Send notifications to devices (handles iOS, Android, and Expo)
  async sendToDevices(tokens, notification) {
    const results = {
      total: tokens.length,
      successful: 0,
      failed: 0,
      invalidTokens: []
    };

    // Separate tokens by type
    const expoTokens = [];
    const androidTokens = [];
    const androidV1Tokens = []; // For FCM V1 API
    const iosTokens = [];
    
    tokens.forEach(t => {
      if (t.token.startsWith('ExponentPushToken')) {
        expoTokens.push(t);
      } else if (t.platform === 'android') {
        // Check if we have a device token for FCM V1
        if (t.device_token || t.token_type === 'fcm_v1') {
          androidV1Tokens.push(t);
        } else {
          androidTokens.push(t);
        }
      } else if (t.platform === 'ios') {
        iosTokens.push(t);
      }
    });

    // Send to Expo devices (handles both iOS and Android)
    if (expoTokens.length > 0) {
      try {
        const expoResult = await sendBatchExpoPushNotifications(
          expoTokens.map(t => t.token), 
          notification, 
          notification.data
        );
        if (expoResult.success) {
          results.successful += expoResult.results.successCount;
          results.failed += expoResult.results.failureCount;
          
          // Collect tokens to deactivate
          if (expoResult.results.tokensToDeactivate) {
            results.invalidTokens.push(...expoResult.results.tokensToDeactivate);
          }
        } else {
          results.failed += expoTokens.length;
        }
      } catch (error) {
        console.error('Expo batch send error:', error);
        results.failed += expoTokens.length;
      }
    }

    // Send to Android devices with FCM V1 (preferred)
    if (androidV1Tokens.length > 0) {
      try {
        const fcmV1Result = await sendBatchFCMv1Notifications(
          androidV1Tokens.map(t => t.device_token || t.token), 
          notification, 
          notification.data
        );
        if (fcmV1Result.successCount) {
          results.successful += fcmV1Result.successCount;
          results.failed += fcmV1Result.failureCount;
          console.log(`✅ FCM V1: ${fcmV1Result.successCount} sent, ${fcmV1Result.failureCount} failed`);
          
          // Collect invalid tokens
          if (fcmV1Result.results) {
            fcmV1Result.results.forEach(result => {
              if (!result.success && result.error?.includes('invalid-registration')) {
                results.invalidTokens.push(result.token);
              }
            });
          }
        } else {
          results.failed += androidV1Tokens.length;
        }
      } catch (error) {
        console.error('FCM V1 batch send error:', error);
        results.failed += androidV1Tokens.length;
      }
    }
    
    // Send to Android devices with Legacy FCM (fallback)
    if (androidTokens.length > 0) {
      try {
        const fcmResult = await sendBatchFCMNotifications(
          androidTokens.map(t => t.token), 
          notification, 
          notification.data
        );
        if (fcmResult.success) {
          fcmResult.results.forEach(batch => {
            results.successful += batch.successCount;
            results.failed += batch.failureCount;
          });
        } else {
          results.failed += androidTokens.length;
        }
      } catch (error) {
        console.error('FCM Legacy batch send error:', error);
        results.failed += androidTokens.length;
      }
    }

    // Send to iOS devices (non-Expo)
    if (iosTokens.length > 0) {
      try {
        const apnsResult = await sendBatchAPNSNotifications(
          iosTokens.map(t => t.token), 
          notification, 
          notification.data
        );
        if (apnsResult.success) {
          apnsResult.results.forEach(batch => {
            results.successful += batch.successCount;
            results.failed += batch.failureCount;
            
            // Collect invalid tokens
            if (batch.failed) {
              batch.failed.forEach(failure => {
                if (failure.error === 'BadDeviceToken' || failure.error === 'Unregistered') {
                  results.invalidTokens.push(failure.device);
                }
              });
            }
          });
        } else {
          results.failed += iosTokens.length;
        }
      } catch (error) {
        console.error('APNs batch send error:', error);
        results.failed += iosTokens.length;
      }
    }

    // Deactivate invalid tokens
    if (results.invalidTokens.length > 0) {
      console.log(`🗑️ Deactivating ${results.invalidTokens.length} invalid tokens`);
      await Promise.all(
        results.invalidTokens.map(token => deactivatePushToken(token))
      );
    }

    return results;
  }

  // Check if notification should be batched
  async checkBatching(userId, type, data) {
    // Implementation would check pending notifications for this user/type
    // and decide if batching is appropriate based on timing and rules
    return false; // Simplified for now
  }

  // Rate limiting check
  isRateLimited(userId, type) {
    const key = `${userId}:${type}`;
    const now = Date.now();
    const limits = this.rateLimits.get(key) || { count: 0, resetTime: now + 60000 }; // 1 minute window

    // Reset if window expired
    if (now > limits.resetTime) {
      limits.count = 0;
      limits.resetTime = now + 60000;
    }

    // Check limits by type
    const maxRequests = {
      photo_liked: 10,      // 10 per minute
      event_live: 1,        // 1 per minute
      event_starting: 1,    // 1 per minute
      community_milestone: 3, // 3 per minute
      peak_activity: 2,     // 2 per minute
      default: 5            // 5 per minute
    };

    const limit = maxRequests[type] || maxRequests.default;
    return limits.count >= limit;
  }

  // Update rate limiting counters
  updateRateLimit(userId, type) {
    const key = `${userId}:${type}`;
    const now = Date.now();
    const limits = this.rateLimits.get(key) || { count: 0, resetTime: now + 60000 };

    // Reset if window expired
    if (now > limits.resetTime) {
      limits.count = 1;
      limits.resetTime = now + 60000;
    } else {
      limits.count++;
    }

    this.rateLimits.set(key, limits);
  }

  // Clean up old rate limit entries
  cleanupRateLimits() {
    const now = Date.now();
    for (const [key, limits] of this.rateLimits.entries()) {
      if (now > limits.resetTime + 60000) { // 1 minute grace period
        this.rateLimits.delete(key);
      }
    }
  }

  // Test notification (for development/testing)
  async sendTestNotification(userId, deviceToken, platform) {
    try {
      const testNotification = {
        title: 'PartySnap Test 🎉',
        body: 'This is a test notification from PartySnap!',
        type: 'test',
        data: {
          test: true,
          timestamp: new Date().toISOString()
        }
      };

      let result;
      
      // Check if it's an Expo token
      if (deviceToken.startsWith('ExponentPushToken')) {
        result = await sendExpoPushNotification(deviceToken, testNotification, testNotification.data);
      } else if (platform === 'android') {
        result = await sendFCMNotification(deviceToken, testNotification);
      } else if (platform === 'ios') {
        result = await sendAPNSNotification(deviceToken, testNotification);
      } else {
        throw new Error('Invalid platform. Use "android", "ios", or provide an Expo token');
      }

      console.log(`✅ Test notification sent to ${deviceToken.startsWith('ExponentPushToken') ? 'Expo' : platform} device`);
      return result;

    } catch (error) {
      console.error('❌ Error sending test notification:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Utility functions for common notification scenarios
export async function notifyPhotoLiked(userId, photoId, eventId, likeCount, eventName) {
  return await notificationService.sendNotification(userId, 'photo_liked', {
    photoId,
    eventId,
    likeCount,
    eventName
  });
}

export async function notifyGalleryUnlocked(userIds, eventId, eventName) {
  return await notificationService.sendBulkNotification(userIds, 'gallery_unlocked', {
    eventId,
    eventName
  });
}

export async function notifyEventLive(userIds, eventId, eventName) {
  return await notificationService.sendBulkNotification(userIds, 'event_live', {
    eventId,
    eventName
  });
}

export async function notifyEventStartingSoon(userIds, eventId, eventName, minutesUntilStart) {
  return await notificationService.sendBulkNotification(userIds, 'event_starting', {
    eventId,
    eventName,
    minutesUntilStart
  });
}

export async function notifyCommunityMilestone(userIds, eventId, eventName, milestone) {
  return await notificationService.sendBulkNotification(userIds, 'community_milestone', {
    eventId,
    eventName,
    milestone
  });
}

export async function notifyPeakActivity(userIds, eventId, eventName, recentPhotoCount) {
  return await notificationService.sendBulkNotification(userIds, 'peak_activity', {
    eventId,
    eventName,
    recentPhotoCount
  });
}