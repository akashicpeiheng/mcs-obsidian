import { build } from 'esbuild';
import { mkdir, copyFile, writeFile,readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeContent } from './content.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
await writeContent();
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
const opts={bundle:true,platform:'node',target:'es2022',format:'cjs',logLevel:'warning',absWorkingDir:root,external:['obsidian','electron'],define:{'import.meta.url':'__filename'}};
opts.define['process.env.NODE_ENV']='"production"';
await build({...opts,entryPoints:['src/main.tsx'],outfile:'dist/main.js'});
await build({...opts,entryPoints:['src/worker.mjs'],outfile:'dist/worker.cjs'});
// 主题令牌单独成文件，排在组件样式前面：令牌只在 theme.css 里定义一次。
const styles=[];for(const name of ['theme.css','styles.css','graph.css'])styles.push(await readFile(new URL(`../src/${name}`,import.meta.url),'utf8'));
await writeFile(new URL('../dist/styles.css',import.meta.url),styles.join('\n'));
await copyFile(new URL('../manifest.json',import.meta.url),new URL('../dist/manifest.json',import.meta.url));
// 站点现用的字标与紫色徽记随插件打包（`assets/`），离线可用；源图与导出记录见 design/mcs-logo-v13 与 design/mcs-logo-v6。
await mkdir(new URL('../dist/assets/',import.meta.url),{recursive:true});
for(const asset of ['wordmark.png','emblem.png'])await copyFile(new URL(`../assets/${asset}`,import.meta.url),new URL(`../dist/assets/${asset}`,import.meta.url));
await copyFile(new URL('../upstream/mcs-foundations/validation/certification/kernel.py',import.meta.url),new URL('../dist/kernel.py',import.meta.url));
await copyFile(new URL('../src/witness.py',import.meta.url),new URL('../dist/witness.py',import.meta.url));
await mkdir(new URL('../dist/proofs/',import.meta.url),{recursive:true});
await mkdir(new URL('../dist/scripts/',import.meta.url),{recursive:true});
for(const file of ['Targets.lean','Verified.lean','Audit.lean'])await copyFile(new URL(`../proofs/${file}`,import.meta.url),new URL(`../dist/proofs/${file}`,import.meta.url));
await copyFile(new URL('./check-lean.mjs',import.meta.url),new URL('../dist/scripts/check-lean.mjs',import.meta.url));
await copyFile(new URL('../node_modules/react/LICENSE',import.meta.url),new URL('../dist/LICENSE-react.txt',import.meta.url));
await copyFile(new URL('../node_modules/react-dom/LICENSE',import.meta.url),new URL('../dist/LICENSE-react-dom.txt',import.meta.url));
for(const dependency of ['d3-force','d3-quadtree','d3-timer','d3-dispatch'])await copyFile(new URL(`../node_modules/${dependency}/LICENSE`,import.meta.url),new URL(`../dist/LICENSE-${dependency}.txt`,import.meta.url));
console.log('Built desktop plugin in mcs-obsidian/dist (no MCS server dependency).');
