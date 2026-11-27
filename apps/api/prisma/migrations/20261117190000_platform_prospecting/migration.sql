-- CreateTable
CREATE TABLE "platform_prospects" (
    "id" TEXT NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "source_snapshot_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "assigned_operator_id" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_business_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_delivered_at" TIMESTAMP(3),
    "last_reply_at" TIMESTAMP(3),
    "last_reply_preview" TEXT,
    "converted_at" TIMESTAMP(3),
    "pii_discarded_at" TIMESTAMP(3),
    "retention_hold_reason" TEXT,
    "retention_authorization_ref" TEXT,

    CONSTRAINT "platform_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_prospect_sender_bindings" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'zyon_platform',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "app_id" TEXT NOT NULL,
    "waba_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "display_phone_number" TEXT NOT NULL,
    "encrypted_credentials" TEXT NOT NULL,
    "authorization_version" INTEGER NOT NULL DEFAULT 1,
    "granted_assets" JSONB NOT NULL,
    "connected_by" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "health" JSONB,
    "health_updated_at" TIMESTAMP(3),

    CONSTRAINT "platform_prospect_sender_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_sender_signup_states" (
    "id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_sender_signup_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_endpoints" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "normalized_value" TEXT,
    "protected_lookup" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "sender_binding_id" TEXT NOT NULL,
    "timezone" TEXT,
    "timezone_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_contact_bindings" (
    "prospect_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "confirmation_state" TEXT NOT NULL DEFAULT 'unconfirmed',
    "evidence_ref" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_contact_bindings_pkey" PRIMARY KEY ("prospect_id","endpoint_id")
);

-- CreateTable
CREATE TABLE "contact_permission_receipts" (
    "id" TEXT NOT NULL,
    "sender_binding_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence_ref" TEXT,
    "text_version" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_permission_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_suppressions" (
    "id" TEXT NOT NULL,
    "sender_scope" TEXT NOT NULL,
    "protected_lookup" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_prospect_segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter_json" JSONB NOT NULL,
    "filter_version" INTEGER NOT NULL DEFAULT 1,
    "owner_operator_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_prospect_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "audience_hash" TEXT,
    "content_hash" TEXT,
    "selection_id" TEXT,
    "segment_id" TEXT,
    "segment_version" INTEGER,
    "filter_snapshot" JSONB,
    "message" TEXT NOT NULL,
    "offer_snapshot" JSONB,
    "sender_binding_id" TEXT,
    "sender_version" INTEGER,
    "template" JSONB,
    "daily_recipient_limit" INTEGER,
    "budget_cents" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "send_window" JSONB NOT NULL,
    "approved_revision" INTEGER,
    "approved_hash" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "reserved_cents" BIGINT NOT NULL DEFAULT 0,
    "spent_cents" BIGINT NOT NULL DEFAULT 0,
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_campaign_daily_usage" (
    "campaign_id" TEXT NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "reserved_recipients" INTEGER NOT NULL DEFAULT 0,
    "submitted_recipients" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "prospect_campaign_daily_usage_pkey" PRIMARY KEY ("campaign_id","day")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "sequence_key" TEXT NOT NULL,
    "eligibility" TEXT NOT NULL DEFAULT 'no_opt_in',
    "frozen_snapshot" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_sequences" (
    "id" TEXT NOT NULL,
    "sender_binding_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "first_attempt_id" TEXT,
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'active',
    "delivered_at" TIMESTAMP(3),
    "follow_up_due_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_attempts" (
    "id" TEXT NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "recipient_id" TEXT,
    "conversation_id" TEXT,
    "ordinal" INTEGER NOT NULL,
    "client_request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'prepared',
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "control_epoch" INTEGER NOT NULL DEFAULT 0,
    "approved_revision" INTEGER,
    "sender_version" INTEGER NOT NULL,
    "reserved_amount" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "cost_state" TEXT NOT NULL DEFAULT 'reserved',
    "provider_message_id" TEXT,
    "content" TEXT,
    "submitted_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_outbox" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_inbox_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "sender_binding_id" TEXT NOT NULL,
    "event_kind" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "provider_occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMP(3),
    "error_code" TEXT,

    CONSTRAINT "prospect_inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_conversations" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "prospect_id" TEXT,
    "ambiguous_bindings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" TEXT NOT NULL DEFAULT 'ai',
    "assigned_operator_id" TEXT,
    "control_epoch" INTEGER NOT NULL DEFAULT 0,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "last_inbound_at" TIMESTAMP(3),
    "last_inbound_event_id" TEXT,
    "last_inbound_preview" TEXT,
    "service_window_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_binding_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" TEXT,
    "provider_id" TEXT,
    "attempt_id" TEXT,
    "direction" TEXT NOT NULL,
    "content" TEXT,
    "state" TEXT NOT NULL,
    "provider_occurred_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_notes" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "content" TEXT,
    "client_request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_reads" (
    "conversation_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "read_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_reads_pkey" PRIMARY KEY ("conversation_id","operator_id")
);

-- CreateTable
CREATE TABLE "sales_knowledge_publications" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'draft',
    "content_hash" TEXT NOT NULL,
    "projected_hash" TEXT,
    "projected_count" INTEGER,
    "published_by" TEXT,
    "published_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_knowledge_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_knowledge_active_publications" (
    "source_id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_knowledge_active_publications_pkey" PRIMARY KEY ("source_id")
);

-- CreateTable
CREATE TABLE "prospect_billing_proposals" (
    "id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "offer_version" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "bound_merchant_id" TEXT,
    "bound_user_id" TEXT,
    "bound_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "client_request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_billing_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_conversions" (
    "id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_commands" (
    "client_request_id" TEXT NOT NULL,
    "actor_operator_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_commands_pkey" PRIMARY KEY ("client_request_id")
);

-- CreateTable
CREATE TABLE "prospect_audit_events" (
    "id" TEXT NOT NULL,
    "actor_operator_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_version" INTEGER NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "details" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_prospects_cnpj_key" ON "platform_prospects"("cnpj");

-- CreateIndex
CREATE INDEX "platform_prospects_stage_created_at_id_idx" ON "platform_prospects"("stage", "created_at", "id");

-- CreateIndex
CREATE INDEX "platform_prospects_assigned_operator_id_stage_idx" ON "platform_prospects"("assigned_operator_id", "stage");

-- CreateIndex
CREATE INDEX "platform_prospects_last_business_activity_at_converted_at_idx" ON "platform_prospects"("last_business_activity_at", "converted_at");

-- CreateIndex
CREATE INDEX "platform_prospect_sender_bindings_phone_number_id_active_idx" ON "platform_prospect_sender_bindings"("phone_number_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "platform_prospect_sender_bindings_scope_version_key" ON "platform_prospect_sender_bindings"("scope", "version");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_sender_signup_states_state_hash_key" ON "prospect_sender_signup_states"("state_hash");

-- CreateIndex
CREATE INDEX "prospect_sender_signup_states_expires_at_idx" ON "prospect_sender_signup_states"("expires_at");

-- CreateIndex
CREATE INDEX "prospect_endpoints_protected_lookup_key_version_idx" ON "prospect_endpoints"("protected_lookup", "key_version");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_endpoints_sender_binding_id_channel_protected_look_key" ON "prospect_endpoints"("sender_binding_id", "channel", "protected_lookup", "key_version");

-- CreateIndex
CREATE INDEX "prospect_contact_bindings_endpoint_id_confirmation_state_idx" ON "prospect_contact_bindings"("endpoint_id", "confirmation_state");

-- CreateIndex
CREATE INDEX "contact_permission_receipts_sender_binding_id_endpoint_id_p_idx" ON "contact_permission_receipts"("sender_binding_id", "endpoint_id", "purpose", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "contact_suppressions_sender_scope_protected_lookup_key_vers_key" ON "contact_suppressions"("sender_scope", "protected_lookup", "key_version");

-- CreateIndex
CREATE INDEX "saved_prospect_segments_owner_operator_id_deleted_at_create_idx" ON "saved_prospect_segments"("owner_operator_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "prospect_campaigns_state_updated_at_idx" ON "prospect_campaigns"("state", "updated_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_state_id_idx" ON "campaign_recipients"("campaign_id", "state", "id");

-- CreateIndex
CREATE INDEX "campaign_recipients_sequence_key_idx" ON "campaign_recipients"("sequence_key");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_endpoint_id_key" ON "campaign_recipients"("campaign_id", "endpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_sequences_first_attempt_id_key" ON "prospect_sequences"("first_attempt_id");

-- CreateIndex
CREATE INDEX "prospect_sequences_state_follow_up_due_at_idx" ON "prospect_sequences"("state", "follow_up_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_sequences_sender_binding_id_endpoint_id_key" ON "prospect_sequences"("sender_binding_id", "endpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_attempts_client_request_id_key" ON "outreach_attempts"("client_request_id");

-- CreateIndex
CREATE INDEX "outreach_attempts_state_lease_expires_at_idx" ON "outreach_attempts"("state", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_attempts_sequence_id_ordinal_key" ON "outreach_attempts"("sequence_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_outbox_event_id_key" ON "prospect_outbox"("event_id");

-- CreateIndex
CREATE INDEX "prospect_outbox_state_available_at_id_idx" ON "prospect_outbox"("state", "available_at", "id");

-- CreateIndex
CREATE INDEX "prospect_inbox_events_state_received_at_id_idx" ON "prospect_inbox_events"("state", "received_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_inbox_events_sender_binding_id_event_kind_event_id_key" ON "prospect_inbox_events"("sender_binding_id", "event_kind", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_conversations_endpoint_id_key" ON "prospect_conversations"("endpoint_id");

-- CreateIndex
CREATE INDEX "prospect_conversations_assigned_operator_id_last_inbound_at_idx" ON "prospect_conversations"("assigned_operator_id", "last_inbound_at");

-- CreateIndex
CREATE INDEX "prospect_conversations_last_inbound_at_id_idx" ON "prospect_conversations"("last_inbound_at", "id");

-- CreateIndex
CREATE INDEX "prospect_messages_conversation_id_created_at_idx" ON "prospect_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_messages_conversation_id_sequence_key" ON "prospect_messages"("conversation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_messages_sender_binding_id_provider_id_key" ON "prospect_messages"("sender_binding_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_notes_client_request_id_key" ON "prospect_notes"("client_request_id");

-- CreateIndex
CREATE INDEX "prospect_notes_conversation_id_created_at_id_idx" ON "prospect_notes"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "sales_knowledge_publications_state_valid_from_valid_until_idx" ON "sales_knowledge_publications"("state", "valid_from", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "sales_knowledge_publications_source_id_version_key" ON "sales_knowledge_publications"("source_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "sales_knowledge_active_publications_publication_id_key" ON "sales_knowledge_active_publications"("publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_billing_proposals_nonce_hash_key" ON "prospect_billing_proposals"("nonce_hash");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_billing_proposals_client_request_id_key" ON "prospect_billing_proposals"("client_request_id");

-- CreateIndex
CREATE INDEX "prospect_billing_proposals_expires_at_idx" ON "prospect_billing_proposals"("expires_at");

-- CreateIndex
CREATE INDEX "prospect_conversions_prospect_id_occurred_at_idx" ON "prospect_conversions"("prospect_id", "occurred_at");

-- CreateIndex
CREATE INDEX "prospect_conversions_state_occurred_at_idx" ON "prospect_conversions"("state", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_conversions_provider_provider_event_id_key" ON "prospect_conversions"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "prospect_commands_actor_operator_id_created_at_idx" ON "prospect_commands"("actor_operator_id", "created_at");

-- CreateIndex
CREATE INDEX "prospect_audit_events_resource_type_resource_id_occurred_at_idx" ON "prospect_audit_events"("resource_type", "resource_id", "occurred_at");

-- CreateIndex
CREATE INDEX "prospect_audit_events_correlation_id_idx" ON "prospect_audit_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "platform_prospects" ADD CONSTRAINT "platform_prospects_assigned_operator_id_fkey" FOREIGN KEY ("assigned_operator_id") REFERENCES "platform_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_prospect_sender_bindings" ADD CONSTRAINT "platform_prospect_sender_bindings_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_endpoints" ADD CONSTRAINT "prospect_endpoints_sender_binding_id_fkey" FOREIGN KEY ("sender_binding_id") REFERENCES "platform_prospect_sender_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_contact_bindings" ADD CONSTRAINT "prospect_contact_bindings_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "platform_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_contact_bindings" ADD CONSTRAINT "prospect_contact_bindings_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "prospect_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_permission_receipts" ADD CONSTRAINT "contact_permission_receipts_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "prospect_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_prospect_segments" ADD CONSTRAINT "saved_prospect_segments_owner_operator_id_fkey" FOREIGN KEY ("owner_operator_id") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_campaigns" ADD CONSTRAINT "prospect_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_campaigns" ADD CONSTRAINT "prospect_campaigns_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_campaigns" ADD CONSTRAINT "prospect_campaigns_sender_binding_id_fkey" FOREIGN KEY ("sender_binding_id") REFERENCES "platform_prospect_sender_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_campaign_daily_usage" ADD CONSTRAINT "prospect_campaign_daily_usage_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "prospect_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "prospect_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "platform_prospects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "prospect_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_sequences" ADD CONSTRAINT "prospect_sequences_sender_binding_id_fkey" FOREIGN KEY ("sender_binding_id") REFERENCES "platform_prospect_sender_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_sequences" ADD CONSTRAINT "prospect_sequences_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "prospect_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "prospect_sequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "prospect_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_inbox_events" ADD CONSTRAINT "prospect_inbox_events_sender_binding_id_fkey" FOREIGN KEY ("sender_binding_id") REFERENCES "platform_prospect_sender_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_conversations" ADD CONSTRAINT "prospect_conversations_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "prospect_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_conversations" ADD CONSTRAINT "prospect_conversations_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "platform_prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_conversations" ADD CONSTRAINT "prospect_conversations_assigned_operator_id_fkey" FOREIGN KEY ("assigned_operator_id") REFERENCES "platform_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_messages" ADD CONSTRAINT "prospect_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "prospect_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_messages" ADD CONSTRAINT "prospect_messages_sender_binding_id_fkey" FOREIGN KEY ("sender_binding_id") REFERENCES "platform_prospect_sender_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_messages" ADD CONSTRAINT "prospect_messages_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "outreach_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_notes" ADD CONSTRAINT "prospect_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "prospect_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_notes" ADD CONSTRAINT "prospect_notes_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_reads" ADD CONSTRAINT "prospect_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "prospect_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_reads" ADD CONSTRAINT "prospect_reads_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_knowledge_publications" ADD CONSTRAINT "sales_knowledge_publications_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_billing_proposals" ADD CONSTRAINT "prospect_billing_proposals_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "platform_prospects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_conversions" ADD CONSTRAINT "prospect_conversions_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "platform_prospects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_conversions" ADD CONSTRAINT "prospect_conversions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "prospect_billing_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_audit_events" ADD CONSTRAINT "prospect_audit_events_actor_operator_id_fkey" FOREIGN KEY ("actor_operator_id") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints, partial indexes or append-only triggers.
ALTER TABLE "platform_prospects"
  ADD CONSTRAINT "platform_prospects_cnpj_canonical" CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  ADD CONSTRAINT "platform_prospects_version_positive" CHECK (version > 0),
  ADD CONSTRAINT "platform_prospects_retention_hold_complete" CHECK ((retention_hold_reason IS NULL) = (retention_authorization_ref IS NULL));
CREATE UNIQUE INDEX "platform_prospect_sender_bindings_one_active_scope" ON "platform_prospect_sender_bindings" (scope) WHERE active;
CREATE UNIQUE INDEX "platform_prospect_sender_bindings_one_active_phone" ON "platform_prospect_sender_bindings" (phone_number_id) WHERE active;
ALTER TABLE "platform_prospect_sender_bindings" ADD CONSTRAINT "platform_prospect_sender_scope" CHECK (scope = 'zyon_platform' AND version > 0 AND authorization_version > 0);
ALTER TABLE "prospect_sequences" ADD CONSTRAINT "prospect_sequences_one_follow_up" CHECK (follow_up_count BETWEEN 0 AND 1);
ALTER TABLE "outreach_attempts"
  ADD CONSTRAINT "outreach_attempts_two_ordinals" CHECK (ordinal IN (0, 1)),
  ADD CONSTRAINT "outreach_attempts_amount_nonnegative" CHECK (reserved_amount >= 0),
  ADD CONSTRAINT "outreach_attempts_epoch_nonnegative" CHECK (control_epoch >= 0),
  ADD CONSTRAINT "outreach_attempts_state_valid" CHECK (state IN ('prepared','reserved','submitting','provider_accepted','delivered','read','not_accepted','outcome_unknown','cancelled_before_submit'));
ALTER TABLE "prospect_campaigns"
  ADD CONSTRAINT "prospect_campaigns_amounts_nonnegative" CHECK (reserved_cents >= 0 AND spent_cents >= 0),
  ADD CONSTRAINT "prospect_campaigns_limits_positive" CHECK ((daily_recipient_limit IS NULL OR daily_recipient_limit > 0) AND (budget_cents IS NULL OR budget_cents > 0)),
  ADD CONSTRAINT "prospect_campaigns_brl" CHECK (currency = 'BRL'),
  ADD CONSTRAINT "prospect_campaigns_revision_positive" CHECK (revision > 0),
  ADD CONSTRAINT "prospect_campaigns_state_valid" CHECK (state IN ('draft','freezing','review_ready','approved','running','paused','completed'));
ALTER TABLE "prospect_campaign_daily_usage" ADD CONSTRAINT "prospect_campaign_usage_nonnegative" CHECK (reserved_recipients >= 0 AND submitted_recipients >= 0);
ALTER TABLE "prospect_conversations" ADD CONSTRAINT "prospect_conversations_control_valid" CHECK (control_epoch >= 0 AND last_sequence >= 0 AND mode IN ('ai','human'));
ALTER TABLE "prospect_messages" ADD CONSTRAINT "prospect_messages_sequence_positive" CHECK (sequence > 0);
ALTER TABLE "prospect_reads" ADD CONSTRAINT "prospect_reads_sequence_nonnegative" CHECK (read_sequence >= 0);
ALTER TABLE "sales_knowledge_publications" ADD CONSTRAINT "sales_knowledge_validity" CHECK (version > 0 AND (valid_until IS NULL OR valid_until > valid_from));
CREATE FUNCTION prospecting_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'prospecting_receipt_append_only' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER contact_permission_receipts_immutable BEFORE UPDATE OR DELETE ON contact_permission_receipts FOR EACH ROW EXECUTE FUNCTION prospecting_receipt_immutable();
-- Additive platform CRM only. Directory publication never owns these records.
