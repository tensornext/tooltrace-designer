import { bboxAll, type Polygon } from './geometry';
import { foamOutline, gridfinityFootprint, gridfinityHeight, gridfinityOutline, GF, type FoamSettings, type GridfinitySettings, type InsertMode } from './layout';
import { pocketOutline, type Tool } from '../state/store';
import { intersectPolygons, cleanPolygons, offsetPolygons } from './offset';
import { TriMesh, addExtrusion, buildBody, buildGridfinityBase } from './export/mesh';
import { toStl } from './export/stl';
import { to3mf } from './export/threemf';
import { toSvg } from './export/svg';
import { toDxf } from './export/dxf';

export interface Design {
  mode: InsertMode;
  /** Container outline in layout mm (y-down screen space). */
  outline: Polygon;
  width: number;
  height: number;
  /** One pocket polygon per tool (layout mm, y-down), clipped to the container. */
  pockets: { tool: Tool; poly: Polygon; clipped: boolean }[];
  /** Total 3D height (gridfinity) or foam thickness. */
  totalHeight: number;
  pocketDepth: number;
  magnets: boolean;
  warnings: string[];
}

export interface DesignInput {
  mode: InsertMode;
  tools: Tool[];
  offsetMm: number;
  gridfinity: GridfinitySettings;
  foam: FoamSettings;
}

export function buildDesign(i: DesignInput): Design {
  const warnings: string[] = [];
  const traced = i.tools.filter((t) => t.polygonMm.length >= 3);
  let outline: Polygon, width: number, height: number, totalHeight: number, pocketDepth: number;
  if (i.mode === 'gridfinity') {
    const fp = gridfinityFootprint(i.gridfinity.unitsX, i.gridfinity.unitsY);
    outline = gridfinityOutline(i.gridfinity.unitsX, i.gridfinity.unitsY);
    width = fp.w; height = fp.h;
    totalHeight = gridfinityHeight(i.gridfinity.depth, i.gridfinity.snapHeight);
    pocketDepth = i.gridfinity.depth;
  } else {
    outline = foamOutline(i.foam);
    width = i.foam.width; height = i.foam.height;
    totalHeight = i.foam.thickness;
    pocketDepth = Math.min(i.foam.depth, i.foam.thickness);
    if (i.foam.depth > i.foam.thickness) warnings.push('Pocket depth exceeds foam thickness; pockets will be through-cut.');
  }
  // keep a wall between pockets and the outer edge
  const wall = i.mode === 'gridfinity' ? 1.2 : Math.max(0, i.foam.margin);
  const inner = cleanPolygons(shrink(outline, wall));
  const pockets = traced.map((tool) => {
    const raw = pocketOutline(tool, i.offsetMm);
    const clippedPolys = inner.length ? intersectPolygons([raw], inner) : [raw];
    const poly = largest(clippedPolys);
    const clipped = Math.abs(area(poly) - area(raw)) > 0.5;
    if (clipped) warnings.push(`${tool.name} extends past the ${i.mode === 'gridfinity' ? 'bin' : 'sheet'} edge and was clipped.`);
    return { tool, poly, clipped };
  });
  // overlap check
  for (let a = 0; a < pockets.length; a++) for (let b = a + 1; b < pockets.length; b++) {
    const ov = intersectPolygons([pockets[a].poly], [pockets[b].poly]);
    if (ov.some((p) => Math.abs(area(p)) > 0.5)) warnings.push(`${pockets[a].tool.name} overlaps ${pockets[b].tool.name}.`);
  }
  if (i.mode === 'gridfinity' && totalHeight - GF.FLOOR_THICKNESS < pocketDepth - 1e-6) warnings.push('Height snapped below pocket depth.');
  return { mode: i.mode, outline, width, height, pockets, totalHeight, pocketDepth, magnets: i.mode === 'gridfinity' && i.gridfinity.magnets, warnings };
}

function shrink(poly: Polygon, d: number): Polygon[] {
  return d <= 0 ? [poly] : offsetPolygons([poly], -d);
}

