# Buyer password verification

Full gate passed locally on 2026-11-18. The login now reads `PasswordHasher.verify().valid` before signing a buyer JWT. The earlier object truthiness allowed a false verification result through this branch.

Scope: one declaration in the existing use case, the complete real-hasher/JWT unit regression and an actual owned AppModule/HTTP/SQL regression. Correct-password login and normalization remain valid; wrong/malformed/phone-only/absent credentials are rejected without tokens, cookies or account changes. Password algorithm, CAPTCHA, routes and identity policy remain unchanged.

Tests were authored before the repair. The original RED8 (3pass/5fail) and all initial assertions were preserved; an independent account snapshot case was added. Actual Root Full: unit15, HTTP8, full own checked API build/admission, API types/lint, normal48 and widget176. Every required runner ended naturally0; providers0 and owned cleanup were asserted. Exact paths, hashes and scope are in `task-110-evidence.json`.

The three unrelated modified T72 MJS harness files were backed up and restored to the committed baseline before HTTP/product proof. T72 work is preserved separately. No production action occurred. Remaining feature tasks and final same-HEAD independent verification stay open.
