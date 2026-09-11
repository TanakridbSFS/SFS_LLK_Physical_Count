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

**Paste the raw WMS export straight in** — copy the entire contents of a
`PHYSICAL_INVENTORY_EXPORT_*.xlsx` file (header row and all, all 16
columns A–P: Owner, Owner Code, SKU Code, SKU Name, Inventory Status, ERP
Batch Number, Total quantity, Occupied Qty., Available Qty., Basic UOM,
Warehouse area code, Location Type, Container Code, Bin-location Code,
Manufacturing Date, Expiration Date) into this tab, starting at cell A1. No
conversion step needed — the app reads this raw shape directly and does
the grouping itself, every time it fetches master data (see
`lib/binMasterConvert.js`):

- Drops `Location Type = CONTAINER` rows (`Container Code` always
  `PICK_CONTAINER` — a picking tote, not a real bin).
- Groups the rest by (Container Code, SKU Code, ERP Batch Number, Basic
  UOM) — this becomes the app's idea of "Bin", "Mat", "Batch", "UOM".
- Sums `Total quantity` within each group, collapsing the `Inventory
  Status` split (UR/Block/QI) into one number, per your decision.
- Pads `Batch` back out to a 10-digit text code (e.g. `9` → `0000000009`)
  — Google Sheets' numeric read can silently drop the leading zeros from a
  batch number, so this is re-applied on every read *and* every write
  (`lib/binMasterConvert.js`'s `padBatch`), including batches typed by
  hand on "+ Add New Line".

To refresh for a new cycle-count round: just select the whole tab, delete
it, and paste in a fresh export. Then hit "Refresh Master Data Now" on the
admin console (§5) if you don't want to wait for the 1-minute cache.

*(There's also `tools/convert_export_to_binmaster.py` in this repo, which
does the same grouping as a standalone script — useful if you ever want to
eyeball the converted result locally, but the app itself doesn't need it
now.)*

### 1.2 Record File — tab `CountRecord`

Rename the tab to `CountRecord` (or set `RECORD_TAB` to match). Header row,
columns A–J (no Session ID — removed per your request):

```
Timestamp | CounterName | Bin | Mat | Batch | UOM | ExpectedQty | CountedQty | LineType | DeviceID
```

Leave the rest of the sheet empty — the app only ever **appends** rows
here; it never edits or deletes existing ones. `LineType` will be one of
`MATCH`, `ADJUSTED`, `NEW`, `ZERO`, or `EMPTY` (bin had no expected items
and was confirmed as "nothing found" — no Mat/Batch/UOM on that row).
`Timestamp` is written in **Thai local time** (UTC+7, e.g.
`2026-09-11T09:47:23+07:00`), not server UTC — see `lib/time.js`; the
"already counted today" check (§6) uses the same Thai calendar day, so the
two stay consistent.

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

- **Start** (`/`) — counter types their name only (no username/password
  login, and no Session/Round ID either — removed per your request).
  Stored on-device (`localStorage`) so it survives closing the browser.
- **Scan Bin** (`/scan`) — a text field stays focused; the PDA's built-in
  scanner types the Bin code into it and sends Enter automatically
  (keyboard-wedge mode — no extra scanner setup needed).
- **Confirm/Adjust** (`/count/[bin]`) — shows expected lines for that bin
  (paginated — 20/50/100/500/1000 per page, since some bins have 1,000+
  lines). Wherever a UOM of **`KG`** is shown on this screen it's
  highlighted in yellow — it's the easiest unit to miscount by hand on a
  scale reading, so it's meant to catch the eye while scanning. Each line
  starts with two buttons: **✓ Correct** (matches — no
  typing needed, saves the expected quantity as-is) or **✕ Wrong** (reveals a
  quantity field). After typing the actual quantity for a "Wrong" line, tap
  **Confirm** (or just press Enter in the field — the PDA scanner's
  auto-Enter does this for you) to close it into a short summary badge
  (`ADJUSTED — 45 KG` / `ZERO — 0 KG`), with an "Edit" button to reopen it
  without retyping if you need to correct the number. A "No Product"
  shortcut closes the box immediately with 0 (since a wrong line always
  gets *some* number logged, never just deleted, and 0 is already a
  definitive answer — no need to tap "Confirm" separately). None of this is
  sent to the sheet yet — it only updates the on-screen state, the same as
  "Correct" — the actual save still only happens at "Review & Finish Bin" /
  "Confirm & Save" below. If the bin has **no expected items at all** in
  Master data, it shows a "✓ Confirm — Nothing Found" button instead —
  logs a single `EMPTY` record for the bin (so "checked, nothing here" is
  captured properly, instead of forcing a fake New Line just to get past
  validation); "+ Add New Line" still works normally if stock actually
  turns up there. Unexpected stock goes in via "+ Add New Line" — typing a
  Mat code there auto-fills its UOM from `lib/materialUom.json` (bundled in
  the repo, converted from your `Master_UOM.xlsx`) shown read-only with an
  "Override" button, in case that's ever wrong; a Mat that isn't in that
  list falls back to the manual dropdown (the 15 units in
  `lib/uomOptions.js`) instead, same as before. See "Updating the
  Material→UOM list" below for how to refresh it. Existing lines keep
  BinMaster's UOM as-is, unaffected by any of this. Its Mat/Batch
  fields also treat Enter as "move to the next field" (Mat → Batch →
  Counted Qty, skipping the UOM dropdown since that's chosen by hand, not
  scanned), matching how the Bin-scan field already uses Enter to jump
  straight into a bin — the PDA's auto-Enter-after-scan is put to use
  everywhere it can be instead of just being swallowed. Some PDA barcodes
  encode `SKU|Batch|Qty` in one scan instead of two separate SKU-only /
  Batch-only barcodes — scanning one of those into either Mat or Batch
  splits it and fills both fields at once (never Qty — that's still typed
  in by hand from the actual count), then jumps straight to Counted Qty
  instead of stopping at Batch. A plain single-value scan (no `|`) still
  only fills whichever field it landed in, same as before. If the bin
  already has a CountRecord row from earlier *today*, it warns before
  letting you recount (there's no Session ID to scope this to anymore, so
  it's judged by date instead — see §6). On a bin's last page, "Save &
  Next Page" becomes **"Review & Finish Bin"** instead of saving right
  away — it shows a summary of every line about to be written (Mat, Batch,
  Expected vs. Counted, MATCH/ADJUSTED/ZERO/NEW/EMPTY) with a "Confirm &
  Save" button to actually submit, or "Back to Edit" to change something
  first. Nothing on that last page is saved until confirmed there. (Earlier
  pages of a large, paginated bin still save immediately on "Save & Next
  Page" — the summary step is only for the final page, right before moving
  to the next bin.)
- Every save appends rows to `CountRecord` — nothing is ever overwritten.

### 4.1 Updating the Material→UOM list

`lib/materialUom.json` is a plain `{ "matCode": "UOM", ... }` map, generated
once from your `Master_UOM.xlsx` (`Material` + `Base Unit of Measure`
columns) — it's a static file in the repo, not read from Google Sheets, so
it needs no extra env var and doesn't get re-checked on every request.

Since this list only changes rarely, there's no in-app upload for it —
just send an updated `Master_UOM.xlsx` and regenerate the JSON:

```bash
python3 -c "
import openpyxl, json
wb = openpyxl.load_workbook('Master_UOM.xlsx', data_only=True)
ws = wb['Master_UOM']
mapping = {
    str(r[0]).strip(): str(r[2]).strip()
    for r in ws.iter_rows(min_row=2, values_only=True) if r[0]
}
json.dump(mapping, open('lib/materialUom.json', 'w'), separators=(',', ':'), sort_keys=True)
"
```

Then commit `lib/materialUom.json` and redeploy — same as any other code
change. A Mat code missing from this file just falls back to the manual
UOM dropdown, so it's safe if the list is a little out of date.

## 5. Admin Console (`/admin`)

A small office-use page, separate from the PDA counting flow:

- **Refresh Master Data Now** — the app normally re-reads the Master Ref
  sheet at most once a minute (to stay within Google's API quota). If you
  just edited `BinMaster` directly in the sheet and want the change to show
  up immediately, this button forces that re-read right away and shows the
  row count + timestamp of the refresh.
- **Export Count Records** — downloads the raw `CountRecord` log as a CSV,
  either for one date or for everything ever counted (dates, not Session
  IDs, since there's no Session ID anymore).

No passcode gate — by your call, since this only ever *reads* fresh data or
*triggers a re-read*, it doesn't overwrite anything itself. (Editing
`BinMaster`'s actual contents is still done directly in the Google Sheet, or
via the conversion script in §1.1 — the console's "Refresh" button doesn't
change what's in the sheet, just how soon the app notices.) If this page
ever grows a feature that writes data, revisit that call.

## 6. Known simplifications

- No Session/Round ID anymore (removed per your request) — so "already
  counted" is judged by **date**: if a Bin already has a CountRecord row
  from earlier today, the app warns before letting anyone recount it that
  same day. A different day (a later cycle-count round) counts it again
  freely, no warning. Two PDAs both counting the same bin *today* is what
  this catches; it doesn't distinguish rounds within the same day.
- It also does not currently track partial progress within a large bin's
  pages — if interrupted partway through a big bin, re-opening it later
  today will show the "already counted today" warning (since a row exists
  from page 1), and resuming means overriding and paging forward, which is
  safe since earlier pages just don't need re-saving.
- No variance/reconciliation report is built (per your earlier answer) —
  `CountRecord` is the raw log; analysis happens outside the app.
- Expected quantities are read live from `BinMaster` on every scan, cached
  for 1 minute per server instance — if you edit `BinMaster` mid-session,
  changes show up within a minute (or immediately via the admin console's
  "Refresh Master Data Now").

## 7. Live 3D Warehouse Dashboard (`/dashboard`)

A separate, read-only view for the office — walk-through-the-warehouse-style
3D map of the Frozen zone (rendered with [three.js](https://threejs.org/),
mouse/touch to rotate/zoom/pan), colored per bin by its most recent
`CountRecord` status (`MATCH`/`ADJUSTED`/`ZERO`/`NEW`/`EMPTY`, or grey for
`UNCOUNTED`). Polls `/api/dashboard/bins` every 30s so it stays current
while left open on a screen. Hover a cube for its Bin code, status, counted
qty, who counted it and when.

**Current scope: Rack FA only** (432 bins) — the first cut, built from the
real bin-location export (`WMS_PRD_binLocation_*.xlsx`) you provided.
Coordinates come straight from each Bin's code (`FA-<position>-<layer>`):
position 01–108 alternates right/left side of the two-sided rack (odd =
right, even = left) walking down the aisle, and layer letter maps to shelf
level (`A`→1, `G`→2, `H`→3, `J`→4).

**To add another rack** (FB, FC, … FJ) later:
1. Re-run the same conversion logic used for `lib/warehouseLayoutFA.json`
   against that rack's rows in the bin-location export (filter by
   `aisle_code`, parse `code` as `<aisle>-<position>-<layer>`, compute
   `depth = ceil(position/2)`, `side = odd?"right":"left"`,
   `level` from the A/G/H/J→1/2/3/4 map) — send me the export again and
   I'll generate `lib/warehouseLayout<RACK>.json` the same way.
2. Register it in `RACK_LAYOUTS` in `pages/api/dashboard/bins.js`.
3. The dashboard page currently hardcodes `?rack=FA` — once more than one
   rack exists it'll need a rack picker (not built yet, since this is the
   single-rack first cut).

The rack-to-rack physical order confirmed for the Frozen zone (right to
left, facing into the warehouse) is **FJ FH FG FF FE FD FC FB FA**; that
ordering isn't used yet since only FA is wired up, but it's what a later
multi-rack layout (offsetting each rack's X position) should follow.
