import {chromium} from '../../mcs-web/node_modules/playwright-core/index.mjs';
import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createView,exportBundle} from '../src/core.mjs';
import {artifactIdentity} from './desktop-artifact.mjs';
import {version} from './manifest.mjs';
import {hostPage} from './host-page.mjs';

/*
 * 主题、品牌与无障碍验收（浅色 / 深色 / 窄窗）。
 *
 * 为什么单独成一支脚本：这一轮的核心是「插件跟随 Obsidian 明暗，
 * 且紫主题不伤可读性」。它检查的是**渲染出来的**东西，不是源码里的字符串：
 *   1. 字标与徽记真的加载出来（naturalWidth > 0）且保持原比例；
 *   2. 署名与邮箱链接的文字、href 正确，窄窗不溢出；
 *   3. 普通文字的实测对比度 ≥ 4.5:1（令牌矩阵 + 真实渲染元素两路取样）；
 *   4. 工具栏、署名、阅读面板、播放控件互不重叠；
 *   5. 明暗切换后 SVG/Canvas/WebGL 共用的一套画布配色整份刷新；
 *   6. 键盘焦点描边取主色；减少动态效果设置生效；
 *   7. 插件样式不外泄：打包后的每条选择器都限定在 mcs- 作用域内，
 *      令牌不会落到 body 或普通笔记上。
 *
 * 结果写入 runtime/theme-report.json；截图进 docs/。
 */

const CSS_SCOPE_SAMPLES=['.mcs-panel-head p','.mcs-pick p','.mcs-eyebrow','.mcs-attribution','.mcs-canvas-foot','.mcs-relation small','.mcs-detail .mcs-muted','.mcs-step p'];
const LAYOUT_SELECTORS=['.mcs-canvas-toolbar','.mcs-attribution','.mcs-detail','.mcs-player','.mcs-selection','.mcs-canvas-foot'];
const TOKENS=['--mcs-bg','--mcs-panel','--mcs-surface-2','--mcs-canvas','--mcs-accent-wash','--mcs-accent-soft','--mcs-ink','--mcs-ink-soft','--mcs-muted','--mcs-accent','--mcs-accent-strong','--mcs-green','--mcs-green-soft','--mcs-amber','--mcs-amber-soft','--mcs-red','--mcs-red-soft','--mcs-neutral','--mcs-failure','--mcs-on-accent','--mcs-grad-brand','--mcs-toolbar-space','--mcs-overlay-space'];
/** 需要在两种底色上都读得清的普通文字：令牌 → 可能出现的底色。 */
const CONTRAST_MATRIX={
  '--mcs-ink':['--mcs-bg','--mcs-panel','--mcs-surface-2','--mcs-accent-wash'],
  '--mcs-ink-soft':['--mcs-bg','--mcs-panel','--mcs-surface-2'],
  '--mcs-muted':['--mcs-bg','--mcs-panel','--mcs-surface-2','--mcs-accent-wash'],
  '--mcs-accent':['--mcs-panel','--mcs-bg','--mcs-accent-wash','--mcs-accent-soft'],
  '--mcs-accent-strong':['--mcs-accent-soft','--mcs-panel'],
  '--mcs-green':['--mcs-panel','--mcs-green-soft','--mcs-bg'],
  '--mcs-amber':['--mcs-panel','--mcs-amber-soft','--mcs-bg'],
  '--mcs-red':['--mcs-panel','--mcs-red-soft','--mcs-bg'],
};

const channel=value=>{const c=value/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;};
const luminance=([r,g,b])=>0.2126*channel(r)+0.7152*channel(g)+0.0722*channel(b);
const ratio=(fore,back)=>{const a=luminance(fore),b=luminance(back);const [high,low]=a>b?[a,b]:[b,a];return (high+0.05)/(low+0.05);};
const parseColor=text=>{const match=String(text).match(/rgba?\(([^)]+)\)/);if(!match)return null;const parts=match[1].split(/[,\s/]+/).filter(Boolean).map(Number);if(parts.length<3||parts.some(Number.isNaN))return null;return parts.slice(0,3);};
const round=value=>Math.round(value*100)/100;

