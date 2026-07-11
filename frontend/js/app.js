/**
 * app.js — Main application orchestration
 * Handles: session guard, hierarchy loading, node selection,
 *          tab switching, user actions (view/download/compare)
 */

// ── Session guard ─────────────────────────────────────────
(function () {
  if (!sessionStorage.getItem('cc_token')) {
    window.location.href = 'index.html';
  }
})();

// ── Toast notifications ───────────────────────────────────
const Toast = {
  show(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const el        = document.createElement('div');
    el.className    = `toast ${type}`;
    const icon      = { info: 'ℹ️', success: '✅', error: '❌' }[type] || 'ℹ️';
    el.innerHTML    = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-fade-out');
      setTimeout(() => el.remove(), 350);
    }, duration);
  },
  success: (m) => Toast.show(m, 'success'),
  error:   (m) => Toast.show(m, 'error'),
  info:    (m) => Toast.show(m, 'info'),
};

// ── App state ─────────────────────────────────────────────
let currentNode    = null;   // currently selected nodeData
let activeSide     = 'A';    // active environment side ('A' or 'B')
let isMultiEnv     = false;  // true if logged in to two environments
let rawHierarchyA  = null;   // raw hierarchy for Environment A
let rawHierarchyB  = null;   // raw hierarchy for Environment B
let flatNodesA     = {};     // index of alias -> nodeData for side A
let flatNodesB     = {};     // index of alias -> nodeData for side B
let compareNodeA   = null;   // left side for compare
let compareNodeB   = null;   // right side for compare

// Fallbacks for backward compatibility
let rawHierarchy   = null;
let flatNodes      = {};

// ── DOM refs ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

// ── Init ──────────────────────────────────────────────────
async function init() {
  const sessA = API.session('A');
  const sessB = API.session('B');
  isMultiEnv = sessionStorage.getItem('cc_multiEnv') === 'true';

  // Populate topbar
  if (isMultiEnv) {
    $('topbar-server').textContent   = `A: ${sessA.appServer} | B: ${sessB.appServer}`;
    $('topbar-component').textContent = `${sessA.componentId.toUpperCase()} / ${sessB.componentId.toUpperCase()}`;
  } else {
    $('topbar-server').textContent   = sessA.appServer;
    $('topbar-component').textContent = sessA.componentId.toUpperCase();
  }
  $('topbar-user-label').textContent = sessA.username;
  $('topbar-avatar').textContent   = (sessA.username[0] || 'U').toUpperCase();

  // Show/configure sidebar env tabs if multi-env
  const envTabsContainer = $('sidebar-env-tabs');
  if (isMultiEnv) {
    envTabsContainer.classList.remove('hidden');
    const tabA = $('tab-env-A');
    const tabB = $('tab-env-B');
    if (tabA) {
      tabA.textContent = `A: ${sessA.appServer}`;
      tabA.title = sessA.appServer;
    }
    if (tabB) {
      tabB.textContent = `B: ${sessB.appServer}`;
      tabB.title = sessB.appServer;
    }
  } else {
    envTabsContainer.classList.add('hidden');
  }

  applyEnvironmentTheme(activeSide);

  // Populate compare headers
  if (isMultiEnv) {
    $('cmp-headerA').innerHTML = `← Lato A (sinistra) <span class="badge badge-server">${sessA.appServer}</span>`;
    $('cmp-headerB').innerHTML = `→ Lato B (destra) <span class="badge badge-server">${sessB.appServer}</span>`;
  } else {
    $('cmp-headerA').innerHTML = `← Lato A (sinistra)`;
    $('cmp-headerB').innerHTML = `→ Lato B (destra)`;
  }

  // Wire up sidebar controls
  $('search-input').addEventListener('input', e => Tree.setSearch(e.target.value.trim()));
  $('btn-expand-all').addEventListener('click',   () => Tree.expandAll());
  $('btn-collapse-all').addEventListener('click', () => Tree.collapseAll());

  // Level filter chips
  document.querySelectorAll('.filter-chip[data-level]').forEach(chip => {
    chip.addEventListener('click', () => {
      const lv = chip.dataset.level === 'all' ? null : parseInt(chip.dataset.level, 10);
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      Tree.setLevelFilter(lv);
    });
  });

  // Logout
  $('btn-logout').addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = 'index.html';
  });

  // Reset session
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Sei sicuro di voler resettare la sessione attuale e scollegare gli ambienti?')) {
      sessionStorage.clear();
      window.location.href = 'index.html';
    }
  });

  // Credits modal
  const btnCredits = $('btn-credits');
  const modalCredits = $('modal-credits');
  const btnCloseCredits = $('btn-close-credits');
  const btnCloseCreditsOk = $('btn-close-credits-ok');

  if (btnCredits && modalCredits) {
    btnCredits.addEventListener('click', () => {
      modalCredits.classList.remove('hidden');
    });
  }
  if (btnCloseCredits && modalCredits) {
    btnCloseCredits.addEventListener('click', () => modalCredits.classList.add('hidden'));
  }
  if (btnCloseCreditsOk && modalCredits) {
    btnCloseCreditsOk.addEventListener('click', () => modalCredits.classList.add('hidden'));
  }

  // Swap button
  const swapBtn = $('btn-swap');
  if (swapBtn) {
    if (isMultiEnv) {
      swapBtn.classList.remove('hidden');
      // Remove any existing click handler and add the new one
      swapBtn.replaceWith(swapBtn.cloneNode(true));
      $('btn-swap').addEventListener('click', swapCompareSides);
    } else {
      swapBtn.classList.add('hidden');
    }
  }

  // Refresh hierarchy
  $('btn-refresh').addEventListener('click', loadHierarchy);

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Compare run button
  $('btn-run-compare').addEventListener('click', runCompare);

  // Compare node change listeners to populate users lists
  $('cmp-nodeA').addEventListener('change', e => populateCompareUsers('A', e.target.value));
  $('cmp-nodeB').addEventListener('change', e => populateCompareUsers('B', e.target.value));

  await loadHierarchy();
}

