import {chromium} from '../../mcs-web/node_modules/playwright-core/index.mjs';
import {readFile,writeFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {hostPage} from './host-page.mjs';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {createView} from '../src/core.mjs';
import {increment} from '../src/graph.ts';
const session=JSON.parse(await readFile('runtime/obsidian-session.json'));
assert.ok(resolve(session.vault).startsWith(resolve('runtime')+'\\'));
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`),page=await hostPage(browser,session.vault),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.stack));page.setDefaultTimeout(15000);
const content=JSON.parse(await readFile('src/generated/content.json'));
const ui=()=>page.locator('.mcs-app').last(),card=()=>ui().locator('.mcs-relation').filter({has:page.getByRole('button',{name:'编辑',exact:true})});
const src='jiang:matrix-operations',dest='pilot:linear-map';
const sourceTitle=content.nodes.find(n=>n.id===src).title;
const model={id:'collapse-two',carrier:'V',elements:['0','1'],consts:{a:'0',b:'1'},ops:{f:{type:'V -> V',table:['0','0']}}};
const saved=()=>page.evaluate(async()=>{const l=app.workspace.getLeavesOfType('mcs-network').at(-1);return JSON.parse(await app.vault.read(l.view.file));});
async function create(kind,declarations,premise,goal){
  await ui().getByRole('button',{name:'＋ 创建关系'}).click();
  const dialog=ui().getByRole('dialog',{name:'关系编辑器'});
  await dialog.getByLabel('关系类型',{exact:true}).selectOption(kind);
  await dialog.getByLabel(/联合输入/).selectOption([src]);
  await dialog.getByLabel('输出',{exact:true}).selectOption(dest);
  await dialog.getByLabel('为什么成立，有哪些条件与边界？').fill('本机有界模式检查；教材对应待人工核对。');
  await dialog.getByLabel('编辑形式表达',{exact:true}).check();
  await dialog.getByLabel('符号与类型',{exact:true}).fill(declarations);
  await dialog.getByLabel('输入陈述，每行对应一个输入节点').fill(premise);
  await dialog.getByLabel('输出陈述',{exact:true}).fill(goal);
  return dialog;
}
async function saveAndCheck(dialog){await dialog.getByRole('button',{name:'保存关系草稿'}).click();const c=card().last();await c.getByRole('button',{name:'形式检查',exact:true}).click();await c.getByText('形式检查通过 · 对应待审阅',{exact:true}).waitFor();if(await c.locator('.mcs-check-report').getAttribute('open')===null)await c.getByText('核验范围与见证',{exact:true}).click();return c;}
try{
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
  await page.evaluate(async()=>{app.setting.close();for(const type of ['mcs-network','markdown'])for(const l of app.workspace.getLeavesOfType(type))await l.detach();await app.plugins.unloadPlugin('mcs-cognitive-space');});
  await cp('dist',resolve(session.vault,'.obsidian/plugins/mcs-cognitive-space'),{recursive:true});await page.evaluate(async()=>{await app.plugins.loadPlugin('mcs-cognitive-space');});await page.setViewportSize({width:1440,height:960});
  const v=increment(content,createView(content,'P3 定义、实例与反例验收'),[src,dest]);v.display.motion='off';
  await page.evaluate(async({content,view})=>{await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);},{content,view:v});
  const original=await saved();delete original.formalSources;const originalText=JSON.stringify(original,null,3)+'\n';
  await page.evaluate(async text=>{const leaf=app.workspace.getLeavesOfType('mcs-network').at(-1),file=leaf.view.file;await leaf.detach();await app.vault.modify(file,text);await app.workspace.getLeaf('tab').openFile(file);},originalText);
  await ui().getByLabel('视图名称').fill('P3 专用见证 · 保留旧版备份');await ui().getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(async()=>{const l=app.workspace.getLeavesOfType('mcs-network').at(-1);const v=JSON.parse(await app.vault.read(l.view.file));return v.name==='P3 专用见证 · 保留旧版备份'&&Object.hasOwn(v,'formalSources');});
  assert.ok(await page.evaluate(async text=>{for(const f of app.vault.getFiles().filter(f=>f.path.startsWith('MCS-workspace/旧版备份/')))if(await app.vault.read(f)===text)return true;return false;},originalText));
  assert.deepEqual((await saved()).formalSources,{});checks.push('first save of an older version-two view preserves its exact original bytes');
  await ui().getByRole('button',{name:'关系工作室',exact:true}).click();
  let dialog=await create('definitionReference','a: V','true','I a = a');
  await dialog.getByLabel(`引入的定义：${sourceTitle}`,{exact:true}).fill('I: V -> V := λx:V. x');
  await dialog.getByLabel('输出实际使用的定义符号（逗号或空格分隔）').fill('I');await dialog.screenshot({path:'docs/formal-source-editor.png'});
  let c=await saveAndCheck(dialog);assert.match(await c.innerText(),/不证明输出命题/);checks.push('definition editor registers typed source; independent replay distinguishes DEF from proof');
  dialog=await create('instanceOf','a: V','∀x:V. x = x','a = a');await dialog.getByLabel('代入项（每行一项，依最外层 ∀ 的顺序）').fill('a');await saveAndCheck(dialog);checks.push('exact instantiation editor produces an independent ND replay');
  dialog=await create('instanceOf','a: V\nb: V\nf: V -> V','a = a','∀x:V. f x = a');await dialog.getByLabel('实例核验方式').selectOption('finite');await dialog.getByLabel('有限对象与完整运算表').fill(JSON.stringify(model,null,2));c=await saveAndCheck(dialog);assert.match(await c.innerText(),/结论：真/);checks.push('finite instance editor verifies a closed universal statement over every element');
  dialog=await create('counterexampleTo','a: V\nb: V\nf: V -> V','f a = f b','a = b');await dialog.getByLabel('有限对象与完整运算表').fill(JSON.stringify(model,null,2));c=await saveAndCheck(dialog);assert.match(await c.innerText(),/输入：1=真；结论：假/);checks.push('counterexample editor requires true assumptions and a false goal');await c.scrollIntoViewIfNeeded();assert.ok(await ui().locator('.mcs-sidebar').evaluate(el=>el.scrollWidth<=el.clientWidth+1));checks.push('countermodel witness explains the failing values without overflowing the sidebar');await ui().screenshot({path:'docs/formal-witness-view.png'});
  await ui().getByRole('button',{name:'保存',exact:true}).click();const before=await saved();const known=await page.evaluate(()=>app.plugins.plugins['mcs-cognitive-space'].settings.known);
  assert.deepEqual(before.formalSources[src].definitions,[{name:'I',type:'V -> V',source:'λx:V. x'}]);assert.equal(before.relations.length,4);assert.equal(before.relations.filter(r=>r.formal.witness.mode==='finite').length,2);checks.push('save persists sources and all witness modes while keeping personal knowledge separate');
  await card().first().getByRole('button',{name:'编辑',exact:true}).click();dialog=ui().getByRole('dialog',{name:'关系编辑器'});await dialog.getByLabel(`引入的定义：${sourceTitle}`,{exact:true}).fill('I: V -> V := λz:V. z');await dialog.getByRole('button',{name:'保存关系草稿'}).click();await card().last().getByText('证据已过期',{exact:true}).waitFor();assert.ok(await card().last().getByText('旧报告（已过期，需重新核验）',{exact:true}).count());checks.push('editing source expires the old report and marks it historical');
  // Last card is now the edited reference. Locate the countermodel by its kind.
  const counter=card().filter({has:page.locator('.mcs-chip',{hasText:'反例'})});await counter.getByRole('button',{name:'编辑',exact:true}).click();dialog=ui().getByRole('dialog',{name:'关系编辑器'});await dialog.getByLabel('输入陈述，每行对应一个输入节点').fill('a = b');await dialog.getByRole('button',{name:'保存关系草稿'}).click();await card().last().getByRole('button',{name:'形式检查',exact:true}).click();await card().last().getByText('核验未通过',{exact:true}).waitFor();if(await card().last().locator('.mcs-check-report').getAttribute('open')===null)await card().last().getByText('核验范围与见证',{exact:true}).click();assert.match(await card().last().innerText(),/输入假设不成立/);checks.push('a false input is refused with its index rather than certified as a counterexample');
  await ui().getByRole('button',{name:'保存',exact:true}).click();const file=await page.evaluate(()=>app.workspace.getLeavesOfType('mcs-network').at(-1).view.file.path);const stable=await saved();
  await page.evaluate(async path=>{for(const l of app.workspace.getLeavesOfType('mcs-network'))await l.detach();await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(path));},file);await ui().getByRole('button',{name:'关系工作室',exact:true}).click();assert.equal(await card().getByText('待检查',{exact:true}).count(),4);assert.deepEqual((await saved()).formalSources,stable.formalSources);checks.push('reopen restores source registry and witness payloads but does not trust stored claims');
  const bundle={schema:'mcs-bundle/2',content,view:stable},bundlePath=resolve('runtime/witness-roundtrip.mcspack.json');await writeFile(bundlePath,JSON.stringify(bundle));
  await ui().locator('input[type=file]').setInputFiles(bundlePath);await ui().getByRole('dialog',{name:'导入预览'}).waitFor();await ui().getByRole('button',{name:'确认导入副本'}).click();await page.waitForFunction(()=>app.workspace.getLeavesOfType('mcs-network').length===2);
  await ui().getByRole('button',{name:'关系工作室',exact:true}).click();assert.deepEqual((await saved()).formalSources,stable.formalSources);assert.equal(await card().getByText('待检查',{exact:true}).count(),4);assert.deepEqual(await page.evaluate(()=>app.plugins.plugins['mcs-cognitive-space'].settings.known),known);checks.push('portable import preserves definitions without importing verified status or learner state');
  await page.setViewportSize({width:520,height:760});await page.waitForTimeout(250);if((await ui().getAttribute('class')).includes('mcs-panel-hidden'))await ui().getByRole('button',{name:'展开或收起工作面板'}).click();await ui().getByRole('button',{name:'＋ 创建关系'}).click();dialog=ui().getByRole('dialog',{name:'关系编辑器'});const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=520);await page.keyboard.press('Escape');assert.equal(await ui().getByRole('dialog').count(),0);checks.push('narrow editor stays inside the viewport and Escape restores the workspace');
  await page.setViewportSize({width:1440,height:960});assert.equal(errors.length,0,errors.join('\n'));
  await writeFile('runtime/witness-report.json',JSON.stringify({status:'passed',version,evidence:'FINITE',artifactSha256:await artifactIdentity('dist'),checkedAt:new Date().toISOString(),checks,scope:'Real isolated Obsidian, relation editor to independent replay, persistence and portable import.'},null,2)+'\n');console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await browser.close();}
