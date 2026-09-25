<#
.SYNOPSIS
    Script di installazione e configurazione automatica per Company Chart Compare su IIS.

.DESCRIPTION
    Questo script esegue le seguenti operazioni:
    1. Verifica i privilegi di Amministratore.
    2. Abilita la funzionalità IIS (Web Server) se non installata.
    3. Verifica e scarica/installa Node.js LTS se mancante.
    4. Verifica e scarica/installa IIS URL Rewrite Module 2.1.
    5. Verifica e scarica/installa Application Request Routing (ARR) 3.0.
    6. Abilita la funzionalità Proxy di ARR in IIS.
    7. Scarica ed estrae NSSM (No-Sucking-Service-Manager).
    8. Installa le dipendenze npm del backend.
    9. Sblocca la DLL .NET (Sedapta.ACM.Client.dll) se presente.
    10. Configura ed avvia il servizio Windows per il backend Express tramite NSSM.
    11. Configura ed avvia il Sito Web in IIS con il Reverse Proxy verso Node.js.

.EXAMPLE
    .\setup-iis.ps1 -SiteName "CompanyChartCompare" -SitePort 8085 -NodePort 3000
#>

[CmdletBinding()]
param (
    [string]$SiteName = "CompanyChartCompare",
    [int]$SitePort = 8085,
    [int]$NodePort = 3000,
    [string]$ToolsDir = "C:\tools\nssm"
)

# Configura TLS 1.2 per i download HTTPS
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Determinazione cartella radice dello script
$scriptRootDir = $PSScriptRoot
if (-not $scriptRootDir) { $scriptRootDir = (Get-Location).Path }

# ─────────────────────────────────────────────────────────────────────────────
# 1. VERIFICA PRIVILEGI AMMINISTRATORE
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[1/10] Verifica privilegi di Amministratore..." -ForegroundColor Cyan
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "ERRORE: Questo script deve essere eseguito in PowerShell come AMMINISTRATORE!"
    exit 1
}
Write-Host " Privilegi di Amministratore confermati." -ForegroundColor Green


# ─────────────────────────────────────────────────────────────────────────────
# 2. VERIFICA ED INSTALLAZIONE IIS
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[2/10] Verifica installazione IIS (Web Server)..." -ForegroundColor Cyan
$iisInstalled = Test-Path "C:\Windows\System32\inetsrv\w3wp.exe"

if (-not $iisInstalled) {
    Write-Host " IIS non installato. Avvio installazione..." -ForegroundColor Yellow
    $osInfo = Get-CimInstance Win32_OperatingSystem
    if ($osInfo.ProductType -eq 1) {
        # Windows Client (Windows 10/11)
        Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, IIS-CommonHttpFeatures, IIS-HttpRedirect, IIS-NetFxExtensibility45, IIS-ASPNET45, IIS-ManagementConsole -NoRestart | Out-Null
    } else {
        # Windows Server
        Import-Module ServerManager
        Install-WindowsFeature -Name Web-Server, Web-WebServer, Web-Mgmt-Tools, Web-Filtering, Web-Net-Ext45, Web-Asp-Net45 -IncludeManagementTools | Out-Null
    }
    Write-Host " IIS installato con successo." -ForegroundColor Green
} else {
    Write-Host " IIS è già installato." -ForegroundColor Green
}


# ─────────────────────────────────────────────────────────────────────────────
# 3. VERIFICA ED INSTALLAZIONE NODE.JS
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[3/10] Verifica installazione Node.js..." -ForegroundColor Cyan
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExePath = "C:\Program Files\nodejs\node.exe"

