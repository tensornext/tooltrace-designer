import type { TriMesh } from './mesh';

/** Binary STL. */
export function toStl(mesh: TriMesh, name = 'tooltrace'): ArrayBuffer {
  const n = mesh.triangleCount;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(header);
  dv.setUint32(80, n, true);
  const t = mesh.tris;
  let o = 84;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2], bx = t[i + 3], by = t[i + 4], bz = t[i + 5], cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, t[i + k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}
