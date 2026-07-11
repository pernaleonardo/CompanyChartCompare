/**
 * search.js — Global widget and configuration file search logic
 */

const WidgetSearch = (() => {

  const $ = id => document.getElementById(id);

  function init() {
    const btnSearch = $('btn-global-search');
    const btnRun    = $('btn-run-global-search');
    const input     = $('global-search-input');

    if (btnSearch) {
      btnSearch.addEventListener('click', openSearchPanel);
    }
    if (btnRun) {
      btnRun.addEventListener('click', runSearch);
    }
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') runSearch();
      });
    }
  }

  function openSearchPanel() {
    // Hide node panel and empty state
    $('empty-state').classList.add('hidden');
    $('node-panel').classList.add('hidden');
    
    // Show search panel
    const searchPanel = $('widget-search-panel');
    searchPanel.classList.remove('hidden');

    // Deselect tree rows
    document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));

    $('global-search-input').focus();
  }

  async function runSearch() {
    const query = $('global-search-input').value.trim();
    const container = $('global-search-results');

    if (!query) {
      Toast.error('Inserisci una chiave di ricerca');
      return;
    }

    container.innerHTML = `
      <div style="padding:40px;text-align:center">
        <div class="spinner" style="margin:auto"></div>
        <p class="loading-text" style="margin-top:12px">Ricerca in tutta la gerarchia (questo processo potrebbe richiedere qualche secondo)...</p>
      </div>
    `;

    try {
      const data = await API.searchWidgets(query, activeSide);
      renderResults(data.results, query);
    } catch (err) {
      container.innerHTML = `
        <div class="alert alert-error" style="margin:16px">
          Errore durante la ricerca: ${err.message}
        </div>
      `;
    }
  }

  function renderResults(results, query) {
    const container = $('global-search-results');
    if (!results || results.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>Nessun file trovato per "${escapeHtml(query)}"</h3>
          <p>Prova ad inserire un nome parziale o controlla il componente attivo.</p>
        </div>
      `;
      return;
    }

    let html = `
      <h3 style="font-size:14px;color:var(--text-secondary);margin-bottom:12px">
        Trovati corrispondenze in ${results.length} nodi:
      </h3>
      <div class="search-results-list" style="display:flex;flex-direction:column;gap:16px">
    `;

    results.forEach(res => {
      html += `
        <div style="background:var(--surface-raised);border:1px solid var(--border);border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,.05);padding-bottom:8px;flex-wrap:wrap;gap:8px">
            <span style="font-weight:700;color:var(--text-accent);font-size:15px;cursor:pointer" onclick="selectNodeFromSearch('${escapeHtml(res.node)}')">🏢 ${escapeHtml(res.node)}</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" onclick="selectNodeFromSearch('${escapeHtml(res.node)}')">👁 Dettagli</button>
              <button class="btn btn-sm btn-ghost" style="color:var(--text-accent)" onclick="setSearchCompareSide('A','${escapeHtml(res.node)}')">← Set Lato A</button>
              <button class="btn btn-sm btn-ghost" style="color:var(--accent-bright)" onclick="setSearchCompareSide('B','${escapeHtml(res.node)}')">→ Set Lato B</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
      `;

      res.matches.forEach(m => {
        const icon = getFileIcon(m.filename);
        html += `
          <div class="fb-entry" style="padding:8px 12px;background:var(--bg-base);border-radius:6px;border:1px solid transparent;cursor:default">
            <span class="fb-icon">${icon}</span>
            <div style="display:flex;flex-direction:column;flex:1;min-width:0">
              <span style="font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.filename)}</span>
              <span style="font-size:11px;color:var(--text-muted)">${escapeHtml(m.subPath || 'Root')}</span>
            </div>
            <button class="btn btn-sm btn-ghost" onclick="viewFileFromSearch('${escapeHtml(res.node)}','${escapeHtml(m.subPath)}','${escapeHtml(m.filename)}')">👁 Visualizza</button>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  function getFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const icons = { json: '📋', zip: '📦', xml: '📰', csv: '📊', sql: '🗄️', txt: '📝' };
    return icons[ext] || '📄';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, openSearchPanel };
})();

// Expose click helper functions globally for inline onclick handlers
window.selectNodeFromSearch = function(nodeAlias) {
  // Hide search panel
  $('widget-search-panel').classList.add('hidden');
  
  // Use robust tree expand & select
  const success = Tree.selectNodeByAlias(nodeAlias);
  if (!success) {
    Toast.error('Impossibile trovare il nodo specificato nella gerarchia');
  }
};

window.viewFileFromSearch = function(nodeAlias, subPath, filename) {
  // Hide search panel
  $('widget-search-panel').classList.add('hidden');
  
  // Open node panel and select the node (simulate tree selection first)
  const success = Tree.selectNodeByAlias(nodeAlias);
  if (success) {
    // After selection, switch immediately to viewer tab and open the specific file
    setTimeout(async () => {
      switchTab('viewer');
      // Set state and fetch in Viewer
      Viewer.show(nodeAlias, '', activeSide); // DEFAULT user
      
      // Wait for file browser to load, then select & open file
      setTimeout(() => {
        const fileBrowser = document.getElementById('viewer-file-browser');
        if (fileBrowser) {
          Toast.info(`Struttura di ${nodeAlias} caricata. Cerca "${filename}" nel file browser.`);
        }
      }, 800);
    }, 150);
  } else {
    Toast.error('Impossibile caricare il nodo specificato');
  }
};

window.setSearchCompareSide = function(side, nodeAlias) {
  // Populate nodes selects in Compare if not already done
  $('cmp-node' + side).value = nodeAlias;
  
  // Populate users lists for that side
  populateCompareUsers(side, nodeAlias);
  
  // Pre-select DEFAULT user
  $(`cmp-user${side}`).value = 'DEFAULT';

  Toast.success(`Confronto: Nodo ${side} impostato su ${nodeAlias} (DEFAULT)`);

  const nodeA = $('cmp-nodeA').value;
  const nodeB = $('cmp-nodeB').value;

  if (nodeA && nodeB) {
    // Hide search panel
    $('widget-search-panel').classList.add('hidden');
    
    // Show node panel which contains the compare tab
    $('node-panel').classList.remove('hidden');
    
    // Switch to compare tab
    switchTab('compare');
    
    // Auto-run comparison
    Toast.info('Avvio confronto automatico in corso...');
    setTimeout(() => {
      runCompare();
    }, 150);
  }
};

document.addEventListener('DOMContentLoaded', WidgetSearch.init);
