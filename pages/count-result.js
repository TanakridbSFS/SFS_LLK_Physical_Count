import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Count Result — Mat|Batch rollup table (Expected / Actual / Diff), ignoring
// Bin Location entirely. Filters live right at the table header: a zone
// dropdown (ALL/F=Frozen/C=Chilled/D=Dry) wired to the API's ?zone= param,
// a Mat/Batch text search, a Diff status filter (Match/Short/Over), and
// clickable sortable column headers. Auto-refreshes every 60s, plus a
// manual Force Refresh button.

const POLL_MS = 60000;

const ZONE_OPTIONS = [
  { value: "ALL", label: "All zones" },
  { value: "F", label: "F — Frozen" },
  { value: "C", label: "C — Chilled" },
  { value: "D", label: "D — Dry" },
];

const DIFF_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "MATCH", label: "Match (ตรง)" },
  { value: "SHORT", label: "Short (ขาด)" },
  { value: "OVER", label: "Over (เกิน)" },
];

const COLUMNS = [
  { key: "mat", label: "Mat" },
  { key: "matName", label: "Material Name" },
  { key: "batch", label: "Batch" },
  { key: "uom", label: "UOM" },
  { key: "expected", label: "Expected" },
  { key: "actual", label: "Actual" },
  { key: "diff", label: "Diff" },
];

function diffStatus(diff) {
  if (diff === 0) return "MATCH";
  return diff < 0 ? "SHORT" : "OVER";
}

export default function CountResultPage() {
  const [zone, setZone] = useState("ALL");
  const [search, setSearch] = useState("");
  const [diffFilter, setDiffFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState("mat");
  const [sortDir, setSortDir] = useState("asc");

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const zoneRef = useRef(zone);
  zoneRef.current = zone;

  async function load(forceRefresh) {
    try {
      const params = new URLSearchParams({ zone: zoneRef.current });
      if (forceRefresh) params.set("forceRefresh", "1");
      const res = await fetch(`/api/count-result?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load count result");
      setRows(json.rows || []);
      setStatus("ready");
      setLastUpdated(new Date());
      setError("");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    setStatus("loading");
    load(false);
    const timer = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [zone]);

  async function handleForceRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const q = search.trim().toLowerCase();
  let visible = rows.filter((r) => {
    if (q) {
      const hay = `${r.mat} ${r.batch} ${r.matName || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (diffFilter !== "ALL" && diffStatus(r.diff) !== diffFilter) return false;
    return true;
  });

  visible = [...visible].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av ?? "").localeCompare(String(bv ?? ""));
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totals = visible.reduce(
    (acc, r) => {
      acc.expected += r.expected;
      acc.actual += r.actual;
      acc.diff += r.diff;
      return acc;
    },
    { expected: 0, actual: 0, diff: 0 }
  );

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Count Result</div>
          <div style={{ fontSize: 13, color: "#666" }}>
            Rolled up by Mat + Batch — Bin Location is not considered.{" "}
            <Link href="/">← Back</Link>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: "#666" }}>
          {lastUpdated && <div>Updated {lastUpdated.toLocaleTimeString()} · auto every 1 min</div>}
          <button
            onClick={handleForceRefresh}
            disabled={refreshing}
            style={{
              marginTop: 4,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: refreshing ? "#eee" : "#fff",
              cursor: refreshing ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            {refreshing ? "Refreshing…" : "⟳ Force Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{
                    textAlign: col.key === "matName" ? "left" : "right",
                    padding: "8px 10px",
                    borderBottom: "2px solid #e5e7eb",
                    cursor: "pointer",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
            {/* Filter row, right at the table header as requested */}
            <tr style={{ background: "#fff" }}>
              <th colSpan={2} style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Mat / Batch / Name…"
                  style={{ width: "100%", padding: "5px 8px", fontSize: 13, border: "1px solid #ccc", borderRadius: 5 }}
                />
              </th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
                <select value={zone} onChange={(e) => setZone(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "5px 4px" }}>
                  {ZONE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }} />
              <th colSpan={2} style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }} />
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
                <select value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "5px 4px" }}>
                  {DIFF_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {status === "loading" && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 16, textAlign: "center", color: "#888" }}>
                  Loading…
                </td>
              </tr>
            )}
            {status !== "loading" && visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 16, textAlign: "center", color: "#888" }}>
                  No rows match.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const ds = diffStatus(r.diff);
              const diffColor = ds === "MATCH" ? "#16a34a" : ds === "SHORT" ? "#dc2626" : "#d97706";
              return (
                <tr key={`${r.mat}-${r.batch}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.mat}</td>
                  <td style={{ padding: "7px 10px", textAlign: "left" }}>{r.matName || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.batch}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.uom || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.expected}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.actual}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: diffColor, fontWeight: 600 }}>
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td colSpan={4} style={{ padding: "8px 10px", textAlign: "right" }}>
                  Total ({visible.length} lines)
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{totals.expected}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{totals.actual}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  {totals.diff > 0 ? `+${totals.diff}` : totals.diff}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
