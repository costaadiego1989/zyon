/**
 * Migration: Twilio Multi-Tenant WhatsApp Support
 *
 * Date: 2026-08-21
 * Summary:
 * - Updated WhatsAppChannelConfig schema to support multiple providers (BUBBLEWHATS, TWILIO, META_CLOUD)
 * - Added encrypted credentials JSON field for per-merchant Twilio account storage
 * - Added whatsappNumber field for webhook routing by phone number
 * - Added status tracking (DISCONNECTED, PENDING_VERIFICATION, ACTIVE, INACTIVE)
 * - Kept legacy BubbleWhats fields (deviceId, phoneNumber, webhookSecret) for backward compat
 *
 * Migration Steps (manual):
 * 1. Run: cd apps/api && pnpm prisma migrate dev --name add_twilio_multi_tenant
 * 2. Verify schema changes applied to database
 * 3. No data transformation needed — existing BubbleWhats configs remain unchanged
 *
 * Code changes:
 * - Prisma: Schema updated with new fields and provider column
 * - Repository: findByWhatsAppNumber() added for Twilio webhook routing
 * - Controller: /webhooks/whatsapp/twilio endpoint added
 * - Adapters: TwilioSenderAdapter for sending, TwilioWebhookParser for inbound
 * - Module: Multi-provider adapter resolver wiring BubbleWhats + Twilio
 */

export const TWILIO_MIGRATION_VERSION = "20260821_001";
