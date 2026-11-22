-- Additive history lookup. Existing attribution and purchase receipts remain intact.
CREATE INDEX "meta_ads_attribution_touch_session_idx"
ON "meta_ads_agent_records" ("merchant_id", ("payload"->>'sessionId'), "created_at" DESC)
WHERE "kind" = 'attribution_touch';

CREATE INDEX "meta_ads_attribution_touch_id_idx"
ON "meta_ads_agent_records" ("merchant_id", ("payload"->>'id'))
WHERE "kind" = 'attribution_touch';
