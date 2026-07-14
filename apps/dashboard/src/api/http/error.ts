/**
 * Dashboard HTTP error class.
 * Thrown by dashboardJson when the response status is not ok.
 */
export class DashboardHttpError extends Error {
  readonly name = "DashboardHttpError";

  constructor(
    readonly status: number,
    readonly responseBody: string
  ) {
    super(`dashboard_http_${status}`);
  }
}
