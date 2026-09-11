import { useEffect, useRef, useState } from "react";

// Live 3D warehouse dashboard — every Bin in the Frozen zone (all 9 racks,
// FA through FJ). Renders each bin as a cube positioned by its real
// depth/side/level/rack (see pages/api/dashboard/bins.js + lib/
// warehouseLayout.json for how the layout is built), colored by its most
// recent count status, and polls for updates so it stays "live" on screen.
//
// Coordinate mapping:
//   depth (1..54)    -> X — position walking down the aisle
//   rackIndex (0..8)  -> Z lane — which of the 9 racks (order confirmed:
//                        FJ FH FG FF FE FD FC FB FA, right to left)
//   side (L/R)       -> small Z offset within that rack's lane — which
//                        face of the two-sided rack
//   level (1..4)     -> Y — shelf height (A/G/H/J)
//   FH/FJ's level-1 splits into 6 sub-slots (AA-AF) instead of one "A" —
//   those get stacked as 6 thinner boxes filling that same level-1 slot.

const STATUS_COLORS = {
  MATCH: 0x22c55e,
  ADJUSTED: 0xf59e0b,
  ZERO: 0xef4444,
  NEW: 0x3b82f6,
  EMPTY: 0x6366f1,
  UNCOUNTED: 0x9ca3af,
};

const POLL_MS = 60000; // "auto every 1 minute" per request
const SPACING = 1.15;
const BOX_SIZE = 0.9;
const RACK_SPACING = 6; // gap between adjacent racks' Z lanes

function cellPosition(cell) {
  const x = cell.depth * SPACING;
  const laneZ = cell.rackIndex * RACK_SPACING;
  const sideZ = cell.side === "right" ? 1.2 : -1.2;
  const z = laneZ + sideZ;
  let y, scaleY;
  if (cell.totalSub === 6) {
    // 6 thin slots stacked to fill the same vertical space level 1 would
    // otherwise take up as a single box.
    const slotH = SPACING / 6;
    y = (cell.level - 1) * SPACING + cell.subIndex * slotH + slotH / 2;
    scaleY = 0.85 / 6;
  } else {
    y = (cell.level - 1) * SPACING + 0.5;
    scaleY = 1;
  }
  return { x, y, z, scaleY };
}