if (-not $nodeCmd -and -not (Test-Path $nodeExePath)) {
    Write-Host " Node.js non trovato. Scaricamento ed installazione silenziosa Node.js v20.17.0 LTS..." -ForegroundColor Yellow
    $tempNodeMsi = Join-Path $env:TEMP "node-v20.17.0-x64.msi"
    $nodeUrl = "https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi"
    
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $tempNodeMsi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$tempNodeMsi`" /qn /norestart" -Wait
        Write-Host " Node.js installato correttamente." -ForegroundColor Green
    } catch {
        Write-Error " Impossibile scaricare o installare Node.js: $_"
        exit 1
    } finally {
        if (Test-Path -LiteralPath $tempNodeMsi) { Remove-Item -LiteralPath $tempNodeMsi -Force -ErrorAction SilentlyContinue }
    }
    
    # Aggiorna env PATH nella sessione corrente
    $env:Path += ";C:\Program Files\nodejs\"
} else {
    Write-Host " Node.js è già installato." -ForegroundColor Green
}


# ─────────────────────────────────────────────────────────────────────────────
# 4. VERIFICA ED INSTALLAZIONE IIS URL REWRITE MODULE 2.1
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[4/10] Verifica IIS URL Rewrite Module..." -ForegroundColor Cyan
$urlRewriteDll = "C:\Windows\System32\inetsrv\rewrite.dll"

if (-not (Test-Path $urlRewriteDll)) {
    Write-Host " URL Rewrite Module non trovato. Scaricamento ed installazione..." -ForegroundColor Yellow
    $tempRewriteMsi = Join-Path $env:TEMP "rewrite_amd64_en-US.msi"
    $rewriteUrl = "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi"
    
    try {
        Invoke-WebRequest -Uri $rewriteUrl -OutFile $tempRewriteMsi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$tempRewriteMsi`" /qn /norestart" -Wait
        Write-Host " URL Rewrite Module installato con successo." -ForegroundColor Green
    } catch {
        Write-Error " Impossibile scaricare o installare URL Rewrite Module: $_"
        exit 1
    } finally {
        if (Test-Path -LiteralPath $tempRewriteMsi) { Remove-Item -LiteralPath $tempRewriteMsi -Force -ErrorAction SilentlyContinue }
    }
} else {
    Write-Host " URL Rewrite Module è già installato." -ForegroundColor Green
}


# ─────────────────────────────────────────────────────────────────────────────
# 5. VERIFICA ED INSTALLAZIONE APPLICATION REQUEST ROUTING (ARR) 3.0
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[5/10] Verifica Application Request Routing (ARR) 3.0..." -ForegroundColor Cyan
$arrDll = "C:\Windows\System32\inetsrv\requestrouter.dll"

