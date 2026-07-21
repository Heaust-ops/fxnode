export const enum DirtyReason { Scene=1,Camera=2,Selection=4,Preview=8,Viewport=16,Barrier=32 }
export interface SchedulerMetrics { requests:number;coalesced:number;frames:number;maxInFlight:number;staleAcks:number }
export class RenderScheduler {
  private dirty=0;private inFlight:number|undefined;private scheduled=false;private latestRenderId=0;private nextFrameId=1;
  readonly metrics:SchedulerMetrics={requests:0,coalesced:0,frames:0,maxInFlight:0,staleAcks:0};
  constructor(private readonly draw:(frameId:number,renderId:number,reasons:number)=>void,private readonly enqueue:(callback:()=>void)=>void=callback=>{const raf=(globalThis as {requestAnimationFrame?:(cb:()=>void)=>void}).requestAnimationFrame;raf?raf(callback):setTimeout(callback,0);}){}
  request(renderId=this.latestRenderId,reason:DirtyReason=DirtyReason.Scene):void{this.metrics.requests++;this.latestRenderId=Math.max(this.latestRenderId,renderId);if(this.dirty||this.scheduled||this.inFlight!==undefined)this.metrics.coalesced++;this.dirty|=reason;this.schedule();}
  consumed(frameId:number):void{if(frameId!==this.inFlight){this.metrics.staleAcks++;return;}this.inFlight=undefined;this.schedule();}
  private schedule():void{if(!this.dirty||this.inFlight!==undefined||this.scheduled)return;this.scheduled=true;this.enqueue(()=>{this.scheduled=false;if(!this.dirty||this.inFlight!==undefined)return;const reasons=this.dirty;this.dirty=0;const frameId=this.nextFrameId++;this.inFlight=frameId;this.metrics.frames++;this.metrics.maxInFlight=Math.max(this.metrics.maxInFlight,1);this.draw(frameId,this.latestRenderId,reasons);});}
}
