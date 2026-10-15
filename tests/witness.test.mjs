import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {prepareRelation,proveRelation} from '../src/formal.mjs';
import {verifyWitness} from '../src/witness.mjs';
import {relationInput,relationState,createView,validateView,exportBundle,importBundle,contentHash} from '../src/core.mjs';

const content={schema:'mcs-content/1',version:'pending',title:'witness fixture',nodes:['a','b','g'].map(id=>({id,version:'1',title:id,kind:'Concept',chapter:'finite',summary:id,body:id,source:'test',sourceReviewed:false,evidenceStatus:'DEF'})),actions:[],boundary:[],templates:[]};content.version=contentHash(content);
const relation=(kind,formal)=>({id:'r',kind,inputs:['a'],output:'g',nodeVersions:{a:'1',g:'1'},explanation:'Explicit bounded obligation; no claim about all mathematics.',sourceReviewed:false,formal});
const model={id:'collapse-two',carrier:'V',elements:['0','1'],consts:{a:'0',b:'1'},ops:{f:{type:'V -> V',table:['0','0']}}};
const finite=(kind='counterexampleTo')=>relation(kind,{declarations:{a:'V',b:'V',f:'V -> V'},premises:['f a = f b'],goal:'a = b',witness:{mode:'finite',model:structuredClone(model)}});
const instance=()=>relation('instanceOf',{declarations:{a:'V'},premises:['∀x:V. x = x'],goal:'a = a',witness:{mode:'instantiate',terms:['a']}});
const ref=()=>relation('definitionReference',{declarations:{a:'V'},premises:['true'],goal:'I a = a',witness:{mode:'reference',references:[{symbol:'I',node:'a',version:'1'}]}});
const context=()=>({versions:{a:'1',b:'1',g:'1'},formalSources:{a:{version:'1',declarations:{},definitions:[{name:'I',type:'V -> V',source:'λx:V. x'}]}},relations:[]});
const worker=(r,ctx={})=>{
  const result=spawnSync(process.execPath,[resolve('dist/worker.cjs'),JSON.stringify({relation:r,context:ctx,kernel:resolve('dist/kernel.py'),python:'python'})],{encoding:'utf8',timeout:18000,windowsHide:true});
  assert.ok(result.stdout,result.stderr);return JSON.parse(result.stdout);
};

