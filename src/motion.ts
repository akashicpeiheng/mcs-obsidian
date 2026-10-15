import {forceSimulation,forceLink,forceManyBody,forceX,forceY,type SimulationNodeDatum} from 'd3-force';
import {quadtree} from 'd3-quadtree';
import type {ViewDocument} from './types';

export type Positions=ViewDocument['positions'];
export interface MovingNode extends SimulationNodeDatum {id:string;x:number;y:number;vx:number;vy:number}
export interface MotionLink {from:string;to:string}

// The simulator owns copies. Coordinates in a view retain the original top-left convention.
export class MotionEngine {
  nodes:MovingNode[]=[];
  byId=new Map<string,MovingNode>();
  private dragId:string|null=null;
  private dragPoint:{x:number;y:number}|null=null;
  private fixedCoordinates=new Map<string,{x:number;y:number}>();
  private link=forceLink<MovingNode,{source:string|MovingNode;target:string|MovingNode}>().id(n=>n.id).distance(185).strength(.045);
  private simulation=forceSimulation<MovingNode>().stop().alpha(0).alphaMin(.004).alphaDecay(.045).velocityDecay(.45)
    .force('link',this.link).force('repel',forceManyBody<MovingNode>().strength(-350).distanceMax(900));
  sync(ids:string[],positions:Positions,locked:string[],links:MotionLink[],reset=false){
    const fixed=new Set(locked);
    this.fixedCoordinates=new Map(locked.filter(id=>positions[id]).map(id=>[id,{...positions[id]}]));
    this.nodes=ids.filter(id=>positions[id]).map(id=>{
      const p=positions[id],old=this.byId.get(id),n=old&&!reset?old:{id,x:p.x+86,y:p.y+29,vx:0,vy:0};
      if(fixed.has(id)){n.fx=p.x+86;n.fy=p.y+29;n.x=n.fx;n.y=n.fy;n.vx=0;n.vy=0;}
      else if(id!==this.dragId){n.fx=null;n.fy=null;}
      return n;
    });
    this.byId=new Map(this.nodes.map(n=>[n.id,n]));
    // Reinitialize nodes before links; stale links may contain removed node objects.
    this.link.links([]);this.simulation.nodes(this.nodes);
    const edges=new Map<string,{source:string;target:string}>();
    for(const l of links)if(l.from!==l.to&&this.byId.has(l.from)&&this.byId.has(l.to)){
      const pair=[l.from,l.to].sort();edges.set(JSON.stringify(pair),{source:pair[0],target:pair[1]});
    }
    this.link.links([...edges.values()]);
    const cx=this.nodes.reduce((s,n)=>s+n.x,0)/Math.max(1,this.nodes.length),cy=this.nodes.reduce((s,n)=>s+n.y,0)/Math.max(1,this.nodes.length);
    this.simulation.force('x',forceX<MovingNode>(cx).strength(.008)).force('y',forceY<MovingNode>(cy).strength(.008));
  }
  reheat(){if(this.nodes.length)this.simulation.alpha(Math.max(.45,this.simulation.alpha()));}
  get active(){return this.simulation.alpha()>=.004||this.dragId!==null;}
  stop(){if(this.dragId&&!this.fixedCoordinates.has(this.dragId)){const n=this.byId.get(this.dragId);if(n){n.fx=null;n.fy=null;}}this.dragId=null;this.dragPoint=null;this.simulation.alpha(0).alphaTarget(0);}
  step(){
    if(!this.active)return false;
    this.simulation.tick();this.collide();
    for(const n of this.nodes){if(!Number.isFinite(n.x)||!Number.isFinite(n.y)){n.x=0;n.y=0;n.vx=0;n.vy=0;}n.x=Math.max(-1e6,Math.min(1e6,n.x));n.y=Math.max(-1e6,Math.min(1e6,n.y));}
    return this.active;
  }
  positions():Positions{return Object.fromEntries(this.nodes.map(n=>[n.id,{...(n.id===this.dragId&&this.dragPoint?this.dragPoint:this.fixedCoordinates.get(n.id)??{x:n.x-86,y:n.y-29})}])) as Positions;}
  beginDrag(id:string){const n=this.byId.get(id);if(!n)return;this.dragPoint=this.positions()[id];this.dragId=id;n.fx=n.x;n.fy=n.y;this.simulation.alphaTarget(.12);this.reheat();}
  drag(id:string,p:{x:number;y:number}){const n=this.byId.get(id);if(!n)return;this.dragPoint={...p};if(this.fixedCoordinates.has(id))this.fixedCoordinates.set(id,{...p});n.x=p.x+86;n.y=p.y+29;n.fx=n.x;n.fy=n.y;n.vx=0;n.vy=0;}
  endDrag(id:string,fixed:boolean){const n=this.byId.get(id);if(!n)return;if(fixed)this.fixedCoordinates.set(id,{...(this.dragPoint??{x:n.x-86,y:n.y-29})});else{this.fixedCoordinates.delete(id);n.fx=null;n.fy=null;}this.dragId=null;this.dragPoint=null;this.simulation.alphaTarget(0);this.reheat();}
  private collide(){
    const tree=quadtree<MovingNode>().x(n=>n.x).y(n=>n.y).addAll(this.nodes);
    for(const a of this.nodes)tree.visit((quad,x0,y0,x1,y1)=>{
      if(x0>a.x+188||x1<a.x-188||y0>a.y+76||y1<a.y-76)return true;
      if(!quad.length){let leaf=quad;do{const b=leaf.data;
        if((b.index??0)>(a.index??0)){
          const dx=a.x-b.x||((a.index??0)%2?.01:-.01),dy=a.y-b.y||.01,ox=188-Math.abs(dx),oy=76-Math.abs(dy);
          if(ox>0&&oy>0){const af=a.fx!=null,bf=b.fx!=null;if(!af||!bf){
            const share=af||bf?1:.5;
            if(ox/188<oy/76){const shift=Math.sign(dx)*ox*share;if(!af)a.x+=shift;if(!bf)b.x-=shift;}
            else{const shift=Math.sign(dy)*oy*share;if(!af)a.y+=shift;if(!bf)b.y-=shift;}
          }}
        }
        leaf=leaf.next!;
      }while(leaf);}
      return false;
    });
  }
}

