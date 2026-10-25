- [x] Correlate production requests to invalid_context/503 before provider.
- [x] Reproduce on deployed code with tenant-linked buyer, without PII output.
- [x] Add failing synthetic encrypted-phone and unavailable-phone tests:
      RED33/35, encrypted/unreadable both fail with context_invalid.
- [x] Decode optional phone before context validation; preserve strict schemas.
- [x] Run contracts105/105 and related scope/privacy/observation225/225.
- [ ] Publish exact reviewed API candidate in sandbox, then production.
- [ ] Verify real persisted-buyer context and controlled HTTP response.
- [ ] Update continuity report and save reviewed source to Git.
