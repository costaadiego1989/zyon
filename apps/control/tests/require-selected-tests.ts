import type { Reporter } from "vitest/reporters";

/** A stale proof filter must fail, even when Vitest collected nonmatching tests. */
export const requireSelectedTests: Reporter = {
  onTestRunEnd(modules) {
    const executed = modules.flatMap(module => [...module.children.allTests()])
      .filter(test => ["passed", "failed"].includes(test.result().state));
    if (executed.length === 0) throw new Error("prospecting_no_tests_selected");
  },
};
