import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {captureElementRecord,ELEMENT_FILES} from '../capture/element-capture.js';

const request={tabId:7,windowId:3,mode:'element',format:'png',horizontal:'visible',overlap:96};
const metrics={offset:0,horizontalOffset:0,totalWidth:300,totalHeight:200,
  clip:{x:100,y:120,width:300,height:200},viewportWidth:800,viewportHeight:600,dpr:1,warnings:[]};
let commands,events,draws,captures;
beforeEach(()=>{
  commands=[];draws=[];captures=0;
  const event=()=>{const listeners=new Set();return{listeners,addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)};};
  events=[event(),event()];
  globalThis.chrome={
    tabs:{get:async()=>({active:true,windowId:3,url:'https://example.netsuite.com/record',status:'complete'}),
      onActivated:events[0],onUpdated:events[1],captureVisibleTab:async()=>{captures++;return 'data:image/png;base64,eA==';}},
    scripting:{executeScript:async options=>{
      if(options.files){assert.deepEqual(options.files,ELEMENT_FILES);return[{documentId:'element-document'}];}
      assert.deepEqual(options.target.documentIds,['element-document']);
      const command=options.args[0];commands.push(command.type);
      if(command.type==='selection')return[{result:{ok:true,state:'selected'}}];
      return[{result:{ok:true,metrics}}];
    }},
    downloads:{download:async options=>{commands.push('download');assert.match(options.url,/^data:image\/png;base64,/);return 77;}}
  };
  globalThis.createImageBitmap=async()=>({width:800,height:600,close(){}});
  globalThis.OffscreenCanvas=class{
    constructor(width,height){this.width=width;this.height=height;}
    getContext(){return{fillRect(){},drawImage:(...args)=>draws.push(args)};}
    async convertToBlob(){return new Blob(['png'],{type:'image/png'});}
  };
});

test('element path selects, crops precisely and restores before downloading',async()=>{
  assert.deepEqual(await captureElementRecord(request),{downloadId:77});
  assert.equal(captures,1);
  assert.deepEqual(draws[0].slice(1),[100,120,300,200,0,0,300,200]);
  assert.deepEqual(commands,['select','selection','begin','measure','tile','restore','download']);
  assert.ok(events.every(event=>event.listeners.size===0));
});
test('Escape during selection exports nothing and removes the selector',async()=>{
  const execute=chrome.scripting.executeScript;
  chrome.scripting.executeScript=async options=>options.args?.[0].type==='selection'?[{result:{ok:true,state:'cancelled',error:'Element selection cancelled.'}}]:execute(options);
  await assert.rejects(captureElementRecord(request),/cancelled/);
  assert.equal(commands.at(-1),'restore');assert.equal(captures,0);
});
test('popup cancellation while waiting for selection cleans up',async()=>{
  let cancelled=false;
  const execute=chrome.scripting.executeScript;
  chrome.scripting.executeScript=async options=>{
    if(options.args?.[0].type==='selection'){cancelled=true;return[{result:{ok:true,state:'waiting'}}];}
    return execute(options);
  };
  await assert.rejects(captureElementRecord(request,{isCancelled:()=>cancelled}),/cancelled/);
  assert.equal(commands.at(-1),'restore');assert.equal(captures,0);
});
test('capture failure restores selected element state and listeners',async()=>{
  chrome.tabs.captureVisibleTab=async()=>{throw new Error('Capture unavailable');};
  await assert.rejects(captureElementRecord(request),/Capture unavailable/);
  assert.equal(commands.at(-1),'restore');
  assert.ok(events.every(event=>event.listeners.size===0));
});
test('unsupported nested/virtualized content never exports an incomplete crop',async()=>{
  const execute=chrome.scripting.executeScript;
  chrome.scripting.executeScript=async options=>options.args?.[0].type==='begin'?[{result:{ok:false,error:'Virtualized content cannot be captured'}}]:execute(options);
  await assert.rejects(captureElementRecord(request),/Virtualized/);
  assert.equal(commands.at(-1),'restore');assert.equal(captures,0);
});
test('changing selected element dimensions during screenshot aborts',async()=>{
  const execute=chrome.scripting.executeScript;
  chrome.scripting.executeScript=async options=>options.args?.[0].type==='measure'?[{result:{ok:true,metrics:{...metrics,totalHeight:250}}}]:execute(options);
  await assert.rejects(captureElementRecord(request),/moved or changed/);
  assert.equal(commands.at(-1),'restore');
});
test('failed restoration prevents an element download',async()=>{
  const execute=chrome.scripting.executeScript;
  chrome.scripting.executeScript=async options=>{
    if(options.args?.[0].type==='restore')throw new Error('Document inaccessible');
    return execute(options);
  };
  await assert.rejects(captureElementRecord(request),/restoration failed/);
  assert.ok(!commands.includes('download'));
});
test('element request validation rejects unsupported messages before injection',async()=>{
  for(const changes of [{mode:'full'},{format:'pdf'},{tabId:-1},{horizontal:'invalid'},{overlap:1}]){
    await assert.rejects(captureElementRecord({...request,...changes}),/Invalid element capture/);
  }
  assert.equal(commands.length,0);
});

test('worker routes element requests separately and preserves visible screenshot dispatch',async()=>{
  let listener;
  chrome.runtime={id:'element-test',getURL:path=>`chrome-extension://element-test/${path}`,onMessage:{addListener:fn=>{listener=fn;}}};
  await import('../background/service-worker.js');
  const sender={id:chrome.runtime.id,url:chrome.runtime.getURL('popup/popup.html')};
  const element=await new Promise(resolve=>listener({...request,type:'START_CAPTURE'},sender,resolve));
  assert.equal(element.ok,true);assert.equal(element.downloadId,77);assert.ok(commands.includes('select'));
  commands.length=0;
  const visible=await new Promise(resolve=>listener({...request,mode:'visible',type:'START_CAPTURE'},sender,resolve));
  assert.equal(visible.ok,true);assert.deepEqual(commands,['download']);
});
