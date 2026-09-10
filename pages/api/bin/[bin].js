import { getBinLines, findExistingCountForBinToday } from "../../../lib/googleSheets";

// GET /api/bin/:bin?page=1&pageSize=50
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { bin } = req.query;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.max(1, parseInt(req.query.pageSize || "50", 10));

  try {
    const allLines = await getBinLines(bin);
    const knownBin = allLines.length > 0;

    const total = allLines.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const pageLines = allLines.slice(start, start + pageSize);

    // No Session/Round ID anymore — "already counted" means today, by anyone.
    const alreadyCounted = await findExistingCountForBinToday(bin);

    res.status(200).json({
      bin,
      knownBin,
      total,
      page,
      pageSize,
      totalPages,
      lines: pageLines,
      alreadyCounted: alreadyCounted.map((r) => ({
        Mat: r.Mat,
        Batch: r.Batch,
        UOM: r.UOM,
        CounterName: r.CounterName,
        Timestamp: r.Timestamp,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
