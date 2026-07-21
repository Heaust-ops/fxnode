import type { ColorPickerLayout, Rect } from "../layout/types.js";
import { mapOklchToSrgb, maxSrgbChroma, type Oklch, type Rgba } from "../color/oklab.js";

const cache=new Map<string,OffscreenCanvas>();

function wheel(size:number,l:number):OffscreenCanvas{
  const bin=Math.round(l*32),key=`${size}:${bin}`,known=cache.get(key);
  if(known)return known;
  const canvas=new OffscreenCanvas(size,size),context=canvas.getContext("2d")!,image=context.createImageData(size,size),radius=size/2,lightness=bin/32;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=x+.5-radius,dy=radius-y-.5,r=Math.hypot(dx,dy)/radius,index=(y*size+x)*4;
    if(r>1)continue;
    const h=Math.atan2(dy,dx),rgb=mapOklchToSrgb({l:lightness,c:r*maxSrgbChroma(lightness,h),h});
    image.data[index]=rgb[0]*255;image.data[index+1]=rgb[1]*255;image.data[index+2]=rgb[2]*255;image.data[index+3]=255;
  }
  context.putImageData(image,0,0);cache.set(key,canvas);
  while(cache.size>66)cache.delete(cache.keys().next().value!);
  return canvas;
}

export function paintOklchWheel(context:OffscreenCanvasRenderingContext2D,bounds:{plane:Rect;lightness:Rect},model:Oklch,dpr=1,planeLightness=model.l):void{
  const size=Math.max(1,Math.round(bounds.plane.width*dpr));
  context.drawImage(wheel(size,planeLightness),bounds.plane.x,bounds.plane.y,bounds.plane.width,bounds.plane.height);
  const light=context.createLinearGradient(0,bounds.lightness.y,0,bounds.lightness.y+bounds.lightness.height);
  for(let i=0;i<=8;i++){const l=1-i/8,rgb=mapOklchToSrgb({l,c:model.c,h:model.h});light.addColorStop(i/8,`rgb(${rgb[0]*255} ${rgb[1]*255} ${rgb[2]*255})`);}
  context.fillStyle=light;context.fillRect(bounds.lightness.x,bounds.lightness.y,bounds.lightness.width,bounds.lightness.height);
  const radius=bounds.plane.width/2,cmax=maxSrgbChroma(planeLightness,model.h),fraction=cmax?Math.min(1,model.c/cmax):0,cx=bounds.plane.x+radius+radius*fraction*Math.cos(model.h),cy=bounds.plane.y+radius-radius*fraction*Math.sin(model.h);
  context.strokeStyle="#fff";context.lineWidth=2;context.beginPath();context.arc(cx,cy,4,0,Math.PI*2);context.stroke();
  const y=bounds.lightness.y+bounds.lightness.height*(1-model.l);context.strokeStyle="#fff";context.strokeRect(bounds.lightness.x-2,y-2,bounds.lightness.width+4,4);
}

export function paintColorPicker(context:OffscreenCanvasRenderingContext2D,layout:ColorPickerLayout,model:Oklch,rgba:Rgba,dpr=1):void{
  context.save();context.fillStyle="#181a1f";context.strokeStyle="#f5a623";context.lineWidth=1;context.beginPath();context.roundRect(layout.bounds.x,layout.bounds.y,layout.bounds.width,layout.bounds.height,7);context.fill();context.stroke();
  paintOklchWheel(context,layout,model,dpr);
  const alpha=context.createLinearGradient(0,layout.alpha.y,0,layout.alpha.y+layout.alpha.height);alpha.addColorStop(0,`rgba(${rgba[0]*255},${rgba[1]*255},${rgba[2]*255},1)`);alpha.addColorStop(1,`rgba(${rgba[0]*255},${rgba[1]*255},${rgba[2]*255},0)`);context.fillStyle=alpha;context.fillRect(layout.alpha.x,layout.alpha.y,layout.alpha.width,layout.alpha.height);
  const y=layout.alpha.y+layout.alpha.height*(1-rgba[3]);context.strokeStyle="#fff";context.strokeRect(layout.alpha.x-2,y-2,layout.alpha.width+4,4);context.restore();
}
