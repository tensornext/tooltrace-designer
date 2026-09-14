import earcut from 'earcut';
import { circle, ensureCCW, ensureCW, roundedRect, signedArea, type Polygon, type Pt } from '../geometry';
import { GF, gridfinityFootprint } from '../layout';

/** Triangle soup: 9 floats per triangle (x,y,z × 3), counter-clockwise = outward. */
export class TriMesh {
  tris: number[] = [];
  get triangleCount() { return this.tris.length / 9; }
  addTri(a: number[], b: number[], c: number[]) { this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
  bounds() {
    const t = this.tris; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], t[i + k]); mx[k] = Math.max(mx[k], t[i + k]); }
    return { min: mn, max: mx };
  }
}

/**
 * Remove duplicate and exactly-collinear vertices. earcut silently drops such vertices from the
 * caps, which would leave the wall quads with unmatched edges; cleaning rings once up front keeps
 * caps and walls consistent, so the shell stays watertight.
 */
export function cleanRing(ring: Polygon): Polygon {
  let pts = ring.filter((p, i) => { const q = ring[(i + 1) % ring.length]; return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9; });
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const out: Polygon = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross === 0) { changed = true; continue; }
      out.push(b);
    }
    pts = out;
  }
  return pts;
}

/** Planar cap of a polygon with holes at height z. `up` = normal +z. */
export function addCap(mesh: TriMesh, outer: Polygon, holes: Polygon[], z: number, up: boolean) {
  const o = ensureCCW(cleanRing(outer));
  const hs = holes.map((h) => ensureCW(cleanRing(h)));
  const coords: number[] = [];
  const holeIdx: number[] = [];
  for (const p of o) coords.push(p.x, p.y);
  for (const h of hs) { holeIdx.push(coords.length / 2); for (const p of h) coords.push(p.x, p.y); }
  const idx = earcut(coords, holeIdx.length ? holeIdx : undefined, 2);
  for (let i = 0; i < idx.length; i += 3) {
    const a = [coords[idx[i] * 2], coords[idx[i] * 2 + 1], z];
    const b = [coords[idx[i + 1] * 2], coords[idx[i + 1] * 2 + 1], z];
    const c = [coords[idx[i + 2] * 2], coords[idx[i + 2] * 2 + 1], z];
    // orient by computing z of normal
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const ccw = nz > 0;
    if (ccw === up) mesh.addTri(a, b, c); else mesh.addTri(a, c, b);
  }
}

/** Vertical walls between z0 and z1 along a ring. CCW ring => outward normals; CW ring (hole) => normals facing into the hole. */
export function addWalls(mesh: TriMesh, ring: Polygon, z0: number, z1: number) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const a0 = [p.x, p.y, z0], b0 = [q.x, q.y, z0], a1 = [p.x, p.y, z1], b1 = [q.x, q.y, z1];
    mesh.addTri(a0, b0, b1);
    mesh.addTri(a0, b1, a1);
  }
}

/** Walls between two rings with equal vertex counts at different heights (frustum side). */
export function addLoft(mesh: TriMesh, lower: Polygon, lowerZ: number, upper: Polygon, upperZ: number) {
  const n = lower.length;
  if (upper.length !== n) throw new Error('addLoft: ring vertex counts differ');
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = [lower[i].x, lower[i].y, lowerZ], b0 = [lower[j].x, lower[j].y, lowerZ];
    const a1 = [upper[i].x, upper[i].y, upperZ], b1 = [upper[j].x, upper[j].y, upperZ];
    mesh.addTri(a0, b0, b1);
    mesh.addTri(a0, b1, a1);
  }
}

/** Closed extrusion of an outer polygon with through-holes from z0 to z1. */
export function addExtrusion(mesh: TriMesh, outer: Polygon, holes: Polygon[], z0: number, z1: number) {
  const o = ensureCCW(cleanRing(outer));
  const hs = holes.map((h) => ensureCW(cleanRing(h))).filter((h) => h.length >= 3);
  addCap(mesh, o, hs, z0, false);
  addCap(mesh, o, hs, z1, true);
  addWalls(mesh, o, z0, z1);
  for (const h of hs) addWalls(mesh, h, z0, z1);
}

export interface BinSpec {
  /** Outline of the bin (mm, y-up, CCW). */
  outline: Polygon;
  /** Pockets (mm, y-up), must lie inside the outline and not overlap each other. */
  pockets: Polygon[];
  /** Absolute z of the pocket floor. */
  floorZ: number;
  /** Total height of the bin. */
  height: number;
  /** z where the body starts (top of the Gridfinity base, or 0 for a plain block). */
  bodyZ0: number;
}

