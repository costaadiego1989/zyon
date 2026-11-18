import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Own the local server so neither CI nor a developer can accidentally point
// these browser proofs at a merchant's deployed checkout.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("widget_test_listener_missing");
  const target = `http://127.0.0.1:${address.port}`;
  for (const script of ["payment-choice.browser.cjs", "fiscal-current-checkout.browser.mjs"]) {
    const exitCode = await new Promise(resolve => {
      const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
        cwd: root,
        env: { ...process.env, WIDGET_TEST_URL: target },
        stdio: "inherit",
      });
      child.once("error", () => resolve(1));
      child.once("close", code => resolve(code ?? 1));
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      break;
    }
  }
} finally {
  await server.close();
}
