$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$srcPath = Join-Path $root 'work\sprite-rendered.png'
$outDir = Join-Path $root 'outputs\assets\cards'
$bmp = [System.Drawing.Bitmap]::FromFile($srcPath)

$ranks = @('A','2','3','4','5','6','7','8','9','10','J','Q')
$suits = @('spade','heart','diamond','club')

# Measured from the rendered sheet. The original spacing has a small cumulative drift.
$xs = @(68, 344, 620, 920)
$ys = @(82, 488, 898, 1309, 1721, 2134, 2548, 2966, 3388, 3812, 4231, 4654)
$kxs = @(62, 344, 626, 908)
$ky = 5201
$extras = @(
  @{ name = 'joker_red'; x = 62; y = 5626 },
  @{ name = 'joker_black'; x = 344; y = 5626 },
  @{ name = 'back'; x = 626; y = 5626 }
)

function Crop-Card($name, $x, $y) {
  $rect = New-Object System.Drawing.Rectangle $x, $y, 250, 360
  $piece = $bmp.Clone($rect, $bmp.PixelFormat)
  $piece.Save((Join-Path $outDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $piece.Dispose()
}

for ($r = 0; $r -lt $ranks.Count; $r++) {
  for ($c = 0; $c -lt $suits.Count; $c++) {
    Crop-Card "$($ranks[$r])_$($suits[$c])" $xs[$c] $ys[$r]
  }
}

for ($c = 0; $c -lt $suits.Count; $c++) {
  Crop-Card "K_$($suits[$c])" $kxs[$c] $ky
}

foreach ($extra in $extras) {
  Crop-Card $extra.name $extra.x $extra.y
}

$bmp.Dispose()
Write-Output 'Recropped card images.'
