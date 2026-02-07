# Implementation Plan: Cloud Admin Console

## Overview

This implementation plan transforms the ProduTime Admin Console from a local Electron app to a cloud-hosted multi-tenant web application. The plan follows an incremental approach, building foundational infrastructure first, then adding features layer by layer.

## Tasks

- [x] 1. Set up cloud-admin-api project structure
  - Create `cloud-admin-api/` directory with Fastify + TypeScript setup
  - Initialize package.json with dependencies: fastify, @fastify/cors, @fastify/jwt, @fastify/rate-limit, @fastify/websocket, prisma, zod, bcrypt, tweetnacl
  - Create tsconfig.json matching existing project patterns
  - Create Dockerfile and railway.toml for Railway deployment
  - _Requirements: 1.5_

- [x] 2. Implement database schema and Prisma setup
  - [x] 2.1 Create Prisma schema with all models
    - Define Tenant, AdminUser, Device, PairCode, PairRequest models
    - Define DailyMetrics, Session, FailedLogin, AuditLog models
    - Add indexes on tenant_id, created_at, expires_at columns
    - _Requirements: 1.1, 1.3, 8.4_

  - [x] 2.2 Create database migrations
    - Generate initial migration
    - Add seed script for development tenant
    - _Requirements: 1.1_

- [x] 3. Implement validation middleware
  - [x] 3.1 Create Zod schemas for all request types
    - Define loginSchema, pairRequestSchema, tenantCreateSchema
    - Enforce character limits: names 100, notes 500, descriptions 2000
    - Add control character rejection regex
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 3.2 Write property test for input validation
    - **Property 18: Input Validation**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6**

  - [x] 3.3 Create validation middleware factory
    - Implement validateBody function that wraps Zod parsing
    - Strip unknown fields, return safe error messages
    - _Requirements: 6.4, 6.6_

- [x] 4. Implement safe error handling
  - [x] 4.1 Create global error handler middleware
    - Map error types to safe HTTP codes
    - Sanitize error messages (remove SQL, paths, stack traces)
    - Log detailed errors server-side only
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.2 Write property test for error response safety
    - **Property 19: Error Response Safety**
    - **Validates: Requirements 7.2, 7.3, 7.5**

- [x] 5. Implement rate limiting middleware
  - [x] 5.1 Configure rate limiters
    - Login: 5/min per IP, 20/hour per IP
    - Pairing: 10/min per IP
    - API: 60/min per authenticated user
    - _Requirements: 2.6, 3.4, 5.6_

  - [x] 5.2 Add Redis-backed rate limiter (optional for multi-node)
    - Create Redis connection config
    - Implement token bucket algorithm
    - _Requirements: 2.6_

- [x] 6. Checkpoint - Ensure middleware foundation works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement authentication service
  - [x] 7.1 Create auth service with login/logout
    - Implement password verification with bcrypt (12 rounds)
    - Generate JWT access tokens (15 min expiry)
    - Generate refresh tokens (14 day expiry)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 7.2 Write property test for password hashing
    - **Property 5: Password Hashing Security**
    - **Validates: Requirements 2.2**

  - [x] 7.3 Write property test for JWT token expiry
    - **Property 6: JWT Token Expiry Correctness**
    - **Validates: Requirements 2.3**

  - [x] 7.4 Implement account locking
    - Track failed login attempts per email
    - Lock account after 5 failures in 15 minutes
    - Auto-unlock after 30 minutes
    - _Requirements: 2.4_

  - [x] 7.5 Write property test for token error safety
    - **Property 8: Token Error Safety**
    - **Validates: Requirements 2.7**

  - [x] 7.6 Implement CAPTCHA verification (optional)
    - Add Cloudflare Turnstile or reCAPTCHA integration
    - Check CAPTCHA_ENABLED environment variable
    - _Requirements: 2.5_

  - [x] 7.7 Write property test for CAPTCHA enforcement
    - **Property 7: CAPTCHA Enforcement**
    - **Validates: Requirements 2.5, 3.5**

