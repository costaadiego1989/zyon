import { DashboardHttpError } from "./error.js";

export function catalogErrorReason(error: unknown): string {
  if (!(error instanceof DashboardHttpError)) return "";
  try {
    const body = JSON.parse(error.responseBody);
    return [body.message, body.detail, body.code].find(value => typeof value === "string" && value.length > 0) ?? "";
  } catch { return ""; }
}
