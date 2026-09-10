import { getAllMasterRows, getMasterCacheInfo } from "../../../lib/googleSheets";

// POST /api/admin/refresh-master
// Forces an immediate re-read of the Master Ref Google Sheet (bypassing the
// normal 1-minute cache) — for when someone edited BinMaster directly and
// wants the app to pick it up right away instead of waiting.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const rows = await getAllMasterRows({ forceRefresh: true });
    const info = getMasterCacheInfo();
    res.status(200).json({ ok: true, rowCount: rows.length, refreshedAt: info.refreshedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
