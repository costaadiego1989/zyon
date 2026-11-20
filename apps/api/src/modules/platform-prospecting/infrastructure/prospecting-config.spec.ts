import assert from "node:assert/strict";
import { test } from "node:test";
import { loadProspectingConfig } from "./prospecting-config.js";

test("PROS-02 AC1 empty configuration disables Meta sends, paid ingestion and real LLM", () => {
  const config = loadProspectingConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.metaSendEnabled, false);
  assert.equal(config.ingestionEnabled, false);
  assert.equal(config.paidIngestionEnabled, false);
  assert.equal(config.llmRealEnabled, false);
  assert.equal(config.databaseUrl, null);
  assert.equal(config.directoryDatabaseUrl, null);
  assert.equal(config.neo4jReadUri, null);
  assert.equal(config.neo4jIngestUri, null);
  assert.equal(config.campaignDailyLimit, null);
  assert.equal(config.campaignBudgetCents, null);
  assert.deepEqual(config.allowedKnowledgeOperations, ["explain_feature", "compare_plans", "answer_faq", "integration_capability"]);
});

test("PROS-02 AC1 explicit feature flags enable only their configured capabilities", () => {
  const database = "postgresql://fixture:local@127.0.0.1:15438/zyon_prospecting";
  const config = loadProspectingConfig({
    PROSPECTING_ENABLED: "true", PROSPECTING_DATABASE_URL: database,
    PROSPECTING_DIRECTORY_DATABASE_URL: database + "?schema=company_directory",
    PROSPECTING_META_SEND_ENABLED: "true", PROSPECTING_SENDER_ENCRYPTION_KEY: "a".repeat(64),
    PROSPECTING_SUPPRESSION_HMAC_KEY: "b".repeat(64), PROSPECTING_SUPPRESSION_KEY_VERSION: "1",
    PROSPECTING_CURSOR_HMAC_KEY: "c".repeat(64),
    PROSPECTING_INGESTION_ENABLED: "true", PROSPECTING_PAID_INGESTION_ENABLED: "true",
    PROSPECTING_LLM_REAL_ENABLED: "true", PROSPECTING_LLM_MAX_COST_CENTS: "50",
    PROSPECTING_NEO4J_READ_URI: "bolt://127.0.0.1:17690", PROSPECTING_NEO4J_READ_USER: "reader",
    PROSPECTING_NEO4J_READ_PASSWORD: "local-reader", PROSPECTING_NEO4J_INGEST_URI: "bolt://127.0.0.1:17690",
    PROSPECTING_NEO4J_INGEST_USER: "writer", PROSPECTING_NEO4J_INGEST_PASSWORD: "local-writer",
  });
  assert.equal(config.metaSendEnabled, true); assert.equal(config.ingestionEnabled, true);
  assert.equal(config.paidIngestionEnabled, true); assert.equal(config.llmRealEnabled, true);
  assert.equal(config.llmMaximumCostCents, 50);
  assert.equal(config.databaseUrl, database);
  assert.equal(config.directoryDatabaseUrl, database + "?schema=company_directory");
});

test("PROS-02 AC2 invalid required configuration fails config_invalid without tenant fallback", () => {
  const invalid = [
    { PROSPECTING_META_SEND_ENABLED: "yes" },
    { PROSPECTING_ENABLED: "true", DATABASE_URL: "postgresql://tenant:secret@remote.example/shop" },
    { PROSPECTING_DATABASE_URL: "https://database.example" },
    { PROSPECTING_IMPORT_BATCH_SIZE: "0" }, { PROSPECTING_IMPORT_BATCH_SIZE: "1.5" },
    { PROSPECTING_IMPORT_BATCH_SIZE: "100001" }, { PROSPECTING_IMPORT_MAX_EXPANDED_BYTES: "NaN" },
    { PROSPECTING_IMPORT_MAX_FILE_BYTES: "9007199254740992" },
    { PROSPECTING_SUPPRESSION_HMAC_KEY: "short" }, { PROSPECTING_SUPPRESSION_KEY_VERSION: "0" },
    { PROSPECTING_META_SEND_ENABLED: "true" }, { PROSPECTING_LLM_REAL_ENABLED: "true" },
    { PROSPECTING_NEO4J_READ_URI: "https://graph.example" },
    { PROSPECTING_DATABASE_URL: "postgresql://u:p@127.0.0.1/crm", PROSPECTING_DIRECTORY_DATABASE_URL: "postgresql://u:p@127.0.0.1/other" },
  ];
  for (const env of invalid) assert.throws(() => loadProspectingConfig(env), { message: /^config_invalid:/ });
  const config = loadProspectingConfig({ DATABASE_URL: "postgresql://tenant:secret@remote.example/shop", NEO4J_URI: "bolt://merchant.example:7687", OPENAI_API_KEY: "tenant-key" });
  assert.equal(config.databaseUrl, null); assert.equal(config.directoryDatabaseUrl, null); assert.equal(config.neo4jReadUri, null);
  assert.equal(config.llmRealEnabled, false);
});
