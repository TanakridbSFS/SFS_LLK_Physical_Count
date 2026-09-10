import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "../lib/useSession";

export default function ScanPage() {
  const router = useRouter();
  const { session, ready } = useSession();
  const [binInput, setBinInput] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (ready && !session) {
      router.replace("/");
    }
  }, [ready, session, router]);

  useEffect(() => {
    // Keep focus on the scan field so the PDA's built-in scanner
    // (keystroke/keyboard-wedge mode) can type into it. See spec §5.
    inputRef.current?.focus();
  });

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      submitBin();
    }
  }

  function submitBin() {
    const bin = binInput.trim();
    if (!bin) return;
    router.push(`/count/${encodeURIComponent(bin)}`);
  }

  if (!ready || !session) return null;

  return (
    <div className="page">
      <div className="title">Scan Bin</div>

      <div className="banner banner-info">{session.counterName}</div>

      <div className="field">
        <label>Bin Location</label>
        <input
          ref={inputRef}
          value={binInput}
          onChange={(e) => setBinInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputRef.current?.focus()}
          placeholder="Scan or type Bin code, then Enter"
          autoFocus
        />
      </div>

      <button className="btn btn-primary" onClick={submitBin}>
        Go
      </button>
      <button className="btn btn-secondary" onClick={() => router.push("/")}>
        Change Counter
      </button>
    </div>
  );
}
