ALTER TABLE revenue_analysis_runs ADD COLUMN shared_learning_json JSONB;
ALTER TABLE revenue_analysis_runs ADD CONSTRAINT revenue_shared_learning_object
  CHECK (shared_learning_json IS NULL OR (jsonb_typeof(shared_learning_json) = 'object'
    AND shared_learning_json->>'definition' = 'shared-strategy-learning-v1'
    AND jsonb_typeof(shared_learning_json->'lessons') = 'array'));

CREATE FUNCTION protect_revenue_shared_learning() RETURNS trigger AS $$
BEGIN
  IF OLD.shared_learning_json IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'REVENUE_SHARED_LEARNING_IMMUTABLE'; END IF;
    IF NEW.shared_learning_json IS DISTINCT FROM OLD.shared_learning_json
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.cycle IS DISTINCT FROM OLD.cycle OR NEW.as_of IS DISTINCT FROM OLD.as_of
      OR NEW.observation_id IS DISTINCT FROM OLD.observation_id THEN
      RAISE EXCEPTION 'REVENUE_SHARED_LEARNING_IMMUTABLE';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revenue_shared_learning_immutable BEFORE UPDATE OR DELETE ON revenue_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION protect_revenue_shared_learning();
