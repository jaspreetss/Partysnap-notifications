import { supabase } from '../lib/supabase.js';

// Status dashboard endpoint
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Collect system status
    const status = {
      api: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production'
      },
      configuration: {
        firebase: !!process.env.FIREBASE_PROJECT_ID,
        apns: !!process.env.APNS_KEY_ID,
        supabase: !!process.env.SUPABASE_URL,
        apiKey: !!process.env.API_SECRET_KEY
      },
      database: {}
    };

    // Check database connectivity
    try {
      // Get registered devices count
      const { count: deviceCount } = await supabase
        .from('push_tokens')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      status.database.connected = true;
      status.database.activeDevices = deviceCount || 0;

      // Get notification history stats
      const { data: recentNotifications } = await supabase
        .from('notification_history')
        .select('notification_type, status')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (recentNotifications) {
        status.database.last24Hours = {
          total: recentNotifications.length,
          sent: recentNotifications.filter(n => n.status === 'sent').length,
          delivered: recentNotifications.filter(n => n.status === 'delivered').length,
          opened: recentNotifications.filter(n => n.status === 'opened').length
        };

        // Count by type
        const byType = {};
        recentNotifications.forEach(n => {
          byType[n.notification_type] = (byType[n.notification_type] || 0) + 1;
        });
        status.database.last24Hours.byType = byType;
      }

      // Check webhook queue
      const { count: pendingWebhooks } = await supabase
        .from('webhook_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      status.database.pendingWebhooks = pendingWebhooks || 0;

    } catch (dbError) {
      status.database.connected = false;
      status.database.error = dbError.message;
    }

    // Return HTML dashboard
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>PartySnap Notification Service Status</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #667eea;
      margin-bottom: 10px;
    }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 20px 0;
    }
    .status-card {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #e9ecef;
    }
    .status-card h3 {
      margin: 0 0 10px 0;
      color: #495057;
      font-size: 16px;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      margin: 5px 0;
    }
    .metric-value {
      font-weight: bold;
    }
    .status-indicator {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 5px;
    }
    .status-ok { background: #28a745; }
    .status-error { background: #dc3545; }
    .status-warning { background: #ffc107; }
    .config-status {
      display: flex;
      align-items: center;
      margin: 5px 0;
    }
    .refresh-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    }
    .refresh-btn:hover {
      background: #5a67d8;
    }
    .timestamp {
      color: #6c757d;
      font-size: 14px;
    }
    pre {
      background: #f8f9fa;
      padding: 10px;
      border-radius: 5px;
      overflow-x: auto;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 PartySnap Notification Service</h1>
    <p class="timestamp">Last updated: ${new Date().toLocaleString()}</p>
    
    <div class="status-grid">
      <div class="status-card">
        <h3>🌐 API Status</h3>
        <div class="config-status">
          <span class="status-indicator status-ok"></span>
          <span>Service is ${status.api.status}</span>
        </div>
        <div class="metric">
          <span>Environment:</span>
          <span class="metric-value">${status.api.environment}</span>
        </div>
      </div>

      <div class="status-card">
        <h3>⚙️ Configuration</h3>
        <div class="config-status">
          <span class="status-indicator ${status.configuration.firebase ? 'status-ok' : 'status-error'}"></span>
          <span>Firebase ${status.configuration.firebase ? '✓' : '✗'}</span>
        </div>
        <div class="config-status">
          <span class="status-indicator ${status.configuration.apns ? 'status-ok' : 'status-error'}"></span>
          <span>Apple Push ${status.configuration.apns ? '✓' : '✗'}</span>
        </div>
        <div class="config-status">
          <span class="status-indicator ${status.configuration.supabase ? 'status-ok' : 'status-error'}"></span>
          <span>Supabase ${status.configuration.supabase ? '✓' : '✗'}</span>
        </div>
        <div class="config-status">
          <span class="status-indicator ${status.configuration.apiKey ? 'status-ok' : 'status-error'}"></span>
          <span>API Key ${status.configuration.apiKey ? '✓' : '✗'}</span>
        </div>
      </div>

      <div class="status-card">
        <h3>📱 Registered Devices</h3>
        <div class="metric">
          <span>Active devices:</span>
          <span class="metric-value">${status.database.activeDevices || 0}</span>
        </div>
        ${status.database.pendingWebhooks !== undefined ? `
        <div class="metric">
          <span>Pending webhooks:</span>
          <span class="metric-value">${status.database.pendingWebhooks}</span>
        </div>
        ` : ''}
      </div>

      ${status.database.last24Hours ? `
      <div class="status-card">
        <h3>📊 Last 24 Hours</h3>
        <div class="metric">
          <span>Total sent:</span>
          <span class="metric-value">${status.database.last24Hours.total}</span>
        </div>
        <div class="metric">
          <span>Delivered:</span>
          <span class="metric-value">${status.database.last24Hours.delivered}</span>
        </div>
        <div class="metric">
          <span>Opened:</span>
          <span class="metric-value">${status.database.last24Hours.opened}</span>
        </div>
      </div>
      ` : ''}
    </div>

    ${status.database.last24Hours?.byType ? `
    <div class="status-card">
      <h3>📨 Notifications by Type (24h)</h3>
      ${Object.entries(status.database.last24Hours.byType).map(([type, count]) => `
        <div class="metric">
          <span>${type}:</span>
          <span class="metric-value">${count}</span>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <button class="refresh-btn" onclick="location.reload()">Refresh Status</button>

    <details style="margin-top: 20px;">
      <summary style="cursor: pointer; color: #667eea;">View Raw Status JSON</summary>
      <pre>${JSON.stringify(status, null, 2)}</pre>
    </details>
  </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);

  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}