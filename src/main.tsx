import { Component, FileSystemAdapter, FileView, FuzzySuggestModal, MarkdownRenderer, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { App as Workbench } from './App';
import { createView, importBundle, verifyContentIdentity, validateView, stable } from './core.mjs';
import bundled from './generated/content.json';
import { ASSETS, AUTHOR_LABEL, BRAND, type AssetName } from './brand';
import type { CheckReport, Content, Host, Relation, ViewDocument, MathNode } from './types';

const TYPE='mcs-network', BASE='MCS-workspace';
interface Settings {python:string;node:string;leanBin:string;leanProject:string;known:{id:string;version:string}[]}

class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(plugin:McsPlugin,readonly files:TFile[],public choose:(f:TFile|null)=>void){super(plugin.app);}
  getItems(){return this.files;}
  getItemText(file:TFile){return file.path;}
  onChooseItem(file:TFile){this.choose(file);this.choose=()=>{};}
  onClose(){queueMicrotask(()=>this.choose(null));}
}
class NodePicker extends FuzzySuggestModal<MathNode> {
  constructor(plugin:McsPlugin,readonly nodes:MathNode[],public choose:(n:MathNode|null)=>void){super(plugin.app);this.setPlaceholder('选择这篇笔记对应的数学对象');}
  getItems(){return this.nodes;}
  getItemText(node:MathNode){return `${node.title} · ${node.chapter}`;}
  onChooseItem(node:MathNode){this.choose(node);this.choose=()=>{};}
  onClose(){queueMicrotask(()=>this.choose(null));}
}

