import { getDistinctSessionSummaries } from "../../../lib/googleSheets";

// GET /api/admin/sessions
// Lists every SessionID seen in CountRecord (most recently active first),
// with how many rows each has — used to populate the export screen's
// session picker.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const forceRefresh = req.query.forceRefresh === "1";
    const sessions = await getDistinctSessionSummaries({ forceRefresh });
    res.status(200).json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
