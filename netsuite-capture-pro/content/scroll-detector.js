// Classic script injected into Chrome's isolated world, never the page world.
(() => {
  const api = globalThis.__netSuiteCapturePro ??= {};
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const scrollable = (element) => element.scrollHeight > element.clientHeight + 2 &&
    /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY);

  function horizontalWarnings(root) {
    const nodes = [root, ...root.querySelectorAll('*')];
    const sections = nodes.filter((element) => {
      if (!visible(element) || element.closest('nav,[role="navigation"],[role="menubar"]')) return false;
      // Small rounding/layout overflow is not evidence of missing table columns.
      if (element.scrollWidth - element.clientWidth <= 8) return false;
      return element === root || /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowX);
    });
    if (!sections.length) return [];
    const extra = Math.max(...sections.map((element) => element.scrollWidth - element.clientWidth));
    return [`Visible columns only: ${sections.length} section(s) extend horizontally (up to ${Math.ceil(extra)} px). This vertical PNG includes the current visible width; sideways content is not included.`];
  }

  function inspect(root) {
    const elements = [...root.querySelectorAll('*')];
    if (elements.length > 30000) throw new Error('This record has too many DOM elements for a reliable capture.');
    const nodes = [root, ...elements];
    for (const element of nodes) {
      if (!visible(element)) continue;
      if (element !== root && element !== document.body && scrollable(element)) {
        throw new Error('A nested scrollable section contains hidden rows. Phase 2 captures one vertical container; nested content requires element capture. No incomplete image was exported.');
      }
      if (element.tagName === 'IFRAME') {
        throw new Error('This record contains a visible iframe. Complete iframe capture is not supported in Phase 2.');
      }
      const className = typeof element.className === 'string' ? element.className : '';
      const rowCount = Number(element.getAttribute('aria-rowcount'));
      const columnCount = Number(element.getAttribute('aria-colcount'));
      const mountedColumns = columnCount > 0 ? Math.max(0, ...[...element.querySelectorAll('tr,[role="row"]')].map((row) =>
        [...row.querySelectorAll('td,th,[role="gridcell"],[role="columnheader"],[role="cell"]')].reduce((count, cell) =>
          count + (Number(cell.getAttribute('colspan') || cell.getAttribute('aria-colspan')) || 1), 0))) : 0;
      if (element.hasAttribute('data-virtualized') || /(?:react-virtual|react-window|virtualized|ag-body-viewport)/i.test(className) ||
          (rowCount > 0 && rowCount > element.querySelectorAll('tr,[role="row"]').length) ||
          (columnCount > 0 && columnCount > mountedColumns)) {
        throw new Error('A virtualized table was detected. Not all rows or columns are present in the DOM; complete capture cannot be guaranteed.');
      }
    }
    return nodes;
  }

  function detect() {
    if (visualViewport && (Math.abs(visualViewport.scale - 1) > 0.01 || visualViewport.offsetTop || visualViewport.offsetLeft)) {
      throw new Error('Reset pinch zoom before full-page capture.');
    }
    const documentRoot = document.scrollingElement;
    if (!documentRoot) throw new Error('This page has no scrolling document.');
    const all = [...document.querySelectorAll('*')];
    if (all.length > 30000) throw new Error('This record has too many DOM elements for a reliable capture.');
    const candidates = all.filter((element) => element !== documentRoot && element !== document.body && visible(element) && scrollable(element));
    let root = documentRoot;
    if (documentRoot.scrollHeight <= innerHeight + 2 && candidates.length) {
      candidates.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      root = candidates[0];
      if (root.clientWidth * root.clientHeight < innerWidth * innerHeight * 0.4 ||
          candidates.some((element) => element !== root && !root.contains(element))) {
        throw new Error('Multiple or small independent scroll areas were detected. A single complete record cannot be inferred reliably.');
      }
    }
    const nodes = inspect(root);
    return { root, nodes, documentRoot: root === documentRoot };
  }

  function metrics(session) {
    const root = session.root;
    if (!root.isConnected) throw new Error('The scrolling record was replaced during capture.');
    let clip;
    if (session.documentRoot) {
      clip = { x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    } else {
      const rect = root.getBoundingClientRect();
      if (Math.abs(rect.width - root.offsetWidth) > 1 || Math.abs(rect.height - root.offsetHeight) > 1) {
        throw new Error('Transformed scroll containers cannot be captured reliably.');
      }
      clip = { x: rect.left + root.clientLeft, y: rect.top + root.clientTop, width: root.clientWidth, height: root.clientHeight };
      // A container clipped by another ancestor is not fully visible to captureVisibleTab.
      for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY + style.overflowX)) {
          const bounds = ancestor.getBoundingClientRect();
          if (clip.x < bounds.left - 1 || clip.y < bounds.top - 1 || clip.x + clip.width > bounds.right + 1 || clip.y + clip.height > bounds.bottom + 1) {
            throw new Error('The record container is clipped by an ancestor. Complete capture is unavailable.');
          }
        }
      }
    }
    if (clip.width < 1 || clip.height < 80 || clip.x < -0.5 || clip.y < -0.5 ||
        clip.x + clip.width > innerWidth + 0.5 || clip.y + clip.height > innerHeight + 0.5) {
      throw new Error('The record scroll container must fit inside the browser viewport.');
    }
    return { offset: root.scrollTop, horizontalOffset: root.scrollLeft,
      totalWidth: session.horizontal === 'all' ? root.scrollWidth : clip.width,
      totalHeight: root.scrollHeight, clip,
      viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio,
      kind: session.documentRoot ? 'document' : 'internal container',
      warnings: session.horizontal === 'all' ? [] : horizontalWarnings(root) };
  }

  api.detector = { detect, inspect, metrics, visible, horizontalWarnings };
})();
