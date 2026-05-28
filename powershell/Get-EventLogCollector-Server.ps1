#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Event Log Collector fuer Windows Server 2019/2022 - AdminSheet Event Log Analyzer
.NOTES
    Autor: AdminSheet | Version: 1.2
    Benoetigt: PowerShell 5.1+, Admin-Rechte
    Kompatibel: Windows Server 2016/2019/2022
#>

$ErrorActionPreference = 'SilentlyContinue'

# --- Zeitraum-Auswahl ---
Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   AdminSheet - Event Log Collector (Windows Server)  " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Zeitraum auswaehlen:" -ForegroundColor Yellow
Write-Host "  [1]  Letzte  8 Stunden"
Write-Host "  [2]  Letzte 24 Stunden  (Standard)"
Write-Host "  [3]  Letzte  5 Tage"
Write-Host "  [4]  Letzte  7 Tage"
Write-Host "  [5]  Letzte 30 Tage"
Write-Host ""

$choice = Read-Host "  Auswahl (1-5, Enter = 2)"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "2" }

$Hours = switch ($choice) {
    "1"  { 8   }
    "2"  { 24  }
    "3"  { 120 }
    "4"  { 168 }
    "5"  { 720 }
    default {
        Write-Host "  Ungueltige Auswahl - verwende 24 Stunden." -ForegroundColor Yellow
        24
    }
}

$HoursLabel = switch ($choice) {
    "1"  { "8 Stunden"  }
    "2"  { "24 Stunden" }
    "3"  { "5 Tage"     }
    "4"  { "7 Tage"     }
    "5"  { "30 Tage"    }
    default { "24 Stunden" }
}

# --- Ausgabepfad ---
$TempPath = "C:\Temp"
if (-not (Test-Path $TempPath)) {
    New-Item -ItemType Directory -Path $TempPath -Force | Out-Null
}
$OutputPath = "$TempPath\EventLog_Server_$(Get-Date -Format 'yyyyMMdd_HHmm').json"

$StartTime = (Get-Date).AddHours(-$Hours)
$Results   = @()
$Summary   = @{ Critical=0; Error=0; Warning=0; Info=0; Total=0 }
$All       = $true

Write-Host ""
Write-Host "  Zeitraum: $HoursLabel" -ForegroundColor Gray
Write-Host "  Von:      $($StartTime.ToString('dd.MM.yyyy HH:mm'))" -ForegroundColor Gray
Write-Host "  Bis:      $(Get-Date -Format 'dd.MM.yyyy HH:mm')" -ForegroundColor Gray
Write-Host "  Ziel:     $OutputPath" -ForegroundColor Gray
Write-Host ""

function Collect-Events {
    param($LogName, $IDs, $Level, $Label, $Category)
    Write-Host "  Sammle: $Label..." -ForegroundColor DarkGray -NoNewline
    $filter = @{ LogName = $LogName; StartTime = $StartTime }
    if ($IDs)   { $filter.Id    = $IDs }
    if ($Level) { $filter.Level = $Level }
    $events = Get-WinEvent -FilterHashtable $filter -ErrorAction SilentlyContinue
    if (-not $events) { Write-Host " (keine)" -ForegroundColor DarkGray; return }
    foreach ($e in $events) {
        $lvl = switch ($e.Level) { 1{"Critical"} 2{"Error"} 3{"Warning"} default{"Info"} }
        $Summary[$lvl]++
        $Summary.Total++
        $msg = ($e.Message -replace '\r?\n',' ' -replace '\s+',' ')
        if ($msg.Length -gt 400) { $msg = $msg.Substring(0,400) }
        $script:Results += [PSCustomObject]@{
            TimeCreated  = $e.TimeCreated.ToString("yyyy-MM-ddTHH:mm:ss")
            Id           = $e.Id
            Level        = $lvl
            LogName      = $LogName
            ProviderName = $e.ProviderName
            Category     = $Category
            Message      = $msg
        }
    }
    Write-Host " $($events.Count) Ereignisse" -ForegroundColor Green
}

function Test-LogAvailable { param($LogName)
    return [bool](Get-WinEvent -ListLog $LogName -ErrorAction SilentlyContinue)
}

# --- System Grundlage ---
Write-Host "[1] System und Dienste" -ForegroundColor Yellow
Collect-Events 'System' @(41,6008)                              $null   'Ungeplante Neustarts'           'Absturz'
Collect-Events 'System' @(7000,7001,7009,7011,7023,7024,7031,7034,7043) @(1,2,3) 'Dienst-Fehler'         'System'
Collect-Events 'System' @(1,3,6,7,14,15)                       @(1,2)  'Kritische Systemfehler'         'System'
Collect-Events 'System' @(55,98,153,157,158,129)                $null   'Disk und Dateisystem Fehler'    'Hardware'
Collect-Events 'System' @(2004,2013,2019,2020)                  $null   'Speicher Fehler'                'System'
Collect-Events 'System' @(9,11,51,52)                           $null   'Festplatten I/O Fehler'         'Hardware'
Collect-Events 'Application' @(1000,1001,1002)                  @(1,2)  'Anwendungsabsturz'              'Absturz'

