-- FCM V1 Migration - Add columns for device tokens
-- Run this in Supabase SQL Editor to support FCM V1

-- Add new columns to push_tokens table if they don't exist
ALTER TABLE push_tokens 
ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'expo',
ADD COLUMN IF NOT EXISTS expo_token TEXT,
ADD COLUMN IF NOT EXISTS device_token TEXT;

-- Create index for faster lookups by token type
CREATE INDEX IF NOT EXISTS idx_push_tokens_token_type 
ON push_tokens(token_type);

-- Create index for device tokens
CREATE INDEX IF NOT EXISTS idx_push_tokens_device_token 
ON push_tokens(device_token) 
WHERE device_token IS NOT NULL;

-- Update existing tokens to have correct type
UPDATE push_tokens 
SET token_type = CASE 
  WHEN token LIKE 'ExponentPushToken%' THEN 'expo'
  ELSE 'fcm_v1'
END
WHERE token_type IS NULL;

-- Add comment to document the columns
COMMENT ON COLUMN push_tokens.token_type IS 'Type of token: expo, fcm_v1, or apns';
COMMENT ON COLUMN push_tokens.expo_token IS 'Expo push token for backwards compatibility';
COMMENT ON COLUMN push_tokens.device_token IS 'Native FCM or APNS token for V1 API';