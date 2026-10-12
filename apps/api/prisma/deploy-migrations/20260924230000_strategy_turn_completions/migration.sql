-- Historical admissions have no frozen session context and cannot become eligible.
ALTER TABLE checkout_sessions ADD COLUMN strategy_context_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checkout_sessions ADD CONSTRAINT strategy_session_context_version CHECK (strategy_context_version >= 0);
CREATE FUNCTION guard_strategy_session_context_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.strategy_context_version := 0;
  ELSIF EXISTS (SELECT 1 FROM strategy_assignments WHERE merchant_id = OLD.merchant_id AND session_id = OLD.session_id)
    THEN NEW.strategy_context_version := OLD.strategy_context_version + 1;
  ELSE NEW.strategy_context_version := OLD.strategy_context_version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_session_context_version_guard BEFORE INSERT OR UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_session_context_version();

ALTER TABLE strategy_turns ADD COLUMN session_context_hash TEXT;
ALTER TABLE strategy_turns ADD CONSTRAINT strategy_turn_session_hash
  CHECK (session_context_hash IS NULL OR session_context_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE strategy_turn_outcomes DROP CONSTRAINT strategy_provider_outcome;
ALTER TABLE strategy_turn_outcomes ADD CONSTRAINT strategy_provider_outcome
  CHECK (outcome IN ('provider_completed', 'provider_failed', 'provider_unknown', 'provider_not_dispatched'));

CREATE TABLE strategy_turn_completions (
  turn_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  response_hash TEXT,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT strategy_turn_completions_pkey PRIMARY KEY (turn_id),
  CONSTRAINT strategy_turn_completions_turn_id_merchant_id_fkey FOREIGN KEY (turn_id, merchant_id)
    REFERENCES strategy_turns(id, merchant_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT strategy_completion_hash CHECK (response_hash IS NULL OR response_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT strategy_completion_decision CHECK (
    (decision = 'eligible_at_recording' AND reason = 'current_at_recording' AND response_hash IS NOT NULL)
    OR (decision = 'suppressed' AND reason IN ('provider_failed', 'provider_unknown', 'provider_not_dispatched',
      'execution_disabled', 'dispatch_disabled', 'execution_stopped', 'outside_horizon', 'assignment_stopped',
      'session_changed', 'experiment_stopped', 'baseline_changed')))
);
CREATE UNIQUE INDEX strategy_turn_completions_turn_id_merchant_id_key ON strategy_turn_completions(turn_id, merchant_id);

CREATE FUNCTION guard_strategy_turn_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t strategy_turns; o strategy_turn_outcomes; a strategy_assignments; e strategy_executions; s checkout_sessions;
BEGIN
  SELECT * INTO t FROM strategy_turns WHERE id = NEW.turn_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO o FROM strategy_turn_outcomes WHERE turn_id = NEW.turn_id AND merchant_id = NEW.merchant_id;
  IF t.id IS NULL OR o.turn_id IS NULL OR NEW.recorded_at < t.admitted_at OR NEW.recorded_at < o.recorded_at
    OR (o.outcome = 'provider_completed') IS DISTINCT FROM (NEW.response_hash IS NOT NULL)
    OR (o.outcome <> 'provider_completed' AND (NEW.decision <> 'suppressed' OR NEW.reason <> o.outcome))
  THEN RAISE EXCEPTION 'strategy completion has no matching provider evidence'; END IF;
  IF NEW.decision = 'eligible_at_recording' THEN
    SELECT * INTO a FROM strategy_assignments WHERE id = t.assignment_id AND merchant_id = NEW.merchant_id;
    SELECT * INTO e FROM strategy_executions WHERE id = a.execution_id AND merchant_id = NEW.merchant_id FOR SHARE;
    SELECT * INTO s FROM checkout_sessions WHERE session_id = a.session_id AND merchant_id = NEW.merchant_id FOR SHARE;
    IF t.session_context_hash IS NULL OR e.status <> 'running' OR NEW.recorded_at >= e.ends_at
      OR NEW.recorded_at > clock_timestamp() OR clock_timestamp() >= e.ends_at
      OR s.cohort IS DISTINCT FROM 'treatment' OR s.global_user_id IS DISTINCT FROM a.global_user_id
      OR s.cart->>'currency' IS DISTINCT FROM 'BRL' OR s.prompt_variant_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM strategy_assignment_stops WHERE assignment_id = a.id AND merchant_id = NEW.merchant_id)
      OR NOT EXISTS (SELECT 1 FROM prompt_experiments WHERE id = e.experiment_id AND merchant_id = NEW.merchant_id AND status = 'running')
    THEN RAISE EXCEPTION 'strategy completion is not eligible'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_turn_completion_guard BEFORE INSERT ON strategy_turn_completions
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_turn_completion();
CREATE TRIGGER strategy_turn_completions_immutable BEFORE UPDATE OR DELETE ON strategy_turn_completions
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
