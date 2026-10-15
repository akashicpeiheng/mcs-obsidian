import { useEffect, useMemo, useRef, useState } from 'react';
import { clone, exportBundle, importBundle, planLearning, recommendations, relationState, replayFrame, validateRelation } from './core.mjs';
import { arrange, increment } from './graph';
import { parseImports } from './migration.mjs';
import { GraphCanvas,type GraphApi,type GraphCommand,type GraphSnapshot } from './GraphCanvas';
import { AUTHOR_LABEL, BRAND } from './brand';
import type { CheckReport, Content, Host, MathNode, Relation, Route, ViewDocument, RelationWitness, FormalSource } from './types';
import {WitnessEditor,FINITE_EXAMPLE,parseDeclarations,parseDefinitions,sourceDraft,type SourceDraft} from './WitnessEditor';

const KIND_LABELS:Record<string,string>={conditionalDerivation:'条件推导',equivalentTo:'等价',scaling:'放缩（特殊 → 一般）',definitionReference:'定义引用',instanceOf:'实例',counterexampleTo:'反例',analogy:'类比',topic:'话题关联'};
const STATES:Record<string,string>={unchecked:'待检查',stale:'证据已过期',verified:'形式检查通过 · 对应已审阅','alignment-pending':'形式检查通过 · 对应待审阅',unsupported:'尚不支持此检查',timeout:'搜索超时',undecided:'未得到证明',failed:'核验未通过',error:'检查运行失败',passed:'形式检查通过'};

/** 顶栏字标与空白引导徽记都取站点现用图片，本地打包、按原比例缩放。 */
function BrandMark({host,className}:{host:Host;className:string}) {
  const src=host.asset('wordmark');
  if(!src)return <span className={className}>MCS</span>;
  return <img className={className} src={src} alt="MCS 数学认知空间" width={132}/>;
}
function Emblem({host,className='mcs-emblem'}:{host:Host;className?:string}) {
  const src=host.asset('emblem');
  if(!src)return null;
  return <img className={className} src={src} alt="" aria-hidden="true"/>;
}

function Markdown({text,host}:{text:string;host:Host}) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>root.current?host.renderMarkdown(text,root.current):undefined,[text,host]);
  return <div className="mcs-markdown" ref={root}/>;
}

function RelationReport({report,stale}:{report:CheckReport;stale:boolean}){
  const result=report.result as {premises?:boolean[];goal?:boolean;references?:{symbol:string;node:string;version:string}[]}|undefined;
  const witness=report.witness as {path?:unknown[];equation?:{text?:unknown}}|undefined;
  const explanation=[...new Set([...(Array.isArray(witness?.path)?witness.path:[]),witness?.equation?.text].filter((s):s is string=>typeof s==='string'))];
  return <details className="mcs-check-report"><summary>{stale?'旧报告（已过期，需重新核验）':'核验范围与见证'}</summary><p>{report.message}</p>{report.evidence!==undefined&&<small>{String(report.evidence)} · {String(report.scope??'')}</small>}{result?.premises&&<p>输入：{result.premises.map((p,i)=>`${i+1}=${p?'真':'假'}`).join('；')}；结论：{result.goal?'真':'假'}</p>}{result?.references?.map(ref=><p key={ref.symbol}>{ref.symbol} ← {ref.node}@{ref.version}</p>)}{explanation.map(s=><p key={s}>{s}</p>)}</details>;
}

function ExampleChecks({host}:{host:Host}){
  const [running,setRunning]=useState(false),[report,setReport]=useState<CheckReport|null>(null),[error,setError]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function run(){const c=new AbortController();controller.current=c;setRunning(true);setReport(null);setError('');try{setReport(await host.checkExamples(c.signal));}catch(e){if(!c.signal.aborted)setError((e as Error).message);}finally{setRunning(false);}}
  const targets=report?.targets as {declaration:string;expected:string;axioms:string[];targetMatched:boolean}[]|undefined;
  return <article className="mcs-relation"><strong>教材示范核心 · Lean</strong><p>检查可逆变换、特解加核、秩与零度三个固定目标。先在插件设置准备工具链与 mathlib。</p><button disabled={running} onClick={()=>void run()}>{running?'本机核验中…':'核验三个示范目标'}</button>{running&&<button onClick={()=>controller.current?.abort()}>取消示范核验</button>}{report&&<><small>{report.status==='passed'?'Lean 编译与独立内核重放通过':'本次没有通过'} · 教材对应待审阅</small><p>{String(report.scope??report.message??'')}</p>{targets?.map(t=><details key={t.declaration}><summary>{t.declaration.split('.').at(-1)}</summary><p>精确目标：{t.expected}</p><p>公理：{t.axioms.join('、')}</p></details>)}</>}{error&&<p role="alert" className="mcs-error">{error}</p>}<small>此报告只覆盖上述固定目标。其他用户关系各自检查。</small></article>;
}