if (-not (Test-Path $arrDll)) {
    Write-Host " ARR 3.0 non trovato. Scaricamento ed installazione..." -ForegroundColor Yellow
    $tempArrMsi = Join-Path $env:TEMP "requestRouter_amd64.msi"
    $arrUrl = "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi"
    
    try {
        Invoke-WebRequest -Uri $arrUrl -OutFile $tempArrMsi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$tempArrMsi`" /qn /norestart" -Wait
        Write-Host " ARR 3.0 installato con successo." -ForegroundColor Green
    } catch {
        Write-Error " Impossibile scaricare o installare Application Request Routing (ARR) 3.0: $_"
        exit 1
    } finally {
        if (Test-Path -LiteralPath $tempArrMsi) { Remove-Item -LiteralPath $tempArrMsi -Force -ErrorAction SilentlyContinue }
    }
} else {
    Write-Host " Application Request Routing (ARR) 3.0 è già installato." -ForegroundColor Green
}


# ─────────────────────────────────────────────────────────────────────────────
# 6. ABILITAZIONE PROXY ARR IN IIS
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[6/10] Configurazione abilitazione Proxy ARR in IIS..." -ForegroundColor Cyan
Import-Module WebAdministration -ErrorAction SilentlyContinue

try {
    Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter 'system.webServer/proxy' -name 'enabled' -value 'true'
    Write-Host " ARR Proxy abilitato in IIS." -ForegroundColor Green
} catch {
    Write-Warning " Attenzione: impossibile impostare il proxy ARR automaticamente tramite WebAdministration. Verificare in IIS Manager -> Server Proxy Settings -> Enable Proxy."
}


# ─────────────────────────────────────────────────────────────────────────────
# 7. SCARICAMENTO E SETUP NSSM (SERVICE MANAGER)
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[7/10] Verifica disponibilità NSSM (Windows Service Manager)..." -ForegroundColor Cyan
$nssmExe = Join-Path $ToolsDir "nssm.exe"

if (-not (Test-Path $nssmExe)) {
    Write-Host " NSSM non trovato. Scaricamento in corso in $ToolsDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    
    $tempNssmZip = Join-Path $env:TEMP "nssm-2.24.zip"
    $extractPath = Join-Path $env:TEMP "nssm-extract"
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    
    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $tempNssmZip -UseBasicParsing
        Expand-Archive -Path $tempNssmZip -DestinationPath $extractPath -Force
        Copy-Item (Join-Path $extractPath "nssm-2.24\win64\nssm.exe") -Destination $nssmExe -Force
        Write-Host " NSSM scaricato ed estratto in $nssmExe." -ForegroundColor Green
    } catch {
        Write-Error " Errore durante il download o l'estrazione di NSSM: $_"
        exit 1
    } finally {
        if (Test-Path -LiteralPath $tempNssmZip) { Remove-Item -LiteralPath $tempNssmZip -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $extractPath) { Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue }
    }
} else {
    Write-Host " NSSM è già disponibile in $nssmExe." -ForegroundColor Green
}


# ─────────────────────────────────────────────────────────────────────────────
# 8. PERMESSI DLL & DIPENDENZE BACKEND NPM
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[8/10] Configurazione backend Node.js e dipendenze..." -ForegroundColor Cyan
$backendDir = Join-Path $scriptRootDir "backend"

if (Test-Path $backendDir) {
    Push-Location $backendDir
    
    # Check .env
    $envFile = Join-Path $backendDir ".env"
    if (-not (Test-Path $envFile)) {
        Write-Host " Creazione file .env di default..." -ForegroundColor Yellow
        @"
PORT=$NodePort
ACM_DLL_PATH=C:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll
DEFAULT_COMPONENT_PASSWORD=acm
DEFAULT_SERVICE_USERNAME=SSC.DEFAULT@SERVICE
"@ | Set-Content -Path $envFile -Encoding utf8
    }

    # Sblocco eventuale DLL .NET
    $dllPath = "C:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll"
    if (Test-Path $envFile) {
        $envContent = Get-Content $envFile
        $dllLine = $envContent | Where-Object { $_ -like "ACM_DLL_PATH=*" }
        if ($dllLine) {
            $dllPath = ($dllLine -split "=", 2)[1].Trim()
        }
    }

    if (Test-Path $dllPath) {
        Write-Host " Sblocco della DLL .NET: $dllPath" -ForegroundColor Yellow
        Unblock-File -Path $dllPath -ErrorAction SilentlyContinue
    } else {
        Write-Warning " Nota: La DLL ACM '$dllPath' non è presente al percorso specificato. Verificare prima del login."
    }

    # npm install
    Write-Host " Installazione dipendenze npm backend in corso..." -ForegroundColor Yellow
    Start-Process npm.cmd -ArgumentList "install --omit=dev" -WorkingDirectory $backendDir -Wait -NoNewWindow
    Pop-Location
    Write-Host " Dipendenze npm installate." -ForegroundColor Green
} else {
    Write-Error " Cartella 'backend' non trovata in $scriptRootDir!"
    exit 1
}


# ─────────────────────────────────────────────────────────────────────────────
# 9. CONFIGURAZIONE SERVIZIO WINDOWS (CompanyChartBackend)
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[9/10] Configurazione ed avvio del servizio Windows CompanyChartBackend..." -ForegroundColor Cyan
$serviceName = "CompanyChartBackend"
$serverJs = Join-Path $backendDir "server.js"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = $nodeExePath }

# Verifica se il servizio esiste già
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host " Arresto del servizio esistente $serviceName..." -ForegroundColor Yellow
    & $nssmExe stop $serviceName 2>$null | Out-Null
    Start-Sleep -Seconds 1
} else {
    # Crea il servizio solo se non esiste
    & $nssmExe install $serviceName "$nodePath" "$serverJs" 2>$null | Out-Null
}

# Imposta i parametri in ogni caso
& $nssmExe set $serviceName Application "$nodePath" 2>$null | Out-Null
& $nssmExe set $serviceName AppParameters "$serverJs" 2>$null | Out-Null
& $nssmExe set $serviceName AppDirectory "$backendDir" 2>$null | Out-Null
& $nssmExe set $serviceName Start SERVICE_AUTO_START 2>$null | Out-Null

# Avvia servizio
& $nssmExe start $serviceName 2>$null | Out-Null
Write-Host " Servizio Windows '$serviceName' avviato correttamente su porta $NodePort." -ForegroundColor Green


# ─────────────────────────────────────────────────────────────────────────────
# 10. CONFIGURAZIONE E AVVIO SITO IIS
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`n[10/10] Configurazione Sito Web IIS ($SiteName)..." -ForegroundColor Cyan
Import-Module WebAdministration -ErrorAction SilentlyContinue

$webConfigPath = Join-Path $scriptRootDir "web.config"
if (-not (Test-Path $webConfigPath)) {
    Write-Host " Creazione file web.config in $scriptRootDir..." -ForegroundColor Yellow
    @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxyToNodeJS" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:$NodePort/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <httpErrors errorMode="Detailed" />
  </system.webServer>
</configuration>
"@ | Set-Content -Path $webConfigPath -Encoding utf8
}

# Verifica se la porta scelta è già in ascolto da un altro processo non IIS (es. WildFly/Java)
$listeningConn = Get-NetTCPConnection -LocalPort $SitePort -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
if ($listeningConn) {
    $targetProcId = $listeningConn[0].OwningProcess
    $targetProcName = (Get-Process -Id $targetProcId -ErrorAction SilentlyContinue).ProcessName
    if ($targetProcName -ne "System" -and $targetProcName -ne "w3wp") {
        $origPort = $SitePort
        while (Get-NetTCPConnection -LocalPort $SitePort -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }) {
            $SitePort++
        }
        Write-Host " Attenzione: La porta $origPort è occupata dal processo '$targetProcName' (PID $targetProcId)." -ForegroundColor Yellow
        Write-Host " La porta del sito IIS è stata automaticamente impostata sulla porta disponibile $SitePort." -ForegroundColor Yellow
    }
}

# Verifica se il sito esiste già in IIS
$existingSite = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
if (-not $existingSite) {
    Write-Host " Creazione nuovo Sito IIS '$SiteName' sulla porta $SitePort..." -ForegroundColor Yellow
    try {
        New-Website -Name $SiteName -Port $SitePort -PhysicalPath $scriptRootDir -Force | Out-Null
    } catch {
        Write-Warning " Impossibile creare il sito IIS sulla porta ${SitePort}: $($_.Exception.Message)."
    }
} else {
    Write-Host " Il Sito IIS '$SiteName' esiste già. Aggiornamento PhysicalPath e Binding sulla porta $SitePort..." -ForegroundColor Yellow
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $scriptRootDir
    
    # Rimuove i vecchi binding e ne assegna uno nuovo pulito
    Get-WebBinding -Name $SiteName | Remove-WebBinding -ErrorAction SilentlyContinue
    New-WebBinding -Name $SiteName -Port $SitePort -Protocol "http" -ErrorAction SilentlyContinue
}

# Assicura che l'AppPool e il Sito siano AVVIATI
try {
    $siteObj = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
    if ($siteObj) {
        $appPoolName = $siteObj.applicationPool
        if ($appPoolName) { Start-WebAppPool -Name $appPoolName -ErrorAction SilentlyContinue }
        Start-Website -Name $SiteName -ErrorAction SilentlyContinue
    }
} catch {
    Write-Warning " Impossibile avviare il sito IIS '$SiteName': $($_.Exception.Message)."
}

# Riavvia IIS per applicare tutte le regole
try {
    iisreset /noforce | Out-Null
} catch {
    Write-Warning " Impossibile riavviare IIS automaticamente (iisreset). Riavviare manualmente da IIS Manager."
}

Write-Host "`n==========================================================================" -ForegroundColor Green
Write-Host " INSTALLAZIONE E CONFIGURAZIONE COMPLETATA CON SUCCESSO!" -ForegroundColor Green
Write-Host " App Backend attiva come Servizio Windows: $serviceName (Porta $NodePort)" -ForegroundColor Green
Write-Host " Applicazione raggiungibile tramite IIS all'indirizzo:" -ForegroundColor Green
Write-Host "   http://localhost:$SitePort" -ForegroundColor Yellow
Write-Host "==========================================================================`n" -ForegroundColor Green
