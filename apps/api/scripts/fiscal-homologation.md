# Fiscal homologation runner

Run from the monorepo root with Node 22 and the installed local dependencies:

```powershell
node apps/api/scripts/fiscal-homologation.mjs --help
node apps/api/scripts/fiscal-homologation.mjs
node apps/api/scripts/fiscal-homologation.mjs --preflight --provider focus --environment homologation --merchant MERCHANT --sale INTENT --schema fiscal_hml_32HEX --operation 32HEX
```

Default returns `not_run` with exit 2. Help exits 0. Preflight only reads the dedicated loopback `/zyon_fiscal` database and returns `not_run`, exit 2; it does not refresh credentials, inspect an external account, acquire a lease or write a receipt. The complete safe DSN belongs in `FISCAL_TEST_DATABASE_URL`, without query/hash overrides. The random schema is separate and must already exist. Do not use a remote or ordinary development database.

`--emit` replaces `--preflight` for an explicitly authorized, already prepared operation. It runs the same persisted issuance store, provider factory, stage journal, reconciliation, stock coordinator, private document service and worker. It claims only the exact merchant/environment/intent. It does not boot AppModule, start a scheduler, drain outbox work, create an account, accept terms, configure a certificate or cancel a note. Run it again later to reconcile the same immutable reference after processing or an uncertain result. A pending result exits 3. A verified complete result exits 0.

Preparation is a protected local setup performed by the operator, outside normal HTTP/payment routes. The operation must have an active merchant connection, a sale concluded after activation, a confirmed supported profile and the immutable original sale snapshot. It requires a `fiscal_hml_` commercial order, a `synthetic_nfe_<32hex>` stable reference, no buyer e-mail/phone in the snapshot, and Zyon ownership of both channels. A locally persisted approved `PaymentIntent` must carry its exact original amount/session/order and a private `fiscal_local_homologation_v1` receipt bound to the operation ID, with `creation.kind=local_homologation_setup`. This is a synthetic financial proof, never a real PSP transaction. No normal runtime reader accepts this receipt as provider approval.

The private marker is a `FiscalEvent` for the exact intent with `actorKind=local_homologation`, `actorId=<operation ID>`, `action=homologation.prepared` and `providerEvidenceRef=homologationBindingHash(...)`. The helper hashes the original schema, operation, merchant, intent, stable reference, immutable snapshot hash and original payment ID. `fiscal-homologation.integration.spec.ts` provides the complete isolated preparation seam without weakening fixture cleanup. There is no public preparation endpoint or automatic seed at import/default/preflight.

Focus requires the merchant's prepared company token and protected company setup, encrypted with `AACP_PII_ENC_KEY`. Certificate management remains in Focus. The runner verifies the exact company/token/certificate and homologation environment through the real read-only production-host company contract before enabling the homologation invoice host. Redirects, alternate hosts/ports, production fiscal writes, foreign references, customer communication endpoints and cancellation are blocked. Both channel senders are bound to a plan with no network sender or send closure. The snapshot also has no communication destinations, so a later ordinary outbox consumer cannot message a customer for this synthetic operation.

Bling, Omie and Olist are accepted provider selections, but their current inspectors rely on responsible confirmation for the account's fiscal environment. That does not prove the effective environment of an external API write. An ERP execution therefore returns `fiscal_homologation_effective_provider_environment_unverified` and writes nothing until a documented authenticated effective-environment contract can be verified. A checkbox, local enum, demo account or previously viewed UI is insufficient.

A synthetic transport is always reported as `local_contract_authorized`. Only the normal network transport, authenticated account/environment inspection, persisted authorization and both validated private XML/DANFE artifacts can produce `sefaz_homologation_authorized`. No merchant account is prepared in this implementation session; external execution remains `not_run`. Reports contain masked issuer identity, operation/hash/state and artifact hashes, never credentials, full recipient data, XML or private storage keys.
