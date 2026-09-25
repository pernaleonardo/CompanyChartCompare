/**
 * search.js — Global widget and configuration file search logic
 */

const WidgetSearch = (() => {

  let _lastSearchResults = [];
  let _lastSearchQuery = '';

  const $ = id => document.getElementById(id);

  function init() {
    const btnSearch = $('btn-global-search');
    const btnRun    = $('btn-run-global-search');
    const btnReplace = $('btn-run-global-replace');
    const input     = $('global-search-input');

    if (btnSearch) {
      btnSearch.addEventListener('click', openSearchPanel);
    }
    if (btnRun) {
      btnRun.addEventListener('click', runSearch);
    }
    if (btnReplace) {
      btnReplace.addEventListener('click', runReplace);
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
    
    const cbFile = $('cb-search-file');
    const cbTag = $('cb-search-tag');
    const cbContent = $('cb-search-content');
    
    const searchFile = cbFile ? cbFile.checked : true;
    const searchTag = cbTag ? cbTag.checked : false;
    const searchContent = cbContent ? cbContent.checked : false;

    if (!query) {
      Toast.error('Inserisci una chiave di ricerca');
      return;
    }
    
    if (!searchFile && !searchTag && !searchContent) {
      Toast.error('Seleziona almeno un criterio di ricerca (Nome, Tag o Contenuto)');
      return;
    }

    container.innerHTML = `
      <div style="padding:40px;text-align:center">
        <div class="spinner" style="margin:auto"></div>
        <p class="loading-text" style="margin-top:12px">Ricerca in corso (questo processo potrebbe richiedere qualche secondo)...</p>
      </div>
    `;

    try {
      if (searchFile && !searchTag && !searchContent) {
        // Se cerca SOLO per nome file, usiamo la vecchia logica veloce globale
        const data = await API.searchWidgets(query, activeSide);
        _lastSearchResults = data.results || [];
        _lastSearchQuery = query;
        renderResults(data.results, query, false);
      } else {
        // Altrimenti usiamo la logica iterativa
        const progressContainer = $('global-search-progress-container');
        const progressText = $('global-search-progress-text');
        const progressPercent = $('global-search-progress-percent');
        const progressFill = $('global-search-progress-fill');

        if (progressContainer) progressContainer.classList.remove('hidden');

        // 1. Recupera gerarchia per ottenere tutti i nodi
        const hierData = await API.getHierarchy(false, activeSide);
        const nodeAliases = [];
        function extractNodes(node) {
          if (node.node && node.node.alias) nodeAliases.push(node.node.alias);
          if (node.children) node.children.forEach(extractNodes);
        }
        extractNodes(hierData);

        const total = nodeAliases.length;
        let processed = 0;
        const allResults = [];
        const CONCURRENCY = 5;

        // 2. Elabora in batch
        for (let i = 0; i < total; i += CONCURRENCY) {
          const chunk = nodeAliases.slice(i, i + CONCURRENCY);
          const promises = chunk.map(async (alias) => {
            try {
              const res = await API.searchNodeContent(query, alias, { searchFile, searchTag, searchContent }, activeSide);
              if (res && res.matches && res.matches.length > 0) {
                allResults.push(res);
              }
            } catch (e) {
              console.warn(`Errore ricerca contenuto nel nodo ${alias}:`, e);
            } finally {
              processed++;
              if (progressContainer) {
                const pct = Math.round((processed / total) * 100);
                progressText.textContent = `Elaborazione nodi in corso... (${processed}/${total})`;
                progressPercent.textContent = `${pct}%`;
                progressFill.style.width = `${pct}%`;
              }
            }
          });
          await Promise.all(promises);
        }

        if (progressContainer) {
          setTimeout(() => progressContainer.classList.add('hidden'), 1000);
        }

        _lastSearchResults = allResults;
        _lastSearchQuery = query;

        renderResults(allResults, query, true);
      }
    } catch (err) {
      container.innerHTML = `
        <div class="alert alert-error" style="margin:16px">
          Errore durante la ricerca: ${err.message}
        </div>
      `;
    }
  }

  async function runReplace() {
    const replaceInput = $('global-replace-input');
    if (!replaceInput) return;
    const replaceWith = replaceInput.value;
    
    if (!_lastSearchQuery) {
      Toast.error('Esegui prima una ricerca.');
      return;
    }

    if (!_lastSearchResults || _lastSearchResults.length === 0) {
      Toast.error('Nessun risultato di ricerca su cui operare.');
      return;
    }

    let totalMatches = 0;
    _lastSearchResults.forEach(res => {
       totalMatches += res.matches.length;
    });

    if (!confirm(`Sei sicuro di voler sostituire "${_lastSearchQuery}" con "${replaceWith}" in ${totalMatches} file all'interno di ${_lastSearchResults.length} nodi e pubblicare le modifiche?`)) {
      return;
    }

    const progressContainer = $('global-search-progress-container');
    const progressText = $('global-search-progress-text');
    const progressPercent = $('global-search-progress-percent');
    const progressFill = $('global-search-progress-fill');

    if (progressContainer) progressContainer.classList.remove('hidden');

    let processed = 0;
    let replacedCount = 0;
    
    // Elabora in sequenza per non sovraccaricare il server
    for (const res of _lastSearchResults) {
      const nodeAlias = res.node;
      for (const m of res.matches) {
        try {
          // Scarica il file
          const fileData = await API.downloadSingleFile(nodeAlias, m.subPath, m.filename, '', activeSide);
          let content = fileData.content;
          
          // Sostituzione globale della chiave di ricerca con il nuovo valore
          const regex = new RegExp(_lastSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          const newContent = content.replace(regex, replaceWith);
          
          if (newContent !== content) {
            // Ricarica (pubblica) il file modificato
            await API.uploadFile(newContent, m.filename, m.subPath, nodeAlias, '', activeSide);
            replacedCount++;
          }
        } catch (e) {
          console.error(`Errore durante la sostituzione nel nodo ${nodeAlias} file ${m.filename}:`, e);
        } finally {
          processed++;
          if (progressContainer) {
            const pct = Math.round((processed / totalMatches) * 100);
            progressText.textContent = `Sostituzione in corso... (${processed}/${totalMatches})`;
            progressPercent.textContent = `${pct}%`;
            progressFill.style.width = `${pct}%`;
          }
        }
      }
    }
    
    if (progressContainer) {
      setTimeout(() => progressContainer.classList.add('hidden'), 1000);
    }
    
    Toast.success(`Sostituzione massiva completata. Modificati ${replacedCount} file su ${totalMatches}.`);
    
    // Riavvia automaticamente la ricerca con la nuova chiave? Oppure con la vecchia?
    // Meglio riavviare con la vecchia per far vedere che non c'è più nulla o con la nuova.
    // La lasciamo così: l'utente può cercare di nuovo.
  }

  function renderResults(results, query, isContentSearch) {
    const container = $('global-search-results');
    if (!results || results.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>Nessun file trovato per "${escapeHtml(query)}"</h3>
          <p>Prova ad inserire una stringa parziale o controlla il componente attivo.</p>
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
        let snippetHtml = '';
        if (m.snippet) {
          // Highlight the search term in snippet
          const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          const highlightedSnippet = escapeHtml(m.snippet).replace(regex, '<mark class="search-match current">$1</mark>');
          snippetHtml = `<div style="font-family:monospace;font-size:11px;color:var(--text-muted);background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;margin-top:4px;word-break:break-all;">${highlightedSnippet}</div>`;
        }

        html += `
          <div class="fb-entry" style="padding:8px 12px;background:var(--bg-base);border-radius:6px;border:1px solid transparent;cursor:default">
            <div style="display:flex;align-items:center;width:100%;">
              <span class="fb-icon">${icon}</span>
              <div style="display:flex;flex-direction:column;flex:1;min-width:0">
                <span style="font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.filename)}</span>
                <span style="font-size:11px;color:var(--text-muted)">${escapeHtml(m.subPath || 'Root')}</span>
              </div>
              <button class="btn btn-sm btn-ghost" onclick="viewFileFromSearch('${escapeHtml(res.node)}','${escapeHtml(m.subPath)}','${escapeHtml(m.filename)}')">👁 Visualizza</button>
            </div>
            ${snippetHtml}
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
  
  // Open node panel and select the node (simulate tree selection first, without triggering onSelect that clears the viewer)
  const success = Tree.selectNodeByAlias(nodeAlias, true);
  if (success) {
    // Show the node panel explicitly since we suppressed the tree event
    $('node-panel').classList.remove('hidden');

    // After selection, switch immediately to viewer tab and open the specific file
    setTimeout(async () => {
      // Use the global viewConfig function to properly setup the UI (hide placeholder, show split view)
      window.viewConfig('', nodeAlias, filename);
      
      // Wait for file browser to load, then select & open file
      setTimeout(() => {
        Viewer.openFile(filename, subPath, filename);
      }, 500);
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
