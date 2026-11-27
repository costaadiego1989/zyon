export async function prospectingMigrationPlan(env) {
  const enabled = env.PROSPECTING_ENABLED?.trim() || undefined;
  if (enabled !== undefined && enabled !== "true" && enabled !== "false")
    throw new Error("config_invalid:PROSPECTING_ENABLED");
  if (enabled !== "true") return null;
  if (!env.DATABASE_URL || !env.PROSPECTING_DIRECTORY_DATABASE_URL)
    throw new Error("prospecting_migration_database_required");
  const { assertSameProspectingDatabase } = await import("../dist/modules/platform-prospecting/infrastructure/prospecting-config.js");
  assertSameProspectingDatabase(env.DATABASE_URL, env.PROSPECTING_DIRECTORY_DATABASE_URL);
  const directory = new URL(env.PROSPECTING_DIRECTORY_DATABASE_URL);
  if (directory.searchParams.get("schema") !== "company_directory")
    throw new Error("prospecting_migration_schema_invalid");
  return ["migrate", "deploy", "--config", "prisma.company-directory.config.ts"];
}
