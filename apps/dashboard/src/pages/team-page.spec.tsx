import { expect, it } from "vitest";
import { formatTeamJoinedAt } from "./team-page.js";

it.each([null, undefined, "", "invalid-date"])("shows unavailable for absent or invalid team date %s", value => {
  expect(formatTeamJoinedAt(value)).toBe("—");
});
it("displays a valid team member date", () => {
  expect(formatTeamJoinedAt("2026-11-16T12:00:00Z")).toBe("16/11/2026");
});
