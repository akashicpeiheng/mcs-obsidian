// These are original MCS teaching notes; textbook alignment is separately recorded.
export const note = (title, intuition, motivation, definition, proof, boundary, method, question) => `# ${title}

#线性代数 #MCS示范链

## 总览与前置

${intuition}

必备：域上加减乘除、函数与集合。辅助：矩阵表示。拓展：仿射空间与抽象线性映射。

## 为什么引入，怎样长出来

${motivation}

## 直觉与精确表达

${definition}

## 概括证明与细化

${proof}

## 条件、反例与误解

${boundary}

## 联动、思想与方法

${method}

## 回看

${question}

## 参考与验证边界

蒋剑剑、林秀清《简明高等代数》，网络共享版，2026-04-26。相关定位见节点的来源字段。本文为独立编写的教学说明，未声称逐句复现教材。纸笔论证标 PROOF；机器报告须另行运行并核对精确目标。
`;

export const pilotNodes = [
  { id:'pilot:linear-map', title:'线性映射：保留叠加结构', chapter:'示范链', kind:'Definition', summary:'把加法与数乘保留下来的函数。',
    source:'教材第4章列向量空间、第7章向量空间的态射；MCS 独立重述，逐句对应待审阅。',
    body:note('线性映射：保留叠加结构','DEF：从“对每个向量做什么”转向“这个操作保留什么”。','内部动机：方程组左端对未知量的线性组合仍作同样组合。应用动机：输入叠加后输出也叠加。生长链：线性表达式 → 矩阵乘向量 → 保持运算的映射。',
      'DEF：设 $V,W$ 是同一域 $F$ 上的向量空间。函数 $T:V\\to W$ 是线性的，指对任意 $u,v\\in V$、$a\\in F$，$T(u+v)=T(u)+T(v)$ 且 $T(au)=aT(u)$。共同标量域使两个数乘可比较。',
      'PROOF：保持加法先给出 $T(0)=T(0)+T(0)$，消去即 $T(0)=0$。再由 $T(v)+T(-v)=0$ 得 $T(-v)=-T(v)$，因而 $T(u-v)=T(u)-T(v)$。这些是下面解集平移的工具。',
      '删除齐次性，仅保持加法并不总能保证给定标量域上的线性，例如复共轭保持加法却不是复线性的。删除加法保持性，取 $f(x,y)=x^3/(x^2+y^2)$（原点处取0），它对实数缩放齐次，但 $f(1,1)=1/2$ 而 $f(1,0)+f(0,1)=1$。仿射映射 $x\\mapsto x+1$ 连零点都不保持。',
      '降维：把抽象等式读成矩阵对向量的运算。升维：线性映射是向量空间的态射。思想：关注操作保持的结构。方法：本节用零点与加法消去，下一节用于解的差。','矩阵表示依赖基，线性映射本身是否依赖基？') },
  { id:'pilot:kernel', title:'核：哪些输入被送到零', chapter:'示范链', kind:'Definition', summary:'齐次方程的解形成核，是非齐次解之间的自由方向。', source:'教材 §4.6 与第7章；独立重述。',
    body:note('核：哪些输入被送到零','DEF：核把“看不见的输入方向”收成一个空间。','内部动机：两组答案的差为什么不改变输出？应用动机：测量设备可能把不同输入识别成同一输出。生长链：零输出解 → 对加法数乘封闭 → 核子空间。',
      'DEF：对线性映射 $T:V\\to W$，$\\ker T=\\{v\\in V:T(v)=0\\}$。',
      'PROOF：先说明封闭性：$T(0)=0$；若 $T(u)=T(v)=0$，则 $T(u+v)=0$；且 $T(au)=aT(u)=0$。因此核含零并对向量运算封闭，是子空间。',
      '删除线性，零点集合未必是子空间：$f(x)=x^2-1$ 的零点是 $\\{-1,1\\}$，连零都不含。不要把零核误读成零映射：零核表示单射，零映射的核是整个定义域。',
      '降维：$Ax=0$ 的所有解。升维：核是态射失去的信息。思想：先研究不改变结果的方向。方法：用运算保持性检验封闭性。','为什么 $T(u)=T(v)$ 等价于 $u-v\\in\\ker T$？') },
  { id:'pilot:particular', title:'特解与有解条件', chapter:'示范链', kind:'Example', summary:'先找到一个确实满足方程的输入，再研究全部答案。', source:'教材 §4.6；MCS 原创例子。',
    body:note('特解与有解条件','DEF：特解是平移解集所需的基点，必须先验证存在。','内部动机：描述全部答案之前，需要一个落脚点。应用动机：求出一组可行配置后，剩下的问题是允许怎样调整。生长链：猜测答案 → 代入核对 → 合法基点。',
      'DEF：给定 $T:V\\to W$ 和 $b\\in W$，满足 $T(x_0)=b$ 的 $x_0$ 称为特解。$b$ 在 $T$ 的像中，当且仅当存在这样的 $x_0$。',
      'PROOF：例 $T(x,y)=x+y$、$b=1$，代入得 $T(1,0)=1$，所以 $(1,0)$ 是特解。这里无需先描述全部解。像的定义直接给出“有解”的存在条件。',
      '删去 $T(x_0)=b$，平移就可能定位错：同一例取 $x_0=(0,0)$，得到 $x+y=0$ 而非 $x+y=1$。有解条件不能省：零映射与非零 $b$ 没有特解。',
      '降维：把数值代入原式。升维：特解选择了纤维中的一个基点，基点可换。思想：先验存在，再谈结构。方法：代入检验在本节和解集平移中使用。','更换特解，最终描述的解集是否改变？') },
  { id:'pilot:affine-fibre', title:'全部解＝特解＋核', chapter:'示范链', kind:'Claim', summary:'线性方程有解时，其解集是核的一个平移。', source:'教材 §4.6，印刷96–98页；证明为 MCS 独立编写。',
    body:note('全部解＝特解＋核','PROOF：一个特解固定位置，核给出全部自由方向。','内部动机：逐个找解太慢，要把所有答案压缩成一条规则。应用动机：一组可行配置加上不影响测量结果的改动仍然可行。生长链：两个解相减 → 差落在核里 → 整个解集是平移。',
      '设 $F$ 为域，$V,W$ 为 $F$ 上向量空间，$T:V\\to W$ 线性，且 $T(x_0)=b$。则对所有 $x\\in V$，\n\n$$T(x)=b\\iff x-x_0\\in\\ker T.$$\n\n因此 $T^{-1}(\\{b\\})=x_0+\\ker T$。',
      '概括：把非齐次条件相减变成齐次条件，再加回特解。\n\n细化：若 $T(x)=b$，则 $T(x-x_0)=T(x)-T(x_0)=b-b=0$。反之，若 $T(x-x_0)=0$，则 $T(x)=T(x_0)+T(x-x_0)=b$。两个方向共同给出等价。',
      '线性不能直接删除：$f(x)=x^2$、$b=1$、$x_0=1$ 时纤维是 $\\{-1,1\\}$，而 $x_0+f^{-1}(0)=\\{1\\}$。特解条件不能删除：$T(x)=x$、$b=1$、$x_0=0$ 给出错误平移。有限维不是本命题条件；添加它才进入维数计数。域可进一步推广到适当模结构，此处不声称已经完成该推广验证。',
      '降维：基础解系加一个特解。升维：有非空纤维时，纤维是核的仿射陪集。思想：差消去共同的非齐次部分。方法：本节的“相减—入核—加回”也解释更换特解不改变解集。','若不知道有解，怎样在表述中保留空纤维这一种情况？') },
  { id:'pilot:row-equivalence', title:'可逆行变换保持解集', chapter:'示范链', kind:'Claim', summary:'同时变换系数与常数项，利用可逆性返回原方程。', source:'教材 §1.2、§2.3；MCS 独立抽象为可逆线性映射的复合。',
    body:note('可逆行变换保持解集','PROOF：变换后仍能返回原问题，答案才不会丢失或增加。','内部动机：复杂方程需要简化，又必须保住答案。应用动机：改写约束的表示不应改变可行集。生长链：加减消元 → 可逆的行操作 → 对等式两侧复合一个可逆映射。',
      '设 $T:V\\to W$ 为线性映射，$E:W\\simeq_F W$ 为线性同构。则\n\n$$E(T(x))=E(b)\\iff T(x)=b.$$\n\n矩阵读法是 $(EA)x=Eb\\iff Ax=b$；必须同时变换右端。',
      '概括：一个方向用函数保持相等，另一个方向用 $E$ 的单射性。三类初等行变换的逆分别是再次交换、乘倒数、加相反的倍数，所以均满足这里的可逆条件。三类逆操作的教材对应与具体矩阵编码另外登记，不能仅由这个抽象命题冒充已经核对。',
      '删除可逆性（甚至单射性）会添解：取 $E=0$，原本 $x=1$ 变成 $0=0$。某行乘零不是合法倍乘。只改系数不改右端也错，例如 $x=1$ 只将系数乘2会变成 $2x=1$。',
      '降维：每步消元都能反做。升维：单射函数在相等式中可消去；本命题的线性同构假设可弱化为单射。思想：简化要带回程。方法：检验逆操作和等式两侧的一致变换。','仅需要保持给定方程解集时，全空间可逆是否过强？') },
  { id:'pilot:rank-nullity', title:'秩与零度分配维数', chapter:'示范链', kind:'Claim', summary:'有限维输入分为可见自由度与送到零的自由度。', source:'教材 §4.6 与第7章；mathlib 的有限维线性映射命题。',
    body:note('秩与零度分配维数','REF：对有限维定义域，像和核的维数相加等于定义域维数。','内部动机：想从消元中数出自由变量，而不枚举所有解。应用动机：计量可辨识方向与不可辨识方向。生长链：主元与自由变量 → 核和像的基 → 维数等式。',
      '设 $T:V\\to W$ 为域 $F$ 上线性映射，$V$ 有限维。则\n\n$$\\dim_F\\operatorname{im}T+\\dim_F\\ker T=\\dim_F V.$$\n\n当 $V=F^n$ 时，$\\dim\\ker T=n-\\operatorname{rank}T$。',
      '概括证明：先取核的一组基并扩成定义域的基，新增基向量的像构成像空间的基。张成性来自展开任意输入；独立性来自某组合像为零便落在核，再用扩充基的独立性。正文这里给证明骨架，完整机器目标引用固定 mathlib 命题。',
      '删除线性，像和零点集合可能不是子空间，维数式失去这里的定义。删除有限维后不能直接使用自然数减法：无限维移位映射说明无限基数相等不能消去有限加项。多一个自由变量只说明有更多解；有限域 $\\mathbb F_q$ 上 $d$ 个自由变量给出 $q^d$ 个解。',
      '降维：未知量数减主元数。升维：第一同构定理与商空间。思想：把被消去的信息也计入总量。方法：取核的基再扩充，在概括证明中使用。','为什么不能仅由矩阵例子的有限枚举声称证明了一般秩—零度定理？') },
];

