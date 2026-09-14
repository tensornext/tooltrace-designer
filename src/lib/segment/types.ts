import type { Mask } from '../contour';

export interface Marker { x: number; y: number; positive: boolean }

export interface SegmentInput {
  /** RGBA image to segment (rectified, top-down). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  markers: Marker[];
  /** 0..1 colour-distance tolerance for the classical segmenter. */
  tolerance: number;
  /** Optional paper rectangle (px) used to estimate the background colour. */
  paperPx?: { x: number; y: number; w: number; h: number };
}

export interface Segmenter {
  readonly id: 'classical' | 'sam';
  segment(input: SegmentInput): Promise<Mask | null>;
}
