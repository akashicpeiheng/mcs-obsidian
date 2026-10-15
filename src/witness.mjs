// Relation-specific obligations. Parsing, substitution and finite evaluation reuse MCS core.
import {parseFormula,parseTerm,parseType,typeEquals} from '../upstream/mcs-web/core/formal/language.mjs';
import {kernelTheory} from '../upstream/mcs-web/core/formal/certificate.mjs';
import {evaluateFormulaWithWitness,validateModel} from '../upstream/mcs-web/core/formal/finite.mjs';
import {fsub,formulaFv,objectFv,sameFormula,inferTerm,lift} from '../upstream/mcs-web/core/formal/terms.mjs';
import {digest} from '../upstream/mcs-web/core/formal/codec.mjs';
import {relationInput} from './core.mjs';

const need=(ok,message)=>{if(!ok)throw new Error(message);};
const own=(o,k)=>Object.hasOwn(o,k);
export function signature(declarations){
  const constants=Object.fromEntries(Object.entries(declarations).map(([n,t])=>[n,parseType(t)]));
  const bases=new Set(['o']);
  const visit=t=>Array.isArray(t)?t.slice(1).forEach(visit):bases.add(t);
  Object.values(constants).forEach(visit);
  return {bases:[...bases].sort(),constants};
}
function symbols(tree,out=new Set()){
  if(Array.isArray(tree)){if(tree[0]==='c')out.add(tree[1]);else tree.forEach(x=>symbols(x,out));}
  return out;
}
export function acyclic(edges,message){
  const done=new Set(),active=new Set();
  const visit=id=>{if(done.has(id))return;need(!active.has(id),`${message}：${[...active,id].join(' → ')}`);active.add(id);for(const to of edges.get(id)??[])visit(to);active.delete(id);done.add(id);};
  for(const id of edges.keys())visit(id);
}

export function prepareReferences(r,context){
  const sources=context.formalSources??{},versions=context.versions??{};
  const declarations={...r.formal.declarations},providers=new Map(),raw=[];
  for(const [node,s] of Object.entries(sources)){
    need(versions[node]===s.version,`定义来源 ${node} 的节点版本已过期`);
    for(const [name,type] of Object.entries(s.declarations)){
      if(own(declarations,name))need(typeEquals(parseType(declarations[name]),parseType(type)),`背景符号 ${name} 类型冲突`);
      declarations[name]=type;
    }
    for(const d of s.definitions){need(!providers.has(d.name),`定义符号 ${d.name} 来源歧义`);providers.set(d.name,{node,version:s.version});raw.push(d);}
  }
  for(const d of raw)need(!own(declarations,d.name),`定义符号 ${d.name} 被局部声明遮蔽；局部参数不构成定义来源`);
  const base=signature(declarations),full=signature({...declarations,...Object.fromEntries(raw.map(d=>[d.name,d.type]))});
  const parsed=new Map(),deps=new Map(),nodeEdges=new Map();
  for(const d of raw){
    const owner=sources[providers.get(d.name).node];
    const sourceSig=signature({...owner.declarations,...Object.fromEntries(raw.map(x=>[x.name,x.type]))});
    const term=parseTerm(d.source,{...sourceSig,expected:parseType(d.type)});
    need(!Object.keys(objectFv(term)).length,`定义 ${d.name} 必须是旧语言闭项`);
    parsed.set(d.name,term);
    const uses=[...symbols(term)].filter(n=>providers.has(n));deps.set(d.name,uses);
    for(const n of uses){const a=providers.get(d.name).node,b=providers.get(n).node;if(a!==b)nodeEdges.set(a,[...(nodeEdges.get(a)??[]),b]);}
  }
  acyclic(deps,'定义符号循环');
  const ordered=[],done=new Set();
  const order=n=>{if(done.has(n))return;for(const d of deps.get(n)??[])order(d);done.add(n);ordered.push({name:n,kind:'term',type:full.constants[n],term:parsed.get(n)});};
  raw.forEach(d=>order(d.name));
  const parts=kernelTheory({id:'mcs-local-definitions/1',...base,definitions:ordered});
  const ctx=parts.sig;
  const premises=r.formal.premises.map(p=>parseFormula(p,ctx)),goal=parseFormula(r.formal.goal,ctx);
  const refs=r.formal.witness?.references;
  need(r.formal.witness?.mode==='reference'&&refs?.length,'定义引用需要明确来源符号');
  const used=symbols(goal),seen=new Set(),nodes=new Set();
  for(const ref of refs){
    need(!seen.has(ref.symbol),`重复引用 ${ref.symbol}`);seen.add(ref.symbol);
    const p=providers.get(ref.symbol);
    need(p&&p.node===ref.node&&p.version===ref.version&&r.nodeVersions[ref.node]===ref.version,`符号 ${ref.symbol} 的来源或版本不匹配`);
    need(ref.node!==r.output&&r.inputs.includes(ref.node),'定义引用不能引用自身或未列出的输入');
    need(used.has(ref.symbol),`输出陈述没有实际使用 ${ref.symbol}`);nodes.add(ref.node);
  }
  for(const n of used)if(providers.has(n))need(seen.has(n),`输出使用的定义符号 ${n} 未注明来源`);
  need(r.inputs.every(n=>nodes.has(n)),'每个定义输入须提供至少一个实际使用的符号');
  for(const rel of [...(context.relations??[]).filter(x=>x.id!==r.id),r])if(rel.kind==='definitionReference'){
    for(const ref of rel.formal?.witness?.references??[])nodeEdges.set(rel.output,[...(nodeEdges.get(rel.output)??[]),ref.node]);
  }
  acyclic(nodeEdges,'定义节点依赖循环');
  return {status:'witness-candidate',input:relationInput(r,context),payload:{schema:'mcs-witness/1',mode:'reference',theory:parts.theory,symbolTypes:full.constants,premises,goal,references:refs,providers:Object.fromEntries(providers),nodeVersions:r.nodeVersions,versions,nodeEdges:[...nodeEdges]},expected:{references:refs},evidence:'DEF',message:'定义来源、类型、实际符号出现与依赖无环通过；此检查不证明输出命题。'};
}

