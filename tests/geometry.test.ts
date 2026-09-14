import { describe, expect, it } from 'vitest';
import { chaikinClosed, roundedRect, signedArea, simplifyClosed, centroid, transformPolygon } from '../src/lib/geometry';
import { applyHomography, computeHomography, invert3, orderCorners } from '../src/lib/homography';

describe('homography', () => {
  it('maps the 4 source points exactly onto the destination points', () => {
    const src = [{ x: 100, y: 80 }, { x: 900, y: 120 }, { x: 850, y: 700 }, { x: 60, y: 650 }];
    const dst = [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }];
    const H = computeHomography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
    const Hi = invert3(H);
    const back = applyHomography(Hi, { x: 105, y: 148.5 });
    const fwd = applyHomography(H, back);
    expect(fwd.x).toBeCloseTo(105, 6);
    expect(fwd.y).toBeCloseTo(148.5, 6);
  });
  it('orders corners TL, TR, BR, BL', () => {
    const pts = [{ x: 900, y: 700 }, { x: 100, y: 100 }, { x: 80, y: 720 }, { x: 880, y: 90 }];
    const o = orderCorners(pts);
    expect(o[0]).toEqual({ x: 100, y: 100 });
    expect(o[1]).toEqual({ x: 880, y: 90 });
    expect(o[2]).toEqual({ x: 900, y: 700 });
    expect(o[3]).toEqual({ x: 80, y: 720 });
  });
});

describe('polygons', () => {
  it('rounded rect has the expected area and winding', () => {
    const r = roundedRect(100, 50, 0, 1);
    expect(Math.abs(signedArea(r))).toBeCloseTo(5000, 6);
    const rr = roundedRect(100, 50, 10, 16);
    expect(Math.abs(signedArea(rr))).toBeLessThan(5000);
    expect(Math.abs(signedArea(rr))).toBeGreaterThan(5000 - (4 - Math.PI) * 100 - 5);
  });
  it('simplify keeps a square a square', () => {
    const dense = [];
    for (let i = 0; i <= 100; i++) dense.push({ x: i, y: 0 });
    for (let i = 0; i <= 100; i++) dense.push({ x: 100, y: i });
    for (let i = 100; i >= 0; i--) dense.push({ x: i, y: 100 });
    for (let i = 100; i > 0; i--) dense.push({ x: 0, y: i });
    const s = simplifyClosed(dense, 0.5);
    expect(s.length).toBe(4);
    expect(Math.abs(signedArea(s))).toBeCloseTo(10000, 6);
  });
  it('chaikin doubles vertex count and stays near the original', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const c = chaikinClosed(sq, 1);
    expect(c.length).toBe(8);
    expect(Math.abs(signedArea(c))).toBeGreaterThan(80);
  });
  it('rotation about the centroid preserves the centroid', () => {
    const sq = [{ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 8 }, { x: 2, y: 8 }];
    const c = centroid(sq);
    const t = transformPolygon(sq, 37, c, { x: 5, y: -3 });
    const c2 = centroid(t);
    expect(c2.x).toBeCloseTo(c.x + 5, 6);
    expect(c2.y).toBeCloseTo(c.y - 3, 6);
  });
});
