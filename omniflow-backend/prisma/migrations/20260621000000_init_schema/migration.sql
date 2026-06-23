-- ─────────────────────────────────────────────────────────────────────────────
-- OmniFlow Backend — Initial Migration
-- Created: 2026-06-21
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('USER', 'BOT');

-- CreateTable: users
CREATE TABLE "users" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "businessId"   UUID         NOT NULL,
    "phoneNumber"  TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: conversations
CREATE TABLE "conversations" (
    "id"         UUID             NOT NULL DEFAULT gen_random_uuid(),
    "userId"     UUID             NOT NULL,
    "businessId" UUID             NOT NULL,
    "message"    TEXT             NOT NULL,
    "sender"     "MessageSender"  NOT NULL,
    "timestamp"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intent"     TEXT,
    "sentiment"  DOUBLE PRECISION,
    "urgency"    DOUBLE PRECISION,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: customer_profiles
CREATE TABLE "customer_profiles" (
    "userId"               UUID             NOT NULL,
    "budgetSensitivity"    DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "buyingFrequency"      DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "preferredProducts"    JSONB            NOT NULL DEFAULT '[]',
    "communicationStyle"   TEXT             NOT NULL DEFAULT 'neutral',
    "responseSpeed"        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lifetimeValue"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated"          TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");
CREATE INDEX "conversations_userId_idx"    ON "conversations"("userId");
CREATE INDEX "conversations_businessId_idx" ON "conversations"("businessId");
CREATE INDEX "conversations_timestamp_idx"  ON "conversations"("timestamp");

-- AddForeignKey: conversations → users
ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: customer_profiles → users
ALTER TABLE "customer_profiles"
    ADD CONSTRAINT "customer_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
