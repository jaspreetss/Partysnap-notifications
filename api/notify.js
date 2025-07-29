import { notificationService } from '../lib/notification-service.js';

// Main notification endpoint
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

    const { userId, userIds, type, data } = req.body;

    // Validate input
    if (!type) {
      return res.status(400).json({ error: 'Notification type is required' });
    }

    if (!userId && !userIds) {
      return res.status(400).json({ error: 'Either userId or userIds is required' });
    }

    if (userId && userIds) {
      return res.status(400).json({ error: 'Provide either userId or userIds, not both' });
    }

    let result;

    if (userId) {
      // Single user notification
      result = await notificationService.sendNotification(userId, type, data || {});
    } else {
      // Bulk notification
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }

      if (userIds.length > 1000) {
        return res.status(400).json({ error: 'Maximum 1000 users per request' });
      }

      result = await notificationService.sendBulkNotification(userIds, type, data || {});
    }

    return res.status(200).json({
      success: true,
      result
    });

  } catch (error) {
    console.error('❌ Notification API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}