# Company Chart Compare - Analisi e Conoscenza Progetto

## 1. Architettura dei Dati
Il progetto adotta un'architettura client-server leggera, divisa tra un frontend puro (Vanilla JS/HTML/CSS) e un backend proxy in Node.js (Express).

*   **Backend (Proxy & Bridge DLL):** Il backend funge da mediatore (BFF - Backend For Frontend) tra il browser e le API "Company Chart" del server aziendale (AppServer). Risolve il problema del CORS e centralizza l'autenticazione. Un dettaglio architetturale rilevante è il login: utilizza uno script PowerShell (`get-token.ps1`) richiamato via Node.js tramite `child_process.spawn`. Questo script fa da bridge interagendo con una libreria .NET (`Sedapta.ACM.Client.dll`) per generare il token di autenticazione. Inoltre, il backend gestisce on-the-fly lo scaricamento e la decompressione (tramite `adm-zip`) dei pacchetti ZIP di configurazione che l'API remota espone in forma binaria.
*   **Frontend (Vanilla JS):** È stato sviluppato senza l'uso di framework reattivi complessi (React/Vue/Angular), optando per un pattern a moduli isolati basati su IIFE (es. `const Compare = (() => { ... })();`). Questo favorisce la leggerezza. Lo stato (nodi aperti nell'albero, esclusioni per il diff, filtri testuali) viene gestito in memoria e, dove necessario (regole di esclusione), persistito nel `localStorage`.

## 2. Algoritmi Principali

### A. Algoritmo di Confronto Configurazioni (JSON Diffing Intelligente)
Piuttosto che eseguire un semplice *diff testuale* tra file che genererebbe falsi positivi (es. spaziature diverse o chiavi in ordine diverso), l'applicazione applica un algoritmo di normalizzazione:
1.  **Parsing:** Tenta di analizzare il file testuale come JSON.
2.  **Filtraggio (Stripping):** Viene invocata in modo ricorsivo la funzione `stripIgnoredKeys` che rimuove determinate proprietà configurate dall'utente (es. UUID, date di aggiornamento) rimpiazzandole con un placeholder `"&lt;escluso dal confronto&gt;"`.
3.  **Riformattazione:** Il JSON filtrato viene serializzato (`JSON.stringify`) applicando un rientro canonico a 2 spazi.
4.  **Allineamento:** Il risultato viene spezzato riga per riga (`diffLines`) ed affiancato. Delle classi CSS evidenziano aggiunte (`add`) o rimozioni (`del`).

### B. Esplorazione Ricorsiva ad Albero (DFS)
La visualizzazione dell'organigramma o "Company Chart" è un classico problema informatico basato sugli alberi. Il frontend implementa vari attraversamenti in profondità (Depth-First Search) pre-ordine per:
*   **Ricerca Textuale:** Scorrere tutti i figli di un nodo per vedere se uno qualsiasi combacia con la stringa di ricerca. In tal caso, i nodi genitori vengono espansi automaticamente.
*   **Filtraggio Livelli:** La funzione `hasDescendantAtLevel` verifica ricorsivamente se un determinato ramo "morto" nasconde in profondità un nodo appartenente al livello ricercato prima di nasconderlo dall'interfaccia.

### C. Estrazione ed Aggregazione Parallela (Bulk Download)
L'algoritmo di Bulk Download lato backend riceve la richiesta di scaricare tutto il livello X.
1. Scarica l'intero albero logico via API.
2. Naviga l'albero fino a trovare tutti i nodi bersaglio del livello richiesto.
3. Ottiene la lista di tutti gli *utenti non di servizio* incrociando i dati associati a quei nodi.
4. Usa `Promise.allSettled` per eseguire contemporaneamente il download degli ZIP di configurazione di tutti quegli utenti.
5. Inserisce dinamicamente i file ricevuti in un singolo ZIP master archiviato in RAM (`adm-zip`), per poi servirlo in un flusso binario diretto al browser.

---

## 3. Funzioni Chiave e Frammenti di Codice

### 3.1 Normalizzazione ed Esclusione Proprietà JSON (Frontend - `compare.js`)
Questa funzione attraversa ricorsivamente l'oggetto JSON per annullare il valore di chiavi specifiche, rendendo così il "diff" cieco rispetto ad attributi mutevoli ma irrilevanti.

```javascript
// Deeply strip ignored keys from JSON object
function stripIgnoredKeys(obj, keysToIgnore) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => stripIgnoredKeys(item, keysToIgnore));
  }

  const result = {};
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const shouldIgnore = keysToIgnore.some(ignoreKey => 
        ignoreKey.toLowerCase().trim() === k.toLowerCase().trim()
      );

      if (shouldIgnore) {
        result[k] = "<escluso dal confronto>";
      } else {
        result[k] = stripIgnoredKeys(obj[k], keysToIgnore);
      }
    }
  }
  return result;
}
```

### 3.2 Ricerca dei nodi per livello (Backend - `server.js`)
Questa semplice ed elegante funzione ricorsiva raccoglie tutti i nodi di un determinato livello esplorando in profondità tutto il `CompanyChart`. Usata per preparare il terreno al Bulk Download.

```javascript
// 2. Collect nodes at target level
function collectNodesAtLevel(node, targetLevel) {
    const results = [];
    const nodeLevel = node.node?.level ?? node.node?.Level;
    if (nodeLevel === parseInt(targetLevel, 10)) results.push(node);
    
    if (node.children) {
        node.children.forEach(c => results.push(...collectNodesAtLevel(c, targetLevel)));
    }
    return results;
}
```

### 3.3 Autenticazione legacy con Spawn (Backend - `server.js`)
La particolarità del server Node risiede nella gestione di librerie `.dll` in un ecosistema JavaScript. Questo si risolve "usando" PowerShell in background e passandogli parametri sicuri per comunicare con la `Sedapta.ACM.Client.dll`.

```javascript
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

ps.on('close', code => {
    const token = stdout.trim();
    if (code === 0 && token) {
        // Successo: inoltra il token al frontend
        return res.json({ success: true, token, appServer, componentId });
    }
    // Errore
    res.status(401).json({ success: false, error: stderr.trim() || 'Authentication failed' });
});
```
