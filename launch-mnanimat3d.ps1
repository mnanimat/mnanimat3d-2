$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$serverScript = Join-Path $appRoot 'run-mnanimat3d.ps1'
$requiredVersion = '1.0.0'
$profileRoot = Join-Path $env:LOCALAPPDATA 'MNAnimat3D\v1.0.0\BrowserProfile'
New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null

function Open-MNAnimat3DWindow([string]$Url) {
    $versionedUrl = $Url.TrimEnd('/') + '/?mn-version=1.0.0&cache=100'

    $edgeCandidates = @()
    if (${env:ProgramFiles(x86)}) {
        $edgeCandidates += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    }
    if ($env:ProgramFiles) {
        $edgeCandidates += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    }

    $edge = $edgeCandidates |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
        Select-Object -First 1

    if ($edge) {
        Start-Process -FilePath $edge -ArgumentList @(
            "--app=$versionedUrl",
            '--start-maximized',
            "--user-data-dir=$profileRoot",
            '--no-first-run',
            '--disable-application-cache'
        )
        return
    }

    Start-Process $versionedUrl
}

foreach ($candidate in 4530..4545) {
    try {
        $info = Invoke-RestMethod -Uri "http://127.0.0.1:$candidate/api/app-info" -TimeoutSec 1
        if ($info.name -eq 'MNAnimat3D' -and $info.version -eq $requiredVersion) {
            Open-MNAnimat3DWindow "http://127.0.0.1:$candidate/"
            exit 0
        }
    }
    catch { }
}

$port = $null
foreach ($candidate in 4530..4545) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
    try {
        $probe.Start()
        $port = $candidate
        break
    }
    catch { }
    finally {
        $probe.Stop()
    }
}

if (-not $port) {
    throw 'Nenhuma porta local disponível para iniciar o MNAnimat3D v1.0.0.'
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serverScript`" -Port $port"
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $appRoot -WindowStyle Hidden

$url = "http://127.0.0.1:$port/"
for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    try {
        $info = Invoke-RestMethod -Uri "${url}api/app-info" -TimeoutSec 1
        if ($info.name -eq 'MNAnimat3D' -and $info.version -eq $requiredVersion) {
            Open-MNAnimat3DWindow $url
            exit 0
        }
    }
    catch { }

    Start-Sleep -Milliseconds 200
}

throw 'O servidor local do MNAnimat3D v1.0.0 não respondeu a tempo.'
