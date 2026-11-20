CREATE FUNCTION fiscal_artifact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'fiscal_artifact_immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER fiscal_artifact_no_mutation BEFORE UPDATE OR DELETE ON fiscal_artifacts FOR EACH ROW EXECUTE FUNCTION fiscal_artifact_immutable();
