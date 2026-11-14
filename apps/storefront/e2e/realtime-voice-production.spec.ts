import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { expect, test } from "@playwright/test";

const url = process.env.ZYON_VOICE_PRODUCTION_URL;

test("deployed voice uses server admission and keeps summary separate @voice", async () => {
  test.skip(!url, "Opt in with ZYON_VOICE_PRODUCTION_URL; this uses real provider credits.");
  test.setTimeout(150_000);
  const result = await promisify(execFile)(process.execPath, [path.resolve(__dirname, "../../../scripts/verify-realtime-live.mjs")], {
    env: { ...process.env, ZYON_VOICE_URL: url }, timeout: 140_000,
  });
  const evidence = JSON.parse(result.stdout.trim());
  expect(evidence.result).toBe("PASS");
  expect(evidence.directProviderRequests).toBe(0);
  expect(evidence.transport.audioBytes).toBeGreaterThan(0);
});
