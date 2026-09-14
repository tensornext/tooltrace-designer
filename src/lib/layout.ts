import { bbox, roundedRect, type Polygon, type Pt } from './geometry';

/** Gridfinity standard constants (mm). */
export const GF = {
  UNIT: 42,           // grid pitch
  HEIGHT_UNIT: 7,     // height pitch
  CLEARANCE: 0.5,     // bin footprint = units*42 - 0.5
  BASE_HEIGHT: 4.75,  // stacking base profile height (0.8 + 1.8 + 2.15)
  BASE_CHAMFER_BOTTOM: 0.8,
  BASE_VERTICAL: 1.8,
  BASE_CHAMFER_TOP: 2.15,
  CORNER_RADIUS: 3.75,
  BASE_INNER_RADIUS: 1.6,
  MAGNET_DIAMETER: 6.5,
  MAGNET_DEPTH: 2.4,
  MAGNET_INSET: 8, // from cell corner to magnet centre (4 mm from cell edge centre... standard: 8 mm from corner of cell)
  /** tooltrace.ai automatically adds a 10 mm base under the pocket depth. */
  FLOOR_THICKNESS: 10,
} as const;

export type InsertMode = 'foam' | 'gridfinity';
export type OffsetPreset = 'small' | 'medium' | 'large' | 'custom';

export const OFFSET_PRESETS: Record<Exclude<OffsetPreset, 'custom'>, number> = { small: 0.5, medium: 1.0, large: 2.0 };

export interface GridfinitySettings {
  unitsX: number;
  unitsY: number;
  /** Pocket depth in mm (bin height = depth + floor). */
  depth: number;
  magnets: boolean;
  /** Round total height up to a multiple of 7 mm. */
  snapHeight: boolean;
  /** Add a 0.4 mm lip? Kept simple: no stacking lip (inserts are usually top bins). */
}

export interface FoamSettings {
  width: number;   // sheet width mm
  height: number;  // sheet height mm
  thickness: number; // foam thickness mm (informational; for DXF depth layer)
  depth: number;   // pocket depth (for layered foam or CNC)
  cornerRadius: number;
  margin: number;  // minimum distance between pocket and sheet edge
}

export interface FingerCutout { id: string; x: number; y: number; r: number }

export function gridfinityFootprint(unitsX: number, unitsY: number): { w: number; h: number } {
  return { w: unitsX * GF.UNIT - GF.CLEARANCE, h: unitsY * GF.UNIT - GF.CLEARANCE };
}

export function gridfinityHeight(depth: number, snap: boolean): number {
  const raw = depth + GF.FLOOR_THICKNESS;
  if (!snap) return raw;
  return Math.ceil(raw / GF.HEIGHT_UNIT) * GF.HEIGHT_UNIT;
}

/** Smallest unit count that contains the given mm size with a margin. */
export function unitsFor(sizeMm: number, margin = 3): number {
  return Math.max(1, Math.ceil((sizeMm + 2 * margin + GF.CLEARANCE) / GF.UNIT));
}

export function gridfinityOutline(unitsX: number, unitsY: number): Polygon {
  const { w, h } = gridfinityFootprint(unitsX, unitsY);
  return roundedRect(w, h, GF.CORNER_RADIUS, 6);
}

export function foamOutline(s: FoamSettings): Polygon {
  return roundedRect(s.width, s.height, s.cornerRadius, 6);
}

/**
 * Simple shelf packing of polygons by bounding box, sorted by height, left-to-right rows.
 * Returns a translation for each polygon (indexed like the input) so they fit within
 * the container starting at (margin, margin). Polygons that don't fit are placed beyond
 * the container to make the overflow visible.
 */
export function shelfPack(polys: Polygon[], containerW: number, containerH: number, gap: number, margin: number): Pt[] {
  const items = polys.map((p, i) => ({ i, b: bbox(p) }));
  items.sort((a, b) => b.b.h - a.b.h);
  const out: Pt[] = new Array(polys.length);
  let x = margin, y = margin, rowH = 0;
  for (const it of items) {
    if (x + it.b.w > containerW - margin && x > margin) { x = margin; y += rowH + gap; rowH = 0; }
    out[it.i] = { x: x - it.b.minX, y: y - it.b.minY };
    x += it.b.w + gap;
    rowH = Math.max(rowH, it.b.h);
  }
  void containerH;
  return out;
}
