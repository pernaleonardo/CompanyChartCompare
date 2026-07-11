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
let rawHierarchy   = null;   // raw hierarchy data
let flatNodes      = {};     // index of alias -> nodeData
let compareNodeA   = null;   // left side for compare
let compareNodeB   = null;   // right side for compare

// ── DOM refs ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

// ── Init ──────────────────────────────────────────────────
async function init() {
  const sess = API.session();

  // Populate topbar
  $('topbar-server').textContent   = sess.appServer;
  $('topbar-component').textContent = sess.componentId.toUpperCase();
  $('topbar-user-label').textContent = sess.username;
  $('topbar-avatar').textContent   = (sess.username[0] || 'U').toUpperCase();

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
  showLoading('Caricamento gerarchia...');
  try {
    const data = await API.getHierarchy(true);
    rawHierarchy = data;
    
    // Index all nodes
    flatNodes = {};
    buildFlatNodesMap(data);

    // Populate compare node selects
    populateCompareNodeDropdowns();

    Tree.init(data, onNodeSelect);
    buildLevelFilterChips(data);
    Toast.success('Gerarchia caricata');
  } catch (err) {
    Toast.error('Errore caricamento: ' + err.message);
    console.error(err);
  } finally {
    hideLoading();
  }
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

  const sess     = API.session();
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

  // Pre-fill compare node A
  $('cmp-nodeA').value = alias;
  $('cmp-userA').innerHTML = buildUserOptions(users.filter(u => !u.isVirtualDefault));
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

  Viewer.show(nodeAlias, userName || '');
}

// ── Download config ───────────────────────────────────────
async function downloadConfig(userName, nodeAlias) {
  Toast.info(`Download in corso per ${userName}...`);
  try {
    await API.downloadConfig(userName, nodeAlias);
    Toast.success('Download completato!');
  } catch (err) {
    Toast.error('Errore download: ' + err.message);
  }
}

// ── Set compare side B ────────────────────────────────────
function setCompareB(userName, nodeAlias) {
  const targetUser = userName === '' || userName === 'DEFAULT' ? 'DEFAULT' : userName;

  $('cmp-nodeB').value = nodeAlias;
  populateCompareUsers('B', nodeAlias);
  $('cmp-userB').value = targetUser;

  switchTab('compare');
  Toast.info(`Lato B impostato: ${userName || 'DEFAULT'} @ ${nodeAlias}`);
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
    await API.downloadConfig('', alias);
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
    await API.downloadFullConfig(alias, '');
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
    await API.assignUser(username, node);
    closeAssignUserModal();
    Toast.success(`Utente ${username} assegnato al nodo ${node}`);
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
  if (!confirm(`Sei sicuro di voler rimuovere l'utente ${userName} dal nodo ${nodeAlias}?`)) {
    return;
  }

  showLoading(`Rimozione utente ${userName}...`);
  try {
    await API.removeUser(userName, nodeAlias);
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
function buildFlatNodesMap(node) {
  if (!node) return;
  if (node.node && node.node.alias) {
    flatNodes[node.node.alias] = node;
  }
  if (node.children && node.children.length) {
    node.children.forEach(buildFlatNodesMap);
  }
}

// ── Populate compare node dropdowns ───────────────────────
function populateCompareNodeDropdowns() {
  const aliases = Object.keys(flatNodes).sort();
  const options = ['<option value="">— seleziona nodo —</option>', ...aliases.map(a => `<option value="${a}">${a}</option>`)].join('');

  $('cmp-nodeA').innerHTML = options;
  $('cmp-nodeB').innerHTML = options;

  // Clear user selects
  $('cmp-userA').innerHTML = '<option value="">— seleziona utente —</option>';
  $('cmp-userB').innerHTML = '<option value="">— seleziona utente —</option>';
}

// ── Populate compare users dropdown based on selected node ─
function populateCompareUsers(side, nodeAlias) {
  const selectNode = $(`cmp-node${side}`);
  const selectUser = $(`cmp-user${side}`);

  if (!selectNode || !selectUser) return;
  selectNode.value = nodeAlias; // sync in case of setCompareB call

  if (!nodeAlias || !flatNodes[nodeAlias]) {
    selectUser.innerHTML = '<option value="">— seleziona utente —</option>';
    return;
  }

  const nodeData = flatNodes[nodeAlias];
  const sess = API.session();
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

// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// ── Expose action functions to inline onclick handlers ────
window.viewConfig            = viewConfig;
window.downloadConfig        = downloadConfig;
window.downloadDefaultConfig = downloadDefaultConfig;
window.downloadFullConfigNode = downloadFullConfigNode;
window.setCompareB           = setCompareB;
window.openAssignUserModal   = openAssignUserModal;
window.closeAssignUserModal  = closeAssignUserModal;
window.confirmAssignUser     = confirmAssignUser;
window.removeUserFromNode    = removeUserFromNode;
window.populateCompareUsers  = populateCompareUsers;
window.switchTab             = switchTab;
window.runCompare            = runCompare;



