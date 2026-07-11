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

  // ── Render compare results into #compare-results ─────────
  function render(data) {
    _lastData = data;
    const container = document.getElementById('compare-results');
    const filterContainer = document.getElementById('compare-filter-container');
    const filterInput = document.getElementById('compare-filter-input');
    
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

    // Reset and show filter input
    if (filterContainer && filterInput) {
      filterInput.value = '';
      filterContainer.classList.remove('hidden');
      
      // Bind input listener if not already bound
      if (!filterInput.dataset.bound) {
        filterInput.addEventListener('input', () => {
          applyFilter(filterInput.value);
        });
        filterInput.dataset.bound = 'true';
      }
    }

    renderList(files);
  }

  function applyFilter(query) {
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
      <div class="diff-file-list">
    `;

    if (filesList.length === 0) {
      html += `
        <div class="empty-state" style="padding:20px;">
          <h3>Nessun file corrispondente al filtro</h3>
        </div>
      `;
    }

    filesList.forEach((f, idx) => {
      const { linesA, linesB } = diffLines(f.contentA, f.contentB);
      const sideA = renderSide(linesA, linesB, true);
      const sideB = renderSide(linesB, linesA, false);

      // Collapsed by default (no 'open' class is added initially)
      html += `
        <div class="diff-file" id="diff-file-${idx}">
          <div class="diff-file-header" data-idx="${idx}">
            <span class="diff-file-name">📄 ${escapeHtml(f.file)}</span>
            <span class="diff-status ${f.status}">${statusLabel(f.status)}</span>
            <span class="diff-arrow" style="color:var(--text-muted);font-size:11px;margin-left:auto;width:12px;text-align:center">▼</span>
          </div>
          <div class="diff-content" id="diff-content-${idx}">
            <div class="diff-side">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border)">
                ← ${escapeHtml(left.user || 'DEFAULT')} @ ${escapeHtml(left.node)}
              </div>
              ${f.contentA ? sideA : '<span style="color:var(--text-muted);font-style:italic">File non presente</span>'}
            </div>
            <div class="diff-side">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border)">
                → ${escapeHtml(right.user || 'DEFAULT')} @ ${escapeHtml(right.node)}
              </div>
              ${f.contentB ? sideB : '<span style="color:var(--text-muted);font-style:italic">File non presente</span>'}
            </div>
          </div>
        </div>
      `;
    });

    html += '</div>';
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
