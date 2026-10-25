- [x] Correlate production requests to invalid_context/503 before provider.
- [x] Reproduce on deployed code with tenant-linked buyer, without PII output.
- [x] Add failing synthetic encrypted-phone and unavailable-phone tests:
      RED33/35, encrypted/unreadable both fail with context_invalid.
- [x] Decode optional phone before context validation; preserve strict schemas.
- [x] Run contracts105/105 and related scope/privacy/observation225/225.
- [x] Publish reviewed107 in sandbox df344305 SUCCESS; remote typecheck/build
      and source-hash diagnostic pass; synthetic encrypted context valid,
      real browser guest FAQ201.
- [x] Publish the same reviewed107 API candidate in production5e3f1b8c SUCCESS.
- [x] Verify persisted tenant-linked buyer context read-only and, separately,
      actual guest HTTP math refusal201 then FAQ201 in the same conversation;
      input/context/output/response ok, one classifier call, no retries or writes.
- [x] Update continuity report; sourcecd2390c3 saved on origin, final evidence
      recorded separately without claiming full authenticated browser shopping.
