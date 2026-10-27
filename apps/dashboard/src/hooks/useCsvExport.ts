/**
 * Shared CSV export utility.
 * Extracts the repeated Blob+ObjectURL+anchor pattern found in audit-log, customers, orders pages.
 */
export function downloadCsv(header: string, rows: string[], filename: string): void {
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
