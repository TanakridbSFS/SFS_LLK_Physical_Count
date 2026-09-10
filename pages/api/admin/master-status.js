import { getMasterCacheInfo } from "../../../lib/googleSheets";

// GET /api/admin/master-status
// Read-only peek at the current cache state, without forcing a re-fetch —
// shown on the admin console when the page first loads.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.status(200).json(getMasterCacheInfo());
}
