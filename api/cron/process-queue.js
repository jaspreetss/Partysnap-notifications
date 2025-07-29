import { supabase } from '../../lib/supabase.js';
import { notificationService } from '../../lib/notification-service.js';

// Process queued notifications (runs every 5 minutes)
export default async function handler(req, res) {
  // Verify this is a Vercel cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 Processing notification queue...');

  try {
    const processedCount = await processNotificationQueue();
    
    console.log(`✅ Processed ${processedCount} queued notifications`);
    
    return res.status(200).json({
      success: true,
      processed: processedCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error processing notification queue:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function processNotificationQueue() {
  try {
    // Get pending notifications (you would create this table for queuing)
    const { data: queuedNotifications, error } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(100); // Process 100 at a time

    if (error) {
      console.error('Error fetching queued notifications:', error);
      return 0;
    }

    if (!queuedNotifications || queuedNotifications.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const notification of queuedNotifications) {
      try {
        // Mark as processing
        await supabase
          .from('notification_queue')
          .update({ 
            status: 'processing',
            processing_started_at: new Date().toISOString()
          })
          .eq('id', notification.id);

        // Send the notification
        const result = await notificationService.sendNotification(
          notification.user_id,
          notification.notification_type,
          notification.data || {}
        );

        // Update status based on result
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
          
          // Schedule retry if not too many attempts
          if (updateData.retry_count < 3) {
            updateData.status = 'pending';
            updateData.scheduled_for = new Date(Date.now() + (updateData.retry_count * 5 * 60 * 1000)).toISOString(); // Exponential backoff
          }
        }

        await supabase
          .from('notification_queue')
          .update(updateData)
          .eq('id', notification.id);

        processedCount++;

      } catch (notificationError) {
        console.error(`Error processing notification ${notification.id}:`, notificationError);
        
        // Mark as failed
        await supabase
          .from('notification_queue')
          .update({
            status: 'failed',
            error_message: notificationError.message,
            processing_completed_at: new Date().toISOString()
          })
          .eq('id', notification.id);
      }

      // Small delay between notifications to avoid overwhelming services
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return processedCount;

  } catch (error) {
    console.error('Error in processNotificationQueue:', error);
    throw error;
  }
}

// Helper function to add notification to queue (can be called from other parts of the system)
export async function queueNotification(userId, notificationType, data = {}, priority = 'medium', scheduledFor = null) {
  try {
    const { data: queuedNotification, error } = await supabase
      .from('notification_queue')
      .insert({
        user_id: userId,
        notification_type: notificationType,
        data: data,
        priority: priority,
        status: 'pending',
        scheduled_for: scheduledFor || new Date().toISOString(),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error queuing notification:', error);
      return false;
    }

    console.log(`📥 Queued ${notificationType} notification for user ${userId}`);
    return queuedNotification.id;

  } catch (error) {
    console.error('Error in queueNotification:', error);
    return false;
  }
}