import { google } from "googleapis";
import { convertRawExportRowsToBinMaster } from "./binMasterConvert";
import { nowThailandISOString } from "./time";

// ---- Config (env vars — see .env.example) ----
const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID;
const RECORD_SHEET_ID = process.env.RECORD_SHEET_ID;
const MASTER_TAB = process.env.MASTER_TAB || "BinMaster";
const RECORD_TAB = process.env.RECORD_TAB || "CountRecord";

// Master Ref sheet layout: paste the raw WMS export straight in, no manual
// conversion needed — the app groups/aggregates it into BinMaster shape on
// every read. See lib/binMasterConvert.js for the raw column order it
// expects (A-P, matching PHYSICAL_INVENTORY_EXPORT_*.xlsx).
const RAW_EXPORT_COLUMN_COUNT = 16;

// Column layout for the Record File sheet — must match its header row.
// See README.md "Sheet setup" for the exact header row to paste in.
export const RECORD_COLUMNS = [
  "Timestamp",
  "CounterName",
  "Bin",
  "Mat",
  "Batch",
  "UOM",
  "ExpectedQty",
  "CountedQty",
  "LineType",
  "DeviceID",
];

let cachedClient = null;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Private keys stored in env vars usually have literal "\n" sequences —
  // convert them back to real newlines.
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars. See README.md."
    );
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  if (cachedClient) return cachedClient;
  const auth = getAuth();
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

function rowsToObjects(rows, columns) {
  // rows[0] is assumed to be the header row and is skipped —
  // we trust `columns` (config above) rather than re-reading headers,
  // so header text can have minor formatting differences.
  return rows.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 }; // 1-based sheet row, +1 for header
    columns.forEach((col, i) => {
      obj[col] = row[i] !== undefined ? row[i] : "";
    });
    return obj;
  });
}

// ---- Master (read-only reference data) ----

let masterCache = null;
let masterCacheAt = 0;
const MASTER_CACHE_TTL_MS = 60 * 1000; // 1 minute — balance freshness vs. API quota

export async function getAllMasterRows({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && masterCache && now - masterCacheAt < MASTER_CACHE_TTL_MS) {
    return masterCache;
  }
  const sheets = await getSheetsClient();
  const range = `${MASTER_TAB}!A:${colLetter(RAW_EXPORT_COLUMN_COUNT)}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: MASTER_SHEET_ID,
    range,
    // Numbers as numbers (not "1,234"-formatted strings), dates as
    // human-readable strings (not serial day numbers) — see
    // lib/binMasterConvert.js for what it does with each column.
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rawRows = (res.data.values || []).slice(1); // drop header row
  const { rows } = convertRawExportRowsToBinMaster(rawRows);
  masterCache = rows;
  masterCacheAt = now;
  return masterCache;
}

// Metadata for the admin console's "Refresh Master Data" button — shows how
// many rows are currently cached and when they were last pulled, without
// forcing a re-fetch (call getAllMasterRows({forceRefresh:true}) for that).
export function getMasterCacheInfo() {
  return {
    rowCount: masterCache ? masterCache.length : null,
    refreshedAt: masterCacheAt ? new Date(masterCacheAt).toISOString() : null,
  };
}

export async function getBinLines(binCode) {
  const all = await getAllMasterRows();
  return all.filter((r) => String(r.Bin).trim() === String(binCode).trim());
}

// ---- Record (append-only log) ----

export async function appendCountRecords(rowsOfObjects) {
  const sheets = await getSheetsClient();
  const values = rowsOfObjects.map((obj) =>
    RECORD_COLUMNS.map((col) => obj[col] ?? "")
  );
  await sheets.spreadsheets.values.append({
    spreadsheetId: RECORD_SHEET_ID,
    range: `${RECORD_TAB}!A:${colLetter(RECORD_COLUMNS.length)}`,
    // RAW, not USER_ENTERED — USER_ENTERED parses values the way typing
    // into the UI would, which would strip the leading zeros off a Batch
    // like "0000000009" by treating it as the number 9. RAW stores the
    // string exactly as given.
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

let recordCache = null;
let recordCacheAt = 0;
const RECORD_CACHE_TTL_MS = 15 * 1000; // short TTL — this data changes as people count

export async function getAllRecordRows({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && recordCache && now - recordCacheAt < RECORD_CACHE_TTL_MS) {
    return recordCache;
  }
  const sheets = await getSheetsClient();
  const range = `${RECORD_TAB}!A:${colLetter(RECORD_COLUMNS.length)}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: RECORD_SHEET_ID,
    range,
  });
  const rows = res.data.values || [];
  recordCache = rowsToObjects(rows, RECORD_COLUMNS);
  recordCacheAt = now;
  return recordCache;
}

// There's no Session/Round ID anymore (removed per your request), so
// "already counted" is judged by date instead: has this Bin already got a
// CountRecord row from earlier today? That's enough to warn against two
// PDAs re-counting the same bin on the same day, while still letting a
// later cycle-count round (a different day) count it again freely.
//
// "Today" here means the Thai calendar day (matching the Thai-local
// Timestamp values CountRecord rows are written with — see lib/time.js) —
// using the server's UTC day instead would misjudge "today" for several
// hours around each midnight, since Thai time is UTC+7.
export async function findExistingCountForBinToday(binCode) {
  const rows = await getAllRecordRows();
  const today = nowThailandISOString().slice(0, 10); // YYYY-MM-DD, Thai-local
  return rows.filter(
    (r) =>
      String(r.Bin).trim() === String(binCode).trim() &&
      String(r.Timestamp).slice(0, 10) === today
  );
}

// Distinct dates seen in CountRecord (YYYY-MM-DD, most recent first), with
// a row count each. Used by the admin console's export screen to filter
// the CSV download, now that there's no SessionID to filter by instead.
export async function getDistinctDateSummaries({ forceRefresh = false } = {}) {
  const rows = await getAllRecordRows({ forceRefresh });
  const byDate = new Map();
  for (const r of rows) {
    const date = String(r.Timestamp).slice(0, 10);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, rowCount: 0 });
    byDate.get(date).rowCount += 1;
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---- small helper ----
function colLetter(n) {
  // 1 -> A, 2 -> B, ... 27 -> AA
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
