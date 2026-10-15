import { proveRelation, verifyReplay } from './formal.mjs';
import {verifyWitness} from './witness.mjs';
import {relationInput} from './core.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';

const request=JSON.parse(process.argv[2]);
async function main() {
  const {relation,context={},kernel,python='python'}=request;
  if(context.versions&&[...relation.inputs,relation.output].some(id=>context.versions[id]!==relation.nodeVersions[id]))return {status:'unsupported',message:'关系记录的节点版本已过期'};
  const prepared=proveRelation(relation,context);
  if(!['candidate','witness-candidate'].includes(prepared.status)) return prepared;
  const work=await mkdtemp(join(tmpdir(),'mcs-obsidian-check-'));
  try {
    const file=join(work,'certificate.json');
    const special=prepared.status==='witness-candidate';
    await writeFile(file,JSON.stringify(special?prepared.payload:prepared.bundle));
    const checker=special?join(kernel,'..','witness.py'):kernel;
    const report=await new Promise((resolve,reject)=>execFile(python,[checker,file],{windowsHide:true,timeout:8000,maxBuffer:4e6},(error,stdout)=>{
      if(error?.code==='ENOENT') return reject(new Error('未找到 Python；请在插件设置填写解释器路径。'));
      try {resolve(JSON.parse(stdout));} catch {reject(new Error(error?.killed?'检查器超时':'检查器未返回有效报告'));}
    }));
    return special?verifyWitness(prepared,report):verifyReplay(prepared,report);
  } finally {await rm(work,{recursive:true,force:true});}
}
main().then(result=>process.stdout.write(JSON.stringify({input:relationInput(request.relation,request.context),...result}))).catch(error=>{process.stdout.write(JSON.stringify({status:'error',message:error.message,input:relationInput(request.relation,request.context)}));process.exitCode=1;});