class NetworkView extends FileView {
  root:Root|null=null;
  flush:(()=>Promise<void>)|null=null;
  recoveryPath:string|null=null;
  constructor(leaf:WorkspaceLeaf,readonly plugin:McsPlugin){super(leaf);this.navigation=false;}
  getViewType(){return TYPE;}
  getDisplayText(){return this.file?.basename??'MCS 数学网络';}
  async persistBeforeLeave(){try{if(this.flush)await this.flush();}catch(error){if(!this.recoveryPath)throw error;new Notice((error as Error).message);}}
  async onLoadFile(file:TFile){
    await this.persistBeforeLeave();this.recoveryPath=null;
    this.root?.unmount();this.root=null;
    try{
      const raw=JSON.parse(await this.app.vault.read(file));
      const content=await this.plugin.content(raw.contentVersion);
      const initial=validateView(raw,content) as ViewDocument;
      let recoveryFile:TFile|null=null,recoveryId=crypto.randomUUID(),recoveryRevision=0;
      const host:Host={
        asset:name=>this.plugin.asset(name),
        save:async view=>{
          const validated=validateView(view,content) as ViewDocument;
          let saved!:ViewDocument;
          try{
            const before=await this.app.vault.read(file);
            const prior=JSON.parse(before);
            if(prior.schema==='mcs-view/1'||(prior.schema==='mcs-view/2'&&!Object.hasOwn(prior,'formalSources')))await this.plugin.backupLegacy(file,before);
            await this.app.vault.process(file,current=>{
              const previous=JSON.parse(current);
              if(previous.id!==view.id||previous.revision!==view.revision)throw new Error('视图被其他窗口修改');
              saved={...validated,revision:view.revision+1};return JSON.stringify(saved,null,2)+'\n';
            });return saved;
          }catch(error){
            const recovered={...validated,id:recoveryId,revision:++recoveryRevision,name:`${view.name}（恢复副本）`};
            if(!recoveryFile){await this.plugin.folder(`${BASE}/视图`);recoveryFile=await this.app.vault.create(this.plugin.uniquePath(`${BASE}/视图/${file.basename}-恢复.mcsview`),JSON.stringify(recovered,null,2)+'\n');}
            else await this.app.vault.process(recoveryFile,current=>{
              if(JSON.parse(current).id!==recoveryId)throw new Error('恢复副本也被外部改动，请另存当前版本');
              return JSON.stringify(recovered,null,2)+'\n';
            });
            this.recoveryPath=recoveryFile.path;
            throw new Error(`${(error as Error).message}。当前版本已保存到 ${recoveryFile.path}；可继续另存或打开恢复副本。`);
          }
        },
        saveAs:async(view,c)=>{await this.plugin.newView(c,view);},
        openNote:async(node,binding)=>{
          const reveal=async(note:TFile)=>{const existing=this.app.workspace.getLeavesOfType('markdown').find(l=>(l.view as unknown as {file?:TFile}).file?.path===note.path);if(existing){await this.app.workspace.revealLeaf(existing);return;}await this.app.workspace.getLeaf('split').openFile(note);};
          if(binding){const note=this.app.vault.getAbstractFileByPath(binding);if(!(note instanceof TFile))throw new Error(`绑定的笔记已不存在：${binding}。请重新绑定。`);await reveal(note);return;}
          await this.plugin.folder(`${BASE}/笔记`);
          const stem=node.title.replace(/[\\/:*?"<>|]/g,'_');
          const path=this.plugin.uniquePath(`${BASE}/笔记/${stem}.md`);
          const note=await this.app.vault.create(path,`---\nmcs-node-id: ${JSON.stringify(node.id)}\nmcs-node-version: ${JSON.stringify(node.version)}\n---\n\n${node.body}`);
          await reveal(note);return path;
        },
        chooseNote:()=>new Promise(done=>new FilePicker(this.plugin,this.app.vault.getMarkdownFiles(),file=>done(file?.path??null)).open()),
        confirm:(id,yes)=>this.plugin.confirmKnowledge(content,id,yes),
        check:(relation,signal,view)=>this.plugin.check(relation,signal,view,content),
        checkExamples:signal=>this.plugin.checkExamples(signal),
        importBundle:async raw=>{const result=importBundle(raw);await this.plugin.newView(result.content,result.view);},
        openLibrary:()=>this.plugin.library(),
        setFlush:fn=>{this.flush=fn;return()=>{this.flush=null;};},
        watchKnown:callback=>{const notify=()=>callback(this.plugin.knownFor(content));this.plugin.knownListeners.add(notify);notify();return()=>{this.plugin.knownListeners.delete(notify);};},
        watchBindings:callback=>{const notify=(changedFile:string,oldPath:string,newPath:string,before:number,after:number)=>{if(changedFile===file.path)callback(oldPath,newPath,before,after);};this.plugin.bindingListeners.add(notify);return()=>{this.plugin.bindingListeners.delete(notify);};},
        watchExpand:callback=>{const notify=(path:string,node:string,binding:string)=>{if(path===file.path){callback(node,binding);this.plugin.pendingExpands.delete(path);}};this.plugin.expandListeners.add(notify);const pending=this.plugin.pendingExpands.get(file.path);if(pending)notify(file.path,pending.node,pending.binding);return()=>{this.plugin.expandListeners.delete(notify);};},
        renderMarkdown:(text,el)=>{const component=new Component();component.load();el.replaceChildren();void MarkdownRenderer.render(this.app,text,el,file.path,component).catch(error=>{el.textContent=`排版失败：${error.message}`;});return()=>component.unload();},
      };
      this.root=createRoot(this.contentEl);
      this.root.render(<Workbench content={content} initial={initial} initialKnown={this.plugin.knownFor(content)} host={host}/>);
    }catch(error){this.contentEl.empty();this.contentEl.createEl('p',{text:`MCS 视图无法打开，原文件已保留：${(error as Error).message}`});}
  }
  async onUnloadFile(){await this.persistBeforeLeave();this.root?.unmount();this.root=null;}
  async onClose(){await this.persistBeforeLeave();this.root?.unmount();this.root=null;}
}

export default class McsPlugin extends Plugin {
  settings:Settings={python:'python',node:'node',leanBin:'',leanProject:'',known:[]};
  checks=new Set<AbortController>();
  knownListeners=new Set<()=>void>();
  stateSave:Promise<void>=Promise.resolve();
  bindingListeners=new Set<(file:string,oldPath:string,newPath:string,before:number,after:number)=>void>();
  expandListeners=new Set<(file:string,node:string,binding:string)=>void>();
  pendingExpands=new Map<string,{node:string;binding:string}>();
  knownFor(content:Content){return content.nodes.filter(n=>this.settings.known.some(k=>k.id===n.id&&k.version===n.version)).map(n=>n.id);}
  confirmKnowledge(content:Content,id:string,yes:boolean){
    this.stateSave=this.stateSave.catch(()=>{}).then(async()=>{
      const node=content.nodes.find(n=>n.id===id);if(!node)throw new Error('未知节点');
      const previous=this.settings.known;
      this.settings.known=previous.filter(n=>n.id!==id||n.version!==node.version);
      if(yes)this.settings.known.push({id,version:node.version});
      try{await this.saveData(this.settings);}catch(error){this.settings.known=previous;throw error;}
      for(const callback of this.knownListeners)callback();
    });return this.stateSave;
  }
  async onload(){
    const stored=await this.loadData();
    if(stored){for(const key of ['python','node','leanBin','leanProject'] as const)if(typeof stored[key]==='string')this.settings[key]=stored[key];if(Array.isArray(stored.known)&&stored.known.every((n:unknown)=>n&&typeof n==='object'&&'id'in n&&'version'in n&&typeof n.id==='string'&&typeof n.version==='string'))this.settings.known=stored.known;}
    this.registerView(TYPE,leaf=>new NetworkView(leaf,this));
    this.registerExtensions(['mcsview'],TYPE);
    const newNetwork=()=>void this.newView(bundled as Content).catch(e=>new Notice(e.message));
    this.addRibbonIcon('network','新建 MCS 数学网络',newNetwork);
    this.addCommand({id:'new-network',name:'新建数学网络',callback:newNetwork});
    this.addCommand({id:'view-library',name:'打开视图库',callback:()=>this.library()});
    this.addCommand({id:'expand-in-mcs',name:'在 MCS 中展开当前笔记',checkCallback:checking=>{const file=this.app.workspace.getActiveFile();if(!file||file.extension!=='md')return false;if(!checking)void this.expandNote(file).catch(e=>new Notice(e.message));return true;}});
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{if(file instanceof TFile&&file.extension==='md')menu.addItem(item=>item.setTitle('在 MCS 中展开').setIcon('network').onClick(()=>void this.expandNote(file).catch(e=>new Notice(e.message))));}));
    this.addSettingTab(new McsSettings(this));
    this.registerEvent(this.app.vault.on('rename',(file,old)=>{if(file instanceof TFile&&file.extension==='md')void this.renameBindings(old,file.path).catch(e=>new Notice(`笔记绑定更新失败：${e.message}`));}));
  }
  onunload(){for(const c of this.checks)c.abort();}
  /** 随插件打包的图片（字标、徽记）解析为 Obsidian 资源路径；取不到插件目录时返回空串，界面回退。 */
  asset(name:AssetName){const dir=this.manifest.dir;if(!dir)return '';return this.app.vault.adapter.getResourcePath(normalizePath(`${dir}/assets/${ASSETS[name]}`));}
  async folder(path:string){const parts=normalizePath(path).split('/');for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join('/');if(!this.app.vault.getAbstractFileByPath(p))await this.app.vault.createFolder(p);}}
  async backupLegacy(file:TFile,text:string){
    const hash=createHash('sha256').update(text).digest('hex');await this.folder(`${BASE}/旧版备份`);
    const path=`${BASE}/旧版备份/${file.basename}-${hash.slice(0,16)}.mcsview`,existing=this.app.vault.getAbstractFileByPath(path);
    if(existing instanceof TFile){if(await this.app.vault.read(existing)!==text)throw new Error('旧版备份内容不匹配，已停止升级');}
    else await this.app.vault.create(path,text);
  }
  async expandNote(note:TFile){
    const leaves=this.app.workspace.getLeavesOfType(TYPE);
    let leaf=this.app.workspace.activeLeaf?.view instanceof NetworkView?this.app.workspace.activeLeaf:leaves.at(-1);
    if(!leaf){leaf=await this.newView(bundled as Content);}
    const network=leaf.view as NetworkView;if(network.flush)await network.flush();
    const file=network.file;if(!file)throw new Error('数学视图尚未就绪');
    const raw=JSON.parse(await this.app.vault.read(file)),content=await this.content(raw.contentVersion),view=validateView(raw,content) as ViewDocument;
    const bound=Object.entries(view.bindings).find(([,path])=>path===note.path)?.[0];
    const declared=this.app.metadataCache.getFileCache(note)?.frontmatter?.['mcs-node-id'];
    let id=bound??(typeof declared==='string'&&content.nodes.some(n=>n.id===declared)?declared:undefined);
    if(!id){const node=await new Promise<MathNode|null>(done=>new NodePicker(this,content.nodes,done).open());if(!node)return;id=node.id;}
    this.pendingExpands.set(file.path,{node:id,binding:note.path});
    await this.app.workspace.revealLeaf(leaf);
    for(const notify of this.expandListeners)notify(file.path,id,note.path);
  }
  uniquePath(path:string){let result=path,i=1;const dot=path.lastIndexOf('.');while(this.app.vault.getAbstractFileByPath(result)){result=`${path.slice(0,dot)}-${i++}${path.slice(dot)}`;}return result;}
  async content(version:string):Promise<Content>{
    if(typeof version!=='string'||!/^[a-f0-9]{64}$/.test(version))throw new Error('内容版本必须是 SHA-256 标识');
    const file=this.app.vault.getAbstractFileByPath(`${BASE}/内容/${version}.json`);
    if(!(file instanceof TFile))throw new Error('找不到视图绑定的内容快照，请重新导入便携包。');
    const content=verifyContentIdentity(JSON.parse(await this.app.vault.read(file))) as Content;
    if(content.version!==version)throw new Error('内容快照身份不匹配');return content;
  }
  async newView(content:Content,view:ViewDocument=createView(content) as ViewDocument){
    verifyContentIdentity(content);view=validateView(view,content) as ViewDocument;
    if(!/^[a-f0-9]{64}$/.test(content.version))throw new Error('内容版本无效');
    await this.folder(`${BASE}/内容`);await this.folder(`${BASE}/视图`);
    const path=`${BASE}/内容/${content.version}.json`,old=this.app.vault.getAbstractFileByPath(path);
    if(old instanceof TFile){if(stable(JSON.parse(await this.app.vault.read(old)))!==stable(content))throw new Error('同一内容版本出现不同内容，导入已停止；已有内容保持不变。');}
    else await this.app.vault.create(path,JSON.stringify(content,null,2)+'\n');
    const name=view.name.replace(/[\\/:*?"<>|]/g,'_')||'数学网络';
    const file=await this.app.vault.create(this.uniquePath(`${BASE}/视图/${name}.mcsview`),JSON.stringify(view,null,2)+'\n');
    const leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file);return leaf;
  }
  library(){const files=this.app.vault.getFiles().filter(f=>f.extension==='mcsview'&&!f.path.startsWith(`${BASE}/旧版备份/`));if(!files.length){new Notice('尚无保存的视图，请先新建数学网络。');return;}new FilePicker(this,files,f=>{if(f)void this.app.workspace.getLeaf('tab').openFile(f);}).open();}
  async renameBindings(old:string,path:string){
    for(const file of this.app.vault.getFiles().filter(f=>f.extension==='mcsview')){
      if(file.path.startsWith(`${BASE}/旧版备份/`))continue;
      const text=await this.app.vault.read(file),raw=JSON.parse(text);
      if(raw.schema==='mcs-view/1'&&Object.values(raw.bindings??{}).includes(old))await this.backupLegacy(file,text);
      let changed=false,before=0;
      await this.app.vault.process(file,text=>{
        const view=JSON.parse(text);before=view.revision;
        for(const [id,binding]of Object.entries(view.bindings??{}))if(binding===old){view.bindings[id]=path;changed=true;}
        return changed?JSON.stringify({...view,revision:view.revision+1},null,2)+'\n':text;
      });
      if(changed)for(const notify of this.bindingListeners)notify(file.path,old,path,before,before+1);
    }
  }
  async check(relation:Relation,signal:AbortSignal,view:ViewDocument,content:Content):Promise<CheckReport>{
    return this.runChecker('worker.cjs',signal,15000,dir=>[JSON.stringify({relation,context:{formalSources:view.formalSources,relations:view.relations,versions:Object.fromEntries(content.nodes.map(n=>[n.id,n.version]))},kernel:resolve(dir,'kernel.py'),python:this.settings.python})]);
  }
  async checkExamples(signal:AbortSignal):Promise<CheckReport>{
    if(!this.settings.leanBin||!this.settings.leanProject)throw new Error('请先在插件设置填写 Lean 4.34.1 的 bin 目录和固定 mathlib 项目目录');
    return this.runChecker('scripts/check-lean.mjs',signal,240000,()=>[],{MCS_LEAN_BIN:this.settings.leanBin,MCS_LEAN_PROJECT:this.settings.leanProject});
  }
  private async runChecker(script:string,signal:AbortSignal,timeout:number,args:(dir:string)=>string[],env?:Record<string,string>):Promise<CheckReport>{
    const adapter=this.app.vault.adapter;
    if(!(adapter instanceof FileSystemAdapter))throw new Error('形式检查需要桌面文件系统');
    const dir=resolve(adapter.getBasePath(),this.manifest.dir!);
    const controller=new AbortController();this.checks.add(controller);
    const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
    try{return await new Promise((resolvePromise,reject)=>{
      let settled=false,timedOut=false;
      let child:ReturnType<typeof execFile>|undefined;
      const stop=()=>{
        if(settled||!child?.pid)return;
        if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
        else child.kill();
      };
      const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
      child=execFile(this.settings.node,[resolve(dir,script),...args(dir)],
        {windowsHide:true,maxBuffer:4e6,env:env?{...process.env,...env}:process.env},(error,stdout)=>{
          settled=true;clearTimeout(timer);controller.signal.removeEventListener('abort',stop);
          if(controller.signal.aborted)return reject(new Error('已取消检查'));
          if(timedOut)return reject(new Error('检查超时'));
          if(error&&(error as NodeJS.ErrnoException).code==='ENOENT')return reject(new Error('未找到 Node.js，请在插件设置填写 node 可执行文件路径。'));
          try{resolvePromise(JSON.parse(stdout));}catch{reject(new Error(error?.killed?'检查超时':'检查器无法启动或返回了损坏报告'));}
        });
      void child;
      controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();
    });}finally{signal.removeEventListener('abort',abort);this.checks.delete(controller);}
  }
}

