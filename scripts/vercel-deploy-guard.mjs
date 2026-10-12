const allowedBranches = new Set(["master", "homolog"]);
const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim();

// Vercel ignores a deployment when ignoreCommand exits 0. A local/manual
// production upload has no trusted Git branch metadata, so it is deliberately
// ignored instead of being allowed to move a public alias by accident.
if (!branch || !allowedBranches.has(branch)) {
  console.log(`Skipping Vercel deployment for ${branch || "an unverified source"}. Allowed branches: master, homolog.`);
  process.exit(0);
}

console.log(`Allowing Vercel deployment from ${branch}.`);
process.exit(1);
