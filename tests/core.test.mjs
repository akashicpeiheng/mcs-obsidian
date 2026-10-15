import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createView, validateView, validateRelation, validateContent, planLearning, replayFrame, validateRoute, recommendations, exportBundle, importBundle, relationInput, relationState,contentHash,verifyContentIdentity,EDGE_LABEL_MAX } from '../src/core.mjs';
import { prepareRelation, proveRelation } from '../src/formal.mjs';
import {parseImports,migrateWebsiteView} from '../src/migration.mjs';
import {increment,arrange} from '../src/graph.ts';
const content=JSON.parse(await readFile(new URL('../src/generated/content.json',import.meta.url)));
const rel=()=>({id:'r',kind:'conditionalDerivation',inputs:['a','b'],output:'g',nodeVersions:{a:'1',b:'1',g:'1'},explanation:'联合前提通过蕴含消去得到结论。逻辑模式示例。',sourceReviewed:false,formal:{declarations:{P:'o',Q:'o'},premises:['P','P -> Q'],goal:'Q'}});
const node=id=>({id,title:id,version:'1',body:'',chapter:'test'});
const action=(id,inputs,output)=>({id,title:id,mode:'deduction',theory:'test',version:'1',inputs:inputs.map(node=>({node,accepts:['statement']})),outputs:[{node:output,provides:['statement']}],witness:{status:'DEF'},openAssumptions:[]});
const mini={schema:'mcs-content/1',version:'test',nodes:['a','b','c','g'].map(node),boundary:['a','b','c'],actions:[action('and',['a','b'],'g'),action('or',['c'],'g')]};

test('source map records 51 inherited nodes and finite-field correction',()=>{
  validateContent(content);assert.equal(content.audit.inheritedNodes,51);assert.equal(content.audit.pilotNodes,6);
  assert.match(content.nodes.find(n=>n.id==='jiang:solution-cases').summary,/无限域/);
  assert.match(content.nodes.find(n=>n.id==='jiang:inner-product').summary,/半双线性/);
  assert.ok(content.nodes.every(n=>n.sourceReviewed===false));
});
test('AND inputs stay joint and OR alternatives stay independent',()=>{
  const r=planLearning(mini,'g',['a','b','c']);assert.equal(r.status,'Found');assert.equal(r.routes.length,2);
  assert.deepEqual(r.routes.map(p=>p.events.length),[1,1]);
  const partial=planLearning(mini,'g',['a']);assert.equal(partial.status,'Conditional');
  const both=partial.routes.find(r=>r.events[0].actionId==='and');
  const before=JSON.stringify(partial);
  const frame=replayFrame(both,mini,1,['a']);assert.deepEqual(frame.current.missing,['b']);assert.ok(!frame.available.includes('g'));
  assert.equal(JSON.stringify(partial),before);
});
test('actual uses excludes unrelated earlier visible background',()=>{
  const r=planLearning(mini,'g',['a','b','c']).routes.find(r=>r.events[0].actionId==='and');
  assert.deepEqual(replayFrame(r,mini,1,['a','b','c']).current.uses,['a','b']);
});
test('empty background does not pre-produce the first conclusion',()=>{
  const c={...mini,actions:[action('zero',[],'g')]};const route=planLearning(c,'g',[]).routes[0];
  assert.deepEqual(replayFrame(route,c,0,[]).visible,[]);assert.ok(replayFrame(route,c,1,[]).visible.includes('g'));
});
test('non-growing events and review events remain in replay',()=>{
  const c={...mini,actions:[action('first',['a'],'g'),action('second',['a'],'g')]};
  const route=planLearning(c,'g',['a']).routes[0],first=route.events[0];
  route.events.push({...structuredClone(first),id:'review',kind:'review'});route.linearExtensions[0].push('review');
  assert.equal(replayFrame(route,c,2,['a']).rows.length,2);assert.equal(replayFrame(route,c,2,['a']).current.event.kind,'review');
});
test('given route rejects incomplete order and forged input source',()=>{
  const r=planLearning(mini,'g',['a','b']).routes.find(r=>r.events[0].actionId==='and');
  const wrong=structuredClone(r);delete wrong.events[0].sources.b;
  assert.throws(()=>validateRoute(wrong,mini),/联合输入/);
  const order=structuredClone(r);order.linearExtensions[0]=[];assert.throws(()=>validateRoute(order,mini),/排列/);
});
test('view save-import round trip preserves modes locks camera and excludes learner state',()=>{
  const v=createView(content);v.added=content.nodes.slice(0,2).map(n=>n.id);v.positions=Object.fromEntries(v.added.map((id,i)=>[id,{x:i*210,y:20}]));v.locked=[v.added[0]];v.layout={mode:'logic',anchor:v.added[0]};v.camera={x:17,y:21,scale:.8};
  const b=exportBundle(content,v),r=importBundle(b);assert.deepEqual(r.view.layout,v.layout);assert.deepEqual(r.view.camera,v.camera);assert.notEqual(r.view.id,v.id);assert.ok(!('known'in b));
  assert.throws(()=>validateView({...v,added:['missing']},content),/未知/);
  assert.throws(()=>validateView({...v,bindings:{[v.added[0]]:'../private.md'}},content),/库内/);
  assert.throws(()=>validateView({...v,contentVersion:'old'},content),/版本/);
});