- [x] 8. Implement auth routes
  - [x] 8.1 Create POST /api/v1/auth/login endpoint
    - Validate request body with loginSchema
    - Call auth service login method
    - Return tokens on success
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 8.2 Create POST /api/v1/auth/refresh endpoint
    - Validate refresh token
    - Issue new access token
    - _Requirements: 2.3_

  - [x] 8.3 Create POST /api/v1/auth/logout endpoint
    - Invalidate refresh token
    - Clear session
    - _Requirements: 2.3_

  - [x] 8.4 Write property test for login credential requirement
    - **Property 4: Login Credential Requirement**
    - **Validates: Requirements 2.1**

- [x] 9. Checkpoint - Ensure authentication works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement tenant service
  - [x] 10.1 Create tenant service
    - Generate unique tenant ID (UUID)
    - Generate unique API key and WebSocket endpoint
    - Create initial admin user with temporary password
    - _Requirements: 1.2, 10.1, 10.2, 10.4_

  - [x] 10.2 Write property test for tenant ID uniqueness
    - **Property 2: Tenant ID Uniqueness**
    - **Validates: Requirements 1.2**

  - [x] 10.3 Write property test for tenant credential uniqueness
    - **Property 24: Tenant Credential Uniqueness**
    - **Validates: Requirements 10.1, 10.4**

  - [x] 10.4 Write property test for tenant admin creation
    - **Property 25: Tenant Admin Creation**
    - **Validates: Requirements 10.2**

- [x] 11. Implement tenant routes
  - [x] 11.1 Create POST /api/v1/tenants endpoint (operator only)
    - Validate request body
    - Call tenant service to create tenant
    - Return tenant details and credentials
    - _Requirements: 10.1, 10.2, 10.4_

  - [x] 11.2 Create GET /api/v1/tenants/:tenantId endpoint
    - Verify operator or tenant admin authorization
    - Return tenant details
    - _Requirements: 1.4_

  - [x] 11.3 Write property test for tenant context validation
    - **Property 3: Tenant Context Validation**
    - **Validates: Requirements 1.4**

- [x] 12. Implement pairing service
  - [x] 12.1 Create pair code generation
    - Generate 6-digit code
    - Set 5-minute expiry
    - Associate with tenant
    - _Requirements: 3.1, 3.2_

  - [x] 12.2 Write property test for pair code format and expiry
    - **Property 9: Pair Code Format and Expiry**
    - **Validates: Requirements 3.1**

  - [x] 12.3 Write property test for pair code tenant association
    - **Property 10: Pair Code Tenant Association**
    - **Validates: Requirements 3.2**

  - [x] 12.4 Create pair request submission
    - Validate pair code
    - Create pending request record
    - _Requirements: 3.3_

  - [x] 12.5 Write property test for pairing request creation
    - **Property 11: Pairing Request Creation**
    - **Validates: Requirements 3.3**

  - [x] 12.6 Create pair approval/denial
    - Exchange cryptographic keys on approval
    - Return WebSocket endpoint URL
    - _Requirements: 3.6, 3.7_

  - [x] 12.7 Write property test for key exchange on approval
    - **Property 12: Key Exchange on Approval**
    - **Validates: Requirements 3.6**

  - [x] 12.8 Write property test for WebSocket URL in approval
    - **Property 13: WebSocket URL in Approval**
    - **Validates: Requirements 3.7**

  - [x] 12.9 Implement pair code error uniformity
    - Return identical error for invalid/expired codes
    - Add constant-time comparison
    - _Requirements: 3.9_

  - [x] 12.10 Write property test for pair code error uniformity
    - **Property 14: Pair Code Error Uniformity**
    - **Validates: Requirements 3.9**

