// Converts the raw WMS export rows (as pasted directly into the Master Ref
// Google Sheet) into the BinMaster shape the rest of the app uses.
//
// This mirrors tools/convert_export_to_binmaster.py — kept here too so the
// app can do this on every read instead of requiring a manual conversion
// step. If you change the grouping logic, update both places (or retire
// the Python script's job to "one-off local preview" only).
//
// Expected raw column order (A-P), matching PHYSICAL_INVENTORY_EXPORT_*.xlsx:
// Owner, Owner Code, SKU Code, SKU Name, Inventory Status, ERP Batch Number,
// Total quantity, Occupied Qty., Available Qty., Basic UOM,
// Warehouse area code, Location Type, Container Code, Bin-location Code,
// Manufacturing Date, Expiration Date
const IDX = {
  SKU: 2,
  SKU_NAME: 3,
  BATCH: 5,
  QTY: 6,
  UOM: 9,
  WH_AREA: 10,
  LOC_TYPE: 11,
  CONTAINER: 12,
  EXP_DATE: 15,
};

// Batch numbers are always a 10-digit text code (e.g. "0000000009"). Google
// Sheets' UNFORMATTED_VALUE read (or a plain paste) can turn a cell like
// that into the JS number 9, silently dropping the leading zeros — this
// pads it back out so every Batch the app touches is a consistent 10-digit
// string, however the sheet actually stored it.
export function padBatch(value) {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value).trim();
  return /^\d+$/.test(s) ? s.padStart(10, "0") : s;
}

export function convertRawExportRowsToBinMaster(rawDataRows) {
  // rawDataRows: array of arrays, header row already excluded.
  const groups = new Map();
  let skippedContainerRows = 0;

  for (const r of rawDataRows) {
    if (!r || r.length === 0) continue;
    const locType = r[IDX.LOC_TYPE];
    if (locType === "CONTAINER") {
      skippedContainerRows += 1;
      continue; // picking totes (Container Code = PICK_CONTAINER) — not a real bin
    }

    const bin = r[IDX.CONTAINER];
    const sku = r[IDX.SKU];
    const batch = padBatch(r[IDX.BATCH]);
    const uom = r[IDX.UOM];
    if (!bin || !sku) continue; // skip blank/malformed rows

    const key = `${bin}${sku}${batch}${uom}`;
    let g = groups.get(key);
    if (!g) {
      g = { Bin: bin, Mat: sku, MatName: r[IDX.SKU_NAME] || "", Batch: batch, Qty: 0, UOM: uom || "", ExpirationDate: r[IDX.EXP_DATE] || "", WarehouseArea: r[IDX.WH_AREA] || "" };
      groups.set(key, g);
    }
    const qty = Number(r[IDX.QTY]);
    g.Qty += Number.isFinite(qty) ? qty : 0;
  }

  return { rows: Array.from(groups.values()), skippedContainerRows };
}
