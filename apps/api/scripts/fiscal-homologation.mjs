import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export function homologationDatabase(value) {
  let u;
  try {
    u = new URL(value ?? "");
  } catch {
    throw Error("fiscal_fixture_requires_isolated_local_database");
  }
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    u.pathname !== "/zyon_fiscal" ||
    u.search ||
    u.hash
  )
    throw Error("fiscal_fixture_requires_isolated_local_database");
  return u;
}
export function parseHomologationOptions(args, env) {
  if (args.includes("--help")) return { mode: "help" };
  if (!args.length) return { mode: "not_run" };
  const values = {};
  let mode;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (["--emit", "--preflight"].includes(key)) {
      if (mode) throw Error("fiscal_homologation_arguments_invalid");
      mode = key.slice(2);
      continue;
    }
    if (
      ![
        "--provider",
        "--environment",
        "--merchant",
        "--sale",
        "--schema",
        "--operation",
      ].includes(key) ||
      values[key] ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("fiscal_homologation_arguments_invalid");
    values[key] = args[++i];
  }
  if (!mode) throw Error("fiscal_homologation_explicit_mode_required");
  if (values["--environment"] !== "homologation")
    throw Error("fiscal_homologation_only");
  if (!["focus", "bling", "omie", "tiny"].includes(values["--provider"]))
    throw Error("fiscal_homologation_provider_required");
  if (
    !/^(?:fiscal_test_|fiscal_hml_)[a-f0-9]{32}$/.test(values["--schema"] ?? "")
  )
    throw Error("fiscal_homologation_owned_schema_required");
  if (!/^[a-f0-9]{32}$/.test(values["--operation"] ?? ""))
    throw Error("fiscal_homologation_operation_required");
  if (
    ![values["--merchant"], values["--sale"]].every(
      (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(v)
    )
  )
    throw Error("fiscal_homologation_binding_required");
  homologationDatabase(env.FISCAL_TEST_DATABASE_URL);
  return {
    mode,
    provider: values["--provider"],
    environment: "homologation",
    merchantId: values["--merchant"],
    intentId: values["--sale"],
    schema: values["--schema"],
    operationId: values["--operation"],
  };
}
/** Runner-only transport boundary. Ordinary delivery/provider bindings are untouched. */
export function guardHomologationFetch(binding, transport = fetch) {
  return async (input, init = {}) => {
    const u = new URL(String(input)),
      method = (init.method ?? "GET").toUpperCase();
    if (
      u.protocol !== "https:" ||
      (u.port && u.port !== "443") ||
      u.username ||
      u.password ||
      u.hash
    )
      throw Error("fiscal_homologation_network_forbidden");
    const host =
      {
        focus: ["homologacao.focusnfe.com.br", "api.focusnfe.com.br"],
        bling: ["api.bling.com.br"],
        omie: ["app.omie.com.br"],
        tiny: ["api.tiny.com.br", "accounts.tiny.com.br"],
      }[binding.provider] ?? [];
    if (!host.includes(u.hostname))
      throw Error("fiscal_homologation_network_forbidden");
    if (
      binding.provider === "focus" &&
      u.hostname === "api.focusnfe.com.br" &&
      (method !== "GET" ||
        u.pathname !==
          `/v2/empresas/${encodeURIComponent(binding.companyId ?? "")}`)
    )
      throw Error("fiscal_homologation_network_forbidden");
    const body = typeof init.body === "string" ? init.body : "";
    if (
      /"(?:email_destinatario|emailNfe|utilizar_emails)"\s*:\s*"[^\"]+"|"(?:enviar_email|enviarEmail)"\s*:\s*(?:"S"|true)/.test(
        body
      )
    )
      throw Error("fiscal_homologation_communications_forbidden");
    const rpcRead =
      binding.provider === "omie" &&
      method === "POST" &&
      /"call"\s*:\s*"(?:Consultar|Listar|Obter|Validar)[A-Za-z]+"/.test(body);
    const refresh =
      method === "POST" &&
      ((binding.provider === "tiny" &&
        u.hostname === "accounts.tiny.com.br" &&
        u.pathname === "/realms/tiny/protocol/openid-connect/token") ||
        (binding.provider === "bling" &&
          u.pathname === "/Api/v3/oauth/token") ||
        (binding.provider === "omie" &&
          /^\/api\/portal\/apps\/[A-Za-z0-9_-]+\/refresh-token\/$/.test(
            u.pathname
          )));
    if (!["GET", "HEAD"].includes(method) && !rpcRead && !refresh) {
      if (!binding.verified?.())
        throw Error("fiscal_homologation_environment_unverified");
      if (method === "DELETE")
        throw Error("fiscal_homologation_cancellation_not_authorized");
      if (
        binding.provider === "focus" &&
        (method !== "POST" ||
          u.hostname !== "homologacao.focusnfe.com.br" ||
          u.pathname !== "/v2/nfe" ||
          u.searchParams.get("ref") !== binding.reference)
      )
        throw Error("fiscal_homologation_network_forbidden");
    }
    const response = await transport(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400)
      throw Error("fiscal_homologation_redirect_forbidden");
    return response;
  };
}
async function child(options, env) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return await new Promise((resolveChild) => {
    const childEnv = {
      ...env,
      REDIS_URL: "",
      REDIS_ENABLED: "false",
      BILLING_TRIAL_QUEUE_REQUIRED: "false",
    };
    delete childEnv.NODE_TEST_CONTEXT;
    const p = spawn(
      process.execPath,
      [
        "--loader",
        "./apps/api/tests/platform-support-loader.mjs",
        "./apps/api/scripts/fiscal-homologation.worker.ts",
        JSON.stringify(options),
      ],
      {
        cwd: root,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    let output = "";
    p.stdout.on("data", (b) => {
      if (output.length < 32000) output += b;
    });
    p.stderr.on("data", () => {});
    p.on("error", () =>
      resolveChild({
        code: 2,
        report: {
          status: "blocked",
          reason: "fiscal_homologation_runtime_unavailable",
        },
      })
    );
    p.on("close", (code) => {
      try {
        const report = JSON.parse(output.trim());
        resolveChild({ code: code ?? 2, report });
      } catch {
        resolveChild({
          code: 2,
          report: {
            status: "blocked",
            reason: "fiscal_homologation_runtime_unavailable",
          },
        });
      }
    });
  });
}
export async function runHomologationCli(
  args,
  env = process.env,
  execute = (options) => child(options, env)
) {
  try {
    const options = parseHomologationOptions(args, env);
    if (options.mode === "help")
      return {
        code: 0,
        help: "Read-only: --preflight --provider focus|bling|omie|tiny --environment homologation --merchant ID --sale INTENT --schema fiscal_hml_<32hex> --operation <32hex>. Emit only with --emit and the same exact prepared synthetic operation. No account setup, customer messages or cancellation.",
      };
    if (options.mode === "not_run")
      return {
        code: 2,
        report: {
          status: "not_run",
          reason: "explicit_emit_and_prepared_setup_required",
        },
      };
    return await execute(options);
  } catch (error) {
    const code =
      error instanceof Error &&
      /^(fiscal_(?:homologation|fixture)_[a-z_]+)$/.test(error.message)
        ? error.message
        : "fiscal_homologation_blocked";
    return { code: 2, report: { status: "blocked", reason: code } };
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await runHomologationCli(process.argv.slice(2));
  process.stdout.write(
    result.help ? result.help + "\n" : JSON.stringify(result.report) + "\n"
  );
  process.exitCode = result.code;
}
