import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MotionEngine,adaptiveCards,labelPlacements,edgeLabelFits,edgeLabelsVisible} from '../src/motion.ts';
import {createView,validateView,importBundle,exportBundle} from '../src/core.mjs';
const content=JSON.parse(await readFile(new URL('../src/generated/content.json',import.meta.url)));

test('legacy view and bundle retain exact positions, locks, routes and identity on upgrade',()=>{
  const old=createView(content),id=content.nodes[0].id;old.schema='mcs-view/1';delete old.display;
  old.added=[id];old.positions={[id]:{x:123.5,y:-62}};old.locked=[id];
  const upgraded=validateView(old,content);assert.equal(upgraded.schema,'mcs-view/2');assert.deepEqual(upgraded.display,{nodeMode:'adaptive',motion:'auto'});
  for(const field of ['id','revision','positions','locked','route','relations','camera'])assert.deepEqual(upgraded[field],old[field]);
  assert.equal(old.schema,'mcs-view/1');assert.equal(old.display,undefined);
  const imported=importBundle({schema:'mcs-bundle/1',content,view:old});assert.deepEqual(imported.view.positions,old.positions);assert.notEqual(imported.view.id,old.id);
  assert.equal(exportBundle(content,imported.view).schema,'mcs-bundle/2');
  assert.throws(()=>validateView({...upgraded,display:{nodeMode:'adaptive',motion:'infinite',velocity:1}},content),/动态/);
});

test('live simulation owns copies, settles and preserves fixed positions exactly',()=>{
  const positions=Object.fromEntries(Array.from({length:24},(_,i)=>[`n${i}`,{x:(i%6)*25,y:Math.floor(i/6)*25}])),before=structuredClone(positions);
  positions.n0={x:123.123456789,y:-62.123456789};before.n0={...positions.n0};
  const motion=new MotionEngine(),ids=Object.keys(positions),links=ids.slice(1).map(id=>({from:ids[0],to:id}));
  motion.sync(ids,positions,[ids[0]],links,true);motion.reheat();
  for(let i=0;i<300&&motion.active;i++)motion.step();
  assert.equal(motion.active,false);assert.deepEqual(positions,before);assert.deepEqual(motion.positions()[ids[0]],before[ids[0]]);
  assert.ok(Object.values(motion.positions()).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  const ps=Object.values(motion.positions());for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.abs(ps[i].x-ps[j].x)>171||Math.abs(ps[i].y-ps[j].y)>57,'settled cards do not overlap');
});

test('elastic dragging moves neighbors; explicit fixing and removed nodes remain coherent',()=>{
  const motion=new MotionEngine(),positions={a:{x:0,y:0},b:{x:220,y:0},c:{x:440,y:0}};
  motion.sync(['a','b','c'],positions,[],[{from:'a',to:'b'},{from:'b',to:'c'}],true);
  motion.beginDrag('a');motion.drag('a',{x:70,y:100});for(let i=0;i<15;i++)motion.step();assert.notDeepEqual(motion.positions().b,positions.b);
  motion.endDrag('a',false);assert.equal(motion.byId.get('a').fx,null);
  const pinned={x:60.123456789,y:90.123456789};motion.beginDrag('a');motion.drag('a',pinned);motion.endDrag('a',true);for(let i=0;i<30;i++)motion.step();assert.deepEqual(motion.positions().a,pinned);
  motion.sync(['a','c'],motion.positions(),['a'],[{from:'a',to:'b'}]);assert.equal(motion.byId.has('b'),false);motion.stop();assert.equal(motion.active,false);
});

test('adaptive node appearance has hysteresis and overview labels avoid overlap',()=>{
  assert.equal(adaptiveCards(false,1),false);assert.equal(adaptiveCards(false,1.12),true);assert.equal(adaptiveCards(true,1),true);assert.equal(adaptiveCards(true,.8),false);
  const labels=labelPlacements([{id:'a',x:60,y:60,title:'节点甲',priority:'normal'},{id:'b',x:61,y:61,title:'节点乙',priority:'normal'}],400,200);
  assert.equal(labels.size,2);assert.notDeepEqual(labels.get('a'),labels.get('b'));
});

test('zoom decides whether an edge label fits on its line',()=>{
  /* 整层标注的缩放门槛：0.35 以下（圆点已经挤在一起）整层收起，避免糊成一片。 */
  assert.equal(edgeLabelsVisible(0.35),true,'正好在门槛上应显示');
  assert.equal(edgeLabelsVisible(0.5),true);
  assert.equal(edgeLabelsVisible(0.34),false);
  assert.equal(edgeLabelsVisible(0.2),false);
  assert.equal(edgeLabelsVisible(NaN),false);
  /* 逐条判据：一行 120 像素的标注，连线在屏幕上至少要有 150 像素才显示。 */
  assert.equal(edgeLabelFits(120,200),true);
  assert.equal(edgeLabelFits(120,140),false);
  assert.equal(edgeLabelFits(120,150),true,'正好 1.25 倍时应显示');
  assert.equal(edgeLabelFits(120,40),false,'缩得太小时不显示');
  assert.equal(edgeLabelFits(120,80,1),false);
  assert.equal(edgeLabelFits(120,150,1),true,'margin 可调：1 倍即可');
  /* 度量缺失时保持既有行为（老调用方还没接度量）。 */
  assert.equal(edgeLabelFits(undefined,10),true);
  assert.equal(edgeLabelFits(120,undefined),true);
  assert.equal(edgeLabelFits(120,NaN),true);
});

test('edge labels yield to node labels, avoid cards, and stay hidden when the line is too short',()=>{
  const boxOf=(spot,width,height=20)=>({x:spot.x,y:spot.y-height,w:width,h:height}),overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  /* 节点标签先放，并且一定放得下（它不会因为拥挤而消失）；边标签只能在剩下的位置里挑。 */
  const nodes=[{id:'n',x:60,y:60,title:'节点甲',priority:'normal'}];
  const crowded=labelPlacements([...nodes,{id:'edge:e',x:60,y:60,title:'关系',priority:'edge',edgeWidth:40,span:400}],400,200);
  assert.ok(crowded.has('n'),'节点标签应当放下');
  if(crowded.has('edge:e'))assert.ok(!overlaps(boxOf(crowded.get('edge:e'),40),boxOf(crowded.get('n'),110)),'边标签不该压在节点标签上');
  /* 空位置就正常显示。 */
  const clear=labelPlacements([...nodes,{id:'edge:e',x:340,y:170,title:'关系',priority:'edge',edgeWidth:40,span:400}],400,200);
  assert.ok(clear.has('edge:e'),'空位置应当放下边标签');
  /* 卡片是障碍：标签整个落在卡片矩形里就不显示。 */
  const blocked=labelPlacements([{id:'edge:e',x:100,y:100,title:'关系',priority:'edge',edgeWidth:40,span:400}],400,200,[{x:80,y:70,w:200,h:70}]);
  assert.ok(!blocked.has('edge:e'),'压在卡片上的边标签不该显示');
  /* 屏幕上的连线容不下这行字：如实不显示，而不是把字堆在线上。 */
  const narrow=labelPlacements([{id:'edge:e',x:100,y:100,title:'很长的一行关系表达',priority:'edge',edgeWidth:120,span:90}],400,200);
  assert.ok(!narrow.has('edge:e'),'连线太短时不该硬放边标签');
});
