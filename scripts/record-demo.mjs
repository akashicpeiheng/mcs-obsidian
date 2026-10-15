import {chromium} from '../../mcs-web/node_modules/playwright-core/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import assert from 'node:assert/strict';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {hostPage} from './host-page.mjs';
const session=JSON.parse(await readFile('runtime/obsidian-session.json')),example=JSON.parse(await readFile('examples/calculation.mcspack.json'));
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`),page=await hostPage(browser,session.vault);
const dir=`runtime/demo-${Date.now()}`;await mkdir(dir,{recursive:true});const frames=[];
try{
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
  await page.evaluate(async example=>{for(const type of ['mcs-network','markdown'])for(const l of app.workspace.getLeavesOfType(type))await l.detach();await app.plugins.plugins['mcs-cognitive-space'].newView(example.content,example.view);},example);
  await page.setViewportSize({width:1280,height:850});const ui=page.locator('.mcs-app');await ui.waitFor();
  const caption=async text=>page.evaluate(text=>{let el=document.querySelector('.mcs-demo-caption');if(!el){el=document.createElement('div');el.className='mcs-demo-caption';Object.assign(el.style,{position:'absolute',left:'18px',right:'18px',bottom:'30px',padding:'12px 18px',background:'rgba(22,61,56,.94)',color:'white',font:'14px/1.6 sans-serif',zIndex:'20',borderRadius:'12px',pointerEvents:'none'});document.querySelector('.mcs-app').appendChild(el);}el.textContent=text;},text);
  async function capture(){const path=`${dir}/${String(frames.length).padStart(3,'0')}.png`;await ui.screenshot({path});frames.push({path,time:performance.now()});}
  await ui.getByLabel('布局规则').selectOption('free');await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');await ui.getByRole('button',{name:'适配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  const target=ui.locator('[data-node-id="jiang:matrix-operations"]');await target.focus();await target.press('Space');await caption('自由探索 · 拖动牵动邻居，松手后弹性回稳');
  const b=await target.boundingBox(),cx=b.x+b.width/2,cy=b.y+b.height/2;await capture();await page.mouse.move(cx,cy);await page.mouse.down();
  for(let i=1;i<=10;i++){await page.mouse.move(cx+i*8,cy-i*3);await capture();}
  await page.mouse.up();await page.mouse.move(4,4);for(let i=0;i<16;i++){await page.waitForTimeout(50);await capture();}
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');await caption('缩放探索 · 远景圆点，放大后展开卡片；中心保持连续');
  const area=await ui.locator('.mcs-graph').boundingBox();await page.mouse.move(area.x+area.width/2,area.y+area.height/2);
  for(let i=0;i<9;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(35);await capture();}
  for(let i=0;i<8;i++){await page.mouse.wheel(0,100);await page.waitForTimeout(35);await capture();}
  await ui.getByRole('button',{name:'学习沙盘',exact:true}).click();await ui.getByRole('button',{name:'生成候选路线',exact:true}).click();await ui.getByLabel('沙盘：使用独立的假设背景').check();await ui.locator('.mcs-sidebar label.mcs-check').last().locator('input').check();await ui.getByLabel('回放进度').fill('0');await ui.getByRole('button',{name:'适配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  await caption('学习回放 · 坐标稳定，实际前提 → 联合关系 → 结论依次突出');await ui.getByLabel('播放速度').selectOption('0.5');await ui.getByRole('button',{name:'播放',exact:true}).click();
  for(let i=0;i<24;i++){await page.waitForTimeout(65);await capture();}
  if(await ui.getByRole('button',{name:'暂停',exact:true}).count())await ui.getByRole('button',{name:'暂停',exact:true}).click();await caption('暂停／跳步 · 动画不自动确认掌握，沙盘假设与真实记录分离');await ui.getByLabel('回放进度').fill('8');await capture();await page.waitForTimeout(600);await capture();
  await page.evaluate(()=>document.querySelector('.mcs-demo-caption')?.remove());
  await writeFile(`${dir}/frames.json`,JSON.stringify(frames,null,2));
  const encoded=JSON.parse(await new Promise((done,reject)=>execFile('python',['scripts/encode-demo.py',`${dir}/frames.json`,'docs/dynamic-demo.gif'],{windowsHide:true},(e,stdout)=>e?reject(e):done(stdout))));
  const report={artifactSha256:await artifactIdentity(`${session.vault}/.obsidian/plugins/mcs-cognitive-space`),status:'passed',version,evidence:'ILLUSTRATION',source:'Actual isolated Windows Obsidian renderer; screenshots encoded as animation.',capturedFrames:frames.length,frames:encoded.frames,width:encoded.width,height:encoded.height,durationMs:encoded.durationMs,captureDurationMs:Math.round(frames.at(-1).time-frames[0].time+1000),file:'docs/dynamic-demo.gif',checkedAt:new Date().toISOString()};await writeFile('runtime/demo-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
