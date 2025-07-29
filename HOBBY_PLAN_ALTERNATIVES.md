# Vercel Hobby Plan Alternatives

Since you're on the Vercel Hobby plan (free), which only allows daily cron jobs, here are several alternatives to get real-time notifications working:

## 🎯 Option 1: Manual Processing Endpoint (Recommended)

I've created `/api/process-all` which combines all background tasks. You can call this manually or set up external triggers.

### Usage:
```javascript
// Call this endpoint to process all background tasks
await fetch('https://your-vercel-app.vercel.app/api/process-all', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s='
  },
  body: JSON.stringify({
    tasks: ['webhooks', 'queue', 'reminders'] // or just ['webhooks']
  })
});
```

### Integration with PartySnap App:
Add this to your app code to trigger processing when important events happen:

```javascript
// In your PartySnap app - call after important actions
async function triggerNotificationProcessing() {
  try {
    await fetch('https://your-vercel-app.vercel.app/api/process-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s='
      },
      body: JSON.stringify({ tasks: ['webhooks'] })
    });
  } catch (error) {
    console.log('Background processing failed:', error);
  }
}

// Call this after photo likes, new photos, etc.
// Don't await it so it doesn't slow down your app
triggerNotificationProcessing();
```

## 🎯 Option 2: Direct API Calls (Simplest)

Skip the webhook queue entirely and call notifications directly from your app:

```javascript
// In your PartySnap app - when someone likes a photo
async function handlePhotoLike(photoId, likerId) {
  // Your existing like logic...
  
  // Send notification immediately
  try {
    await fetch('https://your-vercel-app.vercel.app/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s='
      },
      body: JSON.stringify({
        userId: photo.user_id,
        type: 'photo_liked',
        data: {
          eventName: event.name,
          likeCount: newLikeCount,
          photoId: photoId,
          eventId: event.id
        }
      })
    });
  } catch (error) {
    console.log('Notification failed:', error);
  }
}
```

## 🎯 Option 3: External Cron Service (Free)

Use a free external service to trigger your processing:

### GitHub Actions (Free):
```yaml
# .github/workflows/process-notifications.yml
name: Process Notifications
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Processing
        run: |
          curl -X POST https://your-vercel-app.vercel.app/api/process-all \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${{ secrets.API_SECRET_KEY }}" \
            -d '{"tasks": ["webhooks", "reminders"]}'
```

### EasyCron (Free tier):
1. Sign up at https://www.easycron.com/
2. Create cron job with URL: `https://your-vercel-app.vercel.app/api/process-all`
3. Set headers: `Authorization: Bearer zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s=`
4. Set to run every 5-10 minutes

### Uptime Robot (Free):
1. Sign up at https://uptimerobot.com/
2. Create HTTP(s) monitor with your process endpoint
3. Set 5-minute intervals (free tier allows)
4. Add custom headers for authentication

## 🎯 Option 4: Upgrade to Vercel Pro ($20/month)

Benefits:
- ✅ Unlimited cron jobs at any frequency
- ✅ Better performance and limits
- ✅ Priority support
- ✅ Custom domains

## 🎯 Option 5: Supabase Edge Functions Alternative

Move the processing to Supabase Edge Functions instead:

```sql
-- Create a Supabase Edge Function trigger
CREATE OR REPLACE FUNCTION trigger_notification_processing()
RETURNS TRIGGER AS $$
BEGIN
  -- Call Supabase Edge Function instead of Vercel webhook
  PERFORM
    net.http_post(
      url := 'https://your-project.supabase.co/functions/v1/process-notification',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || 'your-supabase-anon-key',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'table', TG_TABLE_NAME,
        'type', TG_OP,
        'record', row_to_json(NEW)
      )
    );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## 📊 Recommendation

For immediate setup with Hobby plan:
1. **Use Option 2** (Direct API calls) for immediate notifications
2. **Use Option 1** (Manual endpoint) triggered from your app for background processing
3. **Use Option 3** (External cron) for reminders and cleanup

This gives you:
- ✅ Real-time notifications (direct calls)
- ✅ Background processing (manual triggers)
- ✅ Scheduled tasks (external cron)
- ✅ Zero additional cost

Later, you can upgrade to Vercel Pro if you want everything automated.

## 🔧 Current Configuration

Your current vercel.json only has the daily cleanup job, which works on Hobby plan:
- Daily token cleanup at 2 AM
- All other processing via manual endpoints or external triggers