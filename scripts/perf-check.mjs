import {chromium} from '../../mcs-web/node_modules/playwright-core/index.mjs';
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
 * 性能验收：两条绘制路径 × 五个规模 × 若干次重复。
 *
 * 为什么单独成一支脚本：0.2.1 只实测了 WebGL 路径的 200 节点 / 600 联合行动
 * （p95 30.3ms），二维 Canvas 回退当时只核对了配色与对比度，**没有测性能**，
 * 也没有测过「图变大时会怎样」。这里把两件事一起补上。
 *
 * 三条纪律：
 *   1. **专用实例**。默认读 `runtime/perf-session.json`（由 start-perf-vault.mjs 建立），
 *      不与桌面回归共用渲染进程；同库里只要还有别人在开关视图，第 95 百分位测的
 *      就是两台脚本互相干扰的结果，不是插件的性能。
 *   2. **记录机器忙闲**。每次测量前后各取一次全机 CPU 时间，算出这段窗口的整机占用率。
 *      占用率高的那几次标记为 contended，不参与判定；要判定的规模如果每次都被干扰，
 *      就直接失败并说明原因，而不是拿一个被污染的数值当结论。
 *   3. **重复取样取最好的一次**。干扰只会让帧变慢、不会变快，所以「多次里最好的那次」
 *      是对无干扰性能的保守估计；每次的原始值都留在记录里。
 *
 * 判定标准只保留可辩护的两条：
 *   - WebGL 在 200 节点 / 600 行动：p95 ≤ 33ms（沿用既有门槛，不改口径）；
 *   - 两条路径在**真实内容上限**（全书地图 59 节点）：p95 ≤ 33ms。
 * 其余规模一律只记录数值，不编造通过线；超了就如实写出来。
 *
 * 用法：
 *   node scripts/perf-check.mjs [--session=runtime/perf-session.json] [--renderer=webgl,canvas]
 *                               [--scales=real-9,...] [--repeat=2] [--maxBusy=25]
 */

const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??null;
const sessionPath=argument('session')??'runtime/perf-session.json';
const onlyRenderers=argument('renderer')?.split(',')??null;
const onlyScales=argument('scales')?.split(',')??null;
const REPEAT=Math.max(1,Number(argument('repeat')??2));
const MAX_BUSY=Number(argument('maxBusy')??30);

const SAMPLES=120;
const IDLE_CPU_MS=3000;
const FRAME_TARGET_MS=33;
const cores_available=cpus().length;

const base=JSON.parse(await readFile('src/generated/content.json'));
const session=JSON.parse(await readFile(sessionPath));

/** 合成压力内容：每个行动的前置与产出组合都不重复，才能压出真实的绘制量。 */
function syntheticBundle(nodes,actions){
  const items=Array.from({length:nodes},(_,i)=>({...base.nodes[0],id:`stress:${i}`,title:`压力节点 ${i}`,chapter:'有限压力场景',body:'ILLUSTRATION：渲染与摆位测试材料。',evidenceStatus:'NOT-CLAIMED'}));
  const edges=Array.from({length:actions},(_,i)=>({
    id:`stress-action:${i}`,title:`联合行动 ${i}`,version:'1',mode:'deduction',
    inputs:[items[i%nodes].id,items[(i+37)%nodes].id].map(node=>({node,accepts:['statement']})),
    outputs:[{node:items[(i+91+Math.floor(i/nodes)*23)%nodes].id,provides:['statement']}],
    witness:{status:'ILLUSTRATION'},openAssumptions:[],
  }));
  assert.equal(new Set(edges.map(a=>JSON.stringify([a.inputs,a.outputs]))).size,edges.length,'合成行动的联合输入组合必须两两不同');
  const content={schema:'mcs-content/1',version:'pending',title:`有限渲染场景 ${nodes}/${actions}`,nodes:items,actions:edges,boundary:[],templates:[]};
  content.version=contentHash(content);
  return {content,view:{...createView(content,`${nodes} 节点 / ${actions} 联合行动`),added:items.map(n=>n.id),positions:Object.fromEntries(items.map((n,i)=>[n.id,{x:i%20*210,y:Math.floor(i/20)*90}]))}};
}

