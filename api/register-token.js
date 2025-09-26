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

    const { userId, token, expoToken, deviceToken, platform, deviceId, tokenType } = req.body;

    // Validate input
    if (!userId || (!token && !expoToken && !deviceToken) || !platform || !deviceId) {
      return res.status(400).json({ 
        error: 'userId, at least one token (token/expoToken/deviceToken), platform, and deviceId are required' 
      });
    }
    
    // Determine which token to use
    const primaryToken = token || deviceToken || expoToken;

    if (!['android', 'ios'].includes(platform)) {
      return res.status(400).json({ 
        error: 'Platform must be either "android" or "ios"' 
      });
    }

    // Validate token with respective service
    let validation = { valid: true };
    
    // Check if it's an Expo token first
    if (primaryToken.startsWith('ExponentPushToken')) {
      // Expo tokens are already validated by Expo's service
      // We just do a basic format check
      validation = { valid: true };
      console.log('📱 Expo push token detected, skipping validation');
    } else if (deviceToken) {
      // Device tokens are for FCM V1 API
      console.log(`📱 Device token detected for ${platform}, type: ${tokenType || 'fcm_v1'}`);
      if (platform === 'android') {
        validation = await validateFCMToken(deviceToken);
      } else {
        validation = await validateAPNSToken(deviceToken);
      }
    } else if (platform === 'android') {
      validation = await validateFCMToken(primaryToken);
    } else {
      validation = await validateAPNSToken(primaryToken);
    }

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid push token',
        details: validation.error
      });
    }

    // Store token in database with additional metadata
    const stored = await storePushToken(userId, primaryToken, platform, deviceId, {
      expoToken,
      deviceToken,
      tokenType: tokenType || (deviceToken ? 'fcm_v1' : 'expo')
    });

    if (!stored) {
      return res.status(500).json({
        success: false,
        error: 'Failed to store push token'
      });
    }

    console.log(`✅ Push token registered for user ${userId} on ${platform} (type: ${tokenType || 'expo'})`);
    if (deviceToken) {
      console.log('   Device token available for FCM V1 API');
    }
    if (expoToken) {
      console.log('   Expo token available for fallback');
    }

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