// ── Load hierarchy ─────────────────────────────────────────
async function loadHierarchy() {
  showLoading('Caricamento gerarchie...');
  try {
    // Load side A
    rawHierarchyA = await API.getHierarchy(true, 'A');
    flatNodesA = {};
    buildFlatNodesMap(rawHierarchyA, 'A');

    if (isMultiEnv) {
      // Load side B
      try {
        rawHierarchyB = await API.getHierarchy(true, 'B');
        flatNodesB = {};
        buildFlatNodesMap(rawHierarchyB, 'B');
      } catch (errB) {
        Toast.error('Errore caricamento Ambiente B: ' + errB.message);
      }
    } else {
      rawHierarchyB = null;
      flatNodesB = {};
    }

    // Set fallbacks for backward compatibility
    rawHierarchy = rawHierarchyA;
    flatNodes = flatNodesA;

    // Populate compare selects
    populateCompareNodeDropdowns();

    // Init tree with active side
    const activeHierarchy = activeSide === 'A' ? rawHierarchyA : rawHierarchyB;
    Tree.init(activeHierarchy, onNodeSelect);
    buildLevelFilterChips(activeHierarchy);

    Toast.success('Gerarchia caricata');
  } catch (err) {
    Toast.error('Errore caricamento: ' + err.message);
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ── Switch sidebar active environment side ────────────────
function switchSidebarSide(side) {
  if (side === activeSide) return;
  activeSide = side;

  // Toggle active tab class
  document.querySelectorAll('.env-tab').forEach(btn => {
    btn.classList.toggle('active', btn.id === `tab-env-${side}`);
  });

  applyEnvironmentTheme(side);

  // Update Tree data
  const currentHierarchy = side === 'A' ? rawHierarchyA : rawHierarchyB;
  
  // Re-init tree with selected side's hierarchy
  Tree.init(currentHierarchy, onNodeSelect);
  
  // Refresh filter chips
  buildLevelFilterChips(currentHierarchy);

  // Reset selected node detail panels
  currentNode = null;
  $('empty-state').classList.remove('hidden');
  $('node-panel').classList.add('hidden');
  clearViewer();
  Compare.clear();
}

// ── Build dynamic level chips ─────────────────────────────
function buildLevelFilterChips(data) {
  const levels      = Tree.getLevels(data);
  const container   = $('filter-chips');
  if (!container) return;

  container.innerHTML = '<button class="filter-chip active" data-level="all">Tutti</button>';
  levels.forEach(lv => {
    const chip = document.createElement('button');
    chip.className    = 'filter-chip';
    chip.dataset.level = lv;
    chip.textContent  = `L${lv}`;
    container.appendChild(chip);
  });

  // Re-attach event listeners
  container.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const lv = chip.dataset.level === 'all' ? null : parseInt(chip.dataset.level, 10);
      container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      Tree.setLevelFilter(lv);
    });
  });
}

