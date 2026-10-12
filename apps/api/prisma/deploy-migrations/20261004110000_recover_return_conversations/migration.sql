-- Keep original records and aliases. Recover only clearly linked return cases.
INSERT INTO "support_ticket_messages" ("id", "ticket_id", "sender_type", "content", "created_at")
SELECT 'sup_legacy_' || md5(t."id"), t."id", 'buyer', t."buyer_message", t."created_at"
FROM "support_tickets" t
WHERE t."buyer_id" IS NOT NULL AND t."merged_into_id" IS NULL
  AND length(trim(t."buyer_message")) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "support_ticket_messages" m
    JOIN "support_tickets" related ON related."id" = m."ticket_id"
    WHERE (related."id" = t."id" OR related."merged_into_id" = t."id")
      AND m."sender_type" = 'buyer' AND m."content" = t."buyer_message"
  );
INSERT INTO "support_ticket_messages" ("id", "ticket_id", "sender_type", "content", "created_at")
SELECT 'sup_recovered_' || md5(t."id"), t."id", 'system',
  'Sua solicitação ainda está em andamento. Esta conversa foi recuperada para acompanhar a resolução.', CURRENT_TIMESTAMP
FROM "support_tickets" t JOIN "returns" r ON r."id" = t."return_id" AND r."merchant_id" = t."merchant_id"
WHERE t."merged_into_id" IS NULL AND t."status" IN ('closed', 'resolved')
  AND r."status"::text NOT IN ('REFUND_COMPLETED', 'EXCHANGE_COMPLETED', 'REJECTED', 'CANCELLED');
UPDATE "support_tickets" t SET "status" = 'in_progress', "resolved_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
FROM "returns" r WHERE r."id" = t."return_id" AND r."merchant_id" = t."merchant_id"
  AND t."merged_into_id" IS NULL AND t."status" IN ('closed', 'resolved')
  AND r."status"::text NOT IN ('REFUND_COMPLETED', 'EXCHANGE_COMPLETED', 'REJECTED', 'CANCELLED');
