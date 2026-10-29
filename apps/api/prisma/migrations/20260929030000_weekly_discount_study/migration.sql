ALTER TABLE revenue_analysis_runs ADD COLUMN discount_study_json JSONB;
ALTER TABLE revenue_analysis_runs ADD CONSTRAINT revenue_discount_study_object
  CHECK (discount_study_json IS NULL OR jsonb_typeof(discount_study_json) = 'object');

CREATE FUNCTION protect_revenue_discount_study() RETURNS trigger AS $$
BEGIN
  IF OLD.discount_study_json IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'REVENUE_DISCOUNT_STUDY_IMMUTABLE'; END IF;
    IF NEW.discount_study_json IS DISTINCT FROM OLD.discount_study_json
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.cycle IS DISTINCT FROM OLD.cycle OR NEW.as_of IS DISTINCT FROM OLD.as_of
      OR NEW.observation_id IS DISTINCT FROM OLD.observation_id THEN
      RAISE EXCEPTION 'REVENUE_DISCOUNT_STUDY_IMMUTABLE';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_discount_study_immutable BEFORE UPDATE OR DELETE ON revenue_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION protect_revenue_discount_study();
