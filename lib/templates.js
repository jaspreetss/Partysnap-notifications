// Notification templates matching the PartySnap UX design
export const NOTIFICATION_TEMPLATES = {
  photo_liked: {
    title: (data) => {
      const count = data.likeCount || 1;
      if (count >= 100) return 'Your photo is on fire! 🔥';
      if (count >= 50) return 'Your photo is trending! ⭐';
      if (count >= 20) return 'Your photo is popular! 👏';
      if (count >= 10) return 'People love your photo! ❤️';
      return 'Someone liked your photo! 👍';
    },
    body: (data) => {
      const count = data.likeCount || 1;
      const eventName = data.eventName || 'your event';
      if (count >= 100) return `${count} likes and counting at ${eventName}!`;
      if (count >= 50) return `${count} people have liked your photo from ${eventName}`;
      if (count >= 20) return `${count} likes on your photo from ${eventName}`;
      if (count >= 10) return `${count} people liked your photo from ${eventName}`;
      return `Your photo from ${eventName} got a new like`;
    },
    type: 'photo_liked',
    priority: 'high',
    channel: 'photo-likes',
    sound: 'default',
    vibration: true
  },

  gallery_unlocked: {
    title: (data) => 'Gallery unlocked! 📸',
    body: (data) => {
      const eventName = data.eventName || 'your event';
      return `Photos from ${eventName} are now available to view and download`;
    },
    type: 'gallery_unlocked',
    priority: 'high',
    channel: 'community',
    sound: 'default',
    vibration: true
  },

  community_milestone: {
    title: (data) => {
      const milestone = data.milestone || 100;
      return `${milestone} photos milestone! 🎉`;
    },
    body: (data) => {
      const eventName = data.eventName || 'your event';
      const milestone = data.milestone || 100;
      return `${eventName} just reached ${milestone} amazing photos shared by the community`;
    },
    type: 'community_milestone',
    priority: 'medium',
    channel: 'community',
    sound: 'default',
    vibration: false
  },

  event_live: {
    title: (data) => 'Event is live! 🎉',
    body: (data) => {
      const eventName = data.eventName || 'Your event';
      return `${eventName} has started! Start capturing and sharing memories`;
    },
    type: 'event_live',
    priority: 'high',
    channel: 'event-updates',
    sound: 'event_start',
    vibration: true
  },

  event_starting: {
    title: (data) => 'Event starting soon! ⏰',
    body: (data) => {
      const eventName = data.eventName || 'Your event';
      const minutes = data.minutesUntilStart || 15;
      return `${eventName} starts in ${minutes} minutes. Get ready to capture memories!`;
    },
    type: 'event_starting',
    priority: 'high',
    channel: 'event-updates',
    sound: 'default',
    vibration: true
  },

  event_reminder: {
    title: (data) => 'Don\'t forget your event! 📅',
    body: (data) => {
      const eventName = data.eventName || 'Your event';
      const hours = data.hoursUntilStart || 1;
      return `${eventName} is in ${hours} ${hours === 1 ? 'hour' : 'hours'}. Make sure you're ready!`;
    },
    type: 'event_reminder',
    priority: 'medium',
    channel: 'event-updates',
    sound: 'gentle_reminder',
    vibration: false
  },

  peak_activity: {
    title: (data) => 'Peak activity happening! ⚡',
    body: (data) => {
      const eventName = data.eventName || 'your event';
      const photoCount = data.recentPhotoCount || 'Many';
      return `${photoCount} photos shared in the last hour at ${eventName}. Join the action!`;
    },
    type: 'peak_activity',
    priority: 'low',
    channel: 'peak-activity',
    sound: 'subtle',
    vibration: false
  }
};

// Generate notification content based on template and data
export function buildNotification(type, data = {}) {
  const template = NOTIFICATION_TEMPLATES[type];
  
  if (!template) {
    throw new Error(`Unknown notification type: ${type}`);
  }

  const notification = {
    type: template.type,
    title: typeof template.title === 'function' ? template.title(data) : template.title,
    body: typeof template.body === 'function' ? template.body(data) : template.body,
    priority: template.priority,
    channel: template.channel,
    sound: template.sound,
    vibration: template.vibration,
    imageUrl: data.imageUrl || null,
    data: {
      ...data,
      notificationType: template.type,
      timestamp: new Date().toISOString()
    }
  };

  return notification;
}

// Smart batching rules for different notification types
export const BATCHING_RULES = {
  photo_liked: {
    enabled: true,
    windowMinutes: 30,
    maxCount: 5,
    template: (notifications) => {
      const totalLikes = notifications.reduce((sum, n) => sum + (n.data.likeCount || 1), 0);
      const events = [...new Set(notifications.map(n => n.data.eventName))];
      const eventText = events.length === 1 ? events[0] : `${events.length} events`;
      
      return {
        title: `${totalLikes} total likes! 🔥`,
        body: `Your photos from ${eventText} are getting lots of love`,
        type: 'photo_liked_batch',
        data: {
          batchedCount: notifications.length,
          totalLikes,
          events: events.slice(0, 3) // Limit to first 3 events
        }
      };
    }
  },

  community_milestone: {
    enabled: true,
    windowMinutes: 60,
    maxCount: 3,
    template: (notifications) => {
      const events = [...new Set(notifications.map(n => n.data.eventName))];
      const milestones = notifications.map(n => n.data.milestone || 100);
      
      return {
        title: 'Multiple milestones reached! 🎉',
        body: `${events.length} ${events.length === 1 ? 'event has' : 'events have'} hit photo milestones`,
        type: 'community_milestone_batch',
        data: {
          batchedCount: notifications.length,
          events: events.slice(0, 3),
          milestones
        }
      };
    }
  },

  peak_activity: {
    enabled: true,
    windowMinutes: 120,
    maxCount: 2,
    template: (notifications) => {
      const events = [...new Set(notifications.map(n => n.data.eventName))];
      
      return {
        title: 'High activity across events! ⚡',
        body: `${events.length} ${events.length === 1 ? 'event is' : 'events are'} buzzing with activity`,
        type: 'peak_activity_batch',
        data: {
          batchedCount: notifications.length,
          events: events.slice(0, 3)
        }
      };
    }
  }
};

// Check if notifications can be batched together
export function canBatch(type, existingNotifications, newNotification) {
  const rules = BATCHING_RULES[type];
  
  if (!rules || !rules.enabled) {
    return false;
  }

  // Check if we're within the batching window
  const windowStart = new Date(Date.now() - rules.windowMinutes * 60 * 1000);
  const recentNotifications = existingNotifications.filter(
    n => new Date(n.created_at) > windowStart && n.notification_type === type
  );

  // Check if we haven't exceeded max batch count
  if (recentNotifications.length >= rules.maxCount) {
    return false;
  }

  return true;
}

// Create batched notification from multiple notifications
export function createBatchedNotification(type, notifications) {
  const rules = BATCHING_RULES[type];
  
  if (!rules || !rules.template) {
    throw new Error(`No batching template for type: ${type}`);
  }

  return rules.template(notifications);
}

// Validate notification data
export function validateNotificationData(type, data) {
  const required = {
    photo_liked: ['eventName', 'likeCount'],
    gallery_unlocked: ['eventName'],
    community_milestone: ['eventName', 'milestone'],
    event_live: ['eventName'],
    event_starting: ['eventName', 'minutesUntilStart'],
    event_reminder: ['eventName', 'hoursUntilStart'],
    peak_activity: ['eventName', 'recentPhotoCount']
  };

  const requiredFields = required[type] || [];
  const missing = requiredFields.filter(field => !data[field]);

  if (missing.length > 0) {
    throw new Error(`Missing required data for ${type}: ${missing.join(', ')}`);
  }

  return true;
}

// Get notification priority weight for sorting
export function getPriorityWeight(priority) {
  const weights = {
    high: 3,
    medium: 2,
    low: 1
  };
  
  return weights[priority] || 1;
}

// Default notification settings by type
export const DEFAULT_SETTINGS = {
  photo_liked: {
    enabled: true,
    threshold: 1, // Send after 1 like
    batchEnabled: true,
    quietHours: true
  },
  gallery_unlocked: {
    enabled: true,
    batchEnabled: false,
    quietHours: false // Important events bypass quiet hours
  },
  community_milestone: {
    enabled: true,
    batchEnabled: true,
    quietHours: true
  },
  event_live: {
    enabled: true,
    batchEnabled: false,
    quietHours: false
  },
  event_starting: {
    enabled: true,
    batchEnabled: false,
    quietHours: false
  },
  event_reminder: {
    enabled: true,
    batchEnabled: false,
    quietHours: true
  },
  peak_activity: {
    enabled: true,
    batchEnabled: true,
    quietHours: true
  }
};