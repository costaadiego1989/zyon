// @ts-check
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const EXTS = new Set([".ts", ".tsx"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

/**
 * Collects genuine comment ranges from the parsed AST. Walking real nodes and
 * asking for their leading/trailing comment trivia means `//` or `/* *\/` inside
 * JSX text, string literals, template literals, and regex are never collected —
 * only grammar-level comment trivia is.
 */
function collectCommentRanges(source, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const seen = new Set();
  const ranges = [];
  const add = (list) => {
    if (!list) return;
    for (const r of list) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(r);
    }
  };

  const visit = (node) => {
    add(ts.getLeadingCommentRanges(source, node.getFullStart()));
    add(ts.getTrailingCommentRanges(source, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(sf);

  ranges.sort((a, b) => a.pos - b.pos);
  return ranges;
}

function stripComments(source, fileName) {
  const ranges = collectCommentRanges(source, fileName);
  if (ranges.length === 0) return { code: source, changed: false };

  let code = source;
  for (let i = ranges.length - 1; i >= 0; i--) {
    code = code.slice(0, ranges[i].pos) + code.slice(ranges[i].end);
  }

  const lines = code.split("\n");
  const originalLines = source.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const wasContent =
      i < originalLines.length && originalLines[i].trim().length > 0;
    if (line.trim().length === 0 && wasContent) continue;
    kept.push(line.replace(/[ \t]+$/, ""));
  }

  let result = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!result.endsWith("\n")) result += "\n";
  return { code: result, changed: result !== source };
}

const files = walk(SRC_ROOT);
let changed = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const { code, changed: c } = stripComments(src, file);
  if (c) {
    writeFileSync(file, code, "utf8");
    changed++;
  }
}
console.log(`Processed ${files.length} files. Modified ${changed}.`);
