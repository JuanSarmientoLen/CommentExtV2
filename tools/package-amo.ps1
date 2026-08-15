$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$zipPath = Join-Path $root "onemaster-commentext-4.4.zip"

if (Test-Path $dist) {
  Remove-Item $dist -Recurse -Force
}
New-Item -ItemType Directory -Path $dist | Out-Null

Copy-Item (Join-Path $root "manifest.json") $dist -Force

$backgroundDist = Join-Path $dist "background"
New-Item -ItemType Directory -Path $backgroundDist | Out-Null
foreach ($file in @("background.js", "cursor-api.js", "history.js", "prompt.js", "settings.js")) {
  Copy-Item (Join-Path $root "background\$file") $backgroundDist -Force
}
Copy-Item (Join-Path $root "background\config.example.js") (Join-Path $backgroundDist "config.js") -Force

Copy-Item (Join-Path $root "content") (Join-Path $dist "content") -Recurse -Force
Copy-Item (Join-Path $root "popup") (Join-Path $dist "popup") -Recurse -Force

$iconsDist = Join-Path $dist "icons"
New-Item -ItemType Directory -Path $iconsDist | Out-Null
foreach ($file in @("icon-16.png", "icon-32.png", "icon-48.png", "icon-96.png", "icon-128.png", "icon.svg")) {
  Copy-Item (Join-Path $root "icons\$file") $iconsDist -Force
}

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

$distFull = (Resolve-Path $dist).Path
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

try {
  Get-ChildItem $dist -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($distFull.Length + 1).Replace("\", "/")
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relative)
  }
} finally {
  $zip.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $hasManifest = $false
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -match "\\") {
      throw "Invalid zip entry uses backslashes: $($entry.FullName)"
    }
    if ($entry.FullName -eq "manifest.json") {
      $hasManifest = $true
    }
  }

  if (-not $hasManifest) {
    throw "manifest.json is missing from the archive root."
  }
} finally {
  $archive.Dispose()
}

Write-Host "AMO package created: $zipPath"
Write-Host "Validated: forward-slash paths, manifest.json at root."
Write-Host "Upload this zip at https://addons.mozilla.org/developers/addon/submit/"