export function prepareInstantiation(r,parts,premises,goal){
  need(premises.length===1,'全称代入需要恰好一个模式输入');
  const terms=r.formal.witness.terms;
  need(terms.length>0&&terms.length<=16,'须提供 1–16 个代入项');
  let result=premises[0];
  const parsed=[];
  for(const source of terms){
    need(result[0]==='all','代入项超过最外层全称量词的数量');
    const objectTerm=parseTerm(source,{...parts.sig,expected:result[1][2]});
    need(!Object.keys(objectFv(objectTerm)).length,'代入项须为声明语境中的闭项；不接受隐藏自由变量');
    const term=lift(objectTerm,parts.sig);
    parsed.push(term);result=fsub(result[2],result[1],term);
  }
  need(sameFormula(result,goal),'代入结果与输出陈述不一致（包括未消去的量词）');
  let proof={rule:'hypothesis',goal:premises[0],premises:[],hypothesis:{name:'pattern',id:'pattern'}};
  let formula=premises[0];
  for(const term of parsed){formula=fsub(formula[2],formula[1],term);proof={rule:'all_e',goal:formula,term,premises:[proof]};}
  return {rule:'imp_i',goal:['imp',premises[0],goal],discharge:'pattern',premises:[proof]};
}

function finiteShape(f,sig,carrier,elements){
  let nodes=0,maxDepth=0;
  const term=t=>{need(['c','v','app'].includes(t[0]),'有限检查仅支持一阶项；λ、高阶函数与命题载体尚不支持');if(t[0]==='app'){term(t[1]);term(t[2]);}};
  const formula=(x,depth)=>{
    nodes++;maxDepth=Math.max(maxDepth,depth);
    if(x[0]==='eq'){term(x[1]);term(x[2]);need(inferTerm(x[1],sig)===carrier&&inferTerm(x[2],sig)===carrier,'有限等式仅比较载体元素');}
    else if(['and','imp'].includes(x[0])){formula(x[1],depth);formula(x[2],depth);}
    else if(['all','ex'].includes(x[0])){need(x[1][2]===carrier,'有限量词只能遍历指定载体');formula(x[2],depth+1);}
    else need(['true','false'].includes(x[0]),'有限检查不支持此公式');
  };
  need(!Object.keys(formulaFv(f)).length,'有限检查不接受未绑定变量');formula(f,0);
  need(nodes*Math.pow(elements,maxDepth)<=100000,'完整枚举超出有限检查预算；请缩小载体或量词深度');
}
export function prepareFinite(r,parts,premises,goal,context){
  const model=r.formal.witness.model,problems=validateModel(model);
  need(!problems.length,problems.join('；'));
  need(model.elements.length<=8&&Object.keys(parts.sig.constants).length<=32,'有限检查限 1–8 元素、最多 32 个符号');
  need(model.carrier!=='o','不能把命题或真值作为这里的数学载体');
  const entries={...Object.fromEntries(Object.entries(model.ops).map(([n,o])=>[n,parseType(o.type)])),...Object.fromEntries(Object.keys(model.consts).map(n=>[n,model.carrier]))};
  need(Object.keys(entries).length===Object.keys(parts.sig.constants).length&&Object.keys(entries).every(n=>own(parts.sig.constants,n)),'模型符号须与声明一一对应；每个符号都需完整解释');
  for(const [n,t] of Object.entries(parts.sig.constants))need(own(entries,n)&&typeEquals(t,entries[n]),`模型符号 ${n} 的类型或解释不匹配`);
  [...premises,goal].forEach(f=>finiteShape(f,parts.sig,model.carrier,model.elements.length));
  const values=premises.map(f=>evaluateFormulaWithWitness(f,model,parts.sig));
  const result=evaluateFormulaWithWitness(goal,model,parts.sig);
  const expected={premises:values.map(v=>v.value),goal:result.value};
  const canonicalModel={...model,ops:Object.fromEntries(Object.entries(model.ops).map(([n,o])=>[n,{...o,type:parseType(o.type)}]))};
  return {status:'witness-candidate',input:relationInput(r,context),payload:{schema:'mcs-witness/1',mode:'finite',kind:r.kind,sig:parts.sig,model:canonicalModel,premises,goal},expected,evidence:'FINITE',witness:result.witnessSummary,
    message:r.kind==='counterexampleTo'?'有限反模型重放通过：全部假设为真，结论为假。只反驳此精确表达。':'有限实例重放通过：全部输入与结论在此载体上为真。未推广到其他对象。'};
}
export function verifyWitness(prepared,report){
  need(report.payloadHash===digest(prepared.payload),'独立检查输入摘要不匹配');
  if(report.status!=='passed')return {status:report.status,input:prepared.input,message:report.message};
  need(digest(report.result)===digest(prepared.expected),'独立检查结果与本机求值不一致');
  return {status:'passed',input:prepared.input,message:prepared.message,evidence:prepared.evidence,scope:prepared.payload.mode==='reference'?'来源登记与无环检查':'给定有限载体与完整表',witness:prepared.witness,result:report.result,checker:report.checker,checkerSha256:report.checkerSha256,payloadHash:report.payloadHash,checkedAt:new Date().toISOString()};
}
