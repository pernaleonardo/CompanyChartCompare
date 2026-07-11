/**
 * api.js — Centralized API client layer
 * All calls go through the Node.js backend proxy.
 */

const API = (() => {

  /** Read session credentials */
  function session() {
    return {
      token:       sessionStorage.getItem('cc_token')       || '',
      appServer:   sessionStorage.getItem('cc_appServer')   || '',
      componentId: sessionStorage.getItem('cc_componentId') || '',
      username:    sessionStorage.getItem('cc_username')    || '',
    };
  }

  /** Build common request headers */
  function headers(extra = {}) {
    const { token, appServer, componentId } = session();
    return {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${token}`,
      'x-app-server':   appServer,
      'x-component-id': componentId,
      ...extra,
    };
  }

  /** Generic fetch wrapper with error handling */
  async function request(url, options = {}) {
    const resp = await fetch(url, {
      headers: headers(),
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
   * @returns {Promise<Object>} hierarchy JSON
   */
  async function getHierarchy(getUsersInfo = true) {
    const resp = await request(`/api/hierarchy?getUsersInfo=${getUsersInfo}`);
    return resp.json();
  }

  /**
   * Trigger browser download of configuration ZIP.
   * @param {string} userName
   * @param {string} userContext - node alias
   */
  async function downloadConfig(userName, userContext) {
    const { componentId, appServer } = session();
    const url = `/api/config/download?componentId=${encodeURIComponent(componentId)}&userName=${encodeURIComponent(userName)}&userContext=${encodeURIComponent(userContext)}`;

    const resp = await fetch(url, {
      headers: headers({ 'Accept': 'application/octet-stream' }),
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
   * @returns {Promise<{files: Array, node, user, componentId}>}
   */
  async function previewConfig(userName, userContext) {
    const { componentId } = session();
    const url = `/api/config/preview?componentId=${encodeURIComponent(componentId)}&userName=${encodeURIComponent(userName)}&userContext=${encodeURIComponent(userContext)}`;
    const resp = await request(url);
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
    const { componentId } = session();
    const url = `/api/config/compare?componentId=${encodeURIComponent(componentId)}`
      + `&userNameA=${encodeURIComponent(userNameA)}&userContextA=${encodeURIComponent(userContextA)}`
      + `&userNameB=${encodeURIComponent(userNameB)}&userContextB=${encodeURIComponent(userContextB)}`;
    const resp = await request(url);
    return resp.json();
  }

  /**
   * Assign a user to a node.
   * @param {string} userName
   * @param {string} nodeAlias
   * @param {string} [componentId] - defaults to session componentId
   */
  async function assignUser(userName, nodeAlias, componentId) {
    const { componentId: sessComp } = session();
    const resp = await request('/api/users/assign', {
      method:  'POST',
      headers: { ...headers(), 'x-component-id': sessionStorage.getItem('cc_componentId') },
      body:    JSON.stringify({ userName, nodeAlias, componentId: componentId || sessComp }),
    });
    return resp.json();
  }

  /**
   * Bulk download: all configs for all users at a given hierarchy level.
   * Triggers browser download of a master ZIP.
   * @param {number} level
   */
  async function bulkDownload(level) {
    const { componentId } = session();
    const resp = await fetch('/api/config/bulk-download', {
      method:  'POST',
      headers: headers(),
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
   */
  async function downloadFullConfig(userContext, userName = '') {
    const { componentId } = session();
    const url = `/api/config/download-full`
      + `?componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await fetch(url, { headers: headers() });
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
   */
  async function removeUser(userName, nodeAlias, componentId) {
    const { componentId: sessComp } = session();
    const resp = await request('/api/users/remove', {
      method:  'POST',
      headers: { ...headers(), 'x-component-id': sessionStorage.getItem('cc_componentId') },
      body:    JSON.stringify({ userName, nodeAlias, componentId: componentId || sessComp }),
    });
    return resp.json();
  }


  /**
   * List files and folders inside a configuration node (file browser).
   * @param {string} userContext - node alias
   * @param {string} [subPath]  - subfolder to navigate into
   * @param {string} [userName] - empty = DEFAULT config
   * @returns {Promise<Array>} array of node entries
   */
  async function getConfigurationNodes(userContext, subPath = '', userName = '') {
    const { componentId } = session();
    const url = `/api/config/nodes`
      + `?componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&subPath=${encodeURIComponent(subPath)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await request(url);
    return resp.json();
  }

  /**
   * Download a single configuration file by path (no ZIP needed).
   * @param {string} userContext - node alias
   * @param {string} subPath - subfolder path (e.g. "Presentation\Graphs")
   * @param {string} configurationId - filename
   * @param {string} [userName] - defaults to empty (DEFAULT config)
   * @returns {Promise<{content, filename, node}>}
   */
  async function downloadSingleFile(userContext, subPath, configurationId, userName = '') {
    const { componentId } = session();
    const url = `/api/config/file?asText=true`
      + `&componentId=${encodeURIComponent(componentId)}`
      + `&userContext=${encodeURIComponent(userContext)}`
      + `&subPath=${encodeURIComponent(subPath)}`
      + `&configurationId=${encodeURIComponent(configurationId)}`
      + `&userName=${encodeURIComponent(userName)}`;
    const resp = await request(url);
    return resp.json();
  }

  /**
   * Fetch the sub-hierarchy for a specific node alias.
   * @param {string} alias - Node alias
   */
  async function getNodeHierarchy(alias) {
    const resp = await request(`/api/hierarchy/node?alias=${encodeURIComponent(alias)}`);
    return resp.json();
  }

  /**
   * Search for configuration files across all nodes.
   * @param {string} query - search keyword
   */
  async function searchWidgets(query) {
    const resp = await request(`/api/config/search-widgets?query=${encodeURIComponent(query)}`);
    return resp.json();
  }

  return { session, getHierarchy, downloadConfig, previewConfig, compareConfigs, assignUser, removeUser, bulkDownload, downloadSingleFile, getConfigurationNodes, downloadFullConfig, getNodeHierarchy, searchWidgets };
})();

