import { getAllRecordRows, RECORD_COLUMNS } from "../../../lib/googleSheets";
import { toCsv } from "../../../lib/csv";

// GET /api/admin/export?sessionId=2026-09-09_R1   (omit sessionId, or pass "ALL", for everything)
// Downloads the raw CountRecord log as a CSV file.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const sessionId = req.query.sessionId || "";
    const rows = await getAllRecordRows({ forceRefresh: true });
    const filtered = !sessionId || sessionId === "ALL"
      ? rows
      : rows.filter((r) => r.SessionID === sessionId);

    const csv = toCsv(RECORD_COLUMNS, filtered);
    const safeName = (sessionId || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `CountRecord_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
