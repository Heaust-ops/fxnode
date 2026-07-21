import { GEOMETRY as G } from "../layout/constants.js";
import { worldToView } from "../layout/geometry.js";
import type { LinkId, NodeId, ParameterValue, SocketId } from "../core/types.js";
import type { LayoutControl, LayoutSnapshot, LayoutSocket, Rect, ViewTransform } from "../layout/types.js";
import type { RenderTheme } from "./theme.js";
import { isColorRamp, sampleColorRamp } from "../catalog/color-ramp.js";

export interface InteractionRenderState { readonly knife?:{points:readonly {x:number;y:number}[];crossed:ReadonlySet<LinkId>;mode:"remove"|"mute"} }
export interface InteractionRenderState { readonly selectedNodes: ReadonlySet<NodeId>; readonly selectedLinks?:ReadonlySet<LinkId>; readonly activeNode?: NodeId; readonly hoverNode?: NodeId; readonly focusedControl?: string; readonly hoveredControl?:string;readonly focusedRampTarget?:string;readonly hoveredRampTarget?:string;readonly activeRampStopByNode?:ReadonlyMap<NodeId,string>;readonly collapseAnimations?:ReadonlyMap<NodeId,{readonly value:number}>; readonly textEditBuffer?: string; readonly box?:{start:{x:number;y:number};current:{x:number;y:number}};readonly linkDrag?:{from:SocketId;current:{x:number;y:number};candidate?:SocketId};readonly parentHighlight?:NodeId }
export interface RenderStats { readonly candidateNodes:number;readonly totalNodes:number;readonly paintedNodes:number;readonly candidateLinks:number;readonly totalLinks:number;readonly paintedLinks:number;readonly paintMs:number }

function valueText(value: unknown): string {
  const typed = value as ParameterValue | undefined;
  if (!typed || typeof typed !== "object" || !("kind" in typed)) return "—";
  if (typed.kind === "vector" || typed.kind === "color") return typed.value.map(component => component.toFixed(2)).join(" ");
  if (typed.kind === "json") return "…";
  return String(typed.value);
}

/** Canvas maxWidth scales glyphs but does not constrain them. Clip every label to its owning cell. */
function clippedText(context: OffscreenCanvasRenderingContext2D, text: string, rect: Rect, x: number, y: number, padding = 3): void {
  context.save();
  context.beginPath();
  context.rect(rect.x + padding, rect.y, Math.max(0, rect.width - padding * 2), rect.height);
  context.clip();
  context.fillText(text, x, y, Math.max(0, rect.width - padding * 2));
  context.restore();
}