// ── Node selection callback ───────────────────────────────
function onNodeSelect(nodeData) {
  currentNode = nodeData;
  showNodePanel(nodeData);
}

// ── Show node panel ───────────────────────────────────────
function showNodePanel(nodeData) {
  $('empty-state').classList.add('hidden');
  $('node-panel').classList.remove('hidden');

  const alias = nodeData.node?.alias || '—';
  const level = nodeData.node?.level ?? '?';

  $('panel-node-name').textContent  = alias;
  $('panel-node-level').textContent = `Livello ${level}`;

  const sess     = API.session(activeSide);
  const targetComp = (sess.componentId || '').toLowerCase();
  const rawList = nodeData.usersList || nodeData.UsersList || [];
  const users    = rawList.filter(u => {
    const uComp = (u.componentid || u.componentId || u.ComponentId || '').toLowerCase();
    const isServ = u.isServiceUser || u.IsServiceUser || false;
    return uComp === targetComp && !isServ;
  });

  // Prepend virtual DEFAULT user for the base node configuration
  users.unshift({
    user: 'DEFAULT',
    componentid: targetComp.toUpperCase(),
    isVirtualDefault: true
  });

  const allUsers = rawList;

  $('panel-user-count').textContent = `${users.length - 1} utenti`; // Subtract the virtual one
  $('panel-all-count').textContent  = `${allUsers.length} totali`;

  renderUsersTable(users, alias);
  switchTab('users');

  // Clear viewer and compare when switching node
  clearViewer();
  Compare.clear();

  // Pre-fill compare node for the active side
  if (activeSide === 'A') {
    $('cmp-nodeA').value = alias;
    populateCompareUsers('A', alias);
  } else {
    $('cmp-nodeB').value = alias;
    populateCompareUsers('B', alias);
  }
}

