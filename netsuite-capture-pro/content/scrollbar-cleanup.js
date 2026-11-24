// Some NetSuite pages move an absolute-positioned scrollbar as the record
// scrolls. It is neither fixed nor sticky, so ordinary header cleanup misses it.
(() => {
  const api = globalThis.__netSuiteCapturePro;
  function hideWidgets(current) {
    let changed = false;
    for (const element of document.querySelectorAll('*')) {
      if (element === current.root || element.contains(current.root) || current.hidden.has(element)) continue;
      if (!api.detector.visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height > 40 || rect.width < 120 || rect.width < rect.height * 4) continue;
      const role = element.getAttribute('role');
      const semantic = role === 'scrollbar' && element.getAttribute('aria-orientation') === 'horizontal';
      // Never hide table content or record fields just because their box is thin.
      if (element.matches('table,tr,td,th,input,select,textarea') ||
          element.querySelector('table,tr,td,th,[role="row"],[role="gridcell"],input,select,textarea,img,canvas')) continue;
      const text = element.textContent.trim();
      const style = getComputedStyle(element);
      const native = element.scrollWidth > element.clientWidth + 8 && /^(auto|scroll|overlay)$/.test(style.overflowX);
      const named = /(?:scrollbar|hscroll|h-scroll|horizontal-scroll|scroll[-_]?track)/i.test(`${element.id} ${typeof element.className === 'string' ? element.className : ''}`);
      if (!semantic && (!native && !named || text || element.querySelector('button,a,[contenteditable="true"]'))) continue;
      current.hidden.set(element, {
        value: element.style.getPropertyValue('visibility'), priority: element.style.getPropertyPriority('visibility')
      });
      current.scrollbarWidgets.add(element);
      element.style.setProperty('visibility', 'hidden', 'important');
      changed = true;
    }
    return changed;
  }

  function createStyle() {
    const style = document.createElement('style');
    // Hide the browser-drawn tracks without disabling programmatic scrolling.
    style.textContent = '* { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
    return style;
  }
  api.scrollbars = { hideWidgets, createStyle };
})();
