import { describe, expect, it } from 'vitest';
import { buildDesign, buildMesh, buildMeshParts } from '../src/lib/build';
import type { Tool } from '../src/state/store';
import { circle, roundedRect } from '../src/lib/geometry';
import type { TriMesh } from '../src/lib/export/mesh';

function unmatchedEdges(m: TriMesh): string[] {
  const edges = new Map<string, number>();
  const t = m.tris;
  const f = (v: number) => Math.fround(v).toFixed(4);
  const key = (a: number[], b: number[]) => `${f(a[0])},${f(a[1])},${f(a[2])}|${f(b[0])},${f(b[1])},${f(b[2])}`;
  for (let i = 0; i < t.length; i += 9) {
    const v = [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]];
    for (let k = 0; k < 3; k++) { const e = key(v[k], v[(k + 1) % 3]); edges.set(e, (edges.get(e) ?? 0) + 1); }
  }
  const bad: string[] = [];
  for (const [e, n] of edges) { const [a, b] = e.split('|'); if (n !== 1 || (edges.get(`${b}|${a}`) ?? 0) !== 1) bad.push(e); }
  return bad;
}

function tool(id: string, polygonMm: { x: number; y: number }[], x = 0, y = 0, rotation = 0): Tool {
  return { id, name: id, color: '#fff', markers: [], tolerance: 0.3, polygonPx: [], polygonMm, placement: { x, y, rotation }, cutouts: [] };
}

describe('design -> mesh', () => {
  const tools = [
    tool('a', roundedRect(30, 120, 4, 5), 10, 10, 0),
    tool('b', circle({ x: 0, y: 0 }, 15, 40), 90, 40, 0),
    tool('c', [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 60 }, { x: 0, y: 60 }], 100, 90, 33),
  ];
  it('gridfinity design (with magnets) is watertight', () => {
    const d = buildDesign({ mode: 'gridfinity', tools, offsetMm: 0.5, gridfinity: { unitsX: 4, unitsY: 4, depth: 20, magnets: true, snapHeight: true }, foam: { width: 300, height: 200, thickness: 30, depth: 25, cornerRadius: 5, margin: 8 } });
    expect(d.warnings).toEqual([]);
    for (const part of buildMeshParts(d)) {
      const bad = unmatchedEdges(part.mesh);
      if (bad.length) console.log(part.name, bad.slice(0, 10));
      expect(bad.length).toBe(0);
    }
    expect(buildMesh(d).triangleCount).toBeGreaterThan(1000);
  });
  it('foam design (partial depth and through-cut) is watertight', () => {
    for (const depth of [20, 40]) {
      const d = buildDesign({ mode: 'foam', tools, offsetMm: 1, gridfinity: { unitsX: 4, unitsY: 4, depth: 20, magnets: false, snapHeight: true }, foam: { width: 300, height: 200, thickness: 30, depth, cornerRadius: 5, margin: 8 } });
      const bad = unmatchedEdges(buildMesh(d));
      if (bad.length) console.log(depth, bad.slice(0, 10));
      expect(bad.length).toBe(0);
    }
  });
  it('clips pockets that cross the edge and reports it', () => {
    const d = buildDesign({ mode: 'gridfinity', tools: [tool('edge', roundedRect(30, 30, 2, 4), -10, 5)], offsetMm: 0.5, gridfinity: { unitsX: 1, unitsY: 1, depth: 10, magnets: false, snapHeight: false }, foam: { width: 300, height: 200, thickness: 30, depth: 25, cornerRadius: 5, margin: 8 } });
    expect(d.warnings.some((w) => w.includes('clipped'))).toBe(true);
    for (const part of buildMeshParts(d)) expect(unmatchedEdges(part.mesh).length).toBe(0);
  });
});