// ── Render users table ────────────────────────────────────
function renderUsersTable(users, nodeAlias) {
  const tbody = $('users-tbody');
  tbody.innerHTML = '';

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:24px">Nessun utente per questo componente</td></tr>`;
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');
    const compId = u.componentid || u.componentId || u.ComponentId || '—';
    const isVirtual = u.isVirtualDefault || false;

    // Use empty string for DEFAULT's actions to query base node configuration
    const actionUser = isVirtual ? '' : u.user;

    tr.innerHTML = `
      <td>
        <span class="username ${isVirtual ? 'text-accent font-bold' : ''}">
          ${u.user} ${isVirtual ? '<span style="font-size:10px;opacity:0.6;font-weight:normal;margin-left:4px">(Base Config)</span>' : ''}
        </span>
      </td>
      <td><span class="badge badge-l1">${compId}</span></td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-sm btn-ghost" onclick="viewConfig('${actionUser}','${nodeAlias}')" title="Visualizza configurazione">👁 Visualizza</button>
          <button class="btn btn-sm btn-success" onclick="downloadConfig('${actionUser}','${nodeAlias}')" title="Scarica ZIP">📥 Scarica</button>
          <button class="btn btn-sm btn-ghost" onclick="setCompareB('${actionUser}','${nodeAlias}')" title="Usa come lato destro del confronto">↔ Confronta</button>
          ${isVirtual ? '' : `<button class="btn btn-sm btn-danger" onclick="removeUserFromNode('${u.user}','${nodeAlias}')" title="Rimuovi utente dal nodo">🗑 Rimuovi</button>`}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── View config ───────────────────────────────────────────
async function viewConfig(userName, nodeAlias) {
  if (!nodeAlias && currentNode) nodeAlias = currentNode.node?.alias;
  if (!nodeAlias) return;

  switchTab('viewer');
  $('viewer-placeholder').classList.add('hidden');

  const contentEl = $('viewer-content');
  contentEl.classList.remove('hidden');
  contentEl.style.display = 'flex';

  Viewer.show(nodeAlias, userName || '', activeSide);
}

// ── Download config ───────────────────────────────────────
async function downloadConfig(userName, nodeAlias) {
  Toast.info(`Download in corso per ${userName}...`);
  try {
    await API.downloadConfig(userName, nodeAlias, activeSide);
    Toast.success('Download completato!');
  } catch (err) {
    Toast.error('Errore download: ' + err.message);
  }
}

// ── Set compare side B ────────────────────────────────────
function setCompareB(userName, nodeAlias) {
  const targetUser = userName === '' || userName === 'DEFAULT' ? 'DEFAULT' : userName;

  $('cmp-nodeB').value = nodeAlias;
  populateCompareUsers('B', nodeAlias, activeSide);
  $('cmp-userB').value = targetUser;

  switchTab('compare');
  Toast.info(`Lato B impostato: ${userName || 'DEFAULT'} @ ${nodeAlias} (da Ambiente ${activeSide})`);
}

// ── Run compare ───────────────────────────────────────────
async function runCompare() {
  const nodeA    = $('cmp-nodeA').value;
  const userAVal = $('cmp-userA').value;
  const nodeB    = $('cmp-nodeB').value;
  const userBVal = $('cmp-userB').value;

  // If node or user is not selected (empty)
  if (!nodeA || !userAVal || !nodeB || !userBVal) {
    Toast.error('Compila tutti i campi del confronto');
    return;
  }

  // Translate 'DEFAULT' to empty string for API
  const userA = userAVal === 'DEFAULT' ? '' : userAVal;
  const userB = userBVal === 'DEFAULT' ? '' : userBVal;

  const btn = $('btn-run-compare');
  btn.disabled = true;
  btn.textContent = '⏳ Confronto in corso...';
  Compare.clear();

  try {
    const data = await API.compareConfigs(userA, nodeA, userB, nodeB);
    Compare.render(data);
    Toast.success('Confronto completato');
  } catch (err) {
    Toast.error('Errore confronto: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Avvia confronto';
  }
}

// ── Tab switching ─────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tabName}`));
}

// ── Clear viewer ──────────────────────────────────────────
function clearViewer() {
  const tabsEl    = $('viewer-file-tabs');
  const contentEl = $('json-viewer-content');
  if (tabsEl)    tabsEl.innerHTML    = '';
  if (contentEl) contentEl.innerHTML = '';
  $('viewer-placeholder')?.classList.remove('hidden');
  $('viewer-content')?.classList.add('hidden');
}

// ── Loading overlay ───────────────────────────────────────
function showLoading(msg = 'Caricamento...') {
  let overlay = $('global-loading');
  if (!overlay) {
    overlay    = document.createElement('div');
    overlay.id = 'global-loading';
    overlay.className = 'loading-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;';
    overlay.innerHTML = `<div class="spinner"></div><p class="loading-text" id="loading-msg">${msg}</p>`;
    document.body.appendChild(overlay);
  } else {
    $('loading-msg').textContent = msg;
    overlay.classList.remove('hidden');
  }
}
function hideLoading() {
  $('global-loading')?.classList.add('hidden');
}

// ── Helper: build user <option> list ────────────────────
function buildUserOptions(users) {
  return users.map(u => `<option value="${u.user}">${u.user}</option>`).join('');
}

// ── Download DEFAULT config (userName="") ─────────────────
async function downloadDefaultConfig() {
  if (!currentNode) return;
  const alias = currentNode.node?.alias;
  Toast.info(`Download DEFAULT per nodo ${alias}...`);
  try {
    await API.downloadConfig('', alias, activeSide);
    Toast.success('Download DEFAULT completato!');
  } catch (err) {
    Toast.error('Errore download DEFAULT: ' + err.message);
  }
}

