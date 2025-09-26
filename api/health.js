// Simple health check endpoint for testing
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Simple health check response
    const response = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      services: {
        fcm: !!process.env.FIREBASE_PROJECT_ID,
        apns: !!process.env.APNS_KEY_ID,
        supabase: !!process.env.SUPABASE_URL,
        apiKey: !!process.env.API_SECRET_KEY
      },
      message: 'PartySnap Notification Service is running'
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
}