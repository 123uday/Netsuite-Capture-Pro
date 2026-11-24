// Phase 3 only. No listeners or DOM changes until selection is explicitly started.
(() => {
  const api = globalThis.__netSuiteElementCapture ??= {};
  if (api.selector) return;
  let selection;
  const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };

  function cleanup(current) {
    clearTimeout(current.timer);
    current.host.remove();
    for (const [name, listener] of current.listeners) window.removeEventListener(name, listener, true);
    current.listeners = [];
  }

  function cancel(token, reason = 'Element selection cancelled.') {
    if (!selection || selection.token !== token) return;
    cleanup(selection);
    selection.state = 'cancelled';
    selection.error = reason;
    selection.target = undefined;
  }

  function start(token) {
    if (selection?.state === 'waiting') throw new Error('Element selection is already active.');
    const host = document.createElement('div');
    host.setAttribute('data-nscp-element-selector','');
    host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important';
    const shadow = host.attachShadow({ mode: 'closed' });
    const outline = document.createElement('div');
    outline.style.cssText = 'position:fixed;box-sizing:border-box;border:3px solid #1673e6;background:rgba(22,115,230,.10);pointer-events:none;display:none';
    const help = document.createElement('div');
    help.style.cssText = 'position:fixed;left:12px;top:12px;max-width:calc(100vw - 24px);padding:10px 14px;color:white;background:#18334f;font:14px system-ui;border-radius:6px;pointer-events:none';
    help.textContent = 'Point to a section, then click. ↑ Parent · ↓ Child · Enter Select · Escape Cancel';
    shadow.append(outline, help);
    document.documentElement.append(host);
    const current = { token, host, outline, help, state:'waiting', listeners:[], target:undefined };
    selection = current;
    const frameCovers=new Map();
    const coverFrames=()=>{
      for(const frame of document.querySelectorAll('iframe')){
        let cover=frameCovers.get(frame);
        if(!cover){cover=document.createElement('div');cover.style.cssText='position:fixed;pointer-events:auto;background:transparent';shadow.prepend(cover);frameCovers.set(frame,cover);}
        const rect=frame.getBoundingClientRect();
        Object.assign(cover.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
      }
    };
    coverFrames();
    const highlight = (target) => {
      if (!target || target === document.documentElement || target === host) return;
      current.target = target;
      const rect = target.getBoundingClientRect();
      Object.assign(outline.style, { display:'block', left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px` });
      help.textContent = `${target.tagName.toLowerCase()} · ${Math.round(rect.width)} × ${Math.round(rect.height)} · Click/Enter Select · ↑ Parent · ↓ Child · Escape Cancel`;
    };
    const choose = () => {
      if (!current.target?.isConnected) return;
      current.state = 'selected';
      cleanup(current);
    };
    const onMove = (event) => {
      let target = document.elementFromPoint(event.clientX, event.clientY);
      if(target===host)target=[...frameCovers.keys()].find(frame=>{const rect=frame.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;});
      if (!target || target === host) return;
      let scroller;
      for (let node = target; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if ((node.scrollHeight > node.clientHeight + 2 && /auto|scroll/.test(style.overflowY)) ||
            (node.scrollWidth > node.clientWidth + 8 && /auto|scroll/.test(style.overflowX))) { scroller = node; break; }
      }
      target = scroller || target.closest('table,section,fieldset,[role="grid"],.uir-field-group,.uir-list-wrap') || target;
      highlight(target);
    };
    const onClick = (event) => { stop(event); choose(); };
    const onKey = (event) => {
      if (!['Escape','Enter','ArrowUp','ArrowDown',' '].includes(event.key)) return;
      stop(event);
      if (event.key === 'Escape') cancel(token);
      else if (event.key === 'Enter') choose();
      else if (event.key === 'ArrowUp') highlight(current.target?.parentElement);
      else if(event.key==='ArrowDown')highlight([...current.target?.children||[]].find(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;}));
    };
    const onScroll = () => { coverFrames(); if (current.target) highlight(current.target); };
    for (const [name, listener] of [['mousemove',onMove],['click',onClick],['keydown',onKey],['scroll',onScroll],
      ['pointerdown',stop],['pointerup',stop],['mousedown',stop],['mouseup',stop],['dblclick',stop],['contextmenu',stop]]) {
      window.addEventListener(name, listener, true);
      current.listeners.push([name,listener]);
    }
    current.timer = setTimeout(() => cancel(token, 'Element selection timed out. Start again to select a section.'), 120000);
  }

  api.selector = {
    start,
    cancel,
    status(token) {
      if (!selection || selection.token !== token) throw new Error('Element selection session not found.');
      return { state: selection.state, error: selection.error };
    },
    target(token) {
      if (selection?.token !== token || selection.state !== 'selected' || !selection.target?.isConnected) {
        throw new Error(selection?.error || 'Select an element before capturing.');
      }
      return selection.target;
    },
    clear(token) {
      if (selection?.token !== token) return;
      cleanup(selection);
      selection = undefined;
    }
  };
})();
