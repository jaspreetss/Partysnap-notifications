// Combined processing endpoint that handles all background tasks
// This can be called manually or by external services on Hobby plan

import { supabase } from '../lib/supabase.js';
import { notificationService } from '../lib/notification-service.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify API key
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { tasks } = req.body;
    const requestedTasks = tasks || ['webhooks', 'queue', 'reminders'];

    console.log('🔄 Processing background tasks:', requestedTasks);

    const results = {
      webhooks: null,
      queue: null,
      reminders: null,
      timestamp: new Date().toISOString()
    };

    // Process webhooks
    if (requestedTasks.includes('webhooks')) {
      try {
        results.webhooks = await processWebhookQueue();
        console.log(`✅ Processed ${results.webhooks} webhook calls`);
      } catch (error) {
        console.error('❌ Error processing webhooks:', error);
        results.webhooks = { error: error.message };
      }
    }

    // Process notification queue
    if (requestedTasks.includes('queue')) {
      try {
        results.queue = await processNotificationQueue();
        console.log(`✅ Processed ${results.queue} queued notifications`);
      } catch (error) {
        console.error('❌ Error processing queue:', error);
        results.queue = { error: error.message };
      }
    }

    // Process reminders
    if (requestedTasks.includes('reminders')) {
      try {
        results.reminders = await sendEventReminders();
        console.log(`✅ Sent ${results.reminders.remindersSent} reminders`);
      } catch (error) {
        console.error('❌ Error processing reminders:', error);
        results.reminders = { error: error.message };
      }
    }

    return res.status(200).json({
      success: true,
      results,
      message: 'Background tasks processed successfully'
    });

  } catch (error) {
    console.error('❌ Background processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Process webhook queue
async function processWebhookQueue() {
  try {
    const { data: webhooks, error } = await supabase
      .from('webhook_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Error fetching webhook queue:', error);
      return 0;
    }

    if (!webhooks || webhooks.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const webhook of webhooks) {
      try {
        await supabase
          .from('webhook_queue')
          .update({ status: 'processing' })
          .eq('id', webhook.id);

        await processWebhookPayload(webhook.payload);

        await supabase
          .from('webhook_queue')
          .update({ 
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('id', webhook.id);

        processedCount++;

      } catch (webhookError) {
        console.error(`Error processing webhook ${webhook.id}:`, webhookError);
        
        const newRetryCount = (webhook.retry_count || 0) + 1;
        const updateData = {
          retry_count: newRetryCount,
          error_message: webhookError.message
        };

        if (newRetryCount >= 3) {
          updateData.status = 'failed_permanent';
        } else {
          updateData.status = 'pending';
        }

        await supabase
          .from('webhook_queue')
          .update(updateData)
          .eq('id', webhook.id);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return processedCount;

  } catch (error) {
    console.error('Error in processWebhookQueue:', error);
    throw error;
  }
}

// Process notification queue
async function processNotificationQueue() {
  try {
    const { data: queuedNotifications, error } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(100);

    if (error || !queuedNotifications?.length) {
      return 0;
    }

    let processedCount = 0;

    for (const notification of queuedNotifications) {
      try {
        await supabase
          .from('notification_queue')
          .update({ 
            status: 'processing',
            processing_started_at: new Date().toISOString()
          })
          .eq('id', notification.id);

        const result = await notificationService.sendNotification(
          notification.user_id,
          notification.notification_type,
          notification.data || {}
        );

        const updateData = {
          processing_completed_at: new Date().toISOString()
        };

        if (result.success) {
          updateData.status = 'sent';
          updateData.sent_at = new Date().toISOString();
          updateData.devices_reached = result.devicesReached || 0;
        } else {
          updateData.status = 'failed';
          updateData.error_message = result.error || 'Unknown error';
          updateData.retry_count = (notification.retry_count || 0) + 1;
          
          if (updateData.retry_count < 3) {
            updateData.status = 'pending';
            updateData.scheduled_for = new Date(Date.now() + (updateData.retry_count * 5 * 60 * 1000)).toISOString();
          }
        }

        await supabase
          .from('notification_queue')
          .update(updateData)
          .eq('id', notification.id);

        processedCount++;

      } catch (notificationError) {
        console.error(`Error processing notification ${notification.id}:`, notificationError);
        
        await supabase
          .from('notification_queue')
          .update({
            status: 'failed',
            error_message: notificationError.message,
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', notification.id);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return processedCount;

  } catch (error) {
    console.error('Error in processNotificationQueue:', error);
    throw error;
  }
}

// Send event reminders
async function sendEventReminders() {
  const results = {
    remindersSent: 0,
    eventsChecked: 0,
    errors: 0
  };

  try {
    const now = new Date();
    
    // Check for events starting in 1 hour
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const startWindow = new Date(oneHourFromNow.getTime() - 5 * 60 * 1000);
    const endWindow = new Date(oneHourFromNow.getTime() + 5 * 60 * 1000);

    const { data: upcomingEvents } = await supabase
      .from('events')
      .select('id, name, start_time, organizer_id')
      .gte('start_time', startWindow.toISOString())
      .lte('start_time', endWindow.toISOString());

    if (upcomingEvents && upcomingEvents.length > 0) {
      results.eventsChecked = upcomingEvents.length;
      
      for (const event of upcomingEvents) {
        try {
          await sendEventStartingNotification(event, 60);
          results.remindersSent++;
        } catch (error) {
          console.error(`Error sending 1-hour reminder for event ${event.id}:`, error);
          results.errors++;
        }
      }
    }

    // Check for events starting in 15 minutes
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
    const startWindow15 = new Date(fifteenMinutesFromNow.getTime() - 2 * 60 * 1000);
    const endWindow15 = new Date(fifteenMinutesFromNow.getTime() + 2 * 60 * 1000);

    const { data: soonEvents } = await supabase
      .from('events')
      .select('id, name, start_time, organizer_id')
      .gte('start_time', startWindow15.toISOString())
      .lte('start_time', endWindow15.toISOString());

    if (soonEvents && soonEvents.length > 0) {
      results.eventsChecked += soonEvents.length;
      
      for (const event of soonEvents) {
        try {
          await sendEventStartingNotification(event, 15);
          results.remindersSent++;
        } catch (error) {
          console.error(`Error sending 15-minute reminder for event ${event.id}:`, error);
          results.errors++;
        }
      }
    }

    return results;

  } catch (error) {
    console.error('Error in sendEventReminders:', error);
    throw error;
  }
}

// Helper functions (simplified versions)
async function processWebhookPayload(payload) {
  const { table, type, record } = payload;
  
  // Import and handle notifications based on webhook type
  if (table === 'photo_likes' && type === 'INSERT') {
    // Handle photo liked
    const { notifyPhotoLiked } = await import('../lib/notification-service.js');
    // Add your photo liked logic here
  } else if (table === 'photos' && type === 'INSERT') {
    // Handle milestone and peak activity
    // Add your milestone logic here
  }
}

async function sendEventStartingNotification(event, minutesUntil) {
  const { notifyEventStartingSoon } = await import('../lib/notification-service.js');
  
  // Get participants
  const { data: participants } = await supabase
    .from('event_participants')
    .select('user_id')
    .eq('event_id', event.id)
    .eq('status', 'accepted');

  if (participants && participants.length > 0) {
    const userIds = participants.map(p => p.user_id);
    await notifyEventStartingSoon(userIds, event.id, event.name, minutesUntil);
  }
}