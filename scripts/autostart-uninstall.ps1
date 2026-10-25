$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "体重管理.lnk"
if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host ("OK 已移除开机自启: " + $lnk) } else { Write-Host "未找到自启快捷方式(本来就没装)" }
