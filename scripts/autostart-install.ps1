param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "体重管理.lnk"
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = Join-Path $PSScriptRoot "autostart.bat"
$s.WorkingDirectory = $Root
$s.WindowStyle = 7
$s.Description = "体重管理服务开机自启(隐藏窗口)"
$s.Save()
Write-Host ("OK 已创建开机自启快捷方式: " + $lnk)
