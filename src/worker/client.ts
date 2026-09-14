import type { WorkerRequest, WorkerResponse } from './imageWorker';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

class ImageWorkerClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 0;
  constructor() {
    this.worker = new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const r = ev.data;
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.type === 'error') p.reject(new Error(r.message)); else p.resolve(r);
    };
  }
  private call<T extends WorkerResponse>(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }
  detect(data: Uint8ClampedArray, width: number, height: number) {
    return this.call<Extract<WorkerResponse, { type: 'detect' }>>({ type: 'detect', data: data.slice(), width, height });
  }
  rectify(data: Uint8ClampedArray, width: number, height: number, corners: { x: number; y: number }[], paperW: number, paperH: number) {
    const copy = data.slice();
    return this.call<Extract<WorkerResponse, { type: 'rectify' }>>({ type: 'rectify', data: copy, width, height, corners, paperW, paperH }, [copy.buffer]);
  }
  segment(markers: { x: number; y: number; positive: boolean }[], tolerance: number, segmenter: 'classical' | 'sam') {
    return this.call<Extract<WorkerResponse, { type: 'segment' }>>({ type: 'segment', markers, tolerance, segmenter });
  }
}

let client: ImageWorkerClient | null = null;
export function imageWorker(): ImageWorkerClient {
  client ??= new ImageWorkerClient();
  return client;
}
