import {mkdir,writeFile,cp,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/*
 * 性能验收专用的独立 Obsidian 实例。
 *
 * 为什么不复用 `scripts/start-test-vault.mjs`：那一个写 `runtime/obsidian-session.json`，
 * 桌面回归脚本都在用它。性能测量要的是一个**只有我在用**的渲染进程——同库同实例上
 * 只要还有别人在开关视图，第 95 百分位就不再是插件的性能，而是两台脚本互相干扰的结果。
 * 因此这里另起一套 run 目录、库、配置与调试端口，会话写在 `runtime/perf-session.json`，
 * 与桌面回归互不影响，也方便在别的会话正在跑验收时把性能测量隔离出来。
 *
 * 用法：node scripts/start-perf-vault.mjs [--port=9251] [--reuse]
 */

const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??null;
const port=Number(argument('port')??9251);
const reuse=process.argv.includes('--reuse')&&await readFile(resolve('runtime/perf-session.json'),'utf8').then(()=>true,()=>false);
const stored=reuse?JSON.parse(await readFile(resolve('runtime/perf-session.json'),'utf8')):null;
const root=fileURLToPath(new URL('../',import.meta.url));
const run=stored?.run??resolve(root,'runtime','perf-vault');
const vault=resolve(run,'vault'),profile=resolve(run,'profile'),plugin=resolve(vault,'.obsidian/plugins/mcs-cognitive-space');
if(!resolve(run).startsWith(resolve(root,'runtime')+'\\'))throw new Error('性能实例必须位于本项目 runtime 目录');
await mkdir(plugin,{recursive:true});
await mkdir(profile,{recursive:true});
await cp(resolve(root,'dist'),plugin,{recursive:true});
if(!reuse){
  await writeFile(resolve(vault,'.obsidian/community-plugins.json'),JSON.stringify(['mcs-cognitive-space']));
  await writeFile(resolve(vault,'.obsidian/app.json'),JSON.stringify({restrictedMode:false}));
  await writeFile(resolve(profile,'obsidian.json'),JSON.stringify({vaults:{f0e1d2c3b4a59687:{path:vault,ts:Date.now(),open:true}}}));
}
const app=process.env.MCS_OBSIDIAN_EXE??'D:/obsidian/Obsidian.exe';
const child=spawn(app,[`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--enable-logging=file',`--log-file=${resolve(run,'chromium.log')}`],{windowsHide:true,detached:true,stdio:'ignore'});
child.unref();
await writeFile(resolve(root,'runtime/perf-session.json'),JSON.stringify({run,vault,profile,pid:child.pid,port,purpose:'性能验收专用实例；桌面回归请用 runtime/obsidian-session.json'},null,2));
console.log(JSON.stringify({run,vault,pid:child.pid,port}));
