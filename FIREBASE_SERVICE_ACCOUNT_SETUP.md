# 🔑 Firebase Service Account Setup for FCM V1

## Step 1: Generate Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: `partysnap-16596`
3. Click the gear icon ⚙️ → **Project Settings**
4. Go to **Service Accounts** tab
5. Click **Generate New Private Key**
6. Click **Generate Key** in the confirmation dialog
7. Save the downloaded JSON file securely

## Step 2: Add to Vercel Environment Variables

1. Open the downloaded JSON file in a text editor
2. Copy the entire contents
3. Go to [Vercel Dashboard](https://vercel.com/dashboard)
4. Select your `partysnap-notification` project
5. Go to **Settings** → **Environment Variables**
6. Add new variable:
   - **Name**: `FIREBASE_SERVICE_ACCOUNT`
   - **Value**: Paste the entire JSON content
   - **Environment**: Select all (Production, Preview, Development)
7. Click **Save**

## Step 3: Alternative - Use Individual Environment Variables

If you prefer not to store the entire JSON, you can extract key values:

```bash
# Add these to Vercel:
FIREBASE_PROJECT_ID=partysnap-16596
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@partysnap-16596.iam.gserviceaccount.com
```

## Step 4: Update fcm-v1.js Configuration

The FCM V1 implementation will automatically use these environment variables:

```javascript
// Already configured in fcm-v1.js
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL
    };
```

## Step 5: Test the Configuration

Once deployed, test with the debug menu in your app:
1. Open the app
2. Tap the bug icon 🐛
3. Tap "Request Permissions & Get Token"
4. Check console logs for:
   - "Device token obtained: [token]"
   - "Type: FCM" (for Android)
5. Tap "Test with Device Token Directly"

## Security Notes

⚠️ **NEVER commit the service account JSON to your repository**
⚠️ **Keep the private key secure - it has full admin access**
⚠️ **Rotate keys periodically for security**

## Verification

After setup, your server logs should show:
- "Device token available for FCM V1 API" when tokens are registered
- "FCM V1 batch sent: X/Y successful" when sending notifications

## Troubleshooting

### Error: "The Application Default Credentials are not available"
- Make sure FIREBASE_SERVICE_ACCOUNT environment variable is set
- Verify the JSON is valid (no extra quotes or escaping issues)

### Error: "Permission 'cloudmessaging.messages.create' denied"
- The service account needs Firebase Cloud Messaging API enabled
- Go to Google Cloud Console → APIs → Enable "Firebase Cloud Messaging API"

### Error: "Invalid registration token"
- Device tokens are different from Expo tokens
- Only works with standalone/EAS builds, not Expo Go