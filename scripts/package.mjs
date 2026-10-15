import {readFile,writeFile,mkdir,readdir,cp,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {importBundle} from '../src/core.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const dist=resolve(root,'dist'),manifest=JSON.parse(await readFile(resolve(dist,'manifest.json')));
const content=JSON.parse(await readFile(resolve(root,'src/generated/content.json')));
for(const name of ['calculation','structure','book-map']){
  const example=importBundle(JSON.parse(await readFile(resolve(root,`examples/${name}.mcspack.json`))));
  assert.equal(example.content.version,content.version,`${name} example is outdated; run npm run examples.`);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const payloadFilter=path=>!path.split(/[\\/]/).includes('__pycache__')&&!path.endsWith('.pyc');
async function inventory(dir,base=dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(!payloadFilter(path))continue;if(entry.isDirectory())result.push(...await inventory(path,base));else if(entry.isFile()){const bytes=await readFile(path);result.push({file:relative(base,path).replaceAll('\\','/'),sha256:sha(bytes),size:bytes.length});}}return result.sort((a,b)=>a.file.localeCompare(b.file));}
const files=await inventory(dist),hash=sha(JSON.stringify(files));
const payloadFiles=files.map(f=>({...f,file:`${manifest.id}/${f.file}`}));
for(const dir of ['docs','examples'])payloadFiles.push(...(await inventory(resolve(root,dir))).map(f=>({...f,file:`${dir}/${f.file}`})));
const readme=await readFile(resolve(root,'README.md'));payloadFiles.push({file:'README.md',sha256:sha(readme),size:readme.length});
payloadFiles.sort((a,b)=>a.file.localeCompare(b.file));const releaseHash=sha(JSON.stringify(payloadFiles));
const release=resolve(root,'release',`${manifest.version}-${releaseHash.slice(0,12)}`),plugin=resolve(release,manifest.id),archive=resolve(release,`${manifest.id}-${manifest.version}.zip`);
const checksums=resolve(release,'CHECKSUMS.json');
const complete=await stat(checksums).then(()=>true,()=>false);
if(complete){
  const prior=JSON.parse(await readFile(checksums));assert.equal(prior.releaseHash,releaseHash);assert.equal(prior.archiveSha256,sha(await readFile(archive)));
  for(const file of payloadFiles)assert.equal(sha(await readFile(resolve(release,file.file))),file.sha256,`Changed release file: ${file.file}`);
}else{
await mkdir(plugin,{recursive:true});await cp(dist,plugin,{recursive:true,filter:payloadFilter});
await cp(resolve(root,'examples'),resolve(release,'examples'),{recursive:true,filter:payloadFilter});
await cp(resolve(root,'docs'),resolve(release,'docs'),{recursive:true,filter:payloadFilter});
await cp(resolve(root,'README.md'),resolve(release,'README.md'));
if(!await stat(archive).then(()=>true,()=>false))await new Promise((done,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference = "Stop"\nCompress-Archive -LiteralPath $env:MCS_PACK_SOURCE -DestinationPath $env:MCS_PACK_OUTPUT -CompressionLevel Optimal'],{windowsHide:true,timeout:60000,env:{...process.env,MCS_PACK_SOURCE:plugin,MCS_PACK_OUTPUT:archive}},e=>e?reject(e):done()));
await writeFile(checksums,JSON.stringify({schema:'mcs-plugin-release/1',version:manifest.version,pluginHash:hash,releaseHash,archiveSha256:sha(await readFile(archive)),files,payloadFiles,createdAt:new Date().toISOString()},null,2)+'\n');
}
await writeFile(resolve(root,'release/latest.json'),JSON.stringify({release,archive,hash,releaseHash},null,2)+'\n');
console.log(JSON.stringify({release,archive,pluginHash:hash,releaseHash,reused:complete},null,2));