/**
 * Body of an insert: a block from bodyZ0 to height with pockets cut from floorZ to height.
 * Built as a closed shell: bottom cap, outer walls, top cap with holes, pocket walls, pocket floors.
 */
export function buildBody(mesh: TriMesh, spec: BinSpec) {
  const outer = ensureCCW(cleanRing(spec.outline));
  const pockets = spec.pockets.map((p) => ensureCW(cleanRing(p))).filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-6);
  addCap(mesh, outer, [], spec.bodyZ0, false);
  addWalls(mesh, outer, spec.bodyZ0, spec.height);
  addCap(mesh, outer, pockets, spec.height, true);
  for (const p of pockets) {
    addWalls(mesh, p, spec.floorZ, spec.height); // CW ring => normals face into the pocket
    addCap(mesh, p, [], spec.floorZ, true);       // pocket floor faces up
  }
}

/** Ring counts must match across the base profile; use a fixed segment count. */
const SEG = 6;
const OVERLAP_INSET = 0.3;
const OVERLAP_HEIGHT = 0.5;
function cellRing(size: number, r: number, cx: number, cy: number): Polygon {
  return roundedRect(size, size, r, SEG).map((p) => ({ x: p.x - size / 2 + cx, y: p.y - size / 2 + cy }));
}

/**
 * Gridfinity base profile under each 42 mm cell (z = 0 .. 4.75), as a closed shell per cell that
 * overlaps the body by 0.5 mm. Profile from the bottom: 0.8 mm 45° chamfer, 1.8 mm vertical,
 * 2.15 mm 45° chamfer to the 41.5 mm footprint.
 * Optional magnet holes (6.5 × 2.4 mm) at the four corners of each cell.
 */
export function buildGridfinityBase(mesh: TriMesh, unitsX: number, unitsY: number, magnets: boolean, origin: Pt = { x: 0, y: 0 }) {
  const fp = gridfinityFootprint(unitsX, unitsY);
  const top = GF.UNIT - GF.CLEARANCE; // 41.5
  const mid = top - 2 * GF.BASE_CHAMFER_TOP; // 37.2
  const bottom = mid - 2 * GF.BASE_CHAMFER_BOTTOM; // 35.6
  const z1 = GF.BASE_CHAMFER_BOTTOM, z2 = z1 + GF.BASE_VERTICAL, z3 = GF.BASE_HEIGHT;
  for (let ix = 0; ix < unitsX; ix++) for (let iy = 0; iy < unitsY; iy++) {
    // cell centre in bin coordinates (bin origin at its lower-left corner; cells are centred on the 42 mm grid)
    const cx = origin.x + fp.w / 2 + (ix - (unitsX - 1) / 2) * GF.UNIT;
    const cy = origin.y + fp.h / 2 + (iy - (unitsY - 1) / 2) * GF.UNIT;
    const r0 = ensureCCW(cellRing(bottom, 0.8, cx, cy));
    const r1 = ensureCCW(cellRing(mid, GF.BASE_INNER_RADIUS, cx, cy));
    const r2 = r1;
    const r3 = ensureCCW(cellRing(top, GF.CORNER_RADIUS, cx, cy));
    // The cell is closed 0.5 mm *inside* the body with a slightly inset ring, so the two shells
    // overlap instead of sharing a coincident face at z = 4.75 (coincident faces confuse slicers;
    // overlapping closed shells are unioned reliably).
    const r4 = ensureCCW(cellRing(top - 2 * OVERLAP_INSET, GF.CORNER_RADIUS - OVERLAP_INSET, cx, cy));
    const z4 = z3 + OVERLAP_HEIGHT;
    addLoft(mesh, r0, 0, r1, z1);
    addLoft(mesh, r1, z1, r2, z2);
    addLoft(mesh, r2, z2, r3, z3);
    addLoft(mesh, r3, z3, r4, z4);
    addCap(mesh, r4, [], z4, true);
    if (!magnets) { addCap(mesh, r0, [], 0, false); continue; }
    const holes: Polygon[] = [];
    const off = 13; // magnet centres 13 mm from the cell centre (8 mm from the cell edge)
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      holes.push(ensureCW(circle({ x: cx + sx * off, y: cy + sy * off }, GF.MAGNET_DIAMETER / 2, 24)));
    }
    addCap(mesh, r0, holes, 0, false);
    for (const h of holes) { addWalls(mesh, h, 0, GF.MAGNET_DEPTH); addCap(mesh, h, [], GF.MAGNET_DEPTH, false); }
  }
}
