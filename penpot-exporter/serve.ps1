# Serves this folder at http://localhost:4400 so Penpot can load the plugin.
# Leave this window open while you use the plugin; close it (or press Ctrl+C) to stop.
param([int]$Port = 4400)
$root = $PSScriptRoot
$mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.css' = 'text/css' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Penpot plugin is being served."
Write-Host "In Penpot, open Plugins (Ctrl+Alt+P) and install: http://localhost:$Port/manifest.json"
Write-Host "Keep this window open while you use it."
while ($listener.IsListening) {
  $ctx = $listener.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  $res.Headers.Add('Access-Control-Allow-Origin', '*')
  $res.Headers.Add('Access-Control-Allow-Headers', '*')
  $res.Headers.Add('Access-Control-Allow-Private-Network', 'true')
  try {
    if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204 }
    else {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($file.StartsWith([IO.Path]::GetFullPath($root)) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
        $bytes = [IO.File]::ReadAllBytes($file)
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $res.StatusCode = 404 }
    }
  } catch { $res.StatusCode = 500 }
  $res.Close()
}
