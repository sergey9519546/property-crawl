"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Box, Layers } from "lucide-react";
import { Listing } from "@/data/listings";

interface Parcel3DProps {
  listing: Listing;
}

export function Parcel3DVisualizer({ listing }: Parcel3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [wireframe, setWireframe] = useState(false);
  const [layer, setLayer] = useState<"elevation" | "zoning" | "lot">("elevation");
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const buildingMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth || 500;
    const height = containerRef.current.clientHeight || 280;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color("#0F172A");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(18, 22, 22);
    camera.lookAt(0, 1.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(15, 30, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(30, 30, 0x334155, 0x1e293b);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const terrainGeo = new THREE.PlaneGeometry(24, 24, 28, 28);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const elevation = Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.75 + Math.sin(x * 0.1) * 0.35;
      pos.setY(i, elevation);
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      wireframe: false,
      roughness: 0.7,
      metalness: 0.1,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
    terrainMeshRef.current = terrainMesh;

    const lotGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(16, 0.3, 16));
    const lotMat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2 });
    const lotWire = new THREE.LineSegments(lotGeo, lotMat);
    lotWire.position.y = 0.35;
    scene.add(lotWire);

    const sqftScale = Math.max(3, Math.min(7, (listing.sqft || 1800) / 400));
    const buildingGeo = new THREE.BoxGeometry(sqftScale, 3.2, sqftScale * 0.8);
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.3,
      metalness: 0.2,
    });
    const buildingMesh = new THREE.Mesh(buildingGeo, buildingMat);
    buildingMesh.position.set(0, 2.0, 0);
    buildingMesh.castShadow = true;
    scene.add(buildingMesh);
    buildingMeshRef.current = buildingMesh;

    const roofGeo = new THREE.ConeGeometry(sqftScale * 0.75, 1.8, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.set(0, 4.5, 0);
    scene.add(roofMesh);

    let animationFrameId: number;
    let isDisposed = false;

    const animate = () => {
      if (isDisposed) return;
      animationFrameId = requestAnimationFrame(animate);
      scene.rotation.y += 0.003;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || isDisposed) return;
      const w = containerRef.current.clientWidth || 500;
      const h = containerRef.current.clientHeight || 280;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      // Explicitly dispose all geometries and materials in the scene graph
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });

      // Clear scene references
      while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
      }

      // Dispose renderer and detach canvas
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }

      sceneRef.current = null;
      rendererRef.current = null;
      terrainMeshRef.current = null;
      buildingMeshRef.current = null;
    };
  }, [listing]);

  useEffect(() => {
    if (terrainMeshRef.current) {
      (terrainMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = wireframe;
    }
    if (buildingMeshRef.current) {
      (buildingMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = wireframe;
    }
  }, [wireframe]);

  useEffect(() => {
    if (!terrainMeshRef.current) return;
    const mat = terrainMeshRef.current.material as THREE.MeshStandardMaterial;
    if (layer === "elevation") {
      mat.color.setHex(0x1e293b);
    } else if (layer === "zoning") {
      mat.color.setHex(0x312e81);
    } else {
      mat.color.setHex(0x064e3b);
    }
  }, [layer]);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-[#E5E7EB] bg-[#0F172A] text-white shadow-xl">
      <div ref={containerRef} className="w-full h-[280px] cursor-grab active:cursor-grabbing" />

      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-xs font-semibold">
          <Box className="w-3.5 h-3.5 text-[#22C55E]" />
          <span>3D Parcel & Elevation Inspector</span>
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            onClick={() => setWireframe(!wireframe)}
            className={`p-1.5 rounded-lg border text-xs font-semibold transition ${
              wireframe
                ? "bg-[#22C55E] text-black border-[#22C55E]"
                : "bg-black/60 backdrop-blur-md border-white/10 text-slate-300 hover:text-white"
            }`}
            title="Toggle Wireframe Topography"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3.5 bg-[#0B1120] border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 text-slate-300 font-mono">
          <div>
            <span className="text-slate-500 block text-[10px]">PARCEL SQFT</span>
            <span className="text-white font-bold">{listing.sqft ? (listing.sqft * 4.2).toLocaleString() : "8,450"} sq ft</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">TOPOGRAPHY</span>
            <span className="text-[#22C55E] font-bold">Gentle Slope (4.2°)</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">ZONING CLASS</span>
            <span className="text-white font-bold">R-1 Single Fam</span>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
          <button
            onClick={() => setLayer("elevation")}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              layer === "elevation" ? "bg-white/20 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Elevation
          </button>
          <button
            onClick={() => setLayer("zoning")}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              layer === "zoning" ? "bg-indigo-500/30 text-indigo-300" : "text-slate-400 hover:text-white"
            }`}
          >
            Zoning
          </button>
          <button
            onClick={() => setLayer("lot")}
            className={`px-2 py-1 rounded text-[11px] font-medium transition ${
              layer === "lot" ? "bg-emerald-500/30 text-emerald-300" : "text-slate-400 hover:text-white"
            }`}
          >
            Lot Boundary
          </button>
        </div>
      </div>
    </div>
  );
}
