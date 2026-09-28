/**
 * search.js — Global widget and configuration file search logic
 */

const WidgetSearch = (() => {

  let _lastSearchResults = [];
  let _lastSearchQuery = '';
  window.WidgetSearchBaseFile = null;

  const $ = id => document.getElementById(id);

  function init() {
    const btnSearch = $('btn-global-search');
    const btnRun    = $('btn-run-global-search');
    const btnReplace = $('btn-run-global-replace');
    const btnClearBase = $('btn-clear-base-file');
    const inputFilename = $('global-search-filename-input');
    const inputTag      = $('global-search-tag-input');

    if (btnSearch) {
      btnSearch.addEventListener('click', openSearchPanel);
    }
    if (btnRun) {
      btnRun.addEventListener('click', runSearch);
    }
    if (btnReplace) {
      btnReplace.addEventListener('click', runReplace);
    }
    if (btnClearBase) {
      btnClearBase.addEventListener('click', () => {
        window.WidgetSearchBaseFile = null;
        window.updateBaseFileBanner();
        refreshResults();
      });
    }
    
    const handleEnter = e => {
      if (e.key === 'Enter') runSearch();
    };
    if (inputFilename) inputFilename.addEventListener('keydown', handleEnter);
    if (inputTag) inputTag.addEventListener('keydown', handleEnter);

    function updateReplaceState() {
      const cbContent = $('cb-search-content');
      const isValueSearch = cbContent && cbContent.checked;
      const replaceInput = $('global-replace-input');
      
      if (btnReplace) {
        btnReplace.disabled = !isValueSearch;
        btnReplace.style.opacity = isValueSearch ? '1' : '0.4';
        btnReplace.style.cursor = isValueSearch ? 'pointer' : 'not-allowed';
      }
      if (replaceInput) {
        replaceInput.disabled = !isValueSearch;
        replaceInput.style.opacity = isValueSearch ? '1' : '0.4';
      }
    }

    if ($('cb-search-content')) $('cb-search-content').addEventListener('change', updateReplaceState);
    if ($('cb-search-tag')) $('cb-search-tag').addEventListener('change', updateReplaceState);
    if ($('cb-search-file')) $('cb-search-file').addEventListener('change', updateReplaceState);
    
    updateReplaceState();
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

    $('global-search-filename-input').focus();
  }

  async function runSearch() {
    const fileNameQuery = ($('global-search-filename-input').value || '').trim();
    const tagQuery = ($('global-search-tag-input').value || '').trim();
    
    const container = $('global-search-results');
    
    const cbFile = $('cb-search-file');
    const cbTag = $('cb-search-tag');
    const cbContent = $('cb-search-content');
    
    const searchFile = cbFile ? cbFile.checked : true;
    const searchTag = cbTag ? cbTag.checked : false;
    const searchContent = cbContent ? cbContent.checked : false;

    if (!fileNameQuery && !tagQuery) {
      Toast.error('Inserisci almeno un criterio di ricerca (Nome File o Tag/Valore)');
      return;
    }

    container.innerHTML = `
      <div style="padding:40px;text-align:center">
        <div class="spinner" style="margin:auto"></div>
        <p class="loading-text" style="margin-top:12px">Ricerca in corso (questo processo potrebbe richiedere qualche secondo)...</p>
      </div>
    `;

    try {
      if (fileNameQuery && !tagQuery) {
        // Se cerca SOLO per nome file, usiamo la vecchia logica veloce globale
        const data = await API.searchWidgets(fileNameQuery, activeSide);
        _lastSearchResults = data.results || [];
        _lastSearchQuery = fileNameQuery;
        renderResults(data.results, fileNameQuery, false);
      } else {
        // Logica AND che interroga il backend con entrambi i parametri
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
              const res = await API.searchNodeContent(fileNameQuery, tagQuery, alias, { searchFile: false, searchTag, searchContent }, activeSide);
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
        _lastSearchQuery = tagQuery || fileNameQuery;

        renderResults(allResults, _lastSearchQuery, true);
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
              <div style="display:flex;gap:4px">
                ${window.WidgetSearchBaseFile ? 
                  `<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="compareWithBaseFromSearch('${escapeJsArg(res.node)}','${escapeJsArg(m.subPath)}','${escapeJsArg(m.filename)}')">↔ Confronta</button>` 
                  : 
                  `<button class="btn btn-sm btn-ghost" style="padding:4px 8px;font-size:11px;border:1px solid var(--border)" onclick="setBaseFileFromSearch('${escapeJsArg(res.node)}','${escapeJsArg(m.subPath)}','${escapeJsArg(m.filename)}')">📌 Base</button>`
                }
                <button class="btn btn-sm btn-ghost" style="padding:4px 8px;font-size:11px" onclick="viewFileFromSearch('${escapeJsArg(res.node)}','${escapeJsArg(m.subPath)}','${escapeJsArg(m.filename)}')">👁</button>
              </div>
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
    if (s == null) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function escapeJsArg(s) {
    if (s == null) return '';
    const js = String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return escapeHtml(js);
  }

  function refreshResults() {
    renderResults(_lastSearchResults, _lastSearchQuery, true);
  }

  return { init, openSearchPanel, refreshResults };
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

window.updateBaseFileBanner = function() {
  const banner = document.getElementById('base-file-banner');
  const info = document.getElementById('base-file-info');
  if (window.WidgetSearchBaseFile) {
    info.textContent = `${window.WidgetSearchBaseFile.filename} nel nodo ${window.WidgetSearchBaseFile.node}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
};

window.setBaseFileFromSearch = async function(nodeAlias, subPath, filename) {
  try {
    const fileData = await API.downloadSingleFile(nodeAlias, subPath, filename, '', activeSide);
    let content = fileData.content;
    window.WidgetSearchBaseFile = {
      node: nodeAlias,
      subPath: subPath,
      filename: filename,
      content: content
    };
    Toast.success(`File ${filename} impostato come base per il confronto.`);
    window.updateBaseFileBanner();
    WidgetSearch.refreshResults();
  } catch (err) {
    Toast.error('Errore nel caricamento del file base: ' + err.message);
  }
};

// --- Diff Helpers ---
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

function diffLines(textA, textB) {
  const formattedA = formatIfJson(textA);
  const formattedB = formatIfJson(textB);
  const linesA = formattedA.split('\n');
  const linesB = formattedB.split('\n');
  
  const m = linesA.length;
  const n = linesB.length;
  
  // LCS Diff
  if (m * n > 9000000) { 
    // Fallback to naive if files are incredibly huge
    const alignedA = [];
    const alignedB = [];
    const max = Math.max(m, n);
    for(let i=0; i<max; i++) {
       const a = i < m ? linesA[i] : '';
       const b = i < n ? linesB[i] : '';
       if (a === b) {
           alignedA.push({text: a, type: 'equal'});
           alignedB.push({text: b, type: 'equal'});
       } else {
           alignedA.push({text: a, type: 'del'});
           alignedB.push({text: b, type: 'add'});
       }
    }
    return { alignedA, alignedB };
  }

  const dp = new Int32Array((m + 1) * (n + 1));
  function getDp(i, j) { return dp[i * (n + 1) + j]; }
  function setDp(i, j, val) { dp[i * (n + 1) + j] = val; }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        setDp(i, j, getDp(i - 1, j - 1) + 1);
      } else {
        setDp(i, j, Math.max(getDp(i - 1, j), getDp(i, j - 1)));
      }
    }
  }

  const alignedA = [];
  const alignedB = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      alignedA.unshift({ text: linesA[i - 1], type: 'equal' });
      alignedB.unshift({ text: linesB[j - 1], type: 'equal' });
      i--; j--;
    } else if (j > 0 && (i === 0 || getDp(i, j - 1) >= getDp(i - 1, j))) {
      alignedA.unshift({ text: '', type: 'empty' });
      alignedB.unshift({ text: linesB[j - 1], type: 'add' });
      j--;
    } else if (i > 0 && (j === 0 || getDp(i, j - 1) < getDp(i - 1, j))) {
      alignedA.unshift({ text: linesA[i - 1], type: 'del' });
      alignedB.unshift({ text: '', type: 'empty' });
      i--;
    }
  }

  return { alignedA, alignedB };
}

function renderSide(aligned) {
  return aligned.map(item => {
    if (item.type === 'empty') {
      return `<span class="diff-line" style="visibility: hidden; height: 1.6em;">_</span>`;
    }
    const escaped = String(item.text)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const cls = item.type === 'equal' ? '' : item.type;
    return `<span class="diff-line ${cls}">${escaped || ' '}</span>`;
  }).join('\n');
}
// ---------------------

window.compareWithBaseFromSearch = async function(nodeAlias, subPath, filename) {
  if (!window.WidgetSearchBaseFile) return;

  try {
    const fileData = await API.downloadSingleFile(nodeAlias, subPath, filename, '', activeSide);
    let content = fileData.content;

    // Store original full contents for rebuilding on save
    const baseFullContent = window.WidgetSearchBaseFile.content;
    const targetFullContent = content;
    
    const isolateInput = document.getElementById('single-compare-isolate-tag');
    const searchInput = document.getElementById('single-compare-search-input');
    const searchCount = document.getElementById('single-compare-search-count');
    
    let isolatedBase = baseFullContent;
    let isolatedTarget = targetFullContent;
    
    // Helper for nested paths
    function getNestedValue(obj, path) {
      const parts = path.split(/[.\[\]]+/).filter(Boolean);
      let current = obj;
      for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
      }
      return current;
    }
    
    function setNestedValue(obj, path, value) {
      const parts = path.split(/[.\[\]]+/).filter(Boolean);
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] == null) {
           current[part] = /^\d+$/.test(parts[i+1]) ? [] : {};
        }
        current = current[part];
      }
      current[parts[parts.length - 1]] = value;
    }

    function isolateContent(fullStr, tagPath) {
      if (!tagPath || !tagPath.trim()) return fullStr;
      try {
        const obj = JSON.parse(fullStr.replace(/^\ufeff/, '').trim());
        const val = getNestedValue(obj, tagPath);
        if (val !== undefined) {
          // Determine the last key for displaying in the format "key": value
          const parts = tagPath.split(/[.\[\]]+/).filter(Boolean);
          const lastKey = parts.length > 0 ? parts[parts.length - 1] : tagPath;
          return `"${lastKey}": ${JSON.stringify(val, null, 2)}`;
        } else {
          return `// Tag "${tagPath}" non trovato in questo file`;
        }
      } catch (e) {
        return `// Errore parse JSON: impossibile isolare il tag`;
      }
    }

    function renderDiffs() {
      const tag = isolateInput.value.trim();
      isolatedBase = isolateContent(baseFullContent, tag);
      const currentTarget = document.getElementById('single-compare-text-B').value;
      
      const { alignedA, alignedB } = diffLines(isolatedBase, currentTarget);
      document.getElementById('single-compare-diff-A').innerHTML = renderSide(alignedA);
      document.getElementById('single-compare-diff-B').innerHTML = renderSide(alignedB);
      doSearch(); // Re-apply text search after diff rebuild
    }

    // Set modal info
    document.getElementById('single-compare-info-A').textContent = `Nodo: ${window.WidgetSearchBaseFile.node} | File: ${window.WidgetSearchBaseFile.filename}`;
    document.getElementById('single-compare-info-B').textContent = `Nodo: ${nodeAlias} | File: ${filename}`;
    
    // Provide editable content initially
    document.getElementById('single-compare-text-B').value = isolateContent(targetFullContent, isolateInput.value.trim());

    // Init TextSearch
    const diffContainer = document.querySelector('#modal-single-file-compare .diff-file');
    const textSearch = new TextSearch(diffContainer);
    
    function updateSearchCount() {
      if (textSearch.matches.length === 0) {
        searchCount.textContent = '0/0';
      } else {
        searchCount.textContent = `${textSearch.currentIndex + 1}/${textSearch.matches.length}`;
      }
    }

    function doSearch() {
      if (searchInput.value) {
        textSearch.search(searchInput.value);
      } else {
        textSearch.clear();
      }
      updateSearchCount();
    }

    // Calculate and render initial diff
    renderDiffs();

    // Re-render when isolate tag changes
    const oldIsolateInput = isolateInput.cloneNode(true);
    isolateInput.parentNode.replaceChild(oldIsolateInput, isolateInput);
    const newIsolateInput = document.getElementById('single-compare-isolate-tag');
    newIsolateInput.addEventListener('change', () => {
      document.getElementById('single-compare-text-B').value = isolateContent(targetFullContent, newIsolateInput.value.trim());
      renderDiffs();
    });
    newIsolateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('single-compare-text-B').value = isolateContent(targetFullContent, newIsolateInput.value.trim());
        renderDiffs();
      }
    });

    const targetTextArea = document.getElementById('single-compare-text-B');
    
    // Copy from Base button
    const btnCopyBase = document.getElementById('btn-single-compare-copy-base');
    if (btnCopyBase) {
      const oldBtnCopyBase = btnCopyBase.cloneNode(true);
      btnCopyBase.parentNode.replaceChild(oldBtnCopyBase, btnCopyBase);
      document.getElementById('btn-single-compare-copy-base').addEventListener('click', () => {
         const tag = newIsolateInput.value.trim();
         targetTextArea.value = isolateContent(baseFullContent, tag);
         renderDiffs();
      });
    }

    // Attach search events (remove old listeners if any by cloning)
    const oldInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(oldInput, searchInput);
    const newSearchInput = document.getElementById('single-compare-search-input');
    
    newSearchInput.addEventListener('input', doSearch);
    newSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) textSearch.prev();
        else textSearch.next();
        updateSearchCount();
      }
    });

    const btnPrev = document.getElementById('btn-single-compare-search-prev');
    const btnNext = document.getElementById('btn-single-compare-search-next');
    
    const oldPrev = btnPrev.cloneNode(true);
    btnPrev.parentNode.replaceChild(oldPrev, btnPrev);
    document.getElementById('btn-single-compare-search-prev').addEventListener('click', () => { textSearch.prev(); updateSearchCount(); });

    const oldNext = btnNext.cloneNode(true);
    btnNext.parentNode.replaceChild(oldNext, btnNext);
    document.getElementById('btn-single-compare-search-next').addEventListener('click', () => { textSearch.next(); updateSearchCount(); });

    targetTextArea.oninput = renderDiffs;

    window._singleFileCompareTarget = { 
      node: nodeAlias, 
      subPath: subPath, 
      filename: filename,
      originalContent: targetFullContent
    };

    document.getElementById('modal-single-file-compare').classList.remove('hidden');
    // Clear search on open
    newSearchInput.value = '';
    doSearch();
  } catch (err) {
    Toast.error('Errore nel caricamento del file destinazione: ' + err.message);
  }
};

