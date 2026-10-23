import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

// Test-only accident protection, not an OS security sandbox. Mocked transports
// remain replaceable. Real sockets/fetch may reach literal loopback only.
function assertLoopback(host) {
  if (!["127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("test_external_network_forbidden");
}

function checkedLookup(lookup) {
  return function (...args) {
    const callback = args.pop();
    return lookup.call(this, ...args, (error, addresses, family) => {
      if (!error) {
        try {
          if (Array.isArray(addresses)) {
            if (!addresses.length) throw new Error("test_empty_network_target");
            for (const entry of addresses) assertLoopback(entry.address);
          } else assertLoopback(addresses);
        } catch (blocked) { callback(blocked); return; }
      }
      callback(error, addresses, family);
    });
  };
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  if (first && typeof first === "object") {
    if (first.path) throw new Error("test_ipc_network_forbidden");
    // Pin the default before Node can resolve it as a hostname.
    if (first.host === undefined) first.host = "127.0.0.1";
    if (typeof first.lookup === "function" && net.isIP(first.host) === 0) {
      // Preserve HTTP Host/TLS SNI while checking every resolved address before
      // Node connects. A pinned-loopback transport must not be mistaken for a
      // real external delivery; public/empty/mixed resolutions remain blocked.
      first.lookup = checkedLookup(first.lookup);
    } else assertLoopback(first.host);
  } else if (typeof first === "number") {
    if (typeof normalized[1] !== "string") {
      return connect.call(this, first, "127.0.0.1", ...normalized.slice(1));
    }
    assertLoopback(normalized[1]);
  } else {
    throw new Error("test_unknown_network_target");
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();

const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const target = new URL(input instanceof Request ? input.url : input);
  assertLoopback(target.hostname);
  return originalFetch(input, init);
};

