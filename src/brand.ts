/**
 * 插件署名与品牌资源。
 *
 * 与站点 `mcs-web/web/src/site.ts` 的 `SITE` **取值与键名逐字一致**：作者、邮箱、
 * mailto 只在网站那一份里维护，这里跟着走，改邮箱时两处一起改（插件清单的
 * `author` 也写同一个人名：沛恒）。
 *
 * 图片是随插件打包的本地资源（`assets/`），构建时从站点现用产物复制，
 * 不引用任何远程地址，断网也能显示；`Host.asset` 负责把文件名解析成
 * Obsidian 的资源路径。
 */
export const BRAND = {
  name: '数学认知空间 MCS',
  author: '沛恒',
  email: 'peihengmath@gmail.com',
  mailto: 'mailto:peihengmath@gmail.com',
} as const;

/** 站点页脚/侧栏用的同一句前缀，插件里保持一致。 */
export const AUTHOR_LABEL = '作者';

/** 随插件打包的图片：顶栏字标（站点现用一笔彩虹字标）、紫色徽记。 */
export const ASSETS = {
  wordmark: 'wordmark.png',
  emblem: 'emblem.png',
} as const;
export type AssetName = keyof typeof ASSETS;
