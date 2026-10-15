import { makePlanner } from '../../mcs-web/core/planner.mjs';
import { createHash } from 'node:crypto';

export const VIEW_SCHEMA = 'mcs-view/2';
export const BUNDLE_SCHEMA = 'mcs-bundle/2';
export const RELATION_KINDS = ['definitionReference', 'scaling', 'equivalentTo', 'conditionalDerivation', 'instanceOf', 'counterexampleTo', 'analogy', 'topic'];
export const clone = (v) => structuredClone(v);
const unique = (v) => [...new Set(v)];
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const fail = (message) => { throw new Error(message); };

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(v=>stable(v??null)).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function contentHash(content) {
  return createHash('sha256').update(stable({...content,version:'pending'})).digest('hex');
}

export function verifyContentIdentity(content) {
  validateContent(content);
  if (content.version !== contentHash(content)) fail('内容哈希不匹配：快照内容已经改变，不能沿用旧版本标识');
  return content;
}

export function createView(content, name = '我的数学网络') {
  return { schema: VIEW_SCHEMA, id: crypto.randomUUID(), name, revision: 0, contentVersion: content.version,
    added: [], positions: {}, locked: [], layout: { mode: 'free', anchor: null }, camera: { x: 45, y: 70, scale: 1 },
    relations: [], formalSources: {}, bindings: {}, showRelations: true, showActions: true, route: null,
    display: { nodeMode:'adaptive', motion:'auto' } };
}

export function validateView(raw, content) {
  if (object(raw) && raw.schema === 'mcs-view/1') raw = {...raw,schema:VIEW_SCHEMA,display:{nodeMode:'adaptive',motion:'auto'}};
  if (!object(raw) || raw.schema !== VIEW_SCHEMA) fail('不支持的视图格式');
  raw={...raw,formalSources:raw.formalSources??{}};
  const fields=new Set(['schema','id','name','revision','contentVersion','added','positions','locked','layout','camera','relations','formalSources','bindings','showRelations','showActions','route','display']);
  if(Object.keys(raw).some(k=>!fields.has(k)))fail('视图含协议未定义字段；个人状态与证明报告须单独保存');
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name.trim()) fail('视图缺少 ID 或名称');
  if (!Number.isInteger(raw.revision) || raw.revision < 0) fail('视图修订号无效');
  if (raw.contentVersion !== content.version) fail('内容版本不匹配，请导入携带该版本内容的便携包');
  const ids = new Set(content.nodes.map(n => n.id));
  if (!Array.isArray(raw.added) || raw.added.some(id => !ids.has(id)) || unique(raw.added).length !== raw.added.length) fail('视图含未知或重复节点');
  if (!object(raw.positions) || Object.entries(raw.positions).some(([id,p]) => !ids.has(id) || !object(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7)) fail('节点坐标无效');
  if (!Array.isArray(raw.locked) || raw.locked.some(id => !raw.added.includes(id))) fail('锁定节点不在视图中');
  if (!object(raw.layout) || !['free','learning','logic'].includes(raw.layout.mode) || (raw.layout.anchor !== null && !raw.added.includes(raw.layout.anchor))) fail('布局或锚点无效');
  const c = raw.camera;
  if (!object(c) || ![c.x,c.y,c.scale].every(Number.isFinite) || c.scale < .15 || c.scale > 4) fail('相机参数无效');
  if (!Array.isArray(raw.relations)) fail('关系列表无效');
  raw.relations.forEach(r => validateRelation(r, content));
  if (unique(raw.relations.map(r => r.id)).length !== raw.relations.length) fail('关系 ID 重复');
  validateFormalSources(raw.formalSources,content);
  if (!object(raw.bindings) || Object.entries(raw.bindings).some(([id,path]) => !ids.has(id) || typeof path !== 'string' || path.startsWith('/') || path.includes('..') || /^[a-z]:/i.test(path))) fail('笔记绑定必须是库内相对路径');
  if (typeof raw.showActions !== 'boolean' || typeof raw.showRelations !== 'boolean') fail('关系显示设置无效');
  if (!object(raw.display) || raw.display.nodeMode !== 'adaptive' || !['auto','off'].includes(raw.display.motion) || Object.keys(raw.display).some(k=>!['nodeMode','motion'].includes(k))) fail('动态显示设置无效');
  if (raw.route !== null) validateRoute(raw.route, content);
  return clone(raw);
}

