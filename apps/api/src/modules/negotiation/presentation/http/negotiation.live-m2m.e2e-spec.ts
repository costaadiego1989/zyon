import test from "node:test";

const runGate = process.env.RUN_REAL_AI_E2E === "true";

test(
  "machine negotiation live AI gate placeholder (deterministic flows covered elsewhere)",
  { skip: !runGate },
  () => {
    // Opcional: adicionar aqui dois passes com provider real quando RUN_REAL_AI_E2E ligado.
  }
);
