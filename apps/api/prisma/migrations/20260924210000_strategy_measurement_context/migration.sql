ALTER TABLE "revenue_analysis_runs" ADD COLUMN "measurement_planning_json" JSONB;

-- A model retry or merchant revision must not choose a new baseline or MDE.
CREATE FUNCTION protect_revenue_measurement_context() RETURNS trigger AS $$
BEGIN
  IF OLD.measurement_planning_json IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'REVENUE_MEASUREMENT_CONTEXT_IMMUTABLE';
    END IF;
    IF NEW.measurement_planning_json IS DISTINCT FROM OLD.measurement_planning_json
       OR NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
       OR NEW.cycle IS DISTINCT FROM OLD.cycle
       OR NEW.as_of IS DISTINCT FROM OLD.as_of OR NEW.observation_id IS DISTINCT FROM OLD.observation_id THEN
      RAISE EXCEPTION 'REVENUE_MEASUREMENT_CONTEXT_IMMUTABLE';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_measurement_context_immutable BEFORE UPDATE OR DELETE ON revenue_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION protect_revenue_measurement_context();
