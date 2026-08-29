import fs from "fs";
import path from "path";
import { glob } from "glob";

const WIDGET_V2_SRC = "apps/widget_v2/src";

function removeComments(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
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

    // Remove lines that start with // (inline comments)
    if (trimmed.startsWith("//")) {
      // Skip the entire line if it's a pure comment
      continue;
    }

    // Remove inline comments: "code // comment" → "code"
    const beforeComment = line.split("//")[0];

    // Only keep the line if there's actual code before the comment
    if (beforeComment.trim() !== "") {
      result.push(beforeComment.trimEnd());
    } else if (beforeComment === line) {
      // No comment found, keep original line
      result.push(line);
    }
  }

  return result.join("\n");
}

async function removeCommentsFromDir(dirPath: string): Promise<void> {
  const files = await glob(`${dirPath}/**/*.{ts,tsx}`, {
    ignore: ["**/node_modules/**", "**/*.spec.ts", "**/*.test.ts"],
  });

  let processedCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const cleaned = removeComments(content);

      // Only write if content changed (idempotent safety check)
      if (content !== cleaned) {
        fs.writeFileSync(filePath, cleaned, "utf-8");
        console.log(`✓ ${filePath}`);
        processedCount++;
      } else {
        console.log(`⊘ ${filePath} (no changes needed)`);
        skippedCount++;
      }
    } catch (err) {
      console.error(`✗ ${filePath}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nSummary: ${processedCount} files cleaned, ${skippedCount} unchanged.`
  );
}

async function main() {
  console.log(`Removing comments from ${WIDGET_V2_SRC}...\n`);
  await removeCommentsFromDir(WIDGET_V2_SRC);
  console.log("\n✓ Done!");
}

main().catch(console.error);