// ── Download FULL config (downloadConfigurationFull) ──────
async function downloadFullConfigNode() {
  if (!currentNode) return;
  const alias = currentNode.node?.alias;
  Toast.info(`Download FULL per nodo ${alias}...`);
  try {
    await API.downloadFullConfig(alias, '', activeSide);
    Toast.success('Download FULL completato!');
  } catch (err) {
    Toast.error('Errore download FULL: ' + err.message);
  }
}

// ── Assign User modal ─────────────────────────────────────
function openAssignUserModal() {
  if (!currentNode) return;
  const alias = currentNode.node?.alias;
  $('assign-node').value     = alias;
  $('assign-username').value = '';
  $('modal-assign-alert').classList.add('hidden');
  $('modal-assign-user').classList.remove('hidden');
  setTimeout(() => $('assign-username').focus(), 50);
}

function closeAssignUserModal() {
  $('modal-assign-user').classList.add('hidden');
}

async function confirmAssignUser() {
  const node     = $('assign-node').value.trim();
  const username = $('assign-username').value.trim();
  const alertEl  = $('modal-assign-alert');

  if (!username) {
    alertEl.className   = 'alert alert-error';
    alertEl.textContent = 'Inserisci un username.';
    alertEl.classList.remove('hidden');
    return;
  }

  const btn = $('btn-confirm-assign');
  btn.disabled     = true;
  btn.textContent  = '⏳ Assegnazione...';

  try {
    await API.assignUser(username, node, null, activeSide);
    closeAssignUserModal();
    Toast.success(`Utente ${username} assegnato al nodo ${node} su Ambiente ${activeSide}`);
    // Reload hierarchy to refresh user list
    await loadHierarchy();
  } catch (err) {
    alertEl.className   = 'alert alert-error';
    alertEl.textContent = 'Errore: ' + err.message;
    alertEl.classList.remove('hidden');
  } finally {
    btn.disabled    = false;
    btn.textContent = '✓ Assegna';
  }
}

// Close modal on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  $('modal-assign-user')?.addEventListener('click', e => {
    if (e.target === $('modal-assign-user')) closeAssignUserModal();
  });
});

// ── Remove User from Node ──────────────────────────────────
async function removeUserFromNode(userName, nodeAlias) {
  if (!confirm(`Sei sicuro di voler rimuovere l'utente ${userName} dal nodo ${nodeAlias} su Ambiente ${activeSide}?`)) {
    return;
  }

  showLoading(`Rimozione utente ${userName}...`);
  try {
    await API.removeUser(userName, nodeAlias, null, activeSide);
    Toast.success(`Utente ${userName} rimosso con successo dal nodo ${nodeAlias}`);
    // Refresh hierarchy to update the list of users
    await loadHierarchy();
  } catch (err) {
    Toast.error('Errore durante la rimozione dell\'utente: ' + err.message);
  } finally {
    hideLoading();
  }
}


// ── viewConfig override: handle empty userName (DEFAULT) ──
// (already works — empty string passes through to the API)

// ── Build flat nodes list ─────────────────────────────────
function buildFlatNodesMap(node, side = 'A') {
  if (!node) return;
  const targetMap = side === 'A' ? flatNodesA : flatNodesB;
  if (node.node && node.node.alias) {
    targetMap[node.node.alias] = node;
  }
  if (node.children && node.children.length) {
    node.children.forEach(c => buildFlatNodesMap(c, side));
  }
}

// ── Populate compare node dropdowns ───────────────────────
function populateCompareNodeDropdowns() {
  const aliasesA = Object.keys(flatNodesA).sort();
  const optionsA = ['<option value="">— seleziona nodo A —</option>', ...aliasesA.map(a => `<option value="${a}">${a}</option>`)].join('');
  $('cmp-nodeA').innerHTML = optionsA;

  const aliasesB = isMultiEnv ? Object.keys(flatNodesB).sort() : aliasesA;
  const optionsB = ['<option value="">— seleziona nodo B —</option>', ...aliasesB.map(a => `<option value="${a}">${a}</option>`)].join('');
  $('cmp-nodeB').innerHTML = optionsB;

  // Clear user selects
  $('cmp-userA').innerHTML = '<option value="">— seleziona utente —</option>';
  $('cmp-userB').innerHTML = '<option value="">— seleziona utente —</option>';
}