export function adaptiveCards(previous:boolean,scale:number){return previous?scale>=.85:scale>=1.1;}

/** 屏幕上的矩形占位（节点卡片或已放好的标签）。 */
export interface LabelObstacle {x:number;y:number;w:number;h:number}
export interface LabelItem {id:string;x:number;y:number;title:string;priority:'high'|'normal'|'edge';/** 边标签的要求宽度（屏幕像素）。 */edgeWidth?:number;/** 边标签的可放宽度（屏幕像素，通常是连线在屏幕上的长度）。 */span?:number}

/**
 * 线上标注在当前缩放下放不放得下——按**缩放档**判定。
 *
 * 直觉：字贴在连线上，连线在屏幕上就得比字长。缩得越小，同一段连线在屏幕上越短，
 * 能显示的标注自然变少——远景留下整张网络，放大后才逐条读出关系。
 *
 * 门槛取 0.35：这一档之下，节点已经按圆点显示且彼此很近，任何一行字都会压住邻居，
 * 所以整层标注一起收起来，而不是靠逐条测量去猜（后者在真实界面里不够可靠）。
 * `edgeLabelFits` 是更细的一条逐条判据，仍在使用；两者都不改变数学内容，只是显示取舍。
 */
export const EDGE_LABEL_MIN_SCALE=0.35;
export function edgeLabelsVisible(scale:number,minScale=EDGE_LABEL_MIN_SCALE){
  return Number.isFinite(scale)&&scale>=minScale;
}

/**
 * 线上标注在当前缩放下放不放得下（逐条判据）。
 *
 * 这是**显示**规则，不是数学义务：放不下时如实不显示，解释仍在关系编辑器与节点正文里。
 * 度量缺失（还没测到）时返回 true，保持既有行为。
 */
export function edgeLabelFits(edgeWidth:number|undefined,screenLength:number|undefined,margin=1.25){
  if(!edgeWidth||!Number.isFinite(edgeWidth))return true;
  if(screenLength===undefined||!Number.isFinite(screenLength))return true;
  return edgeWidth*margin<=screenLength;
}

/**
 * 屏幕坐标里的文字标签放置（节点标签与关系线上的简短表达共用一次占位）。
 *
 * `priority` 的取值与含义：
 * - `'high'`：焦点标签（选中或悬停），先放，且允许压住别的标签；
 * - `'normal'`：普通节点标签，按 id 稳定排序，放不下就退回节点旁的位置（不消失）；
 * - `'edge'`：关系线上的简短表达，最后放，**放不下就不显示**。
 *
 * 边标签与节点标签的取舍不同：节点标签消失会让节点变成无名圆点，所以它宁可重叠；
 * 而边标签叠在一起只会是一片糊字，所以它在「与已放标签或节点卡片相撞」或
 * 「连线在屏幕上容不下这行字」时如实不显示，而不是把字堆上去。
 */
export function labelPlacements(items:LabelItem[],width:number,height:number,obstacles:LabelObstacle[]=[]){
  const rank={high:0,normal:1,edge:2},occupied:LabelObstacle[]=[...obstacles],result=new Map<string,{x:number;y:number}>();
  const hits=(box:LabelObstacle)=>occupied.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y);
  for(const n of [...items].sort((a,b)=>rank[a.priority]-rank[b.priority]||a.id.localeCompare(b.id))){
    const w=Math.min(230,Math.max(40,n.title.length*11)),h=20,edge=n.priority==='edge',need=Math.max(w,n.edgeWidth??0);
    if(edge&&!edgeLabelFits(need,n.span))continue;
    for(const [dx,dy]of [[12,-8],[12,20],[-w-12,-8],[-w/2,-23],[-w/2,32]]){
      const x=Math.max(4,Math.min(width-w-4,n.x+dx)),y=Math.max(18,Math.min(height-4,n.y+dy)),box={x,y:y-h,w,h};
      if(!edge&&n.priority==='normal'&&hits(box))continue;
      if(edge&&hits(box))continue;
      result.set(n.id,{x,y});occupied.push(box);break;
    }
  }return result;
}