const a = (id,title,inputs,output) => ({ id:`pilot-action:${id}`,version:'1',mode:'deduction',title,theory:'linear-algebra-teaching/1',openAssumptions:[],
  inputs:inputs.map(node=>({node,accepts:['statement','definition']})),outputs:[{node:output,provides:['statement','definition']}],
  witness:{type:'teaching-contract',status:'ILLUSTRATION',ref:'MCS 示范链：教学次序，不替代数学证据'} });
export const pilotActions = [
  a('rows','从方程组引入合法行变换',['jiang:field-axioms'],'jiang:elementary-row-operations'),
  a('matrix','把系数表组织成矩阵',['jiang:field-axioms'],'jiang:matrix-operations'),
  a('map','把矩阵看成保留叠加的映射',['jiang:matrix-operations'],'pilot:linear-map'),
  a('rows-proof','解释消元的可逆依据',['jiang:elementary-row-operations','pilot:linear-map'],'pilot:row-equivalence'),
  a('cases','由消元区分解的情况',['pilot:row-equivalence'],'jiang:solution-cases'),
  a('kernel','识别零输出的方向',['pilot:linear-map'],'pilot:kernel'),
  a('particular-compute','用消元找一个特解',['jiang:solution-cases'],'pilot:particular'),
  a('particular-inspect','从具体例子代入核对一个特解',['pilot:linear-map'],'pilot:particular'),
  a('affine','相减、入核，再加回特解',['pilot:kernel','pilot:particular'],'pilot:affine-fibre'),
];
export const pilotTemplates = [
  { id:'calculation',name:'计算优先：从消元走向解空间',goal:'pilot:affine-fibre',actions:pilotActions.filter(a=>!a.id.endsWith('particular-inspect')).map(a=>a.id) },
  { id:'structure',name:'结构优先：从映射走向解空间',goal:'pilot:affine-fibre',actions:pilotActions.filter(a=>!a.id.endsWith('particular-compute')).map(a=>a.id) },
];
