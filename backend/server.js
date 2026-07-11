'use strict';

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const https    = require('https');
const { spawn } = require('child_process');
const path     = require('path');
const AdmZip   = require('adm-zip');
require('dotenv').config();

// ─── App Setup ────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// Accept self-signed certs from the app server
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── Helper: build CompanyChart headers ───────────────────────────────────────
function ccHeaders(req) {
    const auth = req.headers['authorization'] || '';
    return {
        'accept':                    'application/json',
        'accept-encoding':           'gzip, deflate, br',
        'accept-language':           'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        'authorization':             auth,
        'x-auth-context':            'Default',
        'x-auth-lang':               'en-US',
        'x-presentation-options':    'data.style=minimal',
    };
}

// ─── POST /api/login ──────────────────────────────────────────────────────────
// Body: { appServer, componentId, componentPassword, serviceUsername, acmDllPath }
app.post('/api/login', (req, res) => {
    const {
        appServer,
        componentId       = 'brk',
        componentPassword = process.env.DEFAULT_COMPONENT_PASSWORD || 'acm',
        serviceUsername   = process.env.DEFAULT_SERVICE_USERNAME   || 'SSC.DEFAULT@SERVICE',
        acmDllPath        = process.env.ACM_DLL_PATH               || '',
    } = req.body;

    if (!appServer)  return res.status(400).json({ error: 'appServer is required' });
    if (!acmDllPath) return res.status(400).json({ error: 'acmDllPath is required' });

    const scriptPath = path.join(__dirname, 'scripts', 'get-token.ps1');

    const ps = spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-NonInteractive',
        '-File',            scriptPath,
        '-AppServer',       appServer,
        '-ComponentId',     componentId,
        '-ComponentPassword', componentPassword,
        '-ServiceUsername', serviceUsername,
        '-AcmDllPath',      acmDllPath,
    ]);

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    ps.on('error', err => {
        console.error('[login] spawn error:', err);
        res.status(500).json({ error: `PowerShell spawn failed: ${err.message}` });
    });

    ps.on('close', code => {
        const token = stdout.trim();
        if (code === 0 && token) {
            console.log(`[login] OK  appServer=${appServer}  componentId=${componentId}`);
            return res.json({ success: true, token, appServer, componentId });
        }
        console.error('[login] FAIL code=%d stderr=%s', code, stderr.trim());
        res.status(401).json({ success: false, error: stderr.trim() || 'Authentication failed' });
    });
});

// ─── GET /api/hierarchy ───────────────────────────────────────────────────────
// Query: getUsersInfo=true|false
// Headers: Authorization: Bearer <token>,  x-app-server: <host>
app.get('/api/hierarchy', async (req, res) => {
    const appServer    = req.headers['x-app-server'];
    const getUsersInfo = req.query.getUsersInfo || 'true';

    if (!appServer) return res.status(400).json({ error: 'x-app-server header is required' });

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/CompanyChartStructureManagement/getCompanyChartHierarchy?getUsersInfo=${getUsersInfo}`;
        const response = await axios.get(url, { headers: ccHeaders(req), httpsAgent });
        res.json(response.data);
    } catch (err) {
        console.error('[hierarchy] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
    }
});
// ─── GET /api/hierarchy/node ──────────────────────────────────────────────────
// Recupera la sotto-gerarchia a partire da un nodo specifico.
// Query: alias
app.get('/api/hierarchy/node', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { alias } = req.query;

    if (!appServer || !alias) {
        return res.status(400).json({ error: 'Missing alias or x-app-server header' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/CompanyChartStructureManagement/getNodeHierachy?alias=${encodeURIComponent(alias)}`;
        const response = await axios.get(url, { headers: ccHeaders(req), httpsAgent });
        res.json(response.data);
    } catch (err) {
        console.error('[hierarchy/node] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
    }
});


