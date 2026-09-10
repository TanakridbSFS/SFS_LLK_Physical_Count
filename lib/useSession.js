import { useEffect, useState } from "react";

const STORAGE_KEY = "stockcount_session_v1";

function loadFromStorage() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(session) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage can throw in some contexts (private mode, quota) — non-fatal,
    // the session just won't survive a reload.
  }
}

function randomDeviceId() {
  return "dev-" + Math.random().toString(36).slice(2, 8);
}

// Client-side identity: who's counting, and a per-device id (for
// traceability in CountRecord.DeviceID). No username/password login, and
// no Session/Round ID either (removed per your request) — just a name.
export function useSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let existing = loadFromStorage();
    if (existing && !existing.deviceId) {
      existing = { ...existing, deviceId: randomDeviceId() };
    }
    setSession(existing);
    setReady(true);
  }, []);

  function startSession({ counterName }) {
    const deviceId = session?.deviceId || randomDeviceId();
    const next = { counterName, deviceId };
    setSession(next);
    saveToStorage(next);
  }

  function clearSession() {
    setSession(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  return { session, ready, startSession, clearSession };
}
