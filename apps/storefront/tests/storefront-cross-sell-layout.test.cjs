const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
function visualAttributes(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && ["style", "className"].includes(node.name.getText(tree))) {
      result.push(node.getText(tree).replace(/\s+/g, " "));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); return result;
}
for (const name of ["CrossSellInterstitial.tsx", "blocks/CrossSellBlock.tsx", "blocks/RichProductContentRenderer.tsx"]) {
  test(`cross-sell candidate keeps every approved style/class attribute in ${name}`, () => {
    const relative = `apps/storefront/src/components/${name}`;
    const baseline = execFileSync("git", ["show", `HEAD:${relative}`], { cwd: root, encoding: "utf8", windowsHide: true });
    const current = fs.readFileSync(path.join(root, relative), "utf8");
    const before = visualAttributes(relative, baseline), after = visualAttributes(relative, current);
    assert.deepEqual(after, before);
    console.log(JSON.stringify({ file: relative, styleAndClassAttributesUnchanged: true,
      sha256: createHash("sha256").update(JSON.stringify(after)).digest("hex") }));
  });
}
