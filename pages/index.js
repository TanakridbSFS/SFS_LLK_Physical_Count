import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "../lib/useSession";

export default function StartPage() {
  const router = useRouter();
  const { session, ready, startSession } = useSession();
  const [counterName, setCounterName] = useState("");

  useEffect(() => {
    if (!ready) return;
    setCounterName(session?.counterName || "");
  }, [ready, session]);

  function handleStart() {
    if (!counterName.trim()) {
      alert("Please enter your name.");
      return;
    }
    startSession({ counterName: counterName.trim() });
    router.push("/scan");
  }

  if (!ready) return null;

  return (
    <div className="page">
      <div className="title">Stock Count — Start</div>

      <div className="field">
        <label>Your name (CounterName)</label>
        <input
          value={counterName}
          onChange={(e) => setCounterName(e.target.value)}
          onKeyDown={(e) => {
            // Same as /scan — Enter (typed, or from a PDA that sends one
            // after scanning/typing) should just go, not be swallowed.
            if (e.key === "Enter") {
              e.preventDefault();
              handleStart();
            }
          }}
          placeholder="e.g. Somchai"
          autoFocus
        />
      </div>

      <button className="btn btn-primary" onClick={handleStart}>
        Start Counting
      </button>
    </div>
  );
}
