# Configure Domain for ProduTime Licensing Server

## Current Situation

You have deployed to Railway, and you want to use: `nozomi.proxy.rlwy.net`

Railway generated a default URL like: `https://produtime-licensing-production-abc123.up.railway.app`

## Option 1: Use Railway's Generated Domain (Easiest)

This works immediately, no DNS configuration needed.

### Get your Railway URL:

```bash
cd licensing-server\api
railway domain
```

This will show something like:
```
https://produtime-licensing-production-abc123.up.railway.app
```

### Update your app to use this URL:

Edit: `src/shared/licensing-config.ts`

```typescript
export const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || "https://produtime-licensing-production-abc123.up.railway.app";
```

Then rebuild:
```bash
npm run build
npm run dist
```

### Test it:

```bash
curl https://produtime-licensing-production-abc123.up.railway.app/v1/public-key
```

Expected:
```json
{"publicKey":"yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="}
```

---

## Option 2: Use Custom Domain (nozomi.proxy.rlwy.net)

This requires DNS configuration.

### Step 1: Add Custom Domain in Railway

In the Railway dashboard OR via CLI:

#### Via Railway Dashboard:
1. Go to https://railway.app/dashboard
2. Select your `produtime-licensing` project
3. Click on your service
4. Go to **Settings** → **Networking** → **Domains**
5. Click **"Custom Domain"**
6. Enter: `nozomi.proxy.rlwy.net`
7. Railway will show you CNAME configuration

#### Via Railway CLI:

```bash
cd licensing-server\api
railway domain nozomi.proxy.rlwy.net
```

### Step 2: Configure DNS

Railway will provide you with a CNAME target like:
```
railway.app
```

Go to your DNS provider (where you registered `rlwy.net`) and add:

**CNAME Record:**
- **Type**: CNAME
- **Name**: `nozomi.proxy` (or just `nozomi.proxy` depending on your DNS provider)
- **Value**: `<railway-provided-cname>` (usually ends with `.railway.app`)
- **TTL**: 3600 (or Auto)

### Step 3: Wait for DNS Propagation

- DNS changes can take 5-60 minutes
- Railway will automatically provision SSL certificate
- Check status in Railway dashboard

### Step 4: Test

```bash
curl https://nozomi.proxy.rlwy.net/v1/public-key
```

Expected:
```json
{"publicKey":"yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="}
```

---

## Option 3: Quick Test - Use Railway URL Now, Custom Domain Later

**Right now:**
1. Get Railway's generated URL: `railway domain`
2. Test with that URL immediately
3. Create licenses, test the system

**Later:**
1. Configure custom domain `nozomi.proxy.rlwy.net`
2. Update app configuration
3. Rebuild installer

This way you can start testing the licensing system immediately!

---

## Current Status Check

Run this to see current status:

```bash
cd licensing-server\api

# Get your actual working URL
railway domain

# Test it
curl https://YOUR-RAILWAY-URL/v1/public-key

# Check deployment logs
railway logs

# Open admin portal in browser
railway open
```

---

## Recommended Approach

**For immediate testing:**

1. **Get Railway URL**:
   ```bash
   cd licensing-server\api
   railway domain
   ```

2. **Test server**:
   ```bash
   curl https://YOUR-RAILWAY-URL/v1/public-key
   ```

3. **Access admin portal**:
   ```
   https://YOUR-RAILWAY-URL/admin
   ```
   Login: `admin@produtime.local` / `ProduTime2026!Admin`

4. **Create a test license** and verify everything works

5. **Then** configure custom domain if needed

---

## What's Wrong with nozomi.proxy.rlwy.net Now?

The domain `nozomi.proxy.rlwy.net` returns 404 because:
- Either the service isn't deployed to that domain
- Or DNS isn't configured correctly
- Or Railway hasn't assigned the domain to your service

**Solution:** Use Railway's generated domain first, then configure custom domain later.

---

## Need the Railway URL Now?

Run this script:
```
GET_SERVER_URL.bat
```

Or manually:
```bash
cd licensing-server\api
railway domain
```

Copy the URL it shows and use that in your app configuration.
