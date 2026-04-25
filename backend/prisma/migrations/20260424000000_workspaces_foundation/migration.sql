-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('META', 'GOOGLE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "DedupStatus" AS ENUM ('SINGLE', 'BROWSER_ONLY', 'SERVER_ONLY', 'DEDUPLICATED');

-- CreateEnum
CREATE TYPE "AccountPlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE', 'MAGENTO', 'CUSTOM', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "WorkspaceIcon" AS ENUM ('SHOPPING_BAG', 'LIGHTNING', 'TARGET', 'ROCKET', 'LIGHTBULB', 'FIRE', 'LEAF', 'DIAMOND');

-- CreateEnum
CREATE TYPE "IndustryVertical" AS ENUM ('ECOMMERCE_FASHION', 'ECOMMERCE_BEAUTY', 'ECOMMERCE_HOME_DECOR', 'ECOMMERCE_FOOD_BEVERAGE', 'ECOMMERCE_HEALTH_WELLNESS', 'ECOMMERCE_ELECTRONICS', 'ECOMMERCE_BABY_KIDS', 'ECOMMERCE_PETS', 'ECOMMERCE_SPORTS_OUTDOORS', 'ECOMMERCE_JEWELRY', 'ECOMMERCE_AUTOMOTIVE', 'DTC_SUBSCRIPTION', 'AGENCY', 'MARKETPLACE', 'OTHER');

-- CreateEnum
CREATE TYPE "PrimaryFocus" AS ENUM ('FOUNDER_CEO', 'HEAD_OF_GROWTH', 'HEAD_OF_MARKETING', 'MARKETING_MANAGER', 'PERFORMANCE_MARKETER', 'ANALYTICS', 'AGENCY', 'ENGINEERING', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'FINALIZING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "RecordingOutcome" AS ENUM ('PURCHASED', 'ABANDONED', 'STILL_BROWSING');

-- CreateEnum
CREATE TYPE "SessionOutcome" AS ENUM ('PURCHASED', 'ABANDONED', 'BOUNCED', 'STILL_BROWSING');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "platform" "AccountPlatform" NOT NULL DEFAULT 'CUSTOM',
    "access_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_connections" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "access_token" TEXT NOT NULL,
    "pixel_id" TEXT,
    "ad_account_id" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_graph" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_key" TEXT NOT NULL,
    "customer_id" TEXT,
    "email_hash" TEXT,
    "phone_hash" TEXT,
    "ip_hash" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "fbclid" TEXT,
    "gclid" TEXT,
    "ttclid" TEXT,
    "fingerprint_hash" TEXT,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "identity_graph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_key" TEXT NOT NULL,
    "ga4_session_source" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "referrer" TEXT,
    "landing_page_url" TEXT,
    "ip_hash" TEXT,
    "fbclid" TEXT,
    "gclid" TEXT,
    "ttclid" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "is_first_touch" BOOLEAN NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_end_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clarity_session_id" TEXT,
    "clarity_playback_url" TEXT,
    "rrweb_recording_id" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_session_map" (
    "id" TEXT NOT NULL,
    "checkout_token" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_key" TEXT NOT NULL,
    "attribution_snapshot" JSONB NOT NULL,
    "event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_session_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_key" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "page_type" TEXT,
    "page_url" TEXT,
    "product_id" TEXT,
    "variant_id" TEXT,
    "cart_id" TEXT,
    "cart_value" DOUBLE PRECISION,
    "checkout_token" TEXT,
    "order_id" TEXT,
    "raw_source" TEXT,
    "match_type" TEXT,
    "confidence_score" DOUBLE PRECISION,
    "ip_hash" TEXT,
    "revenue" DOUBLE PRECISION,
    "currency" TEXT,
    "items" JSONB,
    "raw_payload" JSONB NOT NULL,
    "collected_at" TIMESTAMP(3),
    "browser_received_at" TIMESTAMP(3),
    "server_received_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3),
    "seq" INTEGER,
    "post_purchase" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "checkout_token" TEXT,
    "user_key" TEXT,
    "session_id" TEXT,
    "customer_id" TEXT,
    "email_hash" TEXT,
    "phone_hash" TEXT,
    "revenue" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount_total" DOUBLE PRECISION NOT NULL,
    "shipping_total" DOUBLE PRECISION NOT NULL,
    "tax_total" DOUBLE PRECISION NOT NULL,
    "refund_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chargeback_flag" BOOLEAN NOT NULL DEFAULT false,
    "orders_count" INTEGER,
    "currency" TEXT NOT NULL,
    "line_items" JSONB NOT NULL,
    "attributed_channel" TEXT,
    "attributed_campaign" TEXT,
    "attributed_adset" TEXT,
    "attributed_ad" TEXT,
    "attributed_click_id" TEXT,
    "attribution_model" TEXT NOT NULL DEFAULT 'last_touch',
    "attribution_snapshot" JSONB,
    "confidence_score" DOUBLE PRECISION,
    "event_id" TEXT,
    "capi_sent_meta" BOOLEAN NOT NULL DEFAULT false,
    "capi_sent_google" BOOLEAN NOT NULL DEFAULT false,
    "capi_sent_tiktok" BOOLEAN NOT NULL DEFAULT false,
    "capi_meta_response" JSONB,
    "capi_google_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform_created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_dedup" (
    "event_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "order_id" TEXT,
    "event_name" TEXT NOT NULL,
    "browser_received_at" TIMESTAMP(3),
    "server_received_at" TIMESTAMP(3),
    "capi_sent_at" TIMESTAMP(3),
    "dedup_status" "DedupStatus" NOT NULL,

    CONSTRAINT "event_dedup_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "merchant_snapshots" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_jobs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_recordings" (
    "id" TEXT NOT NULL,
    "recording_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_key" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL DEFAULT 'add_to_cart',
    "trigger_at" TIMESTAMP(3) NOT NULL,
    "cart_value" DOUBLE PRECISION,
    "checkout_token" TEXT,
    "attribution_snapshot" JSONB,
    "r2_key" TEXT,
    "r2_chunks_prefix" TEXT,
    "r2_bucket" TEXT,
    "duration_ms" INTEGER,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "last_chunk_at" TIMESTAMP(3),
    "size_bytes" BIGINT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "outcome" "RecordingOutcome",
    "outcome_at" TIMESTAMP(3),
    "order_id" TEXT,
    "device_type" TEXT,
    "behavioral_signals" JSONB,
    "raw_erased_at" TIMESTAMP(3),
    "masking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abandonment_risk_scores" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_key" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_factors" JSONB NOT NULL,
    "cart_value" DOUBLE PRECISION,
    "checkout_token" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abandonment_risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abandonment_cohorts" (
    "id" TEXT NOT NULL,
    "cohort_key" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "avg_cart_value" DOUBLE PRECISION,
    "common_signals" JSONB NOT NULL,
    "sample_recording_ids" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_range" JSONB NOT NULL,

    CONSTRAINT "abandonment_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_packets" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "visitor_id" TEXT,
    "person_id" TEXT,
    "start_ts" TIMESTAMP(3) NOT NULL,
    "end_ts" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "device" JSONB,
    "traffic_source" JSONB,
    "landing_page" TEXT,
    "keyframes" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "ecommerce_events" JSONB NOT NULL,
    "outcome" "SessionOutcome" NOT NULL DEFAULT 'STILL_BROWSING',
    "cart_value_at_end" DOUBLE PRECISION,
    "order_id" TEXT,
    "ai_analysis" JSONB,
    "ai_analyzed_at" TIMESTAMP(3),
    "raw_erased_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_packets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "visitor_ids" TEXT[],
    "email_hashes" TEXT[],
    "phone_hashes" TEXT[],
    "customer_ids" TEXT[],
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_analysis" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "tier" TEXT,
    "behavior_summary" TEXT,
    "conversion_probability" DOUBLE PRECISION,
    "preferred_channel" TEXT,
    "next_best_action" JSONB,
    "retention_insight" TEXT,
    "ltv_estimate" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "last_session_id" TEXT,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMirror" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "primaryFocus" "PrimaryFocus",
    "profilePhotoUrl" TEXT,
    "defaultWorkspaceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" "WorkspaceIcon" NOT NULL DEFAULT 'SHOPPING_BAG',
    "industryVertical" "IndustryVertical",
    "ownerUserId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'gratis',
    "stripeCustomerId" TEXT,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_account_id_key" ON "accounts"("account_id");

-- CreateIndex
CREATE INDEX "accounts_workspaceId_idx" ON "accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_connections_account_id_platform_key" ON "platform_connections"("account_id", "platform");

-- CreateIndex
CREATE INDEX "identity_graph_account_id_user_key_idx" ON "identity_graph"("account_id", "user_key");

-- CreateIndex
CREATE INDEX "identity_graph_account_id_fingerprint_hash_idx" ON "identity_graph"("account_id", "fingerprint_hash");

-- CreateIndex
CREATE INDEX "identity_graph_account_id_customer_id_idx" ON "identity_graph"("account_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_id_key" ON "sessions"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_session_map_checkout_token_key" ON "checkout_session_map"("checkout_token");

-- CreateIndex
CREATE UNIQUE INDEX "events_event_id_key" ON "events"("event_id");

-- CreateIndex
CREATE INDEX "events_account_id_session_id_captured_at_idx" ON "events"("account_id", "session_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_id_key" ON "orders"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_snapshots_account_id_key" ON "merchant_snapshots"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_recordings_recording_id_key" ON "session_recordings"("recording_id");

-- CreateIndex
CREATE INDEX "session_recordings_account_id_session_id_idx" ON "session_recordings"("account_id", "session_id");

-- CreateIndex
CREATE INDEX "session_recordings_account_id_status_idx" ON "session_recordings"("account_id", "status");

-- CreateIndex
CREATE INDEX "session_recordings_account_id_outcome_idx" ON "session_recordings"("account_id", "outcome");

-- CreateIndex
CREATE INDEX "session_recordings_account_id_user_key_idx" ON "session_recordings"("account_id", "user_key");

-- CreateIndex
CREATE UNIQUE INDEX "abandonment_risk_scores_session_id_key" ON "abandonment_risk_scores"("session_id");

-- CreateIndex
CREATE INDEX "abandonment_risk_scores_account_id_risk_score_idx" ON "abandonment_risk_scores"("account_id", "risk_score");

-- CreateIndex
CREATE INDEX "abandonment_risk_scores_account_id_computed_at_idx" ON "abandonment_risk_scores"("account_id", "computed_at");

-- CreateIndex
CREATE INDEX "abandonment_cohorts_account_id_computed_at_idx" ON "abandonment_cohorts"("account_id", "computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "abandonment_cohorts_account_id_cohort_key_key" ON "abandonment_cohorts"("account_id", "cohort_key");

-- CreateIndex
CREATE UNIQUE INDEX "session_packets_session_id_key" ON "session_packets"("session_id");

-- CreateIndex
CREATE INDEX "session_packets_account_id_person_id_idx" ON "session_packets"("account_id", "person_id");

-- CreateIndex
CREATE INDEX "session_packets_account_id_start_ts_idx" ON "session_packets"("account_id", "start_ts");

-- CreateIndex
CREATE INDEX "session_packets_account_id_outcome_idx" ON "session_packets"("account_id", "outcome");

-- CreateIndex
CREATE INDEX "session_packets_account_id_order_id_idx" ON "session_packets"("account_id", "order_id");

-- CreateIndex
CREATE INDEX "people_account_id_idx" ON "people"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_analysis_person_id_key" ON "person_analysis"("person_id");

-- CreateIndex
CREATE INDEX "person_analysis_account_id_idx" ON "person_analysis"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserMirror_email_key" ON "UserMirror"("email");

-- CreateIndex
CREATE INDEX "UserMirror_email_idx" ON "UserMirror"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerUserId_idx" ON "Workspace"("ownerUserId");

-- CreateIndex
CREATE INDEX "Workspace_deletedAt_idx" ON "Workspace"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_email_idx" ON "WorkspaceInvitation"("email");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_workspaceId_idx" ON "WorkspaceInvitation"("workspaceId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_graph" ADD CONSTRAINT "identity_graph_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_session_map" ADD CONSTRAINT "checkout_session_map_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_snapshots" ADD CONSTRAINT "merchant_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abandonment_risk_scores" ADD CONSTRAINT "abandonment_risk_scores_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abandonment_cohorts" ADD CONSTRAINT "abandonment_cohorts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_packets" ADD CONSTRAINT "session_packets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_analysis" ADD CONSTRAINT "person_analysis_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMirror" ADD CONSTRAINT "UserMirror_defaultWorkspaceId_fkey" FOREIGN KEY ("defaultWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "UserMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
