import { getDistinctDateSummaries } from "../../../lib/googleSheets";

// GET /api/admin/dates
// Lists every date seen in CountRecord (most recent first), with how many
// rows each has — used to populate the export screen's date picker, now
// that there's no SessionID to filter by instead.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const forceRefresh = req.query.forceRefresh === "1";
    const dates = await getDistinctDateSummaries({ forceRefresh });
    res.status(200).json({ dates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
