# 迭代4 QA:枚举 Startup 目录所有 .lnk 并读取 TargetPath(无中文字面量,编码无关;只读)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$startup = [Environment]::GetFolderPath("Startup")
Write-Output ("StartupFolder=" + $startup)
$shell = New-Object -ComObject WScript.Shell
Get-ChildItem -LiteralPath $startup -Filter *.lnk | ForEach-Object {
  $s = $shell.CreateShortcut($_.FullName)
  Write-Output ("LnkName=" + $_.Name)
  Write-Output ("TargetPath=" + $s.TargetPath)
  Write-Output ("WorkingDirectory=" + $s.WorkingDirectory)
  Write-Output ("WindowStyle=" + $s.WindowStyle)
  Write-Output ("TargetFileExists=" + (Test-Path -LiteralPath $s.TargetPath))
  $bat = Join-Path (Get-Item (Join-Path $PSScriptRoot "..\..")).FullName "scripts\autostart.bat"
  Write-Output ("TargetIsAutostartBat=" + ($s.TargetPath -ieq $bat))
}