/* 打包样式的作用域：每条选择器都要带 mcs-，令牌只许声明在工作区与设置页块里。 */
function rules(css){
  const found=[];const stack=[];let buffer='';
  for(let i=0;i<css.length;i++){
    const ch=css[i];
    if(ch==='{'){const head=buffer.trim();stack.push({head,at:head.startsWith('@'),bodyStart:i+1});buffer='';}
    else if(ch==='}'){const frame=stack.pop();if(frame&&!frame.at)found.push({head:frame.head,body:css.slice(frame.bodyStart,i),insideAt:stack.length>0});buffer='';}
    else if(ch===';'&&stack.length===0)buffer='';
    else buffer+=ch;
  }
  return found;
}

const session=JSON.parse(await readFile('runtime/obsidian-session.json'));
assert.ok(resolve(session.vault).startsWith(resolve('runtime')+'\\'));
const content=JSON.parse(await readFile('src/generated/content.json'));
const example=JSON.parse(await readFile('examples/calculation.mcspack.json'));
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.port}`);
const errors=[],checks=[];
/** 设置窗口是另一个 document，按 .mcs-settings 找到它。 */
async function findSettingsPage(){
  for(const context of browser.contexts())for(const candidate of context.pages()){
    const found=await candidate.evaluate(()=>!!document.querySelector('.mcs-settings')).catch(()=>false);
    if(found)return candidate;
  }
  return null;
}
const page=await hostPage(browser,session.vault);
assert.ok(page,'Main Obsidian window for the isolated vault was not found');
page.on('pageerror',error=>errors.push(error.stack));
page.setDefaultTimeout(20000);
const ui=()=>page.locator('.mcs-app').last();
const graph=()=>ui().locator('.mcs-graph');
const setTheme=async theme=>{await page.evaluate(name=>{document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(name);},theme);await page.waitForFunction(name=>document.body.classList.contains(name),theme);await page.waitForTimeout(200);};

async function open(view,viewContent=content){
  await page.evaluate(async({view,content})=>{for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();await app.plugins.plugins['mcs-cognitive-space'].newView(content,view);},{view,content:viewContent});
  await graph().waitFor();await page.waitForTimeout(120);
}

/** 采集一份完整的渲染事实：几何、令牌、图片、署名、文字取样。 */
const probe=()=>page.evaluate(({selectors,samples,tokens})=>{
  const root=[...document.querySelectorAll('.mcs-app')].at(-1);
  const visible=el=>{const css=getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>=1&&r.height>=1;};
  const box=selector=>{const el=root.querySelector(selector);if(!el||!visible(el))return null;const r=el.getBoundingClientRect();return {selector,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  // 元素自身的底色可能是透明的，往上找到第一个不透明底色才是真实背景。
  const backdrop=el=>{for(let node=el;node;node=node.parentElement){const value=getComputedStyle(node).backgroundColor;const parts=value.match(/rgba?\(([^)]+)\)/);if(!parts)continue;const alpha=Number(parts[1].split(',')[3]??1);if(alpha>=.95)return value;}return null;};
  const css=getComputedStyle(root);
  const image=selector=>{const el=root.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {selector,naturalWidth:el.naturalWidth||0,naturalHeight:el.naturalHeight||0,width:r.width,height:r.height,complete:el.complete!==false,src:String(el.currentSrc||el.src||'')};};
  const attribution=(()=>{const el=root.querySelector('.mcs-attribution');if(!el)return null;const link=el.querySelector('a');return {text:el.textContent.replace(/\s+/g,''),email:link?.textContent.trim()??null,href:link?.getAttribute('href')??null,overflowX:el.scrollWidth-el.clientWidth,wrap:getComputedStyle(el).flexWrap,width:el.getBoundingClientRect().width};})();
  const wordmark=image('.mcs-wordmark');
  const canvas=root.querySelector('.mcs-actions-canvas');
  return {
    boxes:selectors.map(box).filter(Boolean),
    tokens:Object.fromEntries(tokens.map(name=>[name,css.getPropertyValue(name).trim()])),
    wordmark,
    emblem:image('.mcs-empty .mcs-emblem'),
    attribution,
    palette:canvas?.dataset.palette??null,
    renderer:canvas?.dataset.renderer??null,
    text:samples.map(selector=>{const el=root.querySelector(selector);if(!el||!visible(el))return null;const style=getComputedStyle(el);return {selector,color:style.color,background:backdrop(el),fontSize:parseFloat(style.fontSize),fontWeight:Number(style.fontWeight)||400};}).filter(Boolean),
  };
},{selectors:LAYOUT_SELECTORS,samples:CSS_SCOPE_SAMPLES,tokens:TOKENS});

const intersects=(a,b)=>{const width=Math.min(a.right,b.right)-Math.max(a.left,b.left),height=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);return width>1&&height>1?{width:round(width),height:round(height)}:null;};
function assertNoOverlap(boxes,label,ignore=[]){
  const collisions=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const [a,b]=[boxes[i],boxes[j]];
    const key=[a.selector,b.selector].sort().join('~');
    if(ignore.includes(key))continue;
    const hit=intersects(a,b);
    if(hit)collisions.push({pair:[a.selector,b.selector],overlap:hit});
  }
  assert.deepEqual(collisions,[],`${label}: overlapping controls`);
}
function assertTextContrast(samples,label){
  const failures=[];
  for(const sample of samples){
    const fore=parseColor(sample.color),back=parseColor(sample.background);
    if(!fore||!back)continue;
    // WCAG 的大字号门槛：≥24px，或 ≥18.66px 且加粗。其余一律按普通文字 4.5:1。
    const large=sample.fontSize>=24||(sample.fontSize>=18.66&&sample.fontWeight>=700);
    const required=large?3:4.5;
    const value=ratio(fore,back);
    if(value<required)failures.push({...sample,ratio:round(value),required});
  }
  assert.deepEqual(failures,[],`${label}: normal text below WCAG AA`);
}
function assertMatrix(tokens,label){
  const failures=[];
  for(const [fore,backs]of Object.entries(CONTRAST_MATRIX))for(const back of backs){
    const foreColor=parseColor(tokens[fore]?.match(/^#[0-9a-f]{6}$/i)?hexToRgb(tokens[fore]):tokens[fore]);
    const backColor=parseColor(tokens[back]?.match(/^#[0-9a-f]{6}$/i)?hexToRgb(tokens[back]):tokens[back]);
    if(!foreColor||!backColor)continue;
    const value=ratio(foreColor,backColor);
    if(value<4.5)failures.push({fore,back,ratio:round(value)});
  }
  assert.deepEqual(failures,[],`${label}: token pairs below 4.5:1`);
}
const hexToRgb=hex=>{const value=parseInt(hex.slice(1),16);return `rgb(${(value>>16)&255}, ${(value>>8)&255}, ${value&255})`;};
/** 画布配色必须就是那四个令牌：后两位（中性线、失败色）与 CSS 变量逐字相同。 */
function assertValidPalette(state,label){
  assert.ok(state.palette,`${label}: action canvas has no palette`);
  assert.deepEqual(state.palette.split('|').slice(2),[state.tokens['--mcs-neutral'],state.tokens['--mcs-failure']],`${label}: canvas palette is not the shared token set`);
}

try{
  assert.equal(await page.evaluate(()=>app.vault.adapter.getBasePath()),session.vault,'Test vault mismatch');
  const trust=page.getByRole('button',{name:'Trust author and enable plugins'});
  if(await trust.count()){await trust.click();await page.waitForFunction(()=>app.plugins.plugins['mcs-cognitive-space']);}
  await page.evaluate(async()=>{for(const type of ['mcs-network','markdown'])for(const leaf of app.workspace.getLeavesOfType(type))await leaf.detach();app.setting.close();await app.plugins.unloadPlugin('mcs-cognitive-space');});
  await cp('dist',resolve(session.vault,'.obsidian/plugins/mcs-cognitive-space'),{recursive:true});
  // Obsidian 会缓存插件清单：换过 manifest.json 后必须让它重读，否则插件实例
  // 仍然认为自己是被替换掉的那个版本，设置页里的版本号也就不是本次构建的。
  await page.evaluate(async()=>{if(typeof app.plugins.loadManifests==='function')await app.plugins.loadManifests();await app.plugins.loadPlugin('mcs-cognitive-space');});
  const loaded=await page.evaluate(()=>app.plugins.plugins['mcs-cognitive-space']?.manifest?.version??null);
  assert.equal(loaded,version,`Obsidian loaded manifest ${loaded}, expected ${version}`);
  await page.evaluate(async()=>{const plugin=app.plugins.plugins['mcs-cognitive-space'];plugin.settings.known=[];await plugin.saveData(plugin.settings);});
  // 收起 Obsidian 自己的侧栏，让插件面板真正等于视口宽度，容器查询才按预期分支。
  await page.evaluate(()=>{app.workspace.leftSplit?.collapse?.();app.workspace.rightSplit?.collapse?.();});
  await page.setViewportSize({width:1440,height:960});

  // ---- 静态作用域：打包后的选择器与令牌都不许越界 -------------------------
  const bundled=(await readFile('dist/styles.css','utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
  const parsed=rules(bundled);
  assert.ok(parsed.length>=80,`Bundled stylesheet only parsed ${parsed.length} rules`);
  const selectors=parsed.flatMap(rule=>rule.head.split(',')).map(value=>value.trim()).filter(Boolean);
  const unscoped=selectors.filter(selector=>!selector.includes('mcs-'));
  assert.equal(unscoped.length,0,`Selectors outside the plugin scope: ${unscoped.slice(0,8).join(' | ')}`);
  const leaked=[];const declared=new Set();
  // 令牌可以落在插件自己的任意块里（布局变量在 .mcs-workspace），但绝不能落到
  // :root / html / body / * 这类全局作用域上——那才会影响普通笔记与其他插件。
  for(const rule of parsed)for(const match of rule.body.matchAll(/(--mcs-[a-z-]+)\s*:/g)){
    declared.add(match[1]);
    if(/(^|,)\s*(:root|html|body|\*)\s*(,|$)/.test(rule.head))leaked.push(`${match[1]} in ${rule.head}`);
  }
  assert.deepEqual(leaked,[],'Theme tokens must never be declared in a global scope');
  for(const name of ['--mcs-bg','--mcs-accent','--mcs-neutral','--mcs-failure'])assert.ok(declared.has(name),`Theme token ${name} is missing from the bundle`);
  checks.push(`bundled stylesheet scoped to the plugin (${selectors.length} selectors, ${declared.size} tokens)`);

  // ---- 浅色：完整工作台（节点、关系、阅读面板、播放控件） -----------------
  const view=exportBundle(example.content,example.view).view;
  await open(view,example.content);
  await ui().getByRole('button',{name:'关系工作室',exact:true}).click();
  await ui().getByRole('button',{name:'学习沙盘',exact:true}).click();
  await ui().getByRole('button',{name:'生成候选路线'}).click();
  await ui().getByLabel('沙盘：使用独立的假设背景').check();
  await ui().locator('.mcs-sidebar label.mcs-check').last().locator('input').check();
  await page.waitForFunction(()=>!!document.querySelector('.mcs-player'));
  await ui().getByRole('button',{name:'适配',exact:true}).click();
  await ui().locator('.mcs-card').first().focus();
  await page.keyboard.press('Space');
  await ui().getByRole('button',{name:'阅读',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('.mcs-detail'));
  await page.waitForTimeout(260);

  const scenarios=[];
  for(const [theme,width,height,label] of [
    ['theme-light',1440,960,'light wide'],
    ['theme-dark',1440,960,'dark wide'],
    ['theme-light',1000,820,'light medium'],
    ['theme-dark',860,720,'dark narrow'],
    ['theme-light',700,760,'light narrow'],
  ]){
    await page.setViewportSize({width,height});
    await setTheme(theme);
    await ui().getByRole('button',{name:'适配',exact:true}).click();
    await page.waitForTimeout(320);
    const state=await probe();
    assert.ok(state.wordmark,`${label}: wordmark missing`);
    assert.ok(state.wordmark.naturalWidth>0,`${label}: wordmark did not load (${state.wordmark.src})`);
    assert.ok(state.wordmark.complete,`${label}: wordmark not fully decoded`);
    assert.ok(Math.abs(state.wordmark.width/state.wordmark.height-state.wordmark.naturalWidth/state.wordmark.naturalHeight)<.02,`${label}: wordmark aspect ratio changed (${state.wordmark.width}x${state.wordmark.height})`);
    assert.ok(state.attribution,`${label}: attribution missing from the work panel`);
    assert.equal(state.attribution.email,'peihengmath@gmail.com',`${label}: contact email text`);
    assert.equal(state.attribution.href,'mailto:peihengmath@gmail.com',`${label}: contact email link`);
    assert.ok(state.attribution.text.includes('作者：沛恒'),`${label}: author line (${state.attribution.text})`);
    assert.ok(state.attribution.overflowX<=1,`${label}: attribution overflows its panel by ${state.attribution.overflowX}px`);
    assert.equal(state.attribution.wrap,'wrap',`${label}: attribution must be allowed to wrap`);
    assertValidPalette(state,label);
    assertMatrix(state.tokens,label);
    assertTextContrast(state.text,label);
    assertNoOverlap(state.boxes,label);
    assert.ok(state.boxes.some(box=>box.selector==='.mcs-canvas-toolbar'),`${label}: toolbar not visible`);
    assert.ok(state.boxes.some(box=>box.selector==='.mcs-player'),`${label}: playback controls not visible`);
    assert.ok(state.boxes.some(box=>box.selector==='.mcs-detail'),`${label}: reading panel not visible`);
    await ui().screenshot({path:`runtime/theme-${theme.replace('theme-','')}-${width}x${height}.png`});
    scenarios.push({label,theme,width,height,toolbar:Boolean(state.boxes.find(box=>box.selector==='.mcs-canvas-toolbar')),palette:state.palette});
  }
  checks.push(`light/dark/narrow: wordmark, emblem-free header, attribution email and wrap (${scenarios.length} viewports)`);
  checks.push('toolbar, attribution, reading panel and playback controls never overlap');
  checks.push('normal text keeps WCAG AA 4.5:1 in both themes (token matrix plus rendered elements)');

  // ---- 窄窗：署名换行、logo 不裁切、阅读面板与播放控件仍然分离 ------------
  await page.setViewportSize({width:520,height:760});
  await setTheme('theme-dark');
  await page.waitForTimeout(300);
  const narrow=await probe();
  assert.ok(narrow.wordmark&&narrow.wordmark.naturalWidth>0,'narrow: wordmark did not load');
  assert.ok(narrow.wordmark.width>=60&&narrow.wordmark.width<=150,`narrow: wordmark width ${narrow.wordmark.width}`);
  assertTextContrast(narrow.text,'narrow');
  assertMatrix(narrow.tokens,'narrow');
  assertValidPalette(narrow,'narrow');
  const narrowBoxes=narrow.boxes.filter(box=>['.mcs-canvas-toolbar','.mcs-player','.mcs-selection','.mcs-canvas-foot','.mcs-detail'].includes(box.selector));
  assertNoOverlap(narrowBoxes,'narrow');
  await ui().screenshot({path:'runtime/theme-dark-520x760.png'});

  // 窄窗里工作面板是抽屉：打开后署名按行换行、不溢出，邮箱仍然可点。
  const drawer=await page.evaluate(async()=>{
    const root=[...document.querySelectorAll('.mcs-app')].at(-1);
    if(root.classList.contains('mcs-panel-hidden'))root.querySelector('.mcs-sidebar-toggle').click();
    await new Promise(done=>setTimeout(done,240));
    const el=root.querySelector('.mcs-attribution'),link=el?.querySelector('a');
    if(!el)return null;
    const css=getComputedStyle(el);
    return {visible:el.getBoundingClientRect().height>0,wrap:css.flexWrap,overflowX:el.scrollWidth-el.clientWidth,lines:Math.round(el.getBoundingClientRect().height/(parseFloat(css.lineHeight)||16)),email:link?.textContent.trim()??null,href:link?.getAttribute('href')??null,text:el.textContent.replace(/\s+/g,'')};
  });
  assert.ok(drawer?.visible,'narrow: attribution must be visible when the work panel is open');
  assert.equal(drawer.email,'peihengmath@gmail.com');assert.equal(drawer.href,'mailto:peihengmath@gmail.com');
  assert.ok(drawer.text.includes('作者：沛恒'),`narrow drawer author line (${drawer.text})`);
  assert.equal(drawer.wrap,'wrap','narrow: attribution must be allowed to wrap');
  assert.ok(drawer.overflowX<=1,`narrow: attribution overflows by ${drawer.overflowX}px`);
  checks.push('narrow drawer wraps the author line without clipping the email');

  // 面板收起后仍能在设置页查看联系信息（含窄窗）。
  // Obsidian 1.14 把设置渲染到独立窗口，所以先收起面板，再在**所有页面**里找
  // 带 .mcs-settings 的那一个——不能假设它和主窗口同一个 document。
  await page.setViewportSize({width:520,height:760});
  const hidden=await page.evaluate(async()=>{
    const root=[...document.querySelectorAll('.mcs-app')].at(-1);
    const toggle=root.querySelector('.mcs-sidebar-toggle');
    if(toggle&&root.classList.contains('mcs-panel-open')){toggle.click();await new Promise(done=>setTimeout(done,200));}
    app.setting.open();
    const tabs=[...(app.setting.settingTabs??[]),...(app.setting.pluginTabs??[])];
    const tab=tabs.find(entry=>entry.id==='mcs-cognitive-space')??tabs.find(entry=>/mcs/i.test(`${entry.id} ${entry.name??''}`));
    if(!tab)throw new Error(`MCS settings tab not found among: ${tabs.map(entry=>entry.id).join(', ')}`);
    app.setting.openTabById(tab.id);
    return root.classList.contains('mcs-panel-hidden');
  });
  assert.equal(hidden,true,'narrow work panel should be collapsed for this check');
  await page.waitForTimeout(500);
  const settingsPage=await findSettingsPage();
  assert.ok(settingsPage,'settings tab did not render .mcs-settings in any Obsidian window');
  await settingsPage.evaluate(()=>{document.body.classList.remove('theme-light');document.body.classList.add('theme-dark');});
  await settingsPage.waitForTimeout(220);
  const collapsed=await settingsPage.evaluate(()=>{
    const el=document.querySelector('.mcs-settings');if(!el)return null;
    const image=el.querySelector('.mcs-emblem'),link=el.querySelector('.mcs-settings-brand a'),css=getComputedStyle(el);
    return {
      emblem:image?{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height}:null,
      brand:el.querySelector('.mcs-settings-brand')?.textContent.replace(/\s+/g,'')??'',
      email:link?.textContent.trim()??null,href:link?.getAttribute('href')??null,
      accent:css.getPropertyValue('--mcs-accent').trim(),panel:css.getPropertyValue('--mcs-panel').trim(),ink:css.getPropertyValue('--mcs-ink').trim(),
      bodyToken:getComputedStyle(document.body).getPropertyValue('--mcs-bg').trim(),
      noteToken:getComputedStyle(document.querySelector('.workspace-leaf-content[data-type=markdown]')??document.body).getPropertyValue('--mcs-ink').trim(),
    };
  });
  assert.ok(collapsed,'settings tab content missing');
  assert.ok(collapsed.emblem&&collapsed.emblem.naturalWidth>0,'settings emblem did not load');
  assert.ok(Math.abs(collapsed.emblem.width/collapsed.emblem.height-collapsed.emblem.naturalWidth/collapsed.emblem.naturalHeight)<.02,'settings emblem aspect ratio changed');
  assert.equal(collapsed.email,'peihengmath@gmail.com','settings contact email text');
  assert.equal(collapsed.href,'mailto:peihengmath@gmail.com','settings contact email link');
  assert.ok(collapsed.brand.includes('作者：沛恒'),`settings author line (${collapsed.brand})`);
  assert.ok(collapsed.brand.includes(version),`settings page must show version ${version}`);
  assert.ok(collapsed.accent&&collapsed.panel,'settings scope must expose the shared theme tokens');
  assert.equal(collapsed.bodyToken,'','theme tokens must not leak to body');
  assert.equal(collapsed.noteToken,'','theme tokens must not leak to ordinary notes');
  await settingsPage.locator('.mcs-settings').screenshot({path:'runtime/theme-settings-dark.png'});
  await page.evaluate(()=>app.setting.close());
  checks.push(`collapsed panel: full attribution, emblem and version ${version} remain in plugin settings`);
  checks.push('plugin tokens stay out of body and ordinary notes');

  // ---- 空白网络引导区的紫色徽记 -----------------------------------------
  await open(createView(example.content,'主题验收 · 空白引导'),example.content);
  await page.setViewportSize({width:1200,height:860});
  for(const theme of ['theme-light','theme-dark']){
    await setTheme(theme);
    const empty=await probe();
    assert.ok(empty.emblem,`${theme}: empty-state emblem missing`);
    assert.ok(empty.emblem.naturalWidth>0,`${theme}: empty-state emblem did not load`);
    assert.ok(Math.abs(empty.emblem.width/empty.emblem.height-empty.emblem.naturalWidth/empty.emblem.naturalHeight)<.02,`${theme}: emblem aspect ratio changed`);
    assert.ok(empty.wordmark&&empty.wordmark.naturalWidth>0,`${theme}: wordmark missing in the empty state`);
    await ui().screenshot({path:`runtime/theme-empty-${theme.replace('theme-','')}.png`});
  }
  checks.push('empty network guide shows the purple emblem in both themes, original aspect ratio kept');

  // ---- 明暗切换后的画布配色、键盘焦点、减少动态效果 ----------------------
  await open(view,example.content);
  await page.setViewportSize({width:1200,height:860});
  await setTheme('theme-light');
  await page.waitForFunction(()=>document.querySelector('.mcs-actions-canvas')?.dataset.palette);
  const lightPalette=(await probe()).palette;
  await setTheme('theme-dark');
  await page.waitForFunction(prior=>{const canvas=document.querySelector('.mcs-actions-canvas');return canvas?.dataset.palette&&canvas.dataset.palette!==prior;},lightPalette);
  const switched=await probe();
  assert.notEqual(switched.palette,lightPalette,'canvas palette must be rebuilt after a theme switch');
  assert.deepEqual(switched.palette.split('|').slice(2),[switched.tokens['--mcs-neutral'],switched.tokens['--mcs-failure']]);
  assert.ok(['webgl','canvas'].includes(switched.renderer),`unexpected action renderer ${switched.renderer}`);
  checks.push(`theme switch rebuilds the shared canvas palette (${switched.renderer} path)`);

  // 二维 Canvas 回退也要读同一套令牌：临时让行动画布拿不到 WebGL 上下文，
  // 重开视图强制走回退分支，核对渲染路径与配色后立刻还原。
  await page.evaluate(()=>{window.__mcsOriginalGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...rest){return type==='webgl'?'':window.__mcsOriginalGetContext.call(this,type,...rest);};});
  try{
    await open(view,example.content);
    await page.setViewportSize({width:1200,height:860});
    await setTheme('theme-dark');
    await page.waitForFunction(()=>document.querySelector('.mcs-actions-canvas')?.dataset.renderer==='canvas');
    const fallback=await probe();
    assert.equal(fallback.renderer,'canvas','the 2D fallback branch did not take over');
    assertValidPalette(fallback,'canvas fallback');
    assertMatrix(fallback.tokens,'canvas fallback');
    assertTextContrast(fallback.text,'canvas fallback');
    checks.push('two-dimensional fallback draws with the same token set as the WebGL layer');
  }finally{
    await page.evaluate(()=>{HTMLCanvasElement.prototype.getContext=window.__mcsOriginalGetContext;});
  }

  // 键盘焦点：:focus-visible 只认键盘来源的焦点，所以用真实的 Tab 键移开再移回来，
  // 程序化 focus() 在 Chromium 里不会点亮焦点圈。
  const toolbarButton=ui().locator('.mcs-canvas-toolbar button').first();
  await toolbarButton.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>{
    const normalize=value=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle='#000';ctx.fillStyle=value;return ctx.fillStyle;};
    const root=[...document.querySelectorAll('.mcs-app')].at(-1);
    const active=document.activeElement,css=getComputedStyle(active);
    const graphEl=root.querySelector('.mcs-graph');
    const camera=new DOMMatrix(graphEl.querySelector(':scope > g').style.transform);
    graphEl.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    return {
      inside:root.contains(active),tag:active.tagName,visible:active.matches(':focus-visible'),
      outline:normalize(css.outlineColor),width:css.outlineWidth,accent:normalize(css.getPropertyValue('--mcs-accent').trim()),
      graphTabIndex:graphEl.tabIndex,graphRole:graphEl.getAttribute('role'),cameraBefore:[camera.e,camera.f],
    };
  });
  assert.equal(focus.inside,true,`keyboard focus left the plugin view (${focus.tag})`);
  assert.equal(focus.visible,true,'keyboard focus must be visible on controls');
  assert.equal(focus.outline,focus.accent,`focus outline must use the brand accent (${focus.outline})`);
  assert.ok(parseFloat(focus.width)>=2,`focus outline too thin: ${focus.width}`);
  assert.equal(focus.graphTabIndex,0,'the graph must stay reachable by keyboard');
  await page.waitForTimeout(430);
  const moved=await graph().evaluate(el=>{const m=new DOMMatrix(el.querySelector(':scope > g').style.transform);return [m.e,m.f];});
  assert.notDeepEqual(moved,focus.cameraBefore,'arrow keys must pan the canvas');
  checks.push('keyboard focus uses the accent ring; arrow keys still pan the canvas');

  await page.emulateMedia({reducedMotion:'reduce'});
  await ui().getByRole('button',{name:'重排',exact:true}).click();
  await page.waitForTimeout(260);
  assert.equal(await graph().getAttribute('data-motion'),'idle','reduced motion must skip the layout animation');
  await page.emulateMedia({reducedMotion:'no-preference'});
  checks.push('reduced motion preference keeps the graph static');

  assert.deepEqual(errors.map(error=>error.split('\n')[0]),[]);
  const report={artifactSha256:await artifactIdentity(`${session.vault}/.obsidian/plugins/mcs-cognitive-space`),status:'passed',evidence:'FINITE',version,checkedAt:new Date().toISOString(),scenarios,checks,errors};
  for(const [name,from] of [['theme-light.png','runtime/theme-light-1440x960.png'],['theme-dark.png','runtime/theme-dark-1440x960.png'],['theme-narrow.png','runtime/theme-dark-520x760.png'],['theme-settings.png','runtime/theme-settings-dark.png'],['theme-empty-light.png','runtime/theme-empty-light.png'],['theme-empty-dark.png','runtime/theme-empty-dark.png']]){
    await mkdir('docs',{recursive:true});await cp(from,`docs/${name}`);
  }
  await writeFile('runtime/theme-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks.length,scenarios:report.scenarios.length,renderer:switched.renderer,details:report.checks},null,2));
}finally{await browser.close();}