const examples=Object.fromEntries(await Promise.all(['calculation','book-map'].map(async name=>{
  const bundle=JSON.parse(await readFile(`examples/${name}.mcspack.json`,'utf8'));
  return [name,{content:bundle.content,view:bundle.view}];
})));

const SCALES=[
  {id:'real-9',label:'真实内容 · 计算示范路线',kind:'example',source:'calculation'},
  {id:'real-59',label:'真实内容 · 全书地图（上限）',kind:'example',source:'book-map'},
  {id:'stress-50',label:'合成压力 · 小',kind:'synthetic',build:()=>syntheticBundle(50,100)},
  {id:'stress-200',label:'合成压力 · 既有基线',kind:'synthetic',build:()=>syntheticBundle(200,600)},
  {id:'stress-400',label:'合成压力 · 大',kind:'synthetic',build:()=>syntheticBundle(400,900)},
].map(scale=>{
  const bundle=scale.kind==='example'?examples[scale.source]:scale.build();
  return {...scale,bundle,nodes:bundle.view.added.length,actions:bundle.content.actions.length};
});

const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
const page=await hostPage(browser,session.vault),errors=[];
assert.ok(page,`独立实例主窗口未找到（${sessionPath}）`);
page.on('pageerror',error=>errors.push(error.stack));
page.on('crash',()=>errors.push('renderer crashed'));
page.setDefaultTimeout(60000);

const artifact=await artifactIdentity(`${session.vault}/.obsidian/plugins/mcs-cognitive-space`);
const runs=[],notes=[];
let completed=false,hostInfo=null,missesFrameTarget=[];

/*
 * Electron 37 的 process.getProcessMemoryInfo() 返回 {residentSet, private, shared}（单位 KB），
 * 不是旧的 {workingSetSize, peakWorkingSetSize, privateBytes}；两套名字都认，避免以后再踩。
 */
const memory=()=>page.evaluate(async()=>{
  const info=await process.getProcessMemoryInfo();
  const usage=process.memoryUsage();
  const mb=kb=>typeof kb==='number'?+(kb/1024).toFixed(1):null;
  return {residentMb:mb(info.residentSet??info.workingSetSize),privateMb:mb(info.private??info.privateBytes),sharedMb:mb(info.shared),rssMb:+(usage.rss/1048576).toFixed(1),heapUsedMb:+(usage.heapUsed/1048576).toFixed(1),jsHeapMb:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null};
});

/*
 * 干扰度量的是**外部负载**，不是整机占用。
 *
 * 为什么不能直接用整机 CPU：测量窗口里跑得最欢的就是我自己要测的渲染进程，
 * 把它的占用算进去等于把被测对象当成干扰。所以这里先一次解析出本实例自己的
 * 进程树（按 --user-data-dir 里的 run 目录名认），以及所有 node 进程（本脚本与
 * Playwright 驱动），取样时把它们排除，剩下的才是别人的负载。
 */
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
const busyPercent=async(work)=>{
  const before=await foreignCpuSeconds();
  const started=Date.now();
  const result=await work();
  const seconds=Math.max(.001,(Date.now()-started)/1000);
  const after=await foreignCpuSeconds();
  const cores=(after-before)/seconds;
  return {result,foreignCores:+cores.toFixed(2),busyPercent:+(100*cores/cores_available).toFixed(1)};
};
async function cpuUsage(ms){
  await page.evaluate(()=>process.getCPUUsage());
  await page.waitForTimeout(ms);
  return page.evaluate(()=>process.getCPUUsage());
}
const stubWebgl=()=>page.evaluate(()=>{
  if(!window.__mcsRealGetContext)window.__mcsRealGetContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,...rest){return type==='webgl'?'':window.__mcsRealGetContext.call(this,type,...rest);};
});
const restoreWebgl=()=>page.evaluate(()=>{if(window.__mcsRealGetContext)HTMLCanvasElement.prototype.getContext=window.__mcsRealGetContext;});

