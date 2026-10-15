import { parseFormula, parseType } from '../upstream/mcs-web/core/formal/language.mjs';
import { kernelTheory, assembleProof, assembleBundle } from '../upstream/mcs-web/core/formal/certificate.mjs';
import { search, collectHypotheses } from '../upstream/mcs-web/core/formal/search.mjs';
import { sameFormula } from '../upstream/mcs-web/core/formal/terms.mjs';
import { digest } from '../upstream/mcs-web/core/formal/codec.mjs';
import { relationInput } from './core.mjs';
import {prepareReferences,prepareInstantiation,prepareFinite} from './witness.mjs';

export function prepareRelation(relation,context = {}) {
  if (!relation.formal) return {status:'unsupported',message:'没有机器表达；自然语言解释不能自动作为证明。'};
  if(relation.kind==='definitionReference')return prepareReferences(relation,context);
  const {declarations,premises,goal} = relation.formal;
  const constants=Object.fromEntries(Object.entries(declarations).map(([name,type])=>[name,parseType(type)]));
  const bases=new Set(['o']);
  const visit=t=>Array.isArray(t)?t.slice(1).forEach(visit):bases.add(t);
  Object.values(constants).forEach(visit);
  const parts=kernelTheory({id:'mcs-user-signature/1',bases:[...bases].sort(),constants});
  const ctx={bases:[...bases],constants};
  const ps=premises.map(p=>parseFormula(p,ctx));
  const g=parseFormula(goal,ctx);
  if(relation.kind==='instanceOf'&&relation.formal.witness?.mode==='instantiate'){
    const query=prepareInstantiation(relation,parts,ps,g);
    return {status:'parsed',target:query.goal,query,parts,input:relationInput(relation,context)};
  }
  if(['instanceOf','counterexampleTo'].includes(relation.kind)&&relation.formal.witness?.mode==='finite')return prepareFinite(relation,parts,ps,g,context);
  if (!['conditionalDerivation','equivalentTo','scaling'].includes(relation.kind)) return {status:'unsupported',message:'语法与类型已通过；请提供此关系专用的代入或有限模型见证。'};
  if (relation.kind==='equivalentTo' && ps.length!==1) throw new Error('等价关系需要恰好一个输入陈述；联合前提请使用条件推导。');
  if (relation.kind==='scaling' && ps.length!==1) throw new Error('放缩检查需要一个特殊端陈述，结论填写一般端陈述。');
  const target=relation.kind==='equivalentTo'?['and',['imp',ps[0],g],['imp',g,ps[0]]]:ps.reduceRight((body,p)=>['imp',p,body],g);
  return {status:'parsed',target,parts,input:relationInput(relation)};
}

export function proveRelation(relation,context = {}) {
  const prepared=prepareRelation(relation,context);
  if(prepared.status!=='parsed') return prepared;
  const {target,parts,input}=prepared;
  const result=prepared.query?{status:'proved',proof:prepared.query}:search(target,{hypotheses:[],clauses:[]},{sig:parts.sig,maxMs:2000,maxStates:2000,maxDepth:15,maxSteps:1500});
  if(result.status!=='proved') return {status:result.status,message:result.reason??'在声明范围内未得到证书',input};
  const proof=assembleProof(result.proof,{sig:parts.sig,hypotheses:collectHypotheses(result.proof),theoryAxioms:[],definitions:parts.definitions,lemmas:[],rootConclusion:target});
  const bundle=assembleBundle({theory:parts.theory,proof});
  return {status:'candidate',bundle,target,input,theoryHash:digest(parts.theory)};
}

export function verifyReplay(prepared,report) {
  if(report.status!=='passed') return {status:report.status,message:report.message??'检查器没有通过',input:prepared.input};
  if(!sameFormula(report.conclusion,prepared.target)) throw new Error('检查器结论与独立目标不一致');
  if(report.theory_sha256!==prepared.theoryHash) throw new Error('背景理论摘要不匹配');
  if(Object.keys(report.open_hypotheses??{}).length) throw new Error('证书留下了未声明的开放假设');
  if(prepared.bundle.theory.axioms.length) throw new Error('本编辑器不接受额外公理');
  return {status:'passed',input:prepared.input,message:'ND 子集证书通过；检查器自身未经形式化验证，教材与节点对应须单独审阅。',
    target:prepared.target,checker:report.checker,checkerSha256:report.checker_sha256,theoryHash:prepared.theoryHash,inputHash:digest(prepared.bundle),checkedAt:new Date().toISOString()};
}
