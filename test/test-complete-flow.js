// Complete notification flow test script
import fetch from 'node-fetch';

const VERCEL_URL = 'https://your-vercel-app.vercel.app'; // Replace with your actual Vercel URL
const API_SECRET = 'your-api-secret-key'; // Replace with your actual API secret

async function testCompleteFlow() {
  console.log('🧪 Testing complete notification flow...\n');

  try {
    // Test 1: Register a push token
    console.log('1️⃣ Testing token registration...');
    const tokenResult = await testTokenRegistration();
    console.log(tokenResult.success ? '✅ Token registration passed' : '❌ Token registration failed');
    console.log(`   Result: ${JSON.stringify(tokenResult, null, 2)}\n`);

    // Test 2: Send a test notification
    console.log('2️⃣ Testing notification sending...');
    const notificationResult = await testNotificationSending();
    console.log(notificationResult.success ? '✅ Notification sending passed' : '❌ Notification sending failed');
    console.log(`   Result: ${JSON.stringify(notificationResult, null, 2)}\n`);

    // Test 3: Send bulk notification
    console.log('3️⃣ Testing bulk notification...');
    const bulkResult = await testBulkNotification();
    console.log(bulkResult.success ? '✅ Bulk notification passed' : '❌ Bulk notification failed');
    console.log(`   Result: ${JSON.stringify(bulkResult, null, 2)}\n`);

    // Test 4: Test webhook endpoint
    console.log('4️⃣ Testing webhook endpoint...');
    const webhookResult = await testWebhookEndpoint();
    console.log(webhookResult.success ? '✅ Webhook test passed' : '❌ Webhook test failed');
    console.log(`   Result: ${JSON.stringify(webhookResult, null, 2)}\n`);

    // Test 5: Test all notification types
    console.log('5️⃣ Testing all notification types...');
    const typesResult = await testAllNotificationTypes();
    console.log(typesResult.success ? '✅ All notification types passed' : '❌ Some notification types failed');
    console.log(`   Result: ${JSON.stringify(typesResult, null, 2)}\n`);

    console.log('🎉 Complete flow test finished!');

  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

async function testTokenRegistration() {
  try {
    const response = await fetch(`${VERCEL_URL}/api/register-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`
      },
      body: JSON.stringify({
        userId: 'test-user-123',
        token: 'test-device-token-456',
        platform: 'ios',
        deviceId: 'test-device-id-789'
      })
    });

    const result = await response.json();
    return {
      success: response.ok,
      status: response.status,
      data: result
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function testNotificationSending() {
  try {
    const response = await fetch(`${VERCEL_URL}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`
      },
      body: JSON.stringify({
        userId: 'test-user-123',
        type: 'photo_liked',
        data: {
          eventName: 'Test Birthday Party',
          likeCount: 15,
          photoId: 'test-photo-456',
          eventId: 'test-event-789'
        }
      })
    });

    const result = await response.json();
    return {
      success: response.ok,
      status: response.status,
      data: result
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function testBulkNotification() {
  try {
    const response = await fetch(`${VERCEL_URL}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`
      },
      body: JSON.stringify({
        userIds: ['test-user-1', 'test-user-2', 'test-user-3'],
        type: 'event_live',
        data: {
          eventName: 'Summer Festival 2024',
          eventId: 'test-event-summer'
        }
      })
    });

    const result = await response.json();
    return {
      success: response.ok,
      status: response.status,
      data: result
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function testWebhookEndpoint() {
  try {
    const response = await fetch(`${VERCEL_URL}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'your-webhook-secret' // Replace with your webhook secret
      },
      body: JSON.stringify({
        table: 'photo_likes',
        type: 'INSERT',
        record: {
          id: 'test-like-123',
          photo_id: 'test-photo-456',
          user_id: 'test-liker-789'
        }
      })
    });

    const result = await response.json();
    return {
      success: response.ok,
      status: response.status,
      data: result
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function testAllNotificationTypes() {
  const notificationTypes = [
    {
      type: 'photo_liked',
      data: { eventName: 'Test Event', likeCount: 25, photoId: 'photo-1', eventId: 'event-1' }
    },
    {
      type: 'gallery_unlocked',
      data: { eventName: 'Test Event', eventId: 'event-1' }
    },
    {
      type: 'community_milestone',
      data: { eventName: 'Test Event', milestone: 100, eventId: 'event-1' }
    },
    {
      type: 'event_live',
      data: { eventName: 'Test Event', eventId: 'event-1' }
    },
    {
      type: 'event_starting',
      data: { eventName: 'Test Event', minutesUntilStart: 15, eventId: 'event-1' }
    },
    {
      type: 'event_reminder',
      data: { eventName: 'Test Event', hoursUntilStart: 2, eventId: 'event-1' }
    },
    {
      type: 'peak_activity',
      data: { eventName: 'Test Event', recentPhotoCount: 25, eventId: 'event-1' }
    }
  ];

  const results = [];

  for (const notification of notificationTypes) {
    try {
      const response = await fetch(`${VERCEL_URL}/api/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_SECRET}`
        },
        body: JSON.stringify({
          userId: 'test-user-123',
          type: notification.type,
          data: notification.data
        })
      });

      const result = await response.json();
      results.push({
        type: notification.type,
        success: response.ok,
        status: response.status,
        data: result
      });

    } catch (error) {
      results.push({
        type: notification.type,
        success: false,
        error: error.message
      });
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const successCount = results.filter(r => r.success).length;
  
  return {
    success: successCount === notificationTypes.length,
    successCount,
    totalCount: notificationTypes.length,
    results
  };
}

// Test direct device notification (for manual testing)
async function testDirectDevice() {
  console.log('📱 Testing direct device notification...');
  
  try {
    const response = await fetch(`${VERCEL_URL}/api/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`
      },
      body: JSON.stringify({
        deviceToken: 'your-actual-device-token', // Replace with actual token
        platform: 'ios' // or 'android'
      })
    });

    const result = await response.json();
    console.log(result.success ? '✅ Direct device test passed' : '❌ Direct device test failed');
    console.log('Result:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Direct device test failed:', error);
  }
}

// Health check test
async function testHealthCheck() {
  console.log('🏥 Testing API health...');
  
  const endpoints = [
    '/api/notify',
    '/api/register-token',
    '/api/test',
    '/api/webhook'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${VERCEL_URL}${endpoint}`, {
        method: 'OPTIONS'
      });

      console.log(`${response.ok ? '✅' : '❌'} ${endpoint}: ${response.status}`);

    } catch (error) {
      console.log(`❌ ${endpoint}: ${error.message}`);
    }
  }
}

// Export functions for individual testing
export {
  testCompleteFlow,
  testTokenRegistration,
  testNotificationSending,
  testBulkNotification,
  testWebhookEndpoint,
  testAllNotificationTypes,
  testDirectDevice,
  testHealthCheck
};

// Run complete flow if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await testCompleteFlow();
}