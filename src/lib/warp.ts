import type { Pt } from './geometry';
import { applyHomography, computeHomography, invert3, type Mat3 } from './homography';

export interface RectifiedImage {
  /** RGBA pixels of the rectified (top-down, metric) image. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Pixels per millimetre in the rectified image. */
  pxPerMm: number;
  /** Millimetre offset of the rectified image origin relative to the paper's top-left corner. */
  originMm: Pt;
  /** Maps original image pixels -> rectified pixels. */
  H: Mat3;
  /** Maps rectified pixels -> original image pixels. */
  Hinv: Mat3;
  /** Paper rectangle in rectified pixel space. */
  paperPx: { x: number; y: number; w: number; h: number };
}

export function rectPxToMm(r: RectifiedImage, p: Pt): Pt {
  return { x: p.x / r.pxPerMm + r.originMm.x, y: p.y / r.pxPerMm + r.originMm.y };
}

/**
 * Rectify a photo so that the paper (whose 4 corners are given in image pixels, ordered
 * TL, TR, BR, BL) becomes an axis-aligned rectangle of paperW x paperH millimetres.
 * The whole photo is warped (not only the paper) so tools lying next to the sheet survive.
 */
export function rectify(
  src: { data: Uint8ClampedArray; width: number; height: number },
  corners: Pt[],
  paperWmm: number,
  paperHmm: number,
  pxPerMm = 4,
  maxPixels = 6_000_000,
): RectifiedImage {
  // image px -> mm (paper TL at 0,0)
  const Hmm = computeHomography(corners, [
    { x: 0, y: 0 }, { x: paperWmm, y: 0 }, { x: paperWmm, y: paperHmm }, { x: 0, y: paperHmm },
  ]);
  // Extent of the whole photo in mm space (clamped to something sane around the paper)
  const imgCorners = [
    { x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height },
  ].map((p) => applyHomography(Hmm, p));
  let minX = Math.min(...imgCorners.map((p) => p.x), 0);
  let minY = Math.min(...imgCorners.map((p) => p.y), 0);
  let maxX = Math.max(...imgCorners.map((p) => p.x), paperWmm);
  let maxY = Math.max(...imgCorners.map((p) => p.y), paperHmm);
  // Perspective can send far edges to infinity: clamp to 1.5 paper sizes around the sheet
  const lim = 1.5 * Math.max(paperWmm, paperHmm);
  minX = Math.max(minX, -lim); minY = Math.max(minY, -lim);
  maxX = Math.min(maxX, paperWmm + lim); maxY = Math.min(maxY, paperHmm + lim);

  let width = Math.ceil((maxX - minX) * pxPerMm);
  let height = Math.ceil((maxY - minY) * pxPerMm);
  if (width * height > maxPixels) {
    const f = Math.sqrt(maxPixels / (width * height));
    pxPerMm *= f;
    width = Math.ceil((maxX - minX) * pxPerMm);
    height = Math.ceil((maxY - minY) * pxPerMm);
  }
  // mm -> rectified px
  const S: Mat3 = [pxPerMm, 0, -minX * pxPerMm, 0, pxPerMm, -minY * pxPerMm, 0, 0, 1];
  const H = mul(S, Hmm);
  const Hinv = invert3(H);

  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width, sh = src.height, sd = src.data;
  const [a, b, c, d, e, f, g, h, i] = Hinv;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = g * x + h * y + i;
      const sx = (a * x + b * y + c) / w;
      const sy = (d * x + e * y + f) / w;
      const o = (y * width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) { out[o] = 40; out[o + 1] = 40; out[o + 2] = 44; out[o + 3] = 255; continue; }
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        out[o + k] = sd[i00 + k] * (1 - fx) * (1 - fy) + sd[i10 + k] * fx * (1 - fy) + sd[i01 + k] * (1 - fx) * fy + sd[i11 + k] * fx * fy;
      }
      out[o + 3] = 255;
    }
  }
  return {
    data: out, width, height, pxPerMm, originMm: { x: minX, y: minY }, H, Hinv,
    paperPx: { x: -minX * pxPerMm, y: -minY * pxPerMm, w: paperWmm * pxPerMm, h: paperHmm * pxPerMm },
  };
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
