import type { GraphDocument, GraphNode, LinkId, NodeId, ParameterValue, SocketId, Vec2 } from "../core/types.js";
import { GEOMETRY as G } from "./constants.js";
import { bounds, intersects } from "./geometry.js";
import type { LayoutControl, LayoutLink, LayoutNode, LayoutNumericField, LayoutRow, LayoutScene, LayoutSnapshot, LayoutSocket, LayoutSubfield, LayoutView, Rect, ViewTransform } from "./types.js";
import { getDescriptor } from "../catalog/registry.js";
import type { DescriptorUiItem, ValueSchema, VisibilityExpression } from "../catalog/types.js";
import { effectivelyMutedLinks } from "./link-mute.js";

const title = (value: string): string => value.replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const textWidth=(value:string)=>value.length*6.5;
function minimumControlWidth(schema:ValueSchema|undefined):number{
  if(!schema)return 80;
  if(schema.type==="vector")return 3*58+6;
  if(schema.type==="color")return 80;
  if(schema.type==="color-ramp")return 300;
  if(schema.type==="string")return Math.max(80,...(schema.enum??[]).map(value=>textWidth(value)+28));
  return 80;
}
function minimumNodeWidth(descriptor:ReturnType<typeof getDescriptor>,node:GraphNode,items:readonly DescriptorUiItem[]):number{
  if(!descriptor)return G.minWidth;
  let width=Math.max(G.minWidth,textWidth(node.label)+42);
  for(const item of items){
    const label="label" in item?item.label:item.kind==="parameter"||item.kind==="resource"?title(item.key):item.kind==="socket"?title(item.key):"";
    if(label)width=Math.max(width,(textWidth(label)+18)/.4);
    if(item.kind==="parameter"||item.kind==="resource"){const schema=descriptor.parameters[item.key];width=Math.max(width,schema?.type==="color-ramp"?320:minimumControlWidth(schema)/.53);}
    else if(item.kind==="socket"){const socket=descriptor.sockets.find(value=>value.key===item.key);if(socket?.value&&!socket.hideValue)width=Math.max(width,minimumControlWidth(socket.value)/.53);}
    else if(item.kind==="grading-wheels")width=Math.max(width,400);
  }
  return Math.min(G.maxWidth,Math.ceil(width));
}
const uiItemUnits=(item:DescriptorUiItem,descriptor:ReturnType<typeof getDescriptor>)=>item.kind==="header"?2:item.kind==="grading-wheels"?7:item.kind==="resource"?4:(item.kind==="parameter"&&descriptor?.parameters[item.key]?.type==="color-ramp")?8:1;
function controlKind(schema: ValueSchema | undefined): LayoutControl["kind"] {
  if (!schema) return "readonly-json";
  if (schema.type === "string" && schema.enum) return "enum";
  return schema.type;
}
function makeSubfields(bounds: Rect, type: ValueSchema["type"] | undefined): readonly LayoutSubfield[] {
  const labels = type === "vector" ? ["X", "Y", "Z"] as const : [];
  const gutter = 3;
  const width = labels.length ? (bounds.width - gutter * (labels.length - 1)) / labels.length : 0;
  return labels.map((label, index) => ({
    index,
    label,
    bounds: { x: bounds.x + index * (width + gutter), y: bounds.y, width, height: bounds.height },
  }));
}
function makeNumericFields(bounds: Rect, schema: ValueSchema | undefined, subfields: readonly LayoutSubfield[]): readonly LayoutNumericField[] {
  const fields = schema?.type === "number" ? [{ index: 0, bounds }] : schema?.type === "vector" ? subfields : [];
  const minimum = schema?.type === "number" ? schema.softMin ?? schema.hardMin ?? schema.minimum : schema?.type === "vector" ? schema.minimum : undefined;
  const maximum = schema?.type === "number" ? schema.softMax ?? schema.hardMax ?? schema.maximum : schema?.type === "vector" ? schema.maximum : undefined;
  const range = Number.isFinite(minimum) && Number.isFinite(maximum) && maximum! > minimum! ? { minimum: minimum!, maximum: maximum! } : undefined;
  return fields.map(field => {
    const arrow = Math.min(7, field.bounds.width * .14);
    return {
      component: field.index,
      bounds: field.bounds,
      decrement: { ...field.bounds, width: arrow },
      value: { ...field.bounds, x: field.bounds.x + arrow, width: Math.max(0, field.bounds.width - arrow * 2) },
      increment: { ...field.bounds, x: field.bounds.x + field.bounds.width - arrow, width: arrow },
      ...(range ? { range } : {}),
    };
  });
}
const category = (descriptor: ReturnType<typeof getDescriptor>): LayoutNode["category"] => descriptor?.family === "compositor" ? (descriptor.role === "input" ? "compositorInput" : "compositorColor") : descriptor?.family === "geometry" ? "geometry" : descriptor?.role === "input" ? "input" : descriptor?.role === "output" ? "output" : descriptor?.typeId.includes("noise-texture") ? "texture" : descriptor?.typeId.includes("math") ? "converter" : descriptor?.family === "shader" ? "shader" : "common";
const visible = (expression: VisibilityExpression | undefined, values: GraphNode["parameters"]): boolean => {
  if (!expression) return true;
  if ("all" in expression) return expression.all.every(item => visible(item, values));
  if ("any" in expression) return expression.any.some(item => visible(item, values));
  const value = (values[expression.parameter] as ParameterValue | undefined)?.value;
  return "equals" in expression ? value === expression.equals : expression.in.includes(value as string | number | boolean);
};
function cubic(a: Vec2, b: Vec2): readonly Vec2[] {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return Array.from({ length: G.linkSamples + 1 }, (_, index) => {
    const t = index / G.linkSamples, u = 1 - t;
    return { x: u ** 3 * a.x + 3 * u ** 2 * t * (a.x + dx) + 3 * u * t ** 2 * (b.x - dx) + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * b.y };
  });
}
function cubicBounds(p0:Vec2,p1:Vec2,p2:Vec2,p3:Vec2){const points=[p0,p3];for(const axis of ["x","y"] as const){const a=-p0[axis]+3*p1[axis]-3*p2[axis]+p3[axis],b=2*(p0[axis]-2*p1[axis]+p2[axis]),c=p1[axis]-p0[axis],d=b*b-4*a*c;const roots=Math.abs(a)<1e-12?(Math.abs(b)<1e-12?[]:[-c/b]):d<0?[]:[(-b+Math.sqrt(d))/(2*a),(-b-Math.sqrt(d))/(2*a)];for(const t of roots)if(t>0&&t<1){const u=1-t;points.push({x:u**3*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t**3*p3.x,y:u**3*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t**3*p3.y});}}return bounds(points);}
export function buildLayoutScene(document: GraphDocument): LayoutScene {
  const nodes = new Map<NodeId, LayoutNode>();
  const sockets = new Map<SocketId, LayoutSocket>();
  const links = new Map<LinkId, LayoutLink>();
  const controls = new Map<string, LayoutControl>();
  const sorted = Object.values(document.nodes).sort((a, b) => a.id.localeCompare(b.id));
  const effectiveMuted=effectivelyMutedLinks(document);
  const linksBySocket=new Map<string,LinkId[]>();for(const link of Object.values(document.links))if(!effectiveMuted.has(link.id))for(const id of [link.fromSocketId,link.toSocketId]){const list=linksBySocket.get(id)??[];list.push(link.id);linksBySocket.set(id,list);}
  const childrenByParent=new Map<string,GraphNode[]>();for(const node of sorted)if(node.parentId){const list=childrenByParent.get(node.parentId)??[];list.push(node);childrenByParent.set(node.parentId,list);}
  const origins=new Map<string,Vec2>(),depths=new Map<string,number>();const resolve=(node:GraphNode):Vec2=>{const known=origins.get(node.id);if(known)return known;const parent=node.parentId?document.nodes[node.parentId]:undefined,p=parent?resolve(parent):{x:0,y:0};depths.set(node.id,(parent?depths.get(parent.id)!+1:0));const at={x:p.x+node.position.x,y:p.y+node.position.y};origins.set(node.id,at);return at;};
  for (const node of sorted) {
    const at = resolve(node), kind = node.typeId === "fxnode.common.frame" ? "frame" : node.typeId === "fxnode.common.reroute" ? "reroute" : "node";
    const descriptor = node.known ? getDescriptor(node.typeId) : undefined;
    const descriptorSockets = new Map(descriptor?.sockets.map(item => [item.key, item]));
    const visibleSockets = node.sockets.filter(socket => {
      const socketDescriptor = descriptorSockets.get(socket.key);
      return socket.visible && visible(socketDescriptor?.visibleWhen, node.parameters);
    });
    const ui: readonly DescriptorUiItem[] = descriptor?.ui ?? [
      ...Object.keys(node.parameters).sort().map(key => ({ kind: "parameter" as const, key })),
      ...node.sockets.map(socket => ({ kind: "socket" as const, key: socket.key })),
    ];
    const expandedItems = kind === "node"
      ? ui.filter(item => visible(item.visibleWhen, node.parameters)).filter(item => item.kind !== "socket" || visibleSockets.some(socket => socket.key === item.key))
      : [];
    const visibleItems = node.collapsed ? [] : expandedItems;
    const contentHeight = kind === "frame"
      ? node.size.y
      : kind === "reroute"
      ? G.reroute * 2
      : node.collapsed
        ? G.header
        : G.header + visibleItems.reduce((sum, item) => sum+uiItemUnits(item,descriptor), 0) * G.row + G.gap;
    const minimumSize={x:kind==="reroute"?G.reroute*2:kind==="frame"?G.minWidth:minimumNodeWidth(descriptor,node,expandedItems),y:contentHeight};
    const width = kind === "reroute" ? G.reroute * 2 : kind==="frame"?node.size.x:Math.min(G.maxWidth,Math.max(minimumSize.x,node.size.x));
    const height=kind==="node"&&!node.collapsed?Math.max(contentHeight,node.size.y):contentHeight;
    const nodeBounds = { x: at.x, y: at.y, width, height };
    const rowBySocket = new Map<string,number>();
    let socketRowOffset=0;
    for(const item of visibleItems){
      if(item.kind==="socket")rowBySocket.set(item.key,socketRowOffset);
      socketRowOffset+=uiItemUnits(item,descriptor);
    }
    const layoutSockets: LayoutSocket[] = visibleSockets.map(socket => {
      const linkIds = linksBySocket.get(socket.id)??[];
      const linked = linkIds.length > 0;
      const row = rowBySocket.get(socket.key) ?? 0;
      return {
        id: socket.id,
        nodeId: node.id,
        label: title(socket.label),
        dataType: socket.dataType,
        direction: socket.direction,
        accepts: socket.accepts,
        capacity: socket.maxIncomingLinks,
        linkIds,
        linked,
        anchor: kind === "reroute"
          ? { x: at.x + G.reroute, y: at.y - G.reroute }
          : { x: at.x + (socket.direction === "output" ? width : 0), y: at.y - (node.collapsed ? G.half : G.header + G.half + row * G.row) },
      };
    });
    for (const socket of layoutSockets) sockets.set(socket.id, socket);
    const rows: LayoutRow[] = [];
    let rowOffset = 0;
    for (const item of visibleItems) {
      const parameterSchema = item.kind === "parameter" || item.kind === "resource" ? descriptor?.parameters[item.key] : undefined;
      const units = uiItemUnits(item,descriptor);
      const rowBounds: Rect = { x: at.x, y: at.y - G.header - rowOffset * G.row, width, height: units * G.row };
      if (item.kind === "header" || item.kind === "category" || item.kind === "section" || item.kind === "panel" || item.kind === "eyedropper") {
        rows.push({ kind: item.kind === "eyedropper" ? "placeholder" : item.kind, label: item.label, units, bounds: rowBounds });
        rowOffset += units;
        continue;
      }
      if (item.kind === "parameter" || item.kind === "resource") {
        const schema = descriptor?.parameters[item.key];
        const id = `${node.id}:parameter:${item.key}`;
        const controlBounds = schema?.type === "color-ramp" || schema?.type === "number" ? { x: at.x + 10, y: rowBounds.y - 3, width: width - 20, height: schema.type === "color-ramp" ? units * G.row - 6 : G.row - 6 } : { x: at.x + width * .42, y: rowBounds.y - 3, width: width * .53, height: G.row - 6 };
        const subfields = makeSubfields(controlBounds, schema?.type);
        const rampBounds = schema?.type === "color-ramp" ? {toolbar:{x:controlBounds.x,y:controlBounds.y,width:controlBounds.width,height:20},mode:{x:controlBounds.x,y:controlBounds.y-22,width:controlBounds.width*.3,height:20},interpolation:{x:controlBounds.x+controlBounds.width*.31,y:controlBounds.y-22,width:controlBounds.width*.4,height:20},hue:{x:controlBounds.x+controlBounds.width*.72,y:controlBounds.y-22,width:controlBounds.width*.28,height:20},gradient:{x:controlBounds.x+8,y:controlBounds.y-46,width:controlBounds.width-16,height:28},handles:{x:controlBounds.x+8,y:controlBounds.y-74,width:controlBounds.width-16,height:28},selector:{x:controlBounds.x,y:controlBounds.y-104,width:controlBounds.width*.25,height:20},position:{x:controlBounds.x+controlBounds.width*.27,y:controlBounds.y-104,width:controlBounds.width*.35,height:20},color:{x:controlBounds.x,y:controlBounds.y-126,width:controlBounds.width,height:20}} : undefined;
        const resourceBounds=item.kind==="resource"?{preview:{x:at.x+10,y:rowBounds.y-4,width:width-20,height:units*G.row-34},open:{x:at.x+10,y:rowBounds.y-units*G.row+26,width:width-20,height:22}}:undefined;
        const control: LayoutControl = { id, nodeId: node.id, source: descriptor ? "parameter" : "unknown", key: item.key, label: item.label ?? title(item.key), kind: item.kind === "resource" ? "resource" : controlKind(schema), value: node.parameters[item.key], ...(schema ? { schema } : {}), linked: false, bounds:item.kind==="resource"?resourceBounds!.open:controlBounds, subfields, numericFields:makeNumericFields(controlBounds,schema,subfields), ...(rampBounds?{rampBounds}:{}),...(resourceBounds?{resourceBounds}:{}) };
        controls.set(id, control);
        rows.push({ kind: "control", controlId: id, units, bounds: rowBounds });
      } else if (item.kind === "grading-wheels") {
        const gap=10,padding=10,columnWidth=(width-padding*2-gap*2)/3;
        const wheels=item.wheels.map((wheel,index)=>{const x=at.x+padding+index*(columnWidth+gap),scalarSchema=descriptor?.parameters[wheel.scalar],colorSchema=descriptor?.parameters[wheel.color],scalarId=`${node.id}:parameter:${wheel.scalar}`,colorId=`${node.id}:parameter:${wheel.color}`,labelBounds={x,y:rowBounds.y-4,width:columnWidth,height:18},plane={x:x+2,y:rowBounds.y-25,width:columnWidth-24,height:columnWidth-24},lightness={x:x+columnWidth-18,y:rowBounds.y-25,width:14,height:columnWidth-24},scalarBounds={x:x+2,y:rowBounds.y-25-(columnWidth-24)-10,width:columnWidth-6,height:18},colorBounds={x:plane.x,y:plane.y,width:lightness.x+lightness.width-plane.x,height:plane.height};controls.set(scalarId,{id:scalarId,nodeId:node.id,source:"parameter",key:wheel.scalar,label:wheel.label,kind:controlKind(scalarSchema),value:node.parameters[wheel.scalar],...(scalarSchema?{schema:scalarSchema}:{}),linked:false,bounds:scalarBounds,subfields:[],numericFields:makeNumericFields(scalarBounds,scalarSchema,[])});controls.set(colorId,{id:colorId,nodeId:node.id,source:"parameter",key:wheel.color,label:wheel.label,kind:controlKind(colorSchema),value:node.parameters[wheel.color],...(colorSchema?{schema:colorSchema}:{}),linked:false,bounds:colorBounds,subfields:[],numericFields:[],colorWheelBounds:{plane,lightness}});return{label:wheel.label,labelBounds,scalarControlId:scalarId,colorControlId:colorId};});
        rows.push({kind:"grading-wheels",wheels:wheels as unknown as Extract<LayoutRow,{kind:"grading-wheels"}>["wheels"],units,bounds:rowBounds});
      } else if (item.kind === "socket") {
        const raw = node.sockets.find(socket => socket.key === item.key);
        const socket = raw && sockets.get(raw.id);
        if (!raw || !socket) continue;
        const socketDescriptor=descriptorSockets.get(item.key),schema = socketDescriptor?.hideValue?undefined:socketDescriptor?.value;
        let controlId: string | undefined;
        if (schema && socket.direction === "input") {
          controlId = `${node.id}:socket:${socket.id}`;
          const controlBounds = schema.type === "number" ? { x: at.x + 12, y: rowBounds.y - 3, width: width - 24, height: G.row - 6 } : { x: at.x + width * .42, y: rowBounds.y - 3, width: width * .53, height: G.row - 6 };
          const subfields=makeSubfields(controlBounds,schema.type);
          controls.set(controlId, { id: controlId, nodeId: node.id, source: "socket-default", key: socket.id, label: item.label ?? socket.label, kind: controlKind(schema), value: raw.defaultValue, schema, linked: socket.linked, bounds: controlBounds, subfields, numericFields:makeNumericFields(controlBounds,schema,subfields) });
        }
        rows.push({ kind: "socket", socketId: socket.id, ...(controlId ? { controlId } : {}), units: 1, bounds: rowBounds });
      }
      rowOffset += units;
    }
    if (kind === "reroute" && layoutSockets[0]) {
      rows.push({ kind: "socket", socketId: layoutSockets[0].id, units: 1, bounds: nodeBounds });
    }
    const byKey=new Map(node.sockets.map(s=>[s.key,s.id]));const bypasses=node.muted?(descriptor?.muteBypass??[]).flatMap(([a,b])=>{const from=byKey.get(a),to=byKey.get(b),aa=from&&sockets.get(from)?.anchor,bb=to&&sockets.get(to)?.anchor;return aa&&bb?[{from:aa,to:bb}]:[];}):[];
    nodes.set(node.id, { id: node.id, ...(node.parentId ? { parentId: node.parentId } : {}), typeId: node.typeId, label: node.label, category: category(descriptor), kind, localPosition: node.position, worldPosition: at, authoredSize: node.size, minimumSize, bounds: nodeBounds, header: { x: at.x, y: at.y, width, height: kind === "reroute" ? 0 : G.header }, collapseHitRect: { x: at.x, y: at.y, width: 14, height: G.header }, resizeHitRect: { x: at.x + width - G.resize, y: at.y - height + G.resize, width: G.resize * 2, height: G.resize * 2 }, collapsed: node.collapsed, muted: node.muted, visible: true, rows, bypasses } satisfies LayoutNode);
  }
  // Frames are behind all regular nodes. Their authored size is expanded to contain direct children.
  for (const frame of sorted.filter(node => node.typeId === "fxnode.common.frame").sort((a, b) => depths.get(b.id)! - depths.get(a.id)!)) {
    const children = (childrenByParent.get(frame.id)??[]).map(node => nodes.get(node.id) as LayoutNode);
    if (children.length) { const childBounds = bounds(children.flatMap(child => [{ x: child.bounds.x, y: child.bounds.y }, { x: child.bounds.x + child.bounds.width, y: child.bounds.y - child.bounds.height }])); const current = nodes.get(frame.id) as LayoutNode; const fitted = { x: Math.min(current.bounds.x, childBounds.x - G.frameMargin), y: Math.max(current.bounds.y, childBounds.y + G.frameMargin), width: Math.max(current.bounds.x + current.bounds.width, childBounds.x + childBounds.width + G.frameMargin) - Math.min(current.bounds.x, childBounds.x - G.frameMargin), height: Math.max(current.bounds.y, childBounds.y + G.frameMargin) - Math.min(current.bounds.y - current.bounds.height, childBounds.y - childBounds.height - G.frameMargin) }; nodes.set(frame.id, { ...current, bounds: fitted, header: { ...fitted, height: G.header } }); }
  }
  for (const link of Object.values(document.links).sort((a, b) => a.id.localeCompare(b.id))) {
    const from = sockets.get(link.fromSocketId) as LayoutSocket | undefined, to = sockets.get(link.toSocketId) as LayoutSocket | undefined;
    if (!from || !to) continue;
    const points = cubic(from.anchor, to.anchor);
    const dx = Math.max(40, Math.abs(to.anchor.x - from.anchor.x) * 0.5);
    const cs=[{ x: from.anchor.x + dx, y: from.anchor.y }, { x: to.anchor.x - dx, y: to.anchor.y }] as const,linkBounds=cubicBounds(from.anchor,cs[0],cs[1],to.anchor);
    links.set(link.id, { id: link.id, fromNodeId: link.fromNodeId, fromSocketId: link.fromSocketId, toNodeId: link.toNodeId, toSocketId: link.toSocketId, dataType: from.dataType, points, controls: cs, bounds: linkBounds, visible: true, muted: effectiveMuted.has(link.id) } satisfies LayoutLink);
  }
  const allBounds = [...nodes.values()].map((node: LayoutNode) => node.bounds);
  const graphBounds = allBounds.length ? bounds(allBounds.flatMap(rect => [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y - rect.height }])) : { x: 0, y: 0, width: 0, height: 0 };
  const drawOrder = sorted.filter(node => node.typeId === "fxnode.common.frame").concat(sorted.filter(node => node.typeId !== "fxnode.common.frame")).map(node => node.id);
  return { nodes, sockets,controls, links, drawOrder, graphBounds,nodeRanks:new Map(drawOrder.map((id,i)=>[id,i])),linkRanks:new Map([...links.keys()].map((id,i)=>[id,i])) };
}
export function createLayoutView(scene:LayoutScene,transform:ViewTransform,nodeIds:readonly NodeId[]=scene.drawOrder,linkIds:readonly LinkId[]=[...scene.links.keys()]):LayoutView{const viewport={x:transform.center.x-transform.viewport.x/transform.zoom/2,y:transform.center.y+transform.viewport.y/transform.zoom/2,width:transform.viewport.x/transform.zoom,height:transform.viewport.y/transform.zoom};const ns=nodeIds.filter(id=>{const n=scene.nodes.get(id);return n&&intersects(n.bounds,viewport,G.margin);}).sort((a,b)=>(scene.nodeRanks.get(a)??0)-(scene.nodeRanks.get(b)??0)),ls=linkIds.filter(id=>{const l=scene.links.get(id);return l&&intersects(l.bounds,viewport,G.margin);}).sort((a,b)=>(scene.linkRanks.get(a)??0)-(scene.linkRanks.get(b)??0));return{...scene,drawOrder:ns,transform,candidateNodeIds:ns,candidateLinkIds:ls,totalNodes:scene.nodes.size,totalLinks:scene.links.size};}
export function layoutGraph(document:GraphDocument,transform:ViewTransform):LayoutSnapshot{return createLayoutView(buildLayoutScene(document),transform);}
export function applyNodeOrder<T extends LayoutSnapshot>(layout:T,order:readonly NodeId[]):T{const frames=layout.drawOrder.filter(id=>layout.nodes.get(id)?.kind==="frame"),ordinary=layout.drawOrder.filter(id=>layout.nodes.get(id)?.kind!=="frame"),available=new Set(ordinary),promoted=order.filter(id=>available.has(id)),raised=new Set(promoted);return{...layout,drawOrder:[...frames,...ordinary.filter(id=>!raised.has(id)),...promoted]};}
