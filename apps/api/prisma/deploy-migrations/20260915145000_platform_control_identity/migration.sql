CREATE TABLE "platform_operators" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL DEFAULT 0,
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_operators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_auth_sessions" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "actor_operator_id" TEXT,
    "action" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_operators_email_key" ON "platform_operators"("email");
CREATE INDEX "platform_auth_sessions_family_id_idx" ON "platform_auth_sessions"("family_id");
CREATE INDEX "platform_auth_sessions_operator_id_revoked_at_idx" ON "platform_auth_sessions"("operator_id", "revoked_at");
CREATE INDEX "platform_auth_sessions_refresh_expires_at_idx" ON "platform_auth_sessions"("refresh_expires_at");
CREATE INDEX "platform_audit_events_actor_operator_id_created_at_idx" ON "platform_audit_events"("actor_operator_id", "created_at");
CREATE INDEX "platform_audit_events_target_type_target_id_created_at_idx" ON "platform_audit_events"("target_type", "target_id", "created_at");
CREATE INDEX "platform_audit_events_action_created_at_idx" ON "platform_audit_events"("action", "created_at");

ALTER TABLE "platform_auth_sessions" ADD CONSTRAINT "platform_auth_sessions_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_operator_id_fkey"
  FOREIGN KEY ("actor_operator_id") REFERENCES "platform_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
