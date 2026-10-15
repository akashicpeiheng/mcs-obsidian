import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createView,contentHash} from '../src/core.mjs';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {hostPage} from './host-page.mjs';
const base=JSON.parse(await readFile('src/generated/content.json')),session=JSON.parse(await readFile('runtime/obsidian-session.json'));
const nodes=Array.from({length:200},(_,i)=>({...base.nodes[0],id:`stress:${i}`,title:`压力节点 ${i}`,chapter:'有限压力场景',body:'ILLUSTRATION：渲染与摆位测试材料。',evidenceStatus:'NOT-CLAIMED'}));
const actions=Array.from({length:600},(_,i)=>({id:`stress-action:${i}`,title:`联合行动 ${i}`,version:'1',mode:'deduction',inputs:[nodes[i%200].id,nodes[(i+37)%200].id].map(node=>({node,accepts:['statement']})),outputs:[{node:nodes[(i+91+Math.floor(i/200)*23)%200].id,provides:['statement']}],witness:{status:'ILLUSTRATION'},openAssumptions:[]}));
const content={schema:'mcs-content/1',version:'pending',title:'有限渲染场景',nodes,actions,boundary:[],templates:[]};content.version=contentHash(content);
assert.equal(new Set(actions.map(a=>JSON.stringify([a.inputs,a.outputs]))).size,600,'600 distinct joint actions');
const start=performance.now(),view={...createView(content,'200 节点 / 600 联合行动'),added:nodes.map(n=>n.id),positions:Object.fromEntries(nodes.map((n,i)=>[n.id,{x:i%20*210,y:Math.floor(i/20)*90}]))},layoutMs=performance.now()-start;
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`),page=await hostPage(browser,session.vault),errors=[];
page.on('pageerror',e=>errors.push(e.stack));page.on('crash',()=>console.error('Isolated renderer crashed'));page.setDefaultTimeout(15000);
try{
  await page.waitForFunction(()=>typeof app!=='undefined'&&app.workspace&&app.plugins?.plugins?.['mcs-cognitive-space']);await page.evaluate(()=>new Promise(done=>app.workspace.onLayoutReady(done)));
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
  await page.evaluate(async()=>{for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();});
  await page.evaluate(async({content,view})=>{await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);},{content,view});
  await page.waitForSelector('.mcs-card');await page.setViewportSize({width:1440,height:960});
  assert.equal(await page.locator('.mcs-card').count(),200);
  await page.getByRole('button',{name:'适配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  assert.equal(await page.locator('.mcs-actions-canvas').evaluate(el=>Number(el.dataset.edgeCount)),600,'All 600 joint actions are drawn after fit');
  console.log(JSON.stringify({stage:'stress view ready',memory:await page.evaluate(()=>process.getProcessMemoryInfo())}));
  const coldStart=performance.now(),warm=page.locator('[data-node-id="stress:105"]');await warm.focus();const warmBox=await warm.boundingBox();await page.mouse.move(warmBox.x+warmBox.width/2,warmBox.y+warmBox.height/2);await page.mouse.down();await page.mouse.move(warmBox.x+warmBox.width/2+30,warmBox.y+warmBox.height/2+20,{steps:5});await page.mouse.up();await page.mouse.move(4,4);await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');const coldConvergenceMs=performance.now()-coldStart;
  await page.getByRole('button',{name:'适配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  const target=page.locator('[data-node-id="stress:105"]');await target.focus();const box=await target.boundingBox();assert.ok(box);
  const cx=box.x+box.width/2,cy=box.y+box.height/2;await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+6,cy+4);
  await page.waitForTimeout(250);
  await page.evaluate(()=>{window.__mcsFrames=[];window.__mcsDrawFrames=[];window.__mcsMeasuring=true;const svg=document.querySelector('.mcs-graph');let prior=performance.now(),paint=svg.mcsLastPaint;function tick(now){if(!window.__mcsMeasuring)return;window.__mcsFrames.push(now-prior);prior=now;const next=svg.mcsLastPaint;if(next!==paint){window.__mcsDrawFrames.push(next-paint);paint=next;}requestAnimationFrame(tick);}requestAnimationFrame(tick);});
  for(let i=0;i<120;i++){
    const angle=i*.11;await page.mouse.move(cx+Math.cos(angle)*75,cy+Math.sin(angle)*48);
    if(i%12===0)await page.mouse.wheel(0,i%24===0?-90:90);
    await page.waitForTimeout(16);
  }
  const {times,drawTimes}=await page.evaluate(()=>{window.__mcsMeasuring=false;return {times:window.__mcsFrames,drawTimes:window.__mcsDrawFrames};});await page.mouse.up();await page.mouse.move(4,4);
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');await page.waitForFunction(()=>document.querySelector('.mcs-save-state')?.textContent==='已保存');
  await page.waitForTimeout(250);const count=await page.locator('.mcs-graph').evaluate(el=>el.mcsPaintCount);await page.waitForTimeout(350);assert.ok((await page.locator('.mcs-graph').evaluate(el=>el.mcsPaintCount))-count<=1,'Convergence stops the renderer loop; one pending React/resize paint is allowed');
  assert.ok(times.length>=80);const percentile=times=>[...times].sort((a,b)=>a-b)[Math.ceil(times.length*.95)-1],p95=Math.max(percentile(times),percentile(drawTimes));
  assert.deepEqual(errors,[]);const report={artifactSha256:await artifactIdentity(`${session.vault}/.obsidian/plugins/mcs-cognitive-space`),status:p95<=33?'pending-fit':'failed',scope:'FINITE: one actual Windows Obsidian graph; sustained real pointer drag and wheel zoom after one full force convergence. p95 is the worse of host RAF and actual graph update intervals (SVG plus GPU actions). Initial cold convergence is timed separately. No general performance guarantee.',version,nodes:200,actions:600,hyperedges:600,distinctHyperedges:600,viewport:page.viewportSize(),devicePixelRatio:await page.evaluate(()=>devicePixelRatio),layoutMs,coldConvergenceMs,frames:times.length,graphUpdates:drawTimes.length,durationMs:times.reduce((a,b)=>a+b,0),p95FrameMs:p95,hostP95Ms:percentile(times),graphP95Ms:percentile(drawTimes),targetP95Ms:33,meanFrameMs:times.reduce((a,b)=>a+b,0)/times.length,maxFrameMs:Math.max(...times),convergedWithoutContinuousPaint:true,checkedAt:new Date().toISOString(),errors};
  await writeFile('runtime/renderer-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.ok(p95<=33,`p95 ${p95}ms exceeds 33ms`);
  const example=JSON.parse(await readFile('examples/calculation.mcspack.json'));
  await page.evaluate(async({content,view})=>{for(const leaf of app.workspace.getLeavesOfType('mcs-network'))await leaf.detach();await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);},example);
  const ui=page.locator('.mcs-app');await ui.getByRole('button',{name:'学习沙盘',exact:true}).click();await ui.getByLabel('沙盘：使用独立的假设背景').check();await ui.locator('.mcs-sidebar label.mcs-check').last().locator('input').check();
  const slider=ui.getByLabel('回放进度');await slider.fill(await slider.getAttribute('max'));await ui.getByRole('button',{name:'适配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcs-save-state')?.textContent==='已保存');
  const area=await ui.locator('.mcs-graph').boundingBox(),toolbar=await ui.locator('.mcs-canvas-toolbar').boundingBox(),player=await ui.locator('.mcs-player').boundingBox();
  for(const card of await ui.locator('.mcs-card').all()){const b=await card.boundingBox();assert.ok(b&&b.x>=area.x&&b.x+b.width<=area.x+area.width&&b.y>toolbar.y+toolbar.height&&b.y+b.height<player.y,'Fit leaves every example node clear of toolbar/playback controls');}
  await ui.screenshot({path:'runtime/learning-view.png'});report.status='passed';report.fitClearsControls=true;report.renderer=await page.locator('.mcs-actions-canvas').getAttribute('data-renderer');await writeFile('runtime/renderer-report.json',JSON.stringify(report,null,2));console.log('Fit and learning screenshot passed.');
}finally{await browser.close();}
