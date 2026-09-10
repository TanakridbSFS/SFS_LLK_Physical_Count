import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useSession, defaultSessionId } from "../lib/useSession";

export default function StartPage() {
  const router = useRouter();
  const { session, ready, startSession } = useSession();
  const [counterName, setCounterName] = useState("");
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    if (!ready) return;
    setCounterName(session?.counterName || "");
    setSessionId(session?.sessionId || defaultSessionId());
  }, [ready, session]);

  function handleStart() {
    if (!counterName.trim() || !sessionId.trim()) {
      alert("Please enter both your name and the session/round ID.");
      return;
    }
    startSession({ counterName: counterName.trim(), sessionId: sessionId.trim() });
    router.push("/scan");
  }

  if (!ready) return null;

  return (
    <div className="page">
      <div className="title">Stock Count — Start Session</div>

      <div className="field">
        <label>Your name (CounterName)</label>
        <input
          value={counterName}
          onChange={(e) => setCounterName(e.target.value)}
          placeholder="e.g. Somchai"
        />
      </div>

      <div className="field">
        <label>Session / Round ID</label>
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="e.g. 2026-09-09_R1"
        />
        <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
          Everyone counting in the same round should use the same Session ID —
          it's what stops two people re-counting the same bin.
        </div>
      </div>

      <button className="btn btn-primary" onClick={handleStart}>
        Start Counting
      </button>
    </div>
  );
}
