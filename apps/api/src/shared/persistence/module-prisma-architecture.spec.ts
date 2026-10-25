import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

test("Nest module roots use the global Prisma provider", () => {
  const modulesDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../src/modules",
  );
  const violations = collectModuleFiles(modulesDir).flatMap((file) =>
    findPrismaConstructionViolations(file, modulesDir),
  );

  assert.deepEqual(
    violations,
    [],
    `Module roots must inject PRISMA_CLIENT instead of creating clients:\n${violations.join("\n")}`,
  );
});

function collectModuleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectModuleFiles(path);
    return entry.name.endsWith(".module.ts") ? [path] : [];
  });
}

function findPrismaConstructionViolations(
  file: string,
  modulesDir: string,
): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const createClientBindings = new Set(["createPrismaClient"]);
  const prismaClientBindings = new Set(["PrismaClient"]);
  const violations = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;

    if (clause.name?.text === "createPrismaClient") {
      createClientBindings.add(clause.name.text);
      report(statement, "must not import createPrismaClient");
    }

    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }

    for (const specifier of clause.namedBindings.elements) {
      const importedName = specifier.propertyName?.text ?? specifier.name.text;
      if (importedName === "createPrismaClient") {
        createClientBindings.add(specifier.name.text);
        report(specifier, "must not import createPrismaClient");
      }
      if (importedName === "PrismaClient") {
        prismaClientBindings.add(specifier.name.text);
      }
    }
  }

  visit(sourceFile);
  return [...violations];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        createClientBindings.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "createPrismaClient"))
    ) {
      report(node, "must not call createPrismaClient");
    }

    if (
      ts.isNewExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        prismaClientBindings.has(node.expression.text)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "PrismaClient"))
    ) {
      report(node, "must not instantiate PrismaClient");
    }

    ts.forEachChild(node, visit);
  }

  function report(node: ts.Node, message: string): void {
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    violations.add(
      `${relative(modulesDir, file)}:${line + 1} ${message}`,
    );
  }
}
