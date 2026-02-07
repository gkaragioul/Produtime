-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "wsEndpoint" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settings" TEXT,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "device_pub_key" TEXT NOT NULL,
    "paired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'offline',
    "app_version" VARCHAR(50),
    "ip" VARCHAR(45),
    "policy_id" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pair_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pair_codes_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "pair_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "device_pub_key" TEXT NOT NULL,
    "app_version" VARCHAR(50) NOT NULL,
    "os_info" VARCHAR(200) NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "pair_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "date_ymd" VARCHAR(10) NOT NULL,
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "idle_seconds" INTEGER NOT NULL DEFAULT 0,
    "untracked_seconds" INTEGER NOT NULL DEFAULT 0,
    "first_activity_ts" BIGINT,
    "last_activity_ts" BIGINT,
    "top_apps_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_logins" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_logins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "device_id" TEXT,
    "user_id" TEXT,
    "details" TEXT NOT NULL,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "tenants_wsEndpoint_key" ON "tenants"("wsEndpoint");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_apiKey_key" ON "tenants"("apiKey");

-- CreateIndex
CREATE INDEX "admin_users_email_idx" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_tenant_id_idx" ON "admin_users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_tenant_id_email_key" ON "admin_users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "devices_tenant_id_status_idx" ON "devices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "devices_tenant_id_idx" ON "devices"("tenant_id");

-- CreateIndex
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_device_id_key" ON "devices"("tenant_id", "device_id");

-- CreateIndex
CREATE INDEX "pair_codes_tenant_id_code_idx" ON "pair_codes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "pair_codes_tenant_id_idx" ON "pair_codes"("tenant_id");

-- CreateIndex
CREATE INDEX "pair_codes_expires_at_idx" ON "pair_codes"("expires_at");

-- CreateIndex
CREATE INDEX "pair_codes_created_at_idx" ON "pair_codes"("created_at");

-- CreateIndex
CREATE INDEX "pair_requests_tenant_id_status_idx" ON "pair_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "pair_requests_tenant_id_idx" ON "pair_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "pair_requests_expires_at_idx" ON "pair_requests"("expires_at");

-- CreateIndex
CREATE INDEX "pair_requests_created_at_idx" ON "pair_requests"("created_at");

-- CreateIndex
CREATE INDEX "daily_metrics_tenant_id_date_ymd_idx" ON "daily_metrics"("tenant_id", "date_ymd");

-- CreateIndex
CREATE INDEX "daily_metrics_tenant_id_idx" ON "daily_metrics"("tenant_id");

-- CreateIndex
CREATE INDEX "daily_metrics_created_at_idx" ON "daily_metrics"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_tenant_id_device_id_date_ymd_key" ON "daily_metrics"("tenant_id", "device_id", "date_ymd");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_key" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sessions_created_at_idx" ON "sessions"("created_at");

-- CreateIndex
CREATE INDEX "failed_logins_email_created_at_idx" ON "failed_logins"("email", "created_at");

-- CreateIndex
CREATE INDEX "failed_logins_ip_created_at_idx" ON "failed_logins"("ip", "created_at");

-- CreateIndex
CREATE INDEX "failed_logins_created_at_idx" ON "failed_logins"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_codes" ADD CONSTRAINT "pair_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_requests" ADD CONSTRAINT "pair_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "devices"("tenant_id", "device_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
