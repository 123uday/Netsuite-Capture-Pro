// Dedicated Phase 3 controller. Does not install or modify Phase 2 controllers.
(() => {
  const api = globalThis.__netSuiteElementCapture;
  if (api.command) return;
  let session;
  let lastError = 'Element capture has ended.';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clipped = (value) => /^(auto|scroll|hidden|clip)$/.test(value);
  const visible = (node) => { const rect = node.getBoundingClientRect(); const style=getComputedStyle(node); return rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden'; };

  function remember(current, node) {
    if (!current.positions.has(node)) current.positions.set(node, { x:node.scrollLeft, y:node.scrollTop });
  }
  function change(current, node, property, value) {
    let saved=current.styles.get(node);
    if (!saved) { saved=new Map(); current.styles.set(node,saved); }
    if (!saved.has(property)) saved.set(property, { value:node.style.getPropertyValue(property), priority:node.style.getPropertyPriority(property) });
    node.style.setProperty(property,value,'important');
  }
  function restore(token, reason) {
    if (session && session.token !== token) return;
    const current=session;
    session=undefined;
    if (reason) lastError=reason;
    try {
      if (current) {
        clearTimeout(current.watchdog);
        current.observer?.disconnect();
        for (const [name,listener] of current.listeners) window.removeEventListener(name,listener,true);
        current.scrollbars.remove();
        for (const [node,properties] of [...current.styles].reverse()) {
          for (const [property,saved] of properties) {
            if (saved.value) node.style.setProperty(property,saved.value,saved.priority);
            else node.style.removeProperty(property);
          }
        }
        for (const [node,pos] of current.positions) node.scrollTo({ left:pos.x, top:pos.y, behavior:'instant' });
        window.scrollTo({ left:current.windowX, top:current.windowY, behavior:'instant' });
      }
    } finally {
      current?.rules.remove();
      api.selector.clear(token);
    }
  }
  function heartbeat(current) {
    clearTimeout(current.watchdog);
    current.watchdog=setTimeout(()=>restore(current.token,'Element capture stopped responding; page state was restored.'),20000);
  }
  function assertCurrent(current) {
    if (session!==current) throw new Error(lastError);
    if (!current.target.isConnected) throw new Error('The selected element was replaced during capture.');
    if (innerWidth!==current.viewportWidth || innerHeight!==current.viewportHeight || devicePixelRatio!==current.dpr) throw new Error('Browser size or zoom changed during element capture.');
    if (current.removedRows) throw new Error('Rows were removed while capturing. A virtualized or changing table cannot be captured completely.');
  }
  function inspect(target) {
    const nodes=[target,...target.querySelectorAll('*')];
    if (nodes.length>30000) throw new Error('The selected section contains too many DOM elements.');
    for (const node of nodes) {
      if (!visible(node)) continue;
      if (node.tagName==='IFRAME') throw new Error('Element capture inside a visible iframe is not supported.');
      const style=getComputedStyle(node);
      if (style.transform!=='none' || style.zoom && !['1','normal'].includes(style.zoom)) throw new Error('Transformed selected content cannot be cropped reliably.');
      const name=typeof node.className==='string'?node.className:'';
      const rows=Number(node.getAttribute('aria-rowcount'));
      const columns=Number(node.getAttribute('aria-colcount'));
      const mounted=[...node.querySelectorAll('tr,[role="row"]')];
      const count=Math.max(0,...mounted.map(row=>[...row.querySelectorAll('td,th,[role="cell"],[role="gridcell"],[role="columnheader"]')].reduce((sum,cell)=>sum+(Number(cell.getAttribute('colspan')||cell.getAttribute('aria-colspan'))||1),0)));
      if (node.hasAttribute('data-virtualized') || /react-virtual|react-window|virtualized|ag-body-viewport/i.test(name) ||
          rows>mounted.length || columns>count || rows===-1 || columns===-1) {
        throw new Error('The selected section contains a virtualized table. All rows and columns must exist in the DOM for complete element capture.');
      }
    }
    return nodes;
  }
  function expandNested(current, nodes) {
    for (const node of nodes) remember(current,node);
    for (const node of nodes.slice(1).reverse()) {
      const style=getComputedStyle(node);
      const growY=clipped(style.overflowY) && node.scrollHeight>node.clientHeight+2;
      const growX=current.horizontal==='all' && clipped(style.overflowX) && node.scrollWidth>node.clientWidth+2;
      if (!growY&&!growX) continue;
      // Expand the nested scroller and any clipping ancestors inside selection.
      for (let parent=node; parent && parent!==current.target; parent=parent.parentElement) {
        const computed=getComputedStyle(parent);
        if (growY && (parent===node || clipped(computed.overflowY)) && parent.scrollHeight>parent.clientHeight+2) {
          const height=parent.scrollHeight+parent.offsetHeight-parent.clientHeight;
          change(current,parent,'box-sizing','border-box');
          change(current,parent,'height',`${height}px`);
          change(current,parent,'min-height',`${height}px`);
          change(current,parent,'max-height','none');
        }
        if (growX && (parent===node || clipped(computed.overflowX)) && parent.scrollWidth>parent.clientWidth+2) {
          const width=parent.scrollWidth+parent.offsetWidth-parent.clientWidth;
          change(current,parent,'box-sizing','border-box');
          change(current,parent,'width',`${width}px`);
          change(current,parent,'min-width',`${width}px`);
          change(current,parent,'max-width','none');
        }
      }
    }
  }
  function hideOverlays(current, y=0, x=0) {
    for (const node of document.querySelectorAll('*')) {
      if (node===current.target || node.contains(current.target) || !visible(node)) continue;
      const style=getComputedStyle(node);
      const rect=node.getBoundingClientRect();
      const inside=current.target.contains(node);
      const pinnedTop=style.top!=='auto' && rect.top<=Math.max(0,current.target.getBoundingClientRect().top)+(parseFloat(style.top)||0)+1;
      const pinnedLeft=style.left!=='auto' && rect.left<=Math.max(0,current.target.getBoundingClientRect().left)+(parseFloat(style.left)||0)+1;
      const thin=rect.height<=40 && rect.width>=120 && !node.textContent.trim() &&
        !node.matches('table,tr,td,th,input,textarea,select') && !node.querySelector('table,tr,td,th,input,textarea,select,img,canvas') &&
        (node.scrollWidth>node.clientWidth+8 && /auto|scroll/.test(style.overflowX) || /scrollbar|hscroll|scroll-track/i.test(`${node.id} ${typeof node.className==='string'?node.className:''}`));
      if (thin || style.position==='fixed' || style.position==='sticky' && (!inside || y>0&&pinnedTop || x>0&&pinnedLeft)) {
        // Sticky column visibility is reset before each tile; original styles
        // stay in the restoration map so later vertical strips retain columns.
        change(current,node,'visibility','hidden');
        current.overlays.add(node);
      }
    }
  }
  function unhideOverlays(current) {
    for (const node of current.overlays) {
      const original=current.styles.get(node).get('visibility');
      if (original.value) node.style.setProperty('visibility',original.value,original.priority);
      else node.style.removeProperty('visibility');
    }
    current.overlays.clear();
  }
  function box(node) {
    const rect=node.getBoundingClientRect();
    return { x:rect.left+node.clientLeft,y:rect.top+node.clientTop,width:node.clientWidth,height:node.clientHeight };
  }
  function point(current,x,y) {
    const bounds=box(current.target);
    return { x:bounds.x+x-current.target.scrollLeft,y:bounds.y+y-current.target.scrollTop };
  }
  function reveal(current,x,y) {
    const target=current.target;
    const style=getComputedStyle(target);
    target.scrollTo({ left:clipped(style.overflowX)?x:0, top:clipped(style.overflowY)?y:0, behavior:'instant' });
    for (let node=target.parentElement;node && node!==document.scrollingElement;node=node.parentElement) {
      const computed=getComputedStyle(node);
      const bounds=box(node);
      const desired=point(current,x,y);
      if (clipped(computed.overflowY) && computed.overflowY!=='clip' || clipped(computed.overflowX) && computed.overflowX!=='clip') {
        node.scrollTo({ left:clipped(computed.overflowX)?node.scrollLeft+desired.x-bounds.x:node.scrollLeft,
          top:clipped(computed.overflowY)?node.scrollTop+desired.y-bounds.y:node.scrollTop, behavior:'instant' });
      }
    }
    const desired=point(current,x,y);
    window.scrollTo({ left:scrollX+desired.x,top:scrollY+desired.y,behavior:'instant' });
  }
  function measure(current) {
    assertCurrent(current);
    const target=current.target;
    const bounds=box(target);
    const style=getComputedStyle(target);
    const totalHeight=target.scrollHeight;
    const totalWidth=current.horizontal==='all'?target.scrollWidth:current.width;
    const desiredX=current.baseX+current.x;
    const desiredY=current.y;
    let left=Math.max(0,bounds.x+desiredX-target.scrollLeft);
    let top=Math.max(0,bounds.y+desiredY-target.scrollTop);
    let right=Math.min(innerWidth,bounds.x+totalWidth+current.baseX-target.scrollLeft);
    let bottom=Math.min(innerHeight,bounds.y+totalHeight-target.scrollTop);
    if (clipped(style.overflowX)) right=Math.min(right,bounds.x+bounds.width);
    if (clipped(style.overflowY)) bottom=Math.min(bottom,bounds.y+bounds.height);
    for (let node=target.parentElement;node;node=node.parentElement) {
      const computed=getComputedStyle(node);
      const clip=box(node);
      if (clipped(computed.overflowX)) { left=Math.max(left,clip.x); right=Math.min(right,clip.x+clip.width); }
      if (clipped(computed.overflowY)) { top=Math.max(top,clip.y); bottom=Math.min(bottom,clip.y+clip.height); }
    }
    const actualX=left-bounds.x+target.scrollLeft-current.baseX;
    const actualY=top-bounds.y+target.scrollTop;
    if (Math.abs(actualX-current.x)>0.75 || Math.abs(actualY-current.y)>0.75 || right-left<1 || bottom-top<1) {
      throw new Error('Part of the selected element is clipped or cannot be brought into view. Select its scrolling container or a smaller section.');
    }
    const warnings=[];
    if (current.horizontal==='visible' && (current.baseX>0 || target.scrollWidth>current.width+current.baseX+8 ||
      [...target.querySelectorAll('*')].some(node=>visible(node)&&node.scrollWidth>node.clientWidth+8&&clipped(getComputedStyle(node).overflowX)))) {
      warnings.push('Visible columns only: sideways content in the selected section is excluded.');
    }
    return { offset:current.y,horizontalOffset:current.x,totalWidth,totalHeight,
      clip:{x:left,y:top,width:Math.min(right-left,totalWidth-current.x),height:Math.min(bottom-top,totalHeight-current.y)},
      viewportWidth:innerWidth,viewportHeight:innerHeight,dpr:devicePixelRatio,warnings };
  }
  async function settle(current) {
    const started=performance.now();
    let previous='';
    let stable=started;
    while (performance.now()-started<6000) {
      await sleep(150);
      const metrics=measure(current);
      const key=JSON.stringify(metrics);
      if (key!==previous) { previous=key; stable=performance.now(); }
      const images=[...(current.target.matches('img')?[current.target]:[]),...current.target.querySelectorAll('img')];
      const pending=images.some(img=>!img.complete&&visible(img)&&img.getBoundingClientRect().top<innerHeight&&img.getBoundingClientRect().bottom>0);
      if (performance.now()-started>=650 && performance.now()-stable>=450 && performance.now()-current.lastMutation>=450 && !pending && document.fonts.status!=='loading') {
        const nodes=inspect(current.target);
        for (const node of nodes.slice(1)) {
          const style=getComputedStyle(node);
          if (clipped(style.overflowY)&&node.scrollHeight>node.clientHeight+2 || current.horizontal==='all'&&clipped(style.overflowX)&&node.scrollWidth>node.clientWidth+2) {
            throw new Error('A nested scroller could not be fully expanded. Select that scroller directly; no incomplete image was exported.');
          }
        }
        return metrics;
      }
    }
    throw new Error('The selected section did not settle after scrolling. Wait for loading to finish and retry.');
  }
  async function begin(token,horizontal) {
    if (session) throw new Error('An element capture is already active.');
    const target=api.selector.target(token);
    const nodes=inspect(target);
    for (let node=target;node;node=node.parentElement) {
      const style=getComputedStyle(node);
      if (style.transform!=='none' || style.position==='fixed' && node!==target) throw new Error('A transformed or fixed ancestor prevents complete element capture.');
    }
    if (getComputedStyle(target).direction!=='ltr') throw new Error('Element capture currently requires left-to-right sections.');
    if (visualViewport && Math.abs(visualViewport.scale-1)>0.01) throw new Error('Reset pinch zoom before element capture.');
    const rules=document.createElement('style');
    rules.textContent='*{scroll-behavior:auto!important;scroll-snap-type:none!important;overflow-anchor:none!important}';
    const scrollbars=document.createElement('style');
    scrollbars.textContent='*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
    const current={token,target,horizontal,rules,scrollbars,positions:new Map(),styles:new Map(),listeners:[],overlays:new Set(),
      viewportWidth:innerWidth,viewportHeight:innerHeight,dpr:devicePixelRatio,windowX:scrollX,windowY:scrollY,
      x:0,y:0,baseX:horizontal==='visible'?target.scrollLeft:0,lastMutation:performance.now()};
    session=current;
    try {
      for (let node=target;node;node=node.parentElement) remember(current,node);
      for (const node of nodes) remember(current,node);
      document.documentElement.append(rules,scrollbars);
      expandNested(current,nodes);
      hideOverlays(current);
      current.width=Math.min(target.clientWidth,innerWidth);
      if (!current.width || !target.scrollHeight) throw new Error('The selected element has no capturable content.');
      const onKey=event=>{ if (event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();restore(token,'Element capture cancelled; page state was restored.');} };
      const onInput=()=>restore(token,'Element capture stopped because the page was scrolled manually.');
      const onHide=()=>restore(token,'The record navigated during element capture.');
      current.listeners=[['keydown',onKey],['wheel',onInput],['touchmove',onInput],['pagehide',onHide]];
      for (const [name,listener] of current.listeners) window.addEventListener(name,listener,{capture:true,passive:name!=='keydown'});
      current.observer=new MutationObserver(mutations=>{
        const meaningful=mutations.filter(mutation=>![...current.overlays].some(node=>node===mutation.target||node.contains(mutation.target)));
        if (!meaningful.length) return;
        current.lastMutation=performance.now();
        current.removedRows ||= meaningful.some(mutation=>[...mutation.removedNodes].some(node=>node.nodeType===1&&(node.matches('tr,[role="row"]')||node.querySelector('tr,[role="row"]'))));
      });
      current.observer.observe(target,{subtree:true,childList:true,attributes:true,characterData:true});
      heartbeat(current);
      reveal(current,current.baseX,0);
      let metrics=await settle(current);
      if (horizontal==='visible' && metrics.clip.width<current.width) { current.width=metrics.clip.width; metrics=measure(current); }
      return metrics;
    } catch(error) { restore(token); throw error; }
  }
  api.command=async({type,token,horizontal='visible',x=0,y=0})=>{
    try {
      if (typeof token!=='string'||!token) throw new Error('Invalid element capture session.');
      if (type==='select') {api.selector.start(token);return {ok:true};}
      if (type==='selection') return {ok:true,...api.selector.status(token)};
      if (type==='restore') {restore(token);return {ok:true};}
      if (type==='begin') {
        if (!['visible','all'].includes(horizontal)) throw new Error('Invalid column option.');
        return {ok:true,metrics:await begin(token,horizontal)};
      }
      const current=session;
      if (!current||current.token!==token) throw new Error(lastError);
      assertCurrent(current);
      heartbeat(current);
      if (type==='tile') {
        if (!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0) throw new Error('Invalid element tile coordinates.');
        current.x=x;current.y=y;
        unhideOverlays(current);
        reveal(current,current.baseX+x,y);
        hideOverlays(current,y,x);
        await settle(current);
        hideOverlays(current,y,x);
        return {ok:true,metrics:await settle(current)};
      }
      if (type==='measure') return {ok:true,metrics:measure(current)};
      throw new Error('Unknown element capture command.');
    } catch(error) {
      restore(token);
      return {ok:false,error:error.message};
    }
  };
})();
