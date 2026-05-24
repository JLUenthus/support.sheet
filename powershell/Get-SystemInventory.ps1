<#
.SYNOPSIS
    Erstellt einen vollständigen System-Inventarbericht als HTML-Datei.

.DESCRIPTION
    Sammelt Hardware- und Softwareinformationen des lokalen Rechners:
    - Computername, OS-Version, Uptime
    - CPU, RAM, Festplatten
    - Netzwerkadapter mit IP
    - Installierte Software
    - Letzte Windows-Updates
    Ausgabe als formatierte HTML-Datei auf dem Desktop.

.PARAMETER OutputPath
    Speicherort für den HTML-Report. Standard: Desktop des aktuellen Benutzers.

.EXAMPLE
    .\Get-SystemInventory.ps1
    .\Get-SystemInventory.ps1 -OutputPath "C:\Reports\inventory.html"

.NOTES
    Autor: AdminSheet
    Version: 1.0
    Benötigt: PowerShell 5.1+, keine Admin-Rechte für Basis-Info
#>

param(
    [string]$OutputPath = "$env:USERPROFILE\Desktop\SystemInventory_$(Get-Date -Format 'yyyyMMdd_HHmm').html"
)

Write-Host "Sammle Systeminformationen..." -ForegroundColor Cyan

# OS & Computer
$os       = Get-CimInstance Win32_OperatingSystem
$cs       = Get-CimInstance Win32_ComputerSystem
$bios     = Get-CimInstance Win32_BIOS
$uptime   = (Get-Date) - $os.LastBootUpTime

# CPU
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1

# RAM
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)

# Festplatten
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    [PSCustomObject]@{
        Laufwerk  = $_.DeviceID
        Gesamt_GB = [math]::Round($_.Size / 1GB, 1)
        Frei_GB   = [math]::Round($_.FreeSpace / 1GB, 1)
        Belegt_Pct = [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1)
    }
}

# Netzwerk
$nics = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" | ForEach-Object {
    [PSCustomObject]@{
        Adapter    = $_.Description
        IP         = ($_.IPAddress -join ", ")
        MAC        = $_.MACAddress
        DHCP       = $_.DHCPEnabled
    }
}

# Installierte Software (Top 50 nach Name)
Write-Host "Lese installierte Software..." -ForegroundColor Cyan
$software = Get-ItemProperty `
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
    Sort-Object DisplayName |
    Select-Object -First 50

# Letzte 10 Updates
$updates = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 10

# HTML bauen
$diskRows    = $disks    | ForEach-Object { "<tr><td>$($_.Laufwerk)</td><td>$($_.Gesamt_GB) GB</td><td>$($_.Frei_GB) GB</td><td>$($_.Belegt_Pct)%</td></tr>" }
$nicRows     = $nics     | ForEach-Object { "<tr><td>$($_.Adapter)</td><td>$($_.IP)</td><td>$($_.MAC)</td><td>$($_.DHCP)</td></tr>" }
$softRows    = $software | ForEach-Object { "<tr><td>$($_.DisplayName)</td><td>$($_.DisplayVersion)</td><td>$($_.Publisher)</td></tr>" }
$updateRows  = $updates  | ForEach-Object { "<tr><td>$($_.HotFixID)</td><td>$($_.Description)</td><td>$($_.InstalledOn)</td></tr>" }

$html = @"
<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>System Inventar – $($cs.Name)</title>
<style>
  body{font-family:Segoe UI,sans-serif;background:#0f1117;color:#e0e4f0;margin:0;padding:24px;}
  h1{color:#7c8cf8;} h2{color:#a78bfa;border-bottom:1px solid #2a2d3e;padding-bottom:4px;margin-top:32px;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  th{background:#1a1d2e;color:#7c8cf8;padding:8px;text-align:left;font-size:12px;}
  td{padding:7px 8px;border-bottom:1px solid #2a2d3e;font-size:13px;}
  tr:hover td{background:#21253a;}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
  .info{background:rgba(124,140,248,.15);color:#7c8cf8;}
</style></head><body>
<h1>🖥️ System Inventar – $($cs.Name)</h1>
<p>Erstellt: $(Get-Date -Format 'dd.MM.yyyy HH:mm') &nbsp;|&nbsp; Uptime: $($uptime.Days)d $($uptime.Hours)h $($uptime.Minutes)m</p>
<h2>System</h2>
<table><tr><th>Eigenschaft</th><th>Wert</th></tr>
<tr><td>Computername</td><td>$($cs.Name)</td></tr>
<tr><td>Domäne</td><td>$($cs.Domain)</td></tr>
<tr><td>Betriebssystem</td><td>$($os.Caption) $($os.Version)</td></tr>
<tr><td>Architektur</td><td>$($os.OSArchitecture)</td></tr>
<tr><td>BIOS</td><td>$($bios.SMBIOSBIOSVersion)</td></tr>
<tr><td>Hersteller</td><td>$($cs.Manufacturer)</td></tr>
<tr><td>Modell</td><td>$($cs.Model)</td></tr>
<tr><td>CPU</td><td>$($cpu.Name) ($($cpu.NumberOfCores) Kerne / $($cpu.NumberOfLogicalProcessors) Threads)</td></tr>
<tr><td>RAM</td><td>$ramGB GB</td></tr>
</table>
<h2>Festplatten</h2>
<table><tr><th>Laufwerk</th><th>Gesamt</th><th>Frei</th><th>Belegt</th></tr>$diskRows</table>
<h2>Netzwerkadapter</h2>
<table><tr><th>Adapter</th><th>IP-Adresse</th><th>MAC</th><th>DHCP</th></tr>$nicRows</table>
<h2>Installierte Software (Top 50)</h2>
<table><tr><th>Name</th><th>Version</th><th>Hersteller</th></tr>$softRows</table>
<h2>Letzte Windows-Updates (10)</h2>
<table><tr><th>KB</th><th>Beschreibung</th><th>Installiert am</th></tr>$updateRows</table>
</body></html>
"@

$html | Out-File -FilePath $OutputPath -Encoding UTF8
Write-Host "Report gespeichert: $OutputPath" -ForegroundColor Green
Start-Process $OutputPath
