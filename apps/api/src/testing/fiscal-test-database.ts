/** Reject DSN query overrides as well as remote hosts before any connection. */
export function parseFiscalTestDatabaseUrl(value: string | undefined): URL {
  let url: URL;
  try { url = new URL(value ?? ""); }
  catch { throw new Error("fiscal_fixture_requires_isolated_local_database"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/zyon_fiscal" || url.search || url.hash) {
    throw new Error("fiscal_fixture_requires_isolated_local_database");
  }
  return url;
}
