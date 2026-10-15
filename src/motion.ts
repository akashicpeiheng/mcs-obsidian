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

export function labelPlacements(items:{id:string;x:number;y:number;title:string;priority:boolean}[],width:number,height:number){
  const occupied:{x:number;y:number;w:number;h:number}[]=[],result=new Map<string,{x:number;y:number}>();
  for(const n of [...items].sort((a,b)=>Number(b.priority)-Number(a.priority)||a.id.localeCompare(b.id))){
    const w=Math.min(230,Math.max(40,n.title.length*11)),h=20;
    for(const [dx,dy]of [[12,-8],[12,20],[-w-12,-8],[-w/2,-23],[-w/2,32]]){
      const x=Math.max(4,Math.min(width-w-4,n.x+dx)),y=Math.max(18,Math.min(height-4,n.y+dy));
      if(!n.priority&&occupied.some(b=>x<b.x+b.w&&x+w>b.x&&y-h<b.y+b.h&&y>b.y))continue;
      result.set(n.id,{x,y});occupied.push({x,y:y-h,w,h});break;
    }
  }return result;
}
