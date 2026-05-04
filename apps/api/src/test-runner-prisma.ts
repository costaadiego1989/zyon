process.env.AACP_RUN_PRISMA_TESTS = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:55432/aacp_test?schema=public";

await import("./test-runner.js");
