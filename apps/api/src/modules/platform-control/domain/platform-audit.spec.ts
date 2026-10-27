import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePlatformAuditDetails } from "./platform-audit.js";

test("keeps feedback treatment transitions visible to permitted auditors without exposing note text", () => {
  assert.deepEqual(
    sanitizePlatformAuditDetails({
      previousStatus: "new",
      status: "in_progress",
      previousPriority: "normal",
      priority: "high",
      previousAssignedOperatorId: "operator_1",
      assignedOperatorId: "operator_2",
      noteAdded: true,
      note: "The private note must never leave the feedback detail endpoint.",
    }),
    {
      previousStatus: "new",
      status: "in_progress",
      previousPriority: "normal",
      priority: "high",
      previousAssignedOperatorId: "operator_1",
      assignedOperatorId: "operator_2",
      noteAdded: true,
    },
  );
});
