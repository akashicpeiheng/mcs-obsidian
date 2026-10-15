import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createView,planLearning,exportBundle} from '../src/core.mjs';
import {increment,arrange} from '../src/graph.ts';
import {formalExamples} from '../data/relation-examples.mjs';
const content=JSON.parse(await readFile(new URL('../src/generated/content.json',import.meta.url)));
const formal=formalExamples(content);
await mkdir(new URL('../examples/',import.meta.url),{recursive:true});
for(const t of content.templates){
  const route=planLearning(content,t.goal,['jiang:field-axioms'],t.actions).routes[0];
  const ids=[...new Set([...route.initial,...route.events.flatMap(e=>e.provides.map(o=>o.node)),...formal.nodes])];
  const view=arrange(content,{...increment(content,createView(content,t.name),ids),id:`mcs-example:${t.id}`,formalSources:structuredClone(formal.formalSources),relations:structuredClone(formal.relations),route,layout:{mode:'learning',anchor:route.initial[0]}},false);
  await writeFile(new URL(`../examples/${t.id}.mcspack.json`,import.meta.url),JSON.stringify(exportBundle(content,view),null,2)+'\n');
}
const all=increment(content,createView(content,'简明高等代数 · 全书节点地图'),content.nodes.map(n=>n.id));
const map=arrange(content,{...all,id:'mcs-example:book-map',formalSources:formal.formalSources,relations:formal.relations,layout:{mode:'logic',anchor:'jiang:field-axioms'}},false);
await writeFile(new URL('../examples/book-map.mcspack.json',import.meta.url),JSON.stringify(exportBundle(content,map),null,2)+'\n');
console.log('Created calculation, structure and full-book portable examples.');
