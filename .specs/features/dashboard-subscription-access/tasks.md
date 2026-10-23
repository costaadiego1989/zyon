- [x] Confirm Athom identity and inspect production subscription before mutation.
- [x] Record idempotent owner-authorized Scale concession with one-year period.
- [x] Confirm Scale and removal of expired-trial banner in the real dashboard.
- [x] Test blocked module mount prevention and normal navigation visibility.
- [x] Remove duplicate marketplace navigation without deleting recovery routes.
- [x] Reuse approved plan presentation and preserve existing payment handlers.
- [x] Validate release102 tests, sandbox, deployment and canonical production UI.
- [x] Release103: reproduce5 failing Marketplace presentation cases, hide the
      main menu and plan copy without removing routes/capabilities;37 focal
      cases and882/882 full dashboard tests pass.
- [x] Release103: reproduce2 failures for omitted subscription cycle/value and
      pending changes; fix legacy response serialization;14/14 billing tests pass.
- [x] Publish the103 changes as API104/dashboard104, preserving both WhatsApp
      commits. Canonical bundle hides the menu; deployed serializer returns
      annual/zero. No charge or provider subscription was created.
- [ ] Verify final authenticated owner screen after normal login; the current
      release has served-bundle and read-only runtime proof, not this UI proof.