- [x] 13. Implement pairing routes
  - [x] 13.1 Create POST /api/v1/pairing/generate-code endpoint
    - Require admin authentication
    - Call pairing service to generate code
    - _Requirements: 3.1_

  - [x] 13.2 Create POST /api/v1/pairing/request endpoint
    - Validate request body with pairRequestSchema
    - Apply rate limiting and optional CAPTCHA
    - Call pairing service to submit request
    - _Requirements: 3.3, 3.4, 3.5_

  - [x] 13.3 Create POST /api/v1/pairing/approve/:requestId endpoint
    - Require admin authentication
    - Call pairing service to approve
    - _Requirements: 3.6_

  - [x] 13.4 Create POST /api/v1/pairing/deny/:requestId endpoint
    - Require admin authentication
    - Call pairing service to deny
    - _Requirements: 3.6_

  - [x] 13.5 Create GET /api/v1/pairing/pending endpoint
    - Require admin authentication
    - Return pending requests for tenant
    - _Requirements: 3.3_

- [x] 14. Checkpoint - Ensure pairing flow works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement WebSocket connection manager
  - [x] 15.1 Create WebSocket server setup
    - Configure @fastify/websocket
    - Create WSS /ws/client/:tenantId endpoint
    - Create WSS /ws/admin/:tenantId endpoint
    - _Requirements: 4.1_

  - [x] 15.2 Implement client connection handling
    - Verify device is paired and not revoked
    - Store connection in memory map
    - _Requirements: 4.3_

  - [x] 15.3 Write property test for unpaired device rejection
    - **Property 16: Unpaired Device Rejection**
    - **Validates: Requirements 4.3**

  - [x] 15.4 Implement signature verification
    - Verify Ed25519 signature on all messages
    - Terminate connection on verification failure
    - _Requirements: 4.2, 4.4, 4.5_

  - [x] 15.5 Write property test for signature verification
    - **Property 15: Signature Verification**
    - **Validates: Requirements 4.2, 4.4, 4.5**

  - [x] 15.6 Implement connection rate limiting
    - Track connections per tenant
    - Reject if over 100 connections
    - _Requirements: 4.6_

  - [x] 15.7 Implement stale connection cleanup
    - Mark device offline after 2 minutes idle
    - Close stale WebSocket connections
    - _Requirements: 4.7_

  - [x] 15.8 Implement admin subscription handling
    - Allow dashboard to subscribe to tenant events
    - Broadcast device status and metrics updates
    - _Requirements: 12.4_

- [x] 16. Implement dashboard service
  - [x] 16.1 Port dashboard computation logic
    - Copy determineDashboardMode function
    - Copy health score computation
    - Copy attention group computation
    - _Requirements: 5.4, 5.5_

  - [x] 16.2 Write property test for dashboard mode computation
    - **Property 17: Dashboard Mode Computation**
    - **Validates: Requirements 5.4**

  - [x] 16.3 Implement heartbeat ingestion
    - Update device status and metrics
    - Store daily metrics
    - Broadcast to admin subscribers
    - _Requirements: 5.5_

  - [x] 16.4 Add tenant isolation to all queries
    - Filter all queries by tenant_id
    - Verify tenant context before returning data
    - _Requirements: 1.1, 5.3_

  - [x] 16.5 Write property test for tenant data isolation
    - **Property 1: Tenant Data Isolation**
    - **Validates: Requirements 1.1, 5.3**

