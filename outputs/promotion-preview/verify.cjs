const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/13278/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const htmlPath = path.join(root, '仿真通-宣传页.html');
const html = fs.readFileSync(htmlPath, 'utf8');
new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const errors = [];
const results = [];
const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(url);
    await page.locator('.phone-showcase').waitFor();
    assert.equal(await page.locator('.platform-access li').count(), 5);
    assert.equal(await page.locator('.brand-logo').first().evaluate(el => el.complete && el.naturalWidth > 0), true);
    assert.ok((await page.locator('.phone-showcase image').getAttribute('href')).startsWith('data:image/png;base64,'));
    await page.screenshot({ path: path.join(__dirname, 'desktop.png') });
    await page.screenshot({ path: path.join(__dirname, 'desktop-full.png'), fullPage: true });
    await page.locator('#platform-data').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => dataRevealed && document.getAnimations().length === 0 && document.querySelector('[data-counter="12860"]').textContent === '12,860');
    await page.locator('#platform-data').screenshot({ path: path.join(__dirname, 'platform-data.png') });
    assert.equal(await page.locator('#chart-data-table tbody tr').count(), 6);
    assert.match(await page.locator('#chart-data-table tbody tr').last().textContent(), /386,400/);
    await page.locator('[data-metric=demands]').click();
    assert.equal(await page.locator('#chart-title').textContent(), '更多需求，更多合作机会');
    assert.match(await page.locator('#chart-data-table tbody tr').last().textContent(), /1,286/);
    await page.locator('[data-period="12"]').click();
    assert.equal(await page.locator('#chart-data-table tbody tr').count(), 12);
    await page.locator('.chart-hit').last().focus();
    assert.equal(await page.locator('#chart-tooltip').isVisible(), true);
    assert.match(await page.locator('#chart-tooltip').textContent(), /1,286/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#chart-tooltip').isVisible(), false);
    await page.locator('[data-metric=deliveries]').click();
    assert.match(await page.locator('#chart-data-table tbody tr').last().textContent(), /1,048/);
    assert.equal(await page.locator('#demand-donut circle').count(), 6);
    assert.match(await page.locator('.data-footnote').textContent(), /演示数据/);
    results.push('品牌图标、内嵌双手机图、五个平台标识、数字动画、三种趋势指标、6/12个月切换、键盘图表提示和领域分布通过');
    for (let i = 0; i < 4; i++) {
      await page.locator(`[data-step="${i}"]`).click();
      assert.equal(await page.locator(`[data-step="${i}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.demo-progress .done').count(), i + 1);
    }
    await page.getByRole('button', { name: '准备仿真需求', exact: true }).click();
    assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
    await page.locator('[name=project]').fill('测试支架强度校核');
    await page.locator('[name=goal]').fill('核对额定载荷下应力与变形，交付分析报告。');
    await page.locator('[name=software]').fill('ANSYS');
    await page.getByRole('button', { name: '复制需求清单', exact: true }).click();
    assert.match(await page.locator('#form-feedback').textContent(), /已复制/);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /测试支架强度校核/);
    assert.match(clipboard, /ANSYS/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载为文本', exact: true }).click()]);
    const downloadPath = path.join(__dirname, '需求清单-验证.txt');
    await download.saveAs(downloadPath);
    assert.match(fs.readFileSync(downloadPath, 'utf8'), /核对额定载荷下应力与变形/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '准备仿真需求');
    await page.getByRole('button', { name: '查看工程师入驻指南', exact: true }).click();
    assert.equal(await page.locator('#customer-entry').isVisible(), false);
    assert.equal(await page.locator('#engineer-entry').isVisible(), true);
    const [guide] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载入驻清单', exact: true }).click()]);
    assert.equal(guide.suggestedFilename(), '仿真通工程师入驻清单.txt');
    await page.keyboard.press('Escape');
    const faq = page.locator('.faq details').nth(1);
    await faq.locator('summary').click();
    assert.equal(await faq.getAttribute('open'), '');
    results.push('四阶段流程、FAQ、复制清单、文本下载、工程师指南、Escape关闭与焦点恢复通过');
    await page.locator('[data-metric=visits]').click();
    await page.locator('[data-period="6"]').click();
    await page.locator('[data-step="0"]').click();
    await page.evaluate(async () => await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(__dirname, 'desktop-full.png'), fullPage: true });
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll('main *,header *,footer *')].filter(el => {
          const bounds = el.getBoundingClientRect();
          const css = getComputedStyle(el);
          return bounds.width > 0 && css.position !== 'absolute' && (bounds.right > width + 1 || bounds.left < -1);
        }).map(el => `${el.tagName}.${el.className}`);
      });
      assert.deepEqual(overflow, [], `Overflow at ${width}px: ${overflow.join(', ')}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal scroll at ${width}px`);
      if (width === 390) {
        await page.screenshot({ path: path.join(__dirname, 'mobile.png') });
        await page.screenshot({ path: path.join(__dirname, 'mobile-full.png'), fullPage: true });
        await page.locator('#platform-data').screenshot({ path: path.join(__dirname, 'mobile-data.png') });
        await page.getByRole('button', { name: '展开导航', exact: true }).click();
        assert.equal(await page.locator('.nav').isVisible(), true);
        await page.locator('.nav').getByText('仿真领域', { exact: true }).click();
        assert.equal(await page.locator('.nav').isVisible(), false);
        await page.getByRole('button', { name: '准备仿真需求', exact: true }).click();
        await page.screenshot({ path: path.join(__dirname, 'mobile-form.png') });
        assert.ok(await page.locator('dialog').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
        await page.keyboard.press('Escape');
      }
      if (width === 320) {
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        await page.screenshot({ path: path.join(__dirname, 'mobile-320.png') });
      }
      results.push(`${width}px 布局无横向溢出`);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    assert.equal(requests.filter(request => !request.startsWith(url)).length, 0, 'Unexpected external requests');
    const offline = await context.newPage();
    offline.on('pageerror', error => errors.push(error.message));
    await offline.goto(require('node:url').pathToFileURL(htmlPath).href);
    await offline.locator('[data-metric=demands]').click();
    assert.equal(await offline.locator('#chart-title').textContent(), '更多需求，更多合作机会');
    await offline.getByRole('button', { name: '准备仿真需求', exact: true }).click();
    assert.equal(await offline.locator('dialog').evaluate(el => el.open), true);
    assert.deepEqual(errors, []);
    results.push('file:// 直接打开、减少动态效果、零外部请求、零浏览器错误通过');
    fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