# --- Netzwerk ---
Write-Host "[2] Netzwerk und Verbindungen" -ForegroundColor Yellow
Collect-Events 'System' @(4199,4200)                            $null   'IP-Adress Konflikte'            'Netzwerk'
Collect-Events 'System' @(5719,5722,5723)                       $null   'Netlogon / Domaenenanmeldung'   'Netzwerk'
Collect-Events 'System' @(1014)                                 $null   'DNS-Auflosung fehlgeschlagen'    'Netzwerk'

# --- Sicherheit ---
Write-Host "[3] Sicherheit und Anmeldungen" -ForegroundColor Yellow
Collect-Events 'Security' @(4625,4740)                          $null   'Fehlgeschlagene Anmeldungen / Kontosperrung' 'Sicherheit'
Collect-Events 'Security' @(4648,4672)                          $null   'Privilegierte Anmeldungen'      'Sicherheit'
Collect-Events 'Security' @(4720,4722,4723,4724,4725,4726)     $null   'Benutzerkonto-Aenderungen'       'Sicherheit'
Collect-Events 'Security' @(4728,4732,4756)                     $null   'Gruppenaenderungen'              'Sicherheit'
Collect-Events 'Security' @(1102)                               $null   'Audit-Log geloescht'             'Sicherheit'

# --- Active Directory ---
if (Test-LogAvailable 'Directory Service') {
    Write-Host "[4] Active Directory" -ForegroundColor Yellow
    Collect-Events 'Directory Service' $null                    @(1,2)  'AD Directory Service Fehler'    'ActiveDirectory'
    Collect-Events 'System' @(5774,5775,5781,5783,5807)         $null   'NETLOGON AD Fehler'             'ActiveDirectory'
    if (Test-LogAvailable 'DFS Replication') {
        Collect-Events 'DFS Replication' @(2213,5002,5008,5014) $null   'DFSR Replikation Fehler'        'ActiveDirectory'
    }
}

# --- DNS ---
if (Test-LogAvailable 'DNS Server') {
    Write-Host "[5] DNS Server" -ForegroundColor Yellow
    Collect-Events 'DNS Server' $null                           @(1,2)  'DNS Server Fehler'              'DNS'
    Collect-Events 'System' @(409,410,708,7062)                 $null   'DNS Dienst Fehler'              'DNS'
}

# --- DHCP ---
if (Test-LogAvailable 'Microsoft-Windows-Dhcp-Server/Operational') {
    Write-Host "[6] DHCP Server" -ForegroundColor Yellow
    Collect-Events 'Microsoft-Windows-Dhcp-Server/Operational' @(1020,1063,1064,1065) $null 'DHCP Pool Fehler' 'DHCP'
    Collect-Events 'System' @(1008,1059)                        $null   'DHCP Dienst Fehler'             'DHCP'
}

# --- RDS ---
if (Test-LogAvailable 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational') {
    Write-Host "[7] Remote Desktop Services" -ForegroundColor Yellow
    Collect-Events 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational' @(21,22,23,24,25,39,40,41) $null 'RDS Session Events' 'RDS'
    Collect-Events 'Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational' @(1149,261,263,1158) $null 'RDS Verbindungs-Fehler' 'RDS'
    Collect-Events 'System' @(1058,1030)                        $null   'RDS Lizenz / Policy Fehler'     'RDS'
}

# --- Hyper-V ---
if (Test-LogAvailable 'Microsoft-Windows-Hyper-V-Worker-Admin') {
    Write-Host "[8] Hyper-V" -ForegroundColor Yellow
    Collect-Events 'Microsoft-Windows-Hyper-V-Worker-Admin'            $null @(1,2) 'Hyper-V Worker Fehler'  'HyperV'
    Collect-Events 'Microsoft-Windows-Hyper-V-VMMS-Admin'              $null @(1,2) 'Hyper-V VMMS Fehler'    'HyperV'
    Collect-Events 'Microsoft-Windows-Hyper-V-High-Availability-Admin' $null @(1,2) 'Hyper-V HA Fehler'      'HyperV'
}

# --- VSS und Backup ---
Write-Host "[9] Backup und VSS" -ForegroundColor Yellow
Collect-Events 'Application' @(12289,8193,8194)                 $null   'VSS Fehler (Schattenkopie)'    'Backup'
Collect-Events 'Application' @(4,19,20,24,97)                   $null   'Windows Server Backup Fehler'  'Backup'

# --- IIS ---
if (Test-LogAvailable 'System') {
    $iisCheck = Get-WinEvent -FilterHashtable @{LogName='System';Id=15016;StartTime=$StartTime} -MaxEvents 1 -EA SilentlyContinue
    if ($iisCheck) {
        Write-Host "[10] IIS und Web" -ForegroundColor Yellow
        Collect-Events 'System'      @(15016)                   $null   'IIS Startfehler'               'IIS'
        Collect-Events 'Application' @(1309,1310)               $null   'ASP.NET Fehler'                'IIS'
    }
}