- [x] 17. Implement dashboard routes
  - [x] 17.1 Create GET /api/v1/dashboard/story endpoint
    - Require admin authentication
    - Return dashboard story for tenant
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 17.2 Create GET /api/v1/dashboard/attention endpoint
    - Require admin authentication
    - Return attention groups for tenant
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 17.3 Create GET /api/v1/dashboard/devices endpoint
    - Require admin authentication
    - Return device list for tenant
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 17.4 Create GET /api/v1/dashboard/trends endpoint
    - Require admin authentication
    - Return 7-day trends for tenant
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 17.5 Create GET /api/v1/dashboard/rankings endpoint
    - Require admin authentication
    - Return rankings for tenant
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 18. Checkpoint - Ensure dashboard API works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Implement cleanup service
  - [x] 19.1 Create cleanup job
    - Delete sessions older than 30 days
    - Delete pair codes older than 30 days
    - Delete failed logins older than 30 days
    - Archive old daily metrics
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 19.2 Write property test for cleanup removes old records
    - **Property 20: Cleanup Removes Old Records**
    - **Validates: Requirements 8.2**

  - [x] 19.3 Write property test for cleanup preserves latest status
    - **Property 21: Cleanup Preserves Latest Status**
    - **Validates: Requirements 8.3**

  - [x] 19.4 Write property test for cleanup idempotence
    - **Property 22: Cleanup Idempotence**
    - **Validates: Requirements 8.6**

  - [x] 19.5 Schedule cleanup job
    - Run at startup
    - Run daily at 03:00
    - Log counts only (no sensitive data)
    - _Requirements: 8.1, 8.5_

- [x] 20. Implement privacy controls
  - [x] 20.1 Add title sharing policy check
    - Verify title_sharing_enabled before including titles
    - Strip titles from heartbeat if disabled
    - _Requirements: 9.1, 9.2, 9.4_

  - [x] 20.2 Write property test for privacy - no titles by default
    - **Property 23: Privacy - No Titles by Default**
    - **Validates: Requirements 9.1, 9.2, 9.4**

- [x] 21. Checkpoint - Ensure backend is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Update ProduTime client for cloud pairing
  - [x] 22.1 Add cloud endpoint storage
    - Store WebSocket endpoint URL after pairing approval
    - Persist in agent_pairing table
    - _Requirements: 11.1_

  - [x] 22.2 Update connection logic
    - Connect to stored cloud endpoint on startup
    - Implement exponential backoff retry (max 10 attempts)
    - Fall back to local-only mode if unavailable
    - _Requirements: 11.2, 11.3, 11.4_

  - [x] 22.3 Update pairing flow
    - Support cloud-based pair code submission
    - Handle approval response with WebSocket URL
    - _Requirements: 3.3, 3.7_

  - [x] 22.4 Add "Managed by" indicator
    - Display company name when paired
    - Show indicator in system tray and main window
    - _Requirements: 3.8, 9.3_

- [x] 23. Create web dashboard UI
  - [x] 23.1 Set up React project
    - Create cloud-admin-web/ directory
    - Initialize with Vite + React + TypeScript
    - Add dependencies: react-router, axios, recharts
    - _Requirements: 12.1_

  - [x] 23.2 Implement authentication pages
    - Create login page with email/password form
    - Handle JWT token storage
    - Implement auto-redirect on session expiry
    - _Requirements: 12.5_

  - [x] 23.3 Port dashboard components
    - Copy TodayStoryPanel, AttentionPanel, TeamOverviewTable
    - Copy TrendChartPanel, RankingsPanel, TopAppsPanel
    - Adapt for REST API data fetching
    - _Requirements: 12.2_

  - [x] 23.4 Implement WebSocket subscription
    - Connect to WSS /ws/admin/:tenantId
    - Handle real-time updates
    - Update UI on device status changes
    - _Requirements: 12.4_

  - [x] 23.5 Add responsive styling
    - Ensure layout works on desktop and tablet
    - Add loading states and error messages
    - _Requirements: 12.3, 12.6_

  - [x] 23.6 Implement pairing management page
    - Show pending pairing requests
    - Allow approve/deny actions
    - Generate new pair codes
    - _Requirements: 3.1, 3.6_

- [x] 24. Final checkpoint - Full integration test
  - Ensure all tests pass, ask the user if questions arise.
  - Test full flow: tenant creation → admin login → pair code → client pairing → dashboard view

## Notes

- All tasks including property-based tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- The implementation reuses existing dashboard computation logic from the Electron app
- Railway deployment follows the same patterns as the licensing server
