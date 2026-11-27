ALTER TABLE outreach_attempts ADD COLUMN provider_cost_micros BIGINT CHECK (provider_cost_micros >= 0);