// ─── GET /api/config/download ─────────────────────────────────────────────────
// Query: componentId, userName, userContext
app.get('/api/config/download', async (req, res) => {
    const appServer   = req.headers['x-app-server'];
    const { componentId, userName, userContext } = req.query;

    if (!appServer || !componentId || !userName || !userContext) {
        return res.status(400).json({ error: 'Missing required params: componentId, userName, userContext + header x-app-server' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationNode`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`;

        const response = await axios.get(url, {
            headers:       { ...ccHeaders(req), accept: 'application/octet-stream' },
            responseType:  'arraybuffer',
            httpsAgent,
        });

        const filename = `${appServer}#${componentId}#${userName}#${userContext}.zip`;
        res.set({
            'Content-Type':        'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length':      response.data.byteLength,
        });
        res.send(Buffer.from(response.data));
    } catch (err) {
        console.error('[config/download] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── GET /api/config/download-full ───────────────────────────────────────────
// Scarica la configurazione COMPLETA (tutte le cartelle: DataSources, Graphs,
// GraphSettings, EMForms, UserGraphSettings) via downloadConfigurationFull.
// Query: componentId, userName, userContext
app.get('/api/config/download-full', async (req, res) => {
    const appServer   = req.headers['x-app-server'];
    const { userName = '', userContext } = req.query;
    const componentId = req.query.componentId || req.headers['x-component-id'];

    if (!appServer || !userContext) {
        return res.status(400).json({ error: 'Missing required params: userContext + header x-app-server' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationFull`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`;

        const response = await axios.get(url, {
            headers:      { ...ccHeaders(req), accept: 'application/octet-stream' },
            responseType: 'arraybuffer',
            httpsAgent,
        });

        const filename = `FULL#${appServer}#${componentId}#${userName || 'DEFAULT'}#${userContext}.zip`;
        res.set({
            'Content-Type':        'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length':      response.data.byteLength,
        });
        res.send(Buffer.from(response.data));
    } catch (err) {
        console.error('[config/download-full] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── GET /api/config/preview ──────────────────────────────────────────────────
// Same params as download but returns ZIP contents as JSON (for in-browser viewing)
app.get('/api/config/preview', async (req, res) => {
    const appServer   = req.headers['x-app-server'];
    const { componentId, userName, userContext } = req.query;

    if (!appServer || !componentId || userName === undefined || userName === null || !userContext) {
        return res.status(400).json({ error: 'Missing required params' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationNode`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`;

        const response = await axios.get(url, {
            headers:      { ...ccHeaders(req), accept: 'application/octet-stream' },
            responseType: 'arraybuffer',
            httpsAgent,
        });

        const zip     = new AdmZip(Buffer.from(response.data));
        const entries = zip.getEntries();
        const files   = [];

        entries.forEach(entry => {
            if (!entry.isDirectory) {
                const raw = entry.getData().toString('utf8');
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch (_) { /* not JSON */ }
                files.push({
                    name:    entry.entryName,
                    size:    entry.header.size,
                    content: raw,
                    json:    parsed,
                });
            }
        });

        res.json({ node: userContext, user: userName, componentId, appServer, files });
    } catch (err) {
        console.error('[config/preview] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── GET /api/config/compare ──────────────────────────────────────────────────
// Query: componentId, userNameA, userContextA, userNameB, userContextB
app.get('/api/config/compare', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { componentId, userNameA, userContextA, userNameB, userContextB } = req.query;

    if (!appServer || !componentId || userNameA === undefined || userNameA === null || !userContextA || userNameB === undefined || userNameB === null || !userContextB) {
        return res.status(400).json({ error: 'Missing required params for compare' });
    }

    async function fetchFiles(userName, userContext) {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationNode`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`;

        const response = await axios.get(url, {
            headers:      { ...ccHeaders(req), accept: 'application/octet-stream' },
            responseType: 'arraybuffer',
            httpsAgent,
        });
        const zip   = new AdmZip(Buffer.from(response.data));
        const files = {};
        zip.getEntries().forEach(entry => {
            if (!entry.isDirectory) {
                files[entry.entryName] = entry.getData().toString('utf8');
            }
        });
        return files;
    }

    try {
        const [filesA, filesB] = await Promise.all([
            fetchFiles(userNameA, userContextA),
            fetchFiles(userNameB, userContextB),
        ]);

        const allKeys = new Set([...Object.keys(filesA), ...Object.keys(filesB)]);
        const comparison = [];

        allKeys.forEach(key => {
            const contentA = filesA[key] || null;
            const contentB = filesB[key] || null;
            let status = 'equal';
            if (!contentA) status = 'added';
            else if (!contentB) status = 'removed';
            else if (contentA !== contentB) status = 'modified';
            comparison.push({ file: key, status, contentA, contentB });
        });

        console.log(`[config/compare] Compare nodes: Left=${userNameA || 'DEFAULT'}@${userContextA} (${Object.keys(filesA).length} files) vs Right=${userNameB || 'DEFAULT'}@${userContextB} (${Object.keys(filesB).length} files). Total union keys: ${allKeys.size}`);

        res.json({
            left:  { user: userNameA, node: userContextA },
            right: { user: userNameB, node: userContextB },
            componentId,
            files: comparison,
        });
    } catch (err) {
        console.error('[config/compare] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── POST /api/users/assign ───────────────────────────────────────────────────
// Body: { userName, nodeAlias, componentId? }
app.post('/api/users/assign', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { userName, nodeAlias, componentId } = req.body;
    const { componentId: sessionComponent } = { componentId: req.headers['x-component-id'] };
    const compId = componentId || sessionComponent;

    if (!appServer || !userName || !nodeAlias || !compId) {
        return res.status(400).json({ error: 'Missing required params: userName, nodeAlias, componentId' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/UserManagement/assignUserToCompanyChart`
            + `?componentId=${encodeURIComponent(compId)}`
            + `&nodeAlias=${encodeURIComponent(nodeAlias)}`
            + `&isDefault=false`;

        const response = await axios.post(url, JSON.stringify([userName]), {
            headers: {
                ...ccHeaders(req),
                'content-type':  'application/json; charset=UTF-8',
                'x-auth-user':   userName,
                'origin':        `https://${appServer}`,
            },
            httpsAgent,
        });

        console.log(`[users/assign] OK  user=${userName}  node=${nodeAlias}`);
        res.json({ success: true, data: response.data });
    } catch (err) {
        console.error('[users/assign] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
    }
});

// ─── POST /api/users/remove ───────────────────────────────────────────────────
// Body: { userName, nodeAlias, componentId? }
app.post('/api/users/remove', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { userName, nodeAlias, componentId } = req.body;
    const compId = componentId || req.headers['x-component-id'];

    if (!appServer || !userName || !nodeAlias || !compId) {
        return res.status(400).json({ error: 'Missing required params: userName, nodeAlias' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/UserManagement/removeUserFromNode`
            + `?componentId=${encodeURIComponent(compId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&nodeAlias=${encodeURIComponent(nodeAlias)}`;

        const response = await axios.post(url, {
            headers: {
                normalizedNames: {},
                lazyUpdate: null,
                headers: {}
            }
        }, {
            headers: {
                ...ccHeaders(req),
                'content-type': 'application/json',
                'origin': `https://${appServer}`,
            },
            httpsAgent,
        });

        console.log(`[users/remove] OK  user=${userName}  node=${nodeAlias}`);
        res.json({ success: true, data: response.data });
    } catch (err) {
        console.error('[users/remove] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
    }
});

// ─── POST /api/config/bulk-download ──────────────────────────────────────────
// Scarica tutte le configurazioni di tutti gli utenti ai nodi di un dato livello.
// Body: { level, componentId? }
// Risponde con un unico ZIP contenente tutti i sotto-ZIP.
app.post('/api/config/bulk-download', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { level, componentId } = req.body;
    const compId = componentId || req.headers['x-component-id'];

    if (!appServer || level === undefined || level === null) {
        return res.status(400).json({ error: 'Missing required params: level' });
    }

    try {
        // 1. Get hierarchy
        const hierResp = await axios.get(
            `https://${appServer}/CompanyChart/api/v1/CompanyChartStructureManagement/getCompanyChartHierarchy?getUsersInfo=true`,
            { headers: ccHeaders(req), httpsAgent }
        );
        const hierarchy = hierResp.data;

        // 2. Collect nodes at target level
        function collectNodesAtLevel(node, targetLevel) {
            const results = [];
            const nodeLevel = node.node?.level ?? node.node?.Level;
            if (nodeLevel === parseInt(targetLevel, 10)) results.push(node);
            if (node.children) node.children.forEach(c => results.push(...collectNodesAtLevel(c, targetLevel)));
            return results;
        }
        const targetNodes = collectNodesAtLevel(hierarchy, level);

        if (!targetNodes.length) {
            return res.status(404).json({ error: `No nodes found at level ${level}` });
        }

        // 3. Build list of (user, node) pairs (non-service users for the component)
        const pairs = [];
        targetNodes.forEach(nodeData => {
            const alias = nodeData.node?.alias;
            if (!nodeData.usersList) return;
            nodeData.usersList
                .filter(u => u.componentid === compId && !u.isServiceUser)
                .forEach(u => pairs.push({ user: u.user, node: alias }));
        });

        if (!pairs.length) {
            return res.status(404).json({ error: `No users found at level ${level} for component ${compId}` });
        }

        // 4. Download each config ZIP and bundle into a master ZIP
        const masterZip = new AdmZip();
        const errors    = [];

        await Promise.allSettled(pairs.map(async ({ user, node }) => {
            try {
                const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationNode`
                    + `?componentId=${encodeURIComponent(compId)}`
                    + `&userName=${encodeURIComponent(user)}`
                    + `&userContext=${encodeURIComponent(node)}`;

                const dlResp = await axios.get(url, {
                    headers: { ...ccHeaders(req), accept: 'application/octet-stream' },
                    responseType: 'arraybuffer',
                    httpsAgent,
                });
                const filename = `${appServer}#${compId}#${user}#${node}.zip`;
                masterZip.addFile(filename, Buffer.from(dlResp.data));
            } catch (e) {
                errors.push({ user, node, error: e.message });
            }
        }));

        const masterBuffer = masterZip.toBuffer();
        const masterName   = `bulk_L${level}_${compId}_${Date.now()}.zip`;

        res.set({
            'Content-Type':        'application/zip',
            'Content-Disposition': `attachment; filename="${masterName}"`,
            'Content-Length':      masterBuffer.length,
            'X-Bulk-Total':        pairs.length,
            'X-Bulk-Errors':       errors.length,
        });
        res.send(masterBuffer);

        if (errors.length) {
            console.warn('[bulk-download] completed with errors:', errors);
        }
    } catch (err) {
        console.error('[bulk-download] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── GET /api/config/nodes ────────────────────────────────────────────────────
// Lista file e cartelle dentro una configurazione (browser navigabile).
// Query: componentId?, userContext (node), subPath?, userName?
app.get('/api/config/nodes', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { userContext, subPath = '', userName = '' } = req.query;
    const compId = req.query.componentId || req.headers['x-component-id'];

    if (!appServer || !userContext) {
        return res.status(400).json({ error: 'Missing required params: userContext' });
    }

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/getConfigurationNodes`
            + `?componentId=${encodeURIComponent(compId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`
            + `&subPath=${encodeURIComponent(subPath)}`;

        const response = await axios.get(url, { headers: ccHeaders(req), httpsAgent });
        res.json(response.data);
    } catch (err) {
        console.error('[config/nodes] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── GET /api/config/file ─────────────────────────────────────────────────────
// Scarica un singolo file da una configurazione (senza ZIP completo).
// Query: componentId, userContext (node), subPath, configurationId (filename), userName?
app.get('/api/config/file', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { componentId, userContext, subPath = '', configurationId, userName = '' } = req.query;

    if (!appServer || !userContext || !configurationId) {
        return res.status(400).json({ error: 'Missing required params: userContext, configurationId' });
    }

    const compId = componentId || req.headers['x-component-id'];

    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfiguration`
            + `?componentId=${encodeURIComponent(compId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`
            + `&subPath=\\${encodeURIComponent(subPath)}`
            + `&configurationId=${encodeURIComponent(configurationId)}`;

        const response = await axios.get(url, {
            headers:      { ...ccHeaders(req), 'x-auth-user': userName || 'SEDAPTA2' },
            responseType: 'arraybuffer',
            httpsAgent,
        });

        // Try to detect if it's JSON (text) or binary
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const isText = contentType.includes('json') || contentType.includes('text');

        if (isText || req.query.asText === 'true') {
            const text = Buffer.from(response.data).toString('utf8');
            res.set('Content-Type', 'application/json');
            try {
                res.json({ content: text, filename: configurationId, node: userContext });
            } catch (_) {
                res.json({ content: text, filename: configurationId, node: userContext });
            }
        } else {
            res.set({
                'Content-Type':        contentType,
                'Content-Disposition': `attachment; filename="${configurationId}"`,
                'Content-Length':      response.data.byteLength,
            });
            res.send(Buffer.from(response.data));
        }
    } catch (err) {
        console.error('[config/file] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── Simple In-Memory Cache for Configuration Nodes ───────────────────────────
const configNodesCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

function getCachedConfigNodes(key) {
    const cached = configNodesCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }
    return null;
}

function setCachedConfigNodes(key, data) {
    configNodesCache.set(key, { timestamp: Date.now(), data });
}

// ─── GET /api/config/search-widgets ──────────────────────────────────────────
// Cerca file di configurazione (es. widget) che contengono la query nel nome
// in tutti i nodi della gerarchia.
// Query: query
app.get('/api/config/search-widgets', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { query } = req.query;
    const compId = req.headers['x-component-id'] || 'demand';

    if (!appServer || !query) {
        return res.status(400).json({ error: 'Missing query or x-app-server header' });
    }

    const searchTerm = query.toLowerCase().trim();

    try {
        // 1. Recupera la gerarchia per trovare tutti i nodi
        const hierResp = await axios.get(
            `https://${appServer}/CompanyChart/api/v1/CompanyChartStructureManagement/getCompanyChartHierarchy?getUsersInfo=false`,
            { headers: ccHeaders(req), httpsAgent }
        );
        const hierarchy = hierResp.data;

        // 2. Estrai tutti gli alias dei nodi (in modo piatto)
        const nodeAliases = [];
        function walk(node) {
            if (node.node?.alias) nodeAliases.push(node.node.alias);
            if (node.children) node.children.forEach(walk);
        }
        walk(hierarchy);

        // 3. Recupera i file di tutti i nodi in parallelo (con cache)
        const searchResults = [];

        await Promise.allSettled(nodeAliases.map(async (alias) => {
            try {
                const cacheKey = `${appServer}#${compId}#${alias}`;
                let files = getCachedConfigNodes(cacheKey);

                if (!files) {
                    const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/getConfigurationNodes`
                        + `?componentId=${encodeURIComponent(compId)}`
                        + `&userName=`
                        + `&userContext=${encodeURIComponent(alias)}`
                        + `&subPath=`;

                    const resp = await axios.get(url, { headers: ccHeaders(req), httpsAgent });
                    const nodes = resp.data;

                    if (Array.isArray(nodes)) {
                        files = nodes;
                    } else if (nodes && (nodes.configurationid || nodes.configurationId || nodes.ConfigurationId)) {
                        files = nodes.configurationid || nodes.configurationId || nodes.ConfigurationId;
                    } else if (nodes) {
                        files = nodes.items || nodes.children || Object.values(nodes) || [];
                    } else {
                        files = [];
                    }

                    // Salva in cache
                    setCachedConfigNodes(cacheKey, files);
                }

                // Cerca corrispondenze nell'elenco dei file di questo nodo
                const matches = [];
                files.forEach(file => {
                    const fullPath = typeof file === 'string'
                        ? file
                        : (file.name || file.Name || file.configurationid || file.configurationId || file.ConfigurationId || '');
                    
                    if (fullPath.toLowerCase().includes(searchTerm)) {
                        matches.push({
                            fullPath,
                            filename: fullPath.split('\\').pop(),
                            subPath: fullPath.includes('\\') ? fullPath.substring(0, fullPath.lastIndexOf('\\')) : ''
                        });
                    }
                });

                if (matches.length > 0) {
                    searchResults.push({
                        node: alias,
                        matches
                    });
                }
            } catch (err) {
                console.warn(`[search-widgets] Errore caricamento file per nodo ${alias}:`, err.message);
            }
        }));

        res.json({ query, results: searchResults });
    } catch (err) {
        console.error('[search-widgets] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// ─── Fallback: serve app.html for any unknown route ───────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║  Company Chart Frontend  –  http://localhost:${PORT}  ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
    console.log(`  ACM DLL : ${process.env.ACM_DLL_PATH || '(set in .env)'}`);
    console.log(`  Mode    : ${process.env.NODE_ENV || 'development'}\n`);
});
