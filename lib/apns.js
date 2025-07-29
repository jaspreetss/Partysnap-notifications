import apn from 'node-apn';

// Initialize APNs provider
let apnsProvider;

function initializeAPNs() {
  if (apnsProvider) {
    return apnsProvider;
  }

  const apnsConfig = {
    key: process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    production: process.env.NODE_ENV === 'production',
    topic: process.env.APNS_BUNDLE_ID,
  };

  if (!apnsConfig.key || !apnsConfig.keyId || !apnsConfig.teamId || !apnsConfig.topic) {
    throw new Error('Missing APNs configuration. Please check environment variables.');
  }

  try {
    apnsProvider = new apn.Provider(apnsConfig);
    console.log('✅ APNs provider initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing APNs provider:', error);
    throw error;
  }

  return apnsProvider;
}

export async function sendAPNSNotification(token, notification, data = {}) {
  try {
    const provider = initializeAPNs();

    const note = new apn.Notification();
    
    // Basic notification properties
    note.topic = process.env.APNS_BUNDLE_ID;
    note.title = notification.title;
    note.body = notification.body;
    note.sound = 'default';
    note.badge = 1;
    note.category = getCategoryId(notification.type);
    note.threadId = getThreadId(notification.type);
    
    // Set priority
    note.priority = 10; // High priority
    
    // Add custom data
    note.payload = {
      ...data,
      type: notification.type,
      timestamp: new Date().toISOString(),
    };

    // Add image if provided
    if (notification.imageUrl) {
      note.mutableContent = 1;
      note.payload.imageUrl = notification.imageUrl;
    }

    // Configure expiry (7 days)
    note.expiry = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    const result = await provider.send(note, token);
    
    // Check if notification was sent successfully
    if (result.sent && result.sent.length > 0) {
      console.log('✅ APNs notification sent successfully');
      return { success: true, messageId: result.sent[0].device };
    } else if (result.failed && result.failed.length > 0) {
      const failure = result.failed[0];
      console.error('❌ APNs notification failed:', failure.error);
      
      // Handle specific APNs errors
      if (failure.error === 'BadDeviceToken' || failure.error === 'Unregistered') {
        return { success: false, error: 'TOKEN_INVALID', shouldDeactivate: true };
      } else if (failure.error === 'TooManyRequests') {
        return { success: false, error: 'RATE_LIMITED', shouldRetry: true };
      }
      
      return { success: false, error: failure.error };
    }

    return { success: false, error: 'Unknown error' };

  } catch (error) {
    console.error('❌ Error sending APNs notification:', error);
    return { success: false, error: error.message };
  }
}

export async function sendBatchAPNSNotifications(tokens, notification, data = {}) {
  try {
    const provider = initializeAPNs();
    
    // APNs recommends batching up to 100 notifications per connection
    const batchSize = 100;
    const results = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      const note = new apn.Notification();
      note.topic = process.env.APNS_BUNDLE_ID;
      note.title = notification.title;
      note.body = notification.body;
      note.sound = 'default';
      note.badge = 1;
      note.category = getCategoryId(notification.type);
      note.threadId = getThreadId(notification.type);
      note.priority = 10;
      
      note.payload = {
        ...data,
        type: notification.type,
        timestamp: new Date().toISOString(),
      };

      if (notification.imageUrl) {
        note.mutableContent = 1;
        note.payload.imageUrl = notification.imageUrl;
      }

      note.expiry = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      const result = await provider.send(note, batch);
      
      console.log(`✅ APNs batch sent: ${result.sent?.length || 0}/${batch.length} successful`);
      
      results.push({
        successCount: result.sent?.length || 0,
        failureCount: result.failed?.length || 0,
        sent: result.sent || [],
        failed: result.failed || [],
      });

      // Handle failed tokens
      if (result.failed && result.failed.length > 0) {
        result.failed.forEach((failure) => {
          if (failure.error === 'BadDeviceToken' || failure.error === 'Unregistered') {
            console.log(`APNs token to deactivate: ${failure.device}`);
            // TODO: Deactivate token in database
          }
        });
      }

      // Add small delay between batches to avoid rate limiting
      if (i + batchSize < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return { success: true, results };

  } catch (error) {
    console.error('❌ Error sending batch APNs notifications:', error);
    return { success: false, error: error.message };
  }
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

function getThreadId(notificationType) {
  // Group related notifications together
  const threadMap = {
    'photo_liked': 'photo-interactions',
    'gallery_unlocked': 'community-updates',
    'community_milestone': 'community-updates',
    'event_live': 'event-updates',
    'event_starting': 'event-updates',
    'event_reminder': 'event-reminders',
    'peak_activity': 'activity-updates',
  };

  return threadMap[notificationType] || 'general';
}

export async function validateAPNSToken(token) {
  try {
    const provider = initializeAPNs();

    // Create a test notification
    const note = new apn.Notification();
    note.topic = process.env.APNS_BUNDLE_ID;
    note.title = 'Test';
    note.body = 'Test';
    note.sound = 'default';
    note.priority = 5; // Lower priority for validation
    note.expiry = Math.floor(Date.now() / 1000) + 60; // Short expiry for test

    const result = await provider.send(note, token);

    if (result.sent && result.sent.length > 0) {
      return { valid: true };
    } else if (result.failed && result.failed.length > 0) {
      const failure = result.failed[0];
      return {
        valid: false,
        error: failure.error,
        shouldDeactivate: failure.error === 'BadDeviceToken' || failure.error === 'Unregistered'
      };
    }

    return { valid: false, error: 'Unknown validation result' };

  } catch (error) {
    console.error('APNs token validation failed:', error);
    return {
      valid: false,
      error: error.message,
      shouldDeactivate: false
    };
  }
}

// Cleanup function for graceful shutdown
export async function shutdownAPNS() {
  if (apnsProvider) {
    await apnsProvider.shutdown();
    apnsProvider = null;
    console.log('✅ APNs provider shutdown complete');
  }
}