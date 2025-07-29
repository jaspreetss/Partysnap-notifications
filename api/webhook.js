import { notificationService } from '../lib/notification-service.js';
import { 
  notifyPhotoLiked, 
  notifyGalleryUnlocked,
  notifyEventLive,
  notifyCommunityMilestone,
  notifyPeakActivity
} from '../lib/notification-service.js';

// Webhook endpoint for Supabase triggers
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook secret
    const webhookSecret = req.headers['x-webhook-secret'];
    if (!webhookSecret || webhookSecret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const { table, record, old_record, type } = req.body;

    console.log(`📥 Webhook received: ${table}.${type}`);

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

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
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

    // Send event live notification
    await notifyEventLive(userIds, record.id, record.name);

  } catch (error) {
    console.error('Error handling event live:', error);
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
  }
}