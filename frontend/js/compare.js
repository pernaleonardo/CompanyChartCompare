/**
 * compare.js — Side-by-side diff view for configurations
 */

const Compare = (() => {

  // Exclusions state
  let _exclusions = {}; // e.g. { "agent.json": ["appServer", "connectionString"] }
  let _exclusionsEnabled = true;

  function loadExclusionsFromStorage() {
    try {
      const stored = localStorage.getItem('cc_compare_exclusions');
      if (stored) {
        _exclusions = JSON.parse(stored);
      } else {
        _exclusions = {};
      }
      const enabled = localStorage.getItem('cc_compare_exclusions_enabled');
      _exclusionsEnabled = enabled !== 'false';
    } catch (_) {
      _exclusions = {};
      _exclusionsEnabled = true;
    }
  }

  function saveExclusionsToStorage() {
    try {
      localStorage.setItem('cc_compare_exclusions', JSON.stringify(_exclusions));
      localStorage.setItem('cc_compare_exclusions_enabled', _exclusionsEnabled.toString());
    } catch (_) {}
  }

  function formatIfJson(content) {
    if (!content) return '';
    const clean = content.replace(/^\ufeff/, '').trim();
    try {
      const parsed = JSON.parse(clean);
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return clean;
    }
  }

  // ── Simple line-level diff ───────────────────────────────
  function diffLines(textA, textB) {
    const formattedA = formatIfJson(textA);
    const formattedB = formatIfJson(textB);
    const linesA = formattedA.split('\n');
    const linesB = formattedB.split('\n');
    return { linesA, linesB };
  }

  // ── Render a side (left/right) ───────────────────────────
  function renderSide(lines, opposite, deleted) {
    const spans = lines.map((line, i) => {
      const other = opposite[i];
      let cls = '';
      if (line !== other) {
        cls = deleted ? 'del' : 'add';
      }
      return `<span class="diff-line ${cls}">${escapeHtml(line)}</span>`;
    }).join('\n');
    return spans;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function getBaseName(filePath) {
    if (!filePath) return '';
    const cleanPath = filePath.replace(/\\/g, '/');
    return cleanPath.split('/').pop();
  }

  // Deeply strip ignored keys from JSON object
  function stripIgnoredKeys(obj, keysToIgnore) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => stripIgnoredKeys(item, keysToIgnore));
    }

    const result = {};
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const shouldIgnore = keysToIgnore.some(ignoreKey => 
          ignoreKey.toLowerCase().trim() === k.toLowerCase().trim()
        );

        if (shouldIgnore) {
          result[k] = "<escluso dal confronto>";
        } else {
          result[k] = stripIgnoredKeys(obj[k], keysToIgnore);
        }
      }
    }
    return result;
  }

  function processContent(content, filename) {
    if (!content) return '';
    const clean = content.replace(/^\ufeff/, '').trim();
    try {
      let parsed = JSON.parse(clean);
      if (_exclusionsEnabled) {
        const baseName = getBaseName(filename);
        const keysToIgnore = _exclusions[baseName] || [];
        if (keysToIgnore.length > 0) {
          parsed = stripIgnoredKeys(parsed, keysToIgnore);
        }
      }
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
      return clean;
    }
  }

  let _lastData = null;
  let _currentGrouping = 'none'; // 'none', 'folder', 'node'
  let _hideEqual       = false;  // true to hide equal files from rendering

  // ── Render compare results into #compare-results ─────────
  function render(data) {
    _lastData = data;
    const container = document.getElementById('compare-results');
    const filterContainer = document.getElementById('compare-filter-container');
    const filterInput = document.getElementById('compare-filter-input');
    const groupSelect = document.getElementById('compare-group-select');
    
    if (!container) return;

    const { left, right, files } = data;

    if (!files || files.length === 0) {
      if (filterContainer) filterContainer.classList.add('hidden');
      container.innerHTML = `
        <div class="empty-state" style="padding:40px;">
          <div class="empty-icon">📂</div>
          <h3>Nessun file di configurazione trovato per il confronto</h3>
          <p>Le cartelle selezionate potrebbero essere vuote o non accessibili.</p>
        </div>
      `;
      return;
    }

    // Reset and show filter + grouping controls
    if (filterContainer) {
      if (filterInput) filterInput.value = '';
      if (groupSelect) {
        groupSelect.value = _currentGrouping;
        if (!groupSelect.dataset.bound) {
          groupSelect.addEventListener('change', e => {
            _currentGrouping = e.target.value;
            applyFilterAndGroup(filterInput ? filterInput.value : '');
          });
          groupSelect.dataset.bound = 'true';
        }
      }
      const hideEqualCheckbox = document.getElementById('compare-hide-equal');
      if (hideEqualCheckbox) {
        hideEqualCheckbox.checked = _hideEqual;
        if (!hideEqualCheckbox.dataset.bound) {
          hideEqualCheckbox.addEventListener('change', e => {
            _hideEqual = e.target.checked;
            applyFilterAndGroup(filterInput ? filterInput.value : '');
          });
          hideEqualCheckbox.dataset.bound = 'true';
        }
      }
      
      filterContainer.classList.remove('hidden');
      
      // Bind input listener if not already bound
      if (filterInput && !filterInput.dataset.bound) {
        filterInput.addEventListener('input', () => {
          applyFilterAndGroup(filterInput.value);
        });
        filterInput.dataset.bound = 'true';
      }
    }

    updateQuickExclIndicator();
    applyFilterAndGroup('');
  }

  function applyFilterAndGroup(query) {
    if (!_lastData || !_lastData.files) return;
    const q = query.toLowerCase().trim();
    
    // 1. Process files first (exclusions & status calculation)
    const processed = _lastData.files.map(f => {
      const processedA = processContent(f.contentA, f.file);
      const processedB = processContent(f.contentB, f.file);
      
      let status = f.status;
      if (f.contentA && f.contentB) {
        if (processedA === processedB) {
          status = 'equal';
        } else {
          status = 'modified';
        }
      }
      return {
        ...f,
        status,
        processedA,
        processedB
      };
    });

    // 2. Filter by search query
    let filtered = processed;
    if (q) {
      filtered = filtered.filter(f => f.file.toLowerCase().includes(q));
    }

    // 3. Filter by hideEqual checkbox
    if (_hideEqual) {
      filtered = filtered.filter(f => f.status !== 'equal');
    }

    renderList(filtered);
  }

  function renderList(processedFiles) {
    const container = document.getElementById('compare-results');
    if (!container || !_lastData) return;

    const { left, right } = _lastData;

    // Calculate total stats from ALL files (using processContent to respect active exclusions)
    const counts = { equal: 0, modified: 0, added: 0, removed: 0 };
    _lastData.files.forEach(f => {
      const processedA = processContent(f.contentA, f.file);
      const processedB = processContent(f.contentB, f.file);
      let status = f.status;
      if (f.contentA && f.contentB) {
        if (processedA === processedB) {
          status = 'equal';
        } else {
          status = 'modified';
        }
      }
      if (counts[status] !== undefined) counts[status]++;
    });

    let html = `
      <div class="diff-stats">
        ${counts.equal    ? `<div class="diff-stat equal">✓ ${counts.equal} uguali</div>` : ''}
        ${counts.modified ? `<div class="diff-stat modified">✏ ${counts.modified} modificati</div>` : ''}
        ${counts.added    ? `<div class="diff-stat added">+ ${counts.added} aggiunti</div>` : ''}
        ${counts.removed  ? `<div class="diff-stat removed">− ${counts.removed} rimossi</div>` : ''}
      </div>
    `;

    if (processedFiles.length === 0) {
      html += `
        <div class="empty-state" style="padding:20px;">
          <h3>Nessun file corrispondente al filtro</h3>
        </div>
      `;
      container.innerHTML = html;
      return;
    }

    // Helper functions for parsing folder and node names
    function getFolder(filePath) {
      const parts = filePath.replace(/\\/g, '/').split('/');
      if (parts.length <= 1) return 'Root';
      parts.pop(); // Remove filename
      return parts.join('/');
    }

    function getNode(filePath) {
      const parts = filePath.replace(/\\/g, '/').split('/');
      if (parts.length <= 1) return 'Root (Base)';
      return parts[0];
    }

    // Grouping
    let groups = {};
    if (_currentGrouping === 'folder') {
      processedFiles.forEach(f => {
        const key = getFolder(f.file);
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      });
    } else if (_currentGrouping === 'node') {
      processedFiles.forEach(f => {
        const key = getNode(f.file);
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      });
    } else {
      groups['all'] = processedFiles;
    }

    // Sort group keys
    const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'Root' || a === 'Root (Base)') return -1;
      if (b === 'Root' || b === 'Root (Base)') return 1;
      return a.localeCompare(b);
    });

    let fileIdx = 0;

    sortedGroupKeys.forEach(groupKey => {
      const groupFiles = groups[groupKey];

      if (_currentGrouping !== 'none') {
        const icon = _currentGrouping === 'folder' ? '📁' : '🏢';
        html += `
          <div class="diff-group-header" style="margin-top:20px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border);display:flex;align-items:center;gap:8px;">
            <span style="font-size:15px">${icon}</span>
            <span style="font-weight:700;font-size:12px;color:var(--text-accent);text-transform:uppercase;letter-spacing:.5px">${escapeHtml(groupKey)}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-left:4px;font-weight:normal">(${groupFiles.length} file)</span>
          </div>
        `;
      }

      html += `<div class="diff-file-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">`;

      groupFiles.forEach(f => {
        const { linesA, linesB } = diffLines(f.processedA, f.processedB);
        const sideA = renderSide(linesA, linesB, true);
        const sideB = renderSide(linesB, linesA, false);
        const currentIdx = fileIdx++;

        html += `
          <div class="diff-file" id="diff-file-${currentIdx}">
            <div class="diff-file-header" data-idx="${currentIdx}">
              <span class="diff-file-name">📄 ${escapeHtml(f.file)}</span>
              <span class="diff-status ${f.status}">${statusLabel(f.status)}</span>
              ${f.status === 'modified' ? `<button class="btn btn-sm btn-action align-btn" style="margin-left:8px; padding: 2px 8px; font-size: 11px;" data-file="${escapeHtml(f.file)}" onclick="Compare.handleAction(event, 'align', this)">Allinea</button>` : ''}
              ${f.status === 'removed' ? `<button class="btn btn-sm btn-action release-btn" style="margin-left:8px; padding: 2px 8px; font-size: 11px;" data-file="${escapeHtml(f.file)}" onclick="Compare.handleAction(event, 'release', this)">Rilascia</button>` : ''}
              ${f.status === 'added' ? `<button class="btn btn-sm btn-action remove-btn" style="margin-left:8px; padding: 2px 8px; font-size: 11px;" data-file="${escapeHtml(f.file)}" onclick="Compare.handleAction(event, 'remove', this)">Rimuovi</button>` : ''}
              <span class="diff-arrow" style="color:var(--text-muted);font-size:11px;margin-left:auto;width:12px;text-align:center">▼</span>
            </div>
            <div class="diff-content" id="diff-content-${currentIdx}">
              <div class="diff-side">
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border);display:flex;align-items:center;">
                  ← ${escapeHtml(left.user || 'DEFAULT')} @ ${escapeHtml(left.node)} ${left.appServer ? `<span class="badge badge-server">${escapeHtml(left.appServer)}</span>` : ''}
                </div>
                ${f.contentA ? sideA : '<span style="color:var(--text-muted);font-style:italic">File non presente</span>'}
              </div>
              <div class="diff-side">
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border);display:flex;align-items:center;">
                  → ${escapeHtml(right.user || 'DEFAULT')} @ ${escapeHtml(right.node)} ${right.appServer ? `<span class="badge badge-server">${escapeHtml(right.appServer)}</span>` : ''}
                </div>
                ${f.contentB ? sideB : '<span style="color:var(--text-muted);font-style:italic">File non presente</span>'}
              </div>
            </div>
          </div>
        `;
      });

      html += `</div>`;
    });

    container.innerHTML = html;

    // Toggle on header click
    container.querySelectorAll('.diff-file-header').forEach(header => {
      header.addEventListener('click', () => {
        const idx     = header.dataset.idx;
        const content = document.getElementById(`diff-content-${idx}`);
        const isOpen  = content.classList.toggle('open');
        const arrow   = header.querySelector('.diff-arrow');
      });
    });

    const searchUi = document.getElementById('compare-text-search-ui');
    if (searchUi) searchUi.classList.remove('hidden');

    _textSearch = new TextSearch(container);
    const searchInput = document.getElementById('compare-text-search-input');
    const countEl = document.getElementById('compare-text-search-count');
    if (searchInput && searchInput.value) {
      _textSearch.search(searchInput.value);
    }
    if (countEl) {
      if (_textSearch.matches.length === 0) countEl.textContent = '0/0';
      else countEl.textContent = `${_textSearch.currentIndex + 1}/${_textSearch.matches.length}`;
    }
  }

  function statusLabel(s) {
    const map = { equal: '= Uguale', modified: '✏ Modificato', added: '+ Aggiunto', removed: '− Rimosso' };
    return map[s] || s;
  }

  function clear() {
    _lastData = null;
    const el = document.getElementById('compare-results');
    if (el) el.innerHTML = '';
    const filterContainer = document.getElementById('compare-filter-container');
    if (filterContainer) filterContainer.classList.add('hidden');
  }

  function removeExclusionRule(file, prop = null) {
    if (_exclusions[file]) {
      if (prop) {
        _exclusions[file] = _exclusions[file].filter(p => p !== prop);
        if (_exclusions[file].length === 0) delete _exclusions[file];
      } else {
        delete _exclusions[file];
      }
      saveExclusionsToStorage();
      renderExclusionsList();
    }
  }

  function renderExclusionsList() {
    const listContainer = document.getElementById('exclusions-list-container');
    if (!listContainer) return;

    const fileKeys = Object.keys(_exclusions).sort();
    let html = '';

    if (fileKeys.length === 0) {
      listContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          Nessuna regola di esclusione configurata.
        </div>
      `;
      return;
    }

    fileKeys.forEach(file => {
      const props = _exclusions[file];
      if (props.length === 0) return;

      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border);">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">📄 ${escapeHtml(file)}</span>
            <span style="font-size: 11px; color: var(--text-muted);">Tag esclusi: ${props.map(p => `<strong style="color:var(--text-accent)">${escapeHtml(p)}</strong>`).join(', ')}</span>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="Compare.removeExclusionRule('${escapeHtml(file)}')" title="Rimuovi regola" style="color: var(--danger); font-size:14px; padding:4px 8px;">✕</button>
        </div>
      `;
    });

    listContainer.innerHTML = html;
  }

  function updateQuickExclIndicator() {
    const indicator = document.getElementById('compare-excl-indicator');
    if (!indicator) return;

    const ruleCount = Object.keys(_exclusions).length;
    if (ruleCount === 0) {
      indicator.classList.add('hidden');
      return;
    }

    indicator.classList.remove('hidden');

    if (_exclusionsEnabled) {
      indicator.innerHTML = `
        <span style="color:var(--warning);display:flex;align-items:center;gap:4px">⚠️ Esclusioni applicate (${ruleCount} file)</span>
        <button id="btn-quick-toggle-excl" class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:11px;color:var(--accent-bright);border:1px solid rgba(61,127,255,.2)">Disattiva</button>
      `;
    } else {
      indicator.innerHTML = `
        <span style="color:var(--text-muted)">Esclusioni disattivate</span>
        <button id="btn-quick-toggle-excl" class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:11px;color:var(--warning);border:1px solid rgba(245,158,11,.2)">Attiva</button>
      `;
    }

    // Bind quick toggle listener
    const btn = document.getElementById('btn-quick-toggle-excl');
    if (btn) {
      btn.addEventListener('click', () => {
        _exclusionsEnabled = !_exclusionsEnabled;
        saveExclusionsToStorage();
        updateQuickExclIndicator();
        
        // Refresh checkboxes in modal if open
        const activeCheckbox = document.getElementById('exclusions-active-checkbox');
        if (activeCheckbox) activeCheckbox.checked = _exclusionsEnabled;

        // Re-render compare
        if (_lastData) {
          const filterInput = document.getElementById('compare-filter-input');
          applyFilterAndGroup(filterInput ? filterInput.value : '');
        }
        Toast.success(_exclusionsEnabled ? 'Esclusioni attivate' : 'Esclusioni disattivate');
      });
    }
  }

  function initExclusionsModal() {
    const btnManage = document.getElementById('btn-manage-exclusions');
    const modal = document.getElementById('modal-exclusions');
    const btnClose = document.getElementById('btn-close-exclusions');
    const btnAdd = document.getElementById('btn-add-exclusion');
    const btnClear = document.getElementById('btn-clear-all-exclusions');
    const btnSave = document.getElementById('btn-save-exclusions');
    const activeCheckbox = document.getElementById('exclusions-active-checkbox');

    if (!btnManage || !modal) return;

    // Load state
    loadExclusionsFromStorage();

    // Open modal
    btnManage.addEventListener('click', () => {
      loadExclusionsFromStorage();
      activeCheckbox.checked = _exclusionsEnabled;
      renderExclusionsList();
      modal.classList.remove('hidden');
      document.getElementById('excl-filename').value = '';
      document.getElementById('excl-property').value = '';
    });

    // Close modal
    const closeModal = () => modal.classList.add('hidden');
    if (btnClose) btnClose.addEventListener('click', closeModal);
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });

    // Add exclusion rule
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        const file = document.getElementById('excl-filename').value.trim();
        const prop = document.getElementById('excl-property').value.trim();

        if (!file || !prop) {
          Toast.error('Inserisci sia il nome del file che il tag da escludere.');
          return;
        }

        if (!_exclusions[file]) _exclusions[file] = [];
        if (!_exclusions[file].includes(prop)) {
          _exclusions[file].push(prop);
        }

        document.getElementById('excl-property').value = '';
        document.getElementById('excl-property').focus();

        renderExclusionsList();
      });
    }

    // Clear all
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('Sei sicuro di voler rimuovere tutte le regole di esclusione?')) {
          _exclusions = {};
          saveExclusionsToStorage();
          renderExclusionsList();
        }
      });
    }

    // Save and apply
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        _exclusionsEnabled = activeCheckbox.checked;
        saveExclusionsToStorage();
        closeModal();
        Toast.success('Esclusioni salvate e applicate');
        
        // Re-render compare
        if (_lastData) {
          const filterInput = document.getElementById('compare-filter-input');
          applyFilterAndGroup(filterInput ? filterInput.value : '');
        }
        updateQuickExclIndicator();
      });
    }
  }

  function extractKeyFromLine(line) {
    if (!line) return null;
    const match = line.match(/"([^"]+)"\s*:/);
    if (match) {
      return match[1];
    }
    return null;
  }

  function initContextMenu() {
    const resultsContainer = document.getElementById('compare-results');
    const menu = document.getElementById('compare-context-menu');
    const btnContext = document.getElementById('btn-context-exclude');

    if (!resultsContainer || !menu) return;

    // Show context menu on right click
    resultsContainer.addEventListener('contextmenu', e => {
      const lineEl = e.target.closest('.diff-line');
      if (!lineEl) {
        menu.classList.add('hidden');
        return;
      }

      // Only allow excluding if the line is modified (del or add)
      if (!lineEl.classList.contains('del') && !lineEl.classList.contains('add')) {
        menu.classList.add('hidden');
        return;
      }

      const key = extractKeyFromLine(lineEl.textContent);
      if (!key) {
        menu.classList.add('hidden');
        return;
      }

      const diffFileEl = lineEl.closest('.diff-file');
      if (!diffFileEl) return;

      const filenameEl = diffFileEl.querySelector('.diff-file-name');
      if (!filenameEl) return;

      const fullPath = filenameEl.textContent.replace('📄', '').trim();
      const baseName = getBaseName(fullPath);

      e.preventDefault();

      const span = document.getElementById('context-key-name');
      if (span) span.textContent = key;

      menu.style.left = `${e.pageX}px`;
      menu.style.top = `${e.pageY}px`;
      menu.classList.remove('hidden');

      menu.dataset.file = baseName;
      menu.dataset.key = key;
    });

    // Hide menu on clicking elsewhere
    document.addEventListener('click', () => {
      menu.classList.add('hidden');
    });

    // Hide menu on scrolling
    document.addEventListener('scroll', () => {
      menu.classList.add('hidden');
    }, true);

    // Exclude button handler
    if (btnContext) {
      btnContext.addEventListener('click', () => {
        const file = menu.dataset.file;
        const key = menu.dataset.key;
        if (!file || !key) return;

        if (!_exclusions[file]) _exclusions[file] = [];
        if (!_exclusions[file].includes(key)) {
          _exclusions[file].push(key);
          saveExclusionsToStorage();
          Toast.success(`Escluso tag "${key}" dal file "${file}"`);
          
          // Re-render comparison
          _exclusionsEnabled = true;
          saveExclusionsToStorage();
          
          const filterInput = document.getElementById('compare-filter-input');
          applyFilterAndGroup(filterInput ? filterInput.value : '');
          updateQuickExclIndicator();
        } else {
          Toast.info(`Il tag "${key}" è già escluso per "${file}"`);
        }
        menu.classList.add('hidden');
      });
    }
  }

  function scrollToNextDifference() {
    const diffFiles = Array.from(document.querySelectorAll('.diff-file:not(.equal)'));
    if (diffFiles.length === 0) {
      Toast.info('Nessuna differenza trovata.');
      return;
    }

    const scrollContainer = document.querySelector('.panel-body');
    if (!scrollContainer) return;

    let targetEl = null;
    const containerRect = scrollContainer.getBoundingClientRect();

    for (let i = 0; i < diffFiles.length; i++) {
      const rect = diffFiles[i].getBoundingClientRect();
      if (rect.top > containerRect.top + 15) {
        targetEl = diffFiles[i];
        break;
      }
    }

    if (!targetEl) {
      targetEl = diffFiles[0];
    }

    if (targetEl) {
      const targetScrollTop = targetEl.getBoundingClientRect().top - containerRect.top + scrollContainer.scrollTop - 10;
      scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });

      const header = targetEl.querySelector('.diff-file-header');
      if (header) {
        const originalBg = header.style.backgroundColor;
        const originalTransition = header.style.transition;
        header.style.transition = 'background-color 0.15s ease-in-out';
        header.style.backgroundColor = 'rgba(61, 127, 255, 0.25)';
        
        setTimeout(() => {
          header.style.backgroundColor = originalBg;
          setTimeout(() => {
            header.style.transition = originalTransition;
          }, 300);
        }, 600);
      }
    }
  }

  function initNextDiffButton() {
    const btn = document.getElementById('btn-next-diff');
    if (btn) {
      btn.addEventListener('click', scrollToNextDifference);
    }
  }

  function initTextSearch() {
    const searchInput = document.getElementById('compare-text-search-input');
    const prevBtn = document.getElementById('compare-text-search-prev');
    const nextBtn = document.getElementById('compare-text-search-next');
    const countEl = document.getElementById('compare-text-search-count');

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
  }

  async function handleAction(event, action, btnEl) {
    event.stopPropagation();
    try {
      console.log('handleAction started:', action, btnEl.getAttribute('data-file'));
      const fileKey = btnEl.getAttribute('data-file');
      const f = _lastData.files.find(x => x.file === fileKey);
      if (!f) {
        Toast.error("Impossibile trovare il file nei dati in memoria.");
        return;
      }
      
      const right = _lastData.right;
      
      let subPath = '';
      let fileName = f.file;
      if (f.file.includes('\\')) {
        subPath = f.file.substring(0, f.file.lastIndexOf('\\'));
        fileName = f.file.substring(f.file.lastIndexOf('\\') + 1);
      } else if (f.file.includes('/')) {
        subPath = f.file.substring(0, f.file.lastIndexOf('/'));
        fileName = f.file.substring(f.file.lastIndexOf('/') + 1);
      }

      if (action === 'align' || action === 'release') {
        let content = f.contentA;
        if (!content) {
          Toast.error("Contenuto sorgente assente.");
          return;
        }

        const rightServer = _lastData.right.appServer;
        console.log('Checking for URLs. rightServer:', rightServer);
        
        // Trova domini da URL http/https presenti nel file
        const urlRegex = /https?:\/\/([^/"'\\>\s?#]+)/gi;
        const matches = [...content.matchAll(urlRegex)];
        console.log('Regex matches:', matches.length);
        
        let urlReplaced = false;
        
        if (matches.length > 0 && rightServer) {
          const uniqueDomains = [...new Set(matches.map(m => m[1]))];
          const ignoreList = ['w3.org', 'json-schema.org', 'schemas.microsoft.com'];
          
          const domainsToReplace = uniqueDomains.filter(d => {
            const dl = d.toLowerCase();
            return !ignoreList.some(ignore => dl.includes(ignore));
          });

          console.log('Domains to replace:', domainsToReplace);

          if (domainsToReplace.length > 0) {
            const autoReplace = document.getElementById('compare-auto-replace-url')?.checked;
            let doReplace = autoReplace;

            if (!autoReplace) {
              const confirmMsg = `Nel file sono stati individuati indirizzi HTTP/HTTPS con i seguenti domini:\n`
                + domainsToReplace.map(d => `- ${d}`).join('\n')
                + `\n\nVuoi sostituirli con l'indirizzo di destinazione (${rightServer}) prima di procedere?`;
              doReplace = confirm(confirmMsg);
            }
              
            if (doReplace) {
              domainsToReplace.forEach(domain => {
                content = content.replaceAll(domain, rightServer);
              });
              urlReplaced = true;
            }
          }
        }
        
        try {
          const originalText = btnEl.textContent;
          btnEl.textContent = '⏳...';
          btnEl.disabled = true;

          console.log('Starting upload...');
          await API.uploadFile(content, fileName, subPath, right.node, right.user, 'B');
          console.log('Upload completed');
          
          btnEl.textContent = urlReplaced ? '✓ Fatto (URL agg.)' : '✓ Fatto';
          btnEl.classList.remove('btn-ghost');
          btnEl.style.backgroundColor = 'var(--success)';
          btnEl.style.color = 'white';
          btnEl.style.borderColor = 'var(--success)';
        } catch (e) {
          Toast.error("Errore durante l'upload: " + e.message);
          btnEl.textContent = "Errore";
          btnEl.disabled = false;
        }
      } else if (action === 'remove') {
        try {
          const originalText = btnEl.textContent;
          btnEl.textContent = '⏳...';
          btnEl.disabled = true;

          await API.removeFile(fileName, subPath, right.node, right.user, 'B');
          
          btnEl.textContent = '✓ Rimosso';
          btnEl.classList.remove('btn-ghost');
          btnEl.style.backgroundColor = 'var(--success)';
          btnEl.style.color = 'white';
          btnEl.style.borderColor = 'var(--success)';
        } catch (e) {
          Toast.error("Errore durante la rimozione: " + e.message);
          btnEl.textContent = "Errore";
          btnEl.disabled = false;
        }
      }
    } catch (unexpectedError) {
      console.error('Unexpected error in handleAction:', unexpectedError);
      Toast.error("Errore imprevisto nel rilascio: " + unexpectedError.message);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initExclusionsModal();
    initContextMenu();
    initNextDiffButton();
    initTextSearch();
  });

  return { render, clear, removeExclusionRule, handleAction };
})();
