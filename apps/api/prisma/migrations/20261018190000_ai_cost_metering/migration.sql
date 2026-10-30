ALTER TABLE ai_usage_events
  ADD COLUMN billing_account_id TEXT,
  ADD COLUMN credential_scope TEXT,
  ADD COLUMN payer TEXT NOT NULL DEFAULT 'platform',
  ADD COLUMN cost_center TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN measurement_origin TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN usage_known BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN requested_model TEXT,
  ADD COLUMN input_details JSONB,
  ADD COLUMN output_details JSONB,
  ADD COLUMN audio_cost_micros BIGINT;
UPDATE ai_usage_events SET usage_known = true WHERE prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL;
UPDATE ai_usage_events SET cost_center = 'voice' WHERE channel = 'voice';
ALTER TABLE ai_price_versions ADD COLUMN rates JSONB;
CREATE INDEX ai_usage_events_started_at_id_idx ON ai_usage_events(started_at, id);
CREATE INDEX ai_usage_events_billing_account_id_started_at_idx ON ai_usage_events(billing_account_id, started_at);
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_cost_nonnegative CHECK (cost_micros IS NULL OR cost_micros >= 0);

-- Official prices checked 2026-10-18; integer USD micros per million tokens.
-- Legacy versions are retained, but only verified structured rates price new captures.
INSERT INTO ai_price_versions(id, version, provider, model, channel, component, currency, effective_from, source, rates)
VALUES
('meter_openai_mini_20261018','openai-gpt4omini-20261018','openai','gpt-4o-mini','chat','text_generation','USD','2026-10-18T00:00:00Z','https://developers.openai.com/api/docs/models/gpt-4o-mini','{"input":"150000","cached":"75000","output":"600000"}'),
('meter_openai_embed_20261018','openai-embedding3small-20261018','openai','text-embedding-3-small','chat','embedding','USD','2026-10-18T00:00:00Z','https://developers.openai.com/api/docs/models/text-embedding-3-small','{"input":"20000","output":"0"}'),
('meter_openai_rtmini_20261018','openai-realtime21mini-20261018','openai','gpt-realtime-2.1-mini','voice','realtime_response','USD','2026-10-18T00:00:00Z','https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini','{"input":"600000","cached":"60000","output":"2400000","audio_input":"10000000","audio_cached":"300000","audio_output":"20000000","image_input":"800000","image_cached":"80000"}'),
('meter_openai_rt_20261018','openai-realtime21-20261018','openai','gpt-realtime-2.1','voice','realtime_response','USD','2026-10-18T00:00:00Z','https://developers.openai.com/api/docs/pricing','{"input":"4000000","cached":"400000","output":"24000000","audio_input":"32000000","audio_cached":"400000","audio_output":"64000000","image_input":"5000000","image_cached":"500000"}'),
('meter_openai_transcribe_20261018','openai-mini-transcribe-20261018','openai','gpt-4o-mini-transcribe','voice','transcription','USD','2026-10-18T00:00:00Z','https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe','{"input":"1250000","output":"5000000"}');
CREATE TABLE ai_voice_usage_sessions (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, billing_account_id TEXT NOT NULL,
 credential_scope TEXT NOT NULL, model TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL,
 provider_call_id TEXT, conversation_id TEXT NOT NULL, started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at TIMESTAMP(3)
);
CREATE INDEX ai_voice_usage_sessions_merchant_id_started_at_idx ON ai_voice_usage_sessions(merchant_id,started_at);
CREATE INDEX ai_voice_usage_sessions_state_started_at_idx ON ai_voice_usage_sessions(state,started_at);

-- DeepSeek Flash off-peak / weekday peak rates verified at official pricing URL.
-- Effective only after the last 2026 Chinese public holiday; expire before 2027 calendar.
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,effective_to,source,rates) VALUES ('meter_deepseek_flash_0_20261018','deepseek-flash-0-20261018','deepseek','deepseek-flash','chat','text_generation','USD','2026-10-18T00:00:00Z','2027-01-01T00:00:00Z','https://api-docs.deepseek.com/quick_start/pricing/','{"input":"150000","cached":"3000","output":"600000","peak_multiplier":"2"}');
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,effective_to,source,rates) VALUES ('meter_deepseek_flash_1_20261018','deepseek-flash-1-20261018','deepseek','deepseek-v4-flash','chat','text_generation','USD','2026-10-18T00:00:00Z','2027-01-01T00:00:00Z','https://api-docs.deepseek.com/quick_start/pricing/','{"input":"150000","cached":"3000","output":"600000","peak_multiplier":"2"}');
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,effective_to,source,rates) VALUES ('meter_deepseek_flash_2_20261018','deepseek-flash-2-20261018','deepseek','deepseek-v4-flash-vision-exp','chat','text_generation','USD','2026-10-18T00:00:00Z','2027-01-01T00:00:00Z','https://api-docs.deepseek.com/quick_start/pricing/','{"input":"150000","cached":"3000","output":"600000","peak_multiplier":"2"}');
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,effective_to,source,rates) VALUES ('meter_deepseek_flash_3_20261018','deepseek-flash-3-20261018','deepseek','deepseek-v4.1-flash-1017','chat','text_generation','USD','2026-10-18T00:00:00Z','2027-01-01T00:00:00Z','https://api-docs.deepseek.com/quick_start/pricing/','{"input":"150000","cached":"3000","output":"600000","peak_multiplier":"2"}');
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,effective_to,source,rates) VALUES ('meter_deepseek_flash_4_20261018','deepseek-flash-4-20261018','deepseek','DeepSeek-V4.1-Flash-1017','chat','text_generation','USD','2026-10-18T00:00:00Z','2027-01-01T00:00:00Z','https://api-docs.deepseek.com/quick_start/pricing/','{"input":"150000","cached":"3000","output":"600000","peak_multiplier":"2"}');

INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,source,rates) SELECT id||'_snapshot',version||'-snapshot',provider,'gpt-4o-mini-2024-07-18',channel,component,currency,effective_from,source,rates FROM ai_price_versions WHERE id='meter_openai_mini_20261018';
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,source,rates) SELECT id||'_2025-03-20',version||'-2025-03-20',provider,'gpt-4o-mini-transcribe-2025-03-20',channel,component,currency,effective_from,source,rates FROM ai_price_versions WHERE id='meter_openai_transcribe_20261018';
INSERT INTO ai_price_versions(id,version,provider,model,channel,component,currency,effective_from,source,rates) SELECT id||'_2025-12-15',version||'-2025-12-15',provider,'gpt-4o-mini-transcribe-2025-12-15',channel,component,currency,effective_from,source,rates FROM ai_price_versions WHERE id='meter_openai_transcribe_20261018';

UPDATE ai_usage_events SET measurement_origin='budget_reservation' WHERE source IN ('checkout_strategy','revenue_manager') AND measurement_origin='legacy';
