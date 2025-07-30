export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check environment variables (without exposing them)
    const hasSupabaseUrl = !!process.env.SUPABASE_URL;
    const hasServiceKey = !!process.env.SUPABASE_SERVICE_KEY;
    const serviceKeyPrefix = process.env.SUPABASE_SERVICE_KEY?.substring(0, 20) + '...';
    
    // Check if it's a service role key (should start with 'eyJ' and contain 'service_role' when decoded)
    let keyType = 'unknown';
    try {
      const keyString = process.env.SUPABASE_SERVICE_KEY;
      if (keyString?.startsWith('eyJ')) {
        // It's a JWT token
        const payload = JSON.parse(Buffer.from(keyString.split('.')[1], 'base64').toString());
        keyType = payload.role || 'no-role-in-jwt';
      } else {
        keyType = 'not-jwt';
      }
    } catch (e) {
      keyType = 'decode-error';
    }
    
    // Try to query a simple table to check auth
    const { supabase } = await import('../lib/supabase.js');
    
    // Test service role access
    const { data: authTest, error: authError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });

    // Test push_tokens table access
    const { data: tokenTest, error: tokenError } = await supabase
      .from('push_tokens')
      .select('id')
      .limit(1);

    return res.status(200).json({
      environment: {
        hasSupabaseUrl,
        hasServiceKey,
        serviceKeyPrefix,
        keyType,
        nodeEnv: process.env.NODE_ENV
      },
      auth: {
        canListUsers: !authError,
        authError: authError?.message
      },
      database: {
        canAccessPushTokens: !tokenError,
        tokenError: tokenError?.message
      }
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Debug failed',
      message: error.message,
      stack: error.stack
    });
  }
}