function paintControl(context: OffscreenCanvasRenderingContext2D, control: LayoutControl, rect: Rect, theme: RenderTheme, zoom: number, interaction?: InteractionRenderState): void {
  const typedRamp=control.value as {kind?:unknown;value?:unknown};
  if(control.kind==="color-ramp"&&typedRamp?.kind==="json"&&isColorRamp(typedRamp.value)){
    const ramp=typedRamp.value,active=ramp.stops.find(s=>s.id===interaction?.activeRampStopByNode?.get(control.nodeId))??ramp.stops[0]!,toolbar={x:rect.x,y:rect.y,width:rect.width,height:20*zoom},menusY=rect.y+22*zoom,gradient={x:rect.x,y:rect.y+46*zoom,width:rect.width,height:28*zoom};
    context.fillStyle=theme.control;context.fillRect(toolbar.x,toolbar.y,toolbar.width,toolbar.height);context.fillStyle=theme.text;context.textAlign="center";clippedText(context,"+     −          Flip             Distribute",toolbar,toolbar.x+toolbar.width/2,toolbar.y+toolbar.height/2);
    const labels=[ramp.colorMode.toUpperCase(),ramp.interpolation.replace("-"," "),ramp.hueInterpolation];const menuWidths=[.3,.41,.29];let x=rect.x;for(let i=0;i<3;i++){const w=rect.width*menuWidths[i]!;context.fillStyle=theme.control;context.fillRect(x,menusY,w-2*zoom,20*zoom);context.fillStyle=theme.text;context.fillText(labels[i]!,x+w/2,menusY+10*zoom);x+=w;}
    gradient.x+=8*zoom;gradient.width-=16*zoom;const cell=6*zoom;for(let yy=gradient.y;yy<gradient.y+gradient.height;yy+=cell)for(let xx=gradient.x;xx<gradient.x+gradient.width;xx+=cell){context.fillStyle=((Math.floor((xx-gradient.x)/cell)+Math.floor((yy-gradient.y)/cell))%2)?"#777":"#aaa";context.fillRect(xx,yy,cell,cell);}
    const steps=Math.max(2,Math.ceil(gradient.width));for(let i=0;i<steps;i++){const c=sampleColorRamp(ramp,i/(steps-1));context.fillStyle=`rgba(${c[0]*255},${c[1]*255},${c[2]*255},${c[3]})`;context.fillRect(gradient.x+i*gradient.width/steps,gradient.y,gradient.width/steps+1,gradient.height);}
    context.strokeStyle="#111";context.strokeRect(gradient.x,gradient.y,gradient.width,gradient.height);
    for(const stop of ramp.stops){const sx=gradient.x+stop.position*gradient.width,sy=gradient.y+gradient.height;context.beginPath();context.moveTo(sx,sy);context.lineTo(sx-6*zoom,sy+12*zoom);context.lineTo(sx+6*zoom,sy+12*zoom);context.closePath();context.fillStyle=`rgb(${stop.color[0]*255},${stop.color[1]*255},${stop.color[2]*255})`;context.fill();context.strokeStyle=stop.id===active.id?"#f5a623":"#fff";context.lineWidth=stop.id===active.id?3:2;context.stroke();}
    const detailsY=rect.y+104*zoom,widths=[.25,.35,.40],details=[active.id,`Pos ${active.position.toFixed(3)}`,active.color.map((c,i)=>`${"RGBA"[i]} ${c.toFixed(2)}`).join(" ")];let dx=rect.x;for(let i=0;i<3;i++){const w=rect.width*widths[i]!;const cellRect={x:dx,y:detailsY,width:w-2*zoom,height:20*zoom};context.fillStyle=theme.control;context.fillRect(cellRect.x,cellRect.y,cellRect.width,cellRect.height);context.fillStyle=theme.text;clippedText(context,details[i]!,cellRect,cellRect.x+cellRect.width/2,cellRect.y+cellRect.height/2);dx+=w;}if(interaction?.focusedControl===control.id){context.strokeStyle="#f5a623";context.strokeRect(rect.x,detailsY,rect.width,20*zoom);}context.textAlign="left";return;
  }
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, 4 * zoom);
  context.fillStyle = control.linked ? theme.body : theme.control;
  context.fill();
  if (interaction?.focusedControl === control.id) {
    context.strokeStyle = "#f5a623";
    context.stroke();
  }
  context.fillStyle = theme.text;
  context.textAlign = "center";
  if (control.kind === "resource") {
    const value = valueText(control.value);
    clippedText(context,value === "" ? "▧  Select…   Open   New" : `▧  ${value}   Open`,rect,rect.x + rect.width / 2,rect.y + rect.height / 2,3*zoom);
    context.textAlign = "left";
    return;
  }
  const text = interaction?.focusedControl === control.id && interaction.textEditBuffer !== undefined ? `${interaction.textEditBuffer}|` : valueText(control.value);
  if (control.subfields.length) {
    const typed = control.value as Extract<ParameterValue, { kind: "vector" | "color" }>;
    for (const field of control.subfields) {
      const fieldRect = { x: rect.x + (field.bounds.x-control.bounds.x)*zoom, y:rect.y, width:field.bounds.width*zoom, height:rect.height };
      context.beginPath();context.roundRect(fieldRect.x,fieldRect.y,fieldRect.width,fieldRect.height,3*zoom);context.fillStyle=control.linked?theme.body:theme.control;context.fill();
      const component=typed.value[field.index]??0, full=`${field.label} ${component.toFixed(2)}`, compact=`${field.label} ${component.toFixed(0)}`;
      const label=context.measureText(full).width<=fieldRect.width-6*zoom?full:compact;
      context.fillStyle=theme.text;clippedText(context,label,fieldRect,fieldRect.x+fieldRect.width/2,rect.y+rect.height/2,2*zoom);
    }
  } else {
    clippedText(context,text,rect,rect.x+rect.width/2,rect.y+rect.height/2,3*zoom);
  }
  context.textAlign = "left";
}

