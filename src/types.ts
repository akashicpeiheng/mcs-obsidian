import type {AssetName} from './brand';
export interface MathNode {id:string;version:string;title:string;kind:string;chapter:string;summary:string;body:string;source:string;evidenceStatus:string;sourceReviewed:boolean}
export interface Action {id:string;title:string;mode:string;inputs:{node:string;accepts:string[]}[];outputs:{node:string;provides:string[]}[];witness:{status:string;ref?:string}}
export interface Content {schema:string;version:string;title:string;nodes:MathNode[];actions:Action[];boundary:string[];templates:{id:string;name:string;goal:string;actions:string[]}[];[key:string]:unknown}
export interface FormalSource {version:string;declarations:Record<string,string>;definitions:{name:string;type:string;source:string}[]}
export interface FiniteModel {id:string;carrier:string;elements:string[];consts:Record<string,string>;ops:Record<string,{type:string;table:(string|string[])[]}>}
export type RelationWitness = {mode:'instantiate';terms:string[]} | {mode:'finite';model:FiniteModel} | {mode:'reference';references:{symbol:string;node:string;version:string}[]};
/**
 * `short` 是画在关系线上的简短表达（≤60 字），只用于显示。
 *
 * 它不进入 `relationInput`：证据绑定的仍是关系类型、输入输出、节点版本与形式表达，
 * 改一个标注不会让已通过的检查变成过期证据。
 */
export interface Relation {id:string;kind:string;inputs:string[];output:string;explanation:string;short?:string;nodeVersions:Record<string,string>;sourceReviewed:boolean;formal?:{declarations:Record<string,string>;premises:string[];goal:string;witness?:RelationWitness}}
export interface RouteEvent {id:string;actionId:string;focus:{node:string};sources:Record<string,{kind:string;eventId?:string;entryId?:string;node?:string}>;provides:{node:string;provides:string[]}[];kind:string}
export interface Route {id:string;initial:string[];contentVersion:string;events:RouteEvent[];linearExtensions:string[][];goals:string[];entry:string[];[key:string]:unknown}
export interface ViewDocument {schema:string;id:string;name:string;revision:number;contentVersion:string;added:string[];positions:Record<string,{x:number;y:number}>;locked:string[];layout:{mode:'free'|'learning'|'logic';anchor:string|null};camera:{x:number;y:number;scale:number};relations:Relation[];formalSources:Record<string,FormalSource>;bindings:Record<string,string>;showRelations:boolean;showActions:boolean;/** 在关系线上显示 relation.short；旧视图缺这个字段时按“开”读。 */showEdgeLabels?:boolean;route:Route|null;display:{nodeMode:'adaptive';motion:'auto'|'off'}}
export interface CheckReport {status:string;message:string;input?:string;[key:string]:unknown}
export interface Host {
  /** 随插件打包的本地图片（字标、徽记）解析为 Obsidian 资源路径；离线可用。 */
  asset:(name:AssetName)=>string;
  save:(view:ViewDocument)=>Promise<ViewDocument>;
  saveAs:(view:ViewDocument,content:Content)=>Promise<void>;
  openNote:(node:MathNode,binding?:string)=>Promise<string|void>;
  chooseNote:()=>Promise<string|null>;
  confirm:(node:string,yes:boolean)=>Promise<void>;
  check:(relation:Relation,signal:AbortSignal,view:ViewDocument)=>Promise<CheckReport>;
  checkExamples:(signal:AbortSignal)=>Promise<CheckReport>;
  importBundle:(value:unknown)=>Promise<void>;
  renderMarkdown:(text:string,el:HTMLElement)=>()=>void;
  openLibrary:()=>void;
  setFlush:(flush:()=>Promise<void>)=>(()=>void);
  watchKnown:(callback:(known:string[])=>void)=>(()=>void);
  watchBindings:(callback:(oldPath:string,newPath:string,before:number,after:number)=>void)=>(()=>void);
  watchExpand:(callback:(node:string,binding:string)=>void)=>(()=>void);
}
