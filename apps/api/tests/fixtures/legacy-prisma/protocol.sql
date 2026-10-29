-- Current ProtocolSession scalars; this does not enforce application transitions.
CREATE TABLE protocol_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  state_history JSONB NOT NULL,
  session_data JSONB NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX protocol_sessions_merchant_id_expires_at_idx ON protocol_sessions (merchant_id, expires_at);
CREATE INDEX protocol_sessions_merchant_id_current_state_idx ON protocol_sessions (merchant_id, current_state);
