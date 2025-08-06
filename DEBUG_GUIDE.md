# API Debugging Guide

## Current Issue
Client is getting HTML response instead of JSON when calling the batch photo URL API.

## Error Analysis
```
Server batch API failed: JSON Parse error: Unexpected character: T
```

This indicates the server is returning HTML (likely starting with `<!DOCTYPE...` or `<html>`) instead of JSON.

## Debugging Steps

### 1. Test the API Directly
```bash
cd /Users/jaspreetsaini/git/Partysnap-notifications
node test-api.js
```

### 2. Check Deployed API
If deployed to Vercel:
```bash
# Test basic endpoint
curl "https://your-deployment.vercel.app/api/cache?type=test"

# Test health check
curl "https://your-deployment.vercel.app/api/cache?type=health"

# Test batch API
curl -X POST "https://your-deployment.vercel.app/api/cache?type=photo-urls-batch" \
  -H "Content-Type: application/json" \
  -d '{"photo_paths":["test1.jpg"],"event_id":"test","expires_in":3600}'
```

### 3. Check Vercel Function Logs
1. Go to Vercel Dashboard
2. Select your project
3. Go to Functions tab
4. Check logs for errors

### 4. Verify Environment Variables
Make sure these are set in Vercel:
```
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
```

## Common Causes

### 1. Module Import Errors
If any import fails, Vercel returns HTML error page:
- Missing dependencies in package.json
- Incorrect import paths
- Node.js version compatibility

### 2. Environment Variables Missing
If Redis or Supabase connection fails:
- Check environment variables are set correctly
- Verify Upstash tokens are REST API tokens (not connection passwords)

### 3. Function Timeout
If function times out (>10s on Hobby plan):
- Vercel returns HTML timeout page
- Check Redis connection speed
- Consider caching timeouts

### 4. Memory Limit Exceeded
If function uses >1GB memory (Hobby limit):
- Returns HTML error page
- Check if processing too many photos at once

## Quick Fixes

### 1. Test with Simple Request
Update your app to test with fewer photos first:
```javascript
// In PhotoUrlBatchService.js, temporarily limit batch size
this.maxBatchSize = 5; // Instead of 100
```

### 2. Add Deployment Check
```javascript
// In your app's config
const API_URL = __DEV__ 
  ? 'http://localhost:3000/api'
  : 'https://your-deployment.vercel.app/api';
```

### 3. Enable Fallback Mode
```javascript
// In PhotoUrlBatchService.js
this.useServerCache = false; // Temporarily disable server caching
```

## Next Steps

1. **Run test script** to verify basic API functionality
2. **Check Vercel logs** for specific error messages  
3. **Verify environment variables** in Vercel dashboard
4. **Test with small batch** (1-2 photos) first
5. **Deploy incrementally** - test each endpoint separately

## Fixed Issues

✅ **Promise.allSettled compatibility** - Added fallback for React Native
✅ **CORS headers** - Added to prevent browser issues  
✅ **Error logging** - Better error messages for HTML vs JSON
✅ **Request logging** - Server now logs all incoming requests

## Files Modified

- `api/cache.js` - Added CORS, logging, error handling
- `services/PhotoUrlBatchService.js` - Fixed Promise.allSettled, better error parsing
- `test-api.js` - Created API testing tool
- `DEBUG_GUIDE.md` - This debugging guide