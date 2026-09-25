param(
    [string]$AppServer    = "ssc-saintlaurent-dev.sedapta.com",
    [string]$ComponentId  = "brk",
    [string]$ComponentPassword = "acm",
    [string]$ServiceUsername   = "SSC.DEFAULT@SERVICE",
    [string]$AcmDllPath   = ""
)

$ErrorActionPreference = "Stop"

# Abilita TLS 1.2 / TLS 1.1 e ignora eventuali errori di certificato SSL non fidato dell'AppServer
[System.Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}

# Se il percorso fornito non esiste su disco, tenta fallback automatici (es. disco E: o C:)
if (-not $AcmDllPath -or -not (Test-Path $AcmDllPath)) {
    if (Test-Path "E:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll") {
        $AcmDllPath = "E:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll"
    } elseif (Test-Path "C:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll") {
        $AcmDllPath = "C:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll"
    }
}

try {
    if (-not (Test-Path $AcmDllPath)) {
        Write-Error "Impossibile trovare la DLL ACM al percorso: '$AcmDllPath'"
        exit 1
    }

    Add-Type -Path $AcmDllPath

    $client                    = New-Object Sedapta.ACM.AcmClient
    $client.Address            = "https://$AppServer/ACMWS/AcmServiceApp.svc"
    $client.ComponentPassword  = $ComponentPassword
    $client.ComponentUsername  = $ComponentId

    $token = $client.CreateAccessTokenServiceAccount($ServiceUsername, $null)

    if (-not $token) {
        Write-Error "Token is empty"
        exit 1
    }

    Write-Output $token
    exit 0
}
catch {
    Write-Error "ACM token generation failed: $_"
    exit 1
}
