import { placeNewNodes } from '../upstream/mcs-web/web/src/node-placement.ts';
import { coreRingArrangement } from '../upstream/mcs-web/web/src/network-order.ts';
import { layout as freeLayout } from '../upstream/mcs-web/web/src/network.ts';
import type { NetworkEdge, NetworkGraph } from '../upstream/mcs-web/web/src/network.ts';
import type { Content, ViewDocument } from './types';

export function links(content:Content,view:ViewDocument) {
  const selected=new Set(view.added);
  return [...content.actions.flatMap(a=>a.outputs.flatMap(o=>a.inputs.map(i=>({from:i.node,to:o.node,id:a.id})))),
    ...view.relations.flatMap(r=>r.inputs.map(id=>({from:id,to:r.output,id:r.id})))].filter(e=>selected.has(e.from)&&selected.has(e.to));
}

export function increment(content:Content,view:ViewDocument,added:string[]) {
  const next={...view,added:[...new Set([...view.added,...added])]};
  const pending=next.added.filter(id=>!view.positions[id]);
  const result=placeNewNodes({existing:view.added.filter(id=>view.positions[id]).map(id=>({id,...view.positions[id]})),pending,links:links(content,next),nodeWidth:172,nodeHeight:58});
  return {...next,positions:{...view.positions,...Object.fromEntries(result.placements)}};
}

export function arrange(content:Content,view:ViewDocument,preserve=true):ViewDocument {
  if(!view.added.length)return view;
  const ids=view.added, titles=new Map(content.nodes.map(n=>[n.id,n.title]));
  const edges:NetworkEdge[]=links(content,view).map((e,i)=>({source:'sharedInput',id:`layout-${i}`,from:e.from,to:e.to,note:e.id}));
  let positions:ViewDocument['positions']={};
  if(view.layout.mode==='logic') positions=Object.fromEntries(coreRingArrangement({ids,titles,edges,core:view.layout.anchor??ids[0]}).layout.placed.map(n=>[n.id,{x:n.x,y:n.y}]));
  else if(view.layout.mode==='learning' && view.route) {
    const depth=new Map(view.route.initial.map(id=>[id,0]));
    const events=new Map(view.route.events.map(e=>[e.id,e])), actions=new Map(content.actions.map(a=>[a.id,a]));
    for(const eid of view.route.linearExtensions[0]) {
      const e=events.get(eid)!,a=actions.get(e.actionId)!;
      const d=1+Math.max(0,...a.inputs.map(i=>depth.get(i.node)??0));
      for(const o of a.outputs) if(!depth.has(o.node)) depth.set(o.node,d);
    }
    const off=1+Math.max(0,...depth.values()), levels=new Map<number,string[]>();
    for(const id of ids){const d=depth.get(id)??off;levels.set(d,[...(levels.get(d)??[]),id]);}
    let y=30;
    for(const [,row]of [...levels].sort((a,b)=>a[0]-b[0])){
      row.forEach((id,c)=>{positions[id]={x:30+(c%8)*210,y:y+Math.floor(c/8)*95};});
      y+=Math.ceil(row.length/8)*95+45;
    }
  } else {
    // Reuse the site's deterministic force layout; only the display adapter is new.
    const graph={nodes:content.nodes,actions:content.actions,relations:[]} as unknown as NetworkGraph;
    positions=Object.fromEntries(freeLayout(graph,new Set(ids),['contract']).placed.map(n=>[n.id,{x:n.x,y:n.y}]));
  }
  if(preserve) {
    const fixed=view.locked.filter(id=>view.positions[id]).map(id=>({id,...view.positions[id]}));
    const pending=ids.filter(id=>!view.locked.includes(id));
    // Preserve the selected rule's positions when clear; place only actual collisions incrementally.
    const existing=[...fixed];
    for(const id of pending) {
      const p=positions[id];
      if(existing.some(q=>Math.abs(p.x-q.x)<190&&Math.abs(p.y-q.y)<78)) {
        const result=placeNewNodes({existing,pending:[id],links:links(content,view)});
        positions[id]=result.placements.get(id)!;
      }
      existing.push({id,...positions[id]});
    }
    for(const p of fixed) positions[p.id]={x:p.x,y:p.y};
  }
  return {...view,positions,locked:preserve?view.locked:[]};
}
