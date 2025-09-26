import { sendFCMv1Notification } from '../lib/fcm-v1.js';

/**
 * Simple test endpoint for FCM V1 notifications
 * Tests with minimal payload to isolate issues
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    console.log('🧪 Testing simple FCM V1 notification');
    console.log('Token:', token.substring(0, 30) + '...');

    // Send the simplest possible notification
    const result = await sendFCMv1Notification(
      token,
      {
        title: 'Test Notification',
        body: 'This is a test from PartySnap',
        type: 'test'
      },
      {
        test: 'true',
        timestamp: new Date().toISOString()
      }
    );

    console.log('📱 Test result:', result);

    return res.status(200).json({
      success: result.success,
      result: result
    });

  } catch (error) {
    console.error('❌ Test simple error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}