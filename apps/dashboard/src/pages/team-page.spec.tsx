import { expect, it } from "vitest";
import { formatTeamJoinedAt } from "./team-page.js";

it.each(["2026-04-31T12:00:00Z", "2026-02-29", "2026-02-29T00:00:00.000Z", "2026-00-01", "2026-13-01", "2026-01-00"])("rejects a nonexistent joined date %s", value => {
  expect(formatTeamJoinedAt(value)).toBe("—");
});
it("preserves the existing leap day in a valid joined timestamp", () => {
  expect(formatTeamJoinedAt("2024-02-29T12:00:00Z")).toBe("29/02/2024");
});

it.each([null, undefined, "", "invalid-date"])("shows unavailable for absent or invalid team date %s", value => {
  expect(formatTeamJoinedAt(value)).toBe("—");
});
it("displays a valid team member date", () => {
  expect(formatTeamJoinedAt("2026-11-16T12:00:00Z")).toBe("16/11/2026");
});
