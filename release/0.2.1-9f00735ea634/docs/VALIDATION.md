# 桌面试用验收记录

日期：2026-10-14。版本：0.2.1。以下结果是 FINITE，指当前构建、给定输入和本机环境的检查；不构成一般性能、教学收益或完整数学正确性的证明。

## 已检查的范围

| 入口 | 结果 | 具体范围 |
| --- | --- | --- |
| `npm run check` | 通过 | TypeScript 类型检查 |
| `npm run build` | 通过 | 插件、独立 ND 工作进程、Python 内核、Lean 入口与本地图片资源打包 |
| `npm test` | 21 项通过 | 联合输入与备选生产者、实际前提、空背景、复习事件、路线来源、版本哈希、学习记录隔离、网站迁移、布局锁定、证据失效、推荐、两条案例路线、类型错误及真实 ND 证书重放；第一版迁移、运动层副本、收敛、小数锁定坐标、弹性拖动和外观回差 |
| `node scripts/browser-check.mjs --lean` | 17 个桌面流程通过 | 实际 Obsidian 加载、空闲后的首次保存、多次保存、联合关系编辑、独立 ND 检查、8 事件沙盘、前提缺失传播、个人记录隔离、重开、便携导入、节点版本隔离、笔记创建与改名、既有笔记选择、并发保存与恢复副本、Lean 集成 |
| `node scripts/restart-check.mjs` | 通过 | 关闭并真正重新启动独立 Obsidian 进程（渲染进程 PID 变化）；重启后读到的插件清单版本是 0.2.1；正常文件和恢复副本均可重新打开 |
| `node scripts/dynamic-check.mjs` | 24 个流程通过 | 外观回差、联合聚焦、弹性拖动、精确固定、一次操作撤销、动画期间保存／导出／关闭、后台暂停、减少动态效果、稳定回放、旧文件逐字备份、笔记命令与右键、GPU 上下文恢复、窄窗深色与键盘入口；**新增**：明暗切换后画布配色整份刷新（中性线与失败色与 CSS 变量逐字一致） |
| `node scripts/renderer-check.mjs` | 通过（30.3ms） | 200 节点、600 条不同联合行动，持续真实指针拖动和滚轮缩放；收敛后停止持续绘制；示范链适配避开工具栏与播放控件 |
| `node scripts/theme-check.mjs` | 12 项通过，5 个视口 | 主题、品牌与无障碍；见下节 |
| `node scripts/record-demo.mjs` | 实际界面录制 | 弹性拖动、圆点／卡片缩放及学习回放，截图编码为动画 |
| `node scripts/check-lean.mjs` 与插件入口 | 3 个固定目标通过 | 编译、实际环境目标核对、公理收集、独立 `leanchecker` 重放 |

机器可读的桌面记录、构建文件摘要和性能实测见 [validation/desktop.json](validation/desktop.json)，形式目标及源文件摘要见 [validation/lean.json](validation/lean.json)。安装包的 `CHECKSUMS.json` 另列打包文件和 ZIP 的 SHA-256。

## 主题、品牌与无障碍（0.2.1 新增）

`node scripts/theme-check.mjs` 在独立测试库上按浅色 1440×960 / 深色 1440×960 / 浅色 1000×820 / 深色 860×720 / 浅色 700×760，以及窄窗 520×760 逐一取样。12 项检查分别是：

1. **打包样式不外泄**：`dist/styles.css` 的 252 条选择器全部带 `mcs-` 前缀；42 个 `--mcs-*` 令牌没有一个声明在 `:root`、`html`、`body` 或 `*` 这类全局作用域上。
2. **字标与署名（5 个视口）**：顶栏字标 `naturalWidth > 0`（确实加载，不是坏图），渲染宽高比与原图比例相差 < 2%；工作面板底部同时出现「作者：沛恒」与 `mailto:peihengmath@gmail.com` 链接，文字与 `href` 逐字核对；署名容器允许换行且不溢出（`scrollWidth - clientWidth ≤ 1`）。
3. **无重叠**：工具栏、署名、阅读面板、播放控件、选择条、画布底注两两求交，任何一对的重叠面积都必须为 0。阅读面板在窄窗按实测的工具栏下沿与底部浮层高度收缩，因此不会盖住播放控件。
4. **对比度 ≥ 4.5:1**：先做令牌矩阵（正文／次级正文／弱化文字／主色／主色深／成功／待办／失败 对 各底色），再对真实渲染出来的元素取样实测；只有字号 ≥ 24px（或 ≥ 18.66px 且加粗）才按大字号 3:1 判定。两种主题都通过。
5. **窄窗抽屉**：面板打开时署名在 520 px 宽下换行、邮箱不被裁切，`flex-wrap` 生效。
6. **面板收起后的落点**：收起工作面板后，插件设置页（Obsidian 会为设置另开窗口）仍显示紫色徽记（原比例）、完整署名与版本号 `0.2.1`，且令牌没有泄漏到该窗口的 `body` 或普通笔记元素上。
7. **空白引导徽记**：浅色与深色都显示紫色徽记且保持原比例。
8. **画布配色刷新**：切换主题后 `data-palette` 必然改变，且其中的中性线与失败色与 `--mcs-neutral` / `--mcs-failure` 的计算值逐字相同；实测路径为 WebGL。
9. **二维回退同源**：临时让行动画布取不到 WebGL 上下文并重开视图，`data-renderer` 转为 `canvas`，配色键、令牌矩阵与文字对比度在回退分支上同样通过——SVG、Canvas 与 WebGL 三条路径确实共用一套令牌。
10. **键盘焦点**：用真实 Tab 键移动焦点（程序化 `focus()` 不触发 `:focus-visible`），焦点圈颜色等于主色、宽度 ≥ 2px；画布仍在 Tab 顺序内（`tabIndex = 0`），方向键仍能平移相机。
11. **减少动态效果**：`prefers-reduced-motion: reduce` 下重排不播放动画，画布保持 `data-motion="idle"`。
12. **设置页与作用域**：见第 6 项，令牌与署名都在插件自己的作用域内。

