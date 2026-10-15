import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import assert from 'node:assert/strict';
import {manifest} from './manifest.mjs';

/*
 * 最低宿主版本（minAppVersion）核对。
 *
 * 插件清单写着 minAppVersion 1.7.2，但从来没有验证过：实机只在 1.14.4 上跑过。
 * 这里做**静态**核对，能证明什么、不能证明什么都写清楚：
 *
 *   能证明：打包产物从 `obsidian` 模块取的每个符号、以及源码里以 `.名字` 调用的
 *           Obsidian 成员，在官方类型定义里都没有标注比 1.7.2 更晚的 @since；
 *           清单也确实声明了 isDesktopOnly。
 *   不能证明：真实 1.7.2 宿主上的运行行为。类型定义只记录「从哪个版本开始有」，
 *           不覆盖行为差异、Electron/Chromium 差异，也不覆盖从未写进 @since 的改动。
 *           要真正确认，必须在 1.7.2 安装包上实机跑一遍。
 *
 * 用法：node scripts/compat-check.mjs [--show-surface]
 */

const minAppVersion=manifest.minAppVersion;
const compare=(a,b)=>{const left=String(a).split('.').map(Number),right=String(b).split('.').map(Number);for(let i=0;i<3;i++){const x=left[i]??0,y=right[i]??0;if(x!==y)return x-y;}return 0;};
const tooNew=value=>value!==undefined&&compare(value,minAppVersion)>0;

/* ---- 1. 打包产物真正引用的 obsidian 符号 ---- */
const bundle=await readFile('dist/main.js','utf8');
const imported=[...new Set([...bundle.matchAll(/\bimport_obsidian\d*\.([A-Za-z_$][\w$]*)/g)].map(match=>match[1]))].sort();

/* ---- 2. 类型定义里每个名字**最早**的 @since，并记住它属于哪个类型 ---- */
const declaration=await readFile('node_modules/obsidian/obsidian.d.ts','utf8');
const since=new Map(),sourceLine=new Map(),enclosing=new Map();
{
  let pending=null;
  const stack=[];
  for(const raw of declaration.split(/\r?\n/)){
    const tag=raw.match(/@since\s+(\d+\.\d+\.\d+)/);
    if(tag){pending=tag[1];continue;}
    if(/^\s*\*/.test(raw)||!raw.trim())continue;
    const indent=raw.match(/^\s*/)[0].length;
    while(stack.length&&stack.at(-1).indent>=indent)stack.pop();
    const owner=stack.at(-1)?.name??null;
    const type=raw.match(/^\s*(?:export\s+)?(?:abstract\s+)?(?:declare\s+)?(?:class|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/);
    const member=type?null:(raw.match(/^\s*(?:readonly\s+|static\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*[?(:<]/));
    if(type)stack.push({indent,name:type[1]});
    if(pending&&(type||member)){
      const name=type?type[1]:member[1],previous=since.get(name);
      if(previous===undefined||compare(pending,previous)<0){since.set(name,pending);sourceLine.set(name,raw.trim().slice(0,120));enclosing.set(name,owner??type?.[1]??null);}
    }
    pending=null;
  }
}

/* ---- 3. 源码里怎么用这些名字 ---- */
const sources=[];
async function collect(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())await collect(path);
    else if(/\.(ts|tsx|mjs)$/.test(entry.name))sources.push({file:relative(resolve('src'),path).replaceAll('\\','/'),text:await readFile(path,'utf8')});
  }
}
await collect(resolve('src'));

const importedTooNew=imported.filter(name=>tooNew(since.get(name)));
const memberHits=[];
for(const [name,value] of since){
  if(!tooNew(value)||imported.includes(name))continue;
  const pattern=new RegExp(`\\.${name.replace(/\$/g,'\\$')}\\b`);
  const files=sources.filter(source=>pattern.test(source.text)).map(source=>source.file);
  if(files.length)memberHits.push({name,since:value,declaredOn:enclosing.get(name)??null,declaration:sourceLine.get(name),files});
}
memberHits.sort((a,b)=>compare(a.since,b.since)||a.name.localeCompare(b.name));

/*
 * 人工核对（2026-10-15）：上面的候选只是「同名」，逐个看过之后的结论写在这里，
 * 免得下一个人再猜一遍。三类：
 *   - Bases / Value 系（1.10 起）：插件从不接触 Bases，命中的都是自家字段；
 *   - 声明式设置 API（1.11–1.13 的 SettingGroup / SettingDefinition* / SettingPage /
 *     SettingTab.update）：插件走的是老的命令式 Setting，不碰这套；
 *   - Plugin.settings（1.13）：插件自己声明了 settings 字段，与公开 API 同名但无关。
 * 唯一需要实证的是 addClass：命中的 SettingGroup.addClass 是 1.11 起，而插件调用的是
 * HTMLElement 上的 DOM 增强成员——已直接读 obsidian.d.ts 确认那一处没有 @since。
 */
const MEMBER_REVIEW={
  'addClass':'调用的是 HTMLElement 增强成员（obsidian.d.ts 中该处无 @since），不是 SettingGroup.addClass',
  'Plugin.settings':'插件自有的 settings 字段；公开 Plugin.settings 是 1.13 新增，插件不依赖它',
};
const newerTypes=new Set(['BasesEntryGroup','BasesEntry','BasesPropertyOption','BasesViewConfig','ListValue','BasesOptionGroup','BasesSliderOption','NullValue','BasesConfigFile','SettingGroup','SettingDefinitionAction','SettingPage','SettingTab','SettingDefinitionBase','SettingDefinitionPage','Plugin']);
for(const hit of memberHits){
  hit.review=MEMBER_REVIEW[hit.name]??(hit.declaredOn&&newerTypes.has(hit.declaredOn)
    ?`同名不同物：命中的是 ${hit.declaredOn} 的成员（${hit.since} 起），插件用的是自家字段`
    :'同名不同物，需人工确认');
}

const report={
  schema:'mcs-host-compat/1',
  version:manifest.version,
  minAppVersion,
  checkedAgainst:'node_modules/obsidian/obsidian.d.ts（obsidian@1.14.4）',
  evidence:'STATIC',
  claim:`打包产物与源码没有使用任何 @since 晚于 ${minAppVersion} 的 Obsidian 公开成员。`,
  notClaimed:'没有在 1.7.2 宿主上实机运行过。类型定义只记录引入版本，不覆盖行为差异与未标注的改动。',
  isDesktopOnly:manifest.isDesktopOnly===true,
  importedSurface:imported.map(name=>({name,since:since.get(name)??null,declaration:sourceLine.get(name)??null,tooNew:tooNew(since.get(name))})),
  importedTooNew,
  memberCandidatesNewerThanMin:memberHits.length,
  memberHits,
  checkedAt:new Date().toISOString(),
};
await mkdir('docs/validation',{recursive:true});
await writeFile('docs/validation/compat.json',JSON.stringify(report,null,2)+'\n');

if(process.argv.includes('--show-surface'))console.log(JSON.stringify({importedSurface:report.importedSurface,importedTooNew,memberHits},null,2));
assert.equal(report.isDesktopOnly,true,'插件声明必须是桌面专用');
assert.deepEqual(importedTooNew,[],`打包产物引用了晚于 ${minAppVersion} 的 Obsidian 符号`);
console.log(JSON.stringify({status:'passed',minAppVersion,imported:report.importedSurface.length,importedTooNew:importedTooNew.length,memberCandidates:memberHits.length},null,2));
