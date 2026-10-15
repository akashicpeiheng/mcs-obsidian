# 桌面试用验收记录

日期：2026-10-13。版本：0.1.0。以下结果是 FINITE，指当前构建、给定输入和本机环境的检查；不构成一般性能、教学收益或完整数学正确性的证明。

## 已检查的范围

| 入口 | 结果 | 具体范围 |
| --- | --- | --- |
| `npm run check` | 通过 | TypeScript 类型检查 |
| `npm run build` | 通过 | 插件、独立 ND 工作进程、Python 内核和 Lean 入口打包 |
| `npm test` | 17 项通过 | 联合输入与备选生产者、实际前提、空背景、复习事件、路线来源、版本哈希、学习记录隔离、网站迁移、布局锁定、证据失效、推荐、两条案例路线、类型错误及真实 ND 证书重放 |
| `node scripts/browser-check.mjs --lean` | 17 个桌面流程通过 | 实际 Obsidian 加载、空闲后的首次保存、多次保存、联合关系编辑、独立 ND 检查、8 事件沙盘、前提缺失传播、个人记录隔离、重开、便携导入、节点版本隔离、笔记创建与改名、既有笔记选择、并发保存与恢复副本、Lean 集成 |
| `node scripts/restart-check.mjs` | 通过 | 关闭并真正重新启动独立 Obsidian 进程；正常文件和恢复副本均可重新打开 |
| `node scripts/renderer-check.mjs` | 通过 | 200 节点、600 联合行动的布局、渲染、拖动锁定与保存；示范链适配后各节点避开上方工具栏和下方播放控件 |
| `node scripts/check-lean.mjs` 与插件入口 | 3 个固定目标通过 | 编译、实际环境目标核对、公理收集、独立 `leanchecker` 重放 |

机器可读的桌面记录、构建文件摘要和性能实测见 [validation/desktop.json](validation/desktop.json)，形式目标及源文件摘要见 [validation/lean.json](validation/lean.json)。安装包的 `CHECKSUMS.json` 另列打包文件和 ZIP 的 SHA-256。

## 环境与复现

Windows 桌面，在插件自己的 `runtime/obsidian-*` 下创建测试库和独立配置，使用独立调试端口。用户原有 Obsidian 配置与笔记库不用于测试。测试宿主的实际版本由桌面记录读取；开发依赖的 Obsidian 类型包版本不能替代这个记录。尚未覆盖其他桌面平台、移动端或所有支持版本。

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
node scripts/renderer-check.mjs
node scripts/record-validation.mjs
npm run package
```

首次独立测试库可能需要在其窗口确认启用本地测试插件。Lean 流程需要 README 中指定的原生工具链和已准备的 mathlib 缓存；普通桌面流程可省去 `--lean`。脚本只测试它记录的独立库，不能拿任意个人库路径代替。

## 数学与教学边界

三个 Lean 目标是可逆线性映射的消去、特解加核、有限维秩—零度。其源文件哈希、实际目标与公理在独立审计中登记。教材对应仍为 `pending`；尚未覆盖三类具体初等矩阵的构造，也不支持任意用户 Lean 目标。

关系编辑器的 ND 检查限于已实现的条件推导、双向等价和指定放缩方向。搜索未找到证明时保留未决，不报告为假。Python 检查器自身尚未经过形式化验证。定义引用、实例、反例的专用检查属于 P3 剩余工作；类比不作为证明。

地图有 59 个节点；其中完整示范正文为 10 个。未逐条校勘整本教材，其他地图入口不能当作完整学习笔记。动态系统目前演绎依赖事件与背景可用性，未实现几何对象动画。没有对学习成绩或长期记忆做用户研究。

回看：学习者是否能区分“当前精确陈述已检查”与“已准确表达教材”？测试通过后，哪些原文对应、教学效果或平台兼容性仍需另行检查？

思想：验收要固定输入身份，并允许读者复核结论边界。方法：分别记录桌面行为、数学目标和教材对应，使用文件摘要把记录绑定到具体成品。
