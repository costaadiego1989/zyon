/** Runs before Playwright terminates its Windows webServer process tree. */
export default async function fiscalGlobalTeardown() {
  const response = await fetch("http://127.0.0.1:3024/v1/__close", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || (await response.json()).closed !== true)
    throw new Error("fiscal_browser_fixture_cleanup_failed");
}
