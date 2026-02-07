# Add API Service to Your Railway Project (Web Dashboard)

## Current Status
✅ PostgreSQL database is deployed and online
❌ API service needs to be added

## Step-by-Step Guide

### Step 1: Add New Service

In your Railway dashboard (the screen you showed me):

1. Click the **"+ Create"** button (top right)
2. Select **"Empty Service"**
3. A new service card will appear

### Step 2: Configure the Service

Click on the new service card, then:

1. **Name the service**: Click on the name and rename to `produtime-api`

2. **Go to Settings tab**

3. **Set Root Directory** (if deploying from GitHub):
   - Leave blank if uploading just the API folder

4. **Set Build Command**:
   ```
   npm install && npx prisma generate
   ```

5. **Set Start Command**:
   ```
   npm start
   ```

### Step 3: Set Environment Variables

Click **"Variables"** tab, then click **"RAW Editor"** and paste:

```
ED25519_PRIVATE_KEY=29nD/vXDPy/eVmQBWSWeRrYUzxiZt5gftlap2WGHpIfIGkzqZVMFsb2PxKZCVAW9FaUvxN87Ae7NYQ7vOEfODA==
ED25519_PUBLIC_KEY=yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=
JWT_SECRET=produtime-v18-jwt-secret-secure-random-string-2026
DEFAULT_ADMIN_EMAIL=admin@produtime.local
DEFAULT_ADMIN_PASSWORD=ProduTime2026!Admin
NODE_ENV=production
PORT=3000
```

**IMPORTANT**: Also add the PostgreSQL connection:

Click "+ Reference" and select your **Postgres** service → This will add `DATABASE_URL` automatically

### Step 4: Deploy the Code

You have 3 options:

#### Option A: Via GitHub (Recommended)

1. Push your `licensing-server/api` folder to a GitHub repository
2. In Railway service → **"Settings"** → **"Source"**
3. Click **"Connect Repo"**
4. Select your repository
5. Set **Root Directory**: `licensing-server/api` (if the repo contains more than just the API)
6. Railway will auto-deploy

#### Option B: Via Railway CLI

Since you want me to use Railway CLI, you'll need to run:

```powershell
cd c:\Users\georg\Documents\Produtime\Produtime\licensing-server\api

# Login first (opens browser)
railway login

# Deploy
railway up
```

The `.railway-project.json` file I created will link it to your existing project automatically.

#### Option C: Create GitHub Repo Now

Let me help you create a GitHub repo and push the code there, then you can deploy from GitHub.

### Step 5: Generate Domain

Once the service is deployed:

1. Go to **"Settings"** → **"Networking"**
2. Click **"Generate Domain"**
3. Railway will create a URL like: `https://produtime-api-production.up.railway.app`

### Step 6: Test

```bash
curl https://YOUR-GENERATED-URL/v1/public-key
```

Expected:
```json
{"publicKey":"yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="}
```

---

## Which Option Do You Prefer?

1. **Railway CLI** - Fastest, but requires you to run `railway login` and `railway up`
2. **GitHub** - I can help you create a repo and push the code
3. **Manual in Dashboard** - Follow the steps above in the Railway web UI

Let me know which you'd like and I'll help you complete it!