function RelationEditor({content,view,initial,selected,onSave,onClose}:{content:Content;view:ViewDocument;initial:Relation|null;selected:string|null;onSave:(r:Relation,sources:Record<string,FormalSource>)=>void;onClose:()=>void}) {
  const [kind,setKind]=useState(initial?.kind??'conditionalDerivation');
  const [inputs,setInputs]=useState(initial?.inputs??(selected?[selected]:[]));
  const [output,setOutput]=useState(initial?.output??content.nodes.find(n=>n.id!==selected)?.id??'');
  const [explanation,setExplanation]=useState(initial?.explanation??'');
  const [advanced,setAdvanced]=useState(Boolean(initial?.formal));
  const [declarations,setDeclarations]=useState(initial?.formal?Object.entries(initial.formal.declarations).map(([n,t])=>`${n}: ${t}`).join('\n'):'P: o\nQ: o');
  const [premises,setPremises]=useState(initial?.formal?.premises.join('\n')??'P');
  const [goal,setGoal]=useState(initial?.formal?.goal??'P');
  const [reviewed,setReviewed]=useState(initial?.sourceReviewed??false);
  const [error,setError]=useState('');
  const witness=initial?.formal?.witness;
  const [mode,setMode]=useState<RelationWitness['mode']>(witness?.mode??'instantiate');
  const [terms,setTerms]=useState(witness?.mode==='instantiate'?witness.terms.join('\n'):'a');
  const [model,setModel]=useState(JSON.stringify(witness?.mode==='finite'?witness.model:FINITE_EXAMPLE,null,2));
  const [symbols,setSymbols]=useState(witness?.mode==='reference'?witness.references.map(r=>r.symbol).join(', '):'I');
  const [sourceDrafts,setSourceDrafts]=useState<Record<string,SourceDraft>>(()=>Object.fromEntries(Object.entries(view.formalSources??{}).map(([id,s])=>[id,sourceDraft(s,s.version)])));
  const versions=Object.fromEntries(content.nodes.map(n=>[n.id,n.version]));
  const sources=()=>Object.fromEntries(Object.entries(sourceDrafts).map(([id,d])=>[id,{version:d.version,declarations:parseDeclarations(d.declarations),definitions:parseDefinitions(d.definitions)}]));
  const dialog=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;return()=>previous?.focus();},[]);
  const invalidate=()=>setReviewed(false);
  function save(){try{
    const r:Relation={id:initial?.id??crypto.randomUUID(),kind,inputs,output,explanation,nodeVersions:Object.fromEntries([...inputs,output].map(id=>[id,content.nodes.find(n=>n.id===id)!.version])),sourceReviewed:reviewed};
    if(advanced){
      r.formal={declarations:parseDeclarations(declarations),premises:premises.split('\n').filter(l=>l.trim()),goal};
      if(kind==='definitionReference'){
        const definitions=sources();
        r.formal.witness={mode:'reference',references:symbols.split(/[\s,，]+/).filter(Boolean).map(symbol=>{const matches=Object.entries(definitions).filter(([,s])=>s.definitions.some(d=>d.name===symbol));if(matches.length!==1)throw new Error(`符号 ${symbol} 须有唯一的引入节点`);const [node,s]=matches[0];return {symbol,node,version:s.version};})};
      }else if(kind==='instanceOf'&&mode!=='finite')r.formal.witness={mode:'instantiate',terms:terms.split('\n').filter(t=>t.trim())};
      else if(kind==='counterexampleTo'||kind==='instanceOf')r.formal.witness={mode:'finite',model:JSON.parse(model)};
    }
    validateRelation(r,content);onSave(r,sources());
  }catch(e){setError((e as Error).message);}}
  return <div className="mcs-modal-shade"><section ref={dialog} className="mcs-modal" role="dialog" aria-modal="true" aria-label="关系编辑器" onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const all=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea');if(all?.length){const first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}}>
    <header><div><span className="mcs-eyebrow">RELATION STUDIO</span><h2>{initial?'编辑关系':'让一条关系有据可查'}</h2></div><button onClick={onClose} aria-label="关闭关系编辑器">×</button></header>
    <p>先说明为什么成立，再把条件交给检查器。多个输入共同构成前提。</p>
    <label>关系类型<select aria-label="关系类型" value={kind} onChange={e=>{setKind(e.target.value);invalidate();}}>{Object.entries(KIND_LABELS).map(([id,t])=><option key={id} value={id}>{t}</option>)}</select></label>
    <label>联合输入（按住 Ctrl 多选；形式前提按此处列表顺序）<select multiple size={5} value={inputs} onChange={e=>{setInputs([...e.target.selectedOptions].map(o=>o.value));invalidate();}}>{content.nodes.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
    <label>输出<select aria-label="输出" value={output} onChange={e=>{setOutput(e.target.value);invalidate();}}>{content.nodes.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
    <label>为什么成立，有哪些条件与边界？<textarea value={explanation} onChange={e=>{setExplanation(e.target.value);invalidate();}} rows={3} autoFocus/></label>
    <label className="mcs-check"><input type="checkbox" checked={advanced} onChange={e=>{setAdvanced(e.target.checked);invalidate();}}/>编辑形式表达</label>
    {advanced&&<><div className="mcs-formal-grid"><label>符号与类型<textarea aria-label="符号与类型" value={declarations} onChange={e=>{setDeclarations(e.target.value);invalidate();}} rows={3}/></label><label>输入陈述，每行对应一个输入节点<textarea aria-label="输入陈述，每行对应一个输入节点" value={premises} onChange={e=>{setPremises(e.target.value);invalidate();}} rows={3}/></label><label>输出陈述<input aria-label="输出陈述" value={goal} onChange={e=>{setGoal(e.target.value);invalidate();}}/></label><p>支持 ∧、→、∀、∃ 与有类型等式。P、Q 是逻辑符号，不能仅凭命名就视为已经准确编码教材定理。定义引用的输入陈述仅作背景展示，不自动作为证明。</p></div><WitnessEditor kind={kind} inputs={inputs} title={id=>content.nodes.find(n=>n.id===id)?.title??id} versions={versions} sourceDrafts={sourceDrafts} onSource={(id,key,value)=>{setSourceDrafts(old=>({...old,[id]:{...(old[id]??sourceDraft(undefined,versions[id])),[key]:value,version:versions[id]}}));invalidate();}} mode={mode} onMode={m=>{setMode(m);invalidate();}} terms={terms} onTerms={s=>{setTerms(s);invalidate();}} model={model} onModel={s=>{setModel(s);invalidate();}} symbols={symbols} onSymbols={s=>{setSymbols(s);invalidate();}}/></>}
    <label className="mcs-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已逐项核对节点、条件与形式表达的对应</label>
    {error&&<p role="alert" className="mcs-error">{error}</p>}
    <footer><button onClick={onClose}>取消</button><button className="mcs-primary" onClick={save}>保存关系草稿</button></footer>
  </section></div>;
}

export function App({content,initial,host,initialKnown=[]}:{content:Content;initial:ViewDocument;host:Host;initialKnown?:string[]}) {
  const [view,setView]=useState<ViewDocument>(initial), current=useRef(initial);
  const rev=useRef(initial.revision), generation=useRef(0), saved=useRef(0), busy=useRef<Promise<void>|null>(null);
  const [saveState,setSaveState]=useState('已保存'), [error,setError]=useState('');
  const [query,setQuery]=useState(''),[chapter,setChapter]=useState(''),[selected,setSelected]=useState<string|null>(initial.added[0]??null);
  const [tab,setTab]=useState<'nodes'|'relations'|'learn'>('nodes');
  const [known,setKnown]=useState(initialKnown),[simulated,setSimulated]=useState<string[]>(initialKnown),[simulation,setSimulation]=useState(false);
  const [confirming,setConfirming]=useState(false);
  const [editor,setEditor]=useState<Relation|null|undefined>(undefined);
  const [reports,setReports]=useState<Map<string,CheckReport>>(new Map()),[checking,setChecking]=useState<string|null>(null),controller=useRef<AbortController|null>(null);
  const [step,setStep]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [template,setTemplate]=useState(content.templates[0]?.id??''),[routes,setRoutes]=useState<Route[]>([]),[planMessage,setPlanMessage]=useState('');
  const [keepLocked,setKeepLocked]=useState(true),[detail,setDetail]=useState(false);
  const [importPreview,setImportPreview]=useState<ReturnType<typeof importBundle>|null>(null);
  const [importOptions,setImportOptions]=useState<{content:Content;view:ViewDocument;warnings:string[]}[]>([]),[importChoice,setImportChoice]=useState(0);
  const undo=useRef<ViewDocument[]>([]),fileInput=useRef<HTMLInputElement>(null),canvas=useRef<GraphApi>(null);
  const [graphCommand,setGraphCommand]=useState<GraphCommand>({epoch:0,kind:'restore'});
  const [layoutRunning,setLayoutRunning]=useState(false),motionRunning=useRef(false);
  const workbench=useRef<HTMLDivElement>(null),[compact,setCompact]=useState(false),[panelChoice,setPanelChoice]=useState<boolean|null>(null);
  const workspace=useRef<HTMLDivElement>(null),toolbar=useRef<HTMLDivElement>(null),overlays=useRef<HTMLDivElement>(null);
  const panelOpen=panelChoice??!compact;
  const activeKnown=simulation?simulated:known;
  const names=useMemo(()=>new Map(content.nodes.map(n=>[n.id,n.title])),[content]);
  const title=(id:string)=>names.get(id)??id;
  function liveView(){const state=canvas.current?.snapshot();return state?{...current.current,positions:{...current.current.positions,...state.positions},camera:state.camera}:current.current;}
  function beginGraphOperation(){undo.current.push(clone(liveView()));if(undo.current.length>50)undo.current.shift();}
  function commitGraph(state:GraphSnapshot,locked?:string[]){
    const previous=current.current,positions={...previous.positions,...state.positions};
    if(JSON.stringify(positions)===JSON.stringify(previous.positions)&&JSON.stringify(state.camera)===JSON.stringify(previous.camera)&&(locked===undefined||JSON.stringify(locked)===JSON.stringify(previous.locked)))return;
    update({...previous,positions,camera:state.camera,locked:locked??previous.locked},false);
  }
  function capture(){const state=canvas.current?.stop();if(state)commitGraph(state);return current.current;}
  function update(next:ViewDocument|((v:ViewDocument)=>ViewDocument),remember=true,command?:GraphCommand['kind']){
    const previous=liveView();
    if(remember)undo.current.push(clone(previous));
    if(undo.current.length>50)undo.current.shift();
    const value=typeof next==='function'?next(previous):next;
    current.current=value;generation.current++;setView(value);setSaveState('未保存');
    if(command)setGraphCommand(c=>({epoch:c.epoch+1,kind:command}));
  }
  async function persist(){
    capture();
    if(busy.current)return busy.current;
    if(saved.current>=generation.current)return;
    const job=(async()=>{try{while(saved.current<generation.current){
      const g=generation.current;setSaveState('正在保存');
      const result=await host.save({...current.current,revision:rev.current});rev.current=result.revision;saved.current=g;
    }setSaveState('已保存');}catch(e){setSaveState('保存失败 · 请另存');setError((e as Error).message);throw e;}finally{busy.current=null;}})();
    busy.current=job;return job;
  }
  useEffect(()=>{if(layoutRunning)return;const timer=setTimeout(()=>{if(!motionRunning.current)void persist().catch(()=>{});},450);return()=>clearTimeout(timer);},[view,layoutRunning]);
  useEffect(()=>host.setFlush(persist),[host]);
  useEffect(()=>host.watchKnown(setKnown),[host]);
  useEffect(()=>host.watchBindings((oldPath,newPath,before,after)=>{if(rev.current===before)rev.current=after;update(v=>({...v,bindings:Object.fromEntries(Object.entries(v.bindings).map(([id,path])=>[id,path===oldPath?newPath:path]))}),false);}),[host]);
  useEffect(()=>host.watchExpand((id,binding)=>{capture();update(v=>{const next=increment(content,v,[id]) as ViewDocument;return {...(canvas.current?.seed(next)??next),bindings:{...v.bindings,[id]:binding}};},true,'grow');setSelected(id);setDetail(true);setTab('nodes');requestAnimationFrame(()=>canvas.current?.focus(id));}),[host]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setCompact(entries[0].contentRect.width<520));if(workbench.current)observer.observe(workbench.current);return()=>observer.disconnect();},[]);
  /*
   * 工具栏与底部浮层的高度随容器宽度换行而变，阅读面板在窄窗要按真实几何让位：
   * 这里量一次，把「工具栏下沿」与「浮层带高度」写进 CSS 变量，容器查询里的
   * 阅读面板据此收缩，工具栏与播放控件不会被面板压住。
   */
  useEffect(()=>{
    const host=workspace.current;if(!host)return;
    const measure=()=>{
      const box=host.getBoundingClientRect(),bar=toolbar.current?.getBoundingClientRect(),strip=overlays.current?.getBoundingClientRect();
      host.style.setProperty('--mcs-toolbar-space',`${Math.ceil(bar?bar.bottom-box.top+12:120)}px`);
      host.style.setProperty('--mcs-overlay-space',`${Math.ceil(strip&&strip.height>0?box.bottom-strip.top+16:64)}px`);
    };
    measure();
    const observer=new ResizeObserver(measure);
    for(const node of [host,toolbar.current,overlays.current])if(node)observer.observe(node);
    return()=>observer.disconnect();
  },[detail,selected]);
  useEffect(()=>{
    if(!playing||!view.route)return;
    const timer=setInterval(()=>setStep(s=>{if(s>=view.route!.events.length){setPlaying(false);return s;}return s+1;}),1600/speed);
    return()=>clearInterval(timer);
  },[playing,speed,view.route]);
  const frame=useMemo(()=>view.route?replayFrame(view.route,content,step,activeKnown):null,[view.route,step,activeKnown,content]);
  const ranked=useMemo(()=>recommendations(content,view,known),[content,view.added,view.relations,known]);
  const candidates=useMemo(()=>ranked.filter((r: {node:MathNode})=>(!chapter||r.node.chapter===chapter)&&(`${r.node.title} ${r.node.summary}`).toLowerCase().includes(query.toLowerCase())),[ranked,chapter,query]);
  const node=content.nodes.find(n=>n.id===selected);
  function add(ids:string[]){update(v=>{const next=increment(content,v,ids) as ViewDocument;return canvas.current?.seed(next)??next;},true,'grow');if(ids.length)setSelected(ids[0]);}
  function remove(id:string){update(v=>({...v,added:v.added.filter(n=>n!==id),locked:v.locked.filter(n=>n!==id),layout:{...v.layout,anchor:v.layout.anchor===id?null:v.layout.anchor}}),true,'grow');setSelected(null);}
  function fit(){canvas.current?.fit();}
  function rearrange(mode=view.layout.mode){if(mode==='learning'&&!current.current.route){setError('先在学习沙盘生成路线，再按事件依赖排列。');return;}capture();update(v=>arrange(content,{...v,layout:{...v.layout,mode}},keepLocked),true,'arrange');}
  function changeTab(next:'nodes'|'relations'|'learn'){capture();setPlaying(false);setTab(next);}
  function plan(){try{
    const t=content.templates.find(t=>t.id===template)!;
    const result=planLearning(content,t.goal,activeKnown,t.actions);
    setRoutes(result.routes as Route[]);setPlanMessage(`${result.status} · ${result.routes.length} 条候选；条件入口需确认或在沙盘中假设。`);
    if(result.routes[0])selectRoute(result.routes[0] as Route);
  }catch(e){setError((e as Error).message);}}
  function selectRoute(route:Route){capture();const ids=[...new Set([...route.initial,...route.events.flatMap(e=>e.provides.map(o=>o.node))])];update(v=>arrange(content,{...increment(content,v,ids),route,layout:{mode:'learning',anchor:route.initial[0]??null}},true),true,'arrange');setStep(0);setPlaying(false);}
  async function check(r:Relation){controller.current?.abort();const c=new AbortController();controller.current=c;setChecking(r.id);try{const report=await host.check(r,c.signal,current.current);if(!c.signal.aborted&&controller.current===c)setReports(old=>new Map(old).set(r.id,report));}catch(e){if(!c.signal.aborted)setError((e as Error).message);}finally{if(controller.current===c)setChecking(null);}}
  async function openNote(n:MathNode){try{const binding=await host.openNote(n,view.bindings[n.id]);if(binding)update(v=>({...v,bindings:{...v.bindings,[n.id]:binding}}));}catch(e){setError((e as Error).message);}}
  function download(){const value=capture();const blob=new Blob([JSON.stringify(exportBundle(content,{...value,revision:rev.current}),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${view.name.replace(/[\\/:*?"<>|]/g,'_')}.mcspack.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <div ref={workbench} className={`mcs-app ${panelOpen?'mcs-panel-open':'mcs-panel-hidden'}`}>
    <header className="mcs-top"><div className="mcs-brand"><BrandMark host={host} className="mcs-wordmark"/></div><div className="mcs-title"><span className="mcs-eyebrow">数学认知空间 / OBSIDIAN</span><input aria-label="视图名称" value={view.name} onChange={e=>update(v=>({...v,name:e.target.value}))}/></div><span className="mcs-save-state">{saveState}</span><button className="mcs-sidebar-toggle" aria-label="展开或收起工作面板" aria-expanded={panelOpen} onClick={()=>setPanelChoice(!panelOpen)}>面板</button><button onClick={()=>void persist().catch(()=>{})}>保存</button><button onClick={()=>{const value=capture();void host.saveAs({...value,revision:0,id:crypto.randomUUID(),name:`${value.name}（副本）`},content).catch(e=>setError(e.message));}}>另存</button><button onClick={host.openLibrary}>视图库</button><button onClick={download}>导出</button><button onClick={()=>fileInput.current?.click()}>导入</button><input hidden type="file" accept=".json,.mcspack" ref={fileInput} onChange={async e=>{try{const f=e.target.files?.[0];if(!f)return;if(f.size>12e6)throw new Error('导入包超过12MB');const choices=parseImports(JSON.parse(await f.text()),content,(ids:string[],positions:ViewDocument['positions'])=>increment(content,{...initial,added:ids.filter(id=>positions[id]),positions},ids).positions);setImportOptions(choices);setImportChoice(0);setImportPreview(choices[0]);}catch(err){setError((err as Error).message);}e.target.value='';}}/></header>
    {error&&<div className="mcs-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="关闭错误">×</button></div>}
    <div className="mcs-workspace" ref={workspace}>
      <aside className="mcs-sidebar"><nav aria-label="工作面板">{(['nodes','relations','learn'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>changeTab(t)}>{t==='nodes'?'加入节点':t==='relations'?'关系工作室':'学习沙盘'}</button>)}</nav>
        <div className="mcs-sidebar-body">
        {tab==='nodes'&&<><div className="mcs-panel-head"><span className="mcs-eyebrow">GROW YOUR NETWORK</span><h2>从一个问题开始</h2><p>选择想理解的对象，让网络逐步生长。</p></div><input aria-label="搜索数学节点" placeholder="搜索概念、定理、方法…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="章节筛选" value={chapter} onChange={e=>setChapter(e.target.value)}><option value="">全部章节</option>{[...new Set(content.nodes.map(n=>n.chapter))].map(c=><option key={c}>{c}</option>)}</select><div className="mcs-list-heading"><strong>{query?'搜索结果':'推荐加入'}</strong><span>{candidates.length} 个可选</span></div><div className="mcs-node-list">{candidates.map((r:{node:MathNode;reason:string;ready:boolean;missing:string[]})=><article key={r.node.id} className="mcs-pick"><button className="mcs-pick-title" onClick={()=>{setSelected(r.node.id);setDetail(true);}}>{r.node.title}</button><p>{r.reason}</p>{r.missing.length>0&&<small>图中尚缺：{r.missing.map(title).join('、')}</small>}<div><span className="mcs-chip">{r.ready?'已确认前提可用':'未确认掌握'}</span><button aria-label={`加入 ${r.node.title}`} onClick={()=>add([r.node.id])}>＋ 加入</button></div></article>)}</div></>}
        {tab==='relations'&&<><div className="mcs-panel-head"><span className="mcs-eyebrow">EVERY EDGE HAS A REASON</span><h2>让关系可以追问</h2><p>教学连线表达所选方案。形式关系另有条件、结论与证据。</p></div><button className="mcs-primary" onClick={()=>setEditor(null)}>＋ 创建关系</button><label className="mcs-check"><input type="checkbox" checked={view.showActions} onChange={e=>update(v=>({...v,showActions:e.target.checked}))}/>显示教学行动的联合前提</label><label className="mcs-check"><input type="checkbox" checked={view.showRelations} onChange={e=>update(v=>({...v,showRelations:e.target.checked}))}/>显示已登记的形式关系</label>{!view.relations.length&&<p className="mcs-muted">选择节点并创建第一条关系。拖动连线不会自动产生数学证明。</p>}{view.relations.map(r=><article key={r.id} className="mcs-relation"><strong>{r.inputs.map(title).join(' ＋ ')} → {title(r.output)}</strong><span className="mcs-chip">{KIND_LABELS[r.kind]}</span><p>{r.explanation}</p><small>{STATES[relationState(r,content,reports,view)]??relationState(r,content,reports,view)}</small>{reports.get(r.id)&&<RelationReport report={reports.get(r.id)!} stale={relationState(r,content,reports,view)==='stale'}/>}<div className="mcs-button-row"><button onClick={()=>setEditor(r)}>编辑</button><button disabled={checking!==null} onClick={()=>void check(r)}>{checking===r.id?'检查中…':'形式检查'}</button><button onClick={()=>update(v=>({...v,relations:v.relations.filter(x=>x.id!==r.id)}))}>移除</button></div></article>)}{checking&&<button onClick={()=>controller.current?.abort()}>取消检查</button>}<ExampleChecks host={host}/></>}
        {tab==='learn'&&<><div className="mcs-panel-head"><span className="mcs-eyebrow">FOLLOW THE REASONING</span><h2>看见每一步的依据</h2><p>先选路线，再改变背景观察哪些步骤可执行。</p></div><label>范例路径<select value={template} onChange={e=>setTemplate(e.target.value)}>{content.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="mcs-primary" onClick={plan}>生成候选路线</button><p className="mcs-muted">{planMessage}</p>{routes.length>1&&<label>备选路线<select onChange={e=>selectRoute(routes[Number(e.target.value)])}>{routes.map((r,i)=><option key={r.id} value={i}>路线 {i+1} · {r.events.length} 步</option>)}</select></label>}<label className="mcs-check"><input type="checkbox" checked={simulation} onChange={e=>{setSimulation(e.target.checked);if(e.target.checked)setSimulated([...known]);setPlaying(false);}}/>沙盘：使用独立的假设背景</label><p className="mcs-muted">{simulation?'下面的假设不写入真实学习记录。':'浏览与回放均不会自动确认掌握。'}</p>{view.route?.initial.map(id=><label className="mcs-check" key={id}><input type="checkbox" disabled={!simulation} checked={activeKnown.includes(id)} onChange={e=>setSimulated(s=>e.target.checked?[...new Set([...s,id])]:s.filter(x=>x!==id))}/>{title(id)}</label>)}{frame?.current&&<article className="mcs-step"><span className="mcs-eyebrow">第 {frame.step} 步</span><h3>{frame.current.action.title}</h3><p>实际输入：{frame.current.uses.map(title).join('、')||'无'}</p><p>产出：{frame.current.action.outputs.map((o:{node:string})=>title(o.node)).join('、')}</p>{frame.current.missing.length?<p className="mcs-error">前提未确认：{frame.current.missing.map(title).join('、')}</p>:<p className="mcs-success">在当前背景模型下可执行</p>}</article>}</>}
        </div>
        <footer className="mcs-attribution"><span>{AUTHOR_LABEL}：<strong>{BRAND.author}</strong></span><a href={BRAND.mailto} title={`联系 ${BRAND.author}`}>{BRAND.email}</a></footer>
      </aside>
      <main className="mcs-canvas-area"><div className="mcs-canvas-toolbar" ref={toolbar}><span>{view.added.length} 个节点</span><select aria-label="布局规则" value={view.layout.mode} onChange={e=>rearrange(e.target.value as ViewDocument['layout']['mode'])}><option value="free">自由布局</option><option value="learning">学习顺序</option><option value="logic">逻辑核心</option></select><select aria-label="布局锚点" value={view.layout.anchor??''} onChange={e=>update(v=>({...v,layout:{...v.layout,anchor:e.target.value||null}}))}><option value="">自动选择核心</option>{view.added.map(id=><option key={id} value={id}>{title(id)}</option>)}</select><button onClick={()=>rearrange()}>重排</button><label className="mcs-check"><input type="checkbox" checked={keepLocked} onChange={e=>setKeepLocked(e.target.checked)}/>保留锁定</label><button onClick={fit}>适配</button><label className="mcs-check"><input aria-label="动态布局" type="checkbox" checked={view.display.motion==='auto'} onChange={e=>{const motion=e.target.checked?'auto':'off';capture();update(v=>({...v,display:{...v.display,motion}}));}}/>动态</label><button onClick={()=>{capture();const old=undo.current.pop();if(old)update(old,false,'restore');}}>撤销</button></div>
        <GraphCanvas ref={canvas} content={content} view={view} selected={selected} known={known} reports={reports} command={graphCommand}
          learning={tab==='learn'&&frame?{visible:frame.visible,uses:frame.current?.uses??[],added:frame.current?.added??[],missing:frame.current?.missing??[],actionId:frame.current?.action.id??null,step,playing,speed}:null}
          onSelect={setSelected} onRead={id=>{setSelected(id);setDetail(true);}} onRemove={remove} onEdit={r=>{setEditor(r);setTab('relations');}}
          onBegin={beginGraphOperation} onCommit={commitGraph} onRunning={value=>{motionRunning.current=value;setLayoutRunning(value);}}/>

        {!view.added.length&&<div className="mcs-empty"><Emblem host={host}/><span className="mcs-eyebrow">A SPACE FOR UNDERSTANDING</span><h1>把想法放进来，<br/>看它们怎样连起来。</h1><p>从左侧加入一个节点，或打开一条示范路线。</p><button className="mcs-primary" onClick={()=>add(['jiang:field-axioms','jiang:elementary-row-operations','jiang:matrix-operations'])}>从“消元为何有效”开始</button></div>}
        <div className="mcs-overlays" ref={overlays}>{selected&&node&&<div className="mcs-selection"><strong>{node.title}</strong><button onClick={()=>setDetail(true)}>阅读</button><button onClick={()=>void openNote(node)}>打开笔记</button>{view.added.includes(selected)?<button onClick={()=>remove(selected)}>移出视图</button>:<button onClick={()=>add([selected])}>加入</button>}<button onClick={()=>setEditor(null)}>建立关系</button>{view.added.includes(selected)&&<button onClick={()=>{capture();update(v=>({...v,locked:v.locked.includes(selected)?v.locked.filter(id=>id!==selected):[...v.locked,selected]}),true,'grow');}}>{view.locked.includes(selected)?'解除固定':'固定位置'}</button>}</div>}
        {tab==='learn'&&frame&&<div className="mcs-player"><button onClick={()=>{setStep(0);setPlaying(false);}}>起点</button><button aria-label="上一步" onClick={()=>setStep(s=>Math.max(0,s-1))}>←</button><button className="mcs-primary" onClick={()=>setPlaying(p=>!p)}>{playing?'暂停':'播放'}</button><button aria-label="下一步" onClick={()=>setStep(s=>Math.min(frame.total,s+1))}>→</button><input aria-label="回放进度" type="range" min={0} max={frame.total} value={step} onChange={e=>{setStep(Number(e.target.value));setPlaying(false);}}/><span>{step} / {frame.total}</span><select aria-label="播放速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,1,2,4].map(s=><option key={s} value={s}>{s}×</option>)}</select></div>}
        </div><div className="mcs-canvas-foot">∧ 共同前提 · 滚轮缩放 · Shift 拖动固定 ·  {layoutRunning?'网络回稳中':'网络已稳定'}<span>{Math.round(view.camera.scale*100)}%</span></div>
      </main>
      {detail&&node&&<aside className="mcs-detail"><header><span className="mcs-eyebrow">NODE NOTE</span><button aria-label="关闭阅读" onClick={()=>setDetail(false)}>×</button></header><Markdown text={node.body} host={host}/><p className="mcs-muted">教材对应：{node.sourceReviewed?'已审阅':'待逐项审阅'} · {node.evidenceStatus}</p><div className="mcs-button-row"><button onClick={()=>void openNote(node)}>在 Obsidian 打开</button><button onClick={async()=>{const p=await host.chooseNote();if(p)update(v=>({...v,bindings:{...v.bindings,[node.id]:p}}));}}>绑定已有笔记</button></div><label className="mcs-check"><input type="checkbox" disabled={confirming} checked={known.includes(node.id)} onChange={async e=>{const yes=e.target.checked;setConfirming(true);setKnown(k=>yes?[...new Set([...k,node.id])]:k.filter(id=>id!==node.id));try{await host.confirm(node.id,yes);}catch(err){setKnown(k=>yes?k.filter(id=>id!==node.id):[...new Set([...k,node.id])]);setError((err as Error).message);}finally{setConfirming(false);}}}/>我确认已掌握此节点</label></aside>}
    </div>
    {editor!==undefined&&<RelationEditor content={content} view={view} initial={editor} selected={selected} onClose={()=>setEditor(undefined)} onSave={(r,formalSources)=>{update(v=>({...v,formalSources,relations:[...v.relations.filter(x=>x.id!==r.id),r]}));setEditor(undefined);setTab('relations');}}/>}
    {importPreview&&<div className="mcs-modal-shade"><section className="mcs-modal" role="dialog" aria-modal="true" aria-label="导入预览"><h2>导入为独立副本</h2>{importOptions.length>1&&<label>选择网站保存的视图<select value={importChoice} onChange={e=>{const i=Number(e.target.value);setImportChoice(i);setImportPreview(importOptions[i]);}}>{importOptions.map((v,i)=><option key={i} value={i}>{v.view.name}</option>)}</select></label>}{importOptions[importChoice]?.warnings.map((w:string,i:number)=><p key={i}>{w}</p>)}<p>{importPreview.view.name} · {importPreview.view.added.length} 个视图节点</p><p>内容版本：{importPreview.content.version.slice(0,16)}…</p><p>已有视图保留。导入报告不会自动成为本机有效证据，个人学习记录不导入。</p><footer><button onClick={()=>setImportPreview(null)}>取消</button><button className="mcs-primary" onClick={async()=>{try{await host.importBundle(exportBundle(importPreview.content,importPreview.view));setImportPreview(null);}catch(e){setError((e as Error).message);}}}>确认导入副本</button></footer></section></div>}
  </div>;
}
