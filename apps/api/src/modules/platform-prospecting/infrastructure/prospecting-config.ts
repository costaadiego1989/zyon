type Environment = Readonly<Record<string, string | undefined>>;

export function loadProspectingConfig(env: Environment = process.env) {
  const invalid = (field: string): never => { throw new Error(`config_invalid:${field}`); };
  const text = (name: string) => env[`PROSPECTING_${name}`]?.trim() || null;
  const flag = (name: string) => {
    const value = text(name);
    if (value !== null && value !== "true" && value !== "false") invalid(name);
    return value === "true";
  };
  const integer = (name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) => {
    const raw = text(name);
    if (raw !== null && !/^\d+$/.test(raw)) invalid(name);
    const value = raw === null ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) invalid(name);
    return value;
  };
  const url = (name: string, protocols: readonly string[]) => {
    const value = text(name);
    if (value === null) return null;
    try {
      const parsed = new URL(value);
      if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.hash) invalid(name);
    } catch { invalid(name); }
    return value;
  };
  const key = (name: string) => {
    const value = text(name);
    if (value !== null && !/^[0-9a-fA-F]{64}$/.test(value)) invalid(name);
    return value;
  };
  const enabled = flag("ENABLED");
  const metaSendEnabled = flag("META_SEND_ENABLED");
  const ingestionEnabled = flag("INGESTION_ENABLED");
  const paidIngestionEnabled = flag("PAID_INGESTION_ENABLED");
  const llmRealEnabled = flag("LLM_REAL_ENABLED");
  const databaseUrl = url("DATABASE_URL", ["postgresql:", "postgres:"]);
  const directoryDatabaseUrl = url("DIRECTORY_DATABASE_URL", ["postgresql:", "postgres:"]);
  const neo4jReadUri = url("NEO4J_READ_URI", ["bolt:", "bolt+s:", "neo4j:", "neo4j+s:"]);
  const neo4jIngestUri = url("NEO4J_INGEST_URI", ["bolt:", "bolt+s:", "neo4j:", "neo4j+s:"]);
  const senderEncryptionKey = key("SENDER_ENCRYPTION_KEY");
  const suppressionHmacKey = key("SUPPRESSION_HMAC_KEY");
  const cursorHmacKey = key("CURSOR_HMAC_KEY");
  const suppressionKeyVersion = integer("SUPPRESSION_KEY_VERSION", 1);
  const llmMaximumCostCents = text("LLM_MAX_COST_CENTS") === null ? null : integer("LLM_MAX_COST_CENTS", 1);
  if (databaseUrl && directoryDatabaseUrl) assertSameProspectingDatabase(databaseUrl, directoryDatabaseUrl);
  if (enabled && (!databaseUrl || !directoryDatabaseUrl || !suppressionHmacKey || !cursorHmacKey || !neo4jReadUri || !neo4jIngestUri || !text("NEO4J_READ_USER") || !text("NEO4J_READ_PASSWORD") || !text("NEO4J_INGEST_USER") || !text("NEO4J_INGEST_PASSWORD"))) invalid("required_runtime_dependencies");
  if (metaSendEnabled && (!enabled || !senderEncryptionKey)) invalid("META_SEND_ENABLED");
  if ((ingestionEnabled || paidIngestionEnabled || llmRealEnabled) && !enabled) invalid("ENABLED");
  if (paidIngestionEnabled && !ingestionEnabled) invalid("PAID_INGESTION_ENABLED");
  if (llmRealEnabled && llmMaximumCostCents === null) invalid("LLM_MAX_COST_CENTS");
  if (new Set([senderEncryptionKey, suppressionHmacKey, cursorHmacKey].filter(Boolean)).size !== [senderEncryptionKey, suppressionHmacKey, cursorHmacKey].filter(Boolean).length) invalid("separate_keys_required");
  return Object.freeze({
    enabled, metaSendEnabled, ingestionEnabled, paidIngestionEnabled, llmRealEnabled,
    databaseUrl, directoryDatabaseUrl, neo4jReadUri, neo4jIngestUri,
    neo4jReadUser: text("NEO4J_READ_USER"), neo4jReadPassword: text("NEO4J_READ_PASSWORD"),
    neo4jIngestUser: text("NEO4J_INGEST_USER"), neo4jIngestPassword: text("NEO4J_INGEST_PASSWORD"),
    senderEncryptionKey, suppressionHmacKey, cursorHmacKey, suppressionKeyVersion,
    importBatchSize: integer("IMPORT_BATCH_SIZE", 1_000, 100_000),
    importMaximumFileBytes: integer("IMPORT_MAX_FILE_BYTES", 10 * 1024 ** 3),
    importMaximumExpandedBytes: integer("IMPORT_MAX_EXPANDED_BYTES", 100 * 1024 ** 3),
    importMaximumEntries: integer("IMPORT_MAX_ENTRIES", 100, 10_000),
    importMaximumLineBytes: integer("IMPORT_MAX_LINE_BYTES", 1_048_576),
    importMaximumMemoryBytes: integer("IMPORT_MAX_MEMORY_BYTES", 256 * 1024 ** 2),
    importMinimumFreeDiskBytes: integer("IMPORT_MIN_FREE_DISK_BYTES", 10 * 1024 ** 3),
    importConcurrency: integer("IMPORT_CONCURRENCY", 1, 4), directoryPoolSize: integer("DIRECTORY_POOL_SIZE", 2, 20),
    knowledgeMaximumFacts: integer("KNOWLEDGE_MAX_FACTS", 10, 10), knowledgeTimeoutMs: integer("KNOWLEDGE_TIMEOUT_MS", 5_000, 60_000),
    llmTimeoutMs: integer("LLM_TIMEOUT_MS", 30_000, 120_000), llmMaximumCostCents,
    retentionDays: 180 as const, campaignDailyLimit: null, campaignBudgetCents: null,
    allowedKnowledgeOperations: ["explain_feature", "compare_plans", "answer_faq", "integration_capability"] as const,
  });
}

/** Credentials/pool/schema may differ; host, port and database must identify one DB. */
export function assertSameProspectingDatabase(crmUrl: string, directoryUrl: string): void {
  const crm = new URL(crmUrl); const directory = new URL(directoryUrl);
  const hostname = (url: URL) => url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  if (hostname(crm) !== hostname(directory) || (crm.port || "5432") !== (directory.port || "5432") || crm.pathname !== directory.pathname) throw new Error("config_invalid:directory_database_mismatch");
}
export type ProspectingConfig = ReturnType<typeof loadProspectingConfig>;
