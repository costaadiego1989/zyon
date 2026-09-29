CREATE TABLE strategy_ai_reservations (
  turn_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  currency TEXT NOT NULL, price_version TEXT NOT NULL, input_rate BIGINT NOT NULL CHECK (input_rate >= 0),
  output_rate BIGINT NOT NULL CHECK (output_rate >= 0), max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens > 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0), amount_micros BIGINT NOT NULL CHECK (amount_micros >= 0),
  usage_key TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'dispatched' CHECK (state IN ('dispatched','unknown','settled','released','overrun')),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, settled_at TIMESTAMP(3),
  CONSTRAINT strategy_ai_reservations_turn_id_merchant_id_fkey FOREIGN KEY (turn_id, merchant_id)
    REFERENCES strategy_turns(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX strategy_ai_reservations_usage_key_key ON strategy_ai_reservations(usage_key);
CREATE UNIQUE INDEX strategy_ai_reservations_turn_id_merchant_id_key ON strategy_ai_reservations(turn_id, merchant_id);
CREATE INDEX strategy_ai_reservations_currency_created_at_idx ON strategy_ai_reservations(currency, created_at);
CREATE INDEX strategy_ai_reservations_provider_model_state_created_at_idx ON strategy_ai_reservations(provider, model, state, created_at);

-- Both planners and live strategy calls consume the same global ceiling and
-- provider capacity. Usage amounts remain authoritative in ai_usage_events.
CREATE VIEW revenue_ai_budget_reservations AS
  SELECT id, merchant_id, run_id, work_type, provider, model, currency, max_input_tokens,
    max_output_tokens, amount_micros, state, usage_key, created_at FROM revenue_ai_reservations
  UNION ALL
  SELECT turn_id, merchant_id, NULL::TEXT, 'strategy_chat'::TEXT, provider, model, currency,
    max_input_tokens, max_output_tokens, amount_micros, state, usage_key, created_at FROM strategy_ai_reservations;

CREATE FUNCTION guard_strategy_ai_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage ai_usage_events;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'STRATEGY_AI_RESERVATION_IMMUTABLE'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'dispatched' OR NEW.settled_at IS NOT NULL OR NEW.created_at > clock_timestamp()
      OR NEW.usage_key <> 'strategy-chat:' || NEW.turn_id
      OR NEW.amount_micros <> ceil((NEW.max_input_tokens::NUMERIC * NEW.input_rate + NEW.max_output_tokens::NUMERIC * NEW.output_rate) / 1000000)
      OR NOT EXISTS (SELECT 1 FROM strategy_turns t JOIN strategy_assignments a ON a.id = t.assignment_id AND a.merchant_id = t.merchant_id
        JOIN strategy_executions e ON e.id = a.execution_id AND e.merchant_id = a.merchant_id
        WHERE t.id = NEW.turn_id AND t.merchant_id = NEW.merchant_id AND t.admitted_at <= NEW.created_at
          AND e.status = 'running' AND e.ends_at > NEW.created_at
          AND e.contract->'baseline'->'provider'->>'name' = NEW.provider AND e.contract->'baseline'->'provider'->>'model' = NEW.model
          AND NOT EXISTS (SELECT 1 FROM strategy_turn_outcomes o WHERE o.turn_id = t.id))
      OR NOT EXISTS (SELECT 1 FROM ai_price_versions p WHERE p.version = NEW.price_version AND p.provider = NEW.provider
        AND p.model = NEW.model AND p.currency = NEW.currency AND p.channel = 'chat' AND p.component = 'text_generation'
        AND p.source = 'revenue-upper-bound-v1' AND p.input_micros_per_million = NEW.input_rate
        AND p.output_micros_per_million = NEW.output_rate AND p.effective_from <= NEW.created_at
        AND (p.effective_to IS NULL OR p.effective_to > NEW.created_at))
    THEN RAISE EXCEPTION 'STRATEGY_AI_RESERVATION_INVALID'; END IF;
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
  IF OLD.state IN ('settled','released','overrun')
    OR (to_jsonb(NEW) - ARRAY['state','settled_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','settled_at'])
    OR NEW.state = 'dispatched' THEN RAISE EXCEPTION 'STRATEGY_AI_RESERVATION_IMMUTABLE'; END IF;
  SELECT * INTO usage FROM ai_usage_events WHERE idempotency_key = NEW.usage_key AND merchant_id = NEW.merchant_id
    AND source = 'checkout_strategy' AND provider = NEW.provider AND model = NEW.model
    AND currency = NEW.currency AND pricing_version = NEW.price_version;
  IF usage.id IS NULL OR (NEW.state = 'unknown' AND (NEW.settled_at IS NOT NULL OR usage.cost_micros IS NOT NULL))
    OR (NEW.state <> 'unknown' AND (NEW.settled_at IS NULL OR NEW.settled_at < NEW.created_at OR NEW.settled_at > clock_timestamp()))
    OR (NEW.state = 'released' AND (usage.cost_micros IS DISTINCT FROM 0 OR usage.execution_status <> 'not_dispatched'))
    OR (NEW.state IN ('settled','overrun') AND (usage.prompt_tokens IS NULL OR usage.completion_tokens IS NULL
      OR usage.prompt_tokens < 0 OR usage.completion_tokens < 0
      OR usage.cost_micros IS DISTINCT FROM ceil((usage.prompt_tokens::NUMERIC * NEW.input_rate + usage.completion_tokens::NUMERIC * NEW.output_rate) / 1000000)))
    OR (NEW.state = 'settled' AND (usage.cost_micros > NEW.amount_micros OR usage.prompt_tokens > NEW.max_input_tokens OR usage.completion_tokens > NEW.max_output_tokens))
    OR (NEW.state = 'overrun' AND usage.cost_micros <= NEW.amount_micros AND usage.prompt_tokens <= NEW.max_input_tokens AND usage.completion_tokens <= NEW.max_output_tokens)
  THEN RAISE EXCEPTION 'STRATEGY_AI_USAGE_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_ai_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_ai_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_ai_reservation();

CREATE FUNCTION protect_strategy_ai_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM strategy_ai_reservations r WHERE r.usage_key = OLD.idempotency_key
      AND (TG_OP = 'DELETE' OR r.state IN ('settled','released','overrun')))
    THEN RAISE EXCEPTION 'STRATEGY_AI_USAGE_IMMUTABLE'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM strategy_ai_reservations r WHERE r.usage_key = OLD.idempotency_key)
    AND ROW(NEW.idempotency_key, NEW.merchant_id, NEW.source, NEW.provider, NEW.model, NEW.currency, NEW.pricing_version, NEW.started_at)
      IS DISTINCT FROM ROW(OLD.idempotency_key, OLD.merchant_id, OLD.source, OLD.provider, OLD.model, OLD.currency, OLD.pricing_version, OLD.started_at)
  THEN RAISE EXCEPTION 'STRATEGY_AI_USAGE_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_ai_usage_guard BEFORE UPDATE OR DELETE ON ai_usage_events
  FOR EACH ROW EXECUTE FUNCTION protect_strategy_ai_usage();
