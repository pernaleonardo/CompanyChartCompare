'use strict';

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const https    = require('https');
const { spawn } = require('child_process');
const fs       = require('fs');
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
        acmDllPath: inputDllPath = '',
    } = req.body;

    const envDllPath = (process.env.ACM_DLL_PATH || '').trim();

    let acmDllPath = (inputDllPath || '').trim();
    // Se l'input è vuoto oppure il file specificato non esiste su disco, ma envDllPath esiste -> usa envDllPath
    if (envDllPath && (!acmDllPath || !fs.existsSync(acmDllPath))) {
        acmDllPath = envDllPath;
    }
    if (!acmDllPath && envDllPath) {
        acmDllPath = envDllPath;
    }

    if (!appServer)  return res.status(400).json({ error: 'appServer is required' });
    if (!acmDllPath) return res.status(400).json({ error: 'acmDllPath is required (imposta ACM_DLL_PATH nel file .env o nel form)' });

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
// Query: userNameA, userContextA, userNameB, userContextB, componentId?
app.get('/api/config/compare', async (req, res) => {
    // Dynamic params for Left (A) and Right (B) sides
    const appServerA = req.headers['x-app-server-a'] || req.headers['x-app-server'];
    const appServerB = req.headers['x-app-server-b'] || req.headers['x-app-server'];
    const tokenA     = req.headers['x-token-a'] || (req.headers['authorization'] || '').replace('Bearer ', '');
    const tokenB     = req.headers['x-token-b'] || (req.headers['authorization'] || '').replace('Bearer ', '');
    const compIdA    = req.headers['x-component-id-a'] || req.query.componentId;
    const compIdB    = req.headers['x-component-id-b'] || req.query.componentId;

    const { userNameA, userContextA, userNameB, userContextB } = req.query;

    if (!appServerA || !appServerB || !compIdA || !compIdB ||
        userNameA === undefined || userNameA === null || !userContextA ||
        userNameB === undefined || userNameB === null || !userContextB) {
        return res.status(400).json({ error: 'Missing required params for compare' });
    }

    async function fetchFiles(appServer, token, componentId, userName, userContext) {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationNode`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName)}`
            + `&userContext=${encodeURIComponent(userContext)}`;

        const headers = {
            'accept':                    'application/json',
            'accept-encoding':           'gzip, deflate, br',
            'accept-language':           'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            'authorization':             `Bearer ${token}`,
            'x-auth-context':            'Default',
            'x-auth-lang':               'en-US',
            'x-presentation-options':    'data.style=minimal',
            'accept':                    'application/octet-stream'
        };

        const response = await axios.get(url, {
            headers,
            responseType:  'arraybuffer',
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
            fetchFiles(appServerA, tokenA, compIdA, userNameA, userContextA),
            fetchFiles(appServerB, tokenB, compIdB, userNameB, userContextB),
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

        console.log(`[config/compare] Cross-env compare: Left=${userNameA || 'DEFAULT'}@${userContextA} on ${appServerA} vs Right=${userNameB || 'DEFAULT'}@${userContextB} on ${appServerB}. Total files: ${allKeys.size}`);

        res.json({
            left:  { user: userNameA, node: userContextA, appServer: appServerA },
            right: { user: userNameB, node: userContextB, appServer: appServerB },
            componentIdA: compIdA,
            componentIdB: compIdB,
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

// ─── Simple In-Memory Cache for Node Contents ─────────────────────────────────
const nodeContentsCache = new Map();

function getCachedNodeContents(key) {
    const cached = nodeContentsCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }
    return null;
}

function setCachedNodeContents(key, data) {
    nodeContentsCache.set(key, { timestamp: Date.now(), data });
}

// ─── GET /api/config/search-node-content ──────────────────────────────────────
// Cerca nel contenuto testuale dei file ZIP di un singolo nodo
// Query: query, nodeAlias
app.get('/api/config/search-node-content', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { query, nodeAlias, searchFile, searchTag, searchContent } = req.query;
    const compId = req.headers['x-component-id'] || 'demand';

    if (!appServer || !query || !nodeAlias) {
        return res.status(400).json({ error: 'Missing query, nodeAlias or x-app-server header' });
    }

    const isSearchFile = searchFile === 'true';
    const isSearchTag = searchTag === 'true';
    const isSearchContent = searchContent === 'true';

    const searchTerm = query.toLowerCase().trim();
    const escapedQuery = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Tag name: "<query" or "</query" or ""query":"
    const tagRegex = new RegExp(`(?:<\\/?${escapedQuery}[\\s>]|"${escapedQuery}"\\s*:)`, 'i');
    
    // Content: ">...query...<" or "="..."query""" or json values
    const contentRegex = new RegExp(`(?:>[^<]*${escapedQuery}[^<]*<|="[^"]*${escapedQuery}[^"]*"|:\\s*(?:"[^"]*${escapedQuery}[^"]*"|[^",\\s][^",]*${escapedQuery}[^",]*))`, 'i');

    const cacheKey = `${appServer}#${compId}#${nodeAlias}_content`;
    let filesData = getCachedNodeContents(cacheKey);

    try {
        if (!filesData) {
            const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/downloadConfigurationNode`
                + `?componentId=${encodeURIComponent(compId)}`
                + `&userName=`
                + `&userContext=${encodeURIComponent(nodeAlias)}`;

            const dlResp = await axios.get(url, {
                headers: { ...ccHeaders(req), accept: 'application/octet-stream' },
                responseType: 'arraybuffer',
                httpsAgent,
            });

            const zip = new AdmZip(Buffer.from(dlResp.data));
            filesData = {};
            zip.getEntries().forEach(entry => {
                if (!entry.isDirectory) {
                    filesData[entry.entryName] = entry.getData().toString('utf8');
                }
            });
            setCachedNodeContents(cacheKey, filesData);
        }

        const matches = [];
        for (const [fullPath, content] of Object.entries(filesData)) {
            let matched = false;
            let matchIndex = -1;

            if (isSearchFile && fullPath.toLowerCase().includes(searchTerm)) {
                matched = true;
            }
            
            if (isSearchTag && !matched) {
                const tagM = content.match(tagRegex);
                if (tagM) { matched = true; matchIndex = tagM.index; }
            }

            if (isSearchContent && !matched) {
                const contentM = content.match(contentRegex);
                if (contentM) { matched = true; matchIndex = contentM.index; }
            }
            
            if (matched && matchIndex === -1) {
                const idx = content.toLowerCase().indexOf(searchTerm);
                if (idx !== -1) {
                    matchIndex = idx;
                } else {
                    matchIndex = 0;
                }
            }

            if (matched) {
                let snippet = '';
                if (matchIndex >= 0 && content.length > 0) {
                    const idx = Math.max(0, matchIndex);
                    const start = Math.max(0, idx - 40);
                    const end = Math.min(content.length, idx + searchTerm.length + 40);
                    snippet = content.substring(start, end);
                    if (start > 0) snippet = '...' + snippet;
                    if (end < content.length) snippet = snippet + '...';
                }

                // Handle both forward slashes (from AdmZip) and backslashes
                const normalizedPath = fullPath.replace(/\\/g, '/');
                const lastSlashIdx = normalizedPath.lastIndexOf('/');
                
                matches.push({
                    fullPath,
                    filename: lastSlashIdx >= 0 ? fullPath.substring(lastSlashIdx + 1) : fullPath,
                    subPath: lastSlashIdx >= 0 ? fullPath.substring(0, lastSlashIdx).replace(/\//g, '\\') : '',
                    snippet
                });
            }
        }

        res.json({ node: nodeAlias, matches });
    } catch (err) {
        // Se non esiste la configurazione per il nodo, restituisci array vuoto
        if (err.response?.status === 404 || err.response?.status === 500) {
            return res.json({ node: nodeAlias, matches: [] });
        }
        console.error(`[search-node-content] error per ${nodeAlias}:`, err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});


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
                        const normalizedPath = fullPath.replace(/\\/g, '/');
                        const lastSlashIdx = normalizedPath.lastIndexOf('/');
                        matches.push({
                            fullPath,
                            filename: lastSlashIdx >= 0 ? fullPath.substring(lastSlashIdx + 1) : fullPath,
                            subPath: lastSlashIdx >= 0 ? fullPath.substring(0, lastSlashIdx).replace(/\//g, '\\') : ''
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

// ─── POST /api/config/upload ──────────────────────────────────────────────────
// Uploads a configuration file to the CompanyChart API
app.post('/api/config/upload', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { componentId, userContext, userName, subPath, fileName, content } = req.body;
    
    if (!appServer || !componentId || !userContext || !fileName || content === undefined) {
        return res.status(400).json({ error: 'Missing required params' });
    }
    
    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/setConfigurationByUpload`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName || '')}`
            + `&userContext=${encodeURIComponent(userContext)}`
            + `&subPath=${encodeURIComponent(subPath || '')}`
            + `&validateEncoding=true&forceEncoding=false`;

        // Manual multipart/form-data construction for maximum compatibility
        const boundary = `----FormBoundary${Math.random().toString(36).substring(2)}`;
        const payload = Buffer.concat([
            Buffer.from(`--${boundary}\r\n`),
            Buffer.from(`Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n`),
            Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`),
            Buffer.from(content, 'utf8'),
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);

        const response = await axios.post(url, payload, {
            headers: {
                ...ccHeaders(req),
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'origin': `https://${appServer}`,
            },
            httpsAgent,
        });

        console.log(`[config/upload] OK  user=${userName}  node=${userContext} file=${fileName}`);
        res.json({ success: true, data: response.data });
    } catch (err) {
        console.error('[config/upload] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
    }
});

// ─── POST /api/config/remove ──────────────────────────────────────────────────
// Deletes a configuration file from the CompanyChart API
app.post('/api/config/remove', async (req, res) => {
    const appServer = req.headers['x-app-server'];
    const { componentId, userContext, userName, subPath, fileName } = req.body;
    
    if (!appServer || !componentId || !userContext || !fileName) {
        return res.status(400).json({ error: 'Missing required params' });
    }
    
    try {
        const url = `https://${appServer}/CompanyChart/api/v1/ConfigurationManagement/deleteConfigurations`
            + `?componentId=${encodeURIComponent(componentId)}`
            + `&userName=${encodeURIComponent(userName || '')}`
            + `&userContext=${encodeURIComponent(userContext)}`;

        const payload = [
            {
                configurationId: fileName,
                subPath: subPath === 'none' || !subPath ? '' : subPath
            }
        ];

        const response = await axios.post(url, payload, {
            headers: {
                ...ccHeaders(req),
                'Content-Type': 'application/json',
                'origin': `https://${appServer}`,
            },
            httpsAgent,
        });

        console.log(`[config/remove] OK  user=${userName}  node=${userContext} file=${fileName}`);
        res.json({ success: true, data: response.data });
    } catch (err) {
        console.error('[config/remove] error:', err.message);
        res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
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
