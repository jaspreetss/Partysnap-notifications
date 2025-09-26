import { Expo } from 'expo-server-sdk';

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Send a push notification via Expo's push notification service
 * @param {string} token - Expo push token (ExponentPushToken[xxx])
 * @param {object} notification - Notification content (title, body, etc.)
 * @param {object} data - Additional data to send with notification
 * @returns {object} Result with success status and tickets
 */
export async function sendExpoPushNotification(token, notification, data = {}) {
  try {
    // Check that the push token is a valid Expo push token
    if (!Expo.isExpoPushToken(token)) {
      console.error(`Push token ${token} is not a valid Expo push token`);
      return { 
        success: false, 
        error: 'Invalid Expo push token',
        shouldDeactivate: true 
      };
    }

    // Construct the message
    const message = {
      to: token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: {
        ...data,
        type: notification.type,
        timestamp: new Date().toISOString()
      },
      badge: 1,
      channelId: getChannelId(notification.type),
      priority: getPriority(notification.type),
      categoryId: getCategoryId(notification.type)
    };

    // Add image if provided
    if (notification.imageUrl) {
      message.image = notification.imageUrl;
    }

    // Create chunks of push notifications (Expo recommends max 100 per chunk)
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    // Send the chunks to Expo's push notification service
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        console.log('✅ Expo notification sent successfully:', ticketChunk);
      } catch (error) {
        console.error('❌ Error sending notification chunk:', error);
        return { 
          success: false, 
          error: error.message 
        };
      }
    }

    // Check tickets for errors
    const failedTickets = tickets.filter(ticket => ticket.status === 'error');
    if (failedTickets.length > 0) {
      console.error('Some notifications failed:', failedTickets);
      
      // Check if token should be deactivated
      const shouldDeactivate = failedTickets.some(
        ticket => ticket.details?.error === 'DeviceNotRegistered'
      );
      
      return {
        success: false,
        error: 'Some notifications failed',
        failedTickets,
        shouldDeactivate
      };
    }

    return { 
      success: true, 
      tickets,
      messageId: tickets[0]?.id 
    };

  } catch (error) {
    console.error('❌ Error sending Expo notification:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Send bulk push notifications via Expo
 * @param {array} tokens - Array of Expo push tokens
 * @param {object} notification - Notification content
 * @param {object} data - Additional data
 * @returns {object} Result with success counts and failed tokens
 */
export async function sendBatchExpoPushNotifications(tokens, notification, data = {}) {
  try {
    // Filter out invalid tokens
    const validTokens = tokens.filter(token => Expo.isExpoPushToken(token));
    const invalidTokens = tokens.filter(token => !Expo.isExpoPushToken(token));
    
    if (invalidTokens.length > 0) {
      console.warn(`${invalidTokens.length} invalid Expo tokens found`);
    }

    if (validTokens.length === 0) {
      return {
        success: false,
        error: 'No valid Expo push tokens provided',
        invalidTokens
      };
    }

    // Create messages for all valid tokens
    const messages = validTokens.map(token => ({
      to: token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: {
        ...data,
        type: notification.type,
        timestamp: new Date().toISOString()
      },
      badge: 1,
      channelId: getChannelId(notification.type),
      priority: getPriority(notification.type),
      categoryId: getCategoryId(notification.type),
      image: notification.imageUrl || undefined
    }));

    // Create chunks (max 100 notifications per chunk as recommended by Expo)
    const chunks = expo.chunkPushNotifications(messages);
    const allTickets = [];
    let successCount = 0;
    let failureCount = 0;
    const tokensToDeactivate = [];

    // Send all chunks
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        allTickets.push(...tickets);

        // Count successes and failures
        tickets.forEach((ticket, index) => {
          if (ticket.status === 'ok') {
            successCount++;
          } else {
            failureCount++;
            
            // Track tokens that should be deactivated
            if (ticket.details?.error === 'DeviceNotRegistered') {
              const tokenIndex = messages.findIndex(m => m === chunk[index]);
              if (tokenIndex !== -1) {
                tokensToDeactivate.push(validTokens[tokenIndex]);
              }
            }
          }
        });
      } catch (error) {
        console.error('Error sending notification chunk:', error);
        failureCount += chunk.length;
      }
    }

    console.log(`✅ Expo batch sent: ${successCount}/${validTokens.length} successful`);

    return {
      success: true,
      results: {
        successCount,
        failureCount,
        invalidCount: invalidTokens.length,
        tokensToDeactivate,
        tickets: allTickets
      }
    };

  } catch (error) {
    console.error('❌ Error sending batch Expo notifications:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Get Android notification channel ID based on notification type
 */
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

/**
 * Get notification priority based on type
 */
function getPriority(notificationType) {
  const highPriorityTypes = [
    'photo_liked',
    'event_live',
    'event_starting'
  ];

  return highPriorityTypes.includes(notificationType) ? 'high' : 'default';
}

/**
 * Get iOS category ID based on notification type
 */
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

/**
 * Validate Expo push token format
 */
export function validateExpoPushToken(token) {
  return {
    valid: Expo.isExpoPushToken(token),
    error: !Expo.isExpoPushToken(token) ? 'Invalid Expo push token format' : null
  };
}