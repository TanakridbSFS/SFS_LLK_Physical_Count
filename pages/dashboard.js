import { useEffect, useRef, useState } from "react";

// Live 3D warehouse dashboard — Frozen zone, Rack FA (first cut; more racks
// come later, see lib/warehouseLayoutFA.json's header comment). Renders
// every bin as a cube positioned by its real depth/side/level in the rack,
// colored by its most recent count status, and polls for updates so it
// stays "live" while left open on a screen.
//
// Coordinate mapping (see pages/api/dashboard/bins.js for how it's built):
//   depth (1..54)  -> X — position walking down the aisle
//   side (L/R)     -> Z — which face of the two-sided rack
//   level (1..4)   -> Y — shelf height (A/G/H/J)

const STATUS_COLORS = {
  MATCH: 0x22c55e,
  ADJUSTED: 0xf59e0b,
  ZERO: 0xef4444,
  NEW: 0x3b82f6,
  EMPTY: 0x6366f1,
  UNCOUNTED: 0x9ca3af,
};

const POLL_MS = 30000;
const SPACING = 1.15;
const BOX_SIZE = 0.9;

export default function WarehouseDashboard() {
  const mountRef = useRef(null);
  const stateRef = useRef({}); // holds three.js objects across renders without re-triggering React
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [counts, setCounts] = useState(null); // { total, byStatus }
  const [hover, setHover] = useState(null); // { bin, status, timestamp, counterName, countedQty }
  const [lastUpdated, setLastUpdated] = useState(null);

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
        500
      );
      camera.position.set(35, 25, 55);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(30, 2.5, 0);
      controls.update();
      controls.enableDamping = true;

      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const dir = new THREE.DirectionalLight(0xffffff, 0.6);
      dir.position.set(20, 40, 20);
      scene.add(dir);

      // A thin floor plate + center aisle marker just for spatial orientation.
      const floorGeo = new THREE.PlaneGeometry(70, 6);
      const floorMat = new THREE.MeshBasicMaterial({ color: 0x1e293b, side: THREE.DoubleSide });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = Math.PI / 2;
      floor.position.set(30, -0.5, 0);
      scene.add(floor);

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

    async function load() {
      try {
        const res = await fetch("/api/dashboard/bins?rack=FA");
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
        if (!stopped) timer = setTimeout(load, POLL_MS);
      }
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
      const dummy = new s.THREE.Object3D();
      const color = new s.THREE.Color();

      bins.forEach((cell, i) => {
        const x = cell.depth * SPACING;
        const z = cell.side === "right" ? 1.2 : -1.2;
        const y = (cell.level - 1) * SPACING + 0.5;
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.setHex(STATUS_COLORS[cell.status] ?? STATUS_COLORS.UNCOUNTED);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      s.bins = bins;

      const byStatus = {};
      for (const b of bins) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      setCounts({ total: bins.length, byStatus });
    }

    // Give the three.js init effect a moment to set up scene before the
    // first fetch tries to apply data to it.
    const kickoff = setTimeout(load, 50);
    return () => {
      stopped = true;
      clearTimeout(kickoff);
      clearTimeout(timer);
    };
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
          maxWidth: 260,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          Warehouse Dashboard — Rack FA (Frozen)
        </div>
        <div style={{ opacity: 0.8, marginBottom: 8 }}>
          Drag to rotate · Scroll to zoom · Right-drag to pan
        </div>
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
            Updated {lastUpdated.toLocaleTimeString("th-TH")} · refreshes every 30s
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