export function validateRelation(r, content) {
  const nodes = new Map(content.nodes.map(n => [n.id,n]));
  if (!object(r) || typeof r.id !== 'string' || !r.id || !RELATION_KINDS.includes(r.kind)) fail('关系类型或 ID 无效');
  if (!Array.isArray(r.inputs) || !r.inputs.length || r.inputs.some(id => !nodes.has(id)) || unique(r.inputs).length !== r.inputs.length || !nodes.has(r.output)) fail('关系输入输出无效');
  if (typeof r.explanation !== 'string' || !r.explanation.trim()) fail('请写出关系的自然解释与适用范围');
  if (!object(r.nodeVersions) || [...r.inputs,r.output].some(id => typeof r.nodeVersions[id] !== 'string')) fail('关系缺少节点版本');
  if (typeof r.sourceReviewed !== 'boolean') fail('关系缺少原文对应审阅状态');
  if (r.formal) {
    if (!object(r.formal) || !object(r.formal.declarations) || !Array.isArray(r.formal.premises) || r.formal.premises.length !== r.inputs.length || r.formal.premises.some(p => typeof p !== 'string') || typeof r.formal.goal !== 'string') fail('形式表达须逐项对应输入和结论');
    if(Object.entries(r.formal.declarations).some(([n,t])=>!n||typeof t!=='string'||!t.trim()))fail('符号声明无效');
    const w=r.formal.witness;
    if(w!==undefined){
      if(!object(w))fail('关系见证无效');
      if(w.mode==='instantiate'){if(!Array.isArray(w.terms)||!w.terms.length||w.terms.some(t=>typeof t!=='string'||!t.trim()))fail('代入项须为非空列表');}
      else if(w.mode==='reference'){if(!Array.isArray(w.references)||!w.references.length||w.references.some(x=>!object(x)||typeof x.symbol!=='string'||!r.inputs.includes(x.node)||typeof x.version!=='string'))fail('引用须指定输入节点、符号和版本');}
      else if(w.mode==='finite'){if(!object(w.model)||typeof w.model.id!=='string'||typeof w.model.carrier!=='string'||!Array.isArray(w.model.elements)||!object(w.model.consts)||!object(w.model.ops))fail('有限模型须包含载体、完整运算表与常元取值');}
      else fail('不支持的关系见证');
    }
  }
  return r;
}

// A report is trusted only through the host's local replay registry; imported JSON is not proof.
export function validateFormalSources(sources,content){
  const nodes=new Set(content.nodes.map(n=>n.id));
  if(!object(sources)||Object.entries(sources).some(([id,s])=>!nodes.has(id)||!object(s)||typeof s.version!=='string'||!object(s.declarations)||Object.values(s.declarations).some(t=>typeof t!=='string')||!Array.isArray(s.definitions)||s.definitions.some(d=>!object(d)||!['name','type','source'].every(k=>typeof d[k]==='string'&&d[k].trim()))))fail('定义来源须绑定已知节点与版本，填写符号类型和定义体');
}

export function relationState(r, content, verified = new Map(), context = {}) {
  const nodes = new Map(content.nodes.map(n => [n.id,n]));
  if ([...r.inputs,r.output].some(id => nodes.get(id)?.version !== r.nodeVersions[id])) return 'stale';
  const report = verified.get(r.id);
  if (report && report.input !== relationInput(r,context)) return 'stale';
  if (report?.status === 'passed') return r.sourceReviewed ? 'verified' : 'alignment-pending';
  return report?.status ?? 'unchecked';
}

export function relationInput(r,context = {}) {
  return stable({ kind:r.kind, inputs:r.inputs, output:r.output, nodeVersions:r.nodeVersions, formal:r.formal ?? null,
    ...(r.kind==='definitionReference'?{formalSources:context.formalSources??{},references:(context.relations??[]).filter(x=>x.kind==='definitionReference').map(x=>({id:x.id,inputs:x.inputs,output:x.output,references:x.formal?.witness?.references??[]})).sort((a,b)=>a.id.localeCompare(b.id))}:{} ) });
}

