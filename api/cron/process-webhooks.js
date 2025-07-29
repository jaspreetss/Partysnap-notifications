import { supabase } from '../../lib/supabase.js';

// Process webhook queue from Supabase (runs every 2 minutes)
export default async function handler(req, res) {
  // Verify this is a Vercel cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 Processing webhook queue...');

  try {
    const processedCount = await processWebhookQueue();
    
    console.log(`✅ Processed ${processedCount} webhook calls`);
    
    return res.status(200).json({
      success: true,
      processed: processedCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error processing webhook queue:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function processWebhookQueue() {
  try {
    // Get pending webhook calls from Supabase
    const { data: webhooks, error } = await supabase
      .from('webhook_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(50); // Process 50 at a time

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
        // Mark as processing
        await supabase
          .from('webhook_queue')
          .update({ status: 'processing' })
          .eq('id', webhook.id);

        // Process the webhook payload
        await processWebhookPayload(webhook.payload);

        // Mark as sent
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
          updateData.status = 'pending'; // Retry later
        }

        await supabase
          .from('webhook_queue')
          .update(updateData)
          .eq('id', webhook.id);
      }

      // Small delay between processing
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return processedCount;

  } catch (error) {
    console.error('Error in processWebhookQueue:', error);
    throw error;
  }
}

async function processWebhookPayload(payload) {
  const { table, type, record, old_record } = payload;

  console.log(`📥 Processing webhook: ${table}.${type}`);

  // Import notification functions
  const { 
    notifyPhotoLiked, 
    notifyGalleryUnlocked,
    notifyEventLive,
    notifyCommunityMilestone,
    notifyPeakActivity
  } = await import('../../lib/notification-service.js');

  // Handle different database events
  switch (table) {
    case 'photo_likes':
      if (type === 'INSERT') {
        await handlePhotoLiked(record);
      }
      break;

    case 'events':
      if (type === 'UPDATE' && record.status === 'live' && old_record?.status !== 'live') {
        await handleEventLive(record);
      }
      break;

    case 'photos':
      if (type === 'INSERT') {
        await handleNewPhoto(record);
      }
      break;

    default:
      console.log(`⚠️ Unhandled webhook table: ${table}`);
  }
}

async function handlePhotoLiked(record) {
  try {
    // Get photo details and current like count
    const { data: photo } = await supabase
      .from('photos')
      .select('user_id, event_id')
      .eq('id', record.photo_id)
      .single();

    if (!photo) return;

    // Get current like count
    const { count: likeCount } = await supabase
      .from('photo_likes')
      .select('*', { count: 'exact', head: true })
      .eq('photo_id', record.photo_id);

    // Get event details
    const { data: event } = await supabase
      .from('events')
      .select('name')
      .eq('id', photo.event_id)
      .single();

    // Import and use notification function
    const { notifyPhotoLiked } = await import('../../lib/notification-service.js');

    // Send notification to photo owner
    await notifyPhotoLiked(
      photo.user_id,
      record.photo_id,
      photo.event_id,
      likeCount,
      event?.name || 'your event'
    );

  } catch (error) {
    console.error('Error handling photo liked:', error);
    throw error;
  }
}

async function handleEventLive(record) {
  try {
    // Get all event participants
    const { data: participants } = await supabase
      .from('event_participants')
      .select('user_id')
      .eq('event_id', record.id)
      .eq('status', 'accepted');

    if (!participants || participants.length === 0) return;

    const userIds = participants.map(p => p.user_id);

    // Import and use notification function
    const { notifyEventLive } = await import('../../lib/notification-service.js');

    // Send event live notification
    await notifyEventLive(userIds, record.id, record.name);

  } catch (error) {
    console.error('Error handling event live:', error);
    throw error;
  }
}

async function handleNewPhoto(record) {
  try {
    // Check if this photo triggers a milestone
    const { count: totalPhotos } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', record.event_id);

    // Milestone notifications at 50, 100, 250, 500, 1000 photos
    const milestones = [50, 100, 250, 500, 1000];
    if (milestones.includes(totalPhotos)) {
      // Get event participants
      const { data: participants } = await supabase
        .from('event_participants')
        .select('user_id')
        .eq('event_id', record.event_id)
        .eq('status', 'accepted');

      if (participants && participants.length > 0) {
        const userIds = participants.map(p => p.user_id);
        
        // Get event details
        const { data: event } = await supabase
          .from('events')
          .select('name')
          .eq('id', record.event_id)
          .single();

        // Import and use notification function
        const { notifyCommunityMilestone } = await import('../../lib/notification-service.js');

        await notifyCommunityMilestone(
          userIds,
          record.event_id,
          event?.name || 'Event',
          totalPhotos
        );
      }
    }

    // Check for peak activity (10+ photos in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentPhotos } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', record.event_id)
      .gte('created_at', oneHourAgo);

    if (recentPhotos >= 10 && recentPhotos % 10 === 0) {
      // Get event participants
      const { data: participants } = await supabase
        .from('event_participants')
        .select('user_id')
        .eq('event_id', record.event_id)
        .eq('status', 'accepted');

      if (participants && participants.length > 0) {
        const userIds = participants.map(p => p.user_id);
        
        // Get event details
        const { data: event } = await supabase
          .from('events')
          .select('name')
          .eq('id', record.event_id)
          .single();

        // Import and use notification function
        const { notifyPeakActivity } = await import('../../lib/notification-service.js');

        await notifyPeakActivity(
          userIds,
          record.event_id,
          event?.name || 'Event',
          recentPhotos
        );
      }
    }

  } catch (error) {
    console.error('Error handling new photo:', error);
    throw error;
  }
}