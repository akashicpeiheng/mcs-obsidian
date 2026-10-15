/**
 * 主窗口解析。
 *
 * Obsidian 1.14 会把「设置」渲染到独立窗口，插件也可能开出弹出页面，
 * 所以 `browser.contexts()[0].pages()[0]` 不再是主窗口。这里按库路径认人：
 * 只有能读到目标测试库 `app.vault` 的那个页面才是主窗口。
 * 找不到匹配时回落到第一个页面，让调用方按原样报错。
 */
export async function hostPage(browser,vault){
  const pages=[];
  for(const context of browser.contexts())for(const page of context.pages())pages.push(page);
  for(const page of pages){
    const base=await page.evaluate(()=>app?.vault?.adapter?.getBasePath?.()??null).catch(()=>null);
    if(base&&(!vault||base===vault))return page;
  }
  return pages[0]??null;
}
