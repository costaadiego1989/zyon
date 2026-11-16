# T108 bounded Windows TCP evidence

Repeated owned-AppModule setup failed before business cases because the Windows CIM cmdlet exceeded its existing10s bound. Replace the collector with a single numeric native netstat snapshot; preserve every ownership and shutdown assertion. No application, Docker, OS, firewall, process priority or external service changes.

## Assumptions and source

Microsoft documents -n for numeric endpoints, -o for PID and one snapshot when interval is omitted: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netstat . P reviewed the source contract and proposal read-only. IPv6 endpoints remain distinct, duplicates retain ambiguity, and failed/partial output grants no authority.

## Files and success

- New tests/windows-owned-tcp.mjs: fixed local System32/netstat.exe, argv[-ano], no shell, timeout10000/maxBuffer1000000; strict current-PID established rows with valid numeric endpoints; sanitized failure only.
- Existing tests/nest-construction-only.guards.mjs: replace only the collector call/imports. assertConstructionRedisNativePeer, live socket gates, WeakMap identity and teardown stay byte-identical.
- New tests/windows-owned-tcp.contract.spec.mjs: portable strict parser, command/error boundary and actual current Windows socket capture with deliberately blank getters, including close/replacement negatives. The unsupported-platform branch is asserted rather than skipped.
- Existing two whole construction/owned-client contract files run unchanged. Syntax checks are the JS build gate. service-test-artifacts.mjs43 explicitly excludes directly executed harness MJS from productive compilation inputs; no unrelated API rebuild is justified.

Root owns the sole execution window; M54/C105 sources and partial evidence stay frozen. Root70 source remains unstaged and unexecuted, outside this repair commit. A green T108 proves the native collector, not the pending original54API9 or105browser2. They must run after integrating this committed repair with their own still-current artifacts.

## Actual gate and review

All30old/new contracts and both syntax checks passed in the final run at .cache/t108-gates/2026-11-16T17-09-07.069Z, with zero skips/failures/cancellations. The original two contract files and normalized original assertConstructionRedisNativePeer body are unchanged. P's source review identified one new native-fixture acquisition path outside finally; acquisition is now covered by the same cleanup and the full30 reran green. No old oracle or deadline changed. Original AppModule/browser consumers still need their task-specific reruns after this commit.
