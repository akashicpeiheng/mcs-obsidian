import {forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useId,useState} from 'react';
import {MotionEngine,adaptiveCards,labelPlacements,type Positions} from './motion';
import {links} from './graph';
import {ActionRenderer} from './ActionRenderer';
import {readPalette,paletteKey,type CanvasPalette} from './palette';
import {relationState} from './core.mjs';
import type {Content,ViewDocument,CheckReport,Relation} from './types';

type Camera=ViewDocument['camera'];
export interface GraphSnapshot {positions:Positions;camera:Camera}
export interface GraphApi {snapshot:()=>GraphSnapshot;stop:()=>GraphSnapshot;fit:()=>void;focus:(id:string)=>void;seed:(next:ViewDocument)=>ViewDocument}
export interface GraphCommand {epoch:number;kind:'grow'|'arrange'|'restore'}
export interface LearningDisplay {visible:string[];uses:string[];added:string[];missing:string[];actionId:string|null;step:number;playing:boolean;speed:number}
interface Props {
  content:Content;view:ViewDocument;selected:string|null;known:string[];reports:Map<string,CheckReport>;command:GraphCommand;
  learning:LearningDisplay|null;onSelect:(id:string)=>void;onRead:(id:string)=>void;onRemove:(id:string)=>void;onEdit:(r:Relation)=>void;
  onBegin:()=>void;onCommit:(snapshot:GraphSnapshot,locked?:string[])=>void;onRunning:(running:boolean)=>void;
}
interface Edge {id:string;inputs:string[];output:string;title:string;formal:Relation|null;state:string}
interface EdgeElements {root:SVGGElement;path:SVGPathElement;junction:SVGGElement;arrow:SVGPolygonElement}
interface ActionShape {inputs:{x:number;y:number}[];joint:{x:number;y:number};end:{x:number;y:number};jointInputs:number}
const batchKinds=['idle','focused','dimmed','active','failed'] as const;
type BatchKind=typeof batchKinds[number];

const round=(n:number)=>Math.round(n*10)/10;
const ease=(t:number)=>1-(1-t)**3;
const attributes=new WeakMap<Element,Map<string,string>>();
function attr(el:Element,key:string,value:string){let last=attributes.get(el);if(!last){last=new Map();attributes.set(el,last);}if(last.get(key)!==value){el.setAttribute(key,value);last.set(key,value);}}
type StyleKey='display'|'opacity'|'strokeOpacity'|'fillOpacity'|'fontSize'|'transform'|'strokeWidth';
const styles=new WeakMap<SVGElement,Partial<Record<StyleKey,string>>>();
function style(el:SVGElement,key:StyleKey,value:string){let last=styles.get(el);if(!last){last={};styles.set(el,last);}if(last[key]!==value){el.style[key]=value;last[key]=value;}}
function transform(el:SVGElement,x:number,y:number,scale=1,angle=0){const a=Math.cos(angle)*scale,b=Math.sin(angle)*scale;style(el,'transform',`matrix(${a},${b},${-b},${a},${round(x)},${round(y)})`);}
function titleLines(title:string){const lines:string[]=[];let line='',width=0;for(const ch of title){const w=/[\x00-\x7f]/.test(ch)?.55:1;if(width+w>14){lines.push(line);line='';width=0;}line+=ch;width+=w;}if(line)lines.push(line);return lines;}
function checkCaption(states:string[],fallback:string){
  if(!states.length)return fallback;
  for(const [state,label]of [['stale','含已过期证据'],['failed','含被拒绝的证书'],['error','检查运行失败'],['timeout','检查搜索超时'],['undecided','尚未得到证明'],['unsupported','含不支持的检查']])if(states.includes(state))return label;
  const passed=states.filter(s=>s==='verified'||s==='alignment-pending').length;
  return passed?`${passed}/${states.length} 关系通过${states.includes('alignment-pending')?' · 对应待审阅':''}`:'关系待检查';
}

export const GraphCanvas=forwardRef<GraphApi,Props>(function GraphCanvas(props,ref){
  const uid=useId().replace(/[^a-zA-Z0-9-]/g,''),latest=useRef(props);latest.current=props;
  const svg=useRef<SVGSVGElement>(null),group=useRef<SVGGElement>(null),focusLayer=useRef<SVGGElement>(null),focusDraw=useRef<{key:string;shape:SVGGElement}|null>(null),nodes=useRef(new Map<string,SVGGElement>()),edgeEls=useRef(new Map<string,EdgeElements>());
  const actionRenderer=useRef<ActionRenderer|null>(null),actionCanvas=useRef<HTMLCanvasElement>(null),actionPalette=useRef<CanvasPalette|null>(null),actionHits=useRef<{x:number;y:number;title:string}[]>([]),actionTitle=useRef<Element|null>(null);
  const engine=useRef<MotionEngine|null>(null);if(!engine.current)engine.current=new MotionEngine();
  const camera=useRef({...props.view.camera}),size=useRef({width:800,height:700}),frame=useRef<number|null>(null),lastFrame=useRef(0);
  const motionDirty=useRef(false),running=useRef(false),paneVisible=useRef(true),reduced=useRef(false),cards=useRef(false);
  const hover=useRef<string|null>(null);
  const [focusedHover,setFocusedHover]=useState<string|null>(null),[expanded,setExpanded]=useState(false),expandedRef=useRef(false);
  const transition=useRef<{from:Positions;to:Positions;start:number;duration:number}|null>(null);
  const cameraTransition=useRef<{from:Camera;to:Camera;start:number;duration:number}|null>(null);
  const replay=useRef({step:-1,elapsed:0});
  const drag=useRef<{id:string|null;x:number;y:number;px:number;py:number;moved:boolean;shift:boolean}|null>(null),wheelTimer=useRef<ReturnType<typeof setTimeout>|null>(null),wheelActive=useRef(false);
  const topology=useRef(''),lastCommand=useRef(-1),geometryDirty=useRef(true);
  const visible=new Set(props.learning?.visible??props.view.added),routeActions=props.learning?new Set(props.view.route?.events.map(e=>e.actionId)??[]):null;
  const edges:Edge[]=[];
  if(props.view.showActions)for(const a of props.content.actions){if(routeActions&&!routeActions.has(a.id))continue;for(const output of a.outputs)if(visible.has(output.node)&&a.inputs.length&&a.inputs.every(i=>visible.has(i.node)))edges.push({id:`a:${a.id}:${output.node}`,inputs:a.inputs.map(i=>i.node),output:output.node,title:`${a.title}：全部前提共同输入；${a.witness.status}`,formal:null,state:a.id});}
  if(props.view.showRelations)for(const r of props.view.relations)if(visible.has(r.output)&&r.inputs.every(id=>visible.has(id)))edges.push({id:`r:${r.id}`,inputs:r.inputs,output:r.output,title:r.explanation,formal:r,state:relationState(r,props.content,props.reports,props.view)});
  const edgeData=useRef(edges);edgeData.current=edges;
  const names=useRef(new Map(props.content.nodes.map(n=>[n.id,n])));names.current=new Map(props.content.nodes.map(n=>[n.id,n]));

  function notifyRunning(value:boolean){if(running.current!==value){running.current=value;latest.current.onRunning(value);}svg.current?.setAttribute('data-motion',value?'running':'idle');}
  function snapshot():GraphSnapshot{return {positions:engine.current!.positions(),camera:{...camera.current}};}
  function commit(locked?:string[]){motionDirty.current=false;notifyRunning(false);latest.current.onCommit(snapshot(),locked);}
  function cancelFrame(){if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;lastFrame.current=0;}
  function stop(){
    cancelFrame();engine.current!.stop();
    transition.current=null;cameraTransition.current=null;
    if(wheelTimer.current)clearTimeout(wheelTimer.current);wheelTimer.current=null;wheelActive.current=false;
    motionDirty.current=false;notifyRunning(false);geometryDirty.current=true;paint();return snapshot();
  }
  function applyPositions(ps:Positions){for(const n of engine.current!.nodes){const p=ps[n.id];if(p){n.x=p.x+86;n.y=p.y+29;n.vx=0;n.vy=0;}}}
  function active(){const p=latest.current,learn=p.learning;return !!transition.current||!!cameraTransition.current||(!learn&&p.view.layout.mode==='free'&&p.view.display.motion==='auto'&&!reduced.current&&engine.current!.active)||(!reduced.current&&!!learn?.playing&&replay.current.elapsed<1050/learn.speed);}
  function schedule(){if(frame.current===null&&paneVisible.current&&!document.hidden)frame.current=requestAnimationFrame(tick);}
  function tick(now:number){
    frame.current=null;
        const dt=lastFrame.current?Math.min(50,now-lastFrame.current):16;lastFrame.current=now;
    const learn=latest.current.learning;
    if(transition.current){const t=transition.current,s=ease(Math.min(1,(now-t.start)/t.duration)),ps:Positions={};for(const id of Object.keys(t.to)){const a=t.from[id]??t.to[id],b=t.to[id];ps[id]={x:a.x+(b.x-a.x)*s,y:a.y+(b.y-a.y)*s};}applyPositions(ps);if(s===1){transition.current=null;if(!learn&&latest.current.view.layout.mode==='free'&&latest.current.view.display.motion==='auto'&&!reduced.current)engine.current!.reheat();}geometryDirty.current=true;}
    else if(!learn&&latest.current.view.layout.mode==='free'&&latest.current.view.display.motion==='auto'&&!reduced.current&&engine.current!.active){engine.current!.step();geometryDirty.current=true;}
    if(cameraTransition.current){const t=cameraTransition.current,s=ease(Math.min(1,(now-t.start)/t.duration));camera.current={x:t.from.x+(t.to.x-t.from.x)*s,y:t.from.y+(t.to.y-t.from.y)*s,scale:t.from.scale+(t.to.scale-t.from.scale)*s};if(s===1)cameraTransition.current=null;geometryDirty.current=true;}
    if(learn?.playing&&!reduced.current){replay.current.elapsed+=dt;geometryDirty.current=true;}
    paint();
    if(active())schedule();else{lastFrame.current=0;if(motionDirty.current&&!drag.current)commit();else if(!drag.current)notifyRunning(false);}
  }
  function paint(){
    const el=svg.current,g=group.current;if(!el||!g)return;
    const c=camera.current,ps=engine.current!.positions(),p=latest.current,learn=p.learning;
    cards.current=adaptiveCards(cards.current,c.scale);if(cards.current!==expandedRef.current){expandedRef.current=cards.current;setExpanded(cards.current);}attr(el,'data-lod',cards.current?'cards':'dots');
    const measured=el as SVGSVGElement&{mcsPaintCount?:number;mcsLastPaint?:number};measured.mcsPaintCount=(measured.mcsPaintCount??0)+1;measured.mcsLastPaint=performance.now();
    const duration=learn?1050/learn.speed:1050;
    const stage=!learn||reduced.current?2:Math.min(2,Math.floor(replay.current.elapsed/(duration/3)));
    attr(el,'data-phase',['premises','relation','conclusion'][stage]);
    transform(g,c.x,c.y,c.scale);
    const h=hover.current,related=new Set<string>();
    if(h){related.add(h);for(const edge of edgeData.current)if(edge.inputs.includes(h)||edge.output===h)for(const id of [...edge.inputs,edge.output])related.add(id);}
    const shown=new Set(learn?.visible??p.view.added),used=new Set(learn?.uses??[]),fresh=new Set(learn?.added??[]),missing=new Set(learn?.missing??[]),labels:{id:string;x:number;y:number;title:string;priority:boolean}[]=[];
    for(const [id,node]of nodes.current){const pos=ps[id];if(!pos)continue;const x=c.x+(pos.x+86)*c.scale,y=c.y+(pos.y+29)*c.scale,focused=id===p.selected||id===h;
      const inView=x>-190&&x<size.current.width+190&&y>-70&&y<size.current.height+70;
      style(node,'display',shown.has(id)&&inView&&!(learn&&fresh.has(id)&&stage<2)?'':'none');
      transform(node,pos.x+86,pos.y+29);
      node.classList.toggle('selected',id===p.selected);node.classList.toggle('used',used.has(id));node.classList.toggle('new',fresh.has(id)&&stage===2&&missing.size===0);node.classList.toggle('missing',missing.has(id));node.classList.toggle('blocked',fresh.has(id)&&stage===2&&missing.size>0);
      style(node,'opacity',h&&!related.has(id)?'0.18':'1');
      const card=node.querySelector<SVGGElement>('.mcs-node-card'),dot=node.querySelector<SVGCircleElement>('.mcs-node-circle'),label=node.querySelector<SVGTextElement>('.mcs-node-label');
      if(card){style(card,'display',cards.current||focused?'':'none');transform(card,0,0,focused?Math.max(1,1/c.scale):1);}
      if(dot){style(dot,'display',cards.current||focused?'none':'');transform(dot,0,0,1/c.scale);}
      if(label&&!cards.current&&!focused&&shown.has(id)&&inView&&(!h||related.has(id)))labels.push({id,x,y,title:names.current.get(id)?.title??id,priority:false});
    }
    const placed=labelPlacements(labels,size.current.width,size.current.height);
    for(const [id,node]of nodes.current){const label=node.querySelector<SVGTextElement>('.mcs-node-label'),n=ps[id],pos=placed.get(id);if(label){style(label,'display',pos?'':'none');if(pos&&n){attr(label,'x',String(round(pos.x-c.x-(n.x+86)*c.scale)));attr(label,'y',String(round(pos.y-c.y-(n.y+29)*c.scale)));transform(label,0,0,1/c.scale);style(label,'fontSize','11px');}}}
    const batchData=new Map(batchKinds.map(k=>[k,[] as ActionShape[]]));actionHits.current=[];
    for(const edge of edgeData.current){const dom=edgeEls.current.get(edge.id),to=ps[edge.output],inputs=edge.inputs.map(id=>ps[id]);if(!to||inputs.some(v=>!v))continue;
      const ends=[...inputs,to],minX=Math.min(...ends.map(v=>c.x+(v.x+86)*c.scale)),maxX=Math.max(...ends.map(v=>c.x+(v.x+86)*c.scale)),minY=Math.min(...ends.map(v=>c.y+(v.y+29)*c.scale)),maxY=Math.max(...ends.map(v=>c.y+(v.y+29)*c.scale));
      const outside=maxX<-100||minX>size.current.width+100||maxY<-100||minY>size.current.height+100;if(dom)style(dom.root,'display',outside?'none':'');if(outside)continue;
      const mean={x:inputs.reduce((s,v)=>s+v.x+86,0)/inputs.length,y:inputs.reduce((s,v)=>s+v.y+29,0)/inputs.length},target={x:to.x+86,y:to.y+29};
      const j={x:(mean.x+target.x)/2,y:(mean.y+target.y)/2};
      // A midpoint can coincide with one of the premises in a vertical route.
      // Put joint premises beside the flow so the ∧ remains visible.
      if(inputs.length>1){const dx=target.x-mean.x,dy=target.y-mean.y,length=Math.max(.001,Math.hypot(dx,dy));j.x-=dy/length*30/c.scale;j.y+=dx/length*30/c.scale;}
      const dx=target.x-j.x,dy=target.y-j.y,dist=Math.max(.001,Math.hypot(dx,dy)),focused=edge.output===p.selected||edge.output===h,card=cards.current||focused;
      const factor=focused?Math.max(1,1/c.scale):1,halfW=86*factor,halfH=(29+(titleLines(names.current.get(edge.output)?.title??'').length-1)*7)*factor;
      const trim=card?Math.min(halfW/Math.max(.001,Math.abs(dx)),halfH/Math.max(.001,Math.abs(dy))):6/(c.scale*dist),t=Math.min(.9,trim);
      const end={x:target.x-dx*t,y:target.y-dy*t};
      const highlighted=!!learn&&edge.state===learn.actionId;
      if(!edge.formal){
        const kind:BatchKind=highlighted&&stage>=1?(missing.size?'failed':'active'):h?edge.inputs.includes(h)||edge.output===h?'focused':'dimmed':'idle',batch=batchData.get(kind)!;
        batch.push({inputs:inputs.map(v=>({x:v.x+86,y:v.y+29})),joint:j,end,jointInputs:edge.inputs.length});
        actionHits.current.push({x:c.x+j.x*c.scale,y:c.y+j.y*c.scale,title:edge.title});continue;
      }
      if(!dom)continue;attr(dom.path,'d',inputs.map(v=>`M${round(v.x+86)},${round(v.y+29)}L${round(j.x)},${round(j.y)}`).join('')+`M${round(j.x)},${round(j.y)}L${round(end.x)},${round(end.y)}`);
      transform(dom.arrow,end.x,end.y,1/c.scale,Math.atan2(end.y-j.y,end.x-j.x));
      const junctionScale=Math.max(1,.7/c.scale);transform(dom.junction,j.x,j.y,junctionScale);
      dom.root.classList.toggle('replay-active',highlighted&&stage>=1);dom.root.classList.toggle('replay-failed',highlighted&&missing.size>0);
      // Group opacity allocates a separate surface spanning the whole joint edge.
      // Apply alpha to its primitives instead, preserving the joint structure.
      const opacity=h&&!edge.inputs.includes(h)&&edge.output!==h?'0.08':highlighted?(stage>=1?'1':'0.25'):h?'1':'0.55';
      style(dom.root,'opacity','');style(dom.path,'opacity','1');style(dom.path,'strokeOpacity',opacity);style(dom.arrow,'opacity','1');style(dom.arrow,'fillOpacity',opacity);style(dom.junction,'opacity','1');style(dom.junction,'fillOpacity',opacity);style(dom.junction,'strokeOpacity',opacity);
    }
    const canvas=actionCanvas.current;if(canvas&&!actionRenderer.current)actionRenderer.current=new ActionRenderer(canvas,()=>paint());
    // 四个令牌一次读齐，SVG 表现属性与两条绘制路径共用同一份取值；
    // 主题切换由下方 MutationObserver 置空这个缓存，下一帧重新读。
    if(!actionPalette.current)actionPalette.current=readPalette(el);
    const gpu=actionRenderer.current?.draw(batchData,c,size.current,actionPalette.current);
    const ctx=!gpu?canvas?.getContext('2d'):null;if(canvas&&ctx){
      // Keep text and editable relations vector sharp. The action layer uses one
      // pixel per CSS unit while moving, then restores display density at rest.
      const moving=!!drag.current||wheelActive.current||!!transition.current||!!cameraTransition.current||(!learn&&engine.current!.active),ratio=Math.min(window.devicePixelRatio||1,moving?1:2),w=Math.max(1,Math.round(size.current.width*ratio)),height=Math.max(1,Math.round(size.current.height*ratio));
      if(canvas.width!==w||canvas.height!==height){canvas.width=w;canvas.height=height;}
      const palette=actionPalette.current!;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w/ratio,height/ratio);ctx.translate(round(c.x),round(c.y));ctx.scale(c.scale,c.scale);
      let count=0;for(const [kind,shapes]of batchData){const emphasized=kind==='active'||kind==='failed',color=kind==='failed'?palette.failure:kind==='active'?palette.accent:palette.neutral,alpha=kind==='dimmed'?.08:kind==='idle'?.55:1;
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=(emphasized?2.5:1.25)/c.scale;
        count+=shapes.length;
        for(let start=0;start<shapes.length;start+=24){const part=shapes.slice(start,start+24);ctx.globalAlpha=alpha;ctx.lineWidth=(emphasized?2.5:1.25)/c.scale;ctx.beginPath();
          for(const shape of part){const j=shape.joint;for(const p of shape.inputs){ctx.moveTo(p.x,p.y);ctx.lineTo(j.x,j.y);}ctx.moveTo(j.x,j.y);ctx.lineTo(shape.end.x,shape.end.y);}ctx.stroke();
          const radius=8*Math.max(1,.7/c.scale);ctx.beginPath();for(const shape of part){const j=shape.joint;ctx.moveTo(j.x+radius,j.y);ctx.arc(j.x,j.y,radius,0,Math.PI*2);}ctx.globalAlpha=1;ctx.fillStyle=palette.background;ctx.fill();ctx.globalAlpha=alpha;ctx.lineWidth=1/c.scale;ctx.stroke();
          ctx.fillStyle=color;ctx.lineWidth=1.2/c.scale;ctx.beginPath();for(const shape of part){const j=shape.joint,factor=radius/8;if(shape.jointInputs>1){ctx.moveTo(j.x-3*factor,j.y+3*factor);ctx.lineTo(j.x,j.y-3*factor);ctx.lineTo(j.x+3*factor,j.y+3*factor);}else{ctx.moveTo(j.x-factor,j.y);ctx.lineTo(j.x+factor,j.y);}}ctx.stroke();
          ctx.beginPath();for(const shape of part){const j=shape.joint,end=shape.end,distance=Math.max(.001,Math.hypot(end.x-j.x,end.y-j.y)),ux=(end.x-j.x)/distance,uy=(end.y-j.y)/distance,len=7/c.scale,halfWidth=3/c.scale;ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-ux*len-uy*halfWidth,end.y-uy*len+ux*halfWidth);ctx.lineTo(end.x-ux*len+uy*halfWidth,end.y-uy*len-ux*halfWidth);ctx.closePath();}ctx.fill();
        }
      }ctx.globalAlpha=1;attr(canvas,'data-edge-count',String(count));canvas.dataset.palette=paletteKey(palette);canvas.dataset.renderer='canvas';
    }
    // Never reparent React-owned nodes: doing so can generate recursive hover events.
    // Copy card content only when it changes. A use reference would rebuild a shadow
    // subtree whenever its moving source changes, which is costly in the host SVG engine.
    const front=nodes.current.get(h??p.selected??'');if(focusLayer.current){
      style(focusLayer.current,'display',front&&front.style.display!=='none'?'':'none');
      if(front){const key=front.id+front.textContent;
        if(focusDraw.current?.key!==key){const shape=front.cloneNode(true) as SVGGElement;for(const el of [shape,...Array.from(shape.querySelectorAll('*'))])for(const attr of ['id','tabindex','role','aria-labelledby','data-node-id'])el.removeAttribute(attr);focusLayer.current.replaceChildren(shape);focusDraw.current={key,shape};}
        const shape=focusDraw.current!.shape;style(shape,'transform',front.style.transform);attr(shape,'class',front.getAttribute('class')!.replace('mcs-card','mcs-focus-card'));style(shape,'display','');style(shape,'opacity','1');shape.style.pointerEvents='none';
        const card=shape.querySelector<SVGGElement>('.mcs-node-card');if(card){style(card,'display','');transform(card,0,0,Math.max(1,1/c.scale));}shape.querySelector<SVGCircleElement>('.mcs-node-circle')!.style.display='none';shape.querySelector<SVGTextElement>('.mcs-node-label')!.style.display='none';
      }
    }
    geometryDirty.current=false;
  }

  useLayoutEffect(()=>{
    const p=latest.current,key=JSON.stringify([p.view.added,p.view.locked,links(p.content,p.view)]),changed=key!==topology.current,commandChanged=p.command.epoch!==lastCommand.current;
    const old=engine.current!.positions();
    if(changed||commandChanged){
      const kind=commandChanged?p.command.kind:null;
      engine.current!.sync(p.view.added,p.view.positions,p.view.locked,links(p.content,p.view),kind==='restore'||!topology.current);
      if(kind==='arrange'&&!reduced.current&&p.view.display.motion==='auto'&&Object.keys(old).length){engine.current!.stop();applyPositions(old);transition.current={from:old,to:p.view.positions,start:performance.now(),duration:380};motionDirty.current=true;notifyRunning(true);}
      else if((kind==='grow'||(changed&&topology.current))&&!p.learning&&p.view.layout.mode==='free'&&p.view.display.motion==='auto'&&!reduced.current){engine.current!.reheat();motionDirty.current=true;notifyRunning(true);}
      else if(kind==='arrange'||kind==='restore'){engine.current!.sync(p.view.added,p.view.positions,p.view.locked,links(p.content,p.view),true);engine.current!.stop();transition.current=null;}
      topology.current=key;lastCommand.current=p.command.epoch;
    }
    if(p.learning||p.view.display.motion==='off'||reduced.current){engine.current!.stop();if(!transition.current&&motionDirty.current)commit();}
    if(p.learning?.playing&&transition.current){applyPositions(transition.current.to);transition.current=null;commit();}
    if(!cameraTransition.current&&!drag.current&&!wheelActive.current)camera.current={...p.view.camera};
    if(p.learning&&replay.current.step!==p.learning.step){replay.current={step:p.learning.step,elapsed:p.learning.playing&&!reduced.current?0:1050/p.learning.speed};}
    paint();if(active())schedule();
  });
  useEffect(()=>{
    const el=svg.current!;const media=matchMedia('(prefers-reduced-motion: reduce)');
    const preference=()=>{reduced.current=media.matches;if(media.matches){if(transition.current)applyPositions(transition.current.to);if(cameraTransition.current)camera.current={...cameraTransition.current.to};const state=stop();latest.current.onCommit(state);}else paint();};preference();media.addEventListener('change',preference);
    const resize=new ResizeObserver(entries=>{const b=entries[0]?.contentRect;if(b){size.current={width:b.width,height:b.height};paint();}});resize.observe(el);
    // Obsidian 在 body 上切换 theme-dark / theme-light；置空配色缓存后下一帧重读令牌，
    // WebGL 层的 paletteKey 也随之改变并重建色值，SVG 侧因为走 CSS 变量自动跟随。
    const theme=new MutationObserver(()=>{actionPalette.current=null;paint();});theme.observe(document.body,{attributes:true,attributeFilter:['class']});
    const visibility=new IntersectionObserver(entries=>{paneVisible.current=entries[0]?.isIntersecting??false;if(!paneVisible.current)cancelFrame();else if(active())schedule();});visibility.observe(el);
    const visibleDocument=()=>{if(document.hidden)cancelFrame();else if(active())schedule();};document.addEventListener('visibilitychange',visibleDocument);
    const wheel=(e:WheelEvent)=>{e.preventDefault();if(!wheelActive.current){latest.current.onBegin();wheelActive.current=true;}cameraTransition.current=null;const b=el.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top,c=camera.current,s=Math.max(.15,Math.min(4,c.scale*Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002)));camera.current={scale:s,x:x-(x-c.x)*s/c.scale,y:y-(y-c.y)*s/c.scale};if(drag.current?.id&&drag.current.moved){const pos=engine.current!.positions()[drag.current.id];drag.current={...drag.current,x:e.clientX,y:e.clientY,px:pos.x,py:pos.y};}schedule();if(wheelTimer.current)clearTimeout(wheelTimer.current);wheelTimer.current=setTimeout(()=>{wheelActive.current=false;if(!drag.current&&!active())commit();else{motionDirty.current=true;notifyRunning(true);schedule();}},180);};
    el.addEventListener('wheel',wheel,{passive:false});
    return()=>{cancelFrame();engine.current!.stop();actionRenderer.current?.dispose();actionRenderer.current=null;if(wheelTimer.current)clearTimeout(wheelTimer.current);resize.disconnect();theme.disconnect();visibility.disconnect();media.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibleDocument);el.removeEventListener('wheel',wheel);};
  },[]);
  function moveCamera(to:Camera,remember=true){if(remember)latest.current.onBegin();motionDirty.current=true;if(reduced.current||latest.current.view.display.motion==='off'){camera.current=to;paint();commit();}else{cameraTransition.current={from:{...camera.current},to,start:performance.now(),duration:320};notifyRunning(true);schedule();}}
  useImperativeHandle(ref,()=>({snapshot,stop,fit(){const state=stop(),ps=Object.values(state.positions);if(!ps.length)return;const el=svg.current!,area=el.parentElement!,box=el.getBoundingClientRect(),toolbar=area.querySelector('.mcs-canvas-toolbar')?.getBoundingClientRect(),top=toolbar?toolbar.bottom-box.top+16:20;const overlays=Array.from(area.querySelectorAll('.mcs-player,.mcs-selection,.mcs-canvas-foot')).map(v=>v.getBoundingClientRect()),bottom=Math.min(box.height-20,...overlays.map(b=>b.top-box.top-16)),hAvail=Math.max(100,bottom-top);const x=Math.min(...ps.map(p=>p.x+86)),y=Math.min(...ps.map(p=>p.y+29)),w=Math.max(...ps.map(p=>p.x+86))-x,h=Math.max(...ps.map(p=>p.y+29))-y,maxHeight=Math.max(58,...latest.current.view.added.map(id=>58+(titleLines(names.current.get(id)?.title??'').length-1)*14));const s=Math.max(.15,Math.min(1.4,(box.width-48-172)/Math.max(1,w),(box.width-48)/Math.max(1,w+172),(hAvail-32-maxHeight)/Math.max(1,h),(hAvail-32)/Math.max(1,h+maxHeight)));moveCamera({x:box.width/2-(x+w/2)*s,y:top+hAvail/2-(y+h/2)*s,scale:s});},focus(id){const p=engine.current!.positions()[id]??latest.current.view.positions[id];if(p){const s=Math.max(.9,camera.current.scale);moveCamera({scale:s,x:size.current.width/2-(p.x+86)*s,y:size.current.height/2-(p.y+29)*s},false);}},seed(next){const existing=engine.current!.positions(),allLinks=links(latest.current.content,next),positions={...next.positions,...existing};let index=0;for(const id of next.added)if(!engine.current!.byId.has(id)){const neighbors=allLinks.flatMap(l=>l.from===id?[l.to]:l.to===id?[l.from]:[]).map(n=>existing[n]).filter(Boolean),angle=index++*2.399;const center=neighbors.length?{x:neighbors.reduce((s,n)=>s+n.x,0)/neighbors.length,y:neighbors.reduce((s,n)=>s+n.y,0)/neighbors.length}:{x:(size.current.width/2-camera.current.x)/camera.current.scale-86,y:(size.current.height/2-camera.current.y)/camera.current.scale-29};positions[id]={x:center.x+Math.cos(angle)*90,y:center.y+Math.sin(angle)*90};}return {...next,positions};}}));

  function pointerDown(e:React.PointerEvent,id:string|null){if(e.button!==0)return;if(id){latest.current.onSelect(id);if(latest.current.learning)return;}const n=id?engine.current!.positions()[id]:camera.current;if(!n)return;drag.current={id,x:e.clientX,y:e.clientY,px:n.x,py:n.y,moved:false,shift:e.shiftKey};svg.current!.setPointerCapture(e.pointerId);e.stopPropagation();}
  function pointerMove(e:React.PointerEvent){const d=drag.current;if(!d){const b=svg.current!.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top,hit=actionHits.current.find(h=>Math.hypot(h.x-x,h.y-y)<12);if(actionTitle.current&&actionTitle.current.textContent!==(hit?.title??'联合行动：所有前提共同输入'))actionTitle.current.textContent=hit?.title??'联合行动：所有前提共同输入';return;}const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.moved&&Math.abs(dx)+Math.abs(dy)<3)return;if(!d.moved){latest.current.onBegin();d.moved=true;motionDirty.current=true;notifyRunning(true);if(d.id)engine.current!.beginDrag(d.id);}if(d.id){engine.current!.drag(d.id,{x:d.px+dx/camera.current.scale,y:d.py+dy/camera.current.scale});if(latest.current.view.layout.mode==='free'&&latest.current.view.display.motion==='auto'&&!reduced.current)schedule();}else{cameraTransition.current=null;camera.current={...camera.current,x:d.px+dx,y:d.py+dy};}schedule();}
  function pointerUp(){const d=drag.current;if(!d)return;drag.current=null;if(!d.moved)return;if(d.id){const fixed=d.shift||latest.current.view.locked.includes(d.id),locked=fixed?[...new Set([...latest.current.view.locked,d.id])]:latest.current.view.locked;engine.current!.endDrag(d.id,fixed);latest.current.onCommit(snapshot(),locked);if(latest.current.view.layout.mode==='free'&&latest.current.view.display.motion==='auto'&&!reduced.current){motionDirty.current=true;schedule();}else{engine.current!.stop();commit(locked);}}else commit();}
  function hoverNode(id:string|null){hover.current=id;setFocusedHover(id);schedule();}
  return <><canvas ref={actionCanvas} className="mcs-actions-canvas" aria-hidden="true"/><svg ref={svg} className="mcs-graph" role="application" aria-labelledby={`${uid}-graph-title`} data-motion="idle" onPointerDown={e=>pointerDown(e,null)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={e=>{if(e.target===e.currentTarget&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){e.preventDefault();const c=camera.current,delta=e.shiftKey?120:40;moveCamera({...c,x:c.x+(e.key==='ArrowLeft'?delta:e.key==='ArrowRight'?-delta:0),y:c.y+(e.key==='ArrowUp'?delta:e.key==='ArrowDown'?-delta:0),scale:Math.max(.15,Math.min(4,c.scale*(e.key==='+'?1.2:e.key==='-'?1/1.2:1)))});}}} tabIndex={0}>
    <title id={`${uid}-graph-title`}>数学关系网络</title><defs><pattern id={`${uid}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="currentColor"/></pattern></defs><rect width="100%" height="100%" fill={`url(#${uid}-grid)`} className="mcs-grid"><title ref={el=>{actionTitle.current=el;}}>联合行动：所有前提共同输入</title></rect>
    <g ref={group}>
      {edges.filter(edge=>edge.formal).map(edge=><g key={edge.id} ref={el=>{if(el)edgeEls.current.set(edge.id,{root:el,path:el.querySelector('path')!,junction:el.querySelector('.mcs-junction')!,arrow:el.querySelector('.mcs-edge-arrow')!});else edgeEls.current.delete(edge.id);}} className={edge.formal?`mcs-formal-edge ${edge.state}`:'mcs-hyperedge'} role={edge.formal?'button':undefined} tabIndex={edge.formal?0:undefined} aria-labelledby={`${uid}-edge-${edge.id}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>{if(edge.formal)latest.current.onEdit(edge.formal);}} onKeyDown={e=>{if(edge.formal&&(e.key==='Enter'||e.key===' ')){e.preventDefault();latest.current.onEdit(edge.formal);}}}><title id={`${uid}-edge-${edge.id}`}>{edge.title} · {edge.formal?edge.state:''}</title><path fill="none"/><polygon className="mcs-edge-arrow" fill="currentColor" points="0,0 -7,-3 -7,3"/><g className="mcs-junction"><circle r={8}/><text x={0} y={3} textAnchor="middle">{edge.inputs.length>1?'∧':'·'}</text></g></g>)}
      {props.view.added.filter(id=>visible.has(id)).map(id=>{const node=names.current.get(id);if(!node)return null;const state=props.view.relations.filter(r=>r.output===id).map(r=>relationState(r,props.content,props.reports,props.view));const lines=titleLines(node.title),height=58+(lines.length-1)*14;const status=props.learning?.missing.length&&props.learning.added.includes(id)?'当前步骤前提未确认':checkCaption(state,node.evidenceStatus);return <g key={id} ref={el=>{if(el)nodes.current.set(id,el);else nodes.current.delete(id);}} id={`${uid}-shape-${id}`} className="mcs-card" data-node-id={id} role="button" tabIndex={0} aria-labelledby={`${uid}-node-${id}`} onPointerDown={e=>pointerDown(e,id)} onPointerEnter={()=>hoverNode(id)} onPointerLeave={()=>{if(hover.current===id)hoverNode(null);}} onFocus={()=>hoverNode(id)} onBlur={()=>hoverNode(null)} onDoubleClick={()=>latest.current.onRead(id)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();latest.current.onSelect(id);latest.current.onRead(id);}if(e.key===' '){e.preventDefault();latest.current.onSelect(id);}if(e.key==='Delete')latest.current.onRemove(id);}}><title id={`${uid}-node-${id}`}>{node.title}</title><circle className="mcs-node-circle" r={6}/>{(expanded||id===props.selected||id===focusedHover)&&<g className="mcs-node-card"><rect x={-86} y={-height/2} width={172} height={height} rx={10}/><text className="mcs-card-title">{lines.map((line,i)=><tspan key={i} x={-74} y={-height/2+21+i*14}>{line}</tspan>)}</text><text className="mcs-node-caption" x={-74} y={height/2-19}>{node.kind} · {status}</text><text className="mcs-node-caption" x={-74} y={height/2-6}>{props.known.includes(id)?'已确认掌握':props.view.locked.includes(id)?'位置固定':'双击阅读'}</text></g>}<text className="mcs-node-label">{node.title}</text></g>;})}
      <g ref={focusLayer} className="mcs-focus-layer" aria-hidden="true" pointerEvents="none"/>
    </g>
  </svg></>;
});