# --- Metadaten ---
Write-Host ""
Write-Host "[i] Systeminformationen sammeln..." -ForegroundColor Yellow

$os    = Get-CimInstance Win32_OperatingSystem
$cs    = Get-CimInstance Win32_ComputerSystem
$proc  = Get-CimInstance Win32_Processor | Select-Object -First 1
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
         Select-Object DeviceID,
             @{N="Size_GB";E={[math]::Round($_.Size/1GB,1)}},
             @{N="Free_GB";E={[math]::Round($_.FreeSpace/1GB,1)}})

$roles = @()
try {
    if (Get-WindowsFeature AD-Domain-Services -EA Stop | Where-Object Installed) { $roles += 'ActiveDirectory' }
    if (Get-WindowsFeature DNS               -EA Stop | Where-Object Installed) { $roles += 'DNS' }
    if (Get-WindowsFeature DHCP              -EA Stop | Where-Object Installed) { $roles += 'DHCP' }
    if (Get-WindowsFeature RDS-RD-Server     -EA Stop | Where-Object Installed) { $roles += 'RemoteDesktop' }
    if (Get-WindowsFeature Hyper-V           -EA Stop | Where-Object Installed) { $roles += 'HyperV' }
    if (Get-WindowsFeature Web-Server        -EA Stop | Where-Object Installed) { $roles += 'IIS' }
    if (Get-WindowsFeature FS-FileServer     -EA Stop | Where-Object Installed) { $roles += 'FileServer' }
} catch {}

# --- Erweiterte Metadaten ---
# Defender (auf Servern optional)
$defenderRT = $null
try { $defenderRT = (Get-MpComputerStatus -ErrorAction Stop).RealTimeProtectionEnabled } catch {}

# BitLocker
$bitlockerStatus = $null
try {
    $bl = Get-BitLockerVolume -MountPoint "C:" -ErrorAction Stop
    $bitlockerStatus = if ($bl.ProtectionStatus -eq 'On') { 'On' } else { 'Off' }
} catch {}

# Energieplan
$powerPlan = $null
try {
    $ppOutput = powercfg /getactivescheme 2>$null
    if ($ppOutput -match '\((.+)\)') { $powerPlan = $matches[1] }
} catch {}

# RAM belegt
$ramUsedGB = $null
try { $ramUsedGB = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1) } catch {}

# BIOS
$biosDate = $null
try { $biosDate = (Get-CimInstance Win32_BIOS).ReleaseDate.ToString("yyyy-MM-dd") } catch {}

# Autostart-Anzahl
$autostartCount = $null
try { $autostartCount = (Get-CimInstance Win32_StartupCommand -ErrorAction Stop | Measure-Object).Count } catch {}

$metadata = @{
    ComputerName       = $env:COMPUTERNAME
    CollectedAt        = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    CollectedBy        = $env:USERNAME
    CollectorType      = "WindowsServer"
    CollectorVersion   = "1.3"
    HoursCollected     = $Hours
    TimeRangeLabel     = $HoursLabel
    OS                 = "$($os.Caption) Build $($os.BuildNumber)"
    BuildNumber        = $os.BuildNumber
    Architecture       = $os.OSArchitecture
    CPU                = $proc.Name
    RAM_GB             = [math]::Round($cs.TotalPhysicalMemory/1GB,1)
    RAM_Used_GB        = $ramUsedGB
    Uptime_Hours       = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours,1)
    LastBoot           = $os.LastBootUpTime.ToString("yyyy-MM-ddTHH:mm:ss")
    Disks              = $disks
    Domain             = $cs.Domain
    DetectedRoles      = $roles
    DefenderRealtime   = $defenderRT
    BitLockerStatus    = $bitlockerStatus
    PowerPlan          = $powerPlan
    BIOSDate           = $biosDate
    AutostartCount     = $autostartCount
}

$Output = @{
    Metadata = $metadata
    Summary  = $Summary
    Events   = ($Results | Sort-Object TimeCreated -Descending)
}

$Output | ConvertTo-Json -Depth 10 | Out-File -FilePath $OutputPath -Encoding UTF8

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "              Sammlung abgeschlossen                  " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Gesamt:          $($Summary.Total) Ereignisse"    -ForegroundColor White
Write-Host "  Kritisch:        $($Summary.Critical)"            -ForegroundColor Red
Write-Host "  Fehler:          $($Summary.Error)"               -ForegroundColor Red
Write-Host "  Warnungen:       $($Summary.Warning)"             -ForegroundColor Yellow
if ($roles.Count -gt 0) {
    Write-Host "  Erkannte Rollen: $($roles -join ', ')"        -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Datei gespeichert unter:" -ForegroundColor Green
Write-Host "  $OutputPath"              -ForegroundColor Cyan
Write-Host ""
Write-Host "  Jetzt auf AdminSheet hochladen:" -ForegroundColor Gray
Write-Host "  https://jluenthus.github.io/support.sheet/eventlog.html" -ForegroundColor Gray
Write-Host ""

Start-Process explorer.exe -ArgumentList "/select,`"$OutputPath`""
