import { notificationService } from '../lib/notification-service.js';

// Test notification endpoint
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

    const { userId, deviceToken, platform } = req.body;

    // Validate input
    if (!userId && !deviceToken) {
      return res.status(400).json({ 
        error: 'Either userId or deviceToken is required' 
      });
    }

    if (deviceToken && !platform) {
      return res.status(400).json({ 
        error: 'Platform is required when using deviceToken' 
      });
    }

    if (platform && !['android', 'ios'].includes(platform)) {
      return res.status(400).json({ 
        error: 'Platform must be either "android" or "ios"' 
      });
    }

    let result;

    if (deviceToken) {
      // Send test notification to specific device
      result = await notificationService.sendTestNotification(userId, deviceToken, platform);
    } else {
      // Send test notification to all user's devices
      result = await notificationService.sendNotification(userId, 'photo_liked', {
        eventName: 'Test Event',
        likeCount: 5,
        photoId: 'test-photo-123',
        eventId: 'test-event-456'
      });
    }

    return res.status(200).json({
      success: true,
      result,
      message: 'Test notification sent'
    });

  } catch (error) {
    console.error('❌ Test notification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}