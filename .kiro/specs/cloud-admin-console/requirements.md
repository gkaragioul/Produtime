# Requirements Document

## Introduction

This document specifies the requirements for converting the ProduTime Admin Console from a local Electron application to a cloud-hosted web application. The goal is to enable managers to access the team dashboard from anywhere in the world while maintaining security, privacy, and multi-tenant isolation. Each company's ProduTime clients will connect to their own admin instance via a secure pairing mechanism over the internet.

## Glossary

- **Admin_Console**: The web-based management dashboard for viewing team productivity metrics
- **Client_App**: The ProduTime desktop application running on employee machines
- **Tenant**: A company/organization using ProduTime with their own isolated admin instance
- **Pairing_Service**: The cloud service that facilitates secure pairing between clients and admin instances
- **Pair_Code**: A 6-digit code used to initiate pairing between a client and admin instance
- **Tenant_ID**: A unique identifier for each company/organization
- **Admin_User**: A manager or administrator who accesses the Admin Console
- **Device**: An employee's computer running the Client App
- **Heartbeat**: Periodic status update sent from Client App to Admin Console
- **WebSocket_Connection**: Persistent bidirectional connection between Client App and Admin Console

## Requirements

### Requirement 1: Multi-Tenant Cloud Architecture

**User Story:** As a ProduTime operator, I want to deploy a multi-tenant cloud infrastructure, so that multiple companies can use the service with isolated data.

#### Acceptance Criteria

1. THE Admin_Console SHALL support multiple tenants with complete data isolation
2. WHEN a new tenant is created, THE System SHALL generate a unique Tenant_ID
3. THE System SHALL store each tenant's data in logically separated database schemas or with tenant_id foreign keys
4. WHEN a request is received, THE System SHALL validate the tenant context before processing
5. THE System SHALL deploy on Railway infrastructure using the existing deployment patterns

### Requirement 2: Admin User Authentication

**User Story:** As a manager, I want to securely log into my company's Admin Console, so that only authorized personnel can view team data.

#### Acceptance Criteria

1. WHEN an Admin_User attempts to login, THE System SHALL require email and password credentials
2. THE System SHALL hash passwords using bcrypt with minimum 12 rounds
3. WHEN login succeeds, THE System SHALL issue JWT access tokens (15 minute expiry) and refresh tokens (14 day expiry)
4. WHEN login fails 5 times within 15 minutes, THE System SHALL lock the account for 30 minutes
5. THE System SHALL require CAPTCHA verification on login when CAPTCHA_ENABLED is true
6. THE System SHALL rate limit login attempts to 5 per minute per IP and 20 per hour per IP
7. IF an invalid token is provided, THEN THE System SHALL return 401 Unauthorized without leaking token details

### Requirement 3: Cloud-Based Pairing Flow

**User Story:** As an employee, I want to pair my ProduTime client with my company's cloud admin console, so that my manager can see my productivity metrics.

#### Acceptance Criteria

1. WHEN an Admin_User generates a pair code, THE System SHALL create a 6-digit code valid for 5 minutes
2. THE Pair_Code SHALL be associated with the tenant and stored securely
3. WHEN a Client_App submits a pair request with a valid code, THE System SHALL create a pending pairing request
4. THE System SHALL rate limit pairing requests to 10 per minute per IP
5. THE System SHALL require CAPTCHA verification on pairing when CAPTCHA_ENABLED is true
6. WHEN an Admin_User approves a pairing request, THE System SHALL exchange cryptographic keys and establish trust
7. WHEN pairing is approved, THE Client_App SHALL receive the WebSocket endpoint URL for persistent connection
8. THE System SHALL display "Managed by [Company Name]" indicator on the Client_App when paired
9. IF a pair code is invalid or expired, THEN THE System SHALL return an error without revealing whether the code existed

### Requirement 4: Secure WebSocket Communication

**User Story:** As a system architect, I want secure real-time communication between clients and the cloud admin, so that metrics are transmitted safely.

#### Acceptance Criteria

1. THE System SHALL use WSS (WebSocket Secure) for all client-admin communication
2. WHEN a Client_App connects, THE System SHALL verify the device's Ed25519 signature
3. THE System SHALL reject connections from unpaired or revoked devices
4. WHEN a heartbeat is received, THE System SHALL validate the signature before processing
5. THE System SHALL terminate connections that fail signature verification
6. THE System SHALL implement connection rate limiting (max 100 connections per tenant)
7. WHEN a connection is idle for more than 2 minutes, THE System SHALL mark the device as offline

### Requirement 5: Dashboard Data API

**User Story:** As a manager, I want to view my team's productivity dashboard in a web browser, so that I can monitor progress from anywhere.

#### Acceptance Criteria

