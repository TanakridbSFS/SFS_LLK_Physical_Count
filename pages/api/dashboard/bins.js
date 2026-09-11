import { getAllRecordRows } from "../../../lib/googleSheets";

// One static layout file per rack, generated once from the WMS bin-location
// export (see lib/warehouseLayoutFA.json's header comment / README §9 for
// how to add more racks later). Only FA is wired up for this first version.
const RACK_LAYOUTS = {
  FA: () => require("../../../lib/warehouseLayoutFA.json"),
};

// GET /api/dashboard/bins?rack=FA
// Joins the static bin layout (position in 3D space) with each bin's most
// recent CountRecord row (live count status), for the warehouse dashboard.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rack = String(req.query.rack || "FA").toUpperCase();
  const loadLayout = RACK_LAYOUTS[rack];
  if (!loadLayout) {
    return res.status(400).json({
      error: `Rack "${rack}" isn't wired up yet — only ${Object.keys(RACK_LAYOUTS).join(", ")} for now.`,
    });
  }

  try {
    const layout = loadLayout();
    const records = await getAllRecordRows();

    // Latest record per Bin — Timestamp strings sort correctly as text
    // since they're all the same fixed-width ISO format (see lib/time.js).
    const latestByBin = new Map();
    for (const r of records) {
      const bin = String(r.Bin).trim();
      const prev = latestByBin.get(bin);
      if (!prev || String(r.Timestamp) > String(prev.Timestamp)) {
        latestByBin.set(bin, r);
      }
    }

    const bins = layout.map((cell) => {
      const latest = latestByBin.get(cell.bin);
      return {
        ...cell,
        status: latest ? latest.LineType : "UNCOUNTED",
        timestamp: latest ? latest.Timestamp : null,
        counterName: latest ? latest.CounterName : null,
        countedQty: latest ? latest.CountedQty : null,
      };
    });

    res.status(200).json({ rack, generatedAt: new Date().toISOString(), bins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
}
