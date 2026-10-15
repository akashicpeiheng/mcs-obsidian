import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import assert from 'node:assert/strict';
import {artifactIdentity} from './desktop-artifact.mjs';
import {hostPage} from './host-page.mjs';
import {version} from './manifest.mjs';
const session=JSON.parse(await readFile('runtime/obsidian-session.json')),prior=JSON.parse(await readFile('runtime/browser-report.json'));
let browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`),page=await hostPage(browser,session.vault);
assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
const previousRendererPid=await page.evaluate(()=>process.pid);
await page.close();await browser.close();
// The previous process may take a moment to release its profile lock.
await new Promise(done=>setTimeout(done,1500));
await new Promise((done,reject)=>execFile(process.execPath,['scripts/start-test-vault.mjs','--reuse'],{windowsHide:true},e=>e?reject(e):done()));
for(let i=0;i<40;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);break;}catch{await new Promise(done=>setTimeout(done,250));}}
try{
  page=await hostPage(browser,session.vault);await page.waitForFunction(()=>typeof app!=='undefined'&&app.plugins?.plugins?.['mcs-cognitive-space'],undefined,{timeout:15000});
  const rendererPid=await page.evaluate(()=>process.pid);assert.notEqual(rendererPid,previousRendererPid);
  // 重启会重新读取插件清单，正好用它核对库内那份确实是本次构建的版本。
  const loaded=await page.evaluate(()=>app.plugins.plugins['mcs-cognitive-space']?.manifest?.version??null);
  assert.equal(loaded,version,`Obsidian loaded manifest ${loaded}, expected ${version}`);
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
  await page.evaluate(()=>new Promise(done=>app.workspace.onLayoutReady(done)));
  await page.evaluate(path=>app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(path)),prior.viewPath);
  await page.locator('.mcs-app').last().getByLabel('视图名称').waitFor();
  assert.equal(await page.locator('.mcs-app').last().getByLabel('视图名称').inputValue(),'窗口A已保存');
  await page.evaluate(path=>app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(path)),prior.recoveryPath);
  await page.locator('.mcs-app').last().getByLabel('视图名称').waitFor();
  assert.equal(await page.locator('.mcs-app').last().getByLabel('视图名称').inputValue(),'窗口B需要恢复（恢复副本）');
  const report={artifactSha256:await artifactIdentity(`${session.vault}/.obsidian/plugins/mcs-cognitive-space`),status:'passed',version,checkedAt:new Date().toISOString(),previousRendererPid,rendererPid,scope:'Same isolated profile, actual application restart; both saved and recovered views reopen with content snapshots.',viewPath:prior.viewPath,recoveryPath:prior.recoveryPath};
  await writeFile('runtime/restart-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