/** 全新实例可能停在首次运行的设置面板上，它会挡住画布上的点击。 */
async function dismissModals(){
  await page.evaluate(()=>{
    app.setting?.close?.();
    for(const button of document.querySelectorAll('.modal-close-button, .modal-container .mod-cancel'))button.click();
  }).catch(()=>{});
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(150);
}
async function detachAll(){
  await page.evaluate(async()=>{for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();});
  await page.waitForTimeout(400);
}
async function openScale(scale,renderer){
  await dismissModals();
  await page.evaluate(async({content,view})=>{
    for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();
    await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);
  },scale.bundle);
  const started=performance.now();
  // 只等节点挂上 DOM：视图可能带着一张把节点放在视口外的相机，适配之前
  // `.mcs-card` 全是 display:none，等「可见」会一直等到超时。
  await page.waitForSelector('.mcs-card',{state:'attached'});
  const firstPaintMs=performance.now()-started;
  // 专用实例上应当只有一个 MCS 视图；多出来就说明有人在同一个渲染进程里开关视图。
  assert.equal(await page.locator('.mcs-app').count(),1,'同一渲染进程里出现了不止一个 MCS 视图，测量不可用');
  const path=await page.locator('.mcs-actions-canvas').getAttribute('data-renderer');
  assert.equal(path,renderer,`期望走 ${renderer} 路径，实际是 ${path}`);
  return Math.round(firstPaintMs);
}

