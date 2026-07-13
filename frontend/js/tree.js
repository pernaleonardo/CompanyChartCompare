/**
 * tree.js — Recursive tree rendering and node navigation
 */

const Tree = (() => {

  let _data         = null;     // raw hierarchy JSON
  let _onSelect     = null;     // callback(nodeData)
  let _searchQuery  = '';
  let _levelFilter  = null;     // null = all levels
  let _expandedSet  = new Set();// aliasex of expanded nodes
  let _fileMatchesMap = null;   // null = inactive, {} = alias -> count
  let _hideZeroFiles  = true;

  // ── Level color helpers ──────────────────────────────────
  const LEVEL_COLORS = ['l0','l1','l2','l3','l4'];
  function levelClass(lv) { return `badge-l${Math.min(lv, LEVEL_COLORS.length - 1)}`; }

  const LEVEL_ICONS = [
    // Level 0: Globe (Mondo) - uses color: var(--accent) to dynamically take theme color
    `<svg class="tree-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
    // Level 1: Factory (Fabbrica)
    `<svg class="tree-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); vertical-align: middle;"><path d="M22 21H2V3l7 4 7-4 6 4v14z"></path><path d="M6 17h2v4H6v-4z"></path><path d="M10 17h2v4h-2v-4z"></path><path d="M14 17h2v4h-2v-4z"></path></svg>`,
    // Level 2: Building (Azienda)
    `<svg class="tree-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); vertical-align: middle;"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="16"></line><line x1="15" y1="22" x2="15" y2="16"></line><line x1="9" y1="16" x2="15" y2="16"></line><path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M12 6h.01M12 10h.01"></path></svg>`,
    // Level 3: User (Utente)
    `<svg class="tree-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); vertical-align: middle;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    // Level 4: Document (File)
    `<svg class="tree-svg-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); vertical-align: middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`
  ];
  function levelIcon(lv) { return LEVEL_ICONS[Math.min(lv, LEVEL_ICONS.length - 1)]; }

  // ── Count non-service users for a component ──────────────
  function countUsers(nodeData, componentId) {
    const list = nodeData.usersList || nodeData.UsersList || [];
    if (!list.length) return 0;
    const targetComp = (componentId || '').toLowerCase();
    return list.filter(u => {
      const uComp = (u.componentid || u.componentId || u.ComponentId || '').toLowerCase();
      const isServ = u.isServiceUser || u.IsServiceUser || false;
      return uComp === targetComp && !isServ;
    }).length;
  }

  // ── Collect all nodes (flat) for search ─────────────────
  function collectAll(node, depth = 0) {
    const result = [{ node, depth }];
    if (node.children) {
      for (const child of node.children) result.push(...collectAll(child, depth + 1));
    }
    return result;
  }

  // ── Build alias → nodeData index ────────────────────────
  function buildIndex(root) {
    const idx = {};
    function walk(n) {
      if (n.node?.alias) idx[n.node.alias] = n;
      if (n.children) n.children.forEach(walk);
    }
    walk(root);
    return idx;
  }

  // ── Get node level ───────────────────────────────────────
  function nodeLevel(nodeData) {
    return nodeData.node?.level ?? nodeData.node?.Level ?? 0;
  }

  // ── Render a single tree row ──────────────────────────────
  function renderRow(nodeData, depth, componentId) {
    const alias    = nodeData.node?.alias || '(root)';
    const lv       = nodeLevel(nodeData);
    const hasKids  = nodeData.children && nodeData.children.length > 0;
    const users    = countUsers(nodeData, componentId);
    const isOpen   = _expandedSet.has(alias);

    const indentPx = depth * 16;

    const row = document.createElement('div');
    row.className   = 'tree-row';
    row.dataset.alias = alias;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', hasKids ? isOpen : undefined);

    // Check search match
    const q = _searchQuery.toLowerCase();
    const matches = q && alias.toLowerCase().includes(q);
    if (_levelFilter !== null && lv !== _levelFilter && !hasDescendantAtLevel(nodeData, _levelFilter)) return null;

    if (_fileMatchesMap !== null) {
      const matchCount = _fileMatchesMap[alias] || 0;
      if (_hideZeroFiles && matchCount === 0 && !hasDescendantWithFileMatch(nodeData)) return null;
    }
    
    const hasFiles = _fileMatchesMap !== null && (_fileMatchesMap[alias] || 0) > 0;
    const highlightStyle = hasFiles ? 'background: var(--accent-glow); color: var(--accent-bright); padding: 2px 6px; border-radius: 4px; font-weight: 600;' : '';

    row.innerHTML = `
      <div class="tree-indent" style="width:${indentPx}px" aria-hidden="true"></div>
      <span class="tree-toggle ${hasKids ? '' : 'invisible'} ${isOpen ? 'open' : ''}" aria-hidden="true">▶</span>
      <span class="node-icon" aria-hidden="true">${levelIcon(lv)}</span>
      <span class="node-name ${matches ? 'match' : ''}" title="${alias}" style="${highlightStyle}">${
        matches ? alias.replace(new RegExp(`(${escapeRe(q)})`, 'gi'), '<mark style="background:rgba(245,158,11,.25);color:var(--warning)">$1</mark>') : alias
      }</span>
      <span class="node-badges">
        <span class="badge ${levelClass(lv)}" title="Livello ${lv}">L${lv}</span>
        ${
          _fileMatchesMap !== null 
            ? `<span class="badge badge-users" style="background:var(--accent-glow);color:var(--text-accent)" title="${_fileMatchesMap[alias] || 0} file">📄 ${_fileMatchesMap[alias] || 0}</span>`
            : (users > 0 ? `<span class="badge badge-users" title="${users} utenti">👥 ${users}</span>` : '')
        }
      </span>
    `;

    row.querySelector('.invisible')?.classList.add('hidden');

    // Click on toggle arrow
    const toggleEl = row.querySelector('.tree-toggle');
    if (hasKids) {
      toggleEl.addEventListener('click', e => {
        e.stopPropagation();
        if (_expandedSet.has(alias)) _expandedSet.delete(alias);
        else _expandedSet.add(alias);
        render();
      });
    }

    // Click on row → select node
    row.addEventListener('click', () => {
      document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
      row.classList.add('selected');
      if (_onSelect) _onSelect(nodeData);
    });

    return row;
  }

  // ── Check if subtree has a node at target level ──────────
  function hasDescendantAtLevel(nodeData, targetLevel) {
    if (nodeLevel(nodeData) === targetLevel) return true;
    if (!nodeData.children) return false;
    return nodeData.children.some(c => hasDescendantAtLevel(c, targetLevel));
  }

  // ── Check if subtree has file matches ────────────────────
  function hasDescendantWithFileMatch(nodeData) {
    if (_fileMatchesMap === null) return true;
    if (nodeData.node?.alias && (_fileMatchesMap[nodeData.node.alias] || 0) > 0) return true;
    if (!nodeData.children) return false;
    return nodeData.children.some(c => hasDescendantWithFileMatch(c));
  }

  // ── Recursively render subtree ────────────────────────────
  function renderSubtree(container, nodeData, depth, componentId) {
    const row = renderRow(nodeData, depth, componentId);
    if (!row) return;
    container.appendChild(row);

    if (nodeData.children && nodeData.children.length > 0) {
      const alias  = nodeData.node?.alias;
      const isOpen = _expandedSet.has(alias);

      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'tree-children';
      childrenWrap.style.maxHeight = isOpen ? '99999px' : '0';
      childrenWrap.setAttribute('role', 'group');

      if (isOpen) {
        nodeData.children.forEach(child => renderSubtree(childrenWrap, child, depth + 1, componentId));
      }
      container.appendChild(childrenWrap);
    }
  }

  // ── Re-render the whole tree ──────────────────────────────
  function render() {
    const container = document.getElementById('tree-container');
    if (!container || !_data) return;
    container.innerHTML = '';

    const { componentId } = API.session();

    // Root is the top-level wrapper (may have .children directly)
    const root = Array.isArray(_data) ? _data : (_data.children ? _data : { children: [_data] });

    if (root.children) {
      root.children.forEach(child => renderSubtree(container, child, 0, componentId));
    } else {
      renderSubtree(container, root, 0, componentId);
    }

    // If nothing rendered
    if (!container.children.length) {
      container.innerHTML = '<div class="empty-state" style="padding:40px;"><div class="empty-icon">🔍</div><h3>Nessun nodo trovato</h3><p>Prova a modificare il filtro o la ricerca.</p></div>';
    }
  }

  // ── Expand / collapse all ─────────────────────────────────
  function expandAll() {
    if (!_data) return;
    const all = collectAll(_data);
    all.forEach(({ node }) => { if (node.node?.alias) _expandedSet.add(node.node.alias); });
    render();
  }

  function collapseAll() {
    _expandedSet.clear();
    render();
  }

  // ── Public API ────────────────────────────────────────────
  function init(data, onSelect) {
    _data      = data;
    _onSelect  = onSelect;
    // Auto-expand first level
    if (data.children) data.children.forEach(c => { if (c.node?.alias) _expandedSet.add(c.node.alias); });
    render();
  }

  function setSearch(q) {
    _searchQuery = q;
    if (q) expandAll();
    else render();
  }

  function setLevelFilter(lv) {
    _levelFilter = lv;
    if (lv !== null) expandAll();
    else render();
  }

  function setFileMatches(map) {
    _fileMatchesMap = map;
    if (map !== null) expandAll();
    else render();
  }

  function setHideZeroFiles(hide) {
    _hideZeroFiles = hide;
    render();
  }

  function getData()  { return _data; }

  // ── Get distinct levels from hierarchy ───────────────────
  function getLevels(data) {
    const levels = new Set();
    function walk(n) {
      if (n.node?.level !== undefined) levels.add(n.node.level);
      if (n.children) n.children.forEach(walk);
    }
    walk(data);
    return [...levels].sort((a, b) => a - b);
  }

  // ── Get all nodes at a given level ───────────────────────
  function getNodesByLevel(data, level) {
    const nodes = [];
    function walk(n) {
      if (nodeLevel(n) === level) nodes.push(n);
      if (n.children) n.children.forEach(walk);
    }
    walk(data);
    return nodes;
  }

  function selectNodeByAlias(alias) {
    if (!_data) return false;

    const path = [];
    let foundNode = null;

    function search(node, currentPath) {
      if (node.node?.alias === alias) {
        foundNode = node;
        path.push(...currentPath);
        return true;
      }
      if (node.children) {
        for (const child of node.children) {
          if (search(child, [...currentPath, node.node?.alias].filter(x => x))) {
            return true;
          }
        }
      }
      return false;
    }

    const root = Array.isArray(_data) ? { children: _data } : _data;
    search(root, []);

    if (foundNode) {
      // Expand parents
      path.forEach(parentAlias => _expandedSet.add(parentAlias));
      render();

      // Trigger visual selection and callback
      setTimeout(() => {
        const row = document.querySelector(`.tree-row[data-alias="${alias}"]`);
        if (row) {
          document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
          row.classList.add('selected');
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (_onSelect) _onSelect(foundNode);
        }
      }, 60);
      return true;
    }
    return false;
  }

  return { init, render, setSearch, setLevelFilter, setFileMatches, setHideZeroFiles, expandAll, collapseAll, getData, getLevels, getNodesByLevel, selectNodeByAlias };

  // ── Util ─────────────────────────────────────────────────
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
})();
