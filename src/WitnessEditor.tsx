import type {FormalSource,RelationWitness} from './types';

export const FINITE_EXAMPLE={id:'two-element-map',carrier:'V',elements:['0','1'],consts:{a:'0',b:'1'},ops:{f:{type:'V -> V',table:['0','0']}}};
export function parseDeclarations(text:string){
  const pairs=text.split('\n').filter(l=>l.trim()).map(l=>{const at=l.indexOf(':');if(at<1)throw new Error('符号声明使用“名称: 类型”，每行一项。');return [l.slice(0,at).trim(),l.slice(at+1).trim()];});
  if(new Set(pairs.map(p=>p[0])).size!==pairs.length)throw new Error('符号名称重复');
  return Object.fromEntries(pairs);
}
export function parseDefinitions(text:string){
  return text.split('\n').filter(l=>l.trim()).map(l=>{const colon=l.indexOf(':'),equals=l.indexOf(':=');if(colon<1||equals<=colon)throw new Error('定义使用“名称: 类型 := 定义体”，每行一项。');return {name:l.slice(0,colon).trim(),type:l.slice(colon+1,equals).trim(),source:l.slice(equals+2).trim()};});
}
export interface SourceDraft {declarations:string;definitions:string;version:string}
export function sourceDraft(s:FormalSource|undefined,version:string):SourceDraft{return {version:s?.version??version,declarations:s?Object.entries(s.declarations).map(([n,t])=>`${n}: ${t}`).join('\n'):'',definitions:s?.definitions.map(d=>`${d.name}: ${d.type} := ${d.source}`).join('\n')??''};}
export function WitnessEditor({kind,inputs,title,versions,sourceDrafts,onSource,mode,onMode,terms,onTerms,model,onModel,symbols,onSymbols}:{kind:string;inputs:string[];title:(id:string)=>string;versions:Record<string,string>;sourceDrafts:Record<string,SourceDraft>;onSource:(id:string,key:'declarations'|'definitions',value:string)=>void;mode:RelationWitness['mode'];onMode:(mode:RelationWitness['mode'])=>void;terms:string;onTerms:(s:string)=>void;model:string;onModel:(s:string)=>void;symbols:string;onSymbols:(s:string)=>void}){
  if(!['definitionReference','instanceOf','counterexampleTo'].includes(kind))return null;
  return <fieldset className="mcs-witness"><legend>这条关系的核验依据</legend>
    {kind==='definitionReference'?<>
      <p>输入节点提供定义，输出陈述使用它们。这里登记“谁引入符号”；普通局部声明不会成为来源。每个定义都是无自由变量的有类型项。</p>
      {inputs.map(id=>{const d=sourceDrafts[id]??sourceDraft(undefined,versions[id]);return <details key={id} open><summary>定义来源：{title(id)} · {versions[id]}</summary>{d.version!==versions[id]&&<p role="alert">此来源版本已过期，修改并核对后才能更新。</p>}<label>已有背景符号<textarea aria-label={`背景符号：${title(id)}`} rows={2} value={d.declarations} onChange={e=>onSource(id,'declarations',e.target.value)} placeholder="a: V"/></label><label>引入的定义<textarea aria-label={`引入的定义：${title(id)}`} rows={3} value={d.definitions} onChange={e=>onSource(id,'definitions',e.target.value)} placeholder="I: V -> V := λx:V. x"/></label></details>;})}
      <label>输出实际使用的定义符号（逗号或空格分隔）<input value={symbols} onChange={e=>onSymbols(e.target.value)} placeholder="I"/></label>
      <p>示例：来源引入 I: V → V := λx:V. x；输出声明 a: V，并写 I a = a。通过只确认引用成立，等式另需证明。</p>
    </>:<>
      {kind==='instanceOf'&&<label>实例核验方式<select aria-label="实例核验方式" value={mode==='finite'?'finite':'instantiate'} onChange={e=>onMode(e.target.value as 'finite'|'instantiate')}><option value="instantiate">全称模式的精确代入</option><option value="finite">给定有限对象的满足见证</option></select></label>}
      {kind==='instanceOf'&&mode!=='finite'?<><label>代入项（每行一项，依最外层 ∀ 的顺序）<textarea value={terms} onChange={e=>onTerms(e.target.value)} rows={3} placeholder="a"/></label><p>示例：输入 ∀x:V. x = x，代入 a，输出 a = a。a 须已声明为 V；未消去的量词须保留。</p></>:<><label>有限对象与完整运算表<textarea value={model} onChange={e=>onModel(e.target.value)} rows={10} spellCheck={false}/></label><p>elements 的顺序确定表的行列。consts 为常元取值，ops 为完整一元／二元表。限 1–8 个元素、32 个符号与有界一阶公式。有限载体不代表实数或全部向量空间。</p><p>{kind==='counterexampleTo'?'示例：声明 a: V、b: V、f: V → V；输入 f a = f b，输出 a = b。默认两元素表把 a、b 都送到 0，提供删去单射条件的反例。':'输入与输出必须都在这个对象上为真；通过仍只说明这个有限实例。'}</p></>}
    </>}
  </fieldset>;
}
