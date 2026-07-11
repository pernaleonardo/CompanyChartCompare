/**
 * compare.js — Side-by-side diff view for configurations
 */

const Compare = (() => {

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
      .replace(/>/g,'&gt;');
  }

  let _lastData = null;
  let _currentGrouping = 'none'; // 'none', 'folder', 'node'

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
      
      filterContainer.classList.remove('hidden');
      
      // Bind input listener if not already bound
      if (filterInput && !filterInput.dataset.bound) {
        filterInput.addEventListener('input', () => {
          applyFilterAndGroup(filterInput.value);
        });
        filterInput.dataset.bound = 'true';
      }
    }

    renderList(files);
  }

  function applyFilterAndGroup(query) {
    if (!_lastData || !_lastData.files) return;
    const q = query.toLowerCase().trim();
    
    const filteredFiles = _lastData.files.filter(f => 
      f.file.toLowerCase().includes(q)
    );

    renderList(filteredFiles);
  }

  function renderList(filesList) {
    const container = document.getElementById('compare-results');
    if (!container || !_lastData) return;

    const { left, right } = _lastData;

    // Stats on filtered files
    const counts = { equal: 0, modified: 0, added: 0, removed: 0 };
    filesList.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });

    let html = `
      <div class="diff-stats">
        ${counts.equal    ? `<div class="diff-stat equal">✓ ${counts.equal} uguali</div>` : ''}
        ${counts.modified ? `<div class="diff-stat modified">✏ ${counts.modified} modificati</div>` : ''}
        ${counts.added    ? `<div class="diff-stat added">+ ${counts.added} aggiunti</div>` : ''}
        ${counts.removed  ? `<div class="diff-stat removed">− ${counts.removed} rimossi</div>` : ''}
      </div>
    `;

    if (filesList.length === 0) {
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

    // Node is usually the first folder segment
    function getNode(filePath) {
      const parts = filePath.replace(/\\/g, '/').split('/');
      if (parts.length <= 1) return 'Root (Base)';
      return parts[0];
    }

    // Grouping
    let groups = {};
    if (_currentGrouping === 'folder') {
      filesList.forEach(f => {
        const key = getFolder(f.file);
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      });
    } else if (_currentGrouping === 'node') {
      filesList.forEach(f => {
        const key = getNode(f.file);
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      });
    } else {
      groups['all'] = filesList;
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
        const { linesA, linesB } = diffLines(f.contentA, f.contentB);
        const sideA = renderSide(linesA, linesB, true);
        const sideB = renderSide(linesB, linesA, false);
        const currentIdx = fileIdx++;

        html += `
          <div class="diff-file" id="diff-file-${currentIdx}">
            <div class="diff-file-header" data-idx="${currentIdx}">
              <span class="diff-file-name">📄 ${escapeHtml(f.file)}</span>
              <span class="diff-status ${f.status}">${statusLabel(f.status)}</span>
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
        if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
      });
    });
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

  return { render, clear };
})();
