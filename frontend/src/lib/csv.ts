// Minimal CSV writer — no library needed for a handful of moderator
// export endpoints. Section 7.9 "Exports": these are meant to open in a
// spreadsheet as a physical backup if the portal itself goes down
// mid-event, so plain CSV over JSON is the point.
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))];
  return lines.join("\n");
}
