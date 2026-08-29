#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const WIDGET_V2_SRC = "apps/widget_v2/src";

function removeComments(content) {
  const lines = content.split("\n");
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Preserve JSDoc blocks and empty lines
    if (
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.endsWith("*/") ||
      trimmed === ""
    ) {
      result.push(line);
      continue;
    }

    // Remove lines that are ONLY comments (no code before //)
    if (trimmed.startsWith("//")) {
      continue;
    }

    // For lines with potential inline comments, be VERY careful:
    // Only remove // if it's NOT inside a string literal
    let cleanedLine = line;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let commentIndex = -1;

    for (let j = 0; j < line.length - 1; j++) {
      const char = line[j];
      const nextChar = line[j + 1];

      // Track string boundaries (basic escape handling)
      if (char === "'" && (j === 0 || line[j - 1] !== "\\")) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && (j === 0 || line[j - 1] !== "\\")) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === "`" && (j === 0 || line[j - 1] !== "\\")) {
        inBacktick = !inBacktick;
      }

      // If we found //, and we're NOT in any string, mark comment start
      if (
        char === "/" &&
        nextChar === "/" &&
        !inSingleQuote &&
        !inDoubleQuote &&
        !inBacktick
      ) {
        commentIndex = j;
        break;
      }
    }

    if (commentIndex >= 0) {
      cleanedLine = line.substring(0, commentIndex).trimEnd();
    }

    // Only push non-empty lines
    if (cleanedLine.trim() !== "") {
      result.push(cleanedLine);
    }
  }

  return result.join("\n");
}

function findFiles(dir, extensions = [".ts", ".tsx"]) {
  const files = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(path.join(currentPath, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(path.join(currentPath, entry.name));
        }
      }
    }
  }

  walk(dir);
  return files;
}

function removeCommentsFromDir(dirPath) {
  const files = findFiles(dirPath);

  let processedCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const cleaned = removeComments(content);

      if (content !== cleaned) {
        fs.writeFileSync(filePath, cleaned, "utf-8");
        console.log(`✓ ${filePath}`);
        processedCount++;
      } else {
        console.log(`⊘ ${filePath} (no changes needed)`);
        skippedCount++;
      }
    } catch (err) {
      console.error(`✗ ${filePath}: ${err.message}`);
    }
  }

  console.log(
    `\nSummary: ${processedCount} files cleaned, ${skippedCount} unchanged.`
  );
}

console.log(`Removing comments from ${WIDGET_V2_SRC}...\n`);
try {
  removeCommentsFromDir(WIDGET_V2_SRC);
  console.log("\n✓ Done!");
} catch (err) {
  console.error(`✗ Error: ${err.message}`);
  process.exit(1);
}