test('content identity survives key order and rejects mutation under the same version',()=>{
  verifyContentIdentity(content);
  const reordered=Object.fromEntries(Object.entries(content).reverse());assert.equal(contentHash(reordered),content.version);
  const changed=structuredClone(content);changed.nodes[0].body+=' altered';assert.throws(()=>verifyContentIdentity(changed),/哈希/);
  const v=createView(content);v.known=['jiang:field-axioms'];assert.throws(()=>validateView(v,content),/个人状态/);
});

test('simulation follows the selected source event even if another copy of the node is known',()=>{
  const c={...mini,boundary:['a','b'],actions:[action('producer',['a','b'],'c'),action('consumer',['c'],'g')]};
  const route=planLearning(c,'g',['a','b']).routes.find(r=>r.events.length===2);
  const f=replayFrame(route,c,2,['a','c']);
  assert.ok(!f.rows[0].executable);assert.ok(!f.rows[1].executable);assert.ok(!f.available.includes('g'));
  const bad=structuredClone(route);bad.events.find(e=>e.actionId==='consumer').sources.c.resource='method';assert.throws(()=>validateRoute(bad,c),/资源/);
});

test('website migration preserves positions and marks missing source version explicitly',()=>{
  const ids=content.nodes.slice(0,3).map(n=>n.id),old={viewId:'website-1',name:'消元视图',payload:{added:ids,families:['contract','topic'],positions:{[ids[0]]:{x:71,y:94}},camera:{x:20,y:30,scale:.8}}};
  const result=parseImports([old],content,(added,positions)=>increment(content,{...createView(content),added:Object.keys(positions),positions},added).positions)[0];
  assert.deepEqual(result.view.positions[ids[0]],{x:71,y:94});assert.equal(result.view.positions[ids[2]].x,Number(result.view.positions[ids[2]].x));
  assert.equal(result.view.showActions,true);assert.equal(result.view.showRelations,false);assert.ok(result.warnings.some(w=>w.includes('未保存本体版本')));
  assert.throws(()=>migrateWebsiteView({...old,payload:{...old.payload,added:['unmapped']}},content),/没有的节点/);
});

