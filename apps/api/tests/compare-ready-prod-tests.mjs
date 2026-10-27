import fs from "node:fs";

const [baselinePath, currentPath, outputPath] = process.argv.slice(2);
if (!baselinePath || !currentPath || !outputPath) throw new Error("Usage: node compare-ready-prod-tests.mjs BASELINE_LOG CURRENT_LOG OUTPUT_JSON");
function read(filename) {
  const bytes = fs.readFileSync(filename);
  return bytes[0] === 255 && bytes[1] === 254 ? bytes.toString("utf16le") : bytes.toString("utf8");
}
function extract(filename) {
  const log = read(filename);
  const summary = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped"]) {
    const matches = [...log.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, "gm"))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP summary ${key}: ${filename}`);
    summary[key] = Number(matches[0][1]);
  }
  if (summary.tests < 1 || summary.tests !== summary.pass + summary.fail + summary.cancelled + summary.skipped) throw new Error(`Invalid TAP summary: ${filename}`);
  const failureNames = [...new Set([...log.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1].trim()))].sort();
  if (summary.fail > 0 && failureNames.length === 0) throw new Error(`No failure names parsed: ${filename}`);
  return { summary, failureNames };
}
const baseline = extract(baselinePath);
const current = extract(currentPath);
fs.writeFileSync(outputPath, JSON.stringify({ baseline, current,
  onlyCurrent: current.failureNames.filter((name) => !baseline.failureNames.includes(name)),
  onlyBaseline: baseline.failureNames.filter((name) => !current.failureNames.includes(name)),
  limitation: "Compares TAP failure names, including suite parents. This is not proof of no regression outside the selected tests or within duplicate test names.",
}, null, 2) + "\n");
