# ProduTime Licensing Server

Production licensing server for ProduTime v1.8+

## Quick Start (Local Development)

### 1. Generate Ed25519 Keypair

```bash
cd api
npm install
npm run keygen
```

Copy the output and add to `.env` file.

### 2. Create .env file

```bash
cp api/.env.example api/.env
```

Edit `.env` and add your Ed25519 keys.

### 3. Start with Docker Compose

```bash
docker-compose up -d
```

This starts:
- PostgreSQL database on port 5432
- API server on port 3000

### 4. Run database migrations

```bash
cd api
npx prisma migrate dev
```

### 5. Test the server

```bash
curl http://localhost:3000/health
```

## API Endpoints

### Authentication
- `POST /v1/auth/login` - Admin login
- `POST /v1/auth/refresh` - Refresh access token
- `POST /v1/auth/logout` - Logout

### License Management (Admin Only)
- `POST /v1/licenses` - Create license
- `GET /v1/licenses` - List licenses
- `GET /v1/licenses/:id` - Get license details
- `POST /v1/licenses/:id/keys` - Generate license key
- `POST /v1/revoke` - Revoke license or machine
- `GET /v1/licenses/:id/audit` - Get audit logs

### App-Facing (Public)
- `POST /v1/activate` - Activate license
- `POST /v1/heartbeat` - Check license status
- `GET /v1/public-key` - Get Ed25519 public key

## Deployment to Railway

### 1. Create Railway Project

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init
```

### 2. Add PostgreSQL Database

In Railway dashboard:
1. Click "New" → "Database" → "PostgreSQL"
2. Copy the `DATABASE_URL`

### 3. Set Environment Variables

```bash
railway variables set ADMIN_JWT_SECRET="$(openssl rand -base64 32)"
railway variables set ADMIN_REFRESH_SECRET="$(openssl rand -base64 32)"
railway variables set ED25519_PRIVATE_KEY="<your-private-key>"
railway variables set ED25519_PUBLIC_KEY="<your-public-key>"
railway variables set CORS_ORIGIN="https://admin.yourapp.com"
railway variables set NODE_ENV="production"
```

### 4. Deploy

```bash
cd api
railway up
```

### 5. Run migrations on Railway

```bash
railway run npx prisma migrate deploy
```

## Common Tasks

### Create a License

```bash
curl -X POST http://localhost:3000/v1/licenses \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Acme Corp",
    "seats": 1,
    "expiryDate": "2027-12-31T23:59:59Z",
    "notes": "Annual license"
  }'
```

### Generate License Key

```bash
curl -X POST http://localhost:3000/v1/licenses/<license-id>/keys \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Machine 1"
  }'
```

### Test Activation

```bash
curl -X POST http://localhost:3000/v1/activate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "PT1-...",
    "machineHash": "abc123...",
    "appVersion": "1.8.0"
  }'
```

## Database Schema

- **admins** - Admin users for portal
- **refresh_tokens** - JWT refresh tokens
- **licenses** - License records
- **license_keys** - Generated license keys (hashed)
- **machines** - Activated machines
- **activations** - Activation certificates
- **audit_logs** - All actions logged

## Security

- All admin passwords hashed with bcrypt (12 rounds)
- JWT access tokens (15m expiry)
- JWT refresh tokens (14d expiry, revocable)
- License keys stored as SHA-256 hashes
- Ed25519 signatures on all certs and responses
- Rate limiting on all endpoints
- Stricter rate limiting on activation (10/hour)
- HTTPS required in production

## Troubleshooting

### Database connection failed
Check `DATABASE_URL` environment variable and ensure PostgreSQL is running.

### Invalid signature errors
Ensure `ED25519_PRIVATE_KEY` and `ED25519_PUBLIC_KEY` match in both server and app.

### Rate limit exceeded
Wait for the rate limit window to reset, or adjust limits in `.env`.

## Development

### Watch mode

```bash
cd api
npm run dev
```

### View database

```bash
npx prisma studio
```

### Run tests

```bash
npm test
```

## License

Proprietary - ProduTime Licensing System
