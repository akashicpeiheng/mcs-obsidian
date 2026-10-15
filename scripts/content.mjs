import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { jiang } from '../upstream/mcs-web/data/cases/jiang.mjs';
import { pilotNodes, pilotActions, pilotTemplates } from '../data/pilot.mjs';
import { contentHash } from '../src/core.mjs';
import { chainNotes } from '../data/chain-notes.mjs';

export async function buildContent() {
  const rawNodes = jiang.nodes;
  const nodes = rawNodes.map(n => ({ id:n.id, version:`${n.version}-obsidian.1`, title:n.title, kind:n.construct, summary:n.summary ?? n.title,
    chapter:n.provenance?.sources?.[0]?.match(/第\d+章 [^§]+/)?.[0]?.trim() ?? '方法', source:n.provenance?.sources?.join('\n') ?? '待核对',
    sourceReviewed:false, evidenceStatus:'NOT-CLAIMED', body:`# ${n.title}\n\n#线性代数 #教材地图\n\n## 当前范围\n\nREF：此条目继承网站的节点位置，正文尚未完成。\n\n${n.summary ?? ''}\n\n## 回查与验证\n\n${n.provenance?.sources?.join('\n') ?? ''}\n\n教材原文逐条校勘待完成；本条目不是机器证明。请先确认定义的背景、条件，再判断能否用于当前推理。\n` }));
  const corrections = {
    'jiang:solution-cases':'有限个方程在域 F 上经合法消元后，矛盾行意味着无解；有解且秩 r=n 时唯一；r<n 时解由 n-r 个自由参数描述。只有在无限域上才由此推出无穷多解；F_q 上有 q^(n-r) 个解。',
    'jiang:inner-product':'实内积为双线性、对称且正定；复内积须采用半双线性与共轭对称性，并明确哪一侧线性。不能把复内积同时写成两侧复线性。',
    'jiang:method-elimination':'对域上的有限线性方程组施行合法行变换，判断无解、唯一解或有自由参数；多解是否无穷还依赖标量域。',
  };
  for (const n of nodes) if (corrections[n.id]) {
    n.summary = corrections[n.id];
    n.body = `# ${n.title}\n\n#线性代数 #教材地图\n\n## 校勘后的范围\n\n${n.summary}\n\n## 来源与边界\n\n${n.source}\n\n旧站概述保存在源清单中；本条为独立范围修订，完整教学正文和逐句教材对应待完成。\n\n## 回看\n\n改变标量域后，哪一个条件或结论必须一起改变？\n`;
  }
  nodes.push(...pilotNodes.map(n=>({...n,version:'1',sourceReviewed:false,evidenceStatus:n.kind==='Claim'?'PROOF':'DEF'})));
  for(const n of nodes)if(chainNotes[n.id]){n.body=chainNotes[n.id];n.evidenceStatus=n.id==='jiang:solution-cases'?'PROOF':'DEF';n.version+='-pilot.1';}
  const idSet = new Set(nodes.map(n=>n.id));
  const external = [...new Set(jiang.actions.flatMap(a=>a.inputs.map(i=>i.node)))].filter(id=>!idSet.has(id));
  for (const id of external) nodes.push({id,version:'1',title:id,kind:'Concept',chapter:'背景接口',source:'网站行动契约引用的外部背景；未展开教材正文。',sourceReviewed:false,evidenceStatus:'NOT-CLAIMED',summary:'外部背景接口，须由学习者确认。',body:`# ${id}\n\nNOT-CLAIMED：此节点是行动契约引用的背景接口，未导入其他案例的正文。`});
  const sources = [];
  for (const path of ['mcs-web/data/cases/jiang.mjs','mcs-web/core/planner.mjs','mcs-web/web/src/network.ts','mcs-web/web/src/network-order.ts','mcs-web/web/src/node-placement.ts','mcs-foundations/06-硬关系.md','mcs-foundations/12-视图转换与路径规划.md']) {
    const bytes = await readFile(new URL(`../upstream/${path}`,import.meta.url));
    sources.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const content = { schema:'mcs-content/1',version:'pending',title:'简明高等代数 · MCS 学习地图',nodes,
    actions:[...jiang.actions,...pilotActions],boundary:[...external,'jiang:field-axioms'],templates:pilotTemplates,
    aggregates:jiang.aggregates, inheritedRelations:jiang.relations, sources,
    audit:{inheritedNodes:rawNodes.length,pilotNodes:pilotNodes.length,corrected:Object.keys(corrections),textbookAlignment:'pending',machineProofs:'see separate reports'} };
  content.version = contentHash(content);
  return content;
}

export async function writeContent() {
  const content=await buildContent();
  await mkdir(new URL('../src/generated/',import.meta.url),{recursive:true});
  await writeFile(new URL('../src/generated/content.json',import.meta.url),JSON.stringify(content,null,2)+'\n');
  const rows=content.nodes.map(n=>`| ${n.id} | ${n.title} | ${n.chapter} | ${n.evidenceStatus} | ${n.sourceReviewed?'已审阅':'待逐条对应'} |`);
  await writeFile(new URL('../docs/SOURCE-AUDIT.md',import.meta.url),`# 来源与节点校勘清单\n\n源工作树日期：2026-10-13。来源文件哈希保存在内容包 sources 中。哈希证明输入身份，不证明数学结论。\n\n继承 ${content.audit.inheritedNodes} 个节点，新增 ${content.audit.pilotNodes} 个示范链节点。\n\n## 已识别的修订\n\n- 一般域上的自由参数不等于无穷多解；补充有限域边界。\n- 复内积不能两侧均为复线性；区分实双线性与复半双线性。\n- 旧 evidence 中的 PROOF 不迁移为机器认证；未核对条目保留待审阅。\n- 原 hardPrereq 与跨案例接口暂存为继承资料，不自动激活成已认证硬关系。\n- 网站回放曾把此前全部可见节点当 uses，并将首个产出当种子；插件从真实 action.inputs 和完整事件来源重建。\n\n## 节点登记\n\n| ID | 标题 | 章节 | 正文证据标签 | 教材对应 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 范围\n\nFINITE：清单由当前源码生成，可用构建脚本复现。NOT-CLAIMED：未通读或校勘全书；地图条目不冒充完整笔记。示范链正文是独立重述，纸笔证明、Lean 检查、教材对应分别登记。\n`);
  return content;
}
