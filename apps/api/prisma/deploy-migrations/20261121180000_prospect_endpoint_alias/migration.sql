ALTER TABLE prospect_inbox_events ADD COLUMN next_attempt_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX prospect_inbox_retry_idx ON prospect_inbox_events(state,next_attempt_at);
ALTER TABLE prospect_endpoints ADD COLUMN last_contact_activity_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE prospect_endpoint_aliases (
 sender_binding_id text NOT NULL REFERENCES platform_prospect_sender_bindings(id),
 protected_lookup text NOT NULL, key_version integer NOT NULL, endpoint_id text NOT NULL REFERENCES prospect_endpoints(id),
 PRIMARY KEY(sender_binding_id,protected_lookup,key_version)
);
CREATE INDEX prospect_endpoint_alias_endpoint_idx ON prospect_endpoint_aliases(endpoint_id);
