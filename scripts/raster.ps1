# PowerPoint COM rasterizer — the fidelity oracle + the importer's raster fallback.
#
#   Mode "slides": export every slide of a .pptx to <Out>/slide-NN.png at W x H.
#   Mode "shapes": export specific shapes/groups named in a manifest JSON to PNGs.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/raster.ps1 `
#       -In deck.pptx -Out out/ref -Mode slides -W 1440 -H 810
#   powershell ... -Mode shapes -Manifest items.json   (manifest drives -In/-Out)
#
# The manifest for "shapes" is: { "in": "...pptx", "out": "...dir",
#   "items": [ { "slide": 1, "name": "Diagram 3", "id": "7", "file": "s5.png", "w": 1154, "h": 900 } ] }
param(
  [string]$In,
  [string]$Out,
  [ValidateSet('slides', 'shapes')][string]$Mode = 'slides',
  [int]$W = 1440,
  [int]$H = 810,
  [string]$Manifest
)

$ErrorActionPreference = 'Stop'
$ppShapeFormatPNG = 2

function New-Dir($p) { if ($p -and -not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null } }

$items = $null
if ($Mode -eq 'shapes') {
  if (-not $Manifest) { Write-Error 'shapes mode needs -Manifest'; exit 2 }
  $m = Get-Content -Raw -Path $Manifest | ConvertFrom-Json
  $In = $m.in; $Out = $m.out; $items = $m.items
}
New-Dir $Out

$ppt = New-Object -ComObject PowerPoint.Application
$result = @{ ok = $true; exported = @(); errors = @() }
try {
  $pres = $ppt.Presentations.Open($In, $true, $false, $false)  # ReadOnly, !Untitled, !WithWindow
  if ($Mode -eq 'slides') {
    $i = 1
    foreach ($slide in $pres.Slides) {
      $p = Join-Path $Out ("slide-{0:D2}.png" -f $i)
      $slide.Export($p, 'PNG', $W, $H)
      $result.exported += @{ slide = $i; file = $p }
      $i++
    }
  }
  else {
    # Shape.Export mangles text inside groups. Instead, export the FULL slide (which
    # PowerPoint renders perfectly) once per slide; the importer crops each shape's
    # reported bounding box out of it. -W/-H are the full-slide pixel size (canvas*scale).
    $bySlide = $items | Group-Object -Property slide
    foreach ($grp in $bySlide) {
      try {
        $sIdx = [int]$grp.Name
        $slide = $pres.Slides.Item($sIdx)
        $fullName = "_full-{0:D2}.png" -f $sIdx
        $slide.Export((Join-Path $Out $fullName), 'PNG', $W, $H)
        foreach ($it in $grp.Group) {
          $target = $null
          foreach ($sh in $slide.Shapes) {
            if (($it.name -and $sh.Name -eq $it.name) -or ($it.id -and "$($sh.Id)" -eq "$($it.id)")) { $target = $sh; break }
          }
          if ($null -eq $target) { $result.errors += "no shape '$($it.name)'/$($it.id) on slide $sIdx"; continue }
          $result.exported += @{ file = $it.file; slide = $sIdx; full = $fullName; left = [double]$target.Left; top = [double]$target.Top; width = [double]$target.Width; height = [double]$target.Height }
        }
      }
      catch { $result.errors += "slide $($grp.Name): $($_.Exception.Message)" }
    }
  }
  $pres.Close()
}
catch {
  $result.ok = $false
  $result.errors += $_.Exception.Message
}
finally {
  try { $ppt.Quit() } catch {}
  try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null } catch {}
}
$result | ConvertTo-Json -Depth 5 -Compress
if (-not $result.ok) { exit 1 }
