import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export async function artifactIdentity(dir){
  const files=[];for(const file of ['main.js','styles.css','manifest.json','worker.cjs','kernel.py','witness.py'])files.push([file,createHash('sha256').update(await readFile(resolve(dir,file))).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