// ── Populate compare users dropdown based on selected node ─
function populateCompareUsers(side, nodeAlias, envSide = side) {
  const selectNode = $(`cmp-node${side}`);
  const selectUser = $(`cmp-user${side}`);

  if (!selectNode || !selectUser) return;
  selectNode.value = nodeAlias; // sync in case of setCompareB call

  // If we are in single env mode, both sides use flatNodesA
  const targetMap = (isMultiEnv && envSide === 'B') ? flatNodesB : flatNodesA;

  if (!nodeAlias || !targetMap[nodeAlias]) {
    selectUser.innerHTML = '<option value="">— seleziona utente —</option>';
    return;
  }

  const nodeData = targetMap[nodeAlias];
  const sess = API.session(envSide);
  const targetComp = (sess.componentId || '').toLowerCase();
  const rawList = nodeData.usersList || nodeData.UsersList || [];

  // Filter users matching target component
  const users = rawList.filter(u => {
    const uComp = (u.componentid || u.componentId || u.ComponentId || '').toLowerCase();
    const isServ = u.isServiceUser || u.IsServiceUser || false;
    return uComp === targetComp && !isServ;
  });

  // Prepend virtual default configuration row
  users.unshift({
    user: 'DEFAULT',
    componentid: targetComp.toUpperCase(),
    isVirtualDefault: true
  });

  // Build options
  const optionsHTML = users.map(u => {
    const isVirtual = u.isVirtualDefault || false;
    const value = isVirtual ? 'DEFAULT' : u.user;
    const label = isVirtual ? 'DEFAULT (Config. Base)' : u.user;
    return `<option value="${value}">${label}</option>`;
  }).join('');

  selectUser.innerHTML = ['<option value="">— seleziona utente —</option>', optionsHTML].join('');
}

// ── Swap environments and Compare side configurations ─────
async function swapCompareSides() {
  if (!isMultiEnv) {
    Toast.error('La funzionalità di inversione richiede due ambienti connessi.');
    return;
  }

  // 1. Swap sessionStorage keys
  const keys = ['token', 'appServer', 'componentId', 'username'];
  keys.forEach(k => {
    const valA = sessionStorage.getItem(`cc_${k}_A`);
    const valB = sessionStorage.getItem(`cc_${k}_B`);
    sessionStorage.setItem(`cc_${k}_A`, valB || '');
    sessionStorage.setItem(`cc_${k}_B`, valA || '');
  });

  // Keep cc_token, cc_appServer etc synced to the new Environment A
  keys.forEach(k => {
    sessionStorage.setItem(`cc_${k}`, sessionStorage.getItem(`cc_${k}_A`));
  });

  // 2. Swap in-memory hierarchies and maps
  const tempHierarchy = rawHierarchyA;
  rawHierarchyA = rawHierarchyB;
  rawHierarchyB = tempHierarchy;

  const tempFlatNodes = flatNodesA;
  flatNodesA = flatNodesB;
  flatNodesB = tempFlatNodes;

  // Fallback refs
  rawHierarchy = rawHierarchyA;
  flatNodes = flatNodesA;

  // 3. Swap the selected values in the Compare inputs
  const nodeA = $('cmp-nodeA').value;
  const userA = $('cmp-userA').value;
  const nodeB = $('cmp-nodeB').value;
  const userB = $('cmp-userB').value;

  // 4. Update UI labels (topbar, tabs, headers)
  const sessA = API.session('A');
  const sessB = API.session('B');

  $('topbar-server').textContent   = `A: ${sessA.appServer} | B: ${sessB.appServer}`;
  $('topbar-component').textContent = `${sessA.componentId.toUpperCase()} / ${sessB.componentId.toUpperCase()}`;
  const tabA = $('tab-env-A');
  const tabB = $('tab-env-B');
  if (tabA) {
    tabA.textContent = `A: ${sessA.appServer}`;
    tabA.title = sessA.appServer;
  }
  if (tabB) {
    tabB.textContent = `B: ${sessB.appServer}`;
    tabB.title = sessB.appServer;
  }

  $('cmp-headerA').innerHTML = `← Lato A (sinistra) <span class="badge badge-server">${sessA.appServer}</span>`;
  $('cmp-headerB').innerHTML = `→ Lato B (destra) <span class="badge badge-server">${sessB.appServer}</span>`;

  applyEnvironmentTheme(activeSide);

  // 5. Re-init compare dropdown values
  populateCompareNodeDropdowns();
  
  // Set the swapped nodes
  $('cmp-nodeA').value = nodeB;
  $('cmp-nodeB').value = nodeA;

  // Populate users lists for the new nodes
  populateCompareUsers('A', nodeB);
  populateCompareUsers('B', nodeA);

  // Set the swapped users
  $('cmp-userA').value = userB;
  $('cmp-userB').value = userA;

  // 6. Refresh the sidebar tree for the current active side
  const activeHierarchy = activeSide === 'A' ? rawHierarchyA : rawHierarchyB;
  Tree.init(activeHierarchy, onNodeSelect);
  buildLevelFilterChips(activeHierarchy);

  // Keep the active tab view, but clear the tree selection highlight
  document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
  currentNode = null;
  clearViewer();

  Toast.success('Ambienti invertiti con successo');

  // 7. Auto-run comparison if both nodes were selected
  if (nodeB && nodeA && userB && userA) {
    runCompare();
  }
}

