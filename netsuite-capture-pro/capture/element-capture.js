import { captureViewport, validateTarget } from './viewport-capture.js';
import { ElementImageCropper } from '../image/image-cropper.js';
import { checkedDimensions } from '../image/image-stitcher.js';
import { exportPng } from '../export/png-exporter.js';

export const ELEMENT_FILES=['content/element-selector.js','content/element-content.js'];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function sameElementFrame(before,after) {
  return ['offset','horizontalOffset','totalWidth','totalHeight','viewportWidth','viewportHeight','dpr'].every(key=>before[key]===after[key]) &&
    ['x','y','width','height'].every(key=>Math.abs(before.clip[key]-after.clip[key])<0.5);
}

export async function captureElementRecord(message,{onProgress=()=>{},onWarning=()=>{},isCancelled=()=>false}={}) {
  if (message.mode!=='element' || message.format!=='png' || !Number.isInteger(message.tabId) || message.tabId<0 ||
      !Number.isInteger(message.windowId)||message.windowId<0 || !['visible','all'].includes(message.horizontal??'visible') ||
      !Number.isInteger(message.overlap??96) || (message.overlap??96)<32 || (message.overlap??96)>300) {
    throw new Error('Invalid element capture request. Choose PNG and a valid column option.');
  }
  const {tabId,windowId}=message;
  const tab=await validateTarget(tabId,windowId);
  const token=crypto.randomUUID();
  const cropper=new ElementImageCropper();
  const started=Date.now();
  let documentId;
  let targetChanged=false;
  let originalError;
  let lastShot=0;
  const warnings=[];
  const onActivated=info=>{if(info.windowId===windowId&&info.tabId!==tabId)targetChanged=true;};
  const onUpdated=(id,change)=>{if(id===tabId&&(change.url||change.status==='loading'))targetChanged=true;};
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  const assertRunning=()=>{
    if(isCancelled())throw new Error('Element capture cancelled.');
    if(targetChanged)throw new Error('The selected tab or record changed during element capture.');
    if(Date.now()-started>480000)throw new Error('Element capture exceeded eight minutes. Select a smaller section.');
  };
  const command=async(type,extras={})=>{
    const results=await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},
      func:request=>globalThis.__netSuiteElementCapture.command(request),args:[{type,token,...extras}]});
    const result=results[0]?.result;
    if(!result?.ok)throw new Error(result?.error||'The element capture controller did not respond.');
    return result;
  };
  const report=metrics=>{
    for(const warning of metrics.warnings||[])if(!warnings.includes(warning)){warnings.push(warning);onWarning(warning);}
    checkedDimensions(Math.round(metrics.totalWidth*metrics.dpr),Math.round(metrics.totalHeight*metrics.dpr));
  };
  let dataUrl;
  try {
    const injection=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:ELEMENT_FILES});
    documentId=injection[0]?.documentId;
    if(!documentId)throw new Error('Chrome could not identify the element capture document.');
    await validateTarget(tabId,windowId,tab.url);
    assertRunning();
    onProgress('Select a section on the page. Click to confirm; ↑ selects its parent; Escape cancels.');
    await command('select');
    while(true){
      assertRunning();
      const selection=await command('selection');
      if(selection.state==='cancelled')throw new Error(selection.error||'Element selection cancelled.');
      if(selection.state==='selected')break;
      await pause(400);
    }
    assertRunning();
    let metrics=(await command('begin',{horizontal:message.horizontal??'visible'})).metrics;
    const width=metrics.totalWidth;
    let rowHeight=metrics.clip.height;
    for(let tile=0;tile<500;tile++){
      assertRunning();
      await validateTarget(tabId,windowId,tab.url);
      report(metrics);
      if(metrics.totalWidth!==width)throw new Error('The selected section changed width during capture. Retry when loading is complete.');
      await pause(Math.max(0,550-(Date.now()-lastShot)));
      assertRunning();
      lastShot=Date.now();
      const pixels=await captureViewport(tabId,windowId);
      const measured=(await command('measure')).metrics;
      if(!sameElementFrame(metrics,measured))throw new Error('The selected section moved or changed during its screenshot. Retry when it is stable.');
      assertRunning();
      await cropper.appendElement(pixels,metrics,rowHeight);
      onProgress(`Captured selected section tile ${tile+1}. Escape on the page cancels.`);
      let x=0;
      let y=metrics.offset;
      const overlapX=Math.min(message.overlap??96,Math.floor(metrics.clip.width/3));
      const overlapY=Math.min(message.overlap??96,Math.floor(rowHeight/3));
      if(metrics.horizontalOffset+metrics.clip.width<metrics.totalWidth-0.5){
        x=metrics.horizontalOffset+Math.max(1,metrics.clip.width-overlapX);
      }else if(metrics.offset+rowHeight>=metrics.totalHeight-0.5){
        const final=(await command('tile',{x:metrics.horizontalOffset,y:metrics.offset})).metrics;
        if(!sameElementFrame(metrics,final))throw new Error('The selected section changed at the end of capture. Retry when it is stable.');
        assertRunning();
        onProgress('Encoding selected section PNG…');
        dataUrl=await cropper.toPng();
        break;
      }else{
        y=metrics.offset+Math.max(1,rowHeight-overlapY);
      }
      const next=(await command('tile',{x,y})).metrics;
      if(next.totalHeight<metrics.totalHeight)throw new Error('The selected section shrank during capture.');
      if(y!==metrics.offset)rowHeight=next.clip.height;
      else if(next.clip.height+0.5<rowHeight)throw new Error('The selected section height changed between columns.');
      metrics=next;
    }
    if(!dataUrl)throw new Error('The selected section exceeds the 500-tile capture limit.');
  }catch(error){originalError=error;throw error;}
  finally{
    try{if(documentId)await command('restore');}
    catch(error){if(!originalError)throw new Error(`Element page restoration failed: ${error.message}`);}
    finally{
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      cropper.dispose();
    }
  }
  assertRunning();
  const downloadId=await exportPng(dataUrl,{visibleColumnsOnly:warnings.length>0});
  return warnings.length?{downloadId,warnings}:{downloadId};
}
