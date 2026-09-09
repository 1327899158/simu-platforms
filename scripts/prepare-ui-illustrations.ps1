$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($asset in @('user_home','eng_hall','order','pay','identity','commit','engineer_home-generated','hero-laptop','hero-wrench')) {
  $sourceName = if ($asset -in @('hero-laptop','hero-wrench')) { $asset+'-original' } else { $asset }
  $source = Join-Path $projectRoot ('icon/'+$sourceName+'.png')
  $target = Join-Path $projectRoot ('miniapp/assets/'+$asset+'.png')
  $original = [Drawing.Image]::FromFile($source)
  try {
    $scale = [Math]::Min([double]1,360.0/[Math]::Max($original.Width,$original.Height))
    $bitmap = [Drawing.Bitmap]::new([int]($original.Width*$scale),[int]($original.Height*$scale),[Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($original,0,0,$bitmap.Width,$bitmap.Height)
      } finally { $graphics.Dispose() }
      $bitmap.Save($target,[Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
  } finally { $original.Dispose() }
}
