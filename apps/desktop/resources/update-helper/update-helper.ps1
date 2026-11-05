# Bochica's update helper. main/update-helper.ts copies this folder to a temporary one and starts
# it just before Bochica closes to install an update, because the app has to be gone while the
# installer replaces it. It draws the same small window as the app's update window
# (renderer/src/update.tsx), so the user sees one window from "Update now" until the new
# version opens:
#
#   1. while Bochica is still closing: "Getting ready to install...";
#   2. once Bochica has exited: "Installing...", until the installer ends;
#   3. "Update now" only: until the new Bochica shows its window, which it says by removing the
#      update marker.
#
# The marker (JSON: this process's pid, start time and the version being installed) tells a
# Bochica started meanwhile that an update owns the app; such a launch creates the poke file next
# to it, and this window comes to the front. If something takes too long, the window says what to
# do and can be closed.
#
# How it is started (hidden cmd.exe, working folder %TEMP%, the ready file) follows Hermes's
# relaunch waiter; see main/update-helper.ts.

param(
  [Parameter(Mandatory = $true)][string]$Config
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

$cfg = [IO.File]::ReadAllText($Config, [Text.Encoding]::UTF8) | ConvertFrom-Json
$text = $cfg.strings

# Nobody reads this process's output, so the log says why it gave up. It is shared by every
# attempt: each line carries this folder's name, and the file restarts past 64 KB.
$attempt = Split-Path -Leaf $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)
try {
  if ((Test-Path -LiteralPath $cfg.log) -and (Get-Item -LiteralPath $cfg.log).Length -gt 65536) {
    Remove-Item -LiteralPath $cfg.log -Force
  }
} catch {}
function Write-HelperLog([string]$message) {
  try {
    $line = '{0} [{1}] pid={2} {3}' -f (Get-Date -Format o), $attempt, $PID, ($message -replace '\r?\n', ' | ')
    [IO.File]::AppendAllText([string]$cfg.log, $line + "`n", $utf8)
  } catch {}
}