/** 与既有 renderer-check 同一套动作：一次冷拖动收敛，再持续拖动并交替缩放。 */
async function measure(scale,renderer){
  const run={scale:scale.id,label:scale.label,renderer,nodes:scale.nodes,actions:scale.actions};
  const before=await memory();
  run.firstPaintMs=await openScale(scale,renderer);
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'适配',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  run.renderedEdges=await page.locator('.mcs-actions-canvas').evaluate(el=>Number(el.dataset.edgeCount));
  run.drawnNodes=await page.locator('.mcs-card').count();
  run.paletteMatchesTokens=await page.locator('.mcs-actions-canvas').evaluate(el=>{
    const css=getComputedStyle(document.querySelector('.mcs-graph'));
    return [css.getPropertyValue('--mcs-neutral').trim(),css.getPropertyValue('--mcs-failure').trim()].join('|')===el.dataset.palette.split('|').slice(2).join('|');
  });

  const targetId=scale.bundle.view.added[Math.min(5,scale.nodes-1)];
  const coldStart=performance.now();
  const warm=page.locator(`[data-node-id="${targetId}"]`);
  await warm.focus();
  const warmBox=await warm.boundingBox();
  assert.ok(warmBox,'冷收敛的拖动目标不可见');
  await page.mouse.move(warmBox.x+warmBox.width/2,warmBox.y+warmBox.height/2);
  await page.mouse.down();
  await page.mouse.move(warmBox.x+warmBox.width/2+30,warmBox.y+warmBox.height/2+20,{steps:5});
  await page.mouse.up();
  await page.mouse.move(4,4);
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  run.coldConvergenceMs=Math.round(performance.now()-coldStart);

  await page.getByRole('button',{name:'适配',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  const target=page.locator(`[data-node-id="${targetId}"]`);
  await target.focus();
  const box=await target.boundingBox();
  assert.ok(box,'压力动作的拖动目标不可见');
  const cx=box.x+box.width/2,cy=box.y+box.height/2;
  await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+6,cy+4);
  await page.waitForTimeout(250);
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
  const samplingStart=performance.now();
  for(let i=0;i<SAMPLES;i++){
    const angle=i*.11;
    await page.mouse.move(cx+Math.cos(angle)*75,cy+Math.sin(angle)*48);
    if(i%12===0)await page.mouse.wheel(0,i%24===0?-90:90);
    await page.waitForTimeout(16);
  }
  run.samplingMs=Math.round(performance.now()-samplingStart);
  const {times,drawTimes}=await page.evaluate(()=>{window.__mcsMeasuring=false;return {times:window.__mcsFrames,drawTimes:window.__mcsDrawFrames};});
  await page.mouse.up();await page.mouse.move(4,4);
  await page.waitForFunction(()=>document.querySelector('.mcs-graph')?.dataset.motion==='idle');
  await page.waitForFunction(()=>document.querySelector('.mcs-save-state')?.textContent==='已保存');

  run.frames=times.length;run.graphUpdates=drawTimes.length;
  if(times.length>=20){
    const percentile=list=>[...list].sort((a,b)=>a-b)[Math.max(0,Math.ceil(list.length*.95)-1)];
    run.hostP95Ms=+percentile(times).toFixed(2);
    run.graphP95Ms=drawTimes.length?+percentile(drawTimes).toFixed(2):null;
    run.meanFrameMs=+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2);
    run.maxFrameMs=+Math.max(...times).toFixed(2);
    run.meanFps=+(1000/(times.reduce((a,b)=>a+b,0)/times.length)).toFixed(1);
    /*
     * 重绘间隔只有在「每帧都重绘」时才等于帧延迟。
     *
     * 图安静下来之后，绘制层只在有输入事件或模拟步进时才重画：小图上一次拖动
     * 很快收敛，于是重绘次数跟着注入的指针事件走（约 35 次/秒），重绘间隔的
     * 第 95 百分位就变成了**输入节奏**（约 36ms），而不是任何一帧的耗时——
     * 同一时刻宿主帧间隔的 p95 只有 6.2ms。把两者取最大值当作帧延迟，会把
     * 「画得少」误判成「画得慢」，所以只在确实逐帧重绘时才合并两者。
     */
    run.repaintEveryFrame=run.frames>0&&run.graphUpdates>=run.frames*.9;
    run.p95Basis=run.repaintEveryFrame?'host+graph（逐帧重绘）':'host（绘制层按需重绘，重绘间隔不等于帧延迟）';
    run.p95FrameMs=run.repaintEveryFrame?Math.max(run.hostP95Ms,run.graphP95Ms??0):run.hostP95Ms;
    run.meetsFrameTarget=run.hostP95Ms<=FRAME_TARGET_MS;
  }else{
    run.insufficientSamples=true;
    notes.push(`${scale.id}/${renderer}：只采到 ${times.length} 帧，样本不足以给出 p95`);
  }

  await page.waitForTimeout(300);
  const paints=await page.locator('.mcs-graph').evaluate(el=>el.mcsPaintCount);
  await page.waitForTimeout(400);
  run.paintsAfterConvergence=await page.locator('.mcs-graph').evaluate(el=>el.mcsPaintCount)-paints;
  run.idleCpuPercent=+(await cpuUsage(IDLE_CPU_MS)).percentCPUUsage.toFixed(2);
  run.afterOpen=await memory();
  run.memoryDeltaMb=run.afterOpen.residentMb!==null&&before.residentMb!==null?+(run.afterOpen.residentMb-before.residentMb).toFixed(1):null;
  await detachAll();
  run.afterClose=await memory();
  run.memoryAfterCloseDeltaMb=run.afterClose.residentMb!==null&&before.residentMb!==null?+(run.afterClose.residentMb-before.residentMb).toFixed(1):null;
  return run;
}

