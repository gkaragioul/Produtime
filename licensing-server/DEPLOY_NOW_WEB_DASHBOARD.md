# Deploy API Service via Railway Web Dashboard - Step by Step

## Current Status
✅ PostgreSQL database is deployed and running
❌ API service needs to be added
🔑 Project ID: `925b1b9c-6fc0-4a19-8f80-aefca92f4ca7`

---

## Step-by-Step Deployment Instructions

### STEP 1: Open Your Railway Project

Click this link to open your project:
👉 **https://railway.com/project/925b1b9c-6fc0-4a19-8f80-aefca92f4ca7**

You should see:
- 📦 PostgreSQL (green/active)
- Nothing else yet

---

### STEP 2: Add New Service

1. Click the **"+ New"** button (top right area)
2. Select **"Empty Service"**
3. A new empty service card will appear

---

### STEP 3: Deploy Your Code

Click on the new empty service card, then:

1. Click **"Settings"** tab on the left
2. Scroll down to **"Source"**
3. Click **"Connect Repo"** button

**If you don't have GitHub repo yet:**

Run these commands in PowerShell to create one:

```powershell
cd "c:\Users\georg\Documents\Produtime\Produtime\licensing-server\api"

# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "ProduTime Licensing Server v1.8"

# Create GitHub repo using gh CLI
gh repo create produtime-licensing-server --private --source=. --push
```

**If `gh` command not found**, install GitHub CLI:
```powershell
winget install --id GitHub.cli
```

Or create repo manually at https://github.com/new and push:
```powershell
git remote add origin https://github.com/YOUR-USERNAME/produtime-licensing-server.git
git branch -M main
git push -u origin main
```

Then go back to Railway → Connect that repository.

---

### STEP 4: Configure Build Settings

Still in **Settings** tab:

1. **Root Directory**: Leave blank (or enter `.` if it asks)

2. **Build Command**:
   ```
   npm install && npx prisma generate
   ```

3. **Start Command**:
   ```
   npm start
   ```

4. Scroll down to **"Deploy Triggers"** - ensure "Enable Auto Deploy" is **ON**

---

### STEP 5: Set Environment Variables

1. Click **"Variables"** tab on the left
2. Click **"RAW Editor"** button
3. Paste this entire block:

```
ED25519_PRIVATE_KEY=29nD/vXDPy/eVmQBWSWeRrYUzxiZt5gftlap2WGHpIfIGkzqZVMFsb2PxKZCVAW9FaUvxN87Ae7NYQ7vOEfODA==
ED25519_PUBLIC_KEY=yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw=
JWT_SECRET=produtime-v18-jwt-secret-secure-random-string-2026
DEFAULT_ADMIN_EMAIL=admin@produtime.local
DEFAULT_ADMIN_PASSWORD=ProduTime2026!Admin
NODE_ENV=production
PORT=3000
```

4. Click **"Update Variables"**

---

### STEP 6: Link PostgreSQL Database

Still in **Variables** tab:

1. Click **"+ New Variable"** button
2. Select **"Add Reference"**
3. Choose your **PostgreSQL service**
4. Select **`DATABASE_URL`** from the dropdown
5. This will automatically connect your API to the database

---

### STEP 7: Deploy

Railway should auto-deploy once you connected the repo. If not:

1. Go back to service overview
2. Click **"Deploy"** button
3. Wait 2-5 minutes for build to complete

Watch the **"Deployments"** tab to see build logs.

---

### STEP 8: Generate Public Domain

Once deployment shows **"Active"** (green):

1. Click **"Settings"** tab
2. Scroll to **"Networking"** section
3. Click **"Generate Domain"** button

Railway will create a URL like:
`https://produtime-api-production-abc123.up.railway.app`

**Copy this URL** - you'll need it!

---

### STEP 9: Test Your API

Open PowerShell and test:

```powershell
# Test public key endpoint
curl https://YOUR-RAILWAY-URL/v1/public-key

# Should return:
# {"publicKey":"yBpM6mVTBbG9j8SmQlQFvRWlL8TfOwHuzWEO7zhHzgw="}
```

If that works, test admin login:

```powershell
$body = @{
    email = "admin@produtime.local"
    password = "ProduTime2026!Admin"
} | ConvertTo-Json

curl -Method POST -Uri "https://YOUR-RAILWAY-URL/v1/auth/login" -Body $body -ContentType "application/json"
```

Should return a JWT token.

---

### STEP 10: Access Admin Portal

Open in browser:
`https://YOUR-RAILWAY-URL/admin`

Login with:
- **Email**: `admin@produtime.local`
- **Password**: `ProduTime2026!Admin`

You should see the admin dashboard where you can create licenses!

---

### STEP 11: Update App Configuration

If your Railway URL is different from `https://nozomi.proxy.rlwy.net`, update the app:

1. Open: `c:\Users\georg\Documents\Produtime\Produtime\src\shared\licensing-config.ts`

2. Change line 18:
   ```typescript
   export const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || "https://YOUR-ACTUAL-RAILWAY-URL";
   ```

3. Rebuild the app:
   ```powershell
   cd "c:\Users\georg\Documents\Produtime\Produtime"
   npm run build
   npm run dist
   ```

---

## Alternative: Deploy via Railway CLI (If You Prefer Terminal)

If you'd rather use the command line:

```powershell
# Navigate to API folder
cd "c:\Users\georg\Documents\Produtime\Produtime\licensing-server\api"

# Login (opens browser)
railway login

# Deploy
railway up

# Get URL
railway domain
```

---

## Troubleshooting

### "Build Failed" in Railway

Check **Deployments** → **Build Logs** for errors. Common issues:
- Missing `package.json` dependencies
- `prisma generate` failed (DATABASE_URL not set)
- Node version mismatch

### "Application not found" (404)

- Service not deployed yet (check Deployments tab)
- No domain generated (go to Settings → Networking)
- Build still in progress (wait for green "Active" status)

### Can't Login to Admin Portal

- Check environment variables are set correctly
- Check database connection (DATABASE_URL reference added)
- Check deployment logs for errors

---

## What to Tell Me After Deployment

Once you complete the steps above, send me:

1. ✅ The Railway-generated URL (like `https://xxxxx.up.railway.app`)
2. ✅ Result of testing `/v1/public-key` endpoint
3. ✅ Whether you can access `/admin` portal
4. ✅ Any errors you encountered

Then I'll:
- Update the app configuration with your URL
- Help you test the complete licensing flow
- Create your first test license
- Verify activation works end-to-end

---

**You're 5 minutes away from having a fully deployed licensing server! 🚀**
