import { describe, expect, it } from 'vitest';
import { rectify, rectPxToMm } from '../src/lib/warp';
import { detectPaperCorners } from '../src/lib/paper';
import { maskToPolygon, polygonToMask, traceOuterContour, fillHoles, morphClose } from '../src/lib/contour';
import { ClassicalSegmenter } from '../src/lib/segment/classical';
import { signedArea, bbox } from '../src/lib/geometry';
import { applyHomography, computeHomography } from '../src/lib/homography';

/** Synthetic photo: grey background, a white paper quad in perspective, a dark tool blob on it. */
function synthPhoto(w = 640, h = 480) {
  const data = new Uint8ClampedArray(w * h * 4);
  const quad = [{ x: 120, y: 60 }, { x: 540, y: 90 }, { x: 500, y: 430 }, { x: 90, y: 400 }];
  // paper mm -> px homography so we can draw a tool at known mm coordinates
  const H = computeHomography([{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }], quad);
  const Hi = computeHomography(quad, [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const mm = applyHomography(Hi, { x, y });
    const onPaper = mm.x >= 0 && mm.x <= 210 && mm.y >= 0 && mm.y <= 297;
    let c: [number, number, number] = onPaper ? [238, 236, 230] : [90, 85, 80];
    // tool: 40 x 120 mm rectangle at (60,80) mm
    if (mm.x >= 60 && mm.x <= 100 && mm.y >= 80 && mm.y <= 200) c = [40, 42, 45];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { data, width: w, height: h, quad, H };
}

describe('paper detection and rectification', () => {
  it('detects the paper corners in a synthetic photo', () => {
    const img = synthPhoto();
    const corners = detectPaperCorners(img.data, img.width, img.height);
    expect(corners).not.toBeNull();
    // each detected corner within ~6 px of a true corner
    for (const q of img.quad) {
      const d = Math.min(...corners!.map((c) => Math.hypot(c.x - q.x, c.y - q.y)));
      expect(d).toBeLessThan(6);
    }
  });
  it('rectifies to the paper size in mm', () => {
    const img = synthPhoto();
    const r = rectify(img, img.quad, 210, 297, 2);
    expect(r.pxPerMm).toBe(2);
    expect(r.paperPx.w).toBeCloseTo(420, 6);
    expect(r.paperPx.h).toBeCloseTo(594, 6);
    // paper top-left in rectified px maps to 0,0 mm
    const mm = rectPxToMm(r, { x: r.paperPx.x, y: r.paperPx.y });
    expect(mm.x).toBeCloseTo(0, 6);
    expect(mm.y).toBeCloseTo(0, 6);
    // the pixel at the tool centre (80,140 mm) should be dark
    const px = { x: r.paperPx.x + 80 * 2, y: r.paperPx.y + 140 * 2 };
    const i = (Math.round(px.y) * r.width + Math.round(px.x)) * 4;
    expect(r.data[i]).toBeLessThan(80);
  });
});

describe('contours', () => {
  it('traces a rectangle mask back into a rectangle', () => {
    const w = 60, h = 40;
    const m = { data: new Uint8Array(w * h), width: w, height: h };
    for (let y = 10; y < 30; y++) for (let x = 5; x < 45; x++) m.data[y * w + x] = 1;
    const c = traceOuterContour(m);
    expect(c.length).toBeGreaterThan(100);
    const b = bbox(c);
    expect(b.minX).toBe(5); expect(b.maxX).toBe(44); expect(b.minY).toBe(10); expect(b.maxY).toBe(29);
    const poly = maskToPolygon(m, 1, 0);
    expect(poly.length).toBe(4);
  });
  it('polygon -> mask -> polygon round trip preserves area', () => {
    const poly = [{ x: 10, y: 10 }, { x: 90, y: 12 }, { x: 80, y: 70 }, { x: 20, y: 60 }];
    const m = polygonToMask(poly, 100, 100);
    const back = maskToPolygon(m, 1, 0);
    expect(Math.abs(signedArea(back))).toBeCloseTo(Math.abs(signedArea(poly)), -2.5);
  });
  it('fills holes and closes gaps', () => {
    const w = 30, h = 30;
    const m = { data: new Uint8Array(w * h), width: w, height: h };
    for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) m.data[y * w + x] = 1;
    for (let y = 12; y < 18; y++) for (let x = 12; x < 18; x++) m.data[y * w + x] = 0;
    const f = fillHoles(m);
    expect(f.data[15 * w + 15]).toBe(1);
    const g = morphClose(m, 4);
    expect(g.data[15 * w + 15]).toBe(1);
  });
});

describe('classical segmenter', () => {
  it('segments the tool on the rectified image with one click', async () => {
    const img = synthPhoto();
    const r = rectify(img, img.quad, 210, 297, 2);
    const seg = new ClassicalSegmenter();
    const mask = await seg.segment({
      data: r.data, width: r.width, height: r.height, tolerance: 0.3, paperPx: r.paperPx,
      markers: [{ x: r.paperPx.x + 80 * 2, y: r.paperPx.y + 140 * 2, positive: true }],
    });
    expect(mask).not.toBeNull();
    const poly = maskToPolygon(mask!, 1.5, 0);
    const b = bbox(poly);
    // expected 40x120 mm => 80x240 px
    expect(b.w).toBeGreaterThan(74); expect(b.w).toBeLessThan(86);
    expect(b.h).toBeGreaterThan(232); expect(b.h).toBeLessThan(248);
  });
});