// ── Apply theme colors dynamically ─────────────────────────
function applyEnvironmentTheme(side) {
  const color = sessionStorage.getItem(`cc_themeColor_${side}`) || (side === 'A' ? '#3d7fff' : '#a855f7');
  
  const THEME_PRESETS = {
    '#3d7fff': { bright: '#5b9aff', dim: '#1a4db3', glow: 'rgba(61,127,255,.25)', glowLight: 'rgba(61,127,255,.05)' },
    '#a855f7': { bright: '#c084fc', dim: '#7e22ce', glow: 'rgba(168,85,247,.25)', glowLight: 'rgba(168,85,247,.08)' },
    '#10b981': { bright: '#34d399', dim: '#047857', glow: 'rgba(16,185,129,.25)', glowLight: 'rgba(16,185,129,.08)' },
    '#f97316': { bright: '#fb923c', dim: '#c2410c', glow: 'rgba(249,115,22,.25)', glowLight: 'rgba(249,115,22,.08)' },
    '#ef4444': { bright: '#f87171', dim: '#b91c1c', glow: 'rgba(239,68,68,.25)', glowLight: 'rgba(239,68,68,.08)' }
  };
  
  const preset = THEME_PRESETS[color] || THEME_PRESETS['#3d7fff'];
  
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.style.setProperty('--accent', color);
    sidebar.style.setProperty('--accent-bright', preset.bright);
    sidebar.style.setProperty('--accent-dim', preset.dim);
    sidebar.style.setProperty('--accent-glow', preset.glow);
    sidebar.style.setProperty('--text-accent', preset.bright);
    sidebar.style.setProperty('--tab-bg-active', preset.glowLight);
  }
}

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// ── Expose action functions to inline onclick handlers ────
window.viewConfig             = viewConfig;
window.downloadConfig         = downloadConfig;
window.downloadDefaultConfig  = downloadDefaultConfig;
window.downloadFullConfigNode = downloadFullConfigNode;
window.setCompareB            = setCompareB;
window.openAssignUserModal    = openAssignUserModal;
window.closeAssignUserModal   = closeAssignUserModal;
window.confirmAssignUser      = confirmAssignUser;
window.removeUserFromNode     = removeUserFromNode;
window.populateCompareUsers   = populateCompareUsers;
window.switchTab              = switchTab;
window.runCompare             = runCompare;
window.switchSidebarSide      = switchSidebarSide;
window.swapCompareSides       = swapCompareSides;
window.applyEnvironmentTheme  = applyEnvironmentTheme;



