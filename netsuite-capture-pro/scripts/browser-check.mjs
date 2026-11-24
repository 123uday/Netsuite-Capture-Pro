// Real Chrome DOM/Canvas checks on local fixtures. No NetSuite login required.
// The Chrome extension API calls are covered separately by unit tests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = Object.fromEntries(await Promise.all([
  'content/scroll-detector.js', 'content/scrollbar-cleanup.js', 'content/content.js', 'image/image-stitcher.js', 'image/grid-stitcher.js'
].map(async (path) => [`/${path}`, await readFile(resolve(root, path), 'utf8')])));
const colors = ['#df3942', '#27ad68', '#3b70d1', '#e1af23'];
const requested = new Set(process.argv.slice(2));
const selected = (kind) => !requested.size || requested.has(kind);
let passed = 0;
function fixture(kind) {
  const internal = ['internal', 'wide-internal', 'wide-fractional-internal', 'fractional-internal'].includes(kind);
  const wide = kind.startsWith('wide-');
  const rows = Array.from({ length: 18 }, (_, index) => {
    const background = wide ? `repeating-linear-gradient(to right,${Array.from({length:4},(_,column)=>`${colors[(index+column)%4]} ${column*237}px ${(column+1)*237}px`).join(',')})` : colors[index % 4];
    const frozen = kind === 'wide-sticky' ? '<span style="display:inline-block;position:sticky;left:0;width:80px;height:100px;background:#000">Pinned</span>' : '';
    return `<div class="row" style="background:${background};${wide ? 'min-width:1600px' : ''}">${frozen}Row ${index}</div>`;
  }).join('');
  const extra = kind === 'nested' ? '<div style="height:100px;overflow:auto"><div style="height:500px">Nested rows</div></div>' :
    kind === 'virtual' ? '<table aria-rowcount="100"><tr><td>Only one mounted row</td></tr></table>' :
    kind === 'virtual-columns' ? '<table aria-colcount="100"><tr><td>Only one mounted column</td></tr></table>' :
    kind === 'iframe' ? '<iframe src="about:blank"></iframe>' :
    kind === 'horizontal' ? '<div style="width:100px;overflow:auto"><div style="width:500px">Hidden columns</div></div>' :
    kind === 'horizontal-minor' ? '<div style="width:100px;overflow:auto"><div style="width:103px">Label</div></div>' :
    kind === 'horizontal-nav' ? '<nav style="width:100px;overflow:auto"><div style="width:500px">Navigation overflow</div></nav>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0} .row{height:137px;color:white;padding:8px}
    ${internal ? `body{height:100vh;overflow:hidden} nav{height:${kind.includes('fractional-internal') ? 14 : 80}px} main{height:calc(100vh - ${kind.includes('fractional-internal') ? 14 : 80}px);overflow:auto}` : ''}
    ${kind === 'sticky' ? 'nav{position:sticky;top:0;height:40px;background:#333;color:white}' : ''}
    ${kind === 'horizontal-root' ? 'main{min-width:1200px}' : ''}
    </style></head><body>${internal || kind === 'sticky' ? '<nav>Record navigation</nav>' : ''}
    <main>${extra}${kind === 'wide-sublist' ? '<div class="sublist" style="width:100%;overflow:auto">' : ''}${rows}${kind === 'wide-sublist' ? '</div>' : ''}</main>
    ${kind.startsWith('floating-scrollbar') ? `<script>function moveTrack(){let track=document.querySelector('#floating-track');if(!track&&('${kind}'==='floating-scrollbar'||scrollY>300)){track=document.createElement('div');track.id='floating-track';track.style.cssText='position:absolute;left:0;width:100%;height:18px;overflow-x:scroll;overflow-y:hidden;z-index:999;background:#ff00ff';track.innerHTML='<div style="width:1600px;height:1px"></div>';document.body.append(track)}if(track)track.style.top=(scrollY+innerHeight-18)+'px'}addEventListener('scroll',moveTrack);moveTrack()</script>` : ''}
    ${kind === 'growth' ? `<script>let grown=false;addEventListener('scroll',()=>{if(!grown&&scrollY>300){grown=true;setTimeout(()=>{const row=document.createElement('div');row.className='row';row.style.background='#df3942';document.querySelector('main').append(row)},200)}},{passive:true})</script>` : ''}
    </body></html>`;
}
const server = createServer((request, response) => {
  if (sources[request.url]) { response.setHeader('Content-Type', 'text/javascript'); response.end(sources[request.url]); }
  else { response.setHeader('Content-Type', 'text/html'); response.end(fixture(request.url.slice(1))); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'netsuite-capture-browser-'));
let browser;
let socket;
let send;
try {
  const executable = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  await access(executable);
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  let launchError;
  browser.on('error', (error) => { launchError = error; });
  let port;
  for (let attempt = 0; attempt < 80 && !port; attempt++) {
    if (launchError) throw launchError;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  async function checkWide() {
    for (const kind of ['wide-document', 'wide-internal', 'wide-fractional-internal', 'wide-sublist', 'wide-sticky']) {
    if (!selected(kind)) continue;
    await load(kind);
    const original = await evaluate(`(()=>{scrollTo(0,123);const main=document.querySelector('main');if('${kind}'==='wide-internal') main.scrollTo(80,123);const sub=document.querySelector('.sublist');if(sub)sub.scrollLeft=127;return {x:scrollX,y:scrollY,mainX:main.scrollLeft,mainY:main.scrollTop,subX:sub?.scrollLeft,styles:[...document.querySelectorAll('html,body,main,.sublist')].map(el=>el.style.cssText)}})()`);
    let result = await command('begin', { horizontal: 'all' });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.metrics.totalWidth >= 1600);
    assert.deepEqual(result.metrics.warnings, []);
    await evaluate(`(async()=>{globalThis.stitcher=new(await import('/image/grid-stitcher.js')).GridStitcher()})()`);
    let metrics = result.metrics;
    let count = 0;
    while (true) {
      assert.ok(++count < 35);
      const screenshot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await evaluate(`stitcher.append(${JSON.stringify(`data:image/png;base64,${screenshot.data}`)},${JSON.stringify(metrics)})`);
      const moreColumns = metrics.horizontalOffset + metrics.clip.width < metrics.totalWidth - 0.5;
      if (!moreColumns && metrics.offset + metrics.clip.height >= metrics.totalHeight - 0.5) break;
      const left = moreColumns ? Math.min(metrics.totalWidth - metrics.clip.width, metrics.horizontalOffset + metrics.clip.width - 96) : 0;
      const offset = moreColumns ? metrics.offset : Math.min(metrics.totalHeight - metrics.clip.height, metrics.offset + metrics.clip.height - 96);
      result = await command('scroll', { offset, left, hideHeaders: offset > 0 });
      assert.equal(result.ok, true, result.error);
      metrics = result.metrics;
    }
    const output = await evaluate(`(async()=>{const png=await stitcher.toPng();return {width:stitcher.canvas.width,height:stitcher.canvas.height,png:png.startsWith('data:image/png;base64,'),samples:Array.from({length:18},(_,i)=>[100,650,730,1000,1500].map(x=>Array.from(stitcher.context.getImageData(Math.round(x*stitcher.scale),Math.round((i*137+70)*stitcher.scale),1,1).data).slice(0,3)))}})()`);
    assert.equal(output.width, Math.round(metrics.totalWidth * 1.25));
    assert.equal(output.height, Math.round(metrics.totalHeight * 1.25));
    assert.equal(output.png, true);
    for (let index = 0; index < 18; index++) {
      for (const [column, x] of [100,650,730,1000,1500].entries()) {
        const expected = colors[(index + Math.floor((x % 948) / 237)) % 4].slice(1).match(/../g).map(hex=>parseInt(hex,16));
        assert.deepEqual(output.samples[index][column], expected, `${kind}: row ${index}, x ${x}`);
      }
    }
    assert.equal((await command('restore')).ok, true);
    const restored = await evaluate(`(()=>{const main=document.querySelector('main');const sub=document.querySelector('.sublist');return {x:scrollX,y:scrollY,mainX:main.scrollLeft,mainY:main.scrollTop,subX:sub?.scrollLeft,styles:[...document.querySelectorAll('html,body,main,.sublist')].map(el=>el.style.cssText)}})()`);
    assert.deepEqual(restored, original);
    await evaluate('stitcher.dispose()');
    console.log(`PASS ${kind}: ${count} tiles, all column/row pixels correct, original widths and both scroll axes restored`);
    passed++;
  }
    }
  if (!port) throw new Error('Chrome did not start its local debugging endpoint.');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log(`Browser: ${version.Browser}`);
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
  send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1.25, mobile: false });
  async function load(kind) {
    await page('Page.navigate', { url: `${origin}/${kind}` });
    for (let i = 0; i < 40; i++) {
      try { if (await evaluate(`location.pathname === '/${kind}' && document.readyState === 'complete'`)) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await evaluate(sources['/content/scroll-detector.js']);
    await evaluate(sources['/content/scrollbar-cleanup.js']);
    await evaluate(sources['/content/content.js']);
  }
  const command = (type, extra = {}) => evaluate(`__netSuiteCapturePro.command(${JSON.stringify({ type, token: 'browser-check', ...extra })})`);
  await checkWide();
  if (selected('wide-cancel')) {
    await load('wide-sublist');
    const before = await evaluate(`(()=>{scrollTo(0,123);document.querySelector('.sublist').scrollLeft=127;return {x:scrollX,y:scrollY,left:document.querySelector('.sublist').scrollLeft,styles:[...document.querySelectorAll('html,body,main,.sublist')].map(el=>el.style.cssText)}})()`);
    assert.equal((await command('begin', { horizontal: 'all' })).ok, true);
    assert.equal((await command('scroll', { offset: 500, left: 500, hideHeaders: true })).ok, true);
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.deepEqual(await evaluate(`({x:scrollX,y:scrollY,left:document.querySelector('.sublist').scrollLeft,styles:[...document.querySelectorAll('html,body,main,.sublist')].map(el=>el.style.cssText)})`), before);
    console.log('PASS wide-cancel: Escape restores widened sublist styles and both scroll axes');
    passed++;
  }

  for (const kind of ['document', 'internal', 'fractional-internal', 'sticky', 'growth', 'floating-scrollbar', 'floating-scrollbar-late']) {
    if (!selected(kind)) continue;
    await load(kind);
    await evaluate(kind.endsWith('internal') ? 'document.querySelector("main").scrollTop=123' : 'scrollTo(0,123)');
    const before = await evaluate('[scrollX,scrollY,document.querySelector("main").scrollTop]');
    let result = await command('begin');
    assert.equal(result.ok, true, result.error);
    assert.equal(result.metrics.kind, kind.endsWith('internal') ? 'internal container' : 'document');
    await evaluate(`(async()=>{globalThis.stitcher = new (await import('/image/image-stitcher.js')).ImageStitcher()})()`);
    let metrics = result.metrics;
    let count = 0;
    let total;
    while (true) {
      assert.ok(++count < 20);
      const screenshot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await evaluate(`stitcher.append(${JSON.stringify(`data:image/png;base64,${screenshot.data}`)},${JSON.stringify(metrics)})`);
      total = metrics.totalHeight;
      if (metrics.offset + metrics.clip.height >= metrics.totalHeight - 0.5) break;
      const offset = Math.min(metrics.totalHeight - metrics.clip.height, metrics.offset + metrics.clip.height - 96);
      result = await command('scroll', { offset, hideHeaders: true });
      assert.equal(result.ok, true, result.error);
      metrics = result.metrics;
    }
    const output = await evaluate(`(async()=>{const png=await stitcher.toPng();return {width:stitcher.canvas.width,height:stitcher.canvas.height,png:png.startsWith('data:image/png;base64,'),samples:Array.from({length:18},(_,i)=>Array.from(stitcher.context.getImageData(250,Math.round((i*137+70+${kind === 'sticky' ? 40 : 0})*stitcher.scale),1,1).data).slice(0,3))}})()`);
    assert.equal(output.height, Math.round(total * 1.25));
    assert.equal(output.png, true);
    for (let index = 0; index < 18; index++) {
      const expected = colors[index % 4].slice(1).match(/../g).map((hex) => parseInt(hex, 16));
      assert.deepEqual(output.samples[index], expected, `${kind}: row ${index} pixels must match without overlap/holes`);
    }
    if (kind.startsWith('floating-scrollbar')) {
      const mismatches = await evaluate(`(()=>{const pixels=stitcher.context.getImageData(250,0,1,stitcher.canvas.height).data;const colors=${JSON.stringify(colors)}.map(c=>c.slice(1).match(/../g).map(h=>parseInt(h,16)));let bad=0;for(let y=0;y<stitcher.canvas.height;y++){const cssY=y/stitcher.scale;const within=cssY%137;if(within<30||within>130)continue;const expected=colors[Math.floor(cssY/137)%4];if(expected.some((v,c)=>Math.abs(pixels[y*4+c]-v)>2))bad++}return bad})()`);
      assert.equal(mismatches, 0, 'floating scrollbar bands must not overwrite any row pixels');
    }
    assert.equal((await command('restore')).ok, true);
    if (kind.startsWith('floating-scrollbar')) assert.equal(await evaluate('document.querySelector("#floating-track").style.visibility'), '');
    assert.deepEqual(await evaluate('[scrollX,scrollY,document.querySelector("main").scrollTop]'), before);
    assert.equal(await evaluate('document.querySelectorAll("nav[style*=hidden]").length'), 0);
    await evaluate('stitcher.dispose()');
    if (kind === 'growth') assert.equal(total, 19 * 137);
    console.log(`PASS ${kind}: ${count} frames, correct pixel colors, PNG encoding and scroll/style restoration`);
    passed++;
  }
  for (const [kind, expected] of [['nested', 'nested scrollable'], ['virtual', 'virtualized'], ['virtual-columns', 'virtualized'], ['iframe', 'iframe']]) {
    if (!selected(kind)) continue;
    await load(kind);
    const result = await command('begin');
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(expected, 'i'));
    console.log(`PASS ${kind}: explicit limitation reported`);
    passed++;
  }
  for (const kind of ['horizontal', 'horizontal-root', 'horizontal-minor', 'horizontal-nav']) {
    if (!selected(kind)) continue;
    await load(kind);
    await evaluate('scrollTo(0,123)');
    const original = await evaluate('[scrollX,scrollY]');
    const result = await command('begin');
    assert.equal(result.ok, true, result.error);
    const expectedWarning = kind === 'horizontal' || kind === 'horizontal-root';
    assert.equal(result.metrics.warnings.length > 0, expectedWarning);
    if (expectedWarning) assert.match(result.metrics.warnings[0], /Visible columns only/);
    const scrolled = await command('scroll', { offset: 500, hideHeaders: true });
    assert.equal(scrolled.ok, true, scrolled.error);
    assert.ok(scrolled.metrics.offset >= 499);
    assert.equal((await command('restore')).ok, true);
    assert.deepEqual(await evaluate('[scrollX,scrollY]'), original);
    console.log(`PASS ${kind}: vertical capture proceeds, ${expectedWarning ? 'visible-columns warning reported' : 'harmless overflow ignored'}, scroll restored`);
    passed++;
  }
  if (selected('escape')) {
  await load('document');
  await evaluate('scrollTo(0,137)');
  assert.equal((await command('begin')).ok, true);
  assert.equal((await command('scroll', { offset: 500, hideHeaders: true })).ok, true);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('scrollY'), 137);
  const cancelled = await command('measure');
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.error, /cancelled/);
  console.log('PASS Escape: cancellation restores original scrolling and ends session');
  passed++;
  }
  if (!passed) throw new Error('No fixture cases matched the requested names.');
  console.log(`${passed} real Chrome fixture checks passed. Authenticated NetSuite and extension API acceptance remain manual.`);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch {}
    socket.close();
  }
  browser?.kill();
  await new Promise((resolve) => server.close(resolve));
  // Only remove the verified, uniquely created test profile inside the temp dir.
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('netsuite-capture-browser-')) {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
