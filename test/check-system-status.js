// Check notification system status and test functionality
import fetch from 'node-fetch';

const VERCEL_URL = 'https://partysnap-notification.vercel.app';
const API_SECRET = 'zPlQ+EuXwkeeVl6bFZPLtay2p2u2RxoWY4I05a2766s=';

// Your Supabase credentials (for checking database)
const SUPABASE_URL = 'https://egtslfvzstohzxqxgqsh.supabase.co';
const SUPABASE_ANON_KEY = 'your-supabase-anon-key'; // Replace with your anon key

async function checkSystemStatus() {
  console.log('🔍 PartySnap Notification System Status Check');
  console.log('===========================================\n');

  // 1. Check API Health
  console.log('1️⃣ Checking API Health...');
  const apiHealth = await checkAPIHealth();
  
  // 2. Check Registered Devices
  console.log('\n2️⃣ Checking Registered Devices...');
  await checkRegisteredDevices();
  
  // 3. Check Notification History
  console.log('\n3️⃣ Checking Notification History...');
  await checkNotificationHistory();
  
  // 4. Test Send Notification
  console.log('\n4️⃣ Testing Notification Send...');
  await testSendNotification();
  
  // 5. Check Webhook Queue
  console.log('\n5️⃣ Checking Webhook Queue...');
  await checkWebhookQueue();
  
  console.log('\n✅ Status check complete!');
}

async function checkAPIHealth() {
  try {
    // Test authentication
    const response = await fetch(`${VERCEL_URL}/api/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`
      },
      body: JSON.stringify({ userId: 'health-check' })
    });

    if (response.ok) {
      console.log('  ✅ API is healthy and authenticated');
      const data = await response.json();
      console.log('  Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('  ❌ API authentication failed:', response.status);
      const error = await response.text();
      console.log('  Error:', error);
    }
  } catch (error) {
    console.log('  ❌ API is not reachable:', error.message);
  }
}

async function checkRegisteredDevices() {
  try {
    // Connect to Supabase to check push_tokens table
    const response = await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?select=*&is_active=eq.true`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (response.ok) {
      const tokens = await response.json();
      console.log(`  📱 Active devices registered: ${tokens.length}`);
      
      if (tokens.length > 0) {
        console.log('\n  Registered devices:');
        tokens.forEach((token, index) => {
          console.log(`    ${index + 1}. User: ${token.user_id}`);
          console.log(`       Platform: ${token.platform}`);
          console.log(`       Device ID: ${token.device_id}`);
          console.log(`       Last used: ${token.last_used_at || 'Never'}`);
          console.log(`       Token: ${token.token.substring(0, 20)}...`);
        });
      } else {
        console.log('  ⚠️  No devices registered yet');
        console.log('  💡 Devices register when users open the app and grant notification permissions');
      }
    } else {
      console.log('  ❌ Could not fetch registered devices');
    }
  } catch (error) {
    console.log('  ⚠️  Could not connect to Supabase. Update SUPABASE_ANON_KEY in this script.');
  }
}

async function checkNotificationHistory() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/notification_history?select=*&order=created_at.desc&limit=10`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (response.ok) {
      const history = await response.json();
      console.log(`  📨 Recent notifications: ${history.length}`);
      
      if (history.length > 0) {
        console.log('\n  Recent notifications:');
        history.forEach((notif, index) => {
          console.log(`    ${index + 1}. Type: ${notif.notification_type}`);
          console.log(`       User: ${notif.user_id}`);
          console.log(`       Status: ${notif.status}`);
          console.log(`       Sent: ${notif.created_at}`);
          if (notif.opened_at) {
            console.log(`       Opened: ${notif.opened_at}`);
          }
        });
      } else {
        console.log('  ⚠️  No notifications sent yet');
      }
    }
  } catch (error) {
    console.log('  ⚠️  Could not fetch notification history');
  }
}

async function testSendNotification() {
  try {
    console.log('  🚀 Attempting to send test notification...');
    
    const response = await fetch(`${VERCEL_URL}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET}`
      },
      body: JSON.stringify({
        userId: 'test-user-123', // Replace with actual user ID
        type: 'photo_liked',
        data: {
          eventName: 'System Test Event',
          likeCount: 5,
          photoId: 'test-photo-' + Date.now(),
          eventId: 'test-event-' + Date.now()
        }
      })
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log('  ✅ Test notification sent successfully!');
      console.log('  Result:', JSON.stringify(result, null, 2));
    } else {
      console.log('  ❌ Failed to send test notification');
      console.log('  Error:', JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.log('  ❌ Error sending test notification:', error.message);
  }
}

async function checkWebhookQueue() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/webhook_queue?select=*&order=created_at.desc&limit=10`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (response.ok) {
      const queue = await response.json();
      console.log(`  🔄 Webhook queue items: ${queue.length}`);
      
      if (queue.length > 0) {
        const pending = queue.filter(w => w.status === 'pending').length;
        const sent = queue.filter(w => w.status === 'sent').length;
        const failed = queue.filter(w => w.status === 'failed' || w.status === 'failed_permanent').length;
        
        console.log(`     Pending: ${pending}`);
        console.log(`     Sent: ${sent}`);
        console.log(`     Failed: ${failed}`);
      }
    }
  } catch (error) {
    console.log('  ⚠️  Webhook queue table may not exist yet');
  }
}

// Manual test functions
export async function testSpecificUser(userId) {
  console.log(`\n🧪 Testing notification for user: ${userId}`);
  
  const response = await fetch(`${VERCEL_URL}/api/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_SECRET}`
    },
    body: JSON.stringify({
      userId: userId,
      type: 'photo_liked',
      data: {
        eventName: 'Manual Test Event',
        likeCount: 10,
        photoId: 'manual-test-photo',
        eventId: 'manual-test-event'
      }
    })
  });

  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
  return result;
}

export async function registerTestDevice(userId, token, platform) {
  console.log(`\n📱 Registering test device for user: ${userId}`);
  
  const response = await fetch(`${VERCEL_URL}/api/register-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_SECRET}`
    },
    body: JSON.stringify({
      userId: userId,
      token: token,
      platform: platform,
      deviceId: `test-device-${Date.now()}`
    })
  });

  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
  return result;
}

export async function triggerProcessing() {
  console.log(`\n🔄 Triggering background processing...`);
  
  const response = await fetch(`${VERCEL_URL}/api/process-all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_SECRET}`
    },
    body: JSON.stringify({
      tasks: ['webhooks', 'queue', 'reminders']
    })
  });

  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
  return result;
}

// Run status check if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check for command line arguments
  const args = process.argv.slice(2);
  
  if (args[0] === 'test-user' && args[1]) {
    await testSpecificUser(args[1]);
  } else if (args[0] === 'register' && args[1] && args[2] && args[3]) {
    await registerTestDevice(args[1], args[2], args[3]);
  } else if (args[0] === 'process') {
    await triggerProcessing();
  } else {
    await checkSystemStatus();
    
    console.log('\n📖 Additional Commands:');
    console.log('  Test specific user:  node check-system-status.js test-user <userId>');
    console.log('  Register device:     node check-system-status.js register <userId> <token> <platform>');
    console.log('  Trigger processing:  node check-system-status.js process');
  }
}