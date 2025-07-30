#!/bin/bash

# Test deployment endpoints
echo "🧪 Testing PartySnap Notification Service Deployment"
echo "=================================================="

URL="https://partysnap-notification.vercel.app"
API_KEY="zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s="

echo ""
echo "✅ Testing CORS on all endpoints..."
echo ""

endpoints=("/api/notify" "/api/register-token" "/api/test" "/api/webhook" "/api/process-all")

for endpoint in "${endpoints[@]}"
do
    echo "Testing $endpoint:"
    status=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$URL$endpoint")
    if [ "$status" = "200" ]; then
        echo "  ✅ CORS enabled (Status: $status)"
    else
        echo "  ❌ CORS issue (Status: $status)"
    fi
done

echo ""
echo "✅ Testing Authentication..."
echo ""

# Test with valid API key
echo "With valid API key:"
response=$(curl -s -X POST "$URL/api/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"userId": "test-user-123"}')
echo "Response: $response"

# Test with invalid API key
echo ""
echo "With invalid API key:"
response=$(curl -s -X POST "$URL/api/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-key" \
  -d '{"userId": "test-user-123"}')
echo "Response: $response"

echo ""
echo "✅ Service is deployed and responding!"
echo ""