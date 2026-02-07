You are my AI IDE. Before writing any feature code, apply these **Security + Abuse-Prevention + Data Hygiene** requirements across the entire app (Admin Web/Console + API + any user-facing forms). Treat these as **acceptance criteria** and add tests.

# 0) Non-negotiables
- Add **input limits + validation** to every text field and API payload.
- Add **file upload restrictions** (type + size) everywhere uploads exist.
- Add **scheduled cleanup jobs** for database junk (logs/sessions/old records).
- Add **rate limiting + bot protection** on public endpoints (pairing requests, login, forms).
- Ensure **error messages never leak sensitive details** (SQL, stack traces, table names, server paths).
- Implement as shared utilities/middleware so it’s consistent.

# 1) Input boxes & forms: character limits + validation
## Frontend (React)
- For every input/textarea, set `maxLength` and show a live character counter where it matters.
  - Names/titles: max 100
  - Short notes: max 500
  - Descriptions (if any): max 2000
  - Search boxes: max 200
- Add client-side validation:
  - Required fields cannot be empty/whitespace-only.
  - Trim leading/trailing whitespace.
  - Reject control characters.
  - Strict type checks (numbers must be numbers, enums must match allowed values).
- Block submit button if invalid; show friendly messages.

## Backend (API)
- Validate ALL request bodies with a schema validator (prefer Zod or Joi).
- Enforce same limits server-side (never trust the client).
- Reject unknown fields (`stripUnknown` or equivalent) to prevent “weird stuff”.
- Use canonical normalization:
  - Trim strings
  - Convert empty strings to null where appropriate
- Return 400 with safe error messages like:
  - `{"error":"VALIDATION_ERROR","message":"Invalid input"}`

# 2) Image uploads: type + size + storage safety
- Only allow: **JPG/JPEG, PNG, WebP**
- File size limit: **max 5MB** (prefer 3MB default, configurable)
- Validate BOTH:
  - `Content-Type` header
  - Actual file signature (magic bytes) to prevent fake extensions
- Reject everything else with 415 (Unsupported Media Type) or 400.
- Always generate a safe server filename (UUID), never use user-provided filenames.
- If you generate thumbnails, do it asynchronously and with size bounds.
- If uploads exist at all, ensure:
  - No directory traversal
  - No public listing
  - Virus scan optional (note as TODO if out of scope)

# 3) Database hygiene: scheduled cleanup tasks
Implement scheduled cleanup jobs (cron or setInterval in the server main process) with safe batching:
- Delete after **30 days** (configurable):
  - old server logs
  - old audit logs (optional keep 90 days if needed)
  - expired sessions
  - old CSRF tokens (if any)
  - old pairing codes
  - failed login attempts / lockout entries
  - stale device heartbeats (keep latest status only; archive daily metrics)
- Use indexed columns on `created_at`, `ts`, `expires_at`.
- Run cleanup:
  - at startup (once)
  - then daily at 03:00 local time
- Ensure cleanup is idempotent and logs only counts (not sensitive details).

# 4) Rate limiting + bot protection
## Rate limiting (required)
Apply per-IP + per-identifier limits, with stricter limits on auth endpoints:
- POST /login: 5/min per IP + 20/hour per IP
- Pairing request endpoints: 10/min per IP
- Any public form submit: 30/min per IP
- Commands endpoints (admin-only): 60/min per admin user
Implement with:
- in-memory token bucket for MVP (works for single-node local server)
- if multi-node later: Redis-backed limiter (add TODO)

## Bot protection (recommended)
- Add Cloudflare Turnstile OR Google reCAPTCHA on:
  - login
  - pairing request (if it’s open on LAN)
  - any externally accessible form
- Provide an ENV toggle:
  - CAPTCHA_ENABLED=true/false
- Validate CAPTCHA server-side before accepting request.

# 5) Safe error handling (no leaks)
- Global error handler middleware:
  - In production: return generic message + error code.
  - In development: allow limited debugging but never return SQL or secrets.
- Never include:
  - stack traces
  - SQL queries
  - table names
  - filesystem paths
  - environment variables
- Log detailed errors server-side only (and sanitize logs).
- Map errors to safe codes:
  - VALIDATION_ERROR (400)
  - UNAUTHORIZED (401)
  - FORBIDDEN (403)
  - NOT_FOUND (404)
  - RATE_LIMITED (429)
  - SERVER_ERROR (500)

# 6) Implementation checklist (do it now)
1) Create shared validation helpers:
   - `src/server/validation.ts` (Zod schemas + parse helpers)
2) Add global middleware:
   - rate limiting
   - request size limits (JSON body max: 1MB)
   - safe error handler
3) Update every route to use schema validation.
4) Update frontend components:
   - add maxLength
   - add counters
   - add validation UX
5) Implement upload guard (if uploads exist):
   - file type + magic bytes + size limit
6) Implement cleanup scheduler:
   - `src/server/cleanup.ts` with daily job and startup run
7) Add tests:
   - validation rejects oversized inputs
   - upload rejects bad types and big files
   - rate limit triggers 429
   - errors don’t leak details

# 7) Acceptance criteria
- No text field accepts unbounded input (client + server).
- No upload accepts non-JPG/PNG/WebP or >5MB.
- Old records are automatically deleted after 30 days.
- Auth + pairing + forms are rate limited and optionally CAPTCHA protected.
- API never leaks sensitive error details.

Now implement these as a foundational layer, then refactor existing endpoints/components to use them everywhere.