test('definition provenance replays closed typed definitions independently without proving the consumer',()=>{
  const r=ref(),ctx=context();ctx.relations=[r];const report=worker(r,ctx);
  assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.evidence,'DEF');assert.match(report.message,/不证明/);
  assert.equal(relationState(r,content,new Map([['r',report]]),ctx),'alignment-pending');
  ctx.formalSources.a.definitions[0].source='λx:V. a';assert.equal(relationState(r,content,new Map([['r',report]]),ctx),'stale');
  assert.throws(()=>prepareRelation(r,ctx),/闭项/); // A consumer-local name cannot define a provider symbol.
});
test('definition references reject local names, unused names, ambiguous providers and stale versions',()=>{
  const r=ref();r.formal.declarations.I='V -> V';assert.throws(()=>prepareRelation(r,context()),/遮蔽/);
  delete r.formal.declarations.I;r.formal.goal='a = a';assert.throws(()=>prepareRelation(r,context()),/没有实际使用/);
  const ctx=context();ctx.formalSources.b=structuredClone(ctx.formalSources.a);assert.throws(()=>prepareRelation(ref(),ctx),/来源歧义/);
  delete ctx.formalSources.b;ctx.formalSources.a.version='old';assert.throws(()=>prepareRelation(ref(),ctx),/版本已过期/);
  assert.notEqual(worker(ref(),ctx).status,'passed');
});
test('definition symbol cycles and node dependency cycles are rejected; equivalence cycles remain legal',()=>{
  const ctx=context();ctx.formalSources.a.definitions[0].source='I';assert.throws(()=>prepareRelation(ref(),ctx),/符号循环/);
  const c=context();c.relations=[{...ref(),id:'back',inputs:['g'],output:'a',formal:{...ref().formal,witness:{mode:'reference',references:[{symbol:'J',node:'g',version:'1'}]}}}];
  assert.throws(()=>prepareRelation(ref(),c),/节点依赖循环/);
  c.relations[0].kind='equivalentTo';assert.equal(prepareRelation(ref(),c).status,'witness-candidate');
});
test('exact full and partial instantiation replay ND certificates; types and remaining quantifiers are checked',()=>{
  assert.equal(worker(instance()).status,'passed');
  const r=instance();r.formal.premises=['∀x:V. ∀y:V. x = x'];r.formal.goal='∀z:V. a = a';assert.equal(worker(r).status,'passed');
  r.formal.goal='a = a';assert.throws(()=>proveRelation(r),/未消去的量词/);
  const bad=instance();bad.formal.declarations.a='R';assert.throws(()=>proveRelation(bad),/类型|type/);
  const wrong=instance();wrong.formal.goal='∀x:V. x = x';assert.throws(()=>proveRelation(wrong),/不一致/);
  const excess=instance();excess.formal.witness.terms.push('a');assert.throws(()=>proveRelation(excess),/数量/);
});
test('finite countermodel checks all assumptions and a false conclusion, with an explicit carrier',()=>{
  const r=finite(),report=worker(r);assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.evidence,'FINITE');assert.deepEqual(report.result,{premises:[true],goal:false});
  r.formal.premises=['a = b'];const failure=worker(r);assert.equal(failure.status,'failed');assert.match(failure.message,/输入假设/);
  r.formal.premises=['a = a'];r.formal.goal='a = a';assert.match(worker(r).message,/不是反模型/);
});
test('finite instances require true premises AND true satisfaction, without a universal proof claim',()=>{
  const r=finite('instanceOf');r.formal.goal='∀x:V. f x = a';const report=worker(r);assert.equal(report.status,'passed',JSON.stringify(report));assert.deepEqual(report.result,{premises:[true],goal:true});
  r.formal.goal='∀x:V. f x = x';assert.equal(worker(r).status,'failed');
});
test('finite models reject missing tables, closure errors, type confusion, extra symbols and unsupported carriers',()=>{
  const mutations=[r=>r.formal.witness.model.ops.f.table.pop(),r=>r.formal.witness.model.ops.f.table[0]='outside',r=>delete r.formal.witness.model.consts.a,r=>r.formal.witness.model.consts.extra='0',r=>r.formal.witness.model.ops.f.type='R -> R',r=>r.formal.goal='f = f',r=>r.formal.goal='∀x:R. x = x'];
  for(const mutate of mutations){const r=finite();mutate(r);assert.throws(()=>prepareRelation(r));assert.notEqual(worker(r).status,'passed');}
});
test('binary table and nested quantifiers replay complete finite associativity; existential falsity remains a countermodel',()=>{
  const r=relation('instanceOf',{declarations:{zero:'V',add:'V -> V -> V'},premises:['∀x:V. add x zero = x'],goal:'∀x:V. ∀y:V. ∀z:V. add (add x y) z = add x (add y z)',witness:{mode:'finite',model:{id:'xor-two',carrier:'V',elements:['0','1'],consts:{zero:'0'},ops:{add:{type:'V -> V -> V',table:[['0','1'],['1','0']]}}}}});
  assert.equal(worker(r).status,'passed');
  const counter=finite();counter.formal.premises=['a = a'];counter.formal.goal='∃x:V. f x = b';const report=worker(counter);assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.result.goal,false);
});
test('hidden free substitution variables and excessive full-enumeration budgets never pass',()=>{
  const r=instance();r.formal.witness.terms=['hidden'];assert.throws(()=>proveRelation(r),/闭项/);
  const counter=finite();counter.formal.goal=Array.from({length:17},(_,i)=>`∀x${i}:V. `).join('')+'a = b';assert.throws(()=>prepareRelation(counter),/预算/);
  const changed=worker(instance(),{versions:{a:'new',g:'1'}});assert.equal(changed.status,'unsupported');
});
test('independent replay rejects tampered operation types, results and definition provenance',async()=>{
  const work=await mkdtemp(join(tmpdir(),'mcs-witness-test-'));
  try{
    for(const prepared of [prepareRelation(finite()),prepareRelation(ref(),context())]){
      const payload=structuredClone(prepared.payload);
      if(payload.mode==='finite')payload.model.ops.f.type=['->','R','R'];else payload.providers.I.node='b';
      const path=join(work,'witness.json');await writeFile(path,JSON.stringify(payload));
      const process=spawnSync('python',[resolve('dist/witness.py'),path],{encoding:'utf8',windowsHide:true});assert.notEqual(JSON.parse(process.stdout).status,'passed');
    }
    const p=prepareRelation(finite());assert.throws(()=>verifyWitness(p,{status:'passed',payloadHash:'forged',result:p.expected}),/摘要/);
  }finally{await rm(work,{recursive:true,force:true});}
});
test('witnesses and local definitions survive portable round trips; old views acquire an empty registry',()=>{
  const v=createView(content);v.relations=[ref(),finite()];v.relations[1].id='finite';v.formalSources=context().formalSources;
  const copy=importBundle(exportBundle(content,v));assert.deepEqual(copy.view.formalSources,v.formalSources);assert.deepEqual(copy.view.relations,v.relations);
  const old={...v};delete old.formalSources;assert.deepEqual(validateView(old,content).formalSources,{});
  const r=finite(),before=relationInput(r);r.formal.witness.model.ops.f.table[0]='1';assert.notEqual(relationInput(r),before);
});
