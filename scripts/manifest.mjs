import {readFile} from 'node:fs/promises';

/**
 * 插件清单是发布版本的唯一来源。
 *
 * 验收脚本、演示录制与打包校验都从这里读版本号，脚本里不再写死 `'0.2.x'`：
 * 改版本只需要动 `manifest.json`（和 `package.json`），不会出现清单说一个版本、
 * 验收记录说另一个版本的情况。
 */
export const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
export const version=manifest.version;