# Cleans up after itself: the marker if it is ours, and this temporary folder.
function Remove-Staging {
  Set-Location $env:TEMP
  if ($attempt.StartsWith('bochica-update-')) {
    Remove-Item -LiteralPath $PSScriptRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

trap {
  Write-HelperLog ('failed: ' + ($_ | Out-String).Trim())
  try {
    $owner = [IO.File]::ReadAllText([string]$cfg.marker) | ConvertFrom-Json
    if ([int]$owner.pid -eq $PID) { Remove-Item -LiteralPath $cfg.marker -Force }
  } catch {}
  Remove-Staging
  exit 1
}

Write-HelperLog "start: parent=$($cfg.parentPid) version=$($cfg.version) relaunch=$($cfg.relaunch)"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Crisp text on scaled displays. Without it Windows stretches the window, which still works.
try {
  Add-Type -Namespace Bochica -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  [void][Bochica.Dpi]::SetProcessDPIAware()
} catch {}

# The process to wait for. A Process object holds a handle, so a reused pid can't fool it.
$parent = $null
try { $parent = [System.Diagnostics.Process]::GetProcessById([int]$cfg.parentPid) } catch {}

$installerName = $null
if ($cfg.installer) { $installerName = [IO.Path]::GetFileNameWithoutExtension([string]$cfg.installer) }
$poke = "$($cfg.marker).poke"

# Times, in seconds, after which the window stops waiting.
$parentLimit = 120      # Bochica didn't close: it is still running, so leave quietly.
$installerAppears = 30  # the installer never showed up: it ran too fast to see, or didn't start.
$installerLimit = 600   # the installer runs far longer than it should.
$relaunchLimit = 120    # the new version didn't open after the installer ended.

# Colours: the app's theme tokens (styles.css) in sRGB, light or dark like Windows' apps.
$light = $true
try {
  $light = (Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' 'AppsUseLightTheme') -ne 0
} catch {}
function Color([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }
if ($light) {
  $bg = Color '#FBFAF7'; $fg = Color '#231E1B'; $mutedFg = Color '#6E6762'
  $track = Color '#F2F0EC'; $border = Color '#E0DED8'; $primary = Color '#CD632D'
} else {
  $bg = Color '#171614'; $fg = Color '#EAE8E3'; $mutedFg = Color '#9C9792'
  $track = Color '#23211F'; $border = Color '#302D2B'; $primary = Color '#E27641'
}

$graphics = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
$scale = $graphics.DpiX / 96
$graphics.Dispose()
function Px([double]$value) { [int][Math]::Round($value * $scale) }

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Bochica'
$form.FormBorderStyle = 'None'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size((Px 380), (Px 150))
# Always on top and out of the taskbar: there it would show PowerShell's icon, not Bochica's.
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = $border
$form.Padding = New-Object System.Windows.Forms.Padding(1)
$iconPath = Join-Path $PSScriptRoot 'icon.ico'
if (Test-Path -LiteralPath $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }

$panel = New-Object System.Windows.Forms.Panel
$panel.Dock = 'Fill'
$panel.BackColor = $bg
$form.Controls.Add($panel)

function Add-Label([int]$x, [int]$y, [int]$w, [int]$h, [string]$value, [System.Drawing.Font]$font, [System.Drawing.Color]$color) {
  $label = New-Object System.Windows.Forms.Label
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size($w, $h)
  $label.Text = $value
  $label.Font = $font
  $label.ForeColor = $color
  $label.BackColor = $bg
  $label.UseMnemonic = $false
  $label.AutoEllipsis = $true
  $panel.Controls.Add($label)
  $label
}

# The picture comes from the PNG: .NET Framework garbles an .ico's PNG-compressed sizes.
$picturePath = Join-Path $PSScriptRoot 'icon.png'
if (Test-Path -LiteralPath $picturePath) {
  $picture = New-Object System.Windows.Forms.PictureBox
  $picture.Location = New-Object System.Drawing.Point((Px 24), (Px 26))
  $picture.Size = New-Object System.Drawing.Size((Px 36), (Px 36))
  $picture.SizeMode = 'Zoom'
  $picture.Image = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(, [IO.File]::ReadAllBytes($picturePath))))
  $panel.Controls.Add($picture)
}

$titleFont = New-Object System.Drawing.Font('Segoe UI Semibold', 10.5)
$stepFont = New-Object System.Drawing.Font('Segoe UI', 9.5)
$noteFont = New-Object System.Drawing.Font('Segoe UI', 8.5)
[void](Add-Label (Px 72) (Px 24) (Px 284) (Px 22) $text.title $titleFont $fg)
$step = Add-Label (Px 72) (Px 46) (Px 284) (Px 20) $text.preparing $stepFont $mutedFg
$noteText = if ($cfg.relaunch) { $text.note } else { $text.laterNote }
$note = Add-Label (Px 24) (Px 96) (Px 332) (Px 40) $noteText $noteFont $mutedFg
$note.AutoEllipsis = $false

$trackPanel = New-Object System.Windows.Forms.Panel
$trackPanel.Location = New-Object System.Drawing.Point((Px 24), (Px 80))
$trackPanel.Size = New-Object System.Drawing.Size((Px 332), [Math]::Max(2, (Px 4)))
$trackPanel.BackColor = $track
$panel.Controls.Add($trackPanel)
$bar = New-Object System.Windows.Forms.Panel
$bar.Size = New-Object System.Drawing.Size([int]($trackPanel.Width / 3), $trackPanel.Height)
$bar.BackColor = $primary
$trackPanel.Controls.Add($bar)

$close = New-Object System.Windows.Forms.Button
$close.Text = $text.close
$close.Font = $stepFont
$close.Size = New-Object System.Drawing.Size((Px 88), (Px 30))
$close.Location = New-Object System.Drawing.Point((Px 268), (Px 146))
$close.FlatStyle = 'Flat'
$close.FlatAppearance.BorderColor = $border
$close.ForeColor = $fg
$close.BackColor = $bg
$close.Visible = $false
$close.Add_Click({ $form.Close() })
$panel.Controls.Add($close)

# The window can be dragged like the app's.
$drag = {
  param($sender, $e)
  if ($e.Button -eq 'Left') {
    $script:dragFrom = $e.Location
  }
}
$move = {
  param($sender, $e)
  if ($e.Button -eq 'Left' -and $null -ne $script:dragFrom) {
    $form.Left += $e.X - $script:dragFrom.X
    $form.Top += $e.Y - $script:dragFrom.Y
  }
}
$script:dragFrom = $null
foreach ($control in @($panel) + @($panel.Controls)) {
  if ($control -ne $close) {
    $control.Add_MouseDown($drag)
    $control.Add_MouseMove($move)
  }
}

function Test-OwnMarker {
  try {
    $marker = [IO.File]::ReadAllText([string]$cfg.marker) | ConvertFrom-Json
    return [int]$marker.pid -eq $PID
  } catch {
    return $false
  }
}

function Remove-OwnMarker {
  if (Test-OwnMarker) { Remove-Item -LiteralPath $cfg.marker -Force -ErrorAction SilentlyContinue }
}

function Show-Slow([string]$why) {
  Write-HelperLog "slow: $why"
  $script:phase = 'slow'
  $script:phaseAt = Get-Date
  Remove-OwnMarker
  $step.Text = $text.installing
  $note.Text = $text.slow
  $trackPanel.Visible = $false
  $note.Top = Px 76
  $note.Height = Px 60
  # Stays on top (it has no taskbar entry to find it by) until closed or 5 minutes pass.
  $form.ClientSize = New-Object System.Drawing.Size((Px 380), (Px 190))
  $close.Visible = $true
  $form.Activate()
}

function Finish([string]$why) {
  Write-HelperLog "done: $why"
  $script:phase = 'done'
  Remove-OwnMarker
  $form.Close()
}

$script:phase = 'parent'
$script:phaseAt = Get-Date
$script:installerSeen = $false
$script:pulse = 0

$form.Add_Shown({
  # The marker says the window is up; main waits for it before Bochica closes.
  $me = [System.Diagnostics.Process]::GetCurrentProcess()
  $started = ([DateTimeOffset]$me.StartTime).ToUnixTimeMilliseconds()
  $marker = @{ pid = $PID; started = $started; version = [string]$cfg.version } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText([string]$cfg.marker, $marker)
  [IO.File]::WriteAllText([string]$cfg.ready, 'ready')
  Write-HelperLog 'ready: the window shows'
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  try {
    $elapsed = ((Get-Date) - $script:phaseAt).TotalSeconds

    # The bar slides while there is no percent to show.
    $script:pulse = ($script:pulse + 1) % 24
    $bar.Left = [int](($trackPanel.Width + $bar.Width) * $script:pulse / 24) - $bar.Width

    if (Test-Path -LiteralPath $poke) {
      Remove-Item -LiteralPath $poke -Force -ErrorAction SilentlyContinue
      $form.WindowState = 'Normal'
      $form.Activate()
    }

    switch ($script:phase) {
      'parent' {
        if ($null -eq $parent -or $parent.HasExited) {
          $script:phase = 'installer'
          $script:phaseAt = Get-Date
          $step.Text = $text.installing
          Write-HelperLog 'Bochica exited; waiting for the installer'
        } elseif ($elapsed -gt $parentLimit) {
          Finish 'Bochica did not close'
        }
      }
      'installer' {
        $running = $false
        if ($installerName) {
          $running = $null -ne (Get-Process -Name $installerName -ErrorAction SilentlyContinue)
        }
        if ($running) { $script:installerSeen = $true }
        $ended = ($script:installerSeen -and -not $running) -or
          (-not $script:installerSeen -and $elapsed -gt $installerAppears)
        if ($ended) {
          Write-HelperLog "installer ended (seen: $($script:installerSeen))"
          if ($cfg.relaunch) {
            $script:phase = 'relaunch'
            $script:phaseAt = Get-Date
          } else {
            Finish 'installed'
          }
        } elseif ($elapsed -gt $installerLimit) {
          Show-Slow 'the installer runs too long'
        }
      }
      'relaunch' {
        if (-not (Test-OwnMarker)) {
          Finish 'the new version is up'
        } elseif ($elapsed -gt $relaunchLimit) {
          Show-Slow 'the new version did not open'
        }
      }
      'slow' {
        if ($elapsed -gt 300) { $form.Close() }
      }
    }
    # "Update now": the new version may open before the installer's process is gone.
    if ($cfg.relaunch -and $script:phase -eq 'installer' -and -not (Test-OwnMarker)) {
      Finish 'the new version is up'
    }
  } catch {
    Finish ('failed: ' + ($_ | Out-String).Trim())
  }
})

$timer.Start()
[void]$form.ShowDialog()
$timer.Stop()
Remove-OwnMarker
Remove-Item -LiteralPath $poke -Force -ErrorAction SilentlyContinue
Remove-Staging
