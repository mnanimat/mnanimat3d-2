param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$characterDirectory = Join-Path $ProjectRoot 'assets\characters\blocky'
$environmentDirectory = Join-Path $ProjectRoot 'assets\environment\furniture-kit'
$characterZipPath = Join-Path $characterDirectory 'kenney_blocky-characters_20.zip'
$environmentZipPath = Join-Path $environmentDirectory 'kenney_furniture-kit.zip'
$characterOutputPath = Join-Path $characterDirectory 'blocky-character.glb'
$environmentModelsPath = Join-Path $environmentDirectory 'models'

foreach ($path in @($characterZipPath, $environmentZipPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Pacote não encontrado: $path"
    }
}

New-Item -ItemType Directory -Force -Path $characterDirectory, $environmentDirectory, $environmentModelsPath | Out-Null

function Copy-ZipEntry {
    param(
        [System.IO.Compression.ZipArchiveEntry]$Entry,
        [string]$Destination
    )
    $destinationDirectory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    $sourceStream = $Entry.Open()
    try {
        $destinationStream = [System.IO.File]::Create($Destination)
        try { $sourceStream.CopyTo($destinationStream) }
        finally { $destinationStream.Dispose() }
    }
    finally { $sourceStream.Dispose() }
}

$characterZip = [System.IO.Compression.ZipFile]::OpenRead($characterZipPath)
try {
    $characterEntry = $characterZip.GetEntry('Models/GLB format/character-a.glb')
    if (-not $characterEntry) { throw 'A personagem character-a.glb não existe no pacote Blocky Characters.' }
    Copy-ZipEntry -Entry $characterEntry -Destination $characterOutputPath
    Copy-ZipEntry -Entry $characterZip.GetEntry('Models/GLB format/Textures/texture-a.png') -Destination (Join-Path $characterDirectory 'Textures\texture-a.png')
    Copy-ZipEntry -Entry $characterZip.GetEntry('Models/FBX format/character-a.fbx') -Destination (Join-Path $characterDirectory 'original\character-a.fbx')
    Copy-ZipEntry -Entry $characterZip.GetEntry('Models/FBX format/Textures/texture-a.png') -Destination (Join-Path $characterDirectory 'original\Textures\texture-a.png')
    Copy-ZipEntry -Entry $characterZip.GetEntry('License.txt') -Destination (Join-Path $characterDirectory 'KENNEY_LICENSE.txt')
}
finally { $characterZip.Dispose() }

$environmentZip = [System.IO.Compression.ZipFile]::OpenRead($environmentZipPath)
$catalog = @()
try {
    Copy-ZipEntry -Entry $environmentZip.GetEntry('License.txt') -Destination (Join-Path $environmentDirectory 'KENNEY_LICENSE.txt')
    $entries = $environmentZip.Entries |
        Where-Object { $_.FullName -like 'Models/GLTF format/*.glb' } |
        Sort-Object FullName

    foreach ($entry in $entries) {
        $fileName = [System.IO.Path]::GetFileName($entry.FullName)
        $id = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
        Copy-ZipEntry -Entry $entry -Destination (Join-Path $environmentModelsPath $fileName)

        $category = switch -Regex ($id) {
            '^bath|^shower|^toilet' { 'Banheiro'; break }
            '^bed|^pillow|^cabinetBed' { 'Quarto'; break }
            '^chair|^bench|^stool' { 'Assentos'; break }
            '^bookcase|^cabinet|^coatRack|^cardboard' { 'Armazenamento'; break }
            '^computer|^desk|^laptop' { 'Escritorio'; break }
            '^door|^floor|^wall|^stairs|^paneling' { 'Construcao'; break }
            '^kitchen|^hood|^toaster' { 'Cozinha'; break }
            '^lamp' { 'Iluminacao'; break }
            '^lounge' { 'Sala'; break }
            '^plant|^potted' { 'Plantas'; break }
            '^television|^radio|^speaker' { 'Eletronicos'; break }
            '^washer|^dryer' { 'Lavanderia'; break }
            '^table|^sideTable' { 'Mesas'; break }
            default { 'Decoracao' }
        }
        $label = [regex]::Replace($id, '([a-z0-9])([A-Z])', '$1 $2')
        $label = (Get-Culture).TextInfo.ToTitleCase($label.ToLowerInvariant())
        $catalog += [ordered]@{
            id = $id
            name = $label
            category = $category
            file = "./assets/environment/furniture-kit/models/$fileName"
        }
    }
}
finally { $environmentZip.Dispose() }

$manifest = [ordered]@{
    name = 'Furniture Kit'
    author = 'Kenney'
    license = 'CC0 1.0 Universal'
    source = 'https://kenney.nl/assets/furniture-kit'
    count = $catalog.Count
    objects = $catalog
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $environmentDirectory 'catalog.json') -Encoding utf8

Write-Host "Personagem preparada: $characterOutputPath"
Write-Host "Catálogo de cenário preparado: $($catalog.Count) objetos"
