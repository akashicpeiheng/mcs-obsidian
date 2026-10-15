import {mkdir,writeFile,cp,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const reuse=process.argv.includes('--reuse')?JSON.parse(await readFile(resolve(root,'runtime/obsidian-session.json'))):null;
const run=reuse?.run??resolve(root,'runtime',`obsidian-${Date.now()}`),vault=resolve(run,'vault'),profile=resolve(run,'profile'),plugin=resolve(vault,'.obsidian/plugins/mcs-cognitive-space');
if(!resolve(run).startsWith(resolve(root,'runtime')+'\\'))throw new Error('测试实例必须位于本项目 runtime 目录');
await mkdir(plugin,{recursive:true});await mkdir(profile,{recursive:true});
await cp(resolve(root,'dist'),plugin,{recursive:true});
if(!reuse){
  await writeFile(resolve(vault,'.obsidian/community-plugins.json'),JSON.stringify(['mcs-cognitive-space']));
  await writeFile(resolve(vault,'.obsidian/app.json'),JSON.stringify({restrictedMode:false}));
  await writeFile(resolve(profile,'obsidian.json'),JSON.stringify({vaults:{a1b2c3d4e5f60718:{path:vault,ts:Date.now(),open:true}}}));
}
const app=process.env.MCS_OBSIDIAN_EXE??'D:/obsidian/Obsidian.exe';
const child=spawn(app,[`--user-data-dir=${profile}`,'--remote-debugging-port=9248','--remote-debugging-address=127.0.0.1','--enable-logging=file',`--log-file=${resolve(run,'chromium.log')}`],{windowsHide:true,detached:true,stdio:'ignore'});
child.unref();
await writeFile(resolve(root,'runtime/obsidian-session.json'),JSON.stringify({run,vault,profile,pid:child.pid,port:9248},null,2));
console.log(JSON.stringify({run,vault,pid:child.pid,port:9248}));
