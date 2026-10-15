import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {basename,dirname} from 'node:path';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {createView,contentHash} from '../src/core.mjs';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {hostPage} from './host-page.mjs';

/*
 * 稳定性与内存验收：反复开关视图 + 持续操作，看有没有泄漏或退化。
 *
 * 补的是性能矩阵没覆盖的两件事：
 *   1. **反复开关**。每个视图都会新建一个 WebGL 绘制层（顶点缓冲起步 4MB，按需翻倍）
 *      与一份 SVG。关掉视图时是否真的还回去？连开连关 8 次，逐次记录工作集与 JS 堆。
 *   2. **持续操作**。一口气拖两分钟，按 30 秒分桶统计帧间隔：如果第 95 百分位随时间
 *      单调上升，说明有东西在累积（监听器、缓存或绘制资源），而不是一次性的噪声。
 *
 * 判定：
 *   - 8 次开关后工作集不得比首次循环高出 maxGrowthMb（默认 80MB）；
 *   - 最后一个 30 秒桶的 p95 不得高于第一个桶的 1.5 倍；
 *   - 全程不得出现页面异常或渲染进程崩溃。
 *
 * 用法：
 *   node scripts/soak-check.mjs [--session=runtime/perf-session.json] [--cycles=8] [--soakSeconds=120]
 */

const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??null;
const sessionPath=argument('session')??'runtime/perf-session.json';
const CYCLES=Math.max(2,Number(argument('cycles')??8));
const SOAK_SECONDS=Math.max(60,Number(argument('soakSeconds')??120));
const MAX_GROWTH_MB=Number(argument('maxGrowthMb')??80);
const DEGRADATION_LIMIT=1.5;
const cores_available=cpus().length;

const base=JSON.parse(await readFile('src/generated/content.json'));
const session=JSON.parse(await readFile(sessionPath));

function syntheticBundle(nodes,actions){
  const items=Array.from({length:nodes},(_,i)=>({...base.nodes[0],id:`soak:${i}`,title:`压力节点 ${i}`,chapter:'有限压力场景',body:'ILLUSTRATION：稳定性测试材料。',evidenceStatus:'NOT-CLAIMED'}));
  const edges=Array.from({length:actions},(_,i)=>({
    id:`soak-action:${i}`,title:`联合行动 ${i}`,version:'1',mode:'deduction',
    inputs:[items[i%nodes].id,items[(i+37)%nodes].id].map(node=>({node,accepts:['statement']})),
    outputs:[{node:items[(i+91+Math.floor(i/nodes)*23)%nodes].id,provides:['statement']}],
    witness:{status:'ILLUSTRATION'},openAssumptions:[],
  }));
  const content={schema:'mcs-content/1',version:'pending',title:'稳定性场景',nodes:items,actions:edges,boundary:[],templates:[]};
  content.version=contentHash(content);
  return {content,view:{...createView(content,`${nodes} 节点 / ${actions} 联合行动`),added:items.map(n=>n.id),positions:Object.fromEntries(items.map((n,i)=>[n.id,{x:i%20*210,y:Math.floor(i/20)*90}]))}};
}

const HEAVY=syntheticBundle(200,600);
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
const page=await hostPage(browser,session.vault),errors=[];
assert.ok(page,`独立实例主窗口未找到（${sessionPath}）`);
page.on('pageerror',error=>errors.push(error.stack));
page.on('crash',()=>errors.push('renderer crashed'));
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
/*
 * Electron 37 的 process.getProcessMemoryInfo() 返回 {residentSet, private, shared}（单位 KB），
 * 不是旧的 {workingSetSize, peakWorkingSetSize, privateBytes}；两套名字都认。
 */
