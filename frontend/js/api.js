/**
 * api.js — Centralized API client layer
 * All calls go through the Node.js backend proxy.
 */

const API = (() => {

  /** Read session credentials */
  function session(side = 'A') {
    const suffix = `_${side}`;
    // Try to get side-specific values, fallback to generic values if they don't exist
    const token = sessionStorage.getItem(`cc_token${suffix}`) || sessionStorage.getItem('cc_token') || '';
    const appServer = sessionStorage.getItem(`cc_appServer${suffix}`) || sessionStorage.getItem('cc_appServer') || '';
    const componentId = sessionStorage.getItem(`cc_componentId${suffix}`) || sessionStorage.getItem('cc_componentId') || '';
    const username = sessionStorage.getItem(`cc_username${suffix}`) || sessionStorage.getItem('cc_username') || '';
    return { token, appServer, componentId, username };
  }

  /** Build common request headers */
  function headers(sideOrExtra = 'A', extra = {}) {
    let side = 'A';
    let realExtra = extra;
    if (typeof sideOrExtra === 'object') {
      realExtra = sideOrExtra;
      side = 'A';
    } else {
      side = sideOrExtra;
    }
    const { token, appServer, componentId } = session(side);
    return {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${token}`,
      'x-app-server':   appServer,
      'x-component-id': componentId,
      ...realExtra,
    };
  }

  /** Generic fetch wrapper with error handling */
  async function request(url, options = {}, side = 'A') {
    const resp = await fetch(url, {
      headers: headers(side, options.headers || {}),
      ...options,
    });

    if (resp.status === 401) {
      sessionStorage.clear();
      window.location.href = 'index.html';
      throw new Error('Session expired');
    }

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const err = await resp.json();
        msg = err.error || err.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    return resp;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Fetch company chart hierarchy.
   * @param {boolean} getUsersInfo - include users in response
   * @param {string} side - 'A' or 'B'
   * @returns {Promise<Object>} hierarchy JSON
   */
  async function getHierarchy(getUsersInfo = true, side = 'A') {
    const resp = await request(`/api/hierarchy?getUsersInfo=${getUsersInfo}`, {}, side);
    return resp.json();
  }

  /**
   * Trigger browser download of configuration ZIP.
   * @param {string} userName
   * @param {string} userContext - node alias
   * @param {string} side - 'A' or 'B'
   */
  async function downloadConfig(userName, userContext, side = 'A') {
    const { componentId, appServer } = session(side);
    const url = `/api/config/download?componentId=${encodeURIComponent(componentId)}&userName=${encodeURIComponent(userName)}&userContext=${encodeURIComponent(userContext)}`;

    const resp = await fetch(url, {
      headers: headers(side, { 'Accept': 'application/octet-stream' }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Download failed: HTTP ${resp.status}`);
    }

    const blob     = await resp.blob();
    const filename = `${appServer}#${componentId}#${userName}#${userContext}.zip`;
    const link     = document.createElement('a');
    link.href      = URL.createObjectURL(blob);
    link.download  = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Fetch ZIP contents as JSON for in-browser viewing.
   * @param {string} userName
   * @param {string} userContext - node alias
   * @param {string} side - 'A' or 'B'
   * @returns {Promise<{files: Array, node, user, componentId}>}
   */
  async function previewConfig(userName, userContext, side = 'A') {
    const { componentId } = session(side);
    const url = `/api/config/preview?componentId=${encodeURIComponent(componentId)}&userName=${encodeURIComponent(userName)}&userContext=${encodeURIComponent(userContext)}`;
    const resp = await request(url, {}, side);
    return resp.json();
  }

  /**
   * Compare configurations from two node/user combinations.
   * @param {string} userNameA
   * @param {string} userContextA
   * @param {string} userNameB
   * @param {string} userContextB
   * @returns {Promise<{left, right, files}>}
   */
  async function compareConfigs(userNameA, userContextA, userNameB, userContextB) {
    const sessA = session('A');
    const sessB = session('B');
    const url = `/api/config/compare?componentId=${encodeURIComponent(sessA.componentId)}`
      + `&userNameA=${encodeURIComponent(userNameA)}&userContextA=${encodeURIComponent(userContextA)}`
      + `&userNameB=${encodeURIComponent(userNameB)}&userContextB=${encodeURIComponent(userContextB)}`;
    
    const resp = await fetch(url, {
      headers: {
        'Content-Type':      'application/json',
        'x-app-server-a':    sessA.appServer,
        'x-app-server-b':    sessB.appServer,
        'x-token-a':         sessA.token,
        'x-token-b':         sessB.token,
        'x-component-id-a':  sessA.componentId,
        'x-component-id-b':  sessB.componentId,
      }
    });

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const err = await resp.json();
        msg = err.error || err.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    return resp.json();
  }

  /**
   * Assign a user to a node.
   * @param {string} userName
   * @param {string} nodeAlias
   * @param {string} [componentId] - defaults to session componentId
   * @param {string} side - 'A' or 'B'
   */
  async function assignUser(userName, nodeAlias, componentId, side = 'A') {
    const { componentId: sessComp } = session(side);
    const resp = await request('/api/users/assign', {
      method:  'POST',
      headers: headers(side),
      body:    JSON.stringify({ userName, nodeAlias, componentId: componentId || sessComp }),
    }, side);
    return resp.json();
  }

  /**
   * Bulk download: all configs for all users at a given hierarchy level.
   * Triggers browser download of a master ZIP.
   * @param {number} level
   * @param {string} side - 'A' or 'B'
   */
  async function bulkDownload(level, side = 'A') {
    const { componentId } = session(side);
    const resp = await fetch('/api/config/bulk-download', {
      method:  'POST',
      headers: headers(side),
      body:    JSON.stringify({ level, componentId }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Bulk download failed: HTTP ${resp.status}`);
    }

    const total  = resp.headers.get('X-Bulk-Total')  || '?';
    const errors = resp.headers.get('X-Bulk-Errors') || '0';

    const blob     = await resp.blob();
    const filename = `bulk_L${level}_${componentId}_${Date.now()}.zip`;
    const link     = document.createElement('a');
    link.href      = URL.createObjectURL(blob);
    link.download  = filename;
    link.click();
    URL.revokeObjectURL(link.href);

    return { total: parseInt(total), errors: parseInt(errors) };
  }

  /**
   * Download the FULL configuration ZIP (all folders) via downloadConfigurationFull.
   * @param {string} userContext - node alias
   * @param {string} [userName] - empty = DEFAULT
   * @param {string} side - 'A' or 'B'
   */
  async function downloadFullConfig(userContext, userName = '', side = 'A') {
    const { componentId } = session(side);
    const url = `/api/config/download-full`
      + `?componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await fetch(url, { headers: headers(side) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const blob     = await resp.blob();
    const filename = `FULL_${componentId}_${userName || 'DEFAULT'}_${userContext}.zip`;
    const link     = document.createElement('a');
    link.href      = URL.createObjectURL(blob);
    link.download  = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Remove a user from a node.
   * @param {string} userName
   * @param {string} nodeAlias
   * @param {string} [componentId]
   * @param {string} side - 'A' or 'B'
   */
  async function removeUser(userName, nodeAlias, componentId, side = 'A') {
    const { componentId: sessComp } = session(side);
    const resp = await request('/api/users/remove', {
      method:  'POST',
      headers: headers(side),
      body:    JSON.stringify({ userName, nodeAlias, componentId: componentId || sessComp }),
    }, side);
    return resp.json();
  }


  /**
   * List files and folders inside a configuration node (file browser).
   * @param {string} userContext - node alias
   * @param {string} [subPath]  - subfolder to navigate into
   * @param {string} [userName] - empty = DEFAULT config
   * @param {string} side - 'A' or 'B'
   * @returns {Promise<Array>} array of node entries
   */
  async function getConfigurationNodes(userContext, subPath = '', userName = '', side = 'A') {
    const { componentId } = session(side);
    const url = `/api/config/nodes`
      + `?componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&subPath=${encodeURIComponent(subPath)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await request(url, {}, side);
    return resp.json();
  }

  /**
   * Download a single configuration file by path (no ZIP needed).
   * @param {string} userContext - node alias
   * @param {string} subPath - subfolder path (e.g. "Presentation\Graphs")
   * @param {string} configurationId - filename
   * @param {string} [userName] - defaults to empty (DEFAULT config)
   * @param {string} side - 'A' or 'B'
   * @returns {Promise<{content, filename, node}>}
   */
  async function downloadSingleFile(userContext, subPath, configurationId, userName = '', side = 'A') {
    const { componentId } = session(side);
    const url = `/api/config/file?asText=true`
      + `&componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&subPath=${encodeURIComponent(subPath)}`
      + `&configurationId=${encodeURIComponent(configurationId)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await request(url, {}, side);
    return resp.json();
  }

  /**
   * Download a single configuration file directly (triggered via download icon).
   * @param {string} userContext - node alias
   * @param {string} subPath - subfolder path
   * @param {string} configurationId - filename
   * @param {string} userName - empty = DEFAULT
   * @param {string} side - 'A' or 'B'
   */
  async function downloadFileDirectly(userContext, subPath, configurationId, userName = '', side = 'A') {
    const { componentId } = session(side);
    const url = `/api/config/file`
      + `?componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&subPath=${encodeURIComponent(subPath)}`
      + `&configurationId=${encodeURIComponent(configurationId)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await fetch(url, { headers: headers(side) });
    if (!resp.ok) {
      throw new Error(`Download failed: HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = configurationId;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Fetch the sub-hierarchy for a specific node alias.
   * @param {string} alias - Node alias
   * @param {string} side - 'A' or 'B'
   */
  async function getNodeHierarchy(alias, side = 'A') {
    const resp = await request(`/api/hierarchy/node?alias=${encodeURIComponent(alias)}`, {}, side);
    return resp.json();
  }

  /**
   * Search for configuration files across all nodes.
   * @param {string} query - search keyword
   * @param {string} side - 'A' or 'B'
   */
  async function searchWidgets(query, side = 'A') {
    const resp = await request(`/api/config/search-widgets?query=${encodeURIComponent(query)}`, {}, side);
    return resp.json();
  }

  return { session, getHierarchy, downloadConfig, previewConfig, compareConfigs, assignUser, removeUser, bulkDownload, downloadSingleFile, getConfigurationNodes, downloadFullConfig, getNodeHierarchy, searchWidgets, downloadFileDirectly };
})();

