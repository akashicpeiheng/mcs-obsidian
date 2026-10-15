import {execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,stat,mkdtemp,rm} from 'node:fs/promises';
import {resolve,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(root,'..');
const project=process.env.MCS_LEAN_PROJECT??resolve(repo,'.lean-tools/prepared-project');
const bin=process.env.MCS_LEAN_BIN??resolve(repo,'.lean-tools/lean-4.34.1-windows/bin');
const pinnedMathlib='d13f23b723b8a846827a245b89c10fc7d3f11612';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(program,args,options={})=>new Promise((done,reject)=>execFile(program,args,{cwd:project,windowsHide:true,timeout:60000,maxBuffer:8e6,...options},(e,stdout,stderr)=>e?reject(new Error(`${e.message}\n${stdout}\n${stderr}`)):done(stdout)));

async function check(){
  const lean=resolve(bin,process.platform==='win32'?'lean.exe':'lean');
  const leanchecker=resolve(bin,process.platform==='win32'?'leanchecker.exe':'leanchecker');
  const version=(await run(lean,['--version'])).trim();
  if(!version.startsWith('Lean (version 4.34.1,'))throw new Error('请使用已固定的 Lean 4.34.1 工具链');
  const manifest=await readFile(resolve(project,'lake-manifest.json'));
  const mathlibRevision=JSON.parse(manifest).packages.find(p=>p.name==='mathlib')?.rev;
  if(mathlibRevision!==pinnedMathlib)throw new Error('mathlib 版本与已审阅的固定背景不一致');
  const packages=resolve(project,'.lake/packages'),paths=[resolve(project,'.lake/build/lib/lean')];
  for(const name of await readdir(packages)){
    const path=resolve(packages,name,'.lake/build/lib/lean');
    if(await stat(path).then(s=>s.isDirectory(),()=>false))paths.push(path);
  }
  await mkdir(resolve(root,'runtime'),{recursive:true});
  const work=await mkdtemp(resolve(root,'runtime/lean-check-'));
  const env={...process.env,LEAN_PATH:[work,...paths].join(delimiter)};
  try{
    const sources=[];let audit;
    for(const name of ['Targets','Verified','Audit']){
      const bytes=await readFile(resolve(root,`proofs/${name}.lean`));
      sources.push({file:`proofs/${name}.lean`,sha256:hash(bytes)});
      const output=await run(lean,['-o',resolve(work,`${name}.olean`),`${name}.lean`],{env,cwd:resolve(root,'proofs')});
      if(name==='Audit'){
        const json=output.split('\n').find(l=>l.startsWith('MCS_OBSIDIAN_AUDIT:'))?.slice('MCS_OBSIDIAN_AUDIT:'.length);
        if(!json)throw new Error('没有得到实际编译环境的审计结果');
        audit=JSON.parse(json);
      }
    }
    const replay=await run(leanchecker,['Verified'],{env,cwd:resolve(root,'proofs')});
    return {schema:'mcs-obsidian-lean-report/1',status:'passed',message:'Lean 编译、精确目标与公理审计、独立内核重放通过；教材对应须另行审阅。',version,mathlibRevision,
      manifestSha256:hash(manifest),leanSha256:hash(await readFile(lean)),leancheckerSha256:hash(await readFile(leanchecker)),
      sources,targets:audit.targets,kernelReplay:{status:'passed',module:'Verified',output:replay.trim()},
      textbookAlignment:'pending',scope:'可逆线性映射的消去、特解加核、有限维秩零度。未覆盖三类具体初等矩阵的构造。',checkedAt:new Date().toISOString()};
  }finally{await rm(work,{recursive:true,force:true});}
}

try{
  const report=await check();
  await writeFile(resolve(root,'proofs/report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(root,'runtime/lean-last-run.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}catch(error){
  const report={status:'error',message:error.message,checkedAt:new Date().toISOString()};
  await mkdir(resolve(root,'runtime'),{recursive:true});
  await writeFile(resolve(root,'runtime/lean-last-run.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));process.exitCode=1;
}
