// Minimal CSV writer — no library needed for a flat table like CountRecord.
function escapeCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(columns, rowsOfObjects) {
  const lines = [columns.join(",")];
  for (const row of rowsOfObjects) {
    lines.push(columns.map((c) => escapeCell(row[c])).join(","));
  }
  // Leading BOM so Excel/Google Sheets on Windows opens Thai/UTF-8 text correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
