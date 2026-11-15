# Recovery Scanner Lifecycle Follow-up

PASS for the Quick gate only:37/37 tests, zero failed/skipped. Checked build and served runtime proof remain pending. This commit does not complete T19 or claim that native shutdown has passed.

T19's diagnostic found a referenced jitter timer in RecoveryScannerJob.scan after app.close and close ACK. The old destroy hook cleared initial/interval handles but did not track scans already running. The observed remaining server had listening=false and zero connections. A later database reopen from the scan is an inference, not a directly observed query trace.

Root authorized the lifecycle repair as a separate follow-up: stop admission of new scans, resolve/cancel only the job-owned jitter, await started scans before Prisma's application-shutdown disconnect, and stop additional work after asynchronous boundaries. Start and init cannot revive the destroyed job. A recovery already dispatched is drained, preserving its result and the existing processed-candidate counter.

Five initial lifecycle checks failed against the old implementation. The final six lifecycle checks and31 unchanged scanner/channel checks pass. They prove jitter teardown, waiting for an entered query, suppression after final eligibility returns, no restart and completion of an already dispatched operation. Existing quiet-period, authority, strategy, channel, quota and deduplication logic is unchanged. No existing assertion was edited or skipped.

The two T19 TypeScript files and CatalogModule registration are hash-preserved in this checkout's .cache/phase3-gates/t19-before-scanner-fix and absent from the follow-up source tree. The next step restores T19 and runs its checked build and full HTTP/database/native-cleanup gate after the exclusive build slot is released. Root will also exercise the integrated job in the next T63 AppModule gate. No runtime or production success is presumed.

Evidence: recovery-scanner-shutdown-evidence.json. Local commands use the existing protected Node runner on recovery-scanner-shutdown.spec.ts, recovery-scanner.spec.ts and recovery-channel-flow.spec.ts. No forced harness unref/close, deadline change, provider or remote action was added.
