ALTER TABLE revenue_analysis_runs ADD COLUMN incentive_recommendation_json JSONB;
ALTER TABLE revenue_analysis_runs ADD CONSTRAINT revenue_incentive_recommendation_object
  CHECK (incentive_recommendation_json IS NULL OR
    (jsonb_typeof(incentive_recommendation_json) = 'object' AND discount_study_json IS NOT NULL));

CREATE FUNCTION protect_revenue_incentive_recommendation() RETURNS trigger AS $$
BEGIN
  IF OLD.incentive_recommendation_json IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'REVENUE_INCENTIVE_RECOMMENDATION_IMMUTABLE'; END IF;
    IF NEW.incentive_recommendation_json IS DISTINCT FROM OLD.incentive_recommendation_json
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.cycle IS DISTINCT FROM OLD.cycle OR NEW.as_of IS DISTINCT FROM OLD.as_of
      OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
      OR NEW.discount_study_json IS DISTINCT FROM OLD.discount_study_json THEN
      RAISE EXCEPTION 'REVENUE_INCENTIVE_RECOMMENDATION_IMMUTABLE';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER revenue_incentive_recommendation_immutable BEFORE UPDATE OR DELETE ON revenue_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION protect_revenue_incentive_recommendation();
