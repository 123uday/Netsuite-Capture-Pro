(() => {
  const api = globalThis.__netSuiteCapturePro;
  if (api.command) return;
  let session;
  let lastError = 'The capture session has ended.';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function restoreVisibility(saved) {
    for (const [element, previous] of saved) {
      if (previous.value) element.style.setProperty('visibility', previous.value, previous.priority);
      else element.style.removeProperty('visibility');
    }
    saved.clear();
  }

  function setTemporary(current, element, property, value) {
    let saved = current.properties.get(element);
    if (!saved) { saved = new Map(); current.properties.set(element, saved); }
    if (!saved.has(property)) saved.set(property, {
      value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property)
    });
    element.style.setProperty(property, value, 'important');
  }

  function expandHorizontalSections(current) {
    const nodes = [...current.root.querySelectorAll('*')];
    const candidates = nodes.filter((element) => api.detector.visible(element) &&
      !element.closest('nav,[role="navigation"],[role="menubar"]') &&
      element.scrollWidth > element.clientWidth + 8 &&
      /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowX));
    if (getComputedStyle(current.root).direction !== 'ltr' || candidates.some((element) => getComputedStyle(element).direction !== 'ltr')) {
      throw new Error('Capturing all columns currently requires left-to-right scroll containers.');
    }
    for (const element of candidates) {
      for (let node = element; node && node !== current.root; node = node.parentElement) {
        if (!current.positions.some(([saved]) => saved === node)) current.positions.push([node, node.scrollLeft, node.scrollTop]);
      }
    }
    // Widen horizontal sublists in the temporary capture layout. The outer
    // record remains viewport-sized and is captured in horizontal tiles.
    for (const element of candidates.reverse()) {
      const bounds = element.getBoundingClientRect();
      const required = element.scrollWidth + element.offsetWidth - element.clientWidth;
      for (let node = element; node && node !== current.root; node = node.parentElement) {
        if (!current.positions.some(([saved]) => saved === node)) current.positions.push([node, node.scrollLeft, node.scrollTop]);
        const rect = node.getBoundingClientRect();
        const width = Math.ceil(Math.max(rect.width, required + bounds.left - rect.left));
        setTemporary(current, node, 'box-sizing', 'border-box');
        setTemporary(current, node, 'width', `${width}px`);
        setTemporary(current, node, 'min-width', `${width}px`);
        setTemporary(current, node, 'max-width', 'none');
      }
    }
    const remaining = nodes.find((element) => api.detector.visible(element) &&
      !element.closest('nav,[role="navigation"],[role="menubar"]') &&
      element.scrollWidth > element.clientWidth + 8 && /^(auto|scroll|overlay|hidden|clip)$/.test(getComputedStyle(element).overflowX));
    if (remaining) throw new Error('A sublist could not be widened without clipping columns. Choose Visible columns for this record.');
  }

  function hideHorizontalPinned(current) {
    if (current.root.scrollLeft < 1) return;
    const clip = api.detector.metrics(current).clip;
    for (const element of current.root.querySelectorAll('*')) {
      if (current.hidden.has(element) || current.leftHidden.has(element)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if ((style.position === 'sticky' || style.position === 'fixed') && style.left !== 'auto' &&
          rect.left <= clip.x + (parseFloat(style.left) || 0) + 1) {
        current.leftHidden.set(element, { value: element.style.getPropertyValue('visibility'), priority: element.style.getPropertyPriority('visibility') });
        element.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  function restore(reason) {
    const current = session;
    if (!current) return;
    session = undefined;
    lastError = reason || 'The capture session has ended.';
    clearTimeout(current.watchdog);
    current.observer?.disconnect();
    document.removeEventListener('keydown', current.onKey, true);
    window.removeEventListener('pagehide', current.onPageHide);
    window.removeEventListener('wheel', current.onWheel, true);
    window.removeEventListener('touchmove', current.onWheel, true);
    try {
      restoreVisibility(current.leftHidden);
      restoreVisibility(current.hidden);
      // Restore scrollbar geometry before restoring original scroll offsets.
      current.scrollbarStyle.remove();
      for (const [element, properties] of [...current.properties].reverse()) {
        for (const [property, saved] of properties) {
          if (saved.value) element.style.setProperty(property, saved.value, saved.priority);
          else element.style.removeProperty(property);
        }
      }
      // Keep instant-scroll rules until all original positions have been restored.
      for (const [element, x, y] of current.positions) element.scrollTo({ left: x, top: y, behavior: 'instant' });
      window.scrollTo({ left: current.windowX, top: current.windowY, behavior: 'instant' });
    } finally {
      current.scrollbarStyle.remove();
      current.style.remove();
    }
  }

  function keepAlive(current) {
    clearTimeout(current.watchdog);
    current.watchdog = setTimeout(() => restore('Capture stopped responding. Page state was restored; retry.'), 20000);
  }

  function check(current) {
    if (session !== current) throw new Error(lastError);
    if (current.removedRows) throw new Error('Table rows were removed while scrolling. Virtualized or changing content cannot be captured reliably.');
    if (current.original.viewportWidth !== innerWidth || current.original.viewportHeight !== innerHeight || current.original.dpr !== devicePixelRatio) {
      throw new Error('Browser size or zoom changed. Retry without resizing the window.');
    }
  }

  function hideRepeatedHeaders(current, firstFrame = false) {
    let changed = false;
    const nodes = api.detector.inspect(current.root);
    // Include fixed navigation outside an internal scroll root, too.
    const extras = current.documentRoot ? [] : [...document.querySelectorAll('body *')];
    const clip = api.detector.metrics(current).clip;
    for (const element of new Set([...nodes, ...extras])) {
      if (element === current.root || element.contains(current.root)) continue;
      const computed = getComputedStyle(element);
      const position = computed.position;
      const rect = element.getBoundingClientRect();
      const pinnedTop = computed.top !== 'auto' && rect.top <= clip.y + (parseFloat(computed.top) || 0) + 1;
      const pinnedBottom = computed.bottom !== 'auto' && rect.bottom >= clip.y + clip.height - (parseFloat(computed.bottom) || 0) - 1;
      // Preserve section headings until they become pinned. Hide bottom overlays
      // from the first frame so they cannot cover record pixels in the stitch.
      const hide = position === 'fixed' ? (!firstFrame || pinnedBottom) :
        position === 'sticky' && (pinnedBottom || (!firstFrame && pinnedTop));
      if (hide && !current.hidden.has(element)) {
        current.hidden.set(element, { value: element.style.getPropertyValue('visibility'), priority: element.style.getPropertyPriority('visibility') });
        element.style.setProperty('visibility', 'hidden', 'important');
        changed = true;
      }
    }
    return changed;
  }

  async function settle(current) {
    const start = performance.now();
    let previous = '';
    let stableSince = start;
    while (performance.now() - start < 6000) {
      await sleep(150);
      check(current);
      const metrics = api.detector.metrics(current);
      const key = JSON.stringify(metrics);
      if (key !== previous) { previous = key; stableSince = performance.now(); }
      const pendingImages = [...current.root.querySelectorAll('img')].some((image) => {
        const rect = image.getBoundingClientRect();
        return !image.complete && rect.bottom > 0 && rect.top < innerHeight && rect.width > 0;
      });
      if (performance.now() - start >= 650 && performance.now() - stableSince >= 450 &&
          performance.now() - current.lastMutation >= 450 && !pendingImages && document.fonts.status !== 'loading') {
        api.detector.inspect(current.root);
        return metrics;
      }
    }
    throw new Error('The record did not settle after scrolling (lazy loading or continuous layout changes). No incomplete image was exported.');
  }

  async function begin(token, horizontal) {
    if (session) throw new Error('A full-page capture is already using this record.');
    const detected = api.detector.detect();
    const style = document.createElement('style');
    style.textContent = '* { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; }';
    const current = { ...detected, token, style, horizontal, hidden: new Map(), leftHidden: new Map(), properties: new Map(), positions: [],
      scrollbarStyle: api.scrollbars.createStyle(), scrollbarWidgets: new Set(),
      windowX: scrollX, windowY: scrollY, lastMutation: performance.now(), removedRows: false };
    current.original = api.detector.metrics(current);
    const ancestors = [];
    for (let node = current.root; node; node = node.parentElement) ancestors.push(node);
    current.positions = ancestors.map((element) => [element, element.scrollLeft, element.scrollTop]);
    session = current;
    try {
      document.documentElement.append(style);
      api.scrollbars.hideWidgets(current);
      document.documentElement.append(current.scrollbarStyle);
      if (horizontal === 'all') expandHorizontalSections(current);
      current.onKey = (event) => {
        if (event.key === 'Escape') restore('Capture cancelled. Original page state was restored.');
        else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          restore('Capture stopped because the page was scrolled manually.');
        }
      };
      current.onWheel = () => restore('Capture stopped because the page was scrolled manually.');
      current.onPageHide = () => restore('The page navigated during capture.');
      document.addEventListener('keydown', current.onKey, true);
      window.addEventListener('wheel', current.onWheel, { capture: true, passive: true });
      window.addEventListener('touchmove', current.onWheel, { capture: true, passive: true });
      window.addEventListener('pagehide', current.onPageHide);
      hideRepeatedHeaders(current, true);
      current.observer = new MutationObserver((mutations) => {
        mutations = mutations.filter((mutation) => ![...current.scrollbarWidgets].some((widget) => widget === mutation.target || widget.contains(mutation.target)));
        if (!mutations.length) return;
        current.lastMutation = performance.now();
        current.removedRows ||= mutations.some((mutation) => [...mutation.removedNodes].some((node) =>
          node.nodeType === 1 && (node.matches('tr,[role="row"]') || node.querySelector('tr,[role="row"]'))));
      });
      current.observer.observe(current.root, { subtree: true, childList: true, attributes: true, characterData: true });
      keepAlive(current);
      current.root.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      let result = await settle(current);
      if (api.scrollbars.hideWidgets(current)) result = await settle(current);
      if (result.offset > 1) throw new Error('The record could not be scrolled to its beginning.');
      return result;
    } catch (error) {
      restore();
      throw error;
    }
  }

  api.command = async ({ type, token, offset, left = 0, hideHeaders, horizontal = 'visible' }) => {
    try {
      if (typeof token !== 'string' || !token) throw new Error('Invalid capture session.');
      if (type === 'begin') {
        if (!['visible', 'all'].includes(horizontal)) throw new Error('Invalid column capture option.');
        return { ok: true, metrics: await begin(token, horizontal) };
      }
      if (!session || session.token !== token) {
        if (type === 'restore') return { ok: true };
        throw new Error(lastError);
      }
      const current = session;
      if (type === 'restore') { restore(); return { ok: true }; }
      check(current);
      keepAlive(current);
      if (type === 'scroll') {
        if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(left) || left < 0) throw new Error('Invalid scroll offset.');
        restoreVisibility(current.leftHidden);
        api.scrollbars.hideWidgets(current);
        if (hideHeaders) hideRepeatedHeaders(current);
        current.root.scrollTo({ left, top: offset, behavior: 'instant' });
        let metrics = await settle(current);
        if (hideHeaders && hideRepeatedHeaders(current)) metrics = await settle(current);
        if (current.horizontal === 'all' && left > 0) {
          hideHorizontalPinned(current);
          metrics = await settle(current);
        }
        if (api.scrollbars.hideWidgets(current)) metrics = await settle(current);
        return { ok: true, metrics };
      }
      if (type === 'measure') {
        if (api.scrollbars.hideWidgets(current)) throw new Error('A floating scrollbar appeared during the screenshot. Retry after the record finishes loading.');
        api.detector.inspect(current.root);
        return { ok: true, metrics: api.detector.metrics(current) };
      }
      throw new Error('Unknown capture command.');
    } catch (error) {
      if (session?.token === token) restore();
      return { ok: false, error: error.message };
    }
  };
})();
