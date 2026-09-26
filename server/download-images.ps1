$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'assets\products'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$products = Get-Content (Join-Path $PSScriptRoot 'sheet-products.json') -Raw | ConvertFrom-Json
$done = 0
foreach ($p in $products) {
  $m = [regex]::Match($p.imageUrl, '/d/([^/]+)')
  if (!$m.Success) { continue }
  $ext = [IO.Path]::GetExtension($p.imageName)
  if ([string]::IsNullOrWhiteSpace($ext)) { $ext = '.jpg' }
  $target = Join-Path $out ($p.sku + $ext.ToLower())
  if (Test-Path $target) { $done++; continue }
  try {
    Invoke-WebRequest -Uri ("https://drive.google.com/uc?export=download&id=" + $m.Groups[1].Value) -OutFile $target -TimeoutSec 90
    if ((Get-Item $target).Length -gt 1000) { $done++ } else { Remove-Item -LiteralPath $target -Force }
  } catch { Write-Host ("Failed: " + $p.sku) }
}
Write-Host ("Downloaded/available: " + $done + " / " + $products.Count)
