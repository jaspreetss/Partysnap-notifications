# PartySnap Notification Service

A production-ready push notification service built for Vercel with Firebase Cloud Messaging (Android) and Apple Push Notification Service (iOS) support.

## Features

- ✅ Native push notifications for both iOS and Android
- ✅ Smart notification templates matching PartySnap UX design
- ✅ Intelligent batching and rate limiting
- ✅ User preference management and quiet hours
- ✅ Webhook integration with Supabase
- ✅ Automatic token validation and cleanup
- ✅ Comprehensive logging and error handling
- ✅ Cron job automation

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### 2. Required Services

- **Supabase**: Your existing database
- **Firebase**: For Android push notifications
- **Apple Developer Account**: For iOS push notifications (APNs)
- **Vercel**: For hosting the service

### 3. Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel
```

### 4. Set Environment Variables in Vercel

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_PRIVATE_KEY
vercel env add FIREBASE_CLIENT_EMAIL
vercel env add APNS_KEY_ID
vercel env add APNS_TEAM_ID
vercel env add APNS_BUNDLE_ID
vercel env add APNS_PRIVATE_KEY
vercel env add API_SECRET_KEY
vercel env add WEBHOOK_SECRET
vercel env add CRON_SECRET
```

## API Endpoints

### POST /api/notify
Send notifications to users.

```javascript
// Single user
await fetch('https://your-vercel-app.vercel.app/api/notify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-secret-key'
  },
  body: JSON.stringify({
    userId: 'user-123',
    type: 'photo_liked',
    data: {
      eventName: 'Birthday Party',
      likeCount: 25,
      photoId: 'photo-456',
      eventId: 'event-789'
    }
  })
});

// Multiple users
await fetch('https://your-vercel-app.vercel.app/api/notify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-secret-key'
  },
  body: JSON.stringify({
    userIds: ['user-1', 'user-2', 'user-3'],
    type: 'event_live',
    data: {
      eventName: 'Summer Festival',
      eventId: 'event-123'
    }
  })
});
```

### POST /api/register-token
Register push tokens from the mobile app.

```javascript
await fetch('https://your-vercel-app.vercel.app/api/register-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-secret-key'
  },
  body: JSON.stringify({
    userId: 'user-123',
    token: 'device-push-token',
    platform: 'ios', // or 'android'
    deviceId: 'device-unique-id'
  })
});
```

### POST /api/test
Send test notifications.

```javascript
await fetch('https://your-vercel-app.vercel.app/api/test', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-secret-key'
  },
  body: JSON.stringify({
    userId: 'user-123',
    // OR specify device directly:
    // deviceToken: 'device-token',
    // platform: 'ios'
  })
});
```

### POST /api/webhook
Webhook endpoint for Supabase database triggers.

## Notification Types

The service supports these notification types:

- `photo_liked` - When someone likes a user's photo
- `gallery_unlocked` - When event photos become available
- `community_milestone` - When events reach photo milestones
- `event_live` - When an event goes live
- `event_starting` - Event starting soon reminders
- `event_reminder` - Event reminders
- `peak_activity` - High activity notifications

## Cron Jobs

The service includes automated cron jobs:

- **Every 5 minutes**: Process notification queue (`/api/cron/process-queue`)
- **Daily at 2 AM**: Clean up invalid tokens (`/api/cron/cleanup-tokens`)
- **Every hour**: Send event reminders (`/api/cron/send-reminders`)

## Integration with PartySnap App

### Update NotificationService.js

Replace the Expo push token logic with native device tokens and API calls to this service:

```javascript
// In your NotificationService.js
export async function registerPushToken() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  let token;
  if (Platform.OS === 'android') {
    token = await Notifications.getDevicePushTokenAsync();
  } else {
    token = await Notifications.getDevicePushTokenAsync();
  }

  // Register with your Vercel service
  await fetch('https://your-vercel-app.vercel.app/api/register-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-api-secret-key'
    },
    body: JSON.stringify({
      userId: getCurrentUserId(),
      token: token.data,
      platform: Platform.OS,
      deviceId: await getDeviceId()
    })
  });
}
```

## Cost Estimation

For a typical PartySnap usage:
- **Vercel Pro Plan**: $20/month (sufficient for most workloads)
- **Firebase**: Free tier covers most usage, ~$10-50/month for heavy usage
- **Apple Developer**: $99/year (required for APNs)

Total: ~$30-90/month depending on usage volume.

## Security

- API endpoints protected with secret keys
- CORS configured for your domains
- Webhook secret validation
- Token validation and automatic cleanup
- Rate limiting to prevent abuse

## Monitoring

- Comprehensive logging for all operations
- Error tracking and retry logic
- Token validation and cleanup
- Queue processing metrics
- Webhook event tracking