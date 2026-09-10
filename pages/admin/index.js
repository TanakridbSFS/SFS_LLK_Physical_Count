import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminConsole() {
  const [masterStatus, setMasterStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState("ALL");
  const [loadingSessions, setLoadingSessions] = useState(false);

  async function loadMasterStatus() {
    try {
      const res = await fetch("/api/admin/master-status");
      const json = await res.json();
      setMasterStatus(json);
    } catch {
      // non-fatal — just shows blank status
    }
  }

  async function loadSessions(forceRefresh) {
    setLoadingSessions(true);
    try {
      const res = await fetch(`/api/admin/sessions${forceRefresh ? "?forceRefresh=1" : ""}`);
      const json = await res.json();
      setSessions(json.sessions || []);
    } catch {
      // non-fatal
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    loadMasterStatus();
    loadSessions(false);
  }, []);

  async function handleRefreshMaster() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const res = await fetch("/api/admin/refresh-master", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to refresh");
      setMasterStatus({ rowCount: json.rowCount, refreshedAt: json.refreshedAt });
      setRefreshMsg(`Refreshed — ${json.rowCount} rows loaded from BinMaster.`);
    } catch (e) {
      setRefreshMsg(`Error: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  function handleExport() {
    const params = new URLSearchParams({ sessionId: selectedSession });
    window.location.href = `/api/admin/export?${params}`;
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="title">Admin Console</div>
      <div className="banner banner-info">
        For office use — not needed on the PDA. <Link href="/scan">Go to counting app →</Link>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Master Data (BinMaster)</div>
        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Edits to the Master Ref Google Sheet apply automatically within about
          a minute (the app caches it briefly to avoid hitting Google's API
          quota). Use this if you just edited it and want the app to pick it
          up immediately instead of waiting.
        </div>
        <div className="card-row">
          <span>Rows currently loaded</span>
          <b>{masterStatus?.rowCount ?? "—"}</b>
        </div>
        <div className="card-row">
          <span>Last refreshed</span>
          <b>{masterStatus?.refreshedAt ? new Date(masterStatus.refreshedAt).toLocaleString() : "—"}</b>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={refreshing} onClick={handleRefreshMaster}>
          {refreshing ? "Refreshing…" : "Refresh Master Data Now"}
        </button>
        {refreshMsg && <div style={{ fontSize: 13, marginTop: 6 }}>{refreshMsg}</div>}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Export Count Records</div>
        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Downloads the raw CountRecord log as a CSV file — every MATCH /
          ADJUSTED / NEW / ZERO line ever saved, for the session you pick (or
          everything).
        </div>

        <div className="field">
          <label>Session</label>
          <select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}>
            <option value="ALL">All sessions</option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId} ({s.rowCount} rows{s.lastTimestamp ? `, last ${new Date(s.lastTimestamp).toLocaleString()}` : ""})
              </option>
            ))}
          </select>
        </div>

        <button className="btn btn-secondary btn-sm" disabled={loadingSessions} onClick={() => loadSessions(true)}>
          {loadingSessions ? "Loading…" : "Refresh session list"}
        </button>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={handleExport}>
          Download CSV
        </button>
      </div>
    </div>
  );
}
