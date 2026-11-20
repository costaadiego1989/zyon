ALTER TABLE "payment_intents" ADD COLUMN "private_receipt" JSONB;
ALTER TABLE "fiscal_deliveries" ADD COLUMN "callback_credential_cipher" TEXT;
CREATE FUNCTION protect_private_payment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.private_receipt IS NOT NULL AND NEW.private_receipt IS DISTINCT FROM OLD.private_receipt THEN RAISE EXCEPTION 'private_payment_receipt_immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER private_payment_receipt_immutable BEFORE UPDATE ON payment_intents FOR EACH ROW EXECUTE FUNCTION protect_private_payment_receipt();
CREATE FUNCTION protect_fiscal_callback_credential() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.callback_credential_cipher IS NOT NULL AND NEW.callback_credential_cipher IS DISTINCT FROM OLD.callback_credential_cipher THEN RAISE EXCEPTION 'fiscal_callback_credential_immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER fiscal_callback_credential_immutable BEFORE UPDATE ON fiscal_deliveries FOR EACH ROW EXECUTE FUNCTION protect_fiscal_callback_credential();