async function writeReport(status){
  const report={
    schema:'mcs-plugin-perf/2',artifactSha256:artifact,version,status,evidence:'FINITE',
    scope:'FINITE：一台 Windows 机器、专用隔离实例的实际 Obsidian 渲染进程、给定输入与视窗 1440×960；动作是受控的真实指针拖动与滚轮缩放。不构成其他机器、显卡或平台的性能保证。',
    method:{samples:SAMPLES,repeat:REPEAT,maxBusyPercent:MAX_BUSY,idleCpuMs:IDLE_CPU_MS,frameTargetMs:FRAME_TARGET_MS,
      pointer:'真实鼠标按下→移动→抬起，采样宿主 requestAnimationFrame 间隔与 SVG 实际重绘间隔。帧延迟取宿主间隔的第 95 百分位；只有当绘制层确实逐帧重绘（重绘次数 ≥ 帧数 × 0.9）时才与重绘间隔取较差者——小图收敛后绘制层按需重绘，重绘间隔量到的是输入节奏而不是帧耗时。',
      contention:'每次测量前后各取一次**外部**进程（排除本实例自己的进程树与全部 node 进程）的 CPU 累计时间，算出这段窗口里别人占了多少核；占机器总算力高于 maxBusyPercent 的记作 contended，不参与判定。多次重复取最好的一次（干扰只会让帧变慢，不会变快）。'},
    session:{path:sessionPath,vault:session.vault,port:session.port},
    host:hostInfo,scales:SCALES.map(({id,label,kind,nodes,actions})=>({id,label,kind,nodes,actions})),
    bars:{webglStress200P95Ms:FRAME_TARGET_MS,realCeilingP95Ms:FRAME_TARGET_MS},
    missesFrameTarget,runs,notes,errors,checkedAt:new Date().toISOString(),
  };
  await writeFile('runtime/perf-report.json',JSON.stringify(report,null,2));
  await mkdir('docs/validation',{recursive:true});
  await writeFile('docs/validation/perf.json',JSON.stringify(report,null,2));
  return report;
}

