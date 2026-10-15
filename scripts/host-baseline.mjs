import {chromium} from '../../mcs-web/node_modules/playwright-core/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {basename,dirname} from 'node:path';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {createView} from '../src/core.mjs';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {hostPage} from './host-page.mjs';

/*
 * 环境基线：这台机器**什么都不画**的时候，帧间隔是多少。
 *
 * 为什么要单独量它：p95 是「宿主 requestAnimationFrame 间隔」与「SVG 实际重绘间隔」
 * 里较差的那个。如果宿主自己就在 30ms 上下抖，那插件再快也压不到 20ms——
 * 这时报告里写「插件 p95 = 36ms」会让人以为是插件的锅。先量出地板，
 * 再看插件在这块地板上加了多少钱，结论才站得住。
 *
 * 三种状态各量 8 秒：
 *   idle      没有 MCS 视图，只有 Obsidian 空窗口；
 *   empty     一个 0 节点的 MCS 视图（画布、工具栏、侧栏都在，只是没内容）；
 *   small     9 节点 / 60 联合行动的真实示范视图（静止，不拖动）。
 *
 * 用法：node scripts/host-baseline.mjs [--session=runtime/perf-session.json] [--seconds=8]
 */

const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??null;
const sessionPath=argument('session')??'runtime/perf-session.json';
const SECONDS=Math.max(3,Number(argument('seconds')??8));
const cores_available=cpus().length;

const session=JSON.parse(await readFile(sessionPath));
const example=JSON.parse(await readFile('examples/calculation.mcspack.json'));
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
const page=await hostPage(browser,session.vault);
assert.ok(page,`独立实例主窗口未找到（${sessionPath}）`);
page.setDefaultTimeout(60000);
const artifact=await artifactIdentity(`${session.vault}/.obsidian/plugins/mcs-cognitive-space`);

const powershell=command=>new Promise((done,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:30000},(error,stdout)=>error?reject(error):done(stdout)));
const runMarker=basename(dirname(session.profile));
let ownPids=new Set();
async function resolveOwnPids(){
  const output=await powershell(`$root=@(Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" | Where-Object { $_.CommandLine -like '*${runMarker}*' }).ProcessId; $all=@($root); foreach($r in $root){ $c=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$r").ProcessId; $all+=$c; foreach($x in $c){ $all+=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$x").ProcessId } }; ($all | Where-Object { $_ } | Sort-Object -Unique) -join ','`);
  ownPids=new Set(output.trim().split(',').filter(Boolean).map(Number));
}
async function foreignCpuSeconds(){
  const excluded=[...ownPids].join(',');
  const output=await powershell(`$ex=@(${excluded}); $s=0; foreach($p in Get-Process){ if($p.ProcessName -eq 'node'){continue}; if($ex -contains $p.Id){continue}; if($p.CPU){$s+=$p.CPU} }; [math]::Round($s,3)`);
  return Number(output.trim());
}
const detachAll=async()=>{await page.evaluate(async()=>{for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();});await page.waitForTimeout(500);};

async function sample(seconds,driver){
  const cpuBefore=await foreignCpuSeconds(),started=Date.now();
  await page.evaluate(()=>{
    window.__baseFrames=[];window.__baseMeasuring=true;
    let prior=performance.now();
    function tick(now){if(!window.__baseMeasuring)return;window.__baseFrames.push(now-prior);prior=now;requestAnimationFrame(tick);}
    requestAnimationFrame(tick);
  });
  if(driver)await driver(seconds);
  else await page.waitForTimeout(seconds*1000);
  const frames=await page.evaluate(()=>{window.__baseMeasuring=false;return window.__baseFrames;});
  const elapsed=(Date.now()-started)/1000;
  const cores=((await foreignCpuSeconds())-cpuBefore)/elapsed;
  const sorted=[...frames].sort((a,b)=>a-b);
  const at=q=>sorted.length?+sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*q)-1))].toFixed(2):null;
  return {state:null,frames:frames.length,seconds:Math.round(elapsed),
    fps:+(frames.length/elapsed).toFixed(1),
    p50Ms:at(.5),p90Ms:at(.9),p95Ms:at(.95),p99Ms:at(.99),maxMs:sorted.length?+sorted.at(-1).toFixed(2):null,
    meanMs:sorted.length?+(frames.reduce((a,b)=>a+b,0)/frames.length).toFixed(2):null,
    foreignBusyPercent:+(100*cores/cores_available).toFixed(1)};
}

