-- Synthetic disposable fixture for PrismaM2MManagementStore only.
-- Mirrors current Prisma scalar columns, defaults, uniqueness and reputation FK.
-- No migration/production proof, no M2M session model or expiry policy is implied.
CREATE TABLE buyer_agents (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  global_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  m2m_secret_hash TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read', 'negotiate']::TEXT[],
  expires_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT buyer_agents_merchant_id_global_user_id_key UNIQUE (merchant_id, global_user_id)
);
CREATE INDEX buyer_agents_merchant_id_status_idx ON buyer_agents (merchant_id, status);

CREATE TABLE agent_reputations (
  id TEXT NOT NULL PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  dispute_count INTEGER NOT NULL DEFAULT 0,
  reputation_score INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT agent_reputations_agent_id_fkey FOREIGN KEY (agent_id)
    REFERENCES buyer_agents(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE m2m_protocol_configs (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_url TEXT,
  webhook_endpoint_id TEXT,
  max_session_ttl_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
