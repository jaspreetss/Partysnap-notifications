-- Clean up invalid FCM tokens for your user
-- Run this in Supabase SQL Editor

-- First, see all tokens for your user
SELECT 
  token,
  platform,
  device_id,
  created_at,
  last_used_at,
  is_active
FROM push_tokens 
WHERE user_id = '7eeb225a-3cab-49f5-91de-605e83319ac1'
ORDER BY created_at DESC;

-- Keep only the most recent token (the one that's working)
-- This will delete all but the newest token
DELETE FROM push_tokens 
WHERE user_id = '7eeb225a-3cab-49f5-91de-605e83319ac1'
  AND token != (
    SELECT token 
    FROM push_tokens 
    WHERE user_id = '7eeb225a-3cab-49f5-91de-605e83319ac1'
    ORDER BY created_at DESC 
    LIMIT 1
  );

-- Verify cleanup - should show only 1 token now
SELECT COUNT(*) as token_count
FROM push_tokens 
WHERE user_id = '7eeb225a-3cab-49f5-91de-605e83319ac1'
  AND is_active = true;