/** 与性能矩阵同一条动作路径，用来把「拖动」与「滚轮缩放」分开计价。 */
const dragDriver=withWheel=>async seconds=>{
  const target=page.locator(`[data-node-id="${example.view.added[5]}"]`);
  await target.focus();
  const box=await target.boundingBox();
  assert.ok(box,'拖动目标不可见');
  const cx=box.x+box.width/2,cy=box.y+box.height/2;
  await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+6,cy+4);
  const deadline=Date.now()+seconds*1000;
  let i=0;
  while(Date.now()<deadline){
    const angle=i*.11;
    await page.mouse.move(cx+Math.cos(angle)*75,cy+Math.sin(angle)*48);
    if(withWheel&&i%12===0)await page.mouse.wheel(0,i%24===0?-90:90);
    await page.waitForTimeout(16);
    i++;
  }
  await page.mouse.up();await page.mouse.move(4,4);
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
};

const results={};
try{
  await page.waitForFunction(()=>typeof app!=='undefined'&&app.workspace);
  const trust=page.getByRole('button',{name:'Trust author and enable plugins'});
  if(await trust.count()){await trust.click();await page.waitForFunction(()=>app.plugins?.plugins?.['mcs-cognitive-space']);}
  await page.waitForFunction(()=>app.plugins?.plugins?.['mcs-cognitive-space']);
  await page.evaluate(()=>new Promise(done=>app.workspace.onLayoutReady(done)));
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault);
  await page.setViewportSize({width:1440,height:960});
  await resolveOwnPids();

  await detachAll();
  await page.waitForTimeout(600);
  results.idle=await sample(SECONDS);

  await page.evaluate(async({content,view})=>{await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);},{content:example.content,view:createView(example.content,'基线·空白视图')});
  await page.waitForSelector('.mcs-graph');
  await page.waitForTimeout(800);
  results.empty=await sample(SECONDS);

  await page.evaluate(async({content,view})=>{for(const leaf of app.workspace.getLeavesOfType('mcs-network'))await leaf.detach();await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);},{content:example.content,view:example.view});
  await page.waitForSelector('.mcs-card');
  await page.getByRole('button',{name:'适配',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  await page.waitForTimeout(800);
  results.small=await sample(SECONDS);
  results.smallDragOnly=await sample(SECONDS,dragDriver(false));
  results.smallDragAndWheel=await sample(SECONDS,dragDriver(true));
  await detachAll();

  const host=await page.evaluate(()=>{const os=require('node:os');return {cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,ramBytes:os.totalmem(),electron:process.versions.electron,devicePixelRatio};});
  const report={schema:'mcs-host-baseline/1',artifactSha256:artifact,version,status:'passed',evidence:'FINITE',
    scope:'FINITE：这台机器、此刻的电源/显示状态与外部负载下，Obsidian 空转与 MCS 视图静止时的帧间隔地板。它不是插件性能，只是解释插件数字时所需的参照。',
    method:{seconds:SECONDS,sampling:'在渲染进程里连续采样 requestAnimationFrame 间隔，取分位数',foreign:'取样前后各量一次外部进程（排除本实例进程树与 node）的 CPU 累计时间'},
    session:{path:sessionPath,vault:session.vault,port:session.port},host,results,checkedAt:new Date().toISOString()};
  await writeFile('runtime/host-baseline.json',JSON.stringify(report,null,2));
  await mkdir('docs/validation',{recursive:true});
  await writeFile('docs/validation/host-baseline.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
