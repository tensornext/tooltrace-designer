import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TriMesh } from '../lib/export/mesh';

export default function Preview3D({ mesh }: { mesh: TriMesh | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; obj: THREE.Mesh | null } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -160, 140);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2); dir.position.set(100, -80, 200); scene.add(dir);
    const grid = new THREE.GridHelper(420, 10, 0x334, 0x223); grid.rotation.x = Math.PI / 2; scene.add(grid);
    sceneRef.current = { scene, camera, renderer, controls, obj: null };
    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement); sceneRef.current = null; };
  }, []);

  useEffect(() => {
    const s = sceneRef.current; if (!s) return;
    if (s.obj) { s.scene.remove(s.obj); s.obj.geometry.dispose(); s.obj = null; }
    if (!mesh) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(mesh.tris), 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4cc9f0, roughness: 0.55, metalness: 0.05, flatShading: true });
    const obj = new THREE.Mesh(geo, mat);
    s.scene.add(obj); s.obj = obj;
    const b = mesh.bounds();
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    s.controls.target.set(cx, cy, cz);
    s.camera.position.set(cx + size * 0.9, cy - size * 1.3, cz + size * 1.1);
    s.controls.update();
  }, [mesh]);

  return <div ref={ref} className="preview3d" />;
}
