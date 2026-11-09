# Persistent UI Automation helper. Reads one JSON command per line on stdin, answers one JSON line on stdout.
# Commands: find | rel | at | ping.  All rectangles are PHYSICAL screen pixels (process is made DPI-aware first).
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class W32 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
}
'@
[void][W32]::SetProcessDPIAware()
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding  = New-Object System.Text.UTF8Encoding($false)

$AE     = [System.Windows.Automation.AutomationElement]
$Tree   = [System.Windows.Automation.TreeScope]
$TrueC  = [System.Windows.Automation.Condition]::TrueCondition
$Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$RootEl = $AE::RootElement

function Send($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

function Get-TopWindows($titleRe, $procRe) {
  $pids = $null
  if ($procRe) { $pids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $procRe } | ForEach-Object { $_.Id }) }
  $out = @()
  foreach ($w in $RootEl.FindAll($Tree::Children, $TrueC)) {
    try {
      if ($w.Current.IsOffscreen) { continue }
      $n = [string]$w.Current.Name
      if ($titleRe -and $n -notmatch $titleRe) { continue }
      if ($null -ne $pids -and ($pids -notcontains $w.Current.ProcessId)) { continue }
      $r = $w.Current.BoundingRectangle
      if ($r.Width -le 50 -or $r.Height -le 50) { continue }
      $out += $w
    } catch { continue }
  }
  return , $out
}

function Test-OnTop($winEl, $x, $y) {
  # UIA reports "visible" even when another window covers the element, so hit-test the point.
  $pt = New-Object 'W32+POINT'; $pt.X = [int]$x; $pt.Y = [int]$y
  $top = [W32]::GetAncestor([W32]::WindowFromPoint($pt), 2)
  return ([int64]$top -eq [int64]$winEl.Current.NativeWindowHandle)
}

function Invoke-Find($c) {
  $wins = Get-TopWindows $c.window $c.process
  if ($wins.Count -eq 0) { return @{ found = $false; reason = 'window-not-found' } }
  $typeStr = 'Button'; if ($c.type) { $typeStr = [string]$c.type }
  $conds = @()
  foreach ($type in ($typeStr -split '\|')) {
    if ($type -eq 'Any') { $conds += $TrueC; continue }
    $ct = [System.Windows.Automation.ControlType]::$type
    if ($null -eq $ct) { return @{ found = $false; reason = "bad-type:$type" } }
    $conds += (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $ct))
  }
  $nameRe = '.*'; if ($c.name) { $nameRe = [string]$c.name }
  $hits = @(); $covered = 0
  for ($attempt = 0; $attempt -lt 2 -and $hits.Count -eq 0; $attempt++) {
    if ($attempt -eq 1) { Start-Sleep -Milliseconds 450 }   # Chromium builds its tree lazily on first query
    foreach ($win in $wins) {
      $wr = $win.Current.BoundingRectangle
      foreach ($cond in $conds) {
      foreach ($el in $win.FindAll($Tree::Descendants, $cond)) {
        try {
          $nm = [string]$el.Current.Name
          if ($nm.Length -eq 0 -or $nm -notmatch $nameRe) { continue }
          if ($el.Current.IsOffscreen) { continue }
          $r = $el.Current.BoundingRectangle
          if ($r.Width -le 1 -or $r.Height -le 1) { continue }
          if ($r.X -lt $wr.X - 2 -or $r.Y -lt $wr.Y - 2 -or ($r.X + $r.Width) -gt ($wr.X + $wr.Width + 2) -or ($r.Y + $r.Height) -gt ($wr.Y + $wr.Height + 2)) { continue }
          if (-not $c.nocover -and -not (Test-OnTop $win ($r.X + $r.Width / 2) ($r.Y + $r.Height / 2))) { $covered++; continue }
          $hits += [pscustomobject]@{ name = $nm; x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height }
        } catch { continue }
      }
      }
    }
  }
  $idx = 0; if ($c.index) { $idx = [int]$c.index }
  if ($hits.Count -le $idx) { $why = 'element-not-found'; if ($covered -gt 0) { $why = 'covered' }; return @{ found = $false; reason = $why } }
  $sorted = @($hits | Sort-Object @{ e = { [math]::Round($_.y / 8) } }, x)
  $m = $sorted[$idx]
  return @{ found = $true; name = $m.name; x = [int]$m.x; y = [int]$m.y; w = [int]$m.w; h = [int]$m.h; count = $hits.Count }
}

