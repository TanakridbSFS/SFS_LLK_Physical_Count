# Stock Count Web App (PDA)

Cycle-count web app for Android handheld PDA devices. Scan a Bin, confirm or
adjust each expected line, log any unexpected stock, save, move to the next
bin. Data lives in two Google Sheets — no separate database.

Full functional spec: see `stock_count_webapp_spec.md` (shared earlier in
the conversation) for the reasoning behind every design decision below.

## 1. Google Sheets setup

You have two sheets already:

- **Master Ref** (`MASTER_SHEET_ID`) — read-only reference data: what's
  expected in each bin.
- **Record File** (`RECORD_SHEET_ID`) — append-only log of every count
  action. This is the "ไม่รู้จะออกแบบยังไง" one — the design is below.

### 1.1 Master Ref — tab `BinMaster`

Rename the tab (bottom of the sheet) to `BinMaster`, or leave it as-is and
set `MASTER_TAB` in your `.env` to match its actual name.

Header row (row 1), columns A–H:

```
Bin | Mat | MatName | Batch | Qty | UOM | ExpirationDate | WarehouseArea
```

This is **not** the raw WMS export format — it's a cleaned-up, one-row-per-
Bin/Mat/Batch/UOM shape. To fill it from a raw
`PHYSICAL_INVENTORY_EXPORT_*.xlsx` file:

```bash
pip install openpyxl --break-system-packages
python3 tools/convert_export_to_binmaster.py PHYSICAL_INVENTORY_EXPORT_20260909190532.xlsx BinMaster.csv
```

This script drops `CONTAINER`/`PICK_CONTAINER` rows, groups by
(Bin, SKU, Batch, UOM), and sums quantity across `Inventory Status`
(UR/Block/QI collapsed into one number, per your earlier decision). Open
the resulting `BinMaster.csv` and paste its rows into the `BinMaster` tab
below the header (File → Import in Google Sheets, "Replace data at
selected cell", works well for this).

Re-run this whenever you pull a fresh export for a new cycle-count round.

### 1.2 Record File — tab `CountRecord`

Rename the tab to `CountRecord` (or set `RECORD_TAB` to match). Header row,
columns A–K:

```
Timestamp | SessionID | CounterName | Bin | Mat | Batch | UOM | ExpectedQty | CountedQty | LineType | DeviceID
```

Leave the rest of the sheet empty — the app only ever **appends** rows
here; it never edits or deletes existing ones. `LineType` will be one of
`MATCH`, `ADJUSTED`, `NEW`, `ZERO` (see spec §2.2/§6).

### 1.3 Google Cloud service account (lets the app read/write both sheets)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/),
   create (or reuse) a project.
2. Enable the **Google Sheets API** for that project (APIs & Services →
   Enable APIs and Services → search "Google Sheets API" → Enable).
3. APIs & Services → Credentials → Create Credentials → **Service
   Account**. Give it any name, no extra roles needed.
4. Open the new service account → Keys → Add Key → Create new key → JSON.
   This downloads a `.json` file — keep it private, never commit it to git.
5. Open the JSON file. You need two values from it: `client_email` and
   `private_key`.
6. In **both** Google Sheets (Master Ref and Record File), click Share and
   add that `client_email` address as **Editor**.

## 2. Local setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` = the `client_email` from the JSON key
- `GOOGLE_PRIVATE_KEY` = the `private_key` from the JSON key (keep the
  `\n` sequences exactly as they appear in the JSON — don't reformat them)
- `MASTER_SHEET_ID` / `RECORD_SHEET_ID` — already filled in with your two
  sheet IDs, but double-check they match your sheets' URLs
- `MASTER_TAB` / `RECORD_TAB` — only change if your tab names differ from
  `BinMaster` / `CountRecord`

Run it:

```bash
npm run dev
```

Open `http://localhost:3000` on a computer first to sanity-check the flow,
then try it from the PDA's browser once deployed (see below) — the
PDA's scanner won't be exercised until you're testing on the real device.

## 3. Deploy to Vercel

1. Push this project to a GitHub repo.
2. In Vercel, "Add New Project" → import that repo.
3. In the project's Settings → Environment Variables, add the same six
   variables from `.env.local` (paste `GOOGLE_PRIVATE_KEY` exactly as one
   value, quotes and all).
4. Deploy. Open the resulting `*.vercel.app` URL on the PDA's browser.
5. On the PDA, add the URL to the home screen (browser menu → "Add to Home
   screen") so it opens like an app.

## 4. How it works

- **Start Session** (`/`) — counter types their name and a Session/Round
  ID (no username/password login, per your requirement). Stored on-device
  (`localStorage`) so it survives closing the browser.
- **Scan Bin** (`/scan`) — a text field stays focused; the PDA's built-in
  scanner types the Bin code into it and sends Enter automatically
  (keyboard-wedge mode — no extra scanner setup needed, see spec §5).
- **Confirm/Adjust** (`/count/[bin]`) — shows expected lines for that bin
  (paginated — 20/50/100/500/1000 per page, since some bins have 1,000+
  lines), lets you accept, adjust, zero-out, add unexpected stock, or
  remove a line from this save. If the bin was already counted this
  session, it warns before letting you recount.
- Every save appends rows to `CountRecord` — nothing is ever overwritten.

## 5. Admin Console (`/admin`)

A small office-use page, separate from the PDA counting flow:

- **Refresh Master Data Now** — the app normally re-reads the Master Ref
  sheet at most once a minute (to stay within Google's API quota). If you
  just edited `BinMaster` directly in the sheet and want the change to show
  up immediately, this button forces that re-read right away and shows the
  row count + timestamp of the refresh.
- **Export Count Records** — downloads the raw `CountRecord` log as a CSV,
  either for one Session ID or for everything ever counted.

No passcode gate — by your call, since this only ever *reads* fresh data or
*triggers a re-read*, it doesn't overwrite anything itself. (Editing
`BinMaster`'s actual contents is still done directly in the Google Sheet, or
via the conversion script in §1.1 — the console's "Refresh" button doesn't
change what's in the sheet, just how soon the app notices.) If this page
ever grows a feature that writes data, revisit that call.

## 6. Known simplifications (see spec §7 for the reasoning)

- Session/Round ID is entered by the counter, not centrally assigned —
  make sure everyone counting together agrees on the same ID before
  starting, and share the exact string (a WhatsApp/LINE message works).
- The "already counted" check runs per Session ID + Bin — it does not
  currently track partial progress within a large bin's pages (if
  interrupted partway through a big bin's pages, page 1 will show as
  "already counted" — resuming means paging forward, which is safe since
  earlier pages just don't need re-saving).
- No variance/reconciliation report is built (per your earlier answer) —
  `CountRecord` is the raw log; analysis happens outside the app.
- Expected quantities are read live from `BinMaster` on every scan, cached
  for 1 minute per server instance — if you edit `BinMaster` mid-session,
  changes show up within a minute.
