# Company Chart Frontend

Frontend browser per la gestione delle configurazioni SedApta via **Company Chart API**.

## Prerequisiti

- [Node.js](https://nodejs.org/) ≥ 18
- `Sedapta.ACM.Client.dll` accessibile localmente
- Accesso di rete all'App Server SedApta

## Avvio rapido

```powershell
# 1. Installa le dipendenze del backend
cd backend
npm install

# 2. (Opzionale) Modifica il file .env con i tuoi valori predefiniti
notepad .env

# 3. Avvia il server
npm start
# oppure in modalità dev con auto-reload:
npm run dev

# 4. Apri il browser
Start-Process "http://localhost:3000"
```

## Struttura del progetto

```
CompanyChartCompare/
├── backend/
│   ├── server.js            # Express proxy server
│   ├── package.json
│   ├── .env                 # Configurazione (porta, path DLL, ecc.)
│   └── scripts/
│       └── get-token.ps1    # Script PS per token ACM via DLL
├── frontend/
│   ├── index.html           # Pagina di login
│   ├── app.html             # Applicazione principale
│   ├── css/
│   │   └── style.css        # Design system completo
│   └── js/
│       ├── api.js           # Client API (fetch wrapper)
│       ├── tree.js          # Componente albero gerarchico
│       ├── viewer.js        # Viewer JSON con syntax highlight
│       ├── compare.js       # View diff side-by-side
│       └── app.js           # Logica principale
└── README.md
```

## API Backend esposte

| Endpoint | Metodo | Descrizione |
|---|---|---|
| `/api/login` | POST | Ottiene token ACM via PowerShell/DLL |
| `/api/hierarchy` | GET | Gerarchia Company Chart |
| `/api/config/download` | GET | Scarica ZIP configurazione |
| `/api/config/preview` | GET | Contenuto ZIP come JSON (per viewer) |
| `/api/config/compare` | GET | Confronto tra due configurazioni |

## Configurazione `.env`

```env
PORT=3000
ACM_DLL_PATH=E:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll
DEFAULT_COMPONENT_PASSWORD=acm
DEFAULT_SERVICE_USERNAME=SSC.DEFAULT@SERVICE
```

## Funzionalità

- 🔐 **Login** con parametri ACM configurabili
- 🌳 **Albero gerarchico** collassabile con ricerca e filtro per livello
- 👥 **Utenti per nodo** con filtro componente
- 📄 **Viewer JSON** con syntax highlighting e navigazione tra file ZIP
- 📥 **Download** configurazioni come ZIP
- ↔ **Confronto** side-by-side tra due configurazioni con diff colorato
