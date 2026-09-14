import ClipperLib from 'clipper-lib';
import type { Polygon } from './geometry';

const SCALE = 1000; // clipper works on integers: 1 unit = 1 µm

type IntPath = { X: number; Y: number }[];
const toInt = (p: Polygon): IntPath => p.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }));
const fromInt = (p: IntPath): Polygon => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }));

/** Offset (grow when delta>0, shrink when <0) polygons with round joins. Returns possibly several polygons. */
export function offsetPolygons(polys: Polygon[], delta: number, arcTolerance = 0.05): Polygon[] {
  if (Math.abs(delta) < 1e-6) return polys.map((p) => p.slice());
  const co = new ClipperLib.ClipperOffset(2, arcTolerance * SCALE);
  const paths = polys.map(toInt);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: IntPath[] = [];
  co.Execute(out, delta * SCALE);
  return out.map(fromInt);
}

export function unionPolygons(polys: Polygon[]): Polygon[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(polys.map(toInt), ClipperLib.PolyType.ptSubject, true);
  const out: IntPath[] = [];
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map(fromInt);
}

/** Boolean difference subject - clip. */
export function differencePolygons(subject: Polygon[], clip: Polygon[]): Polygon[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject.map(toInt), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clip.map(toInt), ClipperLib.PolyType.ptClip, true);
  const out: IntPath[] = [];
  c.Execute(ClipperLib.ClipType.ctDifference, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map(fromInt);
}

export function intersectPolygons(subject: Polygon[], clip: Polygon[]): Polygon[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject.map(toInt), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clip.map(toInt), ClipperLib.PolyType.ptClip, true);
  const out: IntPath[] = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map(fromInt);
}

export function polygonsOverlap(a: Polygon[], b: Polygon[]): boolean {
  return intersectPolygons(a, b).some((p) => Math.abs(ClipperLib.Clipper.Area(toInt(p))) > 1e-3 * SCALE * SCALE);
}

/** Union then clean (remove collinear / tiny edges). */
export function cleanPolygons(polys: Polygon[], tol = 0.02): Polygon[] {
  const cleaned = ClipperLib.Clipper.CleanPolygons(polys.map(toInt), tol * SCALE) as IntPath[];
  return cleaned.filter((p) => p.length >= 3).map(fromInt);
}
