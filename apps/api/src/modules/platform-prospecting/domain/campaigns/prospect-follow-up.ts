import { Temporal } from "@js-temporal/polyfill";
import type { ProspectingSendWindow } from "@zyon/shared-types";
import { validateSendWindow } from "./prospecting-campaign.js";

type WeeklyWindow = Pick<ProspectingSendWindow, "weekdays" | "start" | "end">;
const defaultWindow: WeeklyWindow = { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const fallbackZone = "America/Sao_Paulo";

function contactZone(trusted?: string | null) {
  if (!trusted || /^[+-]/.test(trusted)) return fallbackZone;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: trusted }).resolvedOptions().timeZone;
  } catch {
    return fallbackZone;
  }
}

export function prospectFollowUpAt(input: {
  deliveredAt: Date | null;
  hasReply?: boolean;
  trustedTimezone?: string | null;
  window?: WeeklyWindow;
}): Date | null {
  if (!input.deliveredAt || input.hasReply) return null;

  const timeZone = contactZone(input.trustedTimezone);
  const window = validateSendWindow({ ...(input.window ?? defaultWindow), timezone: timeZone });
  const start = Temporal.PlainTime.from(window.start);
  const end = Temporal.PlainTime.from(window.end);
  let candidate = Temporal.Instant.fromEpochMilliseconds(input.deliveredAt.getTime())
    .add({ hours: 48 })
    .toZonedDateTimeISO(timeZone);

  for (;;) {
    const time = candidate.toPlainTime();
    const allowedDay = window.weekdays.includes(candidate.dayOfWeek);
    const pastOpening = Temporal.PlainTime.compare(time, start) >= 0;
    if (allowedDay && pastOpening && Temporal.PlainTime.compare(time, end) < 0) {
      return new Date(candidate.epochMilliseconds);
    }

    let date = candidate.toPlainDate();
    if (!allowedDay || pastOpening) {
      do {
        date = date.add({ days: 1 });
      } while (!window.weekdays.includes(date.dayOfWeek));
    }

    const localOpening = date.toPlainDateTime(start);
    let opening = localOpening.toZonedDateTime(timeZone);
    if (Temporal.ZonedDateTime.compare(opening, candidate) <= 0) {
      opening = localOpening.toZonedDateTime(timeZone, { disambiguation: "later" });
    }
    // A clock change can open the window before its next nominal wall-clock opening.
    const transition = candidate.getTimeZoneTransition("next");
    candidate = transition && Temporal.ZonedDateTime.compare(transition, opening) < 0 ? transition : opening;
  }
}

