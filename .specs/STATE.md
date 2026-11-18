## Handoff









- Release worktree C:/tmp/zyon-agentic-homolog-20261117, branch release/agentic-homolog-20261117. User authorized: "suba para homolog e valide o que falta par promovermos para prod", then "outro agentes realizou melhorias de bugs pegue sempre a versao mais recente". Production promotion is not authorized here.
- Base117d2d08 is the latest published checkout/WhatsApp/shipping fix and the currently served API source in sandbox and production, rechecked against origin. Integrate agentic feature5b432a9a on top; preserve original dirty checkout and local unfinished unrelated feature branches.
- Two merge conflicts resolved by retaining both protections: all authentication-template types from latest source and campaign-specific template revision digest; both shared-type exports retained. Prisma auto-merge reviewed. Add idempotent product flag migration matching current Prisma defaults; homolog already has those columns, existing values stay untouched.
- Local API build0. Initial API666cases:665pass/1fixture schema failure for newer Product flags. Fixture aligned with canonical columns without changing any expected value; full affected catalog file5/5. Templates35/35, UI215/215, dashboard build0 and migration defaults/idempotence probe0. Final full API rerun is still owed at the merged revision; do not report an initial666/666 pass.
- NEXT: commit merge and push unique release branch; stage source pins for ONLY sandbox API/dashboard at the same SHA, preserve production117d2d08, review patch before accept-deploy. Start final full API rerun while cloud builds; verify source/SUCCESS/ready/migrations and real browser/authenticated QA with actual services.
- Sandbox target project b8421237-6557-4677-a08c-c93453b08568, environment a347216c-86e3-4a75-8d73-5ae6e122408c. Previous live API6f4fdc8d / dashboard5fad0a66. No existing staged patch. Guard against concurrent changes immediately before deployment.
- Read-only inventory: sandbox and production DB connection strings differ. Athom showroom in sandbox has no user/membership; use a separate marked QA tenant/session rather than altering that store or copying production credentials. QA entitlement is synthetic and must be reported as such; no billing/payment/ad activation/WhatsApp send proof claimed. Session material stays private and is revoked after validation.
- Promotion gaps identified: missing sandbox Meta-specific OAuth/encryption configuration; commercial checkout disabled, benchmark0of40, current server offer stillR149/month and rejects zero; real provider/merchant authorization, administrative template/consent and daily metrics/automation must be validated before production. Do not fabricate benchmark evidence or enable writes to make tests pass. Other-page engine work stays with its other agent.
- Audit files .audit/agentic-homolog-20261117 are ignored. No secrets in commit, output or screenshots. MCP is preferred; existing authenticated CLI/SSH only where MCP lacks values/runtime execution. All remote scripts assert sandbox project/environment/service/deployment identity.
