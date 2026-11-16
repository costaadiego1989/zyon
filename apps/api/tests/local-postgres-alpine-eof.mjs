import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {assertIsolatedPostgresContainer,openOwnedPostgresBridge} from './local-disposable-postgres.mjs';

// Test-only capability used explicitly by the local Alpine factory. The direct
// legacy bridge/nc argv remain unchanged. No environment or HTTP activation.
export const ALPINE_EOF_CAPABILITY='owned-alpine-nc-first-eof-v1';

// No scope, data, endpoint, command or path is interpolated. fd8/fd9 preserve
// Docker host I/O while nc replaces fd0/fd1 with the connected loopback socket.
// nc110's internal duplex loop is bypassed by its existing exec capability.
export const ALPINE_NC_EOF_PROGRAM=String.raw`set -eu
exec 8<&0 9>&1
exec nc 127.0.0.1 5432 -e /bin/sh -c '
set -eu
reader=
writer=
cleanup() {
  trap - EXIT HUP INT TERM
  set +e
  exec 0<&- 1>&- 7<&- 8<&- 9>&-
  if [ -n "$reader" ]; then kill "$reader" 2>/dev/null; fi
  if [ -n "$writer" ]; then kill "$writer" 2>/dev/null; fi
  if [ -n "$reader" ]; then wait "$reader" 2>/dev/null; fi
  if [ -n "$writer" ]; then wait "$writer" 2>/dev/null; fi
}
trap cleanup EXIT
trap "exit 129" HUP
trap "exit 130" INT
trap "exit 143" TERM
exec 7<&0
dd bs=65536 status=none <&7 >&9 7<&- 8<&- 9>&- &
reader=$!
dd bs=65536 status=none <&8 >&1 7<&- 8<&- 9>&- &
writer=$!
status=0
wait -n || status=$?
exit "$status"
'`;

// No background work or idle timer. With no jobs, a supported ash wait -n
// returns127; an unsupported option fails this preflight. nc then actually
// connects to the owned loopback PostgreSQL and execs the fixed marker writer.
export const ALPINE_NC_EOF_PREFLIGHT=String.raw`set -eu
set +e
wait -n
status=$?
set -e
[ "$status" -eq 127 ]
dd bs=65536 status=none </dev/null >/dev/null
exec 8<&0 9>&1
exec nc 127.0.0.1 5432 -e /bin/sh -c 'printf "%s\n" "owned-alpine-nc-first-eof-v1" >&9'`;

export function alpineEofCommand(){
  assert.equal(arguments.length,0,'alpine_eof_command_has_no_arguments');
  return ['/bin/sh','-c',ALPINE_NC_EOF_PROGRAM];
}

export function alpineEofPreflightCommand(){
  assert.equal(arguments.length,0,'alpine_eof_preflight_has_no_arguments');
  return ['/bin/sh','-c',ALPINE_NC_EOF_PREFLIGHT];
}

/** Exposed separately to make the fixed argv boundary testable. This converts
 * only one exact command issued by the owned base helper; it is not a general
 * Docker/spawn override. All stream and lifecycle ownership stays in that helper.
 */
export function alpineEofSpawn(context,id,spawnProcess=spawn){
  assert.match(context,/^[A-Za-z0-9_.-]+$/);assert.match(id,/^[a-f0-9]{64}$/);
  const original=['--context',context,'exec','--interactive',id,'nc','127.0.0.1','5432'];
  return (command,args,options)=>{
    assert.equal(command,'docker','alpine_eof_docker_only');
    assert.deepEqual(args,original,'alpine_eof_exact_owned_argv_required');
    return spawnProcess(command,[...original.slice(0,5),...alpineEofCommand()],options);
  };
}

export async function openOwnedAlpineEofBridge(options,spawnProcess=spawn){
  assert.ok(options&&typeof options==='object'&&!Array.isArray(options),'alpine_eof_options_required');
  const keys=['capability','id','runId','context','endpoint','env','inspect','expectedImageId'];
  assert.ok(Object.keys(options).every(key=>keys.includes(key)),'alpine_eof_unknown_option');
  assert.equal(options.capability,ALPINE_EOF_CAPABILITY,'alpine_eof_explicit_capability_required');
  assert.match(options.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,'alpine_eof_uuid_required');
  assert.match(options.expectedImageId,/^sha256:[a-f0-9]{64}$/,'alpine_eof_captured_image_required');
  assert.equal(typeof options.inspect,'function','alpine_eof_captured_inspection_required');
  const inspect=async()=>{
    const info=await options.inspect();assertIsolatedPostgresContainer(info,options.id,options.runId);
    assert.equal(info.Image,options.expectedImageId,'alpine_eof_owned_image_changed');
    assert.equal(info.Config.User,'70:70','alpine_eof_uid70_only');return info;
  };
  await inspect();
  // Profile is intentionally omitted: this capability is solely the existing
  // Alpine fixture with a supervised transport, never a substitute pgvector image.
  return openOwnedPostgresBridge({id:options.id,runId:options.runId,context:options.context,
    endpoint:options.endpoint,env:options.env,inspect},alpineEofSpawn(options.context,options.id,spawnProcess));
}
