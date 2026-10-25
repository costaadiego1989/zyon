# Storefront buyer context PII compatibility

Authenticated buyers must retain the existing conversation and cart. Decode the
persisted encrypted phone before projecting optional buyer context into the
strict JSON/Zod contract. Legacy plaintext remains compatible. An unreadable
optional phone is omitted, not sent as ciphertext and not allowed to block chat.
Keep identity matching, contract bounds, semantic input/output guardrails and
commercial authority unchanged. No database rewrite, request retry or replay.

Incident: production Athom requests on2026-10-23 at18:29UTC returned503
invalid_context before the provider. Read-only execution of the deployed usecase
with a tenant-linked buyer reproduces buyerContext.phone too_big; anonymous
context passes and the stored ciphertext decodes within the existing40 limit.

Do not claim provider payment/voice validation from this fix. Runtime hotfix
must preserve all integrated105 changes and pass sandbox before production.