export function contentIndex(content) {
  const nodes = new Map(content.nodes.map(n => [n.id,n]));
  const actions = new Map(content.actions.map(a => [a.id,a]));
  return { version: content.version, raw: { actions: content.actions }, boundaryRefs: new Set(content.boundary),
    node: id => nodes.get(id) ?? fail(`未知节点：${id}`), maybeNode: id => nodes.get(id),
    action: id => actions.get(id) ?? fail(`未知行动：${id}`), actionsFor: id => content.actions.filter(a => a.outputs.some(o => o.node === id)) };
}

/** @param {any} content @param {string} goal @param {string[]} known @param {string[] | null} actionIds */
export function planLearning(content, goal, known = [], actionIds = null) {
  const chosen = actionIds ? { ...content, actions: content.actions.filter(a => actionIds.includes(a.id)) } : content;
  const background = unique(known).map(id => ({ entryId:id, node:id, provides:['statement','definition','method','construction'], kind:'confirmed' }));
  const result = makePlanner(contentIndex(chosen)).plan({ goalId:goal, background, horizon:20, maxCandidates:3500, useUnknownEntries:true });
  return { ...result, routes: result.routes.map(route => ({ ...route, initial: unique([...route.entry,...route.usedBackground]), contentVersion:content.version })) };
}

export function validateRoute(route, content) {
  if (!object(route) || route.contentVersion !== content.version || !Array.isArray(route.events) || !Array.isArray(route.initial) || !Array.isArray(route.linearExtensions) || !Array.isArray(route.linearExtensions[0])) fail('路线版本或结构无效');
  const nodes = new Set(content.nodes.map(n => n.id));
  if (route.initial.some(id => !nodes.has(id)) || unique(route.initial).length!==route.initial.length) fail('路线背景有未知或重复节点');
  if(!Array.isArray(route.goals)||route.goals.some(id=>!nodes.has(id))||!object(route.goalSources))fail('路线目标或目标来源无效');
  const actions = new Map(content.actions.map(a => [a.id,a]));
  const events = new Map(route.events.map(e => [e.id,e]));
  const order = route.linearExtensions[0];
  if (events.size !== route.events.length || unique(order).length !== order.length || order.length !== events.size || order.some(id => !events.has(id))) fail('事件排列不完整或重复');
  const done = new Set();
  for (const eid of order) {
    const e = events.get(eid), a = actions.get(e.actionId);
    if (!a || !object(e.sources) || stable(e.provides) !== stable(a.outputs)) fail('事件行动或产出不匹配');
    if (unique(Object.keys(e.sources)).sort().join('|') !== unique(a.inputs.map(i=>i.node)).sort().join('|')) fail('事件来源与联合输入不一致');
    for (const input of a.inputs) {
      const s = e.sources[input.node];
      if(!object(s)||s.node!==input.node||!input.accepts.includes(s.resource))fail('来源节点或资源类型不匹配');
      if (s.kind === 'event') {
        const producer = events.get(s.eventId);
        if (!done.has(s.eventId) || !producer?.provides.some(o => o.node === input.node && o.provides.some(k=>input.accepts.includes(k)))) fail('来源事件尚未执行或不能提供该输入');
      } else if (!['background','boundary'].includes(s.kind) || !route.initial.includes(input.node)) fail('背景来源不匹配');
    }
    done.add(eid);
  }
  for(const id of route.goals){const s=route.goalSources[id];
    if(!object(s)||s.node!==id)fail('目标来源不匹配');
    if(s.kind==='event'){if(!events.get(s.eventId)?.provides.some(o=>o.node===id&&o.provides.includes(s.resource)))fail('目标没有实际产出来源');}
    else if(!['background','boundary'].includes(s.kind)||!route.initial.includes(id))fail('目标背景来源不匹配');
  }
  return route;
}

export function replayFrame(route, content, step, known) {
  validateRoute(route, content);
  const order = route.linearExtensions[0], at = Math.max(0, Math.min(order.length, Math.trunc(step)));
  const actions = new Map(content.actions.map(a => [a.id,a]));
  const events = new Map(route.events.map(e => [e.id,e]));
  const available = new Set(known), visible = new Set(route.initial), rows = [], executed=new Set();
  for (let i = 0; i < at; i++) {
    const e = events.get(order[i]), a = actions.get(e.actionId);
    const uses = a.inputs.map(input => input.node), missing = uses.filter(id => !available.has(id) || (e.sources[id].kind==='event' && !executed.has(e.sources[id].eventId)));
    const row = { event:e, action:a, uses, missing, executable:missing.length === 0, added:[] };
    if (!missing.length) executed.add(e.id);
    if (!missing.length) for (const out of a.outputs) {
      if (!visible.has(out.node)) row.added.push(out.node);
      available.add(out.node); visible.add(out.node);
    }
    rows.push(row);
  }
  return { step:at, total:order.length, visible:[...visible], available:[...available], rows, current:rows.at(-1) ?? null };
}

