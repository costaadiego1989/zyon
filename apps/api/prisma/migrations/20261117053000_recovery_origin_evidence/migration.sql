-- Preserve server-owned native channel evidence before mutable WA sessions roll over.
-- Public funnel metadata is deliberately not an origin source. No activity/score changes.
INSERT INTO checkout_events (id, merchant_id, session_id, event_name, occurred_at, metadata)
SELECT DISTINCT ON (c.merchant_id, c.session_id)
  'wa_origin:' || length(c.merchant_id)::text || ':' || c.merchant_id || ':' || c.session_id,
  c.merchant_id, c.session_id, 'whatsapp_recovery_origin_v1', w.created_at,
  jsonb_build_object('configId', substring(w.device_id from 12))
FROM checkout_sessions c
JOIN whatsapp_sessions w ON w.merchant_id = c.merchant_id
  AND (w.checkout_session_id = c.session_id
    OR w.conversation_state->>'conversationId' = c.session_id
    OR w.conversation_state->>'conversationId' = c.conversation_id
    OR w.conversation_state->>'conversationId' = c.cart->>'cart_ref')
WHERE left(w.device_id, 11) = 'META_CLOUD:' AND length(w.device_id) > 11
ORDER BY c.merchant_id, c.session_id, w.created_at ASC
ON CONFLICT (id) DO NOTHING;