1. THE System SHALL expose REST API endpoints for dashboard data retrieval
2. WHEN requesting dashboard data, THE Admin_User SHALL provide a valid JWT token
3. THE System SHALL return only data belonging to the authenticated tenant
4. THE System SHALL support the existing dashboard modes: NO_DEVICES, NO_DATA_YET, PRE_SHIFT, IN_SHIFT_NO_ACTIVITY, NORMAL
5. THE System SHALL compute health scores, attention groups, and manager sentences server-side
6. THE System SHALL rate limit API requests to 60 per minute per authenticated user

### Requirement 6: Input Validation and Sanitization

**User Story:** As a security engineer, I want all inputs validated and sanitized, so that the system is protected from injection attacks.

#### Acceptance Criteria

1. THE System SHALL validate all request bodies using Zod schemas
2. THE System SHALL enforce character limits: names/titles max 100, notes max 500, descriptions max 2000, search max 200
3. THE System SHALL trim whitespace and reject control characters from all string inputs
4. THE System SHALL reject requests with unknown fields (strip unknown)
5. THE System SHALL limit JSON request body size to 1MB maximum
6. IF validation fails, THEN THE System SHALL return 400 with safe error message {"error":"VALIDATION_ERROR","message":"Invalid input"}

### Requirement 7: Safe Error Handling

**User Story:** As a security engineer, I want errors handled safely, so that sensitive information is never leaked to clients.

#### Acceptance Criteria

1. THE System SHALL use a global error handler middleware
2. WHEN an error occurs in production, THE System SHALL return generic error messages with safe codes
3. THE System SHALL never include stack traces, SQL queries, table names, or filesystem paths in responses
4. THE System SHALL log detailed errors server-side only with sanitized content
5. THE System SHALL map errors to standard codes: VALIDATION_ERROR (400), UNAUTHORIZED (401), FORBIDDEN (403), NOT_FOUND (404), RATE_LIMITED (429), SERVER_ERROR (500)

### Requirement 8: Database Cleanup and Hygiene

**User Story:** As a system administrator, I want automatic cleanup of old data, so that the database remains performant and compliant.

#### Acceptance Criteria

1. THE System SHALL run cleanup jobs at startup and daily at 03:00 local time
2. THE System SHALL delete records older than 30 days: server logs, expired sessions, old pairing codes, failed login attempts
3. THE System SHALL archive daily metrics while keeping only latest device status
4. THE System SHALL use indexed columns on created_at, ts, and expires_at for efficient cleanup
5. THE System SHALL log cleanup counts without logging sensitive details
6. THE Cleanup_Job SHALL be idempotent and safe to run multiple times

### Requirement 9: Privacy and Compliance

**User Story:** As a privacy officer, I want the system to respect employee privacy, so that we comply with workplace monitoring regulations.

#### Acceptance Criteria

1. THE System SHALL only transmit aggregated metrics by default (no raw window titles)
2. WHEN title sharing is disabled, THE System SHALL never transmit or store window titles
3. THE System SHALL display "Managed by [Admin Name]" indicator on paired clients at all times
4. THE System SHALL require explicit policy configuration to enable title sharing
5. THE System SHALL NOT capture keystrokes, screenshots, webcam, microphone, or message content
6. THE System SHALL allow employees to see what data is being shared via a transparency view

### Requirement 10: Tenant Onboarding

**User Story:** As a ProduTime operator, I want to onboard new companies easily, so that I can scale the service.

#### Acceptance Criteria

1. WHEN a new tenant is created, THE System SHALL generate unique API credentials
2. THE System SHALL create an initial admin user for the tenant
3. THE System SHALL provision isolated database resources for the tenant
4. THE System SHALL generate a unique WebSocket endpoint URL for the tenant
5. THE System SHALL send onboarding instructions to the tenant admin email

### Requirement 11: Client Discovery and Connection

**User Story:** As an employee, I want my ProduTime client to connect to the cloud admin automatically after pairing, so that I don't need to configure network settings.

#### Acceptance Criteria

1. WHEN pairing is approved, THE Client_App SHALL store the cloud WebSocket endpoint URL
2. WHEN the Client_App starts, THE System SHALL attempt to connect to the stored endpoint
3. IF connection fails, THEN THE Client_App SHALL retry with exponential backoff (max 10 attempts)
4. THE Client_App SHALL fall back to local-only mode if cloud connection is unavailable
5. WHEN reconnecting, THE Client_App SHALL re-authenticate using stored device credentials

### Requirement 12: Web Dashboard UI

**User Story:** As a manager, I want a responsive web dashboard, so that I can view team metrics on any device.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL be a React-based single-page application
2. THE Dashboard_UI SHALL display the same information as the current Electron dashboard
3. THE Dashboard_UI SHALL be responsive and work on desktop and tablet devices
4. THE Dashboard_UI SHALL show real-time updates via WebSocket subscription
5. THE Dashboard_UI SHALL handle authentication state and redirect to login when session expires
6. THE Dashboard_UI SHALL display loading states and error messages appropriately
