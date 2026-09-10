import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import { useSession } from "../../lib/useSession";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000];

function emptyNewLine() {
  return { mat: "", batch: "", uom: "", countedQty: "", _key: Math.random().toString(36).slice(2) };
}

export default function CountBinPage() {
  const router = useRouter();
  const { bin } = router.query;
  const { session, ready } = useSession();

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null); // API response
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // editable state for existing master lines, keyed by a stable id built from the line's fields
  const [edits, setEdits] = useState({}); // key -> { countedQty, lineType, removed }
  const [newLines, setNewLines] = useState([]);
  const [overrideRecount, setOverrideRecount] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ready && !session) router.replace("/");
  }, [ready, session, router]);

  const lineKey = (l) => `${l.Mat}|${l.Batch}|${l.UOM}`;

  const load = useCallback(async () => {
    if (!bin || !session) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        sessionId: session.sessionId,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/bin/${encodeURIComponent(bin)}?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load bin");
      setData(json);
      // pre-fill edits for lines on this page that don't have edits yet
      setEdits((prev) => {
        const next = { ...prev };
        for (const l of json.lines) {
          const k = lineKey(l);
          if (!next[k]) {
            next[k] = { countedQty: l.Qty, lineType: "MATCH", removed: false };
          }
        }
        return next;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [bin, session, page, pageSize]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bin, session?.sessionId, page, pageSize]);

  function updateEdit(key, patch) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function updateNewLine(idx, patch) {
    setNewLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeNewLine(idx) {
    setNewLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave(goToNextBin) {
    if (!data) return;
    setSaving(true);
    setError("");
    try {
      const lines = [];

      for (const l of data.lines) {
        const k = lineKey(l);
        const e = edits[k];
        if (!e || e.removed) continue;
        lines.push({
          mat: l.Mat,
          batch: l.Batch,
          uom: l.UOM,
          expectedQty: l.Qty,
          countedQty: e.countedQty,
          lineType: e.lineType,
        });
      }

      for (const nl of newLines) {
        if (!nl.mat && !nl.batch && !nl.countedQty) continue; // skip totally blank rows
        lines.push({
          mat: nl.mat,
          batch: nl.batch,
          uom: nl.uom,
          expectedQty: "",
          countedQty: nl.countedQty,
          lineType: "NEW",
        });
      }

      if (lines.length === 0) {
        setError("Nothing to save on this page.");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          counterName: session.counterName,
          deviceId: session.deviceId,
          bin,
          lines,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");

      setNewLines([]);

      if (goToNextBin) {
        router.push("/scan");
      } else {
        setPage((p) => p + 1);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready || !session) return null;

  const alreadyCounted = data?.alreadyCounted || [];
  const showRecountWarning = alreadyCounted.length > 0 && !overrideRecount;

  return (
    <div className="page">
      <div className="title">Bin: {bin}</div>
      <div className="banner banner-info">
        {session.counterName} · Session {session.sessionId}
      </div>

      {showRecountWarning && (
        <div className="banner banner-warn">
          This bin was already counted in this session
          {alreadyCounted[0]?.CounterName ? ` by ${alreadyCounted[0].CounterName}` : ""}
          {alreadyCounted[0]?.Timestamp ? ` at ${alreadyCounted[0].Timestamp}` : ""}.
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-warn btn-sm" onClick={() => setOverrideRecount(true)}>
              Recount anyway
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => router.push("/scan")}>
              Back to scan
            </button>
          </div>
        </div>
      )}

      {!showRecountWarning && (
        <>
          {error && <div className="banner banner-warn">{error}</div>}
          {loading && <div>Loading…</div>}

          {data && !data.knownBin && (
            <div className="banner banner-warn">
              This bin has no expected items in the master data. You can still log what you find below using "+ Add New Line".
            </div>
          )}

          {data && data.total > 0 && (
            <div className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ margin: 0 }}>Rows per page</label>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPage(1);
                  setPageSize(Number(e.target.value));
                }}
                style={{ width: "auto" }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: "#666" }}>
                Page {data.page} / {data.totalPages} ({data.total} lines total)
              </span>
            </div>
          )}

          {data?.lines.map((l) => {
            const k = lineKey(l);
            const e = edits[k] || { countedQty: l.Qty, lineType: "MATCH", removed: false };
            if (e.removed) return null;
            return (
              <div className="card" key={k}>
                <div className="card-row"><span>Mat</span><b>{l.Mat} — {l.MatName}</b></div>
                <div className="card-row"><span>Batch</span><b>{l.Batch}</b></div>
                <div className="card-row"><span>Expected Qty</span><b>{l.Qty} {l.UOM}</b></div>
                {l.ExpirationDate && (
                  <div className="card-row"><span>Exp. Date</span><b>{l.ExpirationDate}</b></div>
                )}

                <div className="field" style={{ marginTop: 10, marginBottom: 8 }}>
                  <label>Counted Qty ({l.UOM})</label>
                  <input
                    type="number"
                    value={e.countedQty}
                    onChange={(ev) => {
                      const val = ev.target.value;
                      const isMatch = Number(val) === Number(l.Qty);
                      updateEdit(k, { countedQty: val, lineType: isMatch ? "MATCH" : "ADJUSTED" });
                    }}
                  />
                </div>

                <span className={`badge badge-${e.lineType.toLowerCase()}`}>{e.lineType}</span>{" "}
                <button
                  className="btn btn-warn btn-sm"
                  onClick={() => updateEdit(k, { countedQty: 0, lineType: "ZERO" })}
                >
                  Zero / Not Found
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => updateEdit(k, { removed: true })}
                >
                  Remove from this save
                </button>
              </div>
            );
          })}

          {newLines.map((nl, idx) => (
            <div className="card" key={nl._key}>
              <span className="badge badge-new">NEW</span>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Mat</label>
                <input value={nl.mat} onChange={(e) => updateNewLine(idx, { mat: e.target.value })} />
              </div>
              <div className="field">
                <label>Batch</label>
                <input value={nl.batch} onChange={(e) => updateNewLine(idx, { batch: e.target.value })} />
              </div>
              <div className="field">
                <label>UOM</label>
                <input value={nl.uom} onChange={(e) => updateNewLine(idx, { uom: e.target.value })} />
              </div>
              <div className="field">
                <label>Counted Qty</label>
                <input
                  type="number"
                  value={nl.countedQty}
                  onChange={(e) => updateNewLine(idx, { countedQty: e.target.value })}
                />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => removeNewLine(idx)}>
                Delete row
              </button>
            </div>
          ))}

          <button className="btn btn-secondary" onClick={() => setNewLines((prev) => [...prev, emptyNewLine()])}>
            + Add New Line
          </button>

          <div className="footer-actions">
            {data && data.page < data.totalPages ? (
              <button className="btn btn-primary" disabled={saving} onClick={() => handleSave(false)}>
                {saving ? "Saving…" : "Save & Next Page"}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={saving} onClick={() => handleSave(true)}>
                {saving ? "Saving…" : "Save & Next Bin"}
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => router.push("/scan")}>
              Cancel / Back to Scan
            </button>
          </div>
        </>
      )}
    </div>
  );
}
