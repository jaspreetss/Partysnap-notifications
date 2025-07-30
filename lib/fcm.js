import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
let firebaseApp;

function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  const firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  };

  if (!firebaseConfig.projectId || !firebaseConfig.privateKey || !firebaseConfig.clientEmail) {
    throw new Error('Missing Firebase configuration. Please check environment variables.');
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      projectId: firebaseConfig.projectId,
    }, 'partysnap-notifications');
  } catch (error) {
    // App may already be initialized
    firebaseApp = admin.app('partysnap-notifications');
  }

  return firebaseApp;
}

export async function sendFCMNotification(token, notification, data = {}) {
  try {
    const app = initializeFirebase();
    const messaging = admin.messaging(app);

    const message = {
      token: token,
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl || undefined,
      },
      data: {
        ...data,
        // Convert all data values to strings (FCM requirement)
        ...Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, String(value)])
        ),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: getChannelId(notification.type),
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          color: '#667eea', // PartySnap brand color
          icon: 'ic_notification',
          imageUrl: notification.imageUrl || undefined,
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, String(value)])
          ),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            category: getCategoryId(notification.type),
            mutableContent: notification.imageUrl ? true : false,
          },
        },
        fcmOptions: {
          imageUrl: notification.imageUrl || undefined,
        },
      },
    };

    const response = await messaging.send(message);
    console.log('✅ FCM notification sent successfully:', response);
    return { success: true, messageId: response };

  } catch (error) {
    console.error('❌ Error sending FCM notification:', error);
    
    // Handle specific FCM errors
    if (error.code === 'messaging/registration-token-not-registered') {
      return { success: false, error: 'TOKEN_INVALID', shouldDeactivate: true };
    } else if (error.code === 'messaging/invalid-registration-token') {
      return { success: false, error: 'TOKEN_INVALID', shouldDeactivate: true };
    } else if (error.code === 'messaging/quota-exceeded') {
      return { success: false, error: 'QUOTA_EXCEEDED', shouldRetry: true };
    }

    return { success: false, error: error.message };
  }
}

export async function sendBatchFCMNotifications(tokens, notification, data = {}) {
  try {
    const app = initializeFirebase();
    const messaging = admin.messaging(app);

    // FCM supports up to 500 tokens per batch
    const batchSize = 500;
    const results = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl || undefined,
        },
        data: {
          ...Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, String(value)])
          ),
        },
        android: {
          priority: 'high',
          notification: {
            channelId: getChannelId(notification.type),
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            color: '#667eea',
            icon: 'ic_notification',
            imageUrl: notification.imageUrl || undefined,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              category: getCategoryId(notification.type),
            },
          },
        },
        tokens: batch,
      };

      const response = await messaging.sendMulticast(message);
      console.log(`✅ FCM batch sent: ${response.successCount}/${batch.length} successful`);
      
      results.push({
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses,
      });

      // Handle failed tokens
      response.responses.forEach((resp, index) => {
        if (!resp.success) {
          const error = resp.error;
          if (error?.code === 'messaging/registration-token-not-registered' ||
              error?.code === 'messaging/invalid-registration-token') {
            console.log(`Token to deactivate: ${batch[index]}`);
            // TODO: Deactivate token in database
          }
        }
      });
    }

    return { success: true, results };

  } catch (error) {
    console.error('❌ Error sending batch FCM notifications:', error);
    return { success: false, error: error.message };
  }
}

function getChannelId(notificationType) {
  const channelMap = {
    'photo_liked': 'photo-likes',
    'gallery_unlocked': 'community',
    'community_milestone': 'community',
    'event_live': 'event-updates',
    'event_starting': 'event-updates',
    'event_reminder': 'event-updates',
    'peak_activity': 'peak-activity',
  };

  return channelMap[notificationType] || 'default';
}

function getCategoryId(notificationType) {
  const categoryMap = {
    'photo_liked': 'PHOTO_INTERACTION',
    'gallery_unlocked': 'COMMUNITY_UPDATE',
    'community_milestone': 'COMMUNITY_UPDATE',
    'event_live': 'EVENT_UPDATE',
    'event_starting': 'EVENT_UPDATE',
    'event_reminder': 'EVENT_REMINDER',
    'peak_activity': 'ACTIVITY_UPDATE',
  };

  return categoryMap[notificationType] || 'GENERAL';
}

export async function validateFCMToken(token) {
  try {
    const app = initializeFirebase();
    const messaging = admin.messaging(app);

    // For newer Firebase Admin SDK, we'll validate by attempting to subscribe to a topic
    // This is a non-invasive way to check if the token is valid
    try {
      await messaging.subscribeToTopic([token], 'token-validation');
      // Immediately unsubscribe to keep things clean
      await messaging.unsubscribeFromTopic([token], 'token-validation');
      return { valid: true };
    } catch (error) {
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        return { 
          valid: false, 
          error: error.code,
          shouldDeactivate: true
        };
      }
      throw error;
    }

  } catch (error) {
    console.error('Token validation failed:', error);
    return { 
      valid: false, 
      error: error.code || error.message,
      shouldDeactivate: false
    };
  }
}