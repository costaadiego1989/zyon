-- Reuse the existing checkout version column. Every write, including direct
-- partial updates and telemetry, invalidates snapshots read before that write.
CREATE FUNCTION guard_checkout_session_write_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 0;
  ELSE
    IF NEW.version IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'CHECKOUT_SESSION_VERSION_READ_ONLY';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_session_write_version_guard BEFORE INSERT OR UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_session_write_version();
