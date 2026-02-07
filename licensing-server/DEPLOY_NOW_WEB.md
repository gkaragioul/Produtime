# 🚀 Deploy ProduTime Licensing Server NOW - Web Dashboard Method

## Quick Start (5 minutes)

### Step 1: Go to Railway
👉 **Open**: https://railway.app/dashboard

### Step 2: Create New Project
1. Click **"New Project"**
2. Select **"Empty Project"**
3. Name it: **"produtime-licensing"**

### Step 3: Add PostgreSQL Database
1. Click **"+ New"** button
2. Select **"Database"**
3. Choose **"Add PostgreSQL"**
4. Wait 30 seconds for provisioning

### Step 4: Add Node.js Service
1. Click **"+ New"** button
2. Select **"Empty Service"**
3. Click on the new service card

### Step 5: Configure Service Settings
Click **"Settings"** tab in your service:

**Service Name**: `produtime-api`

**Root Directory**: Leave blank (we'll upload the api folder)

**Build Command**:
```
npm install && npx prisma generate
```

**Start Command**:
```
npm start
```

### Step 6: Set Environment Variables

Click **"Variables"** tab, then click **"+ New Variable"**

Copy and paste these ONE BY ONE (or use RAW Editor):

#### Variable 1: ED25519_PRIVATE_KEY
```
29nD/vXDPy/eVmQBWSWeRrYUzxiZt5gftlap2WGHpIfIGkzqZVMFsb2PxKZCVAW9FaUvxN87Ae7NYQ7vOEfODA==
```

#### Variable 2: ED25519_PUBLIC_KEY
```
yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=
```

#### Variable 3: JWT_SECRET
```
produtime-v18-jwt-secret-secure-random-string-2026
```

#### Variable 4: DEFAULT_ADMIN_EMAIL
```
admin@produtime.local
```

#### Variable 5: DEFAULT_ADMIN_PASSWORD
```
ProduTime2026!Admin
```

#### Variable 6: NODE_ENV
```
production
```

#### Variable 7: PORT
```
3000
```

**OR use RAW Editor** (faster):
Click "RAW Editor" and paste all at once:
```
ED25519_PRIVATE_KEY=29nD/vXDPy/eVmQBWSWeRrYUzxiZt5gftlap2WGHpIfIGkzqZVMFsb2PxKZCVAW9FaUvxN87Ae7NYQ7vOEfODA==
ED25519_PUBLIC_KEY=yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=
JWT_SECRET=produtime-v18-jwt-secret-secure-random-string-2026
DEFAULT_ADMIN_EMAIL=admin@produtime.local
DEFAULT_ADMIN_PASSWORD=ProduTime2026!Admin
NODE_ENV=production
PORT=3000
```

**IMPORTANT**: Railway automatically adds `DATABASE_URL` when you added PostgreSQL. Don't touch it!

### Step 7: Deploy the Code

#### Option A: Upload via CLI (Recommended)
In PowerShell in the `licensing-server/api` folder:
```powershell
railway login
railway link  # Select your project
railway up
```

#### Option B: GitHub Integration
1. Push the `licensing-server/api` folder to a GitHub repo
2. In Railway service settings → **"Source"** → **"Connect Repo"**
3. Select your repo
4. Set **Root Directory**: `licensing-server/api`

#### Option C: Manual Upload (if CLI doesn't work)
Unfortunately Railway doesn't support drag-and-drop. You MUST use CLI or GitHub.

**Easiest CLI deployment:**
```powershell
# In licensing-server/api folder
railway login
railway link
railway up
```

### Step 8: Configure Domain
1. Click **"Settings"** in your service
2. Scroll to **"Networking"**
3. Click **"Generate Domain"**
4. You'll get: `https://produtime-api-production-xxxx.up.railway.app`

**OR use custom domain** `nozomi.proxy.rlwy.net`:
1. Click **"Custom Domain"**
2. Enter: `nozomi.proxy.rlwy.net`
3. Add the CNAME record to your DNS:
   - Type: `CNAME`
   - Name: `nozomi.proxy.rlwy.net`
   - Value: (Railway will show you)

### Step 9: Wait for Deployment
- Click **"Deployments"** tab
- Watch the build logs
- Wait for **"SUCCESS"** ✅ (2-5 minutes)

### Step 10: Test Your Server

Once deployed, test these endpoints:

#### Test 1: Public Key
```bash
curl https://YOUR-DOMAIN.up.railway.app/v1/public-key
```

Expected:
```json
{"publicKey":"yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="}
```

#### Test 2: Admin Login
```bash
curl -X POST https://YOUR-DOMAIN.up.railway.app/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@produtime.local","password":"ProduTime2026!Admin"}'
```

Expected: Returns `accessToken` and `refreshToken`

#### Test 3: Admin Portal
Open in browser:
```
https://YOUR-DOMAIN.up.railway.app/admin
```

Login:
- Email: `admin@produtime.local`
- Password: `ProduTime2026!Admin`

---

## 🎯 FASTEST METHOD: Use Railway CLI

Since Railway CLI is already installed, just run these 3 commands:

```powershell
cd c:\Users\georg\Documents\Produtime\Produtime\licensing-server\api

# 1. Login (opens browser)
railway login

# 2. Link to project (creates new if needed)
railway init

# 3. Deploy!
railway up
```

That's it! Railway CLI handles everything else automatically.

After `railway up` completes:

```powershell
# Get your URL
railway domain

# Test it
curl https://YOUR-URL/v1/public-key

# Open admin portal
railway open
```

---

## ✅ Success Checklist

After deployment:
- [ ] Server responds at `/v1/public-key`
- [ ] Admin portal loads at `/admin`
- [ ] Can login to admin portal
- [ ] PostgreSQL is connected (check logs)
- [ ] All 7 environment variables are set

---

## 🆘 Troubleshooting

### Build fails with "Prisma not found"
Add to build command:
```
npm install && npx prisma generate && npm run build
```

### "Cannot connect to database"
Check that:
1. PostgreSQL service is running
2. `DATABASE_URL` variable exists (auto-set by Railway)
3. Both services are in the same project

### "Port 3000 already in use"
Railway sets `PORT` automatically. Remove your `PORT` variable and Railway will use its own.

### Admin login fails
Check deployment logs:
```
railway logs
```
Look for "Default admin created" message

---

## 📋 After Deployment

1. **Save your URL**: Write down your Railway URL
2. **Test admin portal**: Create a test license
3. **Update app config**: If URL changed, update `src/shared/licensing-config.ts`
4. **Change admin password**: In admin portal settings
5. **Create first real license**: For yourself or a customer

---

**Need help?** Check Railway logs:
```
railway logs
```

**Redeploy anytime:**
```
railway up
```

🎉 **Your server is ready to license ProduTime apps!**
