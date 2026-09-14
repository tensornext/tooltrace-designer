import { create } from 'zustand';
import type { Polygon, Pt } from '../lib/geometry';
import { centroid, transformPolygon, uid, bboxAll } from '../lib/geometry';
import type { Marker } from '../lib/segment/types';
import { PAPER_SIZES, type PaperSize } from '../lib/paper';
import { GF, OFFSET_PRESETS, shelfPack, unitsFor, type FingerCutout, type FoamSettings, type GridfinitySettings, type InsertMode, type OffsetPreset } from '../lib/layout';
import { offsetPolygons, unionPolygons } from '../lib/offset';
import { circle } from '../lib/geometry';

export type Step = 'photo' | 'scale' | 'trace' | 'layout';
export const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: 'photo', label: 'Photo', hint: 'Upload a top-down photo' },
  { id: 'scale', label: 'Set Scale', hint: 'Mark the paper corners' },
  { id: 'trace', label: 'Trace Tools', hint: 'Click each tool' },
  { id: 'layout', label: 'Configure Layout', hint: 'Arrange, size, export' },
];

export interface SourceImage { width: number; height: number; url: string; data: Uint8ClampedArray }
export interface RectifiedView {
  width: number; height: number; pxPerMm: number; originMm: Pt;
  paperPx: { x: number; y: number; w: number; h: number };
  bitmap: ImageBitmap | null;
}

export interface Tool {
  id: string;
  name: string;
  color: string;
  markers: Marker[];
  tolerance: number;
  /** Outline in rectified pixels. */
  polygonPx: Polygon;
  /** Outline in millimetres in the photo's paper frame (origin = paper top-left). */
  polygonMm: Polygon;
  /** Placement in the layout: translation (mm) and rotation (deg) about the outline centroid. */
  placement: { x: number; y: number; rotation: number };
  cutouts: FingerCutout[];
  busy?: boolean;
  error?: string;
}

export const TOOL_COLORS = ['#ff5c5c', '#4cc9f0', '#ffd166', '#06d6a0', '#c77dff', '#ff9f1c', '#f15bb5', '#00bbf9', '#9ef01a', '#ff7b00'];

interface DesignerState {
  step: Step;
  setStep: (s: Step) => void;

  source: SourceImage | null;
  setSource: (s: SourceImage | null) => void;

  paperId: string;
  customPaper: { w: number; h: number };
  corners: Pt[] | null;
  setPaper: (id: string) => void;
  setCustomPaper: (w: number, h: number) => void;
  setCorners: (c: Pt[] | null) => void;
  paper: () => PaperSize;

  rectified: RectifiedView | null;
  setRectified: (r: RectifiedView | null) => void;

  tools: Tool[];
  activeToolId: string | null;
  segmenter: 'classical' | 'sam';
  setSegmenter: (s: 'classical' | 'sam') => void;
  addTool: () => string;
  removeTool: (id: string) => void;
  updateTool: (id: string, patch: Partial<Tool>) => void;
  setActiveTool: (id: string | null) => void;
  setToolPolygon: (id: string, polygonPx: Polygon) => void;

  mode: InsertMode;
  setMode: (m: InsertMode) => void;
  offsetPreset: OffsetPreset;
  offsetMm: number;
  setOffset: (preset: OffsetPreset, custom?: number) => void;
  gridfinity: GridfinitySettings;
  setGridfinity: (p: Partial<GridfinitySettings>) => void;
  autoUnits: boolean;
  setAutoUnits: (v: boolean) => void;
  foam: FoamSettings;
  setFoam: (p: Partial<FoamSettings>) => void;
  gap: number;
  setGap: (g: number) => void;
  fingerRadius: number;
  setFingerRadius: (r: number) => void;

  autoArrange: () => void;
  addCutout: (toolId: string, at: Pt) => void;
  removeCutout: (toolId: string, cutoutId: string) => void;

  reset: () => void;
}

const defaultGridfinity: GridfinitySettings = { unitsX: 2, unitsY: 2, depth: 20, magnets: false, snapHeight: true };
const defaultFoam: FoamSettings = { width: 300, height: 200, thickness: 30, depth: 25, cornerRadius: 5, margin: 8 };

