export const enum DirtyReason {
  Scene = 1,
  Camera = 2,
  Selection = 4,
  Preview = 8,
  Viewport = 16,
  Barrier = 32,
  HostInteraction = 64,
}
export interface SchedulerMetrics {
  requests: number;
  coalesced: number;
  frames: number;
  maxInFlight: number;
  staleAcks: number;
}
export class RenderScheduler {
  private dirty = 0;
  private inFlight: number | undefined;
  private scheduled = false;
  private running = false;
  private latestRenderId = 0;
  private nextFrameId = 1;
  private poll = () => {};
  readonly metrics: SchedulerMetrics = { requests: 0, coalesced: 0, frames: 0, maxInFlight: 0, staleAcks: 0 };
  constructor(
    private readonly draw: (frameId: number, renderId: number, reasons: number) => void,
    private readonly enqueue: (callback: () => void) => void = (callback) => {
      const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
      raf ? raf(callback) : setTimeout(callback, 16);
    },
  ) {}
  start(poll: () => void = () => {}): void {
    if (this.running) return;
    this.running = true;
    this.poll = poll;
    this.schedule();
  }
  stop(): void {
    this.running = false;
  }
  request(renderId = this.latestRenderId, reason: DirtyReason = DirtyReason.Scene): void {
    this.metrics.requests++;
    this.latestRenderId = Math.max(this.latestRenderId, renderId);
    if (this.dirty || this.inFlight !== undefined) this.metrics.coalesced++;
    this.dirty |= reason;
  }
  consumed(frameId: number): void {
    if (frameId !== this.inFlight) {
      this.metrics.staleAcks++;
      return;
    }
    this.inFlight = undefined;
  }
  private schedule(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    this.enqueue(() => {
      this.scheduled = false;
      if (!this.running) return;
      try {
        this.poll();
        if (this.dirty && this.inFlight === undefined) {
          const reasons = this.dirty;
          this.dirty = 0;
          const frameId = this.nextFrameId++;
          this.inFlight = frameId;
          this.metrics.frames++;
          this.metrics.maxInFlight = Math.max(this.metrics.maxInFlight, 1);
          this.draw(frameId, this.latestRenderId, reasons);
        }
      } finally {
        this.schedule();
      }
    });
  }
}
