# Documento di Architettura Tecnica: Company Chart Compare

Questo documento descrive in dettaglio le scelte architetturali, lo stack tecnologico e le tecniche implementative (compresi gli aspetti di sicurezza) adottate nel progetto **Company Chart Compare**.

---

## 1. Architettura Generale e Pattern

L'applicativo si basa su un'architettura **Client-Server leggera**, strutturata secondo il pattern **Backend For Frontend (BFF)**.

### 1.1 Stack Tecnologico
*   **Frontend**: Sviluppato in puro **Vanilla JavaScript**, HTML5 e CSS3. L'assenza di framework reattivi (come React o Vue) è una scelta architetturale mirata ad abbattere il peso dell'applicativo e garantire massime performance. Il codice è strutturato a moduli isolati implementati tramite il pattern **IIFE** (Immediately Invoked Function Expression) per evitare l'inquinamento del namespace globale e simulare un forte incapsulamento (es. `const Compare = (() => { ... })();`).
*   **Backend**: Applicativo Node.js basato su **Express.js**. Svolge esclusivamente la funzione di strato intermedio (Proxy) tra il client web e le API enterprise (AppServer). Gestisce il traffico transazionale, supera i blocchi di sicurezza CORS imposti dai browser e coordina le procedure crittografiche per l'autenticazione.

---

## 2. Dettagli Implementativi e Sicurezza

### 2.1 Flusso di Autenticazione (Authentication Bridge)
Uno degli aspetti più complessi dal punto di vista della sicurezza è il rilascio del token di autenticazione. Il sistema remoto (AppServer) si aspetta un token generato tramite algoritmi proprietari (legati a un ecosistema Microsoft/.NET).

**Tecnica Utilizzata:**
Per colmare il divario tecnologico tra l'ecosistema Node.js e le librerie compilate .NET, il backend Node utilizza il modulo `child_process.spawn` per avviare un processo isolato di Windows PowerShell (`get-token.ps1`). 
1.  Il backend accetta le credenziali o i riferimenti in ingresso e avvia PowerShell in modalità `-NonInteractive` e `-ExecutionPolicy Bypass`.
2.  Lo script PowerShell carica dinamicamente a runtime una libreria .NET compilata (`Sedapta.ACM.Client.dll`).
3.  Utilizzando le API di interop, lo script invoca i metodi crittografici della DLL per negoziare la generazione sicura del Token.
4.  Il token viene restituito sullo `stdout` al processo Node.js e da lì inoltrato al frontend, garantendo l'accesso senza esporre il client a logiche di crittografia insicure o impossibili da riprodurre nel browser.

### 2.2 Gestione CORS e Forwarding Sicuro
Il frontend non comunica mai direttamente con l'AppServer. L'oggetto `httpsAgent` configurato con `rejectUnauthorized: false` (da limitare strettamente ad ambienti dev/test) viene utilizzato per incapsulare il traffico HTTPS locale. Le chiamate alle API aziendali sono impacchettate con header specifici (es. `x-auth-context`, `x-auth-lang`) intercettati e normalizzati dal layer Express.

---

## 3. Analisi delle Funzionalità Core

### 3.1 Navigazione della Company Chart (Alberatura DFS)
Il frontend deve renderizzare una gerarchia aziendale potenzialmente molto complessa.

**Tecnica Utilizzata:**
La renderizzazione e la ricerca (Text Search o filtraggio per Livelli) sfruttano un algoritmo di **Depth-First Search (DFS)** in pre-ordine. 
*   In fase di ricerca, l'albero del DOM non viene distrutto e ricreato (operazione costosa), ma ogni nodo viene visitato ricorsivamente.
*   Tramite l'algoritmo (es. `hasDescendantAtLevel`), il motore controlla se un sotto-ramo possiede figli che rispettano il criterio di filtraggio. In caso affermativo, l'intero ramo viene contrassegnato per l'espansione, altrimenti l'elemento DOM genitore viene collassato (tramite rimozione/aggiunta di classi CSS). Lo stato viene mantenuto in memoria (es. Set di ID dei nodi aperti).

### 3.2 Confronto Configurazioni (JSON Intelligent Diffing)
Il nucleo dell'applicativo è la capacità di confrontare due ZIP contenenti decine di configurazioni JSON (Cross-Environment Diff). Un semplice diff testuale risulterebbe inefficace per via di timestamp, ID univoci o spaziature.

**Tecnica Utilizzata:**
L'algoritmo di diffing procede in 4 fasi isolate per garantire precisione (Zero-False-Positive Diffing):
1.  **Estrazione in RAM:** Il backend scarica i due file ZIP in binario (`application/octet-stream`) e li scompatta direttamente in memoria ramificandone il contenuto in un Dictionary (Key: filename).
2.  **JSON Stripping Ricorsivo:** Le stringhe testuali vengono analizzate (`JSON.parse`). Una funzione di *stripping profondo* attraversa l'Abstract Syntax Tree dell'oggetto JSON, individuando chiavi dinamiche inserite dall'utente nella "blacklist" (es. `uuid`, `lastModified`). Queste proprietà vengono sovrascritte con un placeholder immutabile (`"<escluso dal confronto>"`).
3.  **Serializzazione Canonica:** L'albero AST viene riconvertito in stringa con un'identazione fissa (`JSON.stringify(obj, null, 2)`). Questo distrugge le discrepanze di formattazione originali.
4.  **Confronto Lineare:** Il file risultante viene analizzato riga per riga per evidenziare blocchi in aggiunta o in rimozione all'interno della UI.

### 3.3 Scaricamento Massivo e Aggregazione (Bulk Download)
La funzione permette all'amministratore di esportare massivamente la configurazione di un intero livello della Company Chart.

**Tecnica Utilizzata:**
Dal momento che l'AppServer permette solo lo scaricamento di *singoli* nodi, l'operazione richiede un fan-out asincrono.
1.  Il backend interroga l'albero, calcola l'identità di tutti i nodi al livello selezionato tramite una discesa DFS, e colleziona una serie di target.
2.  Viene generato un pool di chiamate HTTP asincrone coordinate da un approccio simile a `Promise.allSettled`. Si implementano accorgimenti di concorrenza per non intasare l'infrastruttura di rete e causare socket hang-up.
3.  Non appena i buffer di ogni file ZIP iniziano a ritornare, essi vengono instradati in memoria tramite la libreria `adm-zip`. I file contenuti negli ZIP parziali vengono decompressi, rinominati (per evitare collisioni, includendo ID ambiente e utente nel nome file) e rimpacchettati al volo in un *master ZIP*.
4.  Il payload master ZIP viene instradato verso il client utilizzando i corretti header `Content-Disposition: attachment`, mantenendo il footprint su disco del server Node.js strettamente a zero (I/O puramente in memory).

### 3.4 Assegnazione e Rimozione Utenti
Le richieste di assegnazione/rimozione di un utente a un nodo vengono inviate dal frontend, normalizzate dal proxy (che aggiunge header necessari, e previene attacchi CSRF validando l'origine locale) ed inviate alle API `UserManagement`. L'esito viene intercettato e trasformato in un formato JSON standardizzato (Success/Error Code) per facilitare il binding sulla UI lato client.