function Invoke-Rel($c) {
  # fallback target: a fraction of a window (for icon buttons that have no accessible name)
  $wins = Get-TopWindows $c.window $c.process
  if ($wins.Count -eq 0) { return @{ found = $false; reason = 'window-not-found' } }
  $f = $c.rel
  foreach ($win in $wins) {
    $wr = $win.Current.BoundingRectangle
    $x = $wr.X + $f[0] * $wr.Width; $y = $wr.Y + $f[1] * $wr.Height; $w = [math]::Max(8, $f[2] * $wr.Width); $h = [math]::Max(8, $f[3] * $wr.Height)
    if (Test-OnTop $win ($x + $w / 2) ($y + $h / 2)) { return @{ found = $true; name = 'window-relative'; x = [int]$x; y = [int]$y; w = [int]$w; h = [int]$h } }
  }
  return @{ found = $false; reason = 'covered' }
}

$InteractiveTypes = 'Button', 'MenuItem', 'TabItem', 'Hyperlink', 'ListItem', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'SplitButton', 'TreeItem', 'MenuBar', 'Menu'
function Invoke-At($c) {
  $pt = New-Object System.Windows.Point -ArgumentList ([double]$c.x), ([double]$c.y)
  $el = $AE::FromPoint($pt)
  if ($null -eq $el) { return @{ found = $false; reason = 'nothing-at-point' } }
  # prefer the nearest named, interactive ancestor (a click usually lands on an inner Text/Image)
  $pick = $null; $named = $null; $cur = $el
  for ($i = 0; $i -lt 5 -and $null -ne $cur; $i++) {
    $nm = [string]$cur.Current.Name
    $ty = $cur.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    if ($nm.Length -gt 0) {
      if ($null -eq $named) { $named = $cur }
      if ($InteractiveTypes -contains $ty) { $pick = $cur; break }
    }
    $cur = $Walker.GetParent($cur)
  }
  if ($null -eq $pick) { $pick = $named }
  # top-level window of the clicked element
  $w = $el
  while ($true) { $p = $Walker.GetParent($w); if ($null -eq $p -or [System.Windows.Automation.Automation]::Compare($p, $RootEl)) { break }; $w = $p }
  $procName = ''; try { $procName = (Get-Process -Id $w.Current.ProcessId -ErrorAction Stop).ProcessName } catch { }
  $wr = $w.Current.BoundingRectangle
  $res = @{ found = $true; process = $procName; windowTitle = [string]$w.Current.Name; winRect = @([int]$wr.X, [int]$wr.Y, [int]$wr.Width, [int]$wr.Height) }
  if ($null -ne $pick) {
    $r = $pick.Current.BoundingRectangle
    $res.name = [string]$pick.Current.Name
    $res.type = $pick.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $res.rect = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
  } else { $res.name = ''; $res.type = '' }
  return $res
}

Send @{ ready = $true }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $line = $line.TrimStart([char]0xFEFF)
  if ($line.Trim().Length -eq 0) { continue }
  $id = $null
  try {
    $c = $line | ConvertFrom-Json
    $id = $c.id
    switch ($c.cmd) {
      'find' { $res = Invoke-Find $c }
      'rel'  { $res = Invoke-Rel $c }
      'at'   { $res = Invoke-At $c }
      'ping' { $res = @{ found = $true; pong = $true } }
      default { $res = @{ found = $false; reason = 'bad-cmd' } }
    }
  } catch { $res = @{ found = $false; reason = 'error'; message = $_.Exception.Message } }
  $res.id = $id
  Send $res
}
