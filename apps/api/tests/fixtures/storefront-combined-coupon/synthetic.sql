-- Synthetic additive witness over the existing UOW/catalog/cross-sell/coupon
-- fixtures. Not a production migration, reservation protocol or delivery proof.
CREATE FUNCTION synthetic_combined_coupon_outbox_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='coupon.applied' AND NEW.payload->>'session_id' LIKE 'combined-hold-%' THEN
    PERFORM pg_advisory_xact_lock(7396201);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_combined_coupon_outbox_gate BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION synthetic_combined_coupon_outbox_gate();

-- Lifecycle-specific failures fire ONLY after initial valid application, so
-- setup is real acceptance+reservation, not a fabricated combined snapshot.
CREATE FUNCTION synthetic_combined_coupon_lifecycle_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='storefront.coupon.lifecycle-recorded' THEN
    IF NEW.payload->>'cartId'='combined-release-outbox-failure' THEN
      RAISE EXCEPTION 'synthetic_combined_release_outbox_failure';
    END IF;
    IF NEW.payload->>'cartId' LIKE 'combined-release-hold-%' THEN
      PERFORM pg_advisory_xact_lock(7396201);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_combined_coupon_lifecycle_outbox BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION synthetic_combined_coupon_lifecycle_outbox();

CREATE FUNCTION synthetic_combined_coupon_lifecycle_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='storefront.coupon.lifecycle-recorded'
    AND NEW.payload->>'cartId'='combined-release-deferred-failure' THEN
    RAISE EXCEPTION 'synthetic_combined_release_deferred_failure';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER synthetic_combined_coupon_lifecycle_commit AFTER INSERT ON outbox_messages
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_combined_coupon_lifecycle_commit();

CREATE FUNCTION synthetic_combined_coupon_lifecycle_cart() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.session_id='combined-release-cart-failure' AND OLD.coupon_code IS NOT NULL AND NEW.coupon_code IS NULL THEN
    RAISE EXCEPTION 'synthetic_combined_release_cart_failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_combined_coupon_lifecycle_cart BEFORE UPDATE ON storefront_carts
FOR EACH ROW EXECUTE FUNCTION synthetic_combined_coupon_lifecycle_cart();
