import ts from "typescript";

// Only platform plumbing is inherited. No application credential, endpoint,
// integration gate, .env option, or injected Node loader reaches test workers.
export function createTestEnvironment(source) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "systemdrive", "temp", "tmp", "tmpdir", "tz"]);
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined));
  return { ...env, NODE_ENV: "test", AACP_RUN_PRISMA_TESTS: "0", RUN_REAL_AI_E2E: "false", E2E_SEED_ENABLED: "false" };
}

function disabledSeedRegistration(statement, source) {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  const condition = statement.expression;
  if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
      condition.left.getText(source) !== "process.env.E2E_SEED_ENABLED" ||
      !ts.isStringLiteral(condition.right) || condition.right.text !== "true") return false;
  const block = statement.thenStatement;
  if (!ts.isBlock(block) || block.statements.length !== 1 || !ts.isExpressionStatement(block.statements[0])) return false;
  const awaited = block.statements[0].expression;
  if (!ts.isAwaitExpression(awaited) || !ts.isCallExpression(awaited.expression)) return false;
  const call = awaited.expression;
  return call.expression.kind === ts.SyntaxKind.ImportKeyword && call.arguments.length === 1 &&
    ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === "./modules/__test__/test-seed.controller.spec.js";
}

export function collectTestImports(text) {
  const source = ts.createSourceFile("test-runner.js", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error("invalid_test_manifest_syntax");
  const files = [];
  for (const statement of source.statements) {
    if (disabledSeedRegistration(statement, source)) continue;
    if (!ts.isImportDeclaration(statement) || statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
      throw new Error("unsupported_test_manifest_statement");
    }
    const name = statement.moduleSpecifier.text;
    if (!name.startsWith("./") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "") ||
        ![".spec.js", "-spec.js"].some((ending) => name.endsWith(ending)) || files.includes(name)) {
      throw new Error("invalid_test_manifest_registration");
    }
    files.push(name);
  }
  if (!files.length) throw new Error("empty_test_manifest");
  return files;
}
