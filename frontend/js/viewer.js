/**
 * viewer.js — Collapsible directory tree browser + JSON viewer with filter box
 */

const Viewer = (() => {

  // ── State ──────────────────────────────────────────────
  let _node       = '';
  let _user       = '';
  let _side       = 'A';  // environment side ('A' or 'B')
  let _expanded   = new Set(); // set of open folder paths (to preserve open/close state on filter)
  let _currentFilter = '';

  let _textSearch = null; // instance of TextSearch

  // ── Syntax highlight a JSON string ───────────────────────
  function highlight(jsonString) {
    if (typeof jsonString !== 'string') {
      try {
        jsonString = JSON.stringify(jsonString, null, 2);
      } catch (_) {
        return escapeHtml(String(jsonString));
      }
    }

    try {
      const cleaned = jsonString.trim().replace(/^\uFEFF/, '');
      const obj = JSON.parse(cleaned);
      jsonString = JSON.stringify(obj, null, 2);
    } catch (_) {
      /* keep as-is */
    }

    return jsonString.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g,
      match => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="json-key">${escapeHtml(match)}</span>`;
          return `<span class="json-string">${escapeHtml(match)}</span>`;
        }
        if (/true|false/.test(match)) return `<span class="json-bool">${match}</span>`;
        if (/null/.test(match))       return `<span class="json-null">${match}</span>`;
        if (/[{}\[\]]/.test(match))   return `<span class="json-punct">${match}</span>`;
        if (/,/.test(match))          return `<span class="json-punct">${match}</span>`;
        return `<span class="json-number">${match}</span>`;
      }
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Load flat nodes list from API ────────────────────────
  async function loadNodes() {
    const container = document.getElementById('viewer-file-browser');
    if (!container) return;

    container.innerHTML = '<div style="padding:20px;text-align:center"><div class="spinner" style="margin:auto"></div><p class="loading-text" style="margin-top:10px">Caricamento file...</p></div>';

    try {
      const nodes = await API.getConfigurationNodes(_node, '', _user, _side);
      
      let entries = [];
      if (Array.isArray(nodes)) {
        entries = nodes;
      } else if (nodes && (nodes.configurationid || nodes.configurationId || nodes.ConfigurationId)) {
        entries = nodes.configurationid || nodes.configurationId || nodes.ConfigurationId;
      } else if (nodes) {
        entries = nodes.items || nodes.children || Object.values(nodes) || [];
      }

      _allFiles = entries;
      
      // Default expand presentation root folders if available
      _expanded.add('Presentation');

      renderTree(_currentFilter);
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error" style="margin:16px">Errore: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ── Build nested folder tree structure from flat list ─────
  function buildTreeStructure(entries, query) {
    const root = { name: 'Root', isFolder: true, children: {} };
    const q = query.toLowerCase().trim();

    entries.forEach(entry => {
      // Support both string paths and objects
      const fullPath = typeof entry === 'string'
        ? entry
        : (entry.name || entry.Name || entry.configurationid || entry.configurationId || entry.ConfigurationId || '');
      
      if (!fullPath) return;

      // Filter check
      if (q && !fullPath.toLowerCase().includes(q)) {
        return;
      }

      // Slashes normalization
      const normalized = fullPath.replace(/\//g, '\\');
      const parts = normalized.split('\\').filter(p => p.trim());

      let current = root;
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const currentPath = parts.slice(0, index + 1).join('\\');

        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            isFolder: !isLast,
            path: currentPath,
            children: {},
            entry: isLast ? entry : null,
            subPath: parts.slice(0, index).join('\\'),
            filename: part
          };
        }
        current = current.children[part];
      });
    });

    return root;
  }

  // ── Render tree to HTML recursively ───────────────────────
  function generateTreeHTML(node, depth = 0) {
    if (!node.isFolder) {
      const icon = getFileIcon(node.name);
      const escapedName = escapeHtml(node.name);
      const subPath = node.subPath;
      const filename = node.filename;
      
      // Pass the filename itself as ID, and the directory path as subPath
      const dataId = filename;

      return `
        <div class="fb-entry fb-file" data-id="${escapeHtml(dataId)}" data-path="${escapeHtml(subPath)}" data-name="${escapedName}" style="padding-left: ${depth * 14 + 12}px; align-items: center;">
          <span class="fb-icon" style="flex-shrink:0; margin-top:2px; align-self:flex-start;">${icon}</span>
          <div style="display:flex; flex-direction:column; flex:1; min-width:0; line-height:1.3; gap:2px;">
            <span class="fb-name" title="${escapedName}">${escapedName}</span>
            <span style="font-size:10.5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(subPath)}">${subPath ? escapeHtml(subPath) : '\\'}</span>
          </div>
          <button class="btn btn-sm btn-ghost fb-dl-btn" data-id="${escapeHtml(dataId)}" data-path="${escapeHtml(subPath)}" title="Scarica file" style="flex-shrink:0">⬇</button>
        </div>
      `;
    }

    const sortedKeys = Object.keys(node.children).sort((a, b) => {
      const nodeA = node.children[a];
      const nodeB = node.children[b];
      if (nodeA.isFolder && !nodeB.isFolder) return -1;
      if (!nodeA.isFolder && nodeB.isFolder) return 1;
      return a.localeCompare(b);
    });

    if (depth === 0) {
      return sortedKeys.map(key => generateTreeHTML(node.children[key], depth)).join('');
    }

    const escapedName = escapeHtml(node.name);
    const path = node.path;
    // If we have a filter query, auto-expand all folders containing matching files
    const isOpen = _currentFilter ? true : _expanded.has(path);
    const arrow = isOpen ? '▼' : '▶';

    const childrenHTML = sortedKeys.map(key => generateTreeHTML(node.children[key], depth + 1)).join('');

    return `
      <div class="fb-folder-wrap">
        <div class="fb-entry fb-folder" data-path="${escapeHtml(path)}" style="padding-left: ${depth * 14 + 12}px">
          <span class="fb-toggle ${isOpen ? 'open' : ''}">${arrow}</span>
          <span class="fb-icon">📁</span>
          <span class="fb-name" title="${escapedName}">${escapedName}</span>
        </div>
        <div class="fb-folder-children" style="display: ${isOpen ? 'block' : 'none'};">
          ${childrenHTML}
        </div>
      </div>
    `;
  }

  // ── Render tree and attach listeners ─────────────────────
  function renderTree(filterText = '') {
    const container = document.getElementById('viewer-file-browser');
    if (!container) return;

    _currentFilter = filterText;
    const treeData = buildTreeStructure(_allFiles, filterText);
    const html = generateTreeHTML(treeData, 0);

    if (!html) {
      container.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-icon">🔍</div><h3>Nessun file corrispondente</h3></div>';
      return;
    }

    container.innerHTML = `<div class="file-browser-list">${html}</div>`;

    // Folder Expand/Collapse Click Handler
    container.querySelectorAll('.fb-folder').forEach(folder => {
      folder.addEventListener('click', e => {
        e.stopPropagation();
        const path = folder.dataset.path;
        const toggle = folder.querySelector('.fb-toggle');
        const childrenWrap = folder.nextElementSibling;

        const isNowOpen = childrenWrap.style.display === 'none';
        childrenWrap.style.display = isNowOpen ? 'block' : 'none';
        toggle.textContent = isNowOpen ? '▼' : '▶';
        toggle.classList.toggle('open', isNowOpen);

        if (isNowOpen) {
          _expanded.add(path);
        } else {
          _expanded.delete(path);
        }
      });
    });

    // File Selection Click Handler
    container.querySelectorAll('.fb-file').forEach(file => {
      file.addEventListener('click', e => {
        if (e.target.classList.contains('fb-dl-btn')) return;
        
        container.querySelectorAll('.fb-file.selected').forEach(f => f.classList.remove('selected'));
        file.classList.add('selected');

        openFile(file.dataset.id, file.dataset.path, file.dataset.name);

        // Auto-filter left panel by this file's base name
        const searchFileInput = document.getElementById('search-file-input');
        if (searchFileInput) {
          let baseName = file.dataset.name;
          if (baseName.includes('.')) {
              baseName = baseName.substring(0, baseName.lastIndexOf('.'));
          }
          searchFileInput.value = baseName;
          searchFileInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    // Individual File Download Handler
    container.querySelectorAll('.fb-dl-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        downloadFileDirectly(btn.dataset.id, btn.dataset.path);
      });
    });
  }

  // ── Open and display file content ────────────────────────
  async function openFile(configurationId, subPath, displayName) {
    const contentEl = document.getElementById('json-viewer-content');
    const titleEl   = document.getElementById('viewer-file-title');
    if (!contentEl) return;

    if (titleEl) titleEl.textContent = displayName || configurationId;
    contentEl.innerHTML = '<div class="spinner" style="margin:16px auto;display:block"></div>';
    try {
      const data = await API.downloadSingleFile(_node, subPath, configurationId, _user, _side);
      contentEl.innerHTML = highlight(data.content);
      
      const searchUi = document.getElementById('viewer-text-search-ui');
      if (searchUi) searchUi.classList.remove('hidden');

      // Re-init TextSearch
      _textSearch = new TextSearch(contentEl);
      const searchInput = document.getElementById('viewer-text-search-input');
      const countEl = document.getElementById('viewer-text-search-count');
      if (searchInput) searchInput.value = '';
      if (countEl) countEl.textContent = '0/0';

    } catch (err) {
      contentEl.innerHTML = `<div class="alert alert-error">Errore apertura file: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ── Download file directly ────────────────────────────────
  async function downloadFileDirectly(configurationId, subPath) {
    try {
      await API.downloadFileDirectly(_node, subPath, configurationId, _user, _side);
    } catch (err) {
      console.error('Download error:', err);
    }
  }

  // ── Public: Initialize ───────────────────────────────────
  function show(nodeAlias, userName = '', side = 'A', initialFilter = '') {
    _node     = nodeAlias;
    _user     = userName;
    _side     = side;
    _allFiles = [];
    _expanded = new Set(['Presentation']); // reset expanded directories

    // Reset search filter input value
    const searchInput = document.getElementById('viewer-search');
    if (searchInput) {
      searchInput.value = initialFilter;
    }
    _currentFilter = initialFilter;

    loadNodes();
  }

  // Wire up filter box event listener once
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('viewer-search')?.addEventListener('input', e => {
      renderTree(e.target.value);
    });

    const searchInput = document.getElementById('viewer-text-search-input');
    const prevBtn = document.getElementById('viewer-text-search-prev');
    const nextBtn = document.getElementById('viewer-text-search-next');
    const countEl = document.getElementById('viewer-text-search-count');

    function updateSearchCount() {
      if (!_textSearch) return;
      if (_textSearch.matches.length === 0) {
        countEl.textContent = '0/0';
      } else {
        countEl.textContent = `${_textSearch.currentIndex + 1}/${_textSearch.matches.length}`;
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', e => {
        if (_textSearch) {
          _textSearch.search(e.target.value);
          updateSearchCount();
        }
      });
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) _textSearch?.prev();
          else _textSearch?.next();
          updateSearchCount();
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        _textSearch?.prev();
        updateSearchCount();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        _textSearch?.next();
        updateSearchCount();
      });
    }
  });

  // ── Helpers ───────────────────────────────────────────────
  function getFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const icons = { json: '📋', zip: '📦', xml: '📰', csv: '📊', sql: '🗄️', txt: '📝' };
    return icons[ext] || '📄';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1048576).toFixed(1)} MB`;
  }

  return { show, highlight };
})();
