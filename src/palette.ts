/**
 * 画布配色的 JS 镜像。
 *
 * 为什么需要这一份：SVG 的表现属性（`stroke=`、`fill=`）不接受 `var()`，
 * WebGL 图层的着色器更只能吃字面色值；而画布上的行动契约线、形式关系线与
 * 汇合点恰恰是这些属性。所以 `src/theme.css` 的 `--mcs-*` 与这里的映射
 * 必须成对维护：改一处就要同时改另一处。
 *
 * 配色键固定为四个，SVG、二维 Canvas 回退与 WebGL 图层共用同一套：
 * - `background`：画布底色，汇合点用它垫底，避免线穿过来；
 * - `accent`：主色，当前步骤与聚焦的关系线；
 * - `neutral`：中性紫灰，兜底与行动契约线——契约是结构骨架而不是数学断言，
 *   必须明显弱于语义关系色；
 * - `failure`：失败色，被拒绝的证书与前提缺失。
 *
 * `paletteKey` 把四个值拼成缓存键：明暗切换时键必然改变，绘制层据此重建色值，
 * 不会留着上一套主题的颜色继续画。
 */
export interface CanvasPalette {
  background: string;
  accent: string;
  neutral: string;
  failure: string;
}

/** 配色键到 CSS 令牌名的映射；顺序即 `paletteKey` 的拼接顺序。 */
export const PALETTE_VARS: Record<keyof CanvasPalette, string> = {
  background: '--mcs-bg',
  accent: '--mcs-accent',
  neutral: '--mcs-neutral',
  failure: '--mcs-failure',
};

const KEYS = Object.keys(PALETTE_VARS) as (keyof CanvasPalette)[];

/** 从画布元素的继承样式里读四个令牌；缺一个就整体回退，不留下半套颜色。 */
export function readPalette(el: Element): CanvasPalette {
  const css = getComputedStyle(el);
  const value = (key: keyof CanvasPalette) => css.getPropertyValue(PALETTE_VARS[key]).trim();
  const palette = Object.fromEntries(KEYS.map(key => [key, value(key)])) as unknown as CanvasPalette;
  if (KEYS.some(key => !palette[key])) return FALLBACK_PALETTE;
  return palette;
}

/** 读不到令牌时的兜底：站点浅色取值，保证画布永远画得出来。 */
export const FALLBACK_PALETTE: CanvasPalette = {
  background: '#f5f3fb',
  accent: '#6d28d9',
  neutral: '#8d85ae',
  failure: '#b3204a',
};

export function paletteKey(palette: CanvasPalette): string {
  return KEYS.map(key => palette[key]).join('|');
}
