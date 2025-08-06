# PartySnap Caching Server Deployment Guide

## Overview
This server provides Redis-based caching for PartySnap's participant loading and photo URL generation performance optimization.

## Vercel Deployment

### 1. Environment Variables
Set these in your Vercel dashboard:

**Required:**
```
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_rest_token_here
```

**Supabase Connection:**
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_service_role_key
```

### 2. Upstash Redis Setup
1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database
3. Copy the **REST URL** (not the connection string)
4. Copy the **REST Token** from the REST API section
5. Add both to your Vercel environment variables

### 3. Deploy Command
```bash
cd /Users/jaspreetsaini/git/Partysnap-notifications
vercel --prod
```

## API Endpoints

### Base URL
`https://your-deployment.vercel.app/api/cache`

### Endpoints
- **Participants**: `GET /api/cache?type=participants&eventId=EVENT_ID`
- **Photo URLs**: `POST /api/cache?type=photo-urls-batch`
- **Health Check**: `GET /api/cache?type=health`

## Client Configuration

### 1. Update App Environment
Add to your main PartySnap app's environment:

```javascript
// In your .env or config
EXPO_PUBLIC_API_URL=https://your-deployment.vercel.app/api
```

### 2. Enable Caching Features
In your app:

```javascript
// ParticipantsService
participantsService.setCachingEnabled(true);

// PhotoUrlBatchService  
photoUrlBatchService.setServerCacheEnabled(true);
```

## Verification

### 1. Health Check
```bash
curl "https://your-deployment.vercel.app/api/cache?type=health"
```

Expected response:
```json
{
  "status": "healthy",
  "redis": {
    "status": "healthy",
    "latency": "45ms"
  },
  "performance": {
    "response_time_ms": 120
  }
}
```

### 2. Test Participant Cache
```bash
curl "https://your-deployment.vercel.app/api/cache?type=participants&eventId=YOUR_EVENT_ID&metadata_only=true" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Performance Monitoring

### Expected Improvements:
- **Participant loading**: 1,046ms → ~50ms (95% reduction)
- **Photo URL generation**: 1,974ms → ~200ms (90% reduction)
- **Cache hit rates**: 80-90% after warmup

### Monitoring:
- Check Vercel Function logs
- Monitor response times in health check
- Watch cache hit rates in API responses

## Troubleshooting

### Redis Connection Issues
1. Verify `UPSTASH_REDIS_REST_URL` format: `https://your-instance.upstash.io`
2. Verify `UPSTASH_REDIS_REST_TOKEN` is the REST token, not connection password
3. Check Upstash dashboard for database status

### Authentication Issues
1. Verify `SUPABASE_SERVICE_KEY` has proper permissions
2. Check RLS policies allow service role access
3. Test with `curl` using valid user tokens

### Function Limits (Hobby Plan)
- Current: 1 function (unified `/api/cache`)
- Stays well within 12-function limit
- No additional functions needed

## Files Updated/Created

### Server Files:
- `/lib/redis.js` - Upstash REST API client
- `/api/cache.js` - Unified caching endpoint
- `/lib/participants-cache.js` - Participant caching logic
- `/lib/photo-url-cache.js` - Photo URL caching logic

### Client Files (PartySnap app):
- `/services/ParticipantsService.js` - Enhanced with server caching
- `/services/PhotoUrlBatchService.js` - New batch URL service
- `/screens/events/EventGalleryScreen.js` - Uses batch URL processing

## Next Steps
1. Deploy to Vercel with correct environment variables
2. Test health check endpoint
3. Enable caching in client app
4. Monitor performance improvements
5. Adjust cache TTL values as needed