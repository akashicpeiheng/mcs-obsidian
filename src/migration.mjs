import {createView,validateView,importBundle} from './core.mjs';

export function migrateWebsiteView(raw,content){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.viewId!=='string'||typeof raw.name!=='string'||!raw.payload||typeof raw.payload!=='object')throw new Error('不是 MCS 网站保存的节点网络快照');
  const p=raw.payload,ids=new Set(content.nodes.map(n=>n.id));
  if(!Array.isArray(p.added)||p.added.some(id=>!ids.has(id)))throw new Error(`网站快照含当前内容包没有的节点：${(p.added??[]).filter(id=>!ids.has(id)).join('、')}。请先导入对应内容；不自动丢弃这些节点。`);
  const families=p.families??['contract','relation'];
  if(!Array.isArray(families)||families.some(f=>typeof f!=='string'))throw new Error('网站快照的连接族列表损坏');
  const positions=p.positions??{};
  const view={...createView(content,`${raw.name}（网站迁移）`),added:[...new Set(p.added)],positions,
    locked:Object.keys(positions).filter(id=>p.added.includes(id)),camera:p.camera??{x:45,y:70,scale:1},
    showActions:families.includes('contract'),showRelations:families.includes('relation')};
  if(view.added.some(id=>!positions[id]))throw new Error('网站快照只登记了手动位置，缺少自动位置；请在迁移预览中补齐');
  const warnings=['网站快照未保存本体版本，本次只按节点 ID 匹配当前教材包；对应须审阅。','已有坐标作为锁定点保留。来源边不自动成为已认证的形式关系。'];
  const omitted=families.filter(f=>!['contract','relation'].includes(f));
  if(omitted.length)warnings.push(`来源快照中的这些连接族暂不绘制：${omitted.join('、')}。`);
  return {content,view:validateView(view,content),warnings,source:raw};
}

export function parseImports(raw,content,placeMissing){
  if(['mcs-bundle/1','mcs-bundle/2'].includes(raw?.schema))return [{...importBundle(raw),warnings:raw.schema==='mcs-bundle/1'?['第一版视图已补齐动态显示设置；原坐标与固定位置保留。']:[]}];
  const rows=Array.isArray(raw)?raw:Array.isArray(raw?.views)?raw.views:[raw];
  if(!rows.length||rows.length>100)throw new Error('导入列表为空或超过100个视图');
  return rows.map(row=>{
    // Source snapshots often contain manual positions only; use the same incremental rule
    // for missing positions before validation, without changing existing coordinates.
    const copy=structuredClone(row);
    if(copy?.payload&&Array.isArray(copy.payload.added)&&placeMissing)copy.payload.positions=placeMissing(copy.payload.added,copy.payload.positions??{});
    return migrateWebsiteView(copy,content);
  });
}
