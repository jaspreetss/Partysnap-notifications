import admin from 'firebase-admin';

// Initialize Firebase Admin if not already done
let app;
try {
  app = admin.app();
} catch (error) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (!serviceAccount) {
    throw new Error('Firebase service account not configured');
  }

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

/**
 * Test endpoint with hardcoded notification values
 * Bypasses all templates and sends exact values
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
    console.log('🧪 Testing hardcoded FCM notification');
    console.log('Token:', token.substring(0, 30) + '...');

    // Send the most basic notification possible
    const message = {
      token: token,
      notification: {
        title: 'Test PartySnap',
        body: 'If you see this, notifications work!'
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high',
          sound: 'default'
        }
      }
    };

    console.log('📦 Sending hardcoded message:');
    console.log(JSON.stringify(message, null, 2));

    const response = await admin.messaging().send(message);
    
    console.log('✅ FCM response:', response);

    return res.status(200).json({
      success: true,
      messageId: response,
      message: 'Hardcoded notification sent successfully'
    });

  } catch (error) {
    console.error('❌ Hardcoded test error:', error);
    return res.status(500).json({ 
      error: 'Failed to send notification',
      message: error.message,
      code: error.code
    });
  }
}