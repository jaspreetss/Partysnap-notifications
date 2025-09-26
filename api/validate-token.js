import { sendFCMv1Notification } from '../lib/fcm-v1.js';
import { storePushToken, deactivatePushToken } from '../lib/supabase.js';

/**
 * Token validation endpoint
 * Validates a token by sending a silent test notification
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, userId, platform, deviceId } = req.body;

  if (!token || !userId) {
    return res.status(400).json({ 
      error: 'Missing required fields: token and userId' 
    });
  }

  try {
    console.log(`🔍 Validating token for user ${userId}`);

    // Skip Expo tokens - they're managed by Expo
    if (token.startsWith('ExponentPushToken')) {
      // Store the Expo token
      await storePushToken(userId, token, platform || 'expo', deviceId || 'unknown');
      
      return res.status(200).json({
        success: true,
        tokenType: 'expo',
        message: 'Expo token stored successfully'
      });
    }

    // Validate FCM token by sending a silent notification
    const validationResult = await sendFCMv1Notification(
      token,
      {
        title: '',
        body: '',
        type: 'validation'
      },
      {
        silent: 'true',
        validation: 'true',
        timestamp: new Date().toISOString()
      }
    );

    if (validationResult.success) {
      // Token is valid - store it
      await storePushToken(userId, token, platform || 'android', deviceId || 'unknown', {
        tokenType: 'fcm',
        validated: true
      });

      console.log(`✅ Token validated and stored for user ${userId}`);
      
      return res.status(200).json({
        success: true,
        tokenType: 'fcm',
        message: 'Token validated and stored successfully'
      });
    } else {
      // Token is invalid
      if (validationResult.shouldDeactivate) {
        await deactivatePushToken(token);
        console.log(`❌ Invalid token deactivated for user ${userId}`);
      }

      return res.status(400).json({
        success: false,
        error: validationResult.error,
        shouldRetry: !validationResult.shouldDeactivate
      });
    }

  } catch (error) {
    console.error('❌ Token validation error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}