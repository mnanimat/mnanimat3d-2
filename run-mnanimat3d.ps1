param([int]$Port = 4530)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$appVersion = '1.0.0'
$maxUploadBytes = 536870912
$server = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$mime = @{
  '.html'='text/html; charset=utf-8'
  '.js'='text/javascript; charset=utf-8'
  '.css'='text/css; charset=utf-8'
  '.json'='application/json; charset=utf-8'
  '.webmanifest'='application/manifest+json'
  '.svg'='image/svg+xml'
  '.png'='image/png'
  '.jpg'='image/jpeg'
  '.jpeg'='image/jpeg'
  '.webp'='image/webp'
  '.glb'='model/gltf-binary'
  '.gltf'='model/gltf+json'
  '.bin'='application/octet-stream'
  '.fbx'='application/octet-stream'
  '.blend'='application/octet-stream'
  '.wasm'='application/wasm'
}

function Find-BlenderExecutable {
  $command = Get-Command blender.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return $command.Source }

  $roots = @()
  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles 'Blender Foundation') }
  if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} 'Blender Foundation') }
  if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Programs\Blender Foundation') }

  foreach ($folder in $roots) {
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
    $candidate = Get-ChildItem -LiteralPath $folder -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'blender.exe' } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
      Select-Object -First 1
    if ($candidate) { return $candidate }
  }
  return $null
}

function Quote-NativeArgument([string]$Value) {
  if ($null -eq $Value) { return '""' }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"') + '"'
}

function Read-HttpRequest([IO.Stream]$Stream) {
  $headerBytes = New-Object 'System.Collections.Generic.List[byte]'
  $headerComplete = $false
  while (-not $headerComplete) {
    $value = $Stream.ReadByte()
    if ($value -lt 0) { throw 'A conexão terminou antes do cabeçalho HTTP.' }
    $headerBytes.Add([byte]$value)
    if ($headerBytes.Count -gt 65536) { throw 'Cabeçalho HTTP maior que o limite permitido.' }
    if ($headerBytes.Count -ge 4) {
      $c = $headerBytes.Count
      $headerComplete =
        $headerBytes[$c-4] -eq 13 -and
        $headerBytes[$c-3] -eq 10 -and
        $headerBytes[$c-2] -eq 13 -and
        $headerBytes[$c-1] -eq 10
    }
  }

  $raw = $headerBytes.ToArray()
  $headerText = [Text.Encoding]::ASCII.GetString($raw, 0, $raw.Length - 4)
  $lines = $headerText -split "`r`n"
  if (-not $lines.Length) { throw 'Requisição HTTP vazia.' }
  $requestParts = $lines[0] -split ' '
  if ($requestParts.Length -lt 2) { throw 'Linha HTTP inválida.' }

  $headers = New-Object 'System.Collections.Generic.Dictionary[string,string]' -ArgumentList ([StringComparer]::OrdinalIgnoreCase)
  for ($index = 1; $index -lt $lines.Length; $index += 1) {
    $separator = $lines[$index].IndexOf(':')
    if ($separator -le 0) { continue }
    $name = $lines[$index].Substring(0, $separator).Trim()
    $value = $lines[$index].Substring($separator + 1).Trim()
    $headers[$name] = $value
  }

  return [PSCustomObject]@{
    Method = $requestParts[0].ToUpperInvariant()
    Target = $requestParts[1]
    Headers = $headers
  }
}

function Read-RequestBodyToFile([IO.Stream]$Stream, [int64]$Length, [string]$Destination) {
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $output = [IO.File]::Create($Destination)
  try {
    $remaining = $Length
    $buffer = New-Object byte[] 65536
    while ($remaining -gt 0) {
      $requested = [Math]::Min([int64]$buffer.Length, $remaining)
      $read = $Stream.Read($buffer, 0, [int]$requested)
      if ($read -le 0) { throw 'O upload terminou antes de receber todo o arquivo.' }
      $output.Write($buffer, 0, $read)
      $remaining -= $read
    }
  } finally {
    $output.Dispose()
  }
}

function Write-HttpBytes(
  [IO.Stream]$Stream,
  [string]$Status,
  [string]$ContentType,
  [byte[]]$Body,
  [string]$ExtraHeaders = ''
) {
  if ($null -eq $Body) { $Body = New-Object byte[] 0 }
  $header = "HTTP/1.1 $Status`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store, no-cache, must-revalidate`r`nPragma: no-cache`r`nConnection: close`r`n$ExtraHeaders`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

function Json-Bytes([hashtable]$Value) {
  return [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Compress -Depth 8))
}

function Invoke-BlendToGlb([string]$BlendFile, [string]$OutputFile, [string]$LogDirectory) {
  $blenderExe = Find-BlenderExecutable
  if (-not $blenderExe -or -not (Test-Path -LiteralPath $blenderExe -PathType Leaf)) {
    throw 'O Blender não foi localizado. Instale o Blender ou selecione GLB/FBX em vez de .blend.'
  }
  $converter = Join-Path $root 'tools\blender\import_blend_to_glb.py'
  if (-not (Test-Path -LiteralPath $converter -PathType Leaf)) {
    throw 'O conversor de arquivos .blend não está instalado no MNAnimat3D v1.0.0.'
  }

  $stdout = Join-Path $LogDirectory 'blender-stdout.log'
  $stderr = Join-Path $LogDirectory 'blender-stderr.log'
  $arguments = @(
    '--disable-autoexec',
    '--background', $BlendFile,
    '--python-exit-code', '73',
    '--python', $converter,
    '--',
    '--output', $OutputFile
  )
  $argumentText = ($arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
  $process = Start-Process -FilePath $blenderExe -ArgumentList $argumentText -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr

  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $OutputFile -PathType Leaf)) {
    $outText = if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue } else { '' }
    $errText = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue } else { '' }
    $details = ($outText + "`n" + $errText).Trim()
    if ($details.Length -gt 4000) { $details = $details.Substring($details.Length - 4000) }
    throw "O Blender não conseguiu converter o arquivo .blend (código $($process.ExitCode)).`n$details"
  }
  if ((Get-Item -LiteralPath $OutputFile).Length -lt 1024) {
    throw 'O arquivo GLB criado pelo Blender ficou vazio.'
  }
}