function area(p: Polygon): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; }
  return a / 2;
}
function largest(polys: Polygon[]): Polygon {
  let best: Polygon = [], bestA = 0;
  for (const p of polys) { const a = Math.abs(area(p)); if (a > bestA) { bestA = a; best = p; } }
  return best;
}

/** Layout space is y-down (screen). Meshes/CAD use y-up: flip about the container height. */
function flipY(poly: Polygon, h: number): Polygon { return poly.map((p) => ({ x: p.x, y: h - p.y })); }

/**
 * Mesh parts of a design. Each part is an individually closed shell; the Gridfinity base cells
 * overlap the body by 0.5 mm so slicers union them (overlapping shells are fine, coincident
 * faces are not). Concatenate for export, test each part for watertightness.
 */
export function buildMeshParts(d: Design): { name: string; mesh: TriMesh }[] {
  const outline = flipY(d.outline, d.height);
  const pockets = d.pockets.map((p) => flipY(p.poly, d.height)).filter((p) => p.length >= 3);
  const parts: { name: string; mesh: TriMesh }[] = [];
  if (d.mode === 'gridfinity') {
    const ux = Math.round((d.width + GF.CLEARANCE) / GF.UNIT), uy = Math.round((d.height + GF.CLEARANCE) / GF.UNIT);
    const base = new TriMesh();
    buildGridfinityBase(base, ux, uy, d.magnets);
    parts.push({ name: 'base', mesh: base });
    const body = new TriMesh();
    buildBody(body, { outline, pockets, floorZ: d.totalHeight - d.pocketDepth, height: d.totalHeight, bodyZ0: GF.BASE_HEIGHT });
    parts.push({ name: 'body', mesh: body });
  } else {
    const body = new TriMesh();
    const floorZ = Math.max(0, d.totalHeight - d.pocketDepth);
    if (floorZ <= 1e-6) addExtrusion(body, outline, pockets, 0, d.totalHeight); // through pockets
    else buildBody(body, { outline, pockets, floorZ, height: d.totalHeight, bodyZ0: 0 });
    parts.push({ name: 'body', mesh: body });
  }
  return parts;
}

export function buildMesh(d: Design): TriMesh {
  const mesh = new TriMesh();
  for (const p of buildMeshParts(d)) mesh.tris.push(...p.mesh.tris);
  return mesh;
}

export function exportFile(d: Design, format: 'svg' | 'dxf' | 'stl' | '3mf' | 'json', name: string): { blob: Blob; filename: string } {
  const base = name.replace(/[^a-z0-9-_]+/gi, '_') || 'tooltrace';
  if (format === 'svg') {
    const svg = toSvg(d.width, d.height, [
      { name: 'outline', polys: [d.outline], stroke: '#000000' },
      { name: 'pockets', polys: d.pockets.map((p) => p.poly), stroke: '#ff0000' },
    ]);
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), filename: `${base}.svg` };
  }
  if (format === 'dxf') {
    const dxf = toDxf([
      { name: 'OUTLINE', polys: [d.outline], color: 7 },
      { name: 'POCKETS', polys: d.pockets.map((p) => p.poly), color: 1 },
    ], d.height);
    return { blob: new Blob([dxf], { type: 'application/dxf' }), filename: `${base}.dxf` };
  }
  if (format === 'json') {
    const json = JSON.stringify({ mode: d.mode, width: d.width, height: d.height, totalHeight: d.totalHeight, pocketDepth: d.pocketDepth, outline: d.outline, pockets: d.pockets.map((p) => ({ name: p.tool.name, polygon: p.poly })) }, null, 2);
    return { blob: new Blob([json], { type: 'application/json' }), filename: `${base}.json` };
  }
  const mesh = buildMesh(d);
  if (format === 'stl') return { blob: new Blob([toStl(mesh, base)], { type: 'model/stl' }), filename: `${base}.stl` };
  const bytes = to3mf(mesh, base);
  return { blob: new Blob([bytes as BlobPart], { type: 'model/3mf' }), filename: `${base}.3mf` };
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function designBounds(d: Design) { return bboxAll([d.outline, ...d.pockets.map((p) => p.poly)]); }
