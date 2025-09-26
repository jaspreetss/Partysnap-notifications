import admin from 'firebase-admin';

// Initialize Firebase Admin if not already done
let app;
try {
  app = admin.app();
} catch (error) {
  // Get service account from environment or file
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (!serviceAccount) {
    throw new Error('Firebase service account not configured');
  }

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

/**
 * Modern FCM V1 API implementation
 * This replaces the legacy API and works with the latest Firebase
 */
export async function sendFCMv1Notification(deviceToken, notification, data = {}) {
  try {
    // Validate it's a device token (not Expo token)
    if (deviceToken.startsWith('ExponentPushToken')) {
      // Extract the actual device token from Expo token if possible
      // Otherwise, this won't work with V1 API
      return {
        success: false,
        error: 'V1 API requires device tokens, not Expo tokens'
      };
    }

    // Build the V1 message format
    const message = {
      token: deviceToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        type: notification.type || 'general',
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          channelId: getChannelId(notification.type)
        }
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body
            },
            sound: 'default',
            badge: 1,
            'content-available': 1
          }
        }
      }
    };

    // Send using Firebase Admin SDK (uses V1 API internally)
    const response = await admin.messaging().send(message);
    
    console.log('✅ FCM V1 notification sent:', response);
    
    return {
      success: true,
      messageId: response
    };

  } catch (error) {
    console.error('❌ FCM V1 send error:', error);
    
    // Handle specific error types
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      return {
        success: false,
        error: error.message,
        shouldDeactivate: true
      };
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send batch notifications using V1 API
 */
export async function sendBatchFCMv1Notifications(tokens, notification, data = {}) {
  const validTokens = tokens.filter(token => !token.startsWith('ExponentPushToken'));
  
  if (validTokens.length === 0) {
    return {
      successCount: 0,
      failureCount: tokens.length,
      results: tokens.map(t => ({
        success: false,
        error: 'V1 API requires device tokens'
      }))
    };
  }

  const messages = validTokens.map(token => ({
    token,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: {
      ...data,
      type: notification.type || 'general',
      timestamp: new Date().toISOString()
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: getChannelId(notification.type)
      }
    }
  }));

  try {
    const response = await admin.messaging().sendEach(messages);
    
    console.log(`✅ FCM V1 batch: ${response.successCount} sent, ${response.failureCount} failed`);
    
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      results: response.responses.map((resp, index) => ({
        success: resp.success,
        messageId: resp.messageId,
        error: resp.error?.message,
        token: validTokens[index]
      }))
    };
  } catch (error) {
    console.error('❌ FCM V1 batch error:', error);
    throw error;
  }
}

function getChannelId(type) {
  const channelMap = {
    'photo_shared': 'photos',
    'photo_liked': 'likes',
    'event_reminder': 'reminders',
    'event_live': 'events',
    'friend_request': 'social',
    'gallery_unlocked': 'gallery',
    'default': 'default'
  };
  return channelMap[type] || 'default';
}

/**
 * Get device token from Expo token (if stored separately)
 * You'd need to store the mapping when registering
 */
export function extractDeviceToken(expoPushToken) {
  // This would require you to store the device token separately
  // when the app registers for notifications
  // For now, V1 API won't work with Expo tokens
  return null;
}