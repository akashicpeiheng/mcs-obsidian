import {readFile,writeFile,mkdir,copyFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {version} from './manifest.mjs';

/*
 * 把构建产物安装到本机库的插件目录。
 *
 * 只覆盖**程序文件**（dist/ 的全套：main.js、styles.css、manifest.json、
 * worker.cjs、kernel.py、proofs/、scripts/、LICENSE-*、assets/）；
 * 明确不动 data.json（解释器设置与按节点版本记录的个人掌握状态）、
 * MCS-workspace 里的内容快照、笔记、视图，以及库本身的其他设置。
 *
 * 为什么写成脚本而不是敲一遍复制命令：安装前先整目录备份，
 * 安装后逐文件回读哈希，并把 data.json 与整个 MCS-workspace 的前后摘要比对，
 * 结论可复核、可重放。
 *
 * 用法：
 *   node scripts/install-into-vault.mjs [--vault=D:\Data\ObsidianVault] [--dry-run]
 */

const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??null;
const vault=resolve(argument('vault')??'D:\\Data\\ObsidianVault');
const dryRun=process.argv.includes('--dry-run');
const pluginDir=join(vault,'.obsidian','plugins','mcs-cognitive-space');
const distDir=resolve('dist');
const backupRoot=resolve('runtime/installed-backup');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=path=>stat(path).then(()=>true,()=>false);
/*
 * 只安装分发包里的程序文件：Python 运行 dist/ 里的 witness.py 时会落下 __pycache__，
 * 那属于本机缓存，不属于插件产物（scripts/package.mjs 打包时同样排除它）。
 */
const payloadFilter=path=>!path.split(/[\\/]/).includes('__pycache__')&&!path.endsWith('.pyc');
async function inventory(dir,filter=()=>true){
  const rows=[];
  async function walk(current){
    for(const entry of await readdir(current,{withFileTypes:true})){
      const path=join(current,entry.name);
      if(entry.isDirectory())await walk(path);
      else if(entry.isFile()&&filter(relative(dir,path).replaceAll('\\','/')))rows.push({file:relative(dir,path).replaceAll('\\','/'),sha256:sha(await readFile(path)),size:(await stat(path)).size});
    }
  }
  if(await exists(dir))await walk(dir);
  return rows.sort((a,b)=>a.file.localeCompare(b.file));
}

assert.ok(await exists(pluginDir),`本机插件目录不存在：${pluginDir}`);
assert.ok(await exists(distDir),'缺少 dist/，先运行 npm run build');
const built=JSON.parse(await readFile(join(distDir,'manifest.json'),'utf8'));
assert.equal(built.version,version,'dist 清单版本与仓库清单不一致，先重新构建');
assert.equal(built.author,'沛恒','插件清单作者应为沛恒');

// ---- 安装前：冻结要保留的东西 ------------------------------------------------
const dataPath=join(pluginDir,'data.json');
const hadData=await exists(dataPath);
const dataBefore=hadData?await readFile(dataPath):null;
const learningBefore=hadData?JSON.parse(dataBefore.toString('utf8')):null;
const knownBefore=JSON.stringify((learningBefore?.known??[]).map(entry=>[entry.id,entry.version]).sort());
const workspace=join(vault,'MCS-workspace');
const workspaceBefore=await inventory(workspace);
const vaultSettings={};
for(const name of ['app.json','appearance.json','community-plugins.json'])vaultSettings[name]=await readFile(join(vault,'.obsidian',name)).then(bytes=>sha(bytes),()=>null);
const installedBefore=await inventory(pluginDir);

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupDir=join(backupRoot,stamp);
if(!dryRun){
  await mkdir(backupDir,{recursive:true});
  for(const entry of installedBefore)await copyFile(join(pluginDir,entry.file),await (async path=>{await mkdir(dirname(path),{recursive:true});return path;})(join(backupDir,entry.file)));
  await writeFile(join(backupDir,'BACKUP.json'),JSON.stringify({schema:'mcs-plugin-install-backup/1',at:new Date().toISOString(),vault,pluginDir,reason:`安装 ${version} 前的程序副本`,files:installedBefore,hadData},null,2)+'\n');
}

// ---- 安装：只写程序文件 ------------------------------------------------------
const program=await inventory(distDir,payloadFilter);
if(!dryRun)for(const entry of program){
  const target=join(pluginDir,entry.file);
  await mkdir(dirname(target),{recursive:true});
  await copyFile(join(distDir,entry.file),target);
}

// ---- 安装后：逐项回读核对 ----------------------------------------------------
const installed=await inventory(pluginDir);
const programNow=new Map(installed.map(entry=>[entry.file,entry.sha256]));
const mismatched=[];
for(const entry of program)if(programNow.get(entry.file)!==entry.sha256)mismatched.push(entry.file);
if(!dryRun){
  assert.deepEqual(mismatched,[],'安装后程序文件哈希与构建产物不一致');
  assert.equal((await readFile(join(pluginDir,'manifest.json'),'utf8')),await readFile(join(distDir,'manifest.json'),'utf8'),'插件清单未更新');
}
const hadDataAfter=await exists(dataPath);
const dataAfter=hadDataAfter?await readFile(dataPath):null;
const learningAfter=dataAfter?JSON.parse(dataAfter.toString('utf8')):null;
const knownAfter=JSON.stringify((learningAfter?.known??[]).map(entry=>[entry.id,entry.version]).sort());
const workspaceAfter=await inventory(workspace);
const settingsAfter={};
for(const name of Object.keys(vaultSettings))settingsAfter[name]=await readFile(join(vault,'.obsidian',name)).then(bytes=>sha(bytes),()=>null);

const problems=[];
if(!dryRun){
  if(hadData!==hadDataAfter)problems.push('data.json 存在性发生变化');
  if(hadData&&sha(dataBefore)!==sha(dataAfter))problems.push('data.json 字节被改动');
  if(knownBefore!==knownAfter)problems.push('个人掌握记录发生变化');
  if(JSON.stringify(workspaceBefore)!==JSON.stringify(workspaceAfter))problems.push('MCS-workspace 的笔记、视图或内容快照发生变化');
  for(const name of Object.keys(vaultSettings))if(vaultSettings[name]!==settingsAfter[name])problems.push(`库设置 ${name} 发生变化`);
  assert.deepEqual(problems,[],problems.join('；'));
}

const report={
  schema:'mcs-plugin-install/1',at:new Date().toISOString(),dryRun,vault,pluginDir,version,
  backup:dryRun?null:backupDir,
  programFiles:program.length,programBytes:program.reduce((total,entry)=>total+entry.size,0),
  // 「会换掉哪些」始终对着构建产物算，干跑也有意义。
  replaced:program.filter(entry=>installedBefore.some(previous=>previous.file===entry.file&&previous.sha256!==entry.sha256)).map(entry=>entry.file),
  added:program.filter(entry=>!installedBefore.some(previous=>previous.file===entry.file)).map(entry=>entry.file),
  untouched:installedBefore.filter(previous=>!program.some(entry=>entry.file===previous.file)).map(previous=>previous.file),
  installedAfter:installed.length,
  dataPreserved:hadData?sha(dataBefore)===sha(dataAfter):true,
  hadData,
  dataSha256Before:hadData?sha(dataBefore):null,
  dataSha256After:hadDataAfter?sha(dataAfter):null,
  learningRecords:(learningAfter?.known??[]).length,
  learningUnchanged:knownBefore===knownAfter,
  workspaceFiles:workspaceAfter.length,workspaceUnchanged:JSON.stringify(workspaceBefore)===JSON.stringify(workspaceAfter),
  vaultSettingsUnchanged:Object.keys(vaultSettings).every(name=>vaultSettings[name]===settingsAfter[name]),
  pluginManifest:{id:built.id,name:built.name,version:built.version,author:built.author},
  files:program.map(entry=>({file:entry.file,sha256:entry.sha256,size:entry.size})),
  problems,
};
await mkdir(resolve('runtime'),{recursive:true});
await writeFile(resolve('runtime/install-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,files:undefined},null,2));
