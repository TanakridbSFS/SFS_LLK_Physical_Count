import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import { useSession } from "../../lib/useSession";
import { UOM_OPTIONS } from "../../lib/uomOptions";
import { padBatch } from "../../lib/binMasterConvert";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000];

function emptyNewLine() {
  return { mat: "", batch: "", uom: UOM_OPTIONS[0], countedQty: "", _key: Math.random().toString(36).slice(2) };
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
  // status: 'unanswered' | 'correct' | 'wrong'
  const [edits, setEdits] = useState({});
  const [newLines, setNewLines] = useState([]);
  const [overrideRecount, setOverrideRecount] = useState(false);
  const [saving, setSaving] = useState(false);

  // Summary/confirm step shown before the final submit for this bin (last
  // page) — nothing is sent to the sheet until confirmed here.
  const [showSummary, setShowSummary] = useState(false);
  const [pendingLines, setPendingLines] = useState([]);

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
            next[k] = { status: "unanswered", countedQty: "" };
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
  }, [bin, session?.counterName, page, pageSize]);

  function updateEdit(key, patch) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function markCorrect(key) {
    updateEdit(key, { status: "correct", countedQty: "" });
  }

  function markWrong(key) {
    updateEdit(key, { status: "wrong", countedQty: "" });
  }

  function markNotFound(key) {
    // 0 is already a definitive answer — close it right away, same as
    // finishing a typed quantity.
    updateEdit(key, { status: "wrong_closed", countedQty: "0" });
  }

  // Closes the box after typing an actual quantity for a "ผิด" line —
  // summarizes it (like "ถูก" does) without submitting anything yet.
  function closeWrong(key, countedQty) {
    if (String(countedQty).trim() === "") return; // nothing to close yet
    updateEdit(key, { status: "wrong_closed", countedQty });
  }

  // Reopens a closed "ผิด" line for editing — keeps the value that was
  // there so it doesn't need retyping.
  function reopenWrong(key) {
    updateEdit(key, { status: "wrong" });
  }

  function undoAnswer(key) {
    updateEdit(key, { status: "unanswered", countedQty: "" });
  }

  function updateNewLine(idx, patch) {
    setNewLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeNewLine(idx) {
    setNewLines((prev) => prev.filter((_, i) => i !== idx));
  }

  // Builds + validates the list of lines that would be saved right now.
  // Returns null (and sets the error banner) if something's not ready yet.
  function buildLinesToSave() {
    const lines = [];

    for (const l of data.lines) {
      const k = lineKey(l);
      const e = edits[k] || { status: "unanswered", countedQty: "" };
      if (e.status === "unanswered") continue; // not answered yet — leave for later
      if (e.status === "wrong") {
        // Still open (not closed with "ปิด" yet) — not ready to save.
        setError(`Please finish ${l.Mat} (${l.Batch}) — enter a quantity and tap "ปิด", or use "ไม่พบสินค้า (0)".`);
        return null;
      }
      if (e.status === "wrong_closed" && String(e.countedQty).trim() === "") {
        // Shouldn't happen (closeWrong/markNotFound only ever set this with
        // a value), but guard anyway rather than silently falling through.
        setError(`Please enter a quantity for ${l.Mat} (${l.Batch}), or use "Not Found" for 0.`);
        return null;
      }
      const countedQty = e.status === "correct" ? l.Qty : Number(e.countedQty);
      const lineType = e.status === "correct" ? "MATCH" : countedQty === 0 ? "ZERO" : "ADJUSTED";
      lines.push({
        mat: l.Mat,
        matName: l.MatName,
        batch: l.Batch,
        uom: l.UOM,
        expectedQty: l.Qty,
        countedQty,
        lineType,
      });
    }

    for (const nl of newLines) {
      if (!nl.mat && !nl.batch && !nl.countedQty) continue; // skip totally blank rows
      if (String(nl.countedQty).trim() === "") {
        setError(`Please enter a quantity for the new line (Mat: ${nl.mat || "—"}).`);
        return null;
      }
      lines.push({
        mat: nl.mat,
        matName: "",
        batch: padBatch(nl.batch),
        uom: nl.uom,
        expectedQty: "",
        countedQty: Number(nl.countedQty),
        lineType: "NEW",
      });
    }

    if (lines.length === 0) {
      setError("Nothing to save yet — answer at least one line (ถูก/ผิด) or add a new line.");
      return null;
    }

    return lines;
  }

  // "Save & Next Page" — no bin summary needed yet, save this page right away.
  function handleSaveAndNextPage() {
    setError("");
    const lines = buildLinesToSave();
    if (!lines) return;
    submitLines(lines, false);
  }

  // "Save & Next Bin" (last page) — show a summary of everything about to
  // be written first; the actual save happens on "ยืนยันและบันทึก" below.
  function handleReviewBeforeFinish() {
    setError("");
    const lines = buildLinesToSave();
    if (!lines) return;
    setPendingLines(lines);
    setShowSummary(true);
  }

  async function submitLines(lines, goToNextBin) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterName: session.counterName,
          deviceId: session.deviceId,
          bin,
          lines,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");

      setNewLines([]);
      setShowSummary(false);
      setPendingLines([]);

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
      <div className="banner banner-info">{session.counterName}</div>

      {showRecountWarning && (
        <div className="banner banner-warn">
          This bin was already counted today
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

      {!showRecountWarning && showSummary && (
        <>
          <div className="banner banner-info">
            Summary for this bin — check before saving. Nothing is written yet.
          </div>
          {error && <div className="banner banner-warn">{error}</div>}

          {pendingLines.map((l, idx) => (
            <div className="card" key={`${l.mat}|${l.batch}|${l.uom}|${idx}`}>
              <div className="card-row"><span>Mat</span><b>{l.mat}{l.matName ? ` — ${l.matName}` : ""}</b></div>
              <div className="card-row"><span>Batch</span><b>{l.batch || "—"}</b></div>
              <div className="card-row"><span>Expected</span><b>{l.expectedQty === "" ? "—" : `${l.expectedQty} ${l.uom}`}</b></div>
              <div className="card-row"><span>Counted</span><b>{l.countedQty} {l.uom}</b></div>
              <span className={`badge badge-${l.lineType.toLowerCase()}`}>{l.lineType}</span>
            </div>
          ))}

          <div className="footer-actions">
            <button className="btn btn-primary" disabled={saving} onClick={() => submitLines(pendingLines, true)}>
              {saving ? "Saving…" : "ยืนยันและบันทึก (Confirm & Save)"}
            </button>
            <button className="btn btn-secondary" disabled={saving} onClick={() => setShowSummary(false)}>
              กลับไปแก้ไข (Back to edit)
            </button>
          </div>
        </>
      )}

      {!showRecountWarning && !showSummary && (
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
            const e = edits[k] || { status: "unanswered", countedQty: "" };
            return (
              <div className="card" key={k}>
                <div className="card-row"><span>Mat</span><b>{l.Mat} — {l.MatName}</b></div>
                <div className="card-row"><span>Batch</span><b>{l.Batch}</b></div>
                <div className="card-row"><span>Expected Qty</span><b>{l.Qty} {l.UOM}</b></div>
                {l.ExpirationDate && (
                  <div className="card-row"><span>Exp. Date</span><b>{l.ExpirationDate}</b></div>
                )}

                {e.status === "unanswered" && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-correct btn-sm" onClick={() => markCorrect(k)}>
                      ✓ ถูก
                    </button>
                    <button className="btn btn-wrong btn-sm" onClick={() => markWrong(k)}>
                      ✕ ผิด
                    </button>
                  </div>
                )}

                {e.status === "correct" && (
                  <div style={{ marginTop: 10 }}>
                    <span className="badge badge-match">MATCH — {l.Qty} {l.UOM}</span>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => undoAnswer(k)}>
                      แก้ไข
                    </button>
                  </div>
                )}

                {e.status === "wrong" && (
                  <div style={{ marginTop: 10 }}>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>Counted Qty ({l.UOM})</label>
                      <input
                        type="number"
                        autoFocus
                        value={e.countedQty}
                        onChange={(ev) => updateEdit(k, { countedQty: ev.target.value })}
                        onKeyDown={(ev) => {
                          // PDA scanners send Enter after typing — make it do
                          // the useful thing here: close this box, same as
                          // tapping "ปิด".
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            closeWrong(k, ev.target.value);
                          }
                        }}
                      />
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => closeWrong(k, e.countedQty)}>
                      ปิด
                    </button>
                    <button className="btn btn-warn btn-sm" onClick={() => markNotFound(k)}>
                      ไม่พบสินค้า (0)
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => undoAnswer(k)}>
                      ยกเลิก
                    </button>
                  </div>
                )}

                {e.status === "wrong_closed" && (
                  <div style={{ marginTop: 10 }}>
                    <span className={`badge badge-${Number(e.countedQty) === 0 ? "zero" : "adjusted"}`}>
                      {Number(e.countedQty) === 0 ? "ZERO" : "ADJUSTED"} — {e.countedQty} {l.UOM}
                    </span>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => reopenWrong(k)}>
                      แก้ไข
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {newLines.map((nl, idx) => (
            <div className="card" key={nl._key}>
              <span className="badge badge-new">NEW</span>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Mat</label>
                <input
                  id={`newline-${nl._key}-mat`}
                  value={nl.mat}
                  onChange={(e) => updateNewLine(idx, { mat: e.target.value })}
                  onKeyDown={(e) => {
                    // Scanner Enter after Mat → jump straight to Batch,
                    // same "useful auto-advance" idea as the Bin scan field.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      document.getElementById(`newline-${nl._key}-batch`)?.focus();
                    }
                  }}
                />
              </div>
              <div className="field">
                <label>Batch</label>
                <input
                  id={`newline-${nl._key}-batch`}
                  value={nl.batch}
                  onChange={(e) => updateNewLine(idx, { batch: e.target.value })}
                  onKeyDown={(e) => {
                    // Skip the UOM dropdown (manually chosen, not scanned) —
                    // go straight to Counted Qty.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      document.getElementById(`newline-${nl._key}-qty`)?.focus();
                    }
                  }}
                />
              </div>
              <div className="field">
                <label>UOM</label>
                <select value={nl.uom} onChange={(e) => updateNewLine(idx, { uom: e.target.value })}>
                  {UOM_OPTIONS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Counted Qty</label>
                <input
                  id={`newline-${nl._key}-qty`}
                  type="number"
                  value={nl.countedQty}
                  onChange={(e) => updateNewLine(idx, { countedQty: e.target.value })}
                  onKeyDown={(e) => {
                    // Finishing this row by Enter — just settle focus here
                    // rather than doing anything surprising (adding another
                    // row automatically wasn't explicitly requested).
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.target.blur();
                    }
                  }}
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
              <button className="btn btn-primary" disabled={saving} onClick={handleSaveAndNextPage}>
                {saving ? "Saving…" : "Save & Next Page"}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={saving} onClick={handleReviewBeforeFinish}>
                Review & Finish Bin
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