const memory=()=>page.evaluate(async()=>{
  const info=await process.getProcessMemoryInfo();
  const usage=process.memoryUsage();
  const mb=kb=>typeof kb==='number'?+(kb/1024).toFixed(1):null;
  return {residentMb:mb(info.residentSet??info.workingSetSize),privateMb:mb(info.private??info.privateBytes),sharedMb:mb(info.shared),rssMb:+(usage.rss/1048576).toFixed(1),heapUsedMb:+(usage.heapUsed/1048576).toFixed(1),jsHeapMb:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null};
});
async function dismissModals(){
  await page.evaluate(()=>{app.setting?.close?.();for(const button of document.querySelectorAll('.modal-close-button, .modal-container .mod-cancel'))button.click();}).catch(()=>{});
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(150);
}
const detachAll=async()=>{await page.evaluate(async()=>{for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();});await page.waitForTimeout(500);};
async function openHeavy(){
  await dismissModals();
  await page.evaluate(async({content,view})=>{
    for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();
    await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);
  },HEAVY);
  await page.waitForSelector('.mcs-card',{state:'attached'});
  await page.getByRole('button',{name:'适配',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
}
async function interact(seconds){
  const target=page.locator(`[data-node-id="${HEAVY.view.added[5]}"]`);
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
    if(i%12===0)await page.mouse.wheel(0,i%24===0?-90:90);
    await page.waitForTimeout(16);
    i++;
  }
  await page.mouse.up();await page.mouse.move(4,4);
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  return i;
}

const cycles=[],buckets=[],checks={};
let completed=false;
async function writeReport(status){
  const report={
    schema:'mcs-plugin-soak/1',artifactSha256:artifact,version,status,evidence:'FINITE',
    scope:'FINITE：一台 Windows 机器、专用隔离实例、200 节点 / 600 联合行动的同一张图；反复开关视图并持续真实拖动。不构成其他机器、更长时段或更大图的保证。',
    method:{cycles:CYCLES,soakSeconds:SOAK_SECONDS,bucketSeconds:30,maxGrowthMb:MAX_GROWTH_MB,degradationLimit:DEGRADATION_LIMIT,
      memory:'Electron process.getProcessMemoryInfo() 的工作集与私有字节，外加 renderer 的 performance.memory JS 堆；每次都在视图关闭并等待 500ms 之后取样。',
      foreign:'每次取样前后各量一次外部进程（排除本实例进程树与 node）的 CPU 累计时间，换算出这段窗口里别人占了几核，用来判断当次数字是否被别人的负载干扰。'},
    session:{path:sessionPath,vault:session.vault,port:session.port},
    host:hostInfo,cycles,buckets,checks,
    errors,checkedAt:new Date().toISOString(),
  };
  await writeFile('runtime/soak-report.json',JSON.stringify(report,null,2));
  await mkdir('docs/validation',{recursive:true});
  await writeFile('docs/validation/soak.json',JSON.stringify(report,null,2));
  return report;
}
let hostInfo=null;

