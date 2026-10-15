import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '../../mcs-web/node_modules/playwright-core/index.mjs';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {hostPage} from './host-page.mjs';
import {execFile} from 'node:child_process';
import {readdir} from 'node:fs/promises';

const read=async path=>JSON.parse(await readFile(path,'utf8'));
const session=await read('runtime/obsidian-session.json');
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
let host;
try{
  const page=await hostPage(browser,session.vault);
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
  host=await page.evaluate(()=>{
    app.setting.open();app.setting.openTabById('about');
    const lines=app.setting.settingTabs.find(t=>t.id==='about').containerEl.innerText.split('\n').filter(t=>/^(?:Version|Installer version|版本|安装程序版本)\s*[:：]?\s*v?\d+\.\d+/i.test(t));
    app.setting.close();
    const os=require('node:os');return {obsidian:lines[0]?.match(/\d+\.\d+\.\d+/)?.[0],installer:lines[1]?.match(/\d+\.\d+\.\d+/)?.[0],electron:process.versions.electron,node:process.versions.node,platform:process.platform,cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,ramBytes:os.totalmem()};
  });
  assert.ok(host.obsidian,'Unable to read actual Obsidian version');
}finally{await browser.close();}
const desktop=await read('runtime/browser-report.json'),restart=await read('runtime/restart-report.json'),renderer=await read('runtime/renderer-report.json');
const dynamic=await read('runtime/dynamic-report.json'),demo=await read('runtime/demo-report.json'),theme=await read('runtime/theme-report.json'),witness=await read('runtime/witness-report.json');
const perf=await read('runtime/perf-report.json'),soak=await read('runtime/soak-report.json'),compat=await read('docs/validation/compat.json');
const lean=await read(`${session.vault}/.obsidian/plugins/mcs-cognitive-space/proofs/report.json`);
const artifactSha256=await artifactIdentity('dist');
for(const report of [desktop,restart,renderer,dynamic,demo,theme,witness,perf,soak]){assert.equal(report.status,'passed');assert.equal(report.artifactSha256,artifactSha256,'Stale desktop report; rerun against this build');}
for(const report of [desktop,dynamic,demo,renderer,theme,witness,perf,soak])assert.equal(report.version,version,'Report version must come from the plugin manifest');
// 兼容性核对是静态的：它比对的是清单里的 minAppVersion 与类型定义，不绑定构建产物。
assert.equal(compat.minAppVersion,(await read('manifest.json')).minAppVersion);
assert.equal(compat.status??'passed','passed');
assert.equal(lean.status,'passed');assert.equal(renderer.fitClearsControls,true);assert.ok(renderer.p95FrameMs<=renderer.targetP95Ms);
assert.equal(restart.viewPath,desktop.viewPath);assert.equal(restart.recoveryPath,desktop.recoveryPath);
assert.equal(desktop.contentVersion,(await read('src/generated/content.json')).version);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifacts=[];
for(const file of ['dist/main.js','dist/styles.css','dist/manifest.json','dist/worker.cjs','dist/kernel.py','dist/witness.py','src/generated/content.json'])artifacts.push({file,sha256:sha(await readFile(file))});
for(const source of lean.sources)assert.equal(sha(await readFile(source.file)),source.sha256,`Stale Lean source: ${source.file}`);
const tests=(await readdir('tests')).filter(f=>f.endsWith('.test.mjs')).map(f=>`tests/${f}`);
const tap=await new Promise((done,reject)=>execFile(process.execPath,['--test','--test-reporter=tap',...tests],{windowsHide:true,maxBuffer:2e6},(e,stdout,stderr)=>e?reject(new Error(stderr+stdout)):done(stdout)));
const core={status:'passed',tests:Number(tap.match(/# tests (\d+)/)?.[1]),passed:Number(tap.match(/# pass (\d+)/)?.[1]),failed:Number(tap.match(/# fail (\d+)/)?.[1]),checkedAt:new Date().toISOString()};assert.ok(core.tests&&core.tests===core.passed&&core.failed===0);await writeFile('runtime/core.tap',tap);
await mkdir('docs/validation',{recursive:true});
await writeFile('docs/validation/desktop.json',JSON.stringify({schema:'mcs-desktop-validation/2',version,recordedAt:new Date().toISOString(),evidence:'FINITE',host,artifactSha256,artifacts,core,desktop,dynamic,demo,theme,witness,perf,soak,compat,restart:{status:restart.status,checkedAt:restart.checkedAt,scope:restart.scope,rendererChanged:restart.rendererPid!==restart.previousRendererPid},renderer},null,2)+'\n');
await writeFile('docs/validation/lean.json',JSON.stringify(lean,null,2)+'\n');
console.log(JSON.stringify({host,version,coreTests:core.tests,desktopChecks:desktop.checks.length,dynamicChecks:dynamic.checks.length,themeChecks:theme.checks.length,witnessChecks:witness.checks.length,perfRuns:perf.runs.length,perfMisses:perf.missesFrameTarget.length,soakCycles:soak.cycles.length,p95FrameMs:renderer.p95FrameMs,leanTargets:lean.targets.length,artifacts:artifacts.length},null,2));
