import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseHomologationOptions,
  homologationDatabase,
  guardHomologationFetch,
  runHomologationCli,
} from "./fiscal-homologation.mjs";
const env = {
  FISCAL_TEST_DATABASE_URL:
    "postgresql://fiscal:local@127.0.0.1:25432/zyon_fiscal",
};
const args = [
  "--emit",
  "--provider",
  "focus",
  "--environment",
  "homologation",
  "--merchant",
  "merchant-local",
  "--sale",
  "intent-local",
  "--schema",
  "fiscal_test_" + "a".repeat(32),
  "--operation",
  "a".repeat(32),
];
test("FISCAL-04 homologation import performs no execution", () => {
  assert.equal(typeof runHomologationCli, "function");
  assert.equal(parseHomologationOptions([], {}).mode, "not_run");
});
test("FISCAL-04 homologation default does not load database or execute writes", async () => {
  let calls = 0;
  const result = await runHomologationCli([], {}, async () => {
    calls++;
    throw new Error("must not run");
  });
  assert.equal(result.code, 2);
  assert.equal(result.report.status, "not_run");
  assert.equal(calls, 0);
});
test("FISCAL-04 homologation help does not require credentials or DB", async () => {
  let calls = 0;
  const result = await runHomologationCli(["--help"], {}, async () => {
    calls++;
  });
  assert.equal(result.code, 0);
  assert.match(result.help, /--emit/);
  assert.equal(calls, 0);
});
test("FISCAL-04 homologation explicit production is rejected", () =>
  assert.throws(
    () =>
      parseHomologationOptions(
        args.map((x) => (x === "homologation" ? "production" : x)),
        env
      ),
    /homologation_only/
  ));
test("FISCAL-04 homologation arbitrary host option is rejected", () =>
  assert.throws(
    () =>
      parseHomologationOptions(
        [...args, "--provider-url", "https://evil.test"],
        env
      ),
    /arguments_invalid/
  ));
test("FISCAL-04 homologation requires an exact owned synthetic operation", () =>
  assert.throws(
    () => parseHomologationOptions(args.slice(0, -2), env),
    /operation_required/
  ));
test("FISCAL-04 homologation refuses public or arbitrary schema", () =>
  assert.throws(
    () =>
      parseHomologationOptions(
        args.map((x) => (x.startsWith("fiscal_test_") ? "public" : x)),
        env
      ),
    /owned_schema_required/
  ));
test("FISCAL-04 homologation remote DB fails before child loading", () =>
  assert.throws(
    () =>
      parseHomologationOptions(args, {
        FISCAL_TEST_DATABASE_URL:
          "postgresql://user@database.example/zyon_fiscal",
      }),
    /isolated_local_database/
  ));
test("FISCAL-04 homologation DB query override is rejected", () =>
  assert.throws(
    () => homologationDatabase(env.FISCAL_TEST_DATABASE_URL + "?host=remote"),
    /isolated_local_database/
  ));
