# Find Your Public Server URL

## Method 1: Railway Dashboard (Easiest)

You have the project URL:
https://railway.com/project/925b1b9c-6fc0-4a19-8f80-aefca92f4ca7

### Steps:

1. **Open that URL** in your browser
2. You'll see your project with services (PostgreSQL + your API service)
3. **Click on your API service** (not the database)
4. Look for the **"Deployments"** or **"Settings"** tab
5. In **Settings** → scroll to **"Networking"** or **"Domains"**
6. You should see a **public URL** like:
   ```
   https://web-production-xxxx.up.railway.app
   ```
   OR
   ```
   https://produtime-licensing-production.up.railway.app
   ```

7. **Copy that URL** - that's your server's public address!

## Method 2: Railway CLI

In PowerShell:

```powershell
cd c:\Users\georg\Documents\Produtime\Produtime\licensing-server\api
railway domain
```

This will output your public URL.

## Method 3: Check Deployment Logs

In the Railway dashboard:

1. Click on your API service
2. Go to **"Deployments"** tab
3. Click on the latest deployment (should show "SUCCESS" or "ACTIVE")
4. Look for logs that say:
   ```
   Server running on port 3000
   ```
5. The public URL should be shown in the deployment details

## What to Look For

Your public URL will be in one of these formats:

- `https://web-production-xxxx.up.railway.app`
- `https://produtime-api-production-xxxx.up.railway.app`
- `https://produtime-licensing-production-xxxx.up.railway.app`

## After You Find It

Once you have the URL, test it:

```bash
curl https://YOUR-URL/v1/public-key
```

Expected response:
```json
{"publicKey":"yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="}
```

Then access admin portal:
```
https://YOUR-URL/admin
```

## If No Public URL Exists

If you don't see any public URL in the dashboard:

1. Go to your service in Railway
2. Click **"Settings"**
3. Scroll to **"Networking"**
4. Click **"Generate Domain"**
5. Railway will create a public URL for you

## Still Can't Find It?

Take a screenshot of your Railway dashboard (the project view showing your services) and I can help you locate it.