class McsSettings extends PluginSettingTab {
  constructor(readonly plugin:McsPlugin){super(plugin.app,plugin);}
  display(){
    const {containerEl}=this;containerEl.empty();containerEl.addClass('mcs-settings');
    // 完整品牌署名：面板收起后联系信息仍在这里可查；令牌作用域与工作区共用 theme.css。
    const brand=containerEl.createDiv({cls:'mcs-settings-brand'});
    const emblem=this.plugin.asset('emblem');
    if(emblem)brand.createEl('img',{cls:'mcs-emblem',attr:{src:emblem,alt:'','aria-hidden':'true'}});
    const copy=brand.createDiv();
    copy.createEl('h2',{text:BRAND.name});
    const contact=copy.createEl('p',{text:`${AUTHOR_LABEL}：${BRAND.author} · 联系邮箱：`});
    contact.createEl('a',{text:BRAND.email,attr:{href:BRAND.mailto,title:`联系 ${BRAND.author}`}});
    copy.createEl('p',{cls:'mcs-settings-meta',text:`版本 ${this.plugin.manifest.version} · 主题跟随 Obsidian 明暗模式 · 字标与徽记随插件本地打包，离线可用。`});
    const entry=(key:'node'|'python'|'leanBin'|'leanProject',name:string,description:string,fallback='')=>new Setting(this.containerEl).setName(name).setDesc(description).addText(t=>t.setValue(this.plugin.settings[key]).onChange(async value=>{this.plugin.settings[key]=value.trim()||fallback;await this.plugin.saveData(this.plugin.settings);}));
    entry('node','Node.js 可执行文件','形式检查在独立进程运行，需要 Node.js 22 或更新版本；可以填写完整路径。','node');
    entry('python','Python 解释器','仅 ND 证书重放需要；组网、笔记和学习沙盘可独立使用。','python');
    entry('leanBin','Lean 工具链 bin 目录','可选：Lean 4.34.1 的原生 lean 与 leanchecker 可执行文件所在目录。');
    entry('leanProject','固定 mathlib 项目目录','可选：已准备好 .lake/packages 及编译缓存的项目，mathlib 固定到 d13f23b723b8a846827a245b89c10fc7d3f11612。用于三个教材示范目标的本机重放。');
    containerEl.createEl('p',{text:'内容快照、视图与笔记保存在库内 MCS-workspace。卸载插件后这些文件仍保留。'});
  }
}