function paintSocket(context: OffscreenCanvasRenderingContext2D, socket: LayoutSocket, theme: RenderTheme, zoom: number, transform: ViewTransform): void {
  const point = worldToView(socket.anchor, transform);
  context.fillStyle = theme.sockets[socket.dataType];
  context.beginPath();
  context.arc(point.x, point.y, G.socket * zoom, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = theme.text;
  context.textAlign = socket.direction === "input" ? "left" : "right";
  context.fillText(socket.label, point.x + (socket.direction === "input" ? 10 : -10) * zoom, point.y);
  context.textAlign = "left";
}
export function renderCanvas(context: OffscreenCanvasRenderingContext2D, snapshot: LayoutSnapshot, theme: RenderTheme, interaction?: InteractionRenderState): RenderStats {
  const started=performance.now();let paintedNodes=0,paintedLinks=0;const planned=snapshot as LayoutSnapshot&{candidateLinkIds?:readonly LinkId[];candidateNodeIds?:readonly NodeId[];totalNodes?:number;totalLinks?:number};
  const { transform: t } = snapshot;
  context.setTransform(t.dpr, 0, 0, t.dpr, 0, 0);
  context.fillStyle = theme.background; context.fillRect(0, 0, t.viewport.x, t.viewport.y);
  const spacing = G.grid * t.zoom;
  context.fillStyle = theme.grid;
  const phase = worldToView({ x: 0, y: 0 }, t);
  for (let x = ((phase.x % spacing) + spacing) % spacing; x < t.viewport.x; x += spacing) for (let y = ((phase.y % spacing) + spacing) % spacing; y < t.viewport.y; y += spacing) { context.beginPath(); context.arc(x, y, t.zoom < 0.7 ? 0.5 : 1, 0, Math.PI * 2); context.fill(); }
  const viewRect = (rect: Rect) => { const p = worldToView({ x: rect.x, y: rect.y }, t); return { x: p.x, y: p.y, width: rect.width * t.zoom, height: rect.height * t.zoom }; };
  for (const id of snapshot.drawOrder) {
    const node = snapshot.nodes.get(id); if (!node?.visible || node.kind !== "frame") continue;
    const r = viewRect(node.bounds), radius = 10 * t.zoom, h = G.header * t.zoom;
    context.beginPath(); context.roundRect(r.x, r.y, r.width, r.height, radius); context.fillStyle = theme.frame; context.fill(); context.strokeStyle = theme.frameHeader; context.lineWidth = 1; context.stroke();
    context.fillStyle = theme.frameHeader; context.font = `600 ${Math.max(10, 13 * t.zoom)}px sans-serif`; context.textBaseline = "middle"; context.fillText(node.label, r.x + 10 * t.zoom, r.y + h / 2);
    context.beginPath(); context.moveTo(r.x + 8 * t.zoom, r.y + h); context.lineTo(r.x + r.width - 8 * t.zoom, r.y + h); context.stroke();
  }
  context.lineWidth = 2;
  for (const id of planned.candidateLinkIds??snapshot.links.keys()) {const link=snapshot.links.get(id); if (!link?.visible) continue;paintedLinks++; const color = link.muted?"#d94b4b":theme.sockets[link.dataType], start = worldToView(link.points[0]!, t), end = worldToView(link.points.at(-1)!, t), c1 = worldToView(link.controls[0], t), c2 = worldToView(link.controls[1], t); const emphasized=interaction?.selectedLinks?.has(link.id)||interaction?.knife?.crossed.has(link.id);context.strokeStyle = emphasized?"#ffffff":color;context.lineWidth=emphasized?4:2; context.beginPath(); context.moveTo(start.x, start.y); context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y); context.stroke(); }
  for (const id of snapshot.drawOrder) {
    const node = snapshot.nodes.get(id); if (!node?.visible || node.kind === "frame") continue;
    if (node.kind === "reroute") continue;paintedNodes++;
    const r = viewRect(node.bounds), h = G.header * t.zoom;
    const radius = G.corner * t.zoom;
    context.shadowColor = theme.shadow; context.shadowBlur = 8; context.shadowOffsetY = 3; context.beginPath(); context.roundRect(r.x, r.y, r.width, r.height, radius); context.fillStyle = theme.body; context.fill(); context.shadowColor = "transparent";
    context.save(); context.beginPath(); context.roundRect(r.x, r.y, r.width, r.height, radius); context.clip(); context.fillStyle = theme.headers[node.category]; context.fillRect(r.x, r.y, r.width, h); context.restore(); context.beginPath(); context.roundRect(r.x, r.y, r.width, r.height, radius); context.strokeStyle = theme.outline; context.lineWidth = 1; context.stroke();
    context.fillStyle = theme.text; context.font = `600 ${Math.max(9, 12 * t.zoom)}px sans-serif`; context.textBaseline = "middle"; context.fillText(node.label, r.x + 9 * t.zoom, r.y + h / 2, r.width - 18 * t.zoom);
    const cx=r.x+r.width-12*t.zoom,cy=r.y+h/2,collapseAmount=Math.max(0,Math.min(1,interaction?.collapseAnimations?.get(node.id)?.value??(node.collapsed?1:0)));context.save();context.translate(cx,cy);context.rotate(-Math.PI/2*collapseAmount);context.beginPath();context.moveTo(-4*t.zoom,-3*t.zoom);context.lineTo(4*t.zoom,-3*t.zoom);context.lineTo(0,3*t.zoom);context.closePath();context.fillStyle="rgba(255,255,255,.65)";context.fill();context.restore();
    context.font = `${Math.max(9, 11 * t.zoom)}px sans-serif`;
    for (const row of node.rows) {
      if (row.kind === "header" || row.kind === "category" || row.kind === "section" || row.kind === "panel" || row.kind === "placeholder") {
        const rowRect = viewRect(row.bounds);
        context.fillStyle = theme.muted;
        context.fillText(row.label, rowRect.x + 8 * t.zoom, rowRect.y + rowRect.height / 2);
      } else if (row.kind === "control") {
        const control = snapshot.controls.get(row.controlId);
        if (control) {
          const rowRect = viewRect(row.bounds);
          context.fillStyle = theme.muted;
          context.fillText(control.label, rowRect.x + 8 * t.zoom, rowRect.y + rowRect.height / 2);
          paintControl(context, control, viewRect(control.bounds), theme, t.zoom, interaction);
        }
      } else if (row.kind === "grading-pair") {
        const scalar=snapshot.controls.get(row.scalarControlId),color=snapshot.controls.get(row.colorControlId),rowRect=viewRect(row.bounds);
        context.fillStyle=theme.muted;context.fillText(row.label,rowRect.x+8*t.zoom,rowRect.y+rowRect.height/2);
        if(scalar)paintControl(context,scalar,viewRect(scalar.bounds),theme,t.zoom,interaction);
        if(color)paintControl(context,color,viewRect(color.bounds),theme,t.zoom,interaction);
      } else if (row.kind === "socket") {
        const socket = snapshot.sockets.get(row.socketId);
        if (socket) paintSocket(context, socket, theme, t.zoom, t);
        const control = row.controlId ? snapshot.controls.get(row.controlId) : undefined;
        if (control && !control.linked) paintControl(context, control, viewRect(control.bounds), theme, t.zoom, interaction);
      }
    }
    if(node.muted){context.save();context.beginPath();context.roundRect(r.x,r.y,r.width,r.height,radius);context.clip();context.fillStyle="rgba(20,20,20,.35)";context.fillRect(r.x,r.y,r.width,r.height);context.restore();for(const bypass of node.bypasses){const a=worldToView(bypass.from,t),b=worldToView(bypass.to,t),dx=Math.max(20,Math.abs(b.x-a.x)*.4);context.strokeStyle="#d94b4b";context.lineWidth=3;context.beginPath();context.moveTo(a.x,a.y);context.bezierCurveTo(a.x+dx,a.y,b.x-dx,b.y,b.x,b.y);context.stroke();}}
    if (interaction?.selectedNodes.has(node.id)) { context.beginPath(); context.roundRect(r.x,r.y,r.width,r.height,radius); context.strokeStyle=node.id===interaction.activeNode?theme.nodeActive:theme.nodeSelected; context.lineWidth=2; context.stroke(); }
    if(!node.collapsed){context.beginPath();context.moveTo(r.x+r.width-9*t.zoom,r.y+r.height);context.lineTo(r.x+r.width,r.y+r.height-9*t.zoom);context.strokeStyle="#8b8e95";context.lineWidth=1;context.stroke();}
    context.textAlign = "left";
  }
  for (const id of snapshot.drawOrder){const node=snapshot.nodes.get(id);if(node?.visible && node.kind === "reroute"){paintedNodes++;const row=node.rows.find(item=>item.kind==="socket");const socket=row?.kind==="socket"?snapshot.sockets.get(row.socketId):undefined;if(socket){const p=worldToView(socket.anchor,t);context.fillStyle=theme.sockets[socket.dataType];context.beginPath();context.arc(p.x,p.y,G.reroute*t.zoom,0,Math.PI*2);context.fill();}}}
  if(interaction?.parentHighlight){const n=snapshot.nodes.get(interaction.parentHighlight);if(n){const r=viewRect(n.bounds);context.strokeStyle="#f5a623";context.lineWidth=3;context.strokeRect(r.x,r.y,r.width,r.height);}}
  if(interaction?.linkDrag){const from=[...snapshot.sockets.values()].find(socket=>socket.id===interaction.linkDrag?.from);if(from){const a=worldToView(from.anchor,t),b=interaction.linkDrag.current,dx=Math.max(40,Math.abs(b.x-a.x)*.5);context.strokeStyle=theme.sockets[from.dataType];context.lineWidth=2;context.beginPath();context.moveTo(a.x,a.y);context.bezierCurveTo(a.x+dx,a.y,b.x-dx,b.y,b.x,b.y);context.stroke();for(const socket of snapshot.sockets.values()){if(socket.direction==="input"&&(socket.dataType==="any"||socket.accepts.includes(from.dataType))){const p=worldToView(socket.anchor,t);context.beginPath();context.arc(p.x,p.y,(socket.id===interaction.linkDrag.candidate?10:8),0,Math.PI*2);context.strokeStyle=socket.id===interaction.linkDrag.candidate?"#fff":theme.sockets[socket.dataType];context.stroke();}}}}
  if(interaction?.knife){const points=interaction.knife.points;context.strokeStyle=interaction.knife.mode==="mute"?"#e85b5b":"#ffffff";context.lineWidth=2;context.beginPath();points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();const p=points.at(-1);if(p){context.beginPath();context.moveTo(p.x-7,p.y-7);context.lineTo(p.x+7,p.y+7);context.moveTo(p.x+7,p.y-7);context.lineTo(p.x-7,p.y+7);context.stroke();}}
  if(interaction?.box){const a=interaction.box.start,b=interaction.box.current,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);context.fillStyle="rgba(245,166,35,.12)";context.fillRect(x,y,w,h);context.strokeStyle="#f5a623";context.lineWidth=1;context.strokeRect(x+.5,y+.5,w,h);}
  return{candidateNodes:planned.candidateNodeIds?.length??snapshot.drawOrder.length,totalNodes:planned.totalNodes??snapshot.nodes.size,paintedNodes,candidateLinks:planned.candidateLinkIds?.length??snapshot.links.size,totalLinks:planned.totalLinks??snapshot.links.size,paintedLinks,paintMs:performance.now()-started};
}
