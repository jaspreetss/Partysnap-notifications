-- Fix notification preferences for testing
-- Run this in Supabase SQL Editor

-- 1. Ensure notification_preferences table exists with proper defaults
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_likes BOOLEAN DEFAULT true,
  community_activity BOOLEAN DEFAULT true,
  event_updates BOOLEAN DEFAULT true,
  peak_activity BOOLEAN DEFAULT true,
  batch_mode BOOLEAN DEFAULT false,
  quiet_hours_enabled BOOLEAN DEFAULT false,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '07:00',
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 2. Insert default preferences for all existing users without preferences
INSERT INTO notification_preferences (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM notification_preferences WHERE user_id IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;

-- 3. Create or replace the should_send_notification function to be more permissive
CREATE OR REPLACE FUNCTION should_send_notification(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  prefs RECORD;
  current_time TIME;
BEGIN
  -- Get user preferences
  SELECT * INTO prefs FROM notification_preferences WHERE user_id = user_uuid;
  
  -- If no preferences found, allow notifications (with defaults)
  IF NOT FOUND THEN
    -- Create default preferences for this user
    INSERT INTO notification_preferences (user_id) VALUES (user_uuid)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN true;
  END IF;
  
  -- Check if quiet hours are enabled
  IF prefs.quiet_hours_enabled THEN
    -- Get current time in user's timezone (or UTC if not set)
    current_time := CURRENT_TIME AT TIME ZONE COALESCE(prefs.timezone, 'UTC');
    
    -- Check if within quiet hours
    IF prefs.quiet_hours_start < prefs.quiet_hours_end THEN
      -- Normal case: quiet hours don't cross midnight
      IF current_time >= prefs.quiet_hours_start AND current_time <= prefs.quiet_hours_end THEN
        RETURN false;
      END IF;
    ELSE
      -- Quiet hours cross midnight (e.g., 22:00 to 07:00)
      IF current_time >= prefs.quiet_hours_start OR current_time <= prefs.quiet_hours_end THEN
        RETURN false;
      END IF;
    END IF;
  END IF;
  
  -- Allow notifications
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 4. Test the function with a specific user
-- SELECT should_send_notification('7eeb225a-3cab-49f5-91de-605e83319ac1'::uuid);

-- 5. Enable notifications for specific test user
UPDATE notification_preferences 
SET 
  photo_likes = true,
  community_activity = true,
  event_updates = true,
  peak_activity = true,
  quiet_hours_enabled = false,
  updated_at = NOW()
WHERE user_id = '7eeb225a-3cab-49f5-91de-605e83319ac1'::uuid;

-- If the update didn't affect any rows, insert new preferences
INSERT INTO notification_preferences (
  user_id,
  photo_likes,
  community_activity,
  event_updates,
  peak_activity,
  quiet_hours_enabled
) VALUES (
  '7eeb225a-3cab-49f5-91de-605e83319ac1'::uuid,
  true,
  true,
  true,
  true,
  false
) ON CONFLICT (user_id) DO UPDATE SET
  photo_likes = true,
  community_activity = true,
  event_updates = true,
  peak_activity = true,
  quiet_hours_enabled = false,
  updated_at = NOW();