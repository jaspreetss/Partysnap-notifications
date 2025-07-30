import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  realtime: {
    enabled: false
  }
});

// Helper functions for notification-related database operations
export async function getUserPushTokens(userId) {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, platform, device_id')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching push tokens:', error);
    return [];
  }

  return data || [];
}

export async function getUserNotificationPreferences(userId) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching notification preferences:', error);
    // Return default preferences if not found
    return {
      photo_likes: true,
      community_activity: true,
      event_updates: true,
      peak_activity: true,
      batch_mode: false,
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      timezone: 'UTC'
    };
  }

  return data;
}

export async function logNotificationHistory(notificationData) {
  const { data, error } = await supabase
    .from('notification_history')
    .insert({
      user_id: notificationData.userId,
      notification_type: notificationData.type,
      title: notificationData.title,
      body: notificationData.body,
      data: notificationData.data,
      event_id: notificationData.eventId || null,
      photo_id: notificationData.photoId || null,
      status: 'sent'
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error logging notification history:', error);
    return null;
  }

  return data?.id;
}

export async function updateNotificationStatus(notificationId, status, timestamp = null) {
  const updateData = { status };
  
  if (timestamp) {
    if (status === 'delivered') {
      updateData.delivered_at = timestamp;
    } else if (status === 'opened') {
      updateData.opened_at = timestamp;
    }
  }

  const { error } = await supabase
    .from('notification_history')
    .update(updateData)
    .eq('id', notificationId);

  if (error) {
    console.error('Error updating notification status:', error);
  }
}

export async function shouldSendNotification(userId) {
  try {
    const { data, error } = await supabase
      .rpc('should_send_notification', { user_uuid: userId });

    if (error) {
      console.error('Error checking notification permissions:', error);
      return true; // Default to allowing notifications
    }

    return data;
  } catch (error) {
    console.error('Error calling should_send_notification function:', error);
    return true;
  }
}

export async function getEventDetails(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, start_time, end_time, organizer_id')
    .eq('id', eventId)
    .single();

  if (error) {
    console.error('Error fetching event details:', error);
    return null;
  }

  return data;
}

export async function getPhotoDetails(photoId) {
  const { data, error } = await supabase
    .from('photos')
    .select('id, user_id, event_id, url')
    .eq('id', photoId)
    .single();

  if (error) {
    console.error('Error fetching photo details:', error);
    return null;
  }

  return data;
}

export async function storePushToken(userId, token, platform, deviceId) {
  try {
    // First check if token already exists
    const { data: existing } = await supabase
      .from('push_tokens')
      .select('id')
      .eq('token', token)
      .single();

    if (existing) {
      // Update existing token
      const { error } = await supabase
        .from('push_tokens')
        .update({
          user_id: userId,
          platform: platform,
          device_id: deviceId,
          updated_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          is_active: true
        })
        .eq('token', token);

      if (error) {
        console.error('Error updating push token:', error);
        return false;
      }
    } else {
      // Insert new token
      const { error } = await supabase
        .from('push_tokens')
        .insert({
          user_id: userId,
          token: token,
          platform: platform,
          device_id: deviceId,
          updated_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          is_active: true
        });

      if (error) {
        console.error('Error inserting push token:', error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error in storePushToken:', error);
    return false;
  }
}

export async function deactivatePushToken(token) {
  const { error } = await supabase
    .from('push_tokens')
    .update({ 
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq('token', token);

  if (error) {
    console.error('Error deactivating push token:', error);
    return false;
  }

  return true;
}