-- ─────────────────────────────────────────────────────────────────────────────
-- OmniFlow Backend — Phase 2 Migration
-- Adds: predictions, strategies tables
-- Created: 2026-06-24
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable: predictions
CREATE TABLE "predictions" (
    "id"                  UUID             NOT NULL DEFAULT gen_random_uuid(),
    "userId"              UUID             NOT NULL,
    "purchaseProbability" DOUBLE PRECISION NOT NULL,
    "expectedOrderValue"  DOUBLE PRECISION NOT NULL,
    "ltv"                 DOUBLE PRECISION NOT NULL,
    "segment"             TEXT,
    "timestamp"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: strategies
CREATE TABLE "strategies" (
    "id"                UUID             NOT NULL DEFAULT gen_random_uuid(),
    "userId"            UUID             NOT NULL,
    "recommendedAction" JSONB            NOT NULL,
    "followUpTime"      TIMESTAMP(3),
    "applied"           BOOLEAN          NOT NULL DEFAULT false,
    "outcome"           TEXT,
    "timestamp"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "predictions_userId_idx"   ON "predictions"("userId");
CREATE INDEX "predictions_timestamp_idx" ON "predictions"("timestamp");
CREATE INDEX "strategies_userId_idx"    ON "strategies"("userId");
CREATE INDEX "strategies_timestamp_idx" ON "strategies"("timestamp");

-- AddForeignKey: predictions → users
ALTER TABLE "predictions"
    ADD CONSTRAINT "predictions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: strategies → users
ALTER TABLE "strategies"
    ADD CONSTRAINT "strategies_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