window.closeSingleFileCompare = function() {
  document.getElementById('modal-single-file-compare').classList.add('hidden');
  window._singleFileCompareTarget = null;
};

// Handle save from modal and sync scrolling
document.addEventListener('DOMContentLoaded', () => {
  WidgetSearch.init();

  // Sync scroll for the diff viewer
  const diffA = document.getElementById('single-compare-diff-A');
  const diffB = document.getElementById('single-compare-diff-B');
  
  if (diffA && diffB) {
    let isSyncingA = false;
    let isSyncingB = false;

    diffA.addEventListener('scroll', () => {
      if (!isSyncingA) {
        isSyncingB = true;
        diffB.scrollTop = diffA.scrollTop;
      }
      isSyncingA = false;
    });

    diffB.addEventListener('scroll', () => {
      if (!isSyncingB) {
        isSyncingA = true;
        diffA.scrollTop = diffB.scrollTop;
      }
      isSyncingB = false;
    });
  }

  const btnSaveSingle = document.getElementById('btn-save-single-file-compare');
  if (btnSaveSingle) {
    btnSaveSingle.addEventListener('click', async () => {
      if (!window._singleFileCompareTarget) return;
      
      const t = window._singleFileCompareTarget;
      const newText = document.getElementById('single-compare-text-B').value;
      const isolateInput = document.getElementById('single-compare-isolate-tag');
      const tag = isolateInput ? isolateInput.value.trim() : '';
      
      let finalContent = newText;
      
      // If we are isolating a tag, rebuild the full JSON
      if (tag) {
        try {
          const originalObj = JSON.parse(t.originalContent.replace(/^\ufeff/, '').trim());
          
          const parts = tag.split(/[.\[\]]+/).filter(Boolean);
          const lastKey = parts.length > 0 ? parts[parts.length - 1] : tag;
          
          let parsedSnippet;
          try {
             parsedSnippet = JSON.parse(`{ ${newText} }`);
          } catch (e1) {
             parsedSnippet = { [lastKey]: JSON.parse(newText) };
          }
          
          if (!parsedSnippet.hasOwnProperty(lastKey)) {
            Toast.error(`Errore: la sintassi del tag isolato non è valida. Assicurati che contenga la chiave "${lastKey}".`);
            return;
          }
          
          setNestedValue(originalObj, tag, parsedSnippet[lastKey]);
          finalContent = JSON.stringify(originalObj, null, 2);
          
          // Update original content in memory so subsequent edits don't wipe it out
          window._singleFileCompareTarget.originalContent = finalContent;
          
        } catch (e) {
          Toast.error('Errore nel parse del tag isolato. Assicurati che il formato JSON sia valido. Dettagli: ' + e.message);
          return;
        }
      } else {
        // Minify JSON if needed (only for full file saves)
        if (t.filename.endsWith('.json')) {
          try {
            finalContent = JSON.stringify(JSON.parse(newText));
          } catch (e) {
            Toast.error('Errore di validazione JSON: ' + e.message);
            return;
          }
        }
      }

      btnSaveSingle.disabled = true;
      btnSaveSingle.textContent = '⏳ Salvataggio...';

      try {
        await API.uploadFile(finalContent, t.filename, t.subPath, t.node, '', activeSide);
        Toast.success('File aggiornato e pubblicato con successo!');
        // optionally close: closeSingleFileCompare();
      } catch (e) {
        Toast.error("Errore durante il salvataggio: " + e.message);
      } finally {
        btnSaveSingle.disabled = false;
        btnSaveSingle.textContent = '💾 Salva e Pubblica Lato B';
      }
    });
  }
});
