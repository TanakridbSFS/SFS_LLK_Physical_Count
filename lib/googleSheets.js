import { google } from "googleapis";

// ---- Config (env vars — see .env.example) ----
const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID;
const RECORD_SHEET_ID = process.env.RECORD_SHEET_ID;
const MASTER_TAB = process.env.MASTER_TAB || "BinMaster";
const RECORD_TAB = process.env.RECORD_TAB || "CountRecord";

// Column layout — must match the header row you put in each Google Sheet.
// See README.md "Sheet setup" for the exact header rows to paste in.
export const MASTER_COLUMNS = [
  "Bin",
  "Mat",
  "MatName",
  "Batch",
  "Qty",
  "UOM",
  "ExpirationDate",
  "WarehouseArea",
];

export const RECORD_COLUMNS = [
  "Timestamp",
  "SessionID",
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
  const range = `${MASTER_TAB}!A:${colLetter(MASTER_COLUMNS.length)}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: MASTER_SHEET_ID,
    range,
  });
  const rows = res.data.values || [];
  masterCache = rowsToObjects(rows, MASTER_COLUMNS);
  masterCacheAt = now;
  return masterCache;
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
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

// Returns existing CountRecord rows for a given SessionID (+ optional Bin filter).
// Used to warn when a bin was already counted this session, and to compute progress.
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

export async function findExistingCountForBin(sessionId, binCode) {
  const rows = await getAllRecordRows();
  return rows.filter(
    (r) => r.SessionID === sessionId && String(r.Bin).trim() === String(binCode).trim()
  );
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
