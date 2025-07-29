import { supabase } from '../../lib/supabase.js';
import { validateFCMToken } from '../../lib/fcm.js';
import { validateAPNSToken } from '../../lib/apns.js';

// Clean up invalid push tokens (runs daily at 2 AM)
export default async function handler(req, res) {
  // Verify this is a Vercel cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🧹 Starting token cleanup...');

  try {
    const results = await cleanupInvalidTokens();
    
    console.log(`✅ Token cleanup complete: ${results.deactivated} tokens deactivated, ${results.deleted} old tokens deleted`);
    
    return res.status(200).json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error during token cleanup:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function cleanupInvalidTokens() {
  const results = {
    validated: 0,
    deactivated: 0,
    deleted: 0,
    errors: 0
  };

  try {
    // Get active tokens that haven't been validated recently (7+ days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: tokensToValidate, error } = await supabase
      .from('push_tokens')
      .select('id, token, platform, user_id, last_validated_at')
      .eq('is_active', true)
      .or(`last_validated_at.is.null,last_validated_at.lt.${sevenDaysAgo}`)
      .order('last_used_at', { ascending: true })
      .limit(500); // Validate 500 tokens per run to avoid rate limits

    if (error) {
      console.error('Error fetching tokens to validate:', error);
      throw error;
    }

    if (!tokensToValidate || tokensToValidate.length === 0) {
      console.log('No tokens need validation');
      return results;
    }

    console.log(`🔍 Validating ${tokensToValidate.length} push tokens...`);

    // Validate tokens in batches to avoid overwhelming the services
    const batchSize = 50;
    for (let i = 0; i < tokensToValidate.length; i += batchSize) {
      const batch = tokensToValidate.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (tokenRecord) => {
        try {
          let validation;
          
          if (tokenRecord.platform === 'android') {
            validation = await validateFCMToken(tokenRecord.token);
          } else if (tokenRecord.platform === 'ios') {
            validation = await validateAPNSToken(tokenRecord.token);
          } else {
            console.warn(`Unknown platform: ${tokenRecord.platform}`);
            return;
          }

          results.validated++;

          if (validation.valid) {
            // Update last validated timestamp
            await supabase
              .from('push_tokens')
              .update({ 
                last_validated_at: new Date().toISOString() 
              })
              .eq('id', tokenRecord.id);
          } else {
            // Deactivate invalid token
            await supabase
              .from('push_tokens')
              .update({ 
                is_active: false,
                deactivated_at: new Date().toISOString(),
                deactivation_reason: validation.error || 'Token validation failed'
              })
              .eq('id', tokenRecord.id);

            results.deactivated++;
            console.log(`❌ Deactivated invalid ${tokenRecord.platform} token for user ${tokenRecord.user_id}`);
          }

        } catch (validationError) {
          console.error(`Error validating token ${tokenRecord.id}:`, validationError);
          results.errors++;
        }
      }));

      // Small delay between batches
      if (i + batchSize < tokensToValidate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Delete old inactive tokens (90+ days old)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: deletedTokens, error: deleteError } = await supabase
      .from('push_tokens')
      .delete()
      .eq('is_active', false)
      .lt('deactivated_at', ninetyDaysAgo)
      .select('id');

    if (deleteError) {
      console.error('Error deleting old tokens:', deleteError);
    } else {
      results.deleted = deletedTokens?.length || 0;
      if (results.deleted > 0) {
        console.log(`🗑️ Deleted ${results.deleted} old inactive tokens`);
      }
    }

    // Clean up old notification history (keep last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const { error: historyDeleteError } = await supabase
      .from('notification_history')
      .delete()
      .lt('created_at', thirtyDaysAgo);

    if (historyDeleteError) {
      console.error('Error cleaning notification history:', historyDeleteError);
    } else {
      console.log('🧹 Cleaned old notification history');
    }

    // Clean up old queue entries (keep last 7 days)
    const sevenDaysAgoQueue = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { error: queueDeleteError } = await supabase
      .from('notification_queue')
      .delete()
      .in('status', ['sent', 'failed'])
      .lt('created_at', sevenDaysAgoQueue);

    if (queueDeleteError) {
      console.error('Error cleaning notification queue:', queueDeleteError);
    } else {
      console.log('🧹 Cleaned old queue entries');
    }

    return results;

  } catch (error) {
    console.error('Error in cleanupInvalidTokens:', error);
    throw error;
  }
}