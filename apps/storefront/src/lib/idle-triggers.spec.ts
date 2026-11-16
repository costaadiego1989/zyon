import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(relative: string, dependencies: Record<string, unknown>) {
  const source = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", source)((name: string) => {
    if (!(name in dependencies)) throw Error("Unexpected dependency " + name);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

for (const idleSeconds of [600, undefined]) test(idleSeconds ? "configured idle duration resets on buyer activity" : "idle default is180 seconds and cleanup cancels the timer", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  let cleanup = () => {};
  t.after(() => { cleanup(); if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument); else Reflect.deleteProperty(globalThis, "document"); });
  const events: any[] = [], nudges: string[] = [];
  const triggers = load("./triggers.ts", { "@/lib/conversation-access": { conversationFetch: (...args: unknown[]) => {
    events.push(args); return Promise.resolve();
  } }, "@/lib/buyer-auth": { getValidBuyer: () => null } });
  const effects = load("./viewmodels/useConversationViewModel/effects.ts", { react: {
    useRef: (current: unknown) => ({ current }), useEffect: (effect: () => () => void) => { cleanup = effect(); },
  }, "@/lib/triggers": triggers, "@/lib/analytics": { trackPurchase: () => {} } });
  const session = { current: "conversation-a" };
  effects.useNudgeTriggers("athom", session, (name: string) => nudges.push(name), idleSeconds);
  if (idleSeconds) { t.mock.timers.tick(180000); document.dispatchEvent(new Event("keydown")); }
  const duration = (idleSeconds ?? 180) * 1000;
  t.mock.timers.tick(duration - 1);
  assert.deepEqual(nudges, []);
  session.current = "conversation-current";
  t.mock.timers.tick(1);
  assert.deepEqual(nudges, ["idle_30_seconds"]);
  assert.equal(events.length, 1);
  assert.match(events[0][1], /conversations\/conversation-current\/events$/);
  assert.equal(JSON.parse(events[0][2].body).merchant_id, "athom");
  assert.equal(JSON.parse(events[0][2].body).event, "idle_30_seconds");
  document.dispatchEvent(new Event("click")); cleanup();
  t.mock.timers.tick(duration);
  assert.equal(events.length, 1);
});