test("FISCAL-04 homologation explicit preflight is read only", async () => {
  let mode;
  const result = await runHomologationCli(
    args.map((x) => (x === "--emit" ? "--preflight" : x)),
    env,
    async (options) => {
      mode = options.mode;
      return {
        code: 2,
        report: {
          status: "not_run",
          reason: "authenticated_inspection_required",
        },
      };
    }
  );
  assert.equal(mode, "preflight");
  assert.equal(result.report.status, "not_run");
  assert.equal(result.code, 2);
});
test("FISCAL-61 homologation errors redact private command diagnostics", async () => {
  const result = await runHomologationCli(args, env, async () => {
    throw new Error("private-token buyer@example.com xml");
  });
  assert.equal(result.code, 2);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
  assert.equal(result.report.status, "blocked");
});
test("FISCAL-04 Focus production host only permits company management GET", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    {
      provider: "focus",
      reference: "synthetic_nfe_original",
      companyId: "company-a",
    },
    async () => {
      calls++;
      return Response.json({});
    }
  );
  await f("https://api.focusnfe.com.br/v2/empresas/company-a", {
    method: "GET",
  });
  await assert.rejects(
    f("https://api.focusnfe.com.br/v2/nfe", { method: "POST" }),
    /network_forbidden/
  );
  assert.equal(calls, 1);
});
test("FISCAL-04 fiscal write cannot happen before authenticated environment", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    {
      provider: "focus",
      reference: "synthetic_nfe_original",
      companyId: "company-a",
    },
    async () => {
      calls++;
      return Response.json({});
    }
  );
  await assert.rejects(
    f("https://homologacao.focusnfe.com.br/v2/nfe?ref=synthetic_nfe_original", {
      method: "POST",
    }),
    /environment_unverified/
  );
  assert.equal(calls, 0);
});
test("FISCAL-04 Focus emission binds original reference and fixed homologation host", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    {
      provider: "focus",
      reference: "synthetic_nfe_original",
      companyId: "company-a",
      verified: () => true,
    },
    async () => {
      calls++;
      return Response.json({});
    }
  );
  await f(
    "https://homologacao.focusnfe.com.br/v2/nfe?ref=synthetic_nfe_original",
    { method: "POST" }
  );
  await assert.rejects(
    f("https://homologacao.focusnfe.com.br/v2/nfe?ref=foreign", {
      method: "POST",
    }),
    /network_forbidden/
  );
  assert.equal(calls, 1);
});
test("FISCAL-61 guarded transport never follows credential redirects", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    { provider: "focus", reference: "r", companyId: "company-a" },
    async (_u, init) => {
      calls++;
      assert.equal(init.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.test" },
      });
    }
  );
  await assert.rejects(
    f("https://api.focusnfe.com.br/v2/empresas/company-a"),
    /redirect_forbidden/
  );
  assert.equal(calls, 1);
});
test("FISCAL-61 customer communication endpoints and recipient email payloads are forbidden", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    {
      provider: "focus",
      reference: "r",
      companyId: "company-a",
      verified: () => true,
    },
    async () => {
      calls++;
      return Response.json({});
    }
  );
  await assert.rejects(
    f("https://api.resend.com/emails", { method: "POST" }),
    /network_forbidden/
  );
  await assert.rejects(
    f("https://homologacao.focusnfe.com.br/v2/nfe?ref=r", {
      method: "POST",
      body: JSON.stringify({ email_destinatario: "buyer@example.invalid" }),
    }),
    /communications_forbidden/
  );
  assert.equal(calls, 0);
});
test("FISCAL-04 Omie demo response cannot manufacture environment verification", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    { provider: "omie", reference: "r", verified: () => false },
    async () => {
      calls++;
      return Response.json({});
    }
  );
  await f("https://app.omie.com.br/api/v1/geral/empresas/", {
    method: "POST",
    body: JSON.stringify({ call: "ListarEmpresas" }),
  });
  await assert.rejects(
    f("https://app.omie.com.br/api/v1/produtos/pedido/", {
      method: "POST",
      body: JSON.stringify({ call: "IncluirPedido" }),
    }),
    /environment_unverified/
  );
  assert.equal(calls, 1);
});
test("FISCAL-61 actual default CLI is not_run with non-success exit and no credentials", () => {
  const p = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./fiscal-homologation.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    }
  );
  assert.equal(p.status, 2);
  assert.equal(JSON.parse(p.stdout).status, "not_run");
  assert.equal(p.stderr, "");
});
test("FISCAL-61 homologation does not send company credentials to alternate service ports", async () => {
  let calls = 0;
  const f = guardHomologationFetch(
    { provider: "focus", reference: "r", companyId: "company-a" },
    async () => {
      calls++;
      return Response.json({});
    }
  );
  await assert.rejects(
    f("https://api.focusnfe.com.br:8443/v2/empresas/company-a"),
    /network_forbidden/
  );
  assert.equal(calls, 0);
});