test('200-node layouts preserve locked coordinates and avoid overlapping cards',()=>{
  const nodes=Array.from({length:200},(_,i)=>({...content.nodes[0],id:`stress:${i}`,title:`对象${i}`}));
  const actions=Array.from({length:600},(_,i)=>action(`stress-action:${i}`,[nodes[i%200].id,nodes[(i+37)%200].id],nodes[(i+91)%200].id));
  const c={...content,nodes,actions},view=increment(c,createView(c),nodes.map(n=>n.id));
  view.locked=[nodes[0].id];view.positions[nodes[0].id]={x:0,y:0};
  for(const mode of ['free','logic']){const arranged=arrange(c,{...view,layout:{mode,anchor:nodes[0].id}},true);
    assert.deepEqual(arranged.positions[nodes[0].id],{x:0,y:0});
    const ps=nodes.map(n=>arranged.positions[n.id]);assert.ok(ps.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.abs(ps[i].x-ps[j].x)>=172||Math.abs(ps[i].y-ps[j].y)>=58,`${mode}: ${i}/${j} overlap`);
  }
});
test('evidence is tied to relation inputs, node versions and local checker results',()=>{
  const r=rel(),c={...mini};const records=new Map([['r',{status:'passed',input:relationInput(r)}]]);
  assert.equal(relationState(r,c),'unchecked');assert.equal(relationState(r,c,records),'alignment-pending');
  r.sourceReviewed=true;assert.equal(relationState(r,c,records),'verified');
  r.formal.goal='P';assert.equal(relationState(r,c,records),'stale');
});
test('recommendations distinguish graph presence from confirmed knowledge',()=>{
  const v=createView(mini);v.added=['a','b'];const r=recommendations(mini,v,[]).find(r=>r.node.id==='g');assert.equal(r.score,0);assert.equal(r.ready,false);
});
test('two sample route templates really produce executable paths',()=>{
  for(const t of content.templates){const result=planLearning(content,t.goal,['jiang:field-axioms'],t.actions);assert.ok(result.routes.length>0,JSON.stringify(result.search));
    for(const r of result.routes){validateRoute(r,content);const f=replayFrame(r,content,r.events.length,['jiang:field-axioms']);assert.ok(f.available.includes(t.goal));assert.ok(f.rows.every(row=>row.executable));}}
});
test('formal type mismatch is rejected before proof search',()=>{
  const r=rel();r.formal.declarations.P='R';assert.throws(()=>prepareRelation(r),/真值|类型|type/);
});
test('ND candidate is independently replayed; missing premise is not called false',()=>{
  const r=rel();assert.equal(proveRelation(r).status,'candidate');
  const result=spawnSync(process.execPath,[resolve('dist/worker.cjs'),JSON.stringify({relation:r,kernel:resolve('dist/kernel.py'),python:'python'})],{encoding:'utf8',timeout:18000,windowsHide:true});
  const report=JSON.parse(result.stdout);assert.equal(report.status,'passed',JSON.stringify(report));
  r.formal.premises=['P','P'];assert.notEqual(proveRelation(r).status,'candidate');
});
test('equivalence requires proof in both directions',()=>{
  const r=rel();r.kind='equivalentTo';r.inputs=['a'];r.formal.premises=['P'];r.formal.goal='Q';assert.notEqual(proveRelation(r).status,'candidate');
  r.formal.goal='P';assert.equal(proveRelation(r).status,'candidate');
});
test('edge short labels are optional display text: validated, bounded, and outside the evidence hash',()=>{
  // 不写就是没有：图上的连线只是不带标注，不影响任何检查。
  const bare=rel();validateRelation(bare,mini);assert.ok(!('short'in bare));
  const r=rel();r.short='秩 ⟺ 相抵';validateRelation(r,mini);
  // 改标注不改证据：relationInput 不读 short，所以已通过的检查不会因此过期。
  const before=relationInput(r);r.short='相抵标准形';assert.equal(relationInput(r),before);
  const cases=[['',/空串/],[' 两端有空白 ',/首尾/],['两\n行',/一行/],[`${'长'.repeat(EDGE_LABEL_MAX)}字`,/最多/]];
  for(const [short,pattern]of cases){const bad=rel();bad.short=short;assert.throws(()=>validateRelation(bad,mini),pattern);}
  const exact=rel();exact.short='长'.repeat(EDGE_LABEL_MAX);validateRelation(exact,mini);
  assert.throws(()=>validateRelation({...rel(),short:42},mini),/文本/);
});
test('legacy views read as “edge labels on” and the switch is part of the view protocol',()=>{
  const v=createView(content);v.added=content.nodes.slice(0,2).map(n=>n.id);v.positions=Object.fromEntries(v.added.map((id,i)=>[id,{x:i*210,y:20}]));
  assert.equal(v.showEdgeLabels,true);
  const legacy=structuredClone(v);delete legacy.showEdgeLabels;
  assert.equal(validateView(legacy,content).showEdgeLabels,true,"旧视图缺字段时按“开”读");
  assert.equal(validateView({...v,showEdgeLabels:false},content).showEdgeLabels,false);
  assert.throws(()=>validateView({...v,showEdgeLabels:'yes'},content),/标签显示设置/);
  assert.throws(()=>validateView({...v,labelsOn:true},content),/未定义字段/);
});