try{
  await page.waitForFunction(()=>typeof app!=='undefined'&&app.workspace);
  // 全新实例会先问是否信任本地插件；这里与桌面回归用同一句话确认。
  const trust=page.getByRole('button',{name:'Trust author and enable plugins'});
  if(await trust.count()){await trust.click();await page.waitForFunction(()=>app.plugins?.plugins?.['mcs-cognitive-space']);}
  await page.waitForFunction(()=>app.plugins?.plugins?.['mcs-cognitive-space']);
  await page.evaluate(()=>new Promise(done=>app.workspace.onLayoutReady(done)));
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault,'not the perf vault');
  const loaded=await page.evaluate(()=>app.plugins.plugins['mcs-cognitive-space'].manifest.version);
  assert.equal(loaded,version,`vault holds ${loaded}, manifest says ${version}`);
  await page.setViewportSize({width:1440,height:960});
  hostInfo=await page.evaluate(()=>{
    const os=require('node:os');
    return {electron:process.versions.electron,node:process.versions.node,platform:process.platform,cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,ramBytes:os.totalmem(),devicePixelRatio};
  });

  await detachAll();
  const baselineIdle=await cpuUsage(IDLE_CPU_MS);
  hostInfo.baselineIdleCpuPercent=+baselineIdle.percentCPUUsage.toFixed(2);
  // 先认下自己的进程树，再量一段环境负载，作为后续每次测量的对照。
  await resolveOwnPids();
  const ambient=await busyPercent(()=>page.waitForTimeout(5000));
  hostInfo.ambientForeignCores=ambient.foreignCores;
  hostInfo.ambientForeignBusyPercent=ambient.busyPercent;
  const loadStart=performance.now();
  await page.evaluate(async()=>{await app.plugins.unloadPlugin('mcs-cognitive-space');await app.plugins.loadPlugin('mcs-cognitive-space');});
  hostInfo.pluginReloadMs=Math.round(performance.now()-loadStart);

  for(const renderer of ['webgl','canvas']){
    if(onlyRenderers&&!onlyRenderers.includes(renderer))continue;
    if(renderer==='canvas')await stubWebgl();
    try{
      for(const scale of SCALES){
        if(onlyScales&&!onlyScales.includes(scale.id))continue;
        for(let attempt=1;attempt<=REPEAT;attempt++){
          const {result:run,busyPercent:busy}=await busyPercent(()=>measure(scale,renderer));
          run.attempt=attempt;run.machineBusyPercent=busy;
          run.contended=busy!==null&&busy>MAX_BUSY;
          runs.push(run);
          console.log(JSON.stringify({scale:run.scale,renderer:run.renderer,attempt,nodes:run.nodes,actions:run.actions,renderedEdges:run.renderedEdges,p95:run.p95FrameMs,hostP95:run.hostP95Ms,graphP95:run.graphP95Ms,everyFrame:run.repaintEveryFrame,meanFps:run.meanFps,frames:run.frames,coldConvergenceMs:run.coldConvergenceMs,firstPaintMs:run.firstPaintMs,idleCpuPercent:run.idleCpuPercent,paintsAfterConvergence:run.paintsAfterConvergence,busy:run.machineBusyPercent,contended:run.contended,failed:run.failed}));
          await writeReport('running');
        }
      }
    }finally{
      if(renderer==='canvas')await restoreWebgl();
    }
    await detachAll();
  }

  await openScale(SCALES[0],'webgl');
  const themeLatency=[];
  for(const theme of ['theme-dark','theme-light','theme-dark']){
    themeLatency.push(await page.evaluate(async name=>{
      const canvas=document.querySelector('.mcs-actions-canvas'),before=canvas.dataset.palette;
      const start=performance.now();
      document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(name);
      await new Promise(done=>{const check=()=>canvas.dataset.palette!==before?done():requestAnimationFrame(check);requestAnimationFrame(check);});
      return +(performance.now()-start).toFixed(2);
    },theme));
  }
  hostInfo.themeSwitchLatencyMs=themeLatency;
  await page.evaluate(()=>{document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');});
  await detachAll();

  assert.deepEqual(errors.map(error=>error.split('\n')[0]),[]);
  for(const run of runs){
    assert.ok(!run.failed,`${run.scale}/${run.renderer} 第 ${run.attempt} 次失败：${run.failed}`);
    assert.equal(run.paletteMatchesTokens,true,`${run.scale}/${run.renderer} 的画布配色与令牌不一致`);
    assert.ok(run.paintsAfterConvergence<=1,`${run.scale}/${run.renderer} 收敛后仍在持续绘制`);
  }
  // 超出 33ms 的规模如实列出来，不因为「没写进门槛」就当没看见。
  missesFrameTarget=runs.filter(run=>!run.failed&&!run.meetsFrameTarget).map(run=>`${run.scale}/${run.renderer}：宿主帧间隔 p95 ${run.hostP95Ms}ms`);
  // 二维回退的**正确性**：同样的输入必须画出同样多的联合行动边。
  for(const scale of SCALES){
    const webgl=runs.find(run=>run.scale===scale.id&&run.renderer==='webgl'&&!run.failed);
    const canvas=runs.find(run=>run.scale===scale.id&&run.renderer==='canvas'&&!run.failed);
    if(webgl&&canvas)assert.equal(canvas.renderedEdges,webgl.renderedEdges,`${scale.id}：二维回退画的边数与 WebGL 不一致`);
  }
  const clean=(scale,renderer)=>runs.filter(run=>run.scale===scale&&run.renderer===renderer&&!run.failed&&!run.contended&&run.p95FrameMs!==undefined).sort((a,b)=>a.p95FrameMs-b.p95FrameMs)[0]??null;
  for(const [scale,renderer,label] of [['stress-200','webgl','WebGL 200/600'],['real-59','webgl','WebGL 真实上限'],['real-59','canvas','二维回退 真实上限']]){
    if(onlyScales&&!onlyScales.includes(scale))continue;
    if(onlyRenderers&&!onlyRenderers.includes(renderer))continue;
    const best=clean(scale,renderer);
    assert.ok(best,`${label}：每次测量都被机器占用干扰（>${MAX_BUSY}%），这一条无法判定`);
    assert.ok(best.p95FrameMs<=FRAME_TARGET_MS,`${label} p95 ${best.p95FrameMs}ms 超过 ${FRAME_TARGET_MS}ms`);
  }
  completed=true;
  const report=await writeReport('passed');
  console.log(JSON.stringify({status:'passed',artifactSha256:artifact,version,runs:report.runs.length,contended:report.runs.filter(run=>run.contended).length,missesFrameTarget,notes:report.notes,host:report.host},null,2));
}finally{
  if(!completed)await writeReport('partial');
  await browser.close();
}