export default function WarehouseDashboard() {
  const mountRef = useRef(null);
  const stateRef = useRef({}); // holds three.js objects across renders without re-triggering React
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [counts, setCounts] = useState(null); // { total, byStatus }
  const [hover, setHover] = useState(null); // bin cell + status fields
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // ---- three.js scene setup (once) ----
  useEffect(() => {
    let disposed = false;

    async function init() {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed || !mountRef.current) return;

      const mount = mountRef.current;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1120);

      const camera = new THREE.PerspectiveCamera(
        50,
        mount.clientWidth / mount.clientHeight,
        0.1,
        1000
      );
      // Framed for a full laptop-width view of all 9 racks — refined once
      // real bounds are known, see fitCameraToBins() below.
      camera.position.set(60, 55, 95);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(30, 2, 24);
      controls.update();
      controls.enableDamping = true;

      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const dir = new THREE.DirectionalLight(0xffffff, 0.6);
      dir.position.set(40, 60, 40);
      scene.add(dir);

      const geometry = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff });

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      stateRef.current = {
        THREE,
        scene,
        camera,
        renderer,
        controls,
        geometry,
        material,
        mesh: null, // set once bin data arrives
        bins: [],
        raycaster,
        pointer,
        cameraFitted: false,
      };

      function onResize() {
        if (!mount) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      }
      window.addEventListener("resize", onResize);

      function onPointerMove(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const { mesh, bins } = stateRef.current;
        if (!mesh) return;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(mesh);
        if (hit.length > 0 && hit[0].instanceId != null) {
          setHover(bins[hit[0].instanceId]);
        } else {
          setHover(null);
        }
      }
      renderer.domElement.addEventListener("pointermove", onPointerMove);

      let raf;
      function animate() {
        raf = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      stateRef.current.cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.dispose();
        geometry.dispose();
        material.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    }

    init();

    return () => {
      disposed = true;
      stateRef.current.cleanup?.();
    };
  }, []);

  // ---- data fetch + poll ----
  useEffect(() => {
    let stopped = false;
    let timer;

    async function load(forceRefresh) {
      try {
        const res = await fetch(`/api/dashboard/bins${forceRefresh ? "?forceRefresh=1" : ""}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load dashboard data");
        if (stopped) return;
        applyBins(json.bins);
        setStatus("ready");
        setLastUpdated(new Date());
        setError("");
      } catch (e) {
        if (!stopped) {
          setError(e.message);
          setStatus("error");
        }
      } finally {
        if (!stopped) timer = setTimeout(() => load(false), POLL_MS);
      }
    }

    function fitCameraToBins(bins) {
      const s = stateRef.current;
      if (s.cameraFitted || !bins.length) return;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const cell of bins) {
        const { x, z } = cellPosition(cell);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxZ - minZ);
      s.controls.target.set(cx, 2, cz);
      s.camera.position.set(cx + span * 0.55, span * 0.55, cz + span * 0.75);
      s.controls.update();
      s.cameraFitted = true;
    }

    function applyBins(bins) {
      const s = stateRef.current;
      if (!s.THREE || !s.scene) return; // three.js not ready yet — will retry on next poll
      const { THREE, scene, geometry, material } = s;

      if (!s.mesh) {
        const mesh = new THREE.InstancedMesh(geometry, material, bins.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(mesh);
        s.mesh = mesh;
      }
      const mesh = s.mesh;
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      bins.forEach((cell, i) => {
        const { x, y, z, scaleY } = cellPosition(cell);
        dummy.position.set(x, y, z);
        dummy.scale.set(1, scaleY, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.setHex(STATUS_COLORS[cell.status] ?? STATUS_COLORS.UNCOUNTED);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      s.bins = bins;

      fitCameraToBins(bins);

      const byStatus = {};
      for (const b of bins) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      setCounts({ total: bins.length, byStatus });
    }

    // Give the three.js init effect a moment to set up scene before the
    // first fetch tries to apply data to it.
    const kickoff = setTimeout(() => load(false), 50);
    return () => {
      stopped = true;
      clearTimeout(kickoff);
      clearTimeout(timer);
    };
  }, []);

  async function handleForceRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard/bins?forceRefresh=1");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to refresh");
      // Re-apply through the same path the poller uses, by faking a tiny
      // wait so the three.js state is definitely mounted.
      const s = stateRef.current;
      if (s.THREE && s.scene) {
        const event = new CustomEvent("dashboard-force-refresh", { detail: json.bins });
        window.dispatchEvent(event);
      }
      setLastUpdated(new Date());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Bridge for the Force Refresh button above, since applyBins is defined
  // inside the polling effect's closure.
  useEffect(() => {
    function handler(e) {
      const s = stateRef.current;
      if (!s.THREE || !s.scene || !s.mesh) return;
      const { THREE } = s;
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const bins = e.detail;
      bins.forEach((cell, i) => {
        const { x, y, z, scaleY } = cellPosition(cell);
        dummy.position.set(x, y, z);
        dummy.scale.set(1, scaleY, 1);
        dummy.updateMatrix();
        s.mesh.setMatrixAt(i, dummy.matrix);
        color.setHex(STATUS_COLORS[cell.status] ?? STATUS_COLORS.UNCOUNTED);
        s.mesh.setColorAt(i, color);
      });
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      s.bins = bins;
      const byStatus = {};
      for (const b of bins) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      setCounts({ total: bins.length, byStatus });
    }
    window.addEventListener("dashboard-force-refresh", handler);
    return () => window.removeEventListener("dashboard-force-refresh", handler);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: "#0b1120" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          color: "#e5e7eb",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          background: "rgba(15,23,42,0.85)",
          padding: "10px 14px",
          borderRadius: 8,
          maxWidth: 280,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          Live Warehouse Dashboard — Frozen (FA–FJ)
        </div>
        <div style={{ opacity: 0.8, marginBottom: 8 }}>
          Drag to rotate · Scroll to zoom · Right-drag to pan
        </div>
        <button
          onClick={handleForceRefresh}
          disabled={refreshing}
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          {refreshing ? "Refreshing…" : "⟳ Force Refresh"}
        </button>
        {status === "error" && <div style={{ color: "#f87171" }}>Error: {error}</div>}
        {counts && (
          <div>
            <div style={{ marginBottom: 4 }}>Total bins: {counts.total}</div>
            {Object.entries(STATUS_COLORS).map(([k, hex]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: `#${hex.toString(16).padStart(6, "0")}`,
                    display: "inline-block",
                  }}
                />
                <span>{k}</span>
                <span style={{ marginLeft: "auto", opacity: 0.8 }}>{counts.byStatus[k] || 0}</span>
              </div>
            ))}
          </div>
        )}
        {lastUpdated && (
          <div style={{ opacity: 0.6, marginTop: 8, fontSize: 11 }}>
            Updated {lastUpdated.toLocaleTimeString("th-TH")} · auto every 1 min
          </div>
        )}
      </div>

      {hover && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 12,
            color: "#e5e7eb",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            background: "rgba(15,23,42,0.9)",
            padding: "10px 14px",
            borderRadius: 8,
          }}
        >
          <div style={{ fontWeight: 700 }}>{hover.bin}</div>
          <div>Status: {hover.status}</div>
          {hover.countedQty !== null && <div>Counted Qty: {hover.countedQty}</div>}
          {hover.counterName && <div>By: {hover.counterName}</div>}
          {hover.timestamp && <div>At: {hover.timestamp}</div>}
        </div>
      )}
    </div>
  );
}
