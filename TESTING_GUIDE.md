# 🧪 PartySnap Notification Testing Guide

## 🌐 Quick Status Check

### 1. Web Dashboard (Easiest)
Visit this URL in your browser:
```
https://partysnap-notification.vercel.app/api/status
```

This shows:
- ✅ Service health
- ✅ Configuration status
- ✅ Number of registered devices
- ✅ Recent notification statistics

### 2. Check If Environment Variables Are Set
```bash
# List all environment variables
vercel env ls

# Check specific variable
vercel env pull .env.production
cat .env.production
```

## 📱 Check Device Registration

### From Your App:
1. Open PartySnap app on a real device (not simulator)
2. Grant notification permissions when prompted
3. Check the status dashboard - device count should increase

### From Database (Supabase):
1. Go to your Supabase dashboard
2. Navigate to Table Editor → `push_tokens`
3. You should see entries with:
   - `user_id`: The user who registered
   - `token`: The device push token
   - `platform`: ios or android
   - `is_active`: Should be true

## 🚀 Test Notification Sending

### Method 1: Direct API Test
```bash
# Test with a specific user ID (replace with actual user)
curl -X POST "https://partysnap-notification.vercel.app/api/notify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s=" \
  -d '{
    "userId": "YOUR-USER-ID-HERE",
    "type": "photo_liked",
    "data": {
      "eventName": "Test Event",
      "likeCount": 5,
      "photoId": "test-123",
      "eventId": "event-456"
    }
  }'
```

### Method 2: Test Endpoint
```bash
# Sends a test notification to all devices for a user
curl -X POST "https://partysnap-notification.vercel.app/api/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s=" \
  -d '{"userId": "YOUR-USER-ID-HERE"}'
```

### Method 3: From Your App
Trigger an action that sends notifications:
1. Have someone like a photo
2. Start an event
3. Upload many photos to trigger milestones

## 🔍 Check Notification History

### In Supabase:
1. Go to Table Editor → `notification_history`
2. You'll see all sent notifications with:
   - Status (sent, delivered, opened)
   - User who received it
   - Type of notification
   - Timestamps

### Via API:
```bash
# Check system status (includes recent notifications)
curl https://partysnap-notification.vercel.app/api/status
```

## 🐛 Troubleshooting

### "No devices registered"
1. Make sure app is running on real device (not simulator)
2. Check notification permissions are granted
3. Verify `NotificationService.js` has correct API URL and key
4. Check device logs for token registration errors

### "Notification sent but not received"
1. Check if device token is valid in `push_tokens` table
2. Verify Firebase/APNs credentials are correct
3. Check notification history for error messages
4. Make sure app is not in foreground (some notifications only show in background)

### "API returns unauthorized"
1. Environment variables not set on Vercel
2. Wrong API key in request
3. Run `vercel env ls` to check if variables exist

## 📊 Monitor Background Processing

### Trigger Manual Processing (Hobby Plan)
```bash
# Process webhooks, queue, and reminders manually
curl -X POST "https://partysnap-notification.vercel.app/api/process-all" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s=" \
  -d '{"tasks": ["webhooks", "queue", "reminders"]}'
```

### Check Webhook Queue
In Supabase, check `webhook_queue` table for:
- Pending webhooks waiting to be processed
- Failed webhooks that need retry
- Successfully sent webhooks

## 🎯 Complete Test Flow

1. **Register a device:**
   - Open app on real device
   - Login with test user
   - Grant notification permissions

2. **Verify registration:**
   - Check https://partysnap-notification.vercel.app/api/status
   - Device count should increase

3. **Send test notification:**
   ```bash
   curl -X POST "https://partysnap-notification.vercel.app/api/test" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s=" \
     -d '{"userId": "YOUR-TEST-USER-ID"}'
   ```

4. **Check delivery:**
   - Notification should appear on device
   - Check `notification_history` table
   - Status dashboard shows sent count increased

## 🔄 Regular Checks

Set up external monitoring to ensure your service stays healthy:

1. **Uptime Monitor**: https://uptimerobot.com/
   - Monitor: https://partysnap-notification.vercel.app/api/status
   - Alert if down

2. **Daily Stats Email**:
   - Use Vercel's daily cron to email stats
   - Or check dashboard manually

3. **Error Monitoring**:
   - Check Vercel logs: `vercel logs`
   - Monitor failed notifications in database

## 💡 Pro Tips

1. **Test with real devices** - Simulators don't receive push notifications
2. **Use test users** - Create dedicated test accounts
3. **Check time zones** - Quiet hours respect user timezone
4. **Monitor costs** - Check Firebase/Vercel usage regularly
5. **Keep tokens fresh** - Invalid tokens are cleaned up daily at 2 AM