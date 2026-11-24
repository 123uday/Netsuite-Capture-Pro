import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=['content/element-selector.js','content/element-content.js','image/image-cropper.js','image/image-stitcher.js','image/grid-stitcher.js'];
const sources=Object.fromEntries(await Promise.all(files.map(async path=>[`/${path}`,await readFile(resolve(root,path),'utf8')])));
const colors=['#df3942','#27ad68','#3b70d1','#e1af23'];
const requested=new Set(process.argv.slice(2));
const selected=kind=>!requested.size||requested.has(kind);
function fixture(kind){
  const wide=kind==='wide'||kind==='nested-wide';
  const nested=kind.startsWith('nested');
  const rows=Array.from({length:kind==='small'?3:kind==='tall'?9:6},(_,i)=>`<div class="row" style="background:${wide?`repeating-linear-gradient(to right,${colors.map((_,c)=>`${colors[(i+c)%4]} ${c*237}px ${(c+1)*237}px`).join(',')})`:colors[i%4]};${wide?'min-width:780px':''}">Row ${i}</div>`).join('');
  const content=kind==='virtual'?'<table aria-rowcount="100"><tr><td>One row</td></tr></table>':
    kind==='iframe'?'<iframe src="about:blank"></iframe>':
    nested?`<div style="height:32px">Section heading</div>${kind==='nested-deep'?'<div id="nested-outer" style="height:160px;overflow:auto">':''}<div id="nested" style="height:120px;overflow:auto">${rows}</div>${kind==='nested-deep'?'</div>':''}<div style="height:40px">Section footer</div>`:rows;
  return `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#f0fbff}.row{height:91px;color:white;padding:4px}#chosen{margin-left:60px;width:420px;border:2px solid black;${['scroll','wide'].includes(kind)?'height:200px;overflow:auto;':''}}#frame{margin-left:0;${kind==='ancestor'?'height:180px;overflow:auto;':''}}</style></head><body><div style="height:170px">Outside before selection</div><div id="frame"><section id="chosen">${content}</section></div><div style="height:400px">Outside after selection</div><script>window.actions=0</script></body></html>`;
}
const server=createServer((request,response)=>{
  response.setHeader('Content-Type',sources[request.url]?'text/javascript':'text/html');
  response.end(sources[request.url]||fixture(request.url.slice(1)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'netsuite-element-browser-'));
let browser,socket,send;
try{
  const executable=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  await access(executable);
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  let launchError;browser.on('error',error=>{launchError=error;});
  let port;
  for(let i=0;i<80&&!port;i++){if(launchError)throw launchError;try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  if(!port)throw new Error('Chrome debugging endpoint did not start.');
  const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log(`Browser: ${version.Browser}`);
  socket=new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);});
  send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>{pending.delete(next);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>send(method,params,sessionId);
  const evaluate=async expression=>{const result=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1.25,mobile:false});
  async function load(kind){
    await page('Page.navigate',{url:`${origin}/${kind}`});
    for(let i=0;i<40;i++){try{if(await evaluate(`location.pathname==='/${kind}'&&document.readyState==='complete'`))break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    await evaluate(sources['/content/element-selector.js']);
    await evaluate(sources['/content/element-content.js']);
  }
  const command=(type,extra={})=>evaluate(`__netSuiteElementCapture.command(${JSON.stringify({type,token:'element-browser',...extra})})`);
  async function select(kind){
    assert.equal((await command('select')).ok,true);
    assert.equal(await evaluate('document.querySelectorAll("[data-nscp-element-selector]").length'),1);
    const point=await evaluate('(()=>{const r=document.querySelector("#chosen").getBoundingClientRect();return{x:r.left+8,y:r.top+8}})()');
    await page('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    if(kind==='ancestor')await page('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    if(kind==='virtual')await page('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
    await page('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await page('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    assert.equal((await command('selection')).state,'selected');
    assert.equal(await evaluate('__netSuiteElementCapture.selector.target("element-browser").id'),'chosen');
    assert.equal(await evaluate('document.querySelectorAll("[data-nscp-element-selector]").length'),0);
  }
  const snapshot=()=>evaluate(`({x:scrollX,y:scrollY,styles:[...document.querySelectorAll('#chosen,#nested,#nested-outer,#frame')].map(n=>n.style.cssText),positions:[...document.querySelectorAll('#chosen,#nested,#nested-outer,#frame')].map(n=>[n.scrollLeft,n.scrollTop]),styleCount:document.querySelectorAll('style').length})`);
  let passed=0;
  for(const kind of ['small','tall','scroll','wide','nested','nested-deep','nested-wide','ancestor']){
    if(!selected(kind))continue;
    await load(kind);
    // Select first while the target is visible, then begin from saved offsets.
    await select(kind);
    await evaluate(`(()=>{scrollTo(0,35);const target=document.querySelector('#chosen');if('${kind}'==='scroll'||'${kind}'==='wide')target.scrollTo(40,63);const nested=document.querySelector('#nested');if(nested)nested.scrollTo(32,41)})()`);
    const before=await snapshot();
    let response=await command('begin',{horizontal:kind==='wide'||kind==='nested-wide'?'all':'visible'});
    assert.equal(response.ok,true,`${kind}: ${response.error}`);
    let metrics=response.metrics;
    assert.equal(metrics.totalHeight,kind==='small'?273:kind==='tall'?819:kind.startsWith('nested')?618:546);
    if(kind==='wide'||kind==='nested-wide')assert.ok(metrics.totalWidth>=780);
    else assert.ok(metrics.totalWidth<=420);
    await evaluate(`(async()=>{globalThis.elementImage=new(await import('/image/image-cropper.js')).ElementImageCropper()})()`);
    let rowHeight=metrics.clip.height;
    let count=0;
    while(true){
      assert.ok(++count<45,'element capture must make progress');
      const screenshot=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await evaluate(`elementImage.appendElement(${JSON.stringify(`data:image/png;base64,${screenshot.data}`)},${JSON.stringify(metrics)},${rowHeight})`);
      const moreX=metrics.horizontalOffset+metrics.clip.width<metrics.totalWidth-0.5;
      if(!moreX&&metrics.offset+rowHeight>=metrics.totalHeight-0.5)break;
      const x=moreX?metrics.horizontalOffset+metrics.clip.width-Math.min(96,Math.floor(metrics.clip.width/3)):0;
      const y=moreX?metrics.offset:metrics.offset+rowHeight-Math.min(96,Math.floor(rowHeight/3));
      response=await command('tile',{x,y});
      assert.equal(response.ok,true,`${kind}: ${response.error}`);
      if(y!==metrics.offset)rowHeight=response.metrics.clip.height;
      metrics=response.metrics;
    }
    const offset=kind.startsWith('nested')?32:0;
    const columns=kind==='wide'||kind==='nested-wide'?[100,500,700]:[100];
    const output=await evaluate(`(async()=>{const png=await elementImage.toPng();return{width:elementImage.canvas.width,height:elementImage.canvas.height,png:png.startsWith('data:image/png;base64,'),samples:Array.from({length:${kind==='small'?3:kind==='tall'?9:6}},(_,i)=>${JSON.stringify(columns)}.map(x=>Array.from(elementImage.context.getImageData(Math.round(x*elementImage.scale),Math.round((${offset}+i*91+60)*elementImage.scale),1,1).data).slice(0,3)))}})()`);
    assert.equal(output.width,Math.round(metrics.totalWidth*1.25));
    assert.equal(output.height,Math.round(metrics.totalHeight*1.25));
    assert.equal(output.png,true);
    for(let i=0;i<output.samples.length;i++)for(let c=0;c<columns.length;c++){
      const index=(i+(columns.length>1?Math.floor(columns[c]/237):0))%4;
      const expected=colors[index].slice(1).match(/../g).map(hex=>parseInt(hex,16));
      assert.deepEqual(output.samples[i][c],expected,`${kind}: selected row ${i}, column ${columns[c]}`);
    }
    assert.equal((await command('restore')).ok,true);
    assert.deepEqual(await snapshot(),before,`${kind}: all page state must be restored`);
    await evaluate('elementImage.dispose()');
    console.log(`PASS ${kind}: ${count} accurately cropped tiles, correct row/column pixels, nested/page state restored`);passed++;
  }
  for(const kind of ['virtual','iframe']){
    if(!selected(kind))continue;
    await load(kind);await select(kind);
    const result=await command('begin');
    assert.equal(result.ok,false);assert.match(result.error,kind==='virtual'?/virtualized/:/iframe/);
    assert.equal(await evaluate('document.querySelectorAll("[data-nscp-element-selector]").length'),0);
    console.log(`PASS ${kind}: explicit element limitation`);passed++;
  }
  if(selected('cancel')){
    await load('nested');await select('nested');const before=await snapshot();
    assert.equal((await command('begin')).ok,true);
    assert.equal((await command('tile',{x:0,y:200})).ok,true);
    await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.deepEqual(await snapshot(),before);
    assert.equal((await command('measure')).ok,false);
    console.log('PASS cancel: Escape restores expanded nested sections and all page state');passed++;
  }
  if(selected('selection-cancel')){
    await load('small');await command('select');
    await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal((await command('selection')).state,'cancelled');
    assert.equal(await evaluate('document.querySelectorAll("[data-nscp-element-selector]").length'),0);
    console.log('PASS selection-cancel: Escape removes selector');passed++;
  }
  if(selected('actions')){
    await load('small');
    await evaluate(`document.querySelector('#chosen').insertAdjacentHTML('afterbegin','<button id="record-action" onclick="window.actions++">Record action</button>')`);
    await command('select');
    const point=await evaluate('(()=>{const r=document.querySelector("#record-action").getBoundingClientRect();return{x:r.left+8,y:r.top+8}})()');
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
    assert.equal((await command('selection')).state,'selected');
    assert.equal(await evaluate('window.actions'),0);
    await command('restore');
    for(const type of ['mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
    assert.equal(await evaluate('window.actions'),1,'normal clicks must work after selector cleanup');
    console.log('PASS actions: selection click does not activate record button');passed++;
  }
  if(selected('visible-warning')){
    await load('wide');await select('wide');
    await evaluate('document.querySelector("#chosen").scrollLeft=999');
    const before=await snapshot();
    const result=await command('begin',{horizontal:'visible'});
    assert.equal(result.ok,true,result.error);
    assert.match(result.metrics.warnings[0],/Visible columns only/);
    assert.equal((await command('restore')).ok,true);
    assert.deepEqual(await snapshot(),before);
    console.log('PASS visible-warning: rightmost-only columns are reported and original horizontal scrolling is restored');passed++;
  }
  if(!passed)throw new Error('No requested element fixture matched.');
  console.log(`${passed} real Chrome element checks passed. Authenticated NetSuite acceptance remains manual.`);
}finally{
  if(send&&socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  browser?.kill();await new Promise(resolve=>server.close(resolve));
  if(dirname(resolve(profile))===resolve(tmpdir())&&basename(profile).startsWith('netsuite-element-browser-'))await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
