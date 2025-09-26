import { supabase } from '../lib/supabase.js';

/**
 * Automatic token cleanup endpoint
 * Call this periodically (e.g., via cron job) to clean up invalid tokens
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get API key from header for security
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.CLEANUP_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🧹 Starting automatic token cleanup...');

    // Find tokens that haven't been used in 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Deactivate old unused tokens
    const { data: oldTokens, error: fetchError } = await supabase
      .from('push_tokens')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .lt('last_used_at', thirtyDaysAgo.toISOString())
      .eq('is_active', true)
      .select('token, user_id');

    if (fetchError) {
      console.error('Error fetching old tokens:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch old tokens' });
    }

    const deactivatedCount = oldTokens?.length || 0;
    console.log(`✅ Deactivated ${deactivatedCount} old tokens`);

    // Find duplicate tokens (keep only the most recent)
    const { data: duplicates, error: dupError } = await supabase
      .from('push_tokens')
      .select('user_id, token, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!dupError && duplicates) {
      const userTokens = new Map();
      const tokensToDeactivate = [];

      duplicates.forEach(record => {
        const key = record.user_id;
        if (!userTokens.has(key)) {
          userTokens.set(key, []);
        }
        userTokens.get(key).push(record);
      });

      // Keep only the newest token per user
      for (const [userId, tokens] of userTokens) {
        if (tokens.length > 1) {
          // Skip the first (newest) token, deactivate the rest
          for (let i = 1; i < tokens.length; i++) {
            tokensToDeactivate.push(tokens[i].token);
          }
        }
      }

      if (tokensToDeactivate.length > 0) {
        const { error: deactError } = await supabase
          .from('push_tokens')
          .update({ 
            is_active: false,
            updated_at: new Date().toISOString()
          })
          .in('token', tokensToDeactivate);

        if (!deactError) {
          console.log(`✅ Deactivated ${tokensToDeactivate.length} duplicate tokens`);
        }
      }
    }

    // Get statistics
    const { count: activeCount } = await supabase
      .from('push_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const { count: inactiveCount } = await supabase
      .from('push_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', false);

    return res.status(200).json({
      success: true,
      deactivated: deactivatedCount,
      duplicatesRemoved: tokensToDeactivate?.length || 0,
      stats: {
        activeTokens: activeCount || 0,
        inactiveTokens: inactiveCount || 0
      }
    });

  } catch (error) {
    console.error('❌ Token cleanup error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}