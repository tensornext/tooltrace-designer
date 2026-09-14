import type { Mask } from '../contour';
import type { SegmentInput, Segmenter } from './types';

/**
 * Optional neural segmenter using a Segment-Anything style model in the browser.
 * It is loaded lazily from a CDN build of transformers.js so the core app has no hard
 * dependency on multi-megabyte model weights. If loading fails (offline, blocked network)
 * the caller falls back to the classical segmenter.
 *
 * The production tooltrace.ai service almost certainly runs a SAM-like model server-side;
 * here we run SlimSAM (a distilled SAM) entirely on the client.
 */
export class SamSegmenter implements Segmenter {
  readonly id = 'sam' as const;
  private model: any = null;
  private processor: any = null;
  private cache: { key: string; embeddings: any; inputs: any } | null = null;
  static readonly MODEL_ID = 'Xenova/slimsam-77-uniform';
  static readonly CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.0';

  private async load() {
    if (this.model) return;
    const mod: any = await import(/* @vite-ignore */ SamSegmenter.CDN + '/dist/transformers.min.js');
    const { SamModel, AutoProcessor } = mod;
    this.model = await SamModel.from_pretrained(SamSegmenter.MODEL_ID, { dtype: 'fp32' });
    this.processor = await AutoProcessor.from_pretrained(SamSegmenter.MODEL_ID);
    this.RawImage = mod.RawImage;
  }
  private RawImage: any;

  async segment(input: SegmentInput): Promise<Mask | null> {
    await this.load();
    const { data, width, height, markers } = input;
    const positives = markers.filter((m) => m.positive);
    if (!positives.length) return null;
    const key = `${width}x${height}:${data.length}`;
    if (!this.cache || this.cache.key !== key) {
      const img = new this.RawImage(data, width, height, 4);
      const inputs = await this.processor(img);
      const embeddings = await this.model.get_image_embeddings(inputs);
      this.cache = { key, embeddings, inputs };
    }
    const { embeddings, inputs } = this.cache;
    const reshaped = inputs.reshaped_input_sizes[0];
    const points = markers.map((m) => [(m.x / width) * reshaped[1], (m.y / height) * reshaped[0]]);
    const labels = markers.map((m) => (m.positive ? 1n : 0n));
    const { Tensor } = await import(/* @vite-ignore */ SamSegmenter.CDN + '/dist/transformers.min.js');
    const input_points = new Tensor('float32', points.flat(), [1, 1, points.length, 2]);
    const input_labels = new Tensor('int64', labels, [1, 1, labels.length]);
    const outputs = await this.model({ ...embeddings, input_points, input_labels });
    const masks = await this.processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = outputs.iou_scores.data as Float32Array;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const m = masks[0][0]; // [num_masks, H, W]
    const [, H, W] = m.dims;
    const out = new Uint8Array(W * H);
    const md = m.data as Uint8Array;
    const off = best * W * H;
    for (let i = 0; i < W * H; i++) out[i] = md[off + i] ? 1 : 0;
    return { data: out, width: W, height: H };
  }
}
