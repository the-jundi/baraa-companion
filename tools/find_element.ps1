# Finds a UI element by name through Windows UI Automation and prints ONE JSON line.
# Output rect is in PHYSICAL screen pixels (this process is made DPI-aware first).
param(
  [string]$Window = '.*',      # regex on the top-level window title
  [string]$Name   = '.*',      # regex on the element name
  [string]$Type   = 'Button',  # Button | Edit | Hyperlink | MenuItem | TabItem | ListItem | CheckBox | Any
  [int]$Index     = 0          # which match to return (after top-to-bottom, left-to-right sort)
)
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
$AE   = [System.Windows.Automation.AutomationElement]
$Tree = [System.Windows.Automation.TreeScope]

function Out-Json($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)) }

try {
  $root = $AE::RootElement
  $wins = $root.FindAll($Tree::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $targets = @()
  foreach ($w in $wins) {
    $n = [string]$w.Current.Name
    if ($n -match $Window -and -not $w.Current.IsOffscreen) { $targets += $w }
  }
  if ($targets.Count -eq 0) { Out-Json @{ found = $false; reason = 'window-not-found' }; exit 0 }

  if ($Type -eq 'Any') { $cond = [System.Windows.Automation.Condition]::TrueCondition }
  else {
    $ct = [System.Windows.Automation.ControlType]::$Type
    if ($null -eq $ct) { Out-Json @{ found = $false; reason = "bad-type:$Type" }; exit 0 }
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $ct)
  }

  $hits = @()
  $covered = 0
  for ($attempt = 0; $attempt -lt 2 -and $hits.Count -eq 0; $attempt++) {
    if ($attempt -eq 1) { Start-Sleep -Milliseconds 450 }   # Chromium builds its tree lazily on first query
    foreach ($win in $targets) {
      $wr = $win.Current.BoundingRectangle
      $all = $win.FindAll($Tree::Descendants, $cond)
      foreach ($el in $all) {
        $nm = [string]$el.Current.Name
        if ($nm.Length -eq 0 -or $nm -notmatch $Name) { continue }
        if ($el.Current.IsOffscreen) { continue }
        $r = $el.Current.BoundingRectangle
        if ($r.Width -le 1 -or $r.Height -le 1) { continue }
        # must lie inside its own window (drops scrolled-out / collapsed items)
        if ($r.X -lt $wr.X - 2 -or $r.Y -lt $wr.Y - 2 -or ($r.X + $r.Width) -gt ($wr.X + $wr.Width + 2) -or ($r.Y + $r.Height) -gt ($wr.Y + $wr.Height + 2)) { continue }
        # UIA says "visible" even when another window sits on top. Hit-test the centre: the top-level window there must be ours.
        $pt = New-Object 'W32+POINT'
        $pt.X = [int]($r.X + $r.Width / 2); $pt.Y = [int]($r.Y + $r.Height / 2)
        $top = [W32]::GetAncestor([W32]::WindowFromPoint($pt), 2)
        if ([int64]$top -ne [int64]$win.Current.NativeWindowHandle) { $covered++; continue }
        $hits += [pscustomobject]@{ name = $nm; x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height }
      }
    }
  }
  if ($hits.Count -le $Index) {
    $why = 'element-not-found'; if ($covered -gt 0) { $why = 'covered' }
    Out-Json @{ found = $false; reason = $why }; exit 0
  }
  $sorted = $hits | Sort-Object @{ e = { [math]::Round($_.y / 8) } }, x
  $m = @($sorted)[$Index]
  Out-Json @{ found = $true; name = $m.name; x = [int]$m.x; y = [int]$m.y; w = [int]$m.w; h = [int]$m.h; count = $hits.Count }
}
catch {
  Out-Json @{ found = $false; reason = 'error'; message = $_.Exception.Message }
}
