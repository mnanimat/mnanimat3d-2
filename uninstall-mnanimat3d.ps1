$ErrorActionPreference = 'SilentlyContinue'
$target = Join-Path $env:LOCALAPPDATA 'Programs\MNAnimat3D-v1.0.0'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MNAnimat3D v1.0.0.lnk'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'MNAnimat3D v1.0.0'
$profile = Join-Path $env:LOCALAPPDATA 'MNAnimat3D\v1.0.0'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -like '*MNAnimat3D-v1.0.0*'
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Remove-Item -LiteralPath $desktop -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $startMenu -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MNAnimat3D-v1.0.0' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
