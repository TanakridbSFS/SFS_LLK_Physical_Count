import { appendCountRecords } from "../../lib/googleSheets";

// POST /api/count
// body: { counterName, bin, deviceId, lines: [{ mat, batch, uom, expectedQty, countedQty, lineType }] }
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { counterName, bin, deviceId, lines } = req.body || {};

  if (!counterName || !bin || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "Missing counterName, bin, or lines" });
  }

  const validTypes = new Set(["MATCH", "ADJUSTED", "NEW", "ZERO"]);
  for (const line of lines) {
    if (!validTypes.has(line.lineType)) {
      return res.status(400).json({ error: `Invalid lineType: ${line.lineType}` });
    }
  }

  const timestamp = new Date().toISOString();
  const rows = lines.map((line) => ({
    Timestamp: timestamp,
    CounterName: counterName,
    Bin: bin,
    Mat: line.mat || "",
    Batch: line.batch || "",
    UOM: line.uom || "",
    ExpectedQty: line.expectedQty ?? "",
    CountedQty: line.countedQty ?? "",
    LineType: line.lineType,
    DeviceID: deviceId || "",
  }));

  try {
    await appendCountRecords(rows);
    res.status(200).json({ ok: true, written: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
