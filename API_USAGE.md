# Unified Caching API Usage

## Overview
All caching operations are now handled through a single endpoint: `/api/cache`

## Endpoints

### 1. Participant Operations
```bash
# Get participants with caching
GET /api/cache?type=participants&eventId=EVENT_ID&page=1&limit=20

# Get participant count only
GET /api/cache?type=participants&eventId=EVENT_ID&metadata_only=true

# Add participant
POST /api/cache?type=participants&eventId=EVENT_ID
Body: { "userId": "USER_ID" }

# Remove participant  
DELETE /api/cache?type=participants&eventId=EVENT_ID
Body: { "userId": "USER_ID" }
```

### 2. Photo URL Operations
```bash
# Get event photos with signed URLs
GET /api/cache?type=photo-urls&eventId=EVENT_ID&page=1&limit=50

# Get URLs only (no photo metadata)
GET /api/cache?type=photo-urls&eventId=EVENT_ID&urls_only=true

# Batch generate signed URLs
POST /api/cache?type=photo-urls-batch
Body: {
  "photo_paths": ["path1.jpg", "path2.jpg"],
  "event_id": "EVENT_ID",
  "expires_in": 3600
}

# Invalidate photo cache
DELETE /api/cache?type=photo-urls&eventId=EVENT_ID
```

### 3. Health Check
```bash
GET /api/cache?type=health
```

## Response Format
All endpoints return:
```json
{
  "performance": {
    "response_time_ms": 45
  },
  // ... endpoint-specific data
}
```

## Error Handling
- `400` - Invalid parameters
- `401` - Authentication required  
- `403` - Access denied
- `429` - Rate limit exceeded
- `500` - Server error

## Rate Limits
- Participants: 100 requests/minute per IP
- Photo URLs: 200 requests/minute per IP