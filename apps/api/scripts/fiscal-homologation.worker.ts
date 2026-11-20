import { PrismaClient } from "@prisma/client";
import { parseFiscalTestDatabaseUrl } from "../src/testing/fiscal-test-database.js";
import {
  executeFiscalHomologation,
  type FiscalHomologationOperation,
} from "../src/modules/fiscal/infrastructure/fiscal-homologation.js";
const main = async () => {
  let prisma: PrismaClient | undefined;
  try {
    const operation = JSON.parse(
      process.argv[2] ?? "null"
    ) as FiscalHomologationOperation;
    const database = parseFiscalTestDatabaseUrl(
      process.env.FISCAL_TEST_DATABASE_URL
    );
    if (
      !operation ||
      !/^(?:fiscal_test_|fiscal_hml_)[a-f0-9]{32}$/.test(operation.schema)
    )
      throw Error("fiscal_homologation_owned_schema_required");
    database.searchParams.set("schema", operation.schema);
    prisma = new PrismaClient({
      datasources: { db: { url: database.toString() } },
    });
    const { guardHomologationFetch } = await import(
      "./fiscal-homologation.mjs"
    );
    const result = await executeFiscalHomologation(prisma, operation, {
      guard: guardHomologationFetch,
    });
    process.stdout.write(JSON.stringify(result.report) + "\n");
    process.exitCode = result.code;
  } catch (error) {
    const reason =
      error instanceof Error && /^fiscal_[a-z_]+$/.test(error.message)
        ? error.message
        : "fiscal_homologation_blocked";
    process.stdout.write(JSON.stringify({ status: "blocked", reason }) + "\n");
    process.exitCode = 2;
  } finally {
    await prisma?.$disconnect();
  }
};
void main();
