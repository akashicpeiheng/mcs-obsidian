// Original bounded exercises accompanying the algebra map; textbook alignment remains pending.
export function formalExamples(content){
  const versions=Object.fromEntries(content.nodes.map(n=>[n.id,n.version]));
  const source='jiang:matrix-operations',map='pilot:linear-map',kernel='pilot:kernel',cancel='pilot:row-equivalence';
  const make=(id,kind,inputs,output,explanation,formal)=>({id:`exercise:${id}`,kind,inputs,output,explanation,nodeVersions:Object.fromEntries([...inputs,output].map(n=>[n,versions[n]])),sourceReviewed:false,formal});
  const model={id:'two-element-zero-map',carrier:'V',elements:['0','1'],consts:{a:'0',b:'1'},ops:{f:{type:'V -> V',table:['0','0']}}};
  return {
    nodes:[source,map,kernel,cancel],
    formalSources:{[source]:{version:versions[source],declarations:{},definitions:[{name:'Id',type:'V -> V',source:'λx:V. x'}]}},
    relations:[
      make('definition','definitionReference',[source],map,'DEF 练习：输出实际使用矩阵运算入口登记的恒等映射 Id。来源检查不证明等式或线性性；节点与教材对应待审阅。',{declarations:{a:'V'},premises:['true'],goal:'Id a = a',witness:{mode:'reference',references:[{symbol:'Id',node:source,version:versions[source]}]}}),
      make('instantiate','instanceOf',[map],kernel,'逻辑模式练习：把全称反身等式的 x 代入 a，保留精确目标。这未编码核的完整定义；节点对应待审阅。',{declarations:{a:'V',L:'V -> V'},premises:['∀x:V. L x = L x'],goal:'L a = L a',witness:{mode:'instantiate',terms:['a']}}),
      make('finite-instance','instanceOf',[map],kernel,'FINITE 练习：两元素零映射把每个输入送到 a=0。这里只检查给定表的核为全载体；标量域与线性性尚未编码。',{declarations:{a:'V',b:'V',f:'V -> V'},premises:['a = a'],goal:'∀x:V. f x = a',witness:{mode:'finite',model}}),
      make('countermodel','counterexampleTo',[kernel],cancel,'FINITE 删条件练习：缺少单射／可逆条件时，相同像不能保证相同输入。表中 a≠b 而 f(a)=f(b)=0；不是教材原句的自动反驳。',{declarations:{a:'V',b:'V',f:'V -> V'},premises:['f a = f b'],goal:'a = b',witness:{mode:'finite',model:structuredClone(model)}}),
    ]
  };
}
