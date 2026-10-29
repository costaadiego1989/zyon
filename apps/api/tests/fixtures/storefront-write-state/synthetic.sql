-- Synthetic seed only. No recovery table, migration, terminal state or policy.
-- The existing immutable scope guard supplies timestamps and initial revision0.
INSERT INTO merchants(id) VALUES ('synthetic-merchant') ON CONFLICT DO NOTHING;
INSERT INTO storefront_execution_scopes(merchant_id,conversation_id,cart_id,principal_id)
  VALUES ('synthetic-merchant','synthetic-state-fixture','synthetic-state-fixture','synthetic-principal');
