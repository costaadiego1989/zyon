ALTER TABLE "fiscal_deliveries"
  ADD COLUMN "destination" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "transport_provider" TEXT,
  ADD COLUMN "transport_account_id" TEXT,
  ADD COLUMN "transport_connection_id" TEXT;

-- Fiscal delivery custom invariants (also applied after fixture db push).
CREATE FUNCTION fiscal_preserve_delivery_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.document_id, OLD.merchant_id, OLD.environment, OLD.channel, OLD.responsible_sender, OLD.destination, OLD.idempotency_key)
    IS DISTINCT FROM ROW(NEW.document_id, NEW.merchant_id, NEW.environment, NEW.channel, NEW.responsible_sender, NEW.destination, NEW.idempotency_key)
    OR (OLD.transport_provider IS NOT NULL AND ROW(OLD.transport_provider, OLD.transport_account_id, OLD.transport_connection_id)
      IS DISTINCT FROM ROW(NEW.transport_provider, NEW.transport_account_id, NEW.transport_connection_id))
    OR (OLD.provider_message_id IS NOT NULL AND OLD.provider_message_id IS DISTINCT FROM NEW.provider_message_id)
    OR (OLD.state = 'delivered' AND NEW.state <> 'delivered') THEN
    RAISE EXCEPTION 'fiscal_delivery_binding_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_preserve_delivery_binding BEFORE UPDATE ON fiscal_deliveries FOR EACH ROW EXECUTE FUNCTION fiscal_preserve_delivery_binding();
