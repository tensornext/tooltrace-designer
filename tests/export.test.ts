import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { toDxf } from '../src/lib/export/dxf';
import { toSvg } from '../src/lib/export/svg';
import { TriMesh, buildBody, buildGridfinityBase, addExtrusion } from '../src/lib/export/mesh';
import { toStl } from '../src/lib/export/stl';
import { to3mf } from '../src/lib/export/threemf';
import { circle, roundedRect, signedArea } from '../src/lib/geometry';
import { offsetPolygons, unionPolygons, differencePolygons } from '../src/lib/offset';
import { gridfinityOutline, gridfinityHeight, unitsFor, shelfPack } from '../src/lib/layout';

/** Every directed edge must be matched by exactly one opposite edge => closed, consistently oriented shell(s). */
function isWatertight(m: TriMesh): { ok: boolean; unmatched: number } {
  const edges = new Map<string, number>();
  const t = m.tris;
  const key = (a: number[], b: number[]) => `${a[0].toFixed(5)},${a[1].toFixed(5)},${a[2].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)},${b[2].toFixed(5)}`;
  for (let i = 0; i < t.length; i += 9) {
    const v = [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]];
    for (let k = 0; k < 3; k++) { const e = key(v[k], v[(k + 1) % 3]); edges.set(e, (edges.get(e) ?? 0) + 1); }
  }
  let unmatched = 0;
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    const rev = edges.get(`${b}|${a}`) ?? 0;
    if (n !== 1 || rev !== 1) unmatched++;
  }
  return { ok: unmatched === 0, unmatched };
}

function volume(m: TriMesh): number {
  let v = 0; const t = m.tris;
  for (let i = 0; i < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe('2D exports', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('DXF has a closed LWPOLYLINE per polygon and mm units', () => {
    const d = toDxf([{ name: 'POCKETS', polys: [sq, sq], color: 1 }, { name: 'OUTLINE', polys: [sq], color: 7 }], 100);
    expect((d.match(/LWPOLYLINE/g) ?? []).length).toBe(3);
    expect(d).toContain('$INSUNITS\n70\n4');
    expect(d).toContain('AC1015');
    expect(d.trim().endsWith('EOF')).toBe(true);
  });
  it('SVG uses mm and one path per polygon', () => {
    const s = toSvg(200, 100, [{ name: 'pockets', polys: [sq], stroke: '#f00' }]);
    expect(s).toContain('width="200mm"');
    expect((s.match(/<path /g) ?? []).length).toBe(1);
  });
});

describe('offsetting', () => {
  it('grows a square by 1 mm with round joins', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const [o] = offsetPolygons([sq], 1);
    const a = Math.abs(signedArea(o));
    expect(a).toBeGreaterThan(100 + 40 + 2.5);
    expect(a).toBeLessThan(100 + 40 + Math.PI + 0.1);
  });
  it('union merges overlapping polygons, difference cuts', () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const b = [{ x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }, { x: 5, y: 10 }];
    const u = unionPolygons([a, b]);
    expect(u.length).toBe(1);
    expect(Math.abs(signedArea(u[0]))).toBeCloseTo(150, 3);
    const d = differencePolygons([a], [b]);
    expect(Math.abs(signedArea(d[0]))).toBeCloseTo(50, 3);
  });
});

describe('layout math', () => {
  it('gridfinity sizes', () => {
    expect(unitsFor(60)).toBe(2);
    expect(unitsFor(35)).toBe(1);
    expect(gridfinityHeight(20, false)).toBe(30);
    expect(gridfinityHeight(20, true)).toBe(35);
    const o = gridfinityOutline(2, 1);
    const xs = o.map((p) => p.x), ys = o.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(83.5, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(41.5, 6);
  });
  it('shelf packing keeps items inside the container and apart', () => {
    const items = [roundedRect(30, 20, 0, 1), roundedRect(50, 10, 0, 1), roundedRect(20, 20, 0, 1)];
    const t = shelfPack(items, 120, 100, 4, 5);
    expect(t.length).toBe(3);
    for (let i = 0; i < 3; i++) for (const p of items[i]) { expect(p.x + t[i].x).toBeGreaterThanOrEqual(5); expect(p.x + t[i].x).toBeLessThanOrEqual(115); }
  });
});

describe('3D exports', () => {
  it('extrusion with a hole is watertight and has the right volume', () => {
    const m = new TriMesh();
    addExtrusion(m, roundedRect(40, 30, 0, 1), [circle({ x: 20, y: 15 }, 5, 16)], 0, 10);
    const wt = isWatertight(m);
    expect(wt.ok).toBe(true);
    const circArea = 0.5 * 16 * 25 * Math.sin((2 * Math.PI) / 16);
    expect(volume(m)).toBeCloseTo((1200 - circArea) * 10, 3);
  });
  it('bin body with pockets is watertight', () => {
    const m = new TriMesh();
    buildBody(m, {
      outline: gridfinityOutline(2, 2),
      pockets: [offsetPolygons([[{ x: 10, y: 10 }, { x: 40, y: 12 }, { x: 35, y: 50 }, { x: 8, y: 45 }]], 1)[0], circle({ x: 60, y: 60 }, 8, 24)],
      floorZ: 10, height: 30, bodyZ0: 4.75,
    });
    expect(isWatertight(m).ok).toBe(true);
    const v = volume(m);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(83.5 * 83.5 * (30 - 4.75));
  });
  it('rings with duplicate and collinear vertices (as clipper produces) still give a watertight body', () => {
    const m = new TriMesh();
    // pocket with a duplicated vertex and two exactly collinear runs along x = 30 and y = 10
    const pocket = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
    buildBody(m, { outline: gridfinityOutline(1, 1), pockets: [pocket], floorZ: 10, height: 20, bodyZ0: 4.75 });
    expect(isWatertight(m).unmatched).toBe(0);
    const solid = 41.5 * 41.5 - (4 - Math.PI) * 3.75 * 3.75;
    expect(volume(m)).toBeCloseTo(solid * (20 - 4.75) - 400 * 10, -2); // corners are 6-segment arcs, not true circles
  });
  it('gridfinity base cells are watertight with and without magnets', () => {
    for (const magnets of [false, true]) {
      const m = new TriMesh();
      buildGridfinityBase(m, 2, 1, magnets);
      const wt = isWatertight(m);
      expect(wt.unmatched).toBe(0);
      expect(volume(m)).toBeGreaterThan(0);
    }
  });
  it('STL and 3MF encode the same triangle count', () => {
    const m = new TriMesh();
    addExtrusion(m, roundedRect(10, 10, 0, 1), [], 0, 5);
    const stl = toStl(m);
    expect(new DataView(stl).getUint32(80, true)).toBe(m.triangleCount);
    expect(stl.byteLength).toBe(84 + 50 * m.triangleCount);
    const z = unzipSync(to3mf(m));
    const model = strFromU8(z['3D/3dmodel.model']);
    expect((model.match(/<triangle /g) ?? []).length).toBe(m.triangleCount);
    expect((model.match(/<vertex /g) ?? []).length).toBe(8);
  });
});