try{
  await page.waitForFunction(()=>typeof app!=='undefined'&&app.workspace);
  const trust=page.getByRole('button',{name:'Trust author and enable plugins'});
  if(await trust.count()){await trust.click();await page.waitForFunction(()=>app.plugins?.plugins?.['mcs-cognitive-space']);}
  await page.waitForFunction(()=>app.plugins?.plugins?.['mcs-cognitive-space']);
  await page.evaluate(()=>new Promise(done=>app.workspace.onLayoutReady(done)));
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault,'not the perf vault');
  assert.equal(await page.evaluate(()=>app.plugins.plugins['mcs-cognitive-space'].manifest.version),version);
  await page.setViewportSize({width:1440,height:960});
  hostInfo=await page.evaluate(()=>{const os=require('node:os');return {electron:process.versions.electron,node:process.versions.node,platform:process.platform,cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,ramBytes:os.totalmem(),devicePixelRatio};});
  await resolveOwnPids();
  await detachAll();
  hostInfo.baselineMemory=await memory();

  // ---- 1. 反复开关视图：每次关闭后取样，看有没有还回去 ----------------------
  for(let cycle=1;cycle<=CYCLES;cycle++){
    const cpuBefore=await foreignCpuSeconds(),started=Date.now();
    await openHeavy();
    await interact(6);
    await detachAll();
    const seconds=Math.max(.001,(Date.now()-started)/1000);
    const cores=((await foreignCpuSeconds())-cpuBefore)/seconds;
    cycles.push({cycle,...await memory(),seconds:Math.round(seconds),foreignCores:+cores.toFixed(2),foreignBusyPercent:+(100*cores/cores_available).toFixed(1)});
    console.log(JSON.stringify({stage:'cycle',cycle,residentMb:cycles.at(-1).residentMb,jsHeapMb:cycles.at(-1).jsHeapMb,foreignBusyPercent:cycles.at(-1).foreignBusyPercent}));
    await writeReport('running');
  }
  const first=cycles[0],last=cycles.at(-1);
  const growthMb=+(last.residentMb-first.residentMb).toFixed(1);
  const heapGrowthMb=first.jsHeapMb!==null&&last.jsHeapMb!==null?+(last.jsHeapMb-first.jsHeapMb).toFixed(1):null;
  const baselineDeltaMb=+(last.residentMb-hostInfo.baselineMemory.residentMb).toFixed(1);

  // ---- 2. 持续操作：按 30 秒分桶，看 p95 是否随时间上升 ---------------------
  await openHeavy();
  await page.evaluate(()=>{
    window.__mcsFrames=[];window.__mcsDrawFrames=[];window.__mcsMeasuring=true;
    const svg=document.querySelector('.mcs-graph');let prior=performance.now(),paint=svg.mcsLastPaint;
    function tick(now){
      if(!window.__mcsMeasuring)return;
      window.__mcsFrames.push(now-prior);prior=now;
      const next=svg.mcsLastPaint;if(next!==paint){window.__mcsDrawFrames.push(next-paint);paint=next;}
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const started=Date.now();
  let lastCount=0,bucketIndex=0;
  while((Date.now()-started)/1000<SOAK_SECONDS){
    const cpuBefore=await foreignCpuSeconds(),bucketStart=Date.now();
    await interact(30);
    bucketIndex++;
    const frames=await page.evaluate(index=>window.__mcsFrames.slice(index),lastCount);
    lastCount+=frames.length;
    const sorted=[...frames].sort((a,b)=>a-b);
    const p95=sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)];
    const seconds=Math.max(.001,(Date.now()-bucketStart)/1000);
    const cores=((await foreignCpuSeconds())-cpuBefore)/seconds;
    buckets.push({bucket:bucketIndex,seconds:Math.round(seconds),frames:frames.length,p95FrameMs:+p95.toFixed(2),meanFrameMs:+(frames.reduce((a,b)=>a+b,0)/Math.max(1,frames.length)).toFixed(2),foreignBusyPercent:+(100*cores/cores_available).toFixed(1),memory:await memory()});
    console.log(JSON.stringify({stage:'soak',bucket:bucketIndex,p95FrameMs:buckets.at(-1).p95FrameMs,frames:frames.length,residentMb:buckets.at(-1).memory.residentMb,foreignBusyPercent:buckets.at(-1).foreignBusyPercent}));
    await writeReport('running');
  }
  await page.evaluate(()=>{window.__mcsMeasuring=false;});
  await detachAll();

  const firstBucket=buckets[0],lastBucket=buckets.at(-1);
  const degradation=+(lastBucket.p95FrameMs/firstBucket.p95FrameMs).toFixed(2);

  assert.deepEqual(errors.map(error=>error.split('\n')[0]),[],'出现页面异常或渲染进程崩溃');
  assert.ok(growthMb<=MAX_GROWTH_MB,`${CYCLES} 次开关后工作集增长 ${growthMb}MB，超过 ${MAX_GROWTH_MB}MB`);
  assert.ok(baselineDeltaMb<=MAX_GROWTH_MB,`全部视图关闭后，工作集仍比测试前高 ${baselineDeltaMb}MB，超过 ${MAX_GROWTH_MB}MB`);
  assert.ok(degradation<=DEGRADATION_LIMIT,`最后一个 30 秒桶的 p95 是最初的 ${degradation} 倍，超过 ${DEGRADATION_LIMIT} 倍`);
  Object.assign(checks,{cycles:CYCLES,growthMb,heapGrowthMb,baselineDeltaMb,degradation,buckets:buckets.length,
    firstBucketP95Ms:firstBucket.p95FrameMs,lastBucketP95Ms:lastBucket.p95FrameMs,
    worstForeignBusyPercent:Math.max(...cycles.map(cycle=>cycle.foreignBusyPercent??0),...buckets.map(bucket=>bucket.foreignBusyPercent??0))});
  completed=true;
  await writeReport('passed');
  console.log(JSON.stringify({status:'passed',artifactSha256:artifact,version,checks},null,2));
}finally{
  if(!completed)await writeReport('partial');
  await browser.close();
}
