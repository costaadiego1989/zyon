import { EmbedTokenService } from "../src/modules/embed/domain/embed-token.service.js";

const tokens = new EmbedTokenService({ value: Buffer.from("dev_embed_token_secret_32_characters_min!!") });
const now = Math.floor(Date.now() / 1000);

const merchantId = process.argv[2] ?? "mrc_demo";
const token = tokens.sign({
  typ: "aacp_embed_v1",
  merchantId,
  issuedAtUnix: now,
  expiresAtUnix: now + 3600,
  nonce: "n_smoke",
  scopes: ["checkout:track"],
  allowedOrigin: "http://localhost:8080"
});

const base = process.env.API_BASE ?? "http://localhost:3009";

async function runCase(name: string, body: Record<string, unknown>, expected: number) {
  const r = await fetch(`${base}/embed/customer/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "http://localhost:8080"
    },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  const ok = r.status === expected;
  console.log(`[${ok ? "OK" : "FAIL"}] ${name}: status=${r.status} expected=${expected} body=${text.slice(0, 200)}`);
  return ok;
}

const cases: Array<[string, Record<string, unknown>, number]> = [
  ["missing session_id", { customer: { fullName: "x", email: "x@y.com", cpf: "1" } }, 400],
  ["missing cpf", { session_id: "chk_x", customer: { fullName: "x", email: "x@y.com" } }, 400],
  ["unknown session", { session_id: "chk_missing_123", customer: { fullName: "x", email: "x@y.com", cpf: "1" } }, 401]
];

const results: boolean[] = [];
for (const [name, body, expected] of cases) {
  results.push(await runCase(name, body, expected));
}

const allPassed = results.every(Boolean);
console.log(`\n${results.filter(Boolean).length}/${results.length} cases passed`);
process.exit(allPassed ? 0 : 1);