export function recommendations(content, view, known = []) {
  const added = new Set(view.added), confirmed = new Set(known);
  const list = [];
  for (const node of content.nodes) {
    if (added.has(node.id)) continue;
    const producers = content.actions.filter(a => a.outputs.some(o => o.node === node.id));
    const reasons = producers.map(a => ({ action:a, missing:a.inputs.filter(i=>!added.has(i.node)).map(i=>i.node), knownMissing:a.inputs.filter(i=>!confirmed.has(i.node)).map(i=>i.node) }));
    reasons.sort((a,b)=>a.missing.length-b.missing.length || a.action.id.localeCompare(b.action.id));
    const best = reasons[0];
    const linked = view.relations.find(r => r.output === node.id && r.inputs.some(id=>added.has(id)));
    const chapterRelated = content.nodes.some(n=>added.has(n.id) && n.chapter===node.chapter);
    const score = best && !best.missing.length ? 0 : linked ? 1 : best?.action.inputs.some(i=>added.has(i.node)) ? 2 : chapterRelated ? 3 : 4;
    list.push({ node, score, reason:score===0?'此行动的前提已在图中':score===1?'已有登记关系':score===2?'与当前网络共用或衔接前提':score===3?'同一章节':'可选节点',
      action:best?.action.id, missing:best?.missing ?? [], ready:best ? !best.knownMissing.length : confirmed.has(node.id) });
  }
  return list.sort((a,b)=>a.score-b.score || a.node.title.localeCompare(b.node.title,'zh-CN'));
}

export function exportBundle(content, view) {
  verifyContentIdentity(content);
  return { schema:BUNDLE_SCHEMA, content:clone(content), view:validateView(view,content) };
}

export function validateContent(content) {
  if (!object(content) || content.schema !== 'mcs-content/1' || typeof content.version !== 'string' || !Array.isArray(content.nodes) || !Array.isArray(content.actions) || !Array.isArray(content.boundary)) fail('内容包格式无效');
  const ids = new Set();
  if(content.nodes.length>5000||content.actions.length>20000)fail('内容包超出当前桌面版规模限制（5000节点 / 20000行动）');
  for (const n of content.nodes) {
    if (!object(n) || typeof n.id !== 'string' || !n.id || ids.has(n.id) || typeof n.title !== 'string' || typeof n.version !== 'string' || typeof n.body !== 'string') fail('内容包节点无效或重复');
    ids.add(n.id);
  }
  const aids = new Set();
  for (const a of content.actions) {
    if (!object(a) || typeof a.id !== 'string' || aids.has(a.id) || !Array.isArray(a.inputs) || !Array.isArray(a.outputs) || !a.outputs.length || !object(a.witness)) fail('内容包行动无效');
    aids.add(a.id);
    for (const input of a.inputs) if (!ids.has(input.node) || !Array.isArray(input.accepts) || !input.accepts.length) fail('行动输入无效');
    for (const output of a.outputs) if (!ids.has(output.node) || !Array.isArray(output.provides) || !output.provides.length) fail('行动输出无效');
  }
  if (content.boundary.some(id=>!ids.has(id))) fail('背景引用无效');
  if (content.templates!==undefined && (!Array.isArray(content.templates) || content.templates.some(t=>!object(t)||typeof t.id!=='string'||typeof t.name!=='string'||!ids.has(t.goal)||!Array.isArray(t.actions)||t.actions.some(id=>!aids.has(id))))) fail('学习模板含未知目标或行动');
  return content;
}

export function importBundle(raw) {
  if (!object(raw) || ![BUNDLE_SCHEMA,'mcs-bundle/1'].includes(raw.schema)) fail('不支持的便携包');
  const content = verifyContentIdentity(raw.content), view = validateView(raw.view, content);
  return { content:clone(content), view:{ ...view, id:crypto.randomUUID(), revision:0, name:`${view.name}（导入副本）` } };
}
