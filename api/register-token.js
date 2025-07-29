import { storePushToken } from '../lib/supabase.js';
import { validateFCMToken } from '../lib/fcm.js';
import { validateAPNSToken } from '../lib/apns.js';

// Register push token endpoint
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

    const { userId, token, platform, deviceId } = req.body;

    // Validate input
    if (!userId || !token || !platform || !deviceId) {
      return res.status(400).json({ 
        error: 'userId, token, platform, and deviceId are required' 
      });
    }

    if (!['android', 'ios'].includes(platform)) {
      return res.status(400).json({ 
        error: 'Platform must be either "android" or "ios"' 
      });
    }

    // Validate token with respective service
    let validation;
    if (platform === 'android') {
      validation = await validateFCMToken(token);
    } else {
      validation = await validateAPNSToken(token);
    }

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid push token',
        details: validation.error
      });
    }

    // Store token in database
    const stored = await storePushToken(userId, token, platform, deviceId);

    if (!stored) {
      return res.status(500).json({
        success: false,
        error: 'Failed to store push token'
      });
    }

    console.log(`✅ Push token registered for user ${userId} on ${platform}`);

    return res.status(200).json({
      success: true,
      message: 'Push token registered successfully'
    });

  } catch (error) {
    console.error('❌ Token registration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}