$blenderExeAtStart = Find-BlenderExecutable
$rigFiles = @{
  blocky = Join-Path $root 'assets\characters\blocky\original\blocky-character.blend'
}

$server.Start()
Write-Host "MNAnimat3D v$appVersion disponível em http://127.0.0.1:$Port/"
Write-Host 'Pressione Ctrl+C para encerrar.'

try {
  while ($true) {
    $client = $server.AcceptTcpClient()
    try {
      $client.SendTimeout = 120000
      $client.ReceiveTimeout = 120000
      $stream = $client.GetStream()
      $request = Read-HttpRequest $stream
      $method = $request.Method
      $requestTarget = $request.Target

      if ($method -eq 'POST' -and $requestTarget -match '^/api/import-blend(?:\?name=(.*))?$') {
        $encodedName = $Matches[1]
        $originalName = if ($encodedName) { [Uri]::UnescapeDataString($encodedName) } else { 'modelo.blend' }
        $safeName = [IO.Path]::GetFileName($originalName)
        if (-not $safeName.ToLowerInvariant().EndsWith('.blend')) {
          throw 'O endpoint de conversão aceita somente arquivos .blend.'
        }
        if (-not $request.Headers.ContainsKey('Content-Length')) {
          throw 'O navegador não informou o tamanho do arquivo .blend.'
        }
        [int64]$contentLength = 0
        if (-not [int64]::TryParse($request.Headers['Content-Length'], [ref]$contentLength)) {
          throw 'O tamanho informado para o arquivo .blend é inválido.'
        }
        if ($contentLength -le 0 -or $contentLength -gt $maxUploadBytes) {
          throw 'O arquivo .blend está vazio ou ultrapassa o limite de 512 MB.'
        }

        $jobRoot = Join-Path $env:TEMP ('MNAnimat3D-v41-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $jobRoot | Out-Null
        try {
          $inputFile = Join-Path $jobRoot 'entrada.blend'
          $outputFile = Join-Path $jobRoot 'saida.glb'
          Read-RequestBodyToFile $stream $contentLength $inputFile
          Invoke-BlendToGlb $inputFile $outputFile $jobRoot
          $body = [IO.File]::ReadAllBytes($outputFile)
          Write-HttpBytes $stream '200 OK' 'model/gltf-binary' $body "X-MNAnimat3D-Converted-From: blend`r`n"
        } finally {
          Remove-Item -LiteralPath $jobRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
      } elseif ($requestTarget -match '^/api/open-rig\?name=(blocky)$') {
        $rigName = $Matches[1]
        try {
          $blenderExe = Find-BlenderExecutable
          if (-not $blenderExe -or -not (Test-Path -LiteralPath $blenderExe -PathType Leaf)) { throw 'Blender não foi encontrado neste Windows.' }
          $blendFile = $rigFiles[$rigName]
          if (-not (Test-Path -LiteralPath $blendFile -PathType Leaf)) { throw 'O arquivo Blender da personagem não foi encontrado.' }
          Start-Process -FilePath $blenderExe -ArgumentList (Quote-NativeArgument $blendFile)
          $description = 'com os nós articulados e animações originais'
          Write-HttpBytes $stream '200 OK' 'application/json; charset=utf-8' (Json-Bytes @{ message = "Personagem aberta no Blender $description." })
        } catch {
          Write-HttpBytes $stream '500 Internal Server Error' 'application/json; charset=utf-8' (Json-Bytes @{ message = $_.Exception.Message })
        }
      } elseif ($requestTarget -eq '/api/app-info') {
        Write-HttpBytes $stream '200 OK' 'application/json; charset=utf-8' (Json-Bytes @{
          name = 'MNAnimat3D'
          version = $appVersion
          port = $Port
          blendImport = [bool](Find-BlenderExecutable)
        })
      } elseif ($requestTarget -eq '/api/rig-status') {
        Write-HttpBytes $stream '200 OK' 'application/json; charset=utf-8' (Json-Bytes @{
          blender = [bool](Find-BlenderExecutable)
          blendImport = [bool](Test-Path -LiteralPath (Join-Path $root 'tools\blender\import_blend_to_glb.py') -PathType Leaf)
          blocky = [bool](Test-Path -LiteralPath $rigFiles.blocky -PathType Leaf)
          version = $appVersion
        })
      } else {
        $urlPath = ($requestTarget -split '\?')[0]
        $relative = [Uri]::UnescapeDataString($urlPath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
        $candidate = [IO.Path]::GetFullPath((Join-Path $root $relative))

        if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
          Write-HttpBytes $stream '404 Not Found' 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('Arquivo não encontrado'))
        } else {
          $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
          $contentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
          $body = [IO.File]::ReadAllBytes($candidate)
          if ($method -eq 'HEAD') { $body = New-Object byte[] 0 }
          Write-HttpBytes $stream '200 OK' $contentType $body
        }
      }
    } catch {
      try {
        $message = $_.Exception.Message
        Write-HttpBytes $stream '500 Internal Server Error' 'application/json; charset=utf-8' (Json-Bytes @{ message = $message; version = $appVersion })
      } catch { }
    } finally {
      $client.Close()
    }
  }
} finally {
  $server.Stop()
}
