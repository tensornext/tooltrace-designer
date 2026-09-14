/// <reference lib="webworker" />
import { rectify, type RectifiedImage } from '../lib/warp';
import { detectPaperCorners } from '../lib/paper';
import { maskToPolygon } from '../lib/contour';
import { ClassicalSegmenter, SamSegmenter, type Marker, type Segmenter } from '../lib/segment';
import type { Pt } from '../lib/geometry';

export type WorkerRequest =
  | { type: 'detect'; id: number; data: Uint8ClampedArray; width: number; height: number }
  | { type: 'rectify'; id: number; data: Uint8ClampedArray; width: number; height: number; corners: Pt[]; paperW: number; paperH: number }
  | { type: 'segment'; id: number; markers: Marker[]; tolerance: number; segmenter: 'classical' | 'sam' };

export type WorkerResponse =
  | { type: 'detect'; id: number; corners: Pt[] | null }
  | { type: 'rectify'; id: number; data: Uint8ClampedArray; width: number; height: number; pxPerMm: number; originMm: Pt; paperPx: RectifiedImage['paperPx'] }
  | { type: 'segment'; id: number; polygon: Pt[]; fallback?: string }
  | { type: 'error'; id: number; message: string };

let rectified: RectifiedImage | null = null;
const classical = new ClassicalSegmenter();
let sam: SamSegmenter | null = null;

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'detect') {
      const corners = detectPaperCorners(msg.data, msg.width, msg.height);
      post({ type: 'detect', id: msg.id, corners });
    } else if (msg.type === 'rectify') {
      rectified = rectify({ data: msg.data, width: msg.width, height: msg.height }, msg.corners, msg.paperW, msg.paperH, 4);
      const copy = rectified.data.slice();
      post({ type: 'rectify', id: msg.id, data: copy, width: rectified.width, height: rectified.height, pxPerMm: rectified.pxPerMm, originMm: rectified.originMm, paperPx: rectified.paperPx }, [copy.buffer]);
    } else if (msg.type === 'segment') {
      if (!rectified) throw new Error('No rectified image');
      let seg: Segmenter = classical;
      let fallback: string | undefined;
      if (msg.segmenter === 'sam') {
        try { sam ??= new SamSegmenter(); seg = sam; } catch (e) { fallback = String(e); }
      }
      const input = { data: rectified.data, width: rectified.width, height: rectified.height, markers: msg.markers, tolerance: msg.tolerance, paperPx: rectified.paperPx };
      let mask = null;
      try {
        mask = await seg.segment(input);
      } catch (e) {
        if (seg.id === 'sam') { fallback = `Neural segmenter unavailable (${(e as Error).message}); used classical.`; mask = await classical.segment(input); }
        else throw e;
      }
      const polygon = mask ? maskToPolygon(mask, 1.2, 1) : [];
      post({ type: 'segment', id: msg.id, polygon, fallback });
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, message: (e as Error).message ?? String(e) });
  }
};

function post(r: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(r, transfer);
}
