# GitHub 独立仓库

仓库：[akashicpeiheng/mcs-obsidian](https://github.com/akashicpeiheng/mcs-obsidian)。

当前源码清单为 0.3.1。已有整套桌面验收与安装包为 0.3.0，位于
`release/0.3.0-b6b1e2d546fa/`；旧包和其 SHA-256 清单保留原样。
`VALIDATION.md` 与 `validation/desktop.json` 记载的是 0.3.0 的实测，
不能据此认定 0.3.1 也已通过全部桌面、性能和稳定性验收。

公开版本把实际依赖的共享模块放在 `upstream/`，并将源码导入指向这份快照。
`upstream/SOURCES.json` 登记相关网站提交及逐文件哈希；两章理论来源另有
原始文件哈希，它们不属于网站公开包的既有白名单。
快照复用原实现，不另写规划器。单独克隆插件仓库后可安装依赖、检查、构建与运行核心测试。
构建内容快照时继续记录原始来源路径和文件摘要。

主工作区的导出入口为：

```powershell
python mcs-obsidian/scripts/export-open-source.py --out <新的目录> --website-commit <相关网站提交>
```

导出保留源码、文档、案例、授权与旧成品，排除运行数据、个人库和本机发布指针；
同时检查共享模块闭包、已列密钥模式、本机用户路径和本地资料排除规则。
导出后更新锁文件，并在导出目录验证 `npm ci`、`npm run check`、`npm run build`、`npm test`。
这组检查不代替 Obsidian 实机验收，也不证明一般数学正确性。

2026-10-16 实测：在独立导出目录完成 `npm ci`、类型检查、构建与 36 项核心测试，
全部通过。27 个共享来源文件逐一回读核对 SHA-256，示例便携包已按本次内容快照重新生成。
本次没有重跑 0.3.1 的完整 Obsidian 桌面、主题、性能和稳定性验收。