export const useDesigner = create<DesignerState>((set, get) => ({
  step: 'photo',
  setStep: (step) => set({ step }),

  source: null,
  setSource: (source) => set({ source, corners: null, rectified: null, tools: [], activeToolId: null, step: source ? 'scale' : 'photo' }),

  paperId: 'a4',
  customPaper: { w: 200, h: 200 },
  corners: null,
  setPaper: (paperId) => set({ paperId }),
  setCustomPaper: (w, h) => set({ customPaper: { w, h } }),
  setCorners: (corners) => set({ corners }),
  paper: () => {
    const { paperId, customPaper } = get();
    const p = PAPER_SIZES.find((x) => x.id === paperId) ?? PAPER_SIZES[0];
    return paperId === 'custom' ? { ...p, w: customPaper.w, h: customPaper.h } : p;
  },

  rectified: null,
  setRectified: (rectified) => set({ rectified }),

  tools: [],
  activeToolId: null,
  segmenter: 'classical',
  setSegmenter: (segmenter) => set({ segmenter }),
  addTool: () => {
    const id = uid();
    const n = get().tools.length;
    const tool: Tool = {
      id, name: `Tool ${n + 1}`, color: TOOL_COLORS[n % TOOL_COLORS.length], markers: [], tolerance: 0.3,
      polygonPx: [], polygonMm: [], placement: { x: 0, y: 0, rotation: 0 }, cutouts: [],
    };
    set({ tools: [...get().tools, tool], activeToolId: id });
    return id;
  },
  removeTool: (id) => set((s) => ({ tools: s.tools.filter((t) => t.id !== id), activeToolId: s.activeToolId === id ? null : s.activeToolId })),
  updateTool: (id, patch) => set((s) => ({ tools: s.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  setActiveTool: (activeToolId) => set({ activeToolId }),
  setToolPolygon: (id, polygonPx) => {
    const r = get().rectified;
    if (!r) return;
    const polygonMm = polygonPx.map((p) => ({ x: p.x / r.pxPerMm + r.originMm.x, y: p.y / r.pxPerMm + r.originMm.y }));
    set((s) => ({ tools: s.tools.map((t) => (t.id === id ? { ...t, polygonPx, polygonMm, busy: false, error: undefined } : t)) }));
  },

  mode: 'gridfinity',
  setMode: (mode) => set({ mode }),
  offsetPreset: 'small',
  offsetMm: OFFSET_PRESETS.small,
  setOffset: (preset, custom) => set({ offsetPreset: preset, offsetMm: preset === 'custom' ? (custom ?? get().offsetMm) : OFFSET_PRESETS[preset] }),
  gridfinity: defaultGridfinity,
  setGridfinity: (p) => set((s) => ({ gridfinity: { ...s.gridfinity, ...p } })),
  autoUnits: true,
  setAutoUnits: (autoUnits) => set({ autoUnits }),
  foam: defaultFoam,
  setFoam: (p) => set((s) => ({ foam: { ...s.foam, ...p } })),
  gap: 4,
  setGap: (gap) => set({ gap }),
  fingerRadius: 10,
  setFingerRadius: (fingerRadius) => set({ fingerRadius }),

  autoArrange: () => {
    const s = get();
    const traced = s.tools.filter((t) => t.polygonMm.length >= 3);
    if (!traced.length) return;
    const outlines = traced.map((t) => pocketOutline(t, s.offsetMm, s.gap / 2));
    // container size: foam sheet or (for auto units) a generous area that we shrink-wrap after packing
    const margin = s.mode === 'foam' ? s.foam.margin : 3;
    const cw = s.mode === 'foam' ? s.foam.width : 1000;
    const ch = s.mode === 'foam' ? s.foam.height : 1000;
    const moves = shelfPack(outlines, cw, ch, s.gap, margin);
    const tools = s.tools.map((t) => {
      const i = traced.indexOf(t);
      if (i < 0) return t;
      // outlines were computed with the current placement; add the packing move
      return { ...t, placement: { ...t.placement, x: t.placement.x + moves[i].x, y: t.placement.y + moves[i].y } };
    });
    let gridfinity = s.gridfinity;
    if (s.mode === 'gridfinity' && s.autoUnits) {
      const placed = tools.filter((t) => t.polygonMm.length >= 3).map((t) => pocketOutline(t, s.offsetMm, 0));
      const b = bboxAll(placed);
      gridfinity = { ...gridfinity, unitsX: unitsFor(b.maxX, 3), unitsY: unitsFor(b.maxY, 3) };
    }
    set({ tools, gridfinity });
  },
  addCutout: (toolId, at) => set((s) => ({
    tools: s.tools.map((t) => (t.id === toolId ? { ...t, cutouts: [...t.cutouts, { id: uid(), x: at.x, y: at.y, r: s.fingerRadius }] } : t)),
  })),
  removeCutout: (toolId, cutoutId) => set((s) => ({
    tools: s.tools.map((t) => (t.id === toolId ? { ...t, cutouts: t.cutouts.filter((c) => c.id !== cutoutId) } : t)),
  })),

  reset: () => set({ step: 'photo', source: null, corners: null, rectified: null, tools: [], activeToolId: null }),
}));

/** Tool outline in layout space (mm): rotated about its centroid and translated by its placement. */
export function placedOutline(t: Tool): Polygon {
  if (t.polygonMm.length < 3) return [];
  const c = centroid(t.polygonMm);
  return transformPolygon(t.polygonMm, t.placement.rotation, c, { x: t.placement.x, y: t.placement.y });
}

/** Pocket outline = placed outline grown by the fit offset (+ optional extra), unioned with finger cutouts. */
export function pocketOutline(t: Tool, offsetMm: number, extra = 0): Polygon {
  const placed = placedOutline(t);
  if (placed.length < 3) return [];
  const grown = offsetPolygons([placed], offsetMm + extra);
  const cut = t.cutouts.map((c) => circle({ x: c.x, y: c.y }, c.r + extra, 32));
  const merged = unionPolygons([...grown, ...cut]);
  // keep the largest ring
  let best = merged[0] ?? [];
  let bestA = 0;
  for (const p of merged) { const a = Math.abs(polyArea(p)); if (a > bestA) { bestA = a; best = p; } }
  return best;
}

function polyArea(p: Polygon): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; }
  return a / 2;
}

export const gridfinityConstants = GF;
