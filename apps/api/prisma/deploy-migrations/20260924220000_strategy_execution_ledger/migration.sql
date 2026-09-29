-- CreateTable
CREATE TABLE "strategy_executions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "approval_action_id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "proposal_hash" TEXT NOT NULL,
    "contract_hash" TEXT NOT NULL,
    "contract" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "stopped_at" TIMESTAMP(3),

    CONSTRAINT "strategy_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_assignments" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_turns" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "admitted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_turns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "strategy_assignment_stops" (
    "assignment_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stopped_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "strategy_assignment_stops_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "strategy_turn_outcomes" (
    "turn_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_turn_outcomes_pkey" PRIMARY KEY ("turn_id")
);

-- CreateTable
CREATE TABLE "strategy_execution_events" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_execution_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_executions_approval_action_id_key" ON "strategy_executions"("approval_action_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_executions_experiment_id_key" ON "strategy_executions"("experiment_id");

-- CreateIndex
CREATE INDEX "strategy_executions_merchant_id_status_idx" ON "strategy_executions"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_executions_id_merchant_id_key" ON "strategy_executions"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_executions_approval_action_id_merchant_id_key" ON "strategy_executions"("approval_action_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_executions_experiment_id_merchant_id_key" ON "strategy_executions"("experiment_id", "merchant_id");

-- CreateIndex
CREATE INDEX "strategy_assignments_execution_id_merchant_id_assigned_at_idx" ON "strategy_assignments"("execution_id", "merchant_id", "assigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_assignments_id_merchant_id_key" ON "strategy_assignments"("id", "merchant_id");

CREATE UNIQUE INDEX "strategy_assignment_stops_assignment_id_merchant_id_key" ON "strategy_assignment_stops"("assignment_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_assignments_merchant_id_session_id_key" ON "strategy_assignments"("merchant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_assignments_execution_id_merchant_id_global_user_i_key" ON "strategy_assignments"("execution_id", "merchant_id", "global_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_turns_id_merchant_id_key" ON "strategy_turns"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_turns_assignment_id_merchant_id_request_key_key" ON "strategy_turns"("assignment_id", "merchant_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_turn_outcomes_turn_id_merchant_id_key" ON "strategy_turn_outcomes"("turn_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_execution_events_execution_id_merchant_id_request__key" ON "strategy_execution_events"("execution_id", "merchant_id", "request_key");

-- AddForeignKey
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_strategy_id_merchant_id_version_fkey" FOREIGN KEY ("strategy_id", "merchant_id", "version") REFERENCES "revenue_strategy_versions"("strategy_id", "merchant_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_approval_action_id_merchant_id_fkey" FOREIGN KEY ("approval_action_id", "merchant_id") REFERENCES "revenue_strategy_actions"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_experiment_id_merchant_id_fkey" FOREIGN KEY ("experiment_id", "merchant_id") REFERENCES "experiment_measurement_plans"("experiment_id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_assignments" ADD CONSTRAINT "strategy_assignments_execution_id_merchant_id_fkey" FOREIGN KEY ("execution_id", "merchant_id") REFERENCES "strategy_executions"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_assignments" ADD CONSTRAINT "strategy_assignments_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "strategy_assignment_stops" ADD CONSTRAINT "strategy_assignment_stops_assignment_id_merchant_id_fkey" FOREIGN KEY ("assignment_id", "merchant_id") REFERENCES "strategy_assignments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_turns" ADD CONSTRAINT "strategy_turns_assignment_id_merchant_id_fkey" FOREIGN KEY ("assignment_id", "merchant_id") REFERENCES "strategy_assignments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_turn_outcomes" ADD CONSTRAINT "strategy_turn_outcomes_turn_id_merchant_id_fkey" FOREIGN KEY ("turn_id", "merchant_id") REFERENCES "strategy_turns"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_execution_events" ADD CONSTRAINT "strategy_execution_events_execution_id_merchant_id_fkey" FOREIGN KEY ("execution_id", "merchant_id") REFERENCES "strategy_executions"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one experiment owns a store, including paused executions. Stopping is
-- terminal; a new approval/version is needed to start a new experiment.
CREATE UNIQUE INDEX strategy_executions_one_live_store ON strategy_executions(merchant_id)
  WHERE status IN ('running', 'paused');
ALTER TABLE strategy_executions ADD CONSTRAINT strategy_execution_state CHECK (
  status IN ('running', 'paused', 'stopped') AND ends_at > started_at
  AND ((status = 'running' AND stopped_at IS NULL) OR (status <> 'running' AND stopped_at IS NOT NULL AND stopped_at >= started_at)));
ALTER TABLE strategy_assignments ADD CONSTRAINT strategy_assignment_arm CHECK (arm IN ('control', 'treatment') AND length(trim(global_user_id)) > 0);
ALTER TABLE strategy_turn_outcomes ADD CONSTRAINT strategy_provider_outcome CHECK (outcome IN ('provider_completed', 'provider_failed', 'provider_unknown'));
ALTER TABLE strategy_execution_events ADD CONSTRAINT strategy_execution_event_kind CHECK (kind IN ('activated', 'paused', 'stopped'));

CREATE FUNCTION guard_strategy_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v revenue_strategy_versions; a revenue_strategy_actions; p experiment_measurement_plans;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'strategy execution evidence is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','stopped_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','stopped_at'])
      OR NOT ((OLD.status = 'running' AND NEW.status IN ('paused','stopped')) OR (OLD.status = 'paused' AND NEW.status = 'stopped'))
      OR NEW.stopped_at < COALESCE(OLD.stopped_at, OLD.started_at)
    THEN RAISE EXCEPTION 'strategy execution change is not allowed'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v FROM revenue_strategy_versions WHERE strategy_id = NEW.strategy_id AND merchant_id = NEW.merchant_id AND version = NEW.version;
  SELECT * INTO a FROM revenue_strategy_actions WHERE id = NEW.approval_action_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO p FROM experiment_measurement_plans WHERE experiment_id = NEW.experiment_id AND merchant_id = NEW.merchant_id;
  IF v.strategy_id IS NULL OR a.id IS NULL OR p.experiment_id IS NULL OR NEW.status <> 'running'
    OR v.proposal_hash <> NEW.proposal_hash OR a.kind <> 'approve' OR a.strategy_id <> NEW.strategy_id OR a.version <> NEW.version
    OR a.result->>'status' IS DISTINCT FROM 'activation_pending'
    OR a.result->>'proposal_hash' IS DISTINCT FROM NEW.proposal_hash
    OR NEW.contract->>'definition' IS DISTINCT FROM 'checkout-strategy-execution-v1'
    OR NEW.contract->>'allocation' IS DISTINCT FROM 'sha256-merchant-experiment-buyer-v1'
    OR NEW.contract->>'merchantId' IS DISTINCT FROM NEW.merchant_id
    OR NEW.contract->>'strategyId' IS DISTINCT FROM NEW.strategy_id
    OR NEW.contract->>'proposalHash' IS DISTINCT FROM NEW.proposal_hash
    OR NEW.contract->'version' IS DISTINCT FROM to_jsonb(NEW.version)
    OR NEW.contract->'baseline' IS DISTINCT FROM v.proposal->'checkoutBaseline'
    OR NEW.contract->'review' IS DISTINCT FROM v.proposal->'experimentReview'
    OR NEW.contract->'review'->>'experimentId' IS DISTINCT FROM NEW.experiment_id
    OR NEW.contract->'review'->>'planHash' IS DISTINCT FROM p.plan_hash
    OR NEW.contract->'review'->'plan' IS DISTINCT FROM p.plan
    OR NEW.contract->>'communicationAddendum' IS DISTINCT FROM v.proposal->'recommendation'->'template'->'variant_b'->>'system_prompt'
    OR a.created_at < v.created_at OR length(trim(a.actor_id)) = 0
    OR NEW.started_at < a.created_at OR NEW.started_at < p.created_at OR NEW.started_at >= v.expires_at
    OR NEW.ends_at <> NEW.started_at + (p.plan->>'durationDays')::integer * interval '1 day'
  THEN RAISE EXCEPTION 'strategy execution must match approved evidence'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_executions
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_execution();

CREATE FUNCTION guard_strategy_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e strategy_executions; s checkout_sessions;
BEGIN
  SELECT * INTO e FROM strategy_executions WHERE id = NEW.execution_id AND merchant_id = NEW.merchant_id FOR SHARE;
  SELECT * INTO s FROM checkout_sessions WHERE session_id = NEW.session_id AND merchant_id = NEW.merchant_id FOR SHARE;
  IF e.id IS NULL OR s.id IS NULL OR e.status <> 'running' OR s.cohort IS DISTINCT FROM 'treatment'
    OR s.cart->>'currency' IS DISTINCT FROM 'BRL' OR s.chat_history IS DISTINCT FROM '[]'::jsonb OR s.prompt_variant_id IS NOT NULL
    OR NEW.global_user_id <> s.global_user_id OR s.created_at < e.started_at
    OR NEW.assigned_at < s.created_at OR NEW.assigned_at >= e.ends_at OR NEW.assigned_at > clock_timestamp()
    OR NEW.variant_id IS DISTINCT FROM (CASE WHEN NEW.arm = 'control' THEN e.contract->'review'->'plan'->>'controlVariantId'
      ELSE e.contract->'review'->'plan'->>'treatmentVariantId' END)
  THEN RAISE EXCEPTION 'strategy assignment is not eligible'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_assignment_guard BEFORE INSERT ON strategy_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_assignment();

CREATE FUNCTION guard_strategy_turn() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a strategy_assignments; e strategy_executions;
BEGIN
  SELECT * INTO a FROM strategy_assignments WHERE id = NEW.assignment_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO e FROM strategy_executions WHERE id = a.execution_id AND merchant_id = NEW.merchant_id FOR SHARE;
  IF a.id IS NULL OR e.id IS NULL OR e.status <> 'running' OR NEW.admitted_at < a.assigned_at
    OR NEW.admitted_at >= e.ends_at OR NEW.admitted_at > clock_timestamp()
    OR NEW.input_hash !~ '^[a-f0-9]{64}$' OR NEW.prompt_hash !~ '^[a-f0-9]{64}$'
    OR EXISTS (SELECT 1 FROM strategy_assignment_stops WHERE assignment_id = a.id AND merchant_id = a.merchant_id)
  THEN RAISE EXCEPTION 'strategy turn is not eligible'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_turn_guard BEFORE INSERT ON strategy_turns
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_turn();

CREATE TRIGGER strategy_assignments_immutable BEFORE UPDATE OR DELETE ON strategy_assignments
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
CREATE TRIGGER strategy_assignment_stops_immutable BEFORE UPDATE OR DELETE ON strategy_assignment_stops
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
CREATE TRIGGER strategy_turns_immutable BEFORE UPDATE OR DELETE ON strategy_turns
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
CREATE TRIGGER strategy_turn_outcomes_immutable BEFORE UPDATE OR DELETE ON strategy_turn_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
CREATE TRIGGER strategy_execution_events_immutable BEFORE UPDATE OR DELETE ON strategy_execution_events
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();

CREATE FUNCTION guard_strategy_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at
    AND EXISTS (SELECT 1 FROM strategy_assignments WHERE merchant_id = OLD.merchant_id AND session_id = OLD.session_id)
  THEN RAISE EXCEPTION 'assigned strategy session creation time is immutable'; END IF;
  IF NEW.global_user_id IS DISTINCT FROM OLD.global_user_id OR NEW.cohort IS DISTINCT FROM OLD.cohort
    OR NEW.cart->>'currency' IS DISTINCT FROM OLD.cart->>'currency'
    OR NEW.prompt_variant_id IS DISTINCT FROM OLD.prompt_variant_id
  THEN
    INSERT INTO strategy_assignment_stops(assignment_id, merchant_id, reason, stopped_at)
      SELECT id, merchant_id, 'session_context_changed', clock_timestamp()
      FROM strategy_assignments WHERE merchant_id = OLD.merchant_id AND session_id = OLD.session_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_session_identity_guard BEFORE UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_session_identity();
