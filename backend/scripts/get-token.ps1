param(
    [string]$AppServer    = "ssc-test.kering.com",
    [string]$ComponentId  = "brk",
    [string]$ComponentPassword = "acm",
    [string]$ServiceUsername   = "SSC.DEFAULT@SERVICE",
    [string]$AcmDllPath   = "E:\sedApta\Shared\ACM\Client\Sedapta.ACM.Client.dll"
)

$ErrorActionPreference = "Stop"

try {
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