截图：[浅色工作台](theme-light.png)、[深色工作台](theme-dark.png)、[窄窗深色](theme-narrow.png)、[插件设置页](theme-settings.png)、[空白引导·浅色](theme-empty-light.png)、[空白引导·深色](theme-empty-dark.png)。

## 环境与复现

Windows 桌面，实际 Obsidian 1.14.4，安装程序 1.9.14，Electron 37.6.0。在插件自己的 `runtime/obsidian-*` 下创建测试库和独立配置，使用独立调试端口。用户原有 Obsidian 配置与笔记库不用于测试。版本从宿主的“关于”页面读取；开发依赖的类型包版本不能替代这个记录。尚未覆盖其他桌面平台、移动端或所有支持版本。

![实际 Obsidian 中的计算路线回放](learning-view.png)

[20 秒动态操作演示](dynamic-demo.gif)包含弹性拖动、缩放外观与学习回放，来自实际隔离测试库。

![窄窗深色视图](dynamic-narrow-dark.png)

```powershell
cd E:\MCS\mcs-obsidian
npm ci
npm run check
npm run build
npm test
npm run examples
node scripts/start-test-vault.mjs
node scripts/browser-check.mjs --lean
node scripts/restart-check.mjs
node scripts/dynamic-check.mjs
node scripts/renderer-check.mjs
node scripts/theme-check.mjs
node scripts/record-demo.mjs
node scripts/record-validation.mjs
npm run package
npm run verify:package
```

本机若 Go 类型检查器因提交内存不足退出，可在当前 PowerShell 会话设置 `$env:GOMEMLIMIT="128MiB"` 与 `$env:GOGC="20"` 后重试；不会修改系统配置。

首次独立测试库可能需要在其窗口确认启用本地测试插件。Lean 流程需要 README 中指定的原生工具链和已准备的 mathlib 缓存；普通桌面流程可省去 `--lean`。脚本只测试它记录的独立库，不能拿任意个人库路径代替。

发布版本只在 `manifest.json` 里写一次：桌面、动态、渲染、主题、演示与汇总脚本都从 `scripts/manifest.mjs` 读取，安装包校验 `scripts/verify-package.py` 也改成与清单比对，脚本里不再写死版本号。

## 内容快照的版本变化

本次构建把内容快照从 `02ac2ce6…` 更新为 `85f317bf…`。原因不在插件：`npm run build` 每次都会从 `mcs-web/` 重新派生内容，而本轮期间上游 `mcs-web/data/cases/jiang.mjs`（22:55）与 `mcs-web/web/src/network.ts`（19:54）有修订，派生内容的 `sources` 哈希随之改变。视图、便携包与设置数据的**格式**没有改动：既有 `.mcsview` 仍按各自绑定的内容快照打开，`mcs-bundle/2`、`mcs-view/2` 与 `data.json` 的结构与 0.2.0 相同。

## 动态视图的实测边界

节点、可编辑形式关系、可访问名称和键盘入口保留 SVG。教材联合行动使用共享 WebGL 绘制层，完整保留各条输入、∧ 汇合和输出箭头；没有 GPU 上下文时使用二维 Canvas 回退，两条路径读同一份令牌。本轮压力性能覆盖 GPU 路径，二维回退性能未验证。关闭视图主动释放绘制资源；已检查上下文丢失后恢复。这个实现调整来自实际 SVG 大图性能采样，绘制层不能修改内容、证据或真实掌握记录。

实测环境：11th Gen Intel(R) Core(TM) i7-11370H @ 3.30GHz、15.7 GiB 内存、Obsidian 1.14.4／Electron 37.6.0，视窗 1440×960。200 节点／600 条不同联合行动，第 95 百分位 **30.3ms ≤ 33ms**。详细帧统计见机器可读记录；收敛后没有持续绘制循环。

性能脚本先完成一次完整力模拟收敛，再持续拖动与交替缩放，分别记录宿主 RAF 与实际图更新的间隔，并取较差的第 95 百分位；初次收敛另行计时。这是人工压力材料的一次有限场景，不能据此推断所有网络、显卡或平台。精确数值、视窗与构建摘要登记在机器可读记录中。

## 数学与教学边界

三个 Lean 目标是可逆线性映射的消去、特解加核、有限维秩—零度。其源文件哈希、实际目标与公理在独立审计中登记。教材对应仍为 `pending`；尚未覆盖三类具体初等矩阵的构造，也不支持任意用户 Lean 目标。

关系编辑器的 ND 检查限于已实现的条件推导、双向等价和指定放缩方向。搜索未找到证明时保留未决，不报告为假。Python 检查器自身尚未经过形式化验证。定义引用、实例、反例的专用检查属于 P3 剩余工作；类比不作为证明。

地图有 59 个节点；其中完整示范正文为 10 个。未逐条校勘整本教材，其他地图入口不能当作完整学习笔记。动态系统目前演绎依赖事件与背景可用性，未实现几何对象动画。没有对学习成绩或长期记忆做用户研究。

回看：学习者是否能区分“当前精确陈述已检查”与“已准确表达教材”？配色与署名换过一轮之后，哪些教学效果或平台兼容性仍需另行检查？

思想：验收要固定输入身份，并允许读者复核结论边界。方法：分别记录桌面行为、主题与无障碍、数学目标和教材对应，使用文件摘要把记录绑定到具体成品。
