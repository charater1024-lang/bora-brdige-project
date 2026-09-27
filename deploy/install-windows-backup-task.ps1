[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Python,
    [Parameter(Mandatory = $true)][string]$SshHost,
    [Parameter(Mandatory = $true)][string]$RemoteDirectory,
    [string]$BackupDirectory = (Join-Path $env:LOCALAPPDATA 'BoraBridge\Backups')
)
$ErrorActionPreference = 'Stop'
$taskName = 'BoraBridge Encrypted Backup'
$destination = [IO.Path]::GetFullPath($BackupDirectory)
$pythonPath = (Resolve-Path -LiteralPath $Python).Path
$pythonWindowless = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonWindowless -PathType Leaf)) { throw 'Windowless Python is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $destination 'recovery-key.dpapi') -PathType Leaf)) {
    throw 'Initialize the Windows-protected key with windows-backup-client.py init first.'
}
if ($SshHost -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$' -or
    $RemoteDirectory -notmatch '^/[A-Za-z0-9_/.-]+$' -or $RemoteDirectory.Split('/') -contains '..') {
    throw 'Invalid SSH backup endpoint.'
}
$client = Join-Path $destination 'backup-client.py'
$config = Join-Path $destination 'backup-client.json'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Count -ne 1 -or $existing.Actions[0].Arguments -notlike ('*"' + $client + '"*'))) {
    throw 'Refusing to overwrite an unrelated scheduled task.'
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-backup-client.py') -Destination $client
@{ ssh_host = $SshHost; remote_directory = $RemoteDirectory } | ConvertTo-Json |
    Set-Content -LiteralPath $config -Encoding UTF8
$arguments = '"' + $client + '" sync --directory "' + $destination + '" --config "' + $config + '"'
$action = New-ScheduledTaskAction -Execute $pythonWindowless -Argument $arguments
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $identity),
    (New-ScheduledTaskTrigger -Daily -At '09:00'),
    (New-ScheduledTaskTrigger -Daily -At '15:00'),
    (New-ScheduledTaskTrigger -Daily -At '21:00')
)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'Installed current-user encrypted backup task (logon and 09:00/15:00/21:00).'
Write-Output 'The PC must be awake, this user logged in, and SSH reachable. No password is stored in the task.'
