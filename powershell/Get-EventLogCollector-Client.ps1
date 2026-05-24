#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Event Log Collector fuer Windows 11 Clients - AdminSheet Event Log Analyzer
.DESCRIPTION
    Sammelt relevante Event Logs eines Windows 11 Clients und exportiert sie
    als strukturierte JSON-Datei fuer den AdminSheet Event Log Analyzer.
.PARAMETER Hours
    Zeitraum in Stunden (Standard: 24). Max: 168 (7 Tage)
.PARAMETER OutputPath
    Speicherort der JSON-Datei. Standard: Desktop
.EXAMPLE
    .\Get-EventLogCollector-Client.ps1
    .\Get-EventLogCollector-Client.ps1 -Hours 48
    .\Get-EventLogCollector-Client.ps1 -Hours 72 -OutputPath "C:\Temp\logs.json"
.NOTES
    Autor: AdminSheet | Version: 1.1
    Benoetigt: PowerShell 5.1+, Admin-Rechte fuer Security-Log
    Kompatibel: Windows 10/11
#>
param(
    [ValidateRange(1,168)][int]$Hours = 24,
    [string]$OutputPath = "$env:USERPROFILE\Desktop\EventLog_Client_$(Get-Date -Format 'yyyyMMdd_HHmm').json"
)

$ErrorActionPreference = 'SilentlyContinue'
$StartTime = (Get-Date).AddHours(-$Hours)
$Results   = @()
$Summary   = @{ Critical=0; Error=0; Warning=0; Info=0; Total=0 }

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   AdminSheet - Event Log Collector (Windows Client)  " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Zeitraum: Letzte $Hours Stunden" -ForegroundColor Gray
Write-Host "  Von:      $($StartTime.ToString('dd.MM.yyyy HH:mm'))" -ForegroundColor Gray
Write-Host "  Bis:      $(Get-Date -Format 'dd.MM.yyyy HH:mm')" -ForegroundColor Gray
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
        if ($msg.Length -gt 300) { $msg = $msg.Substring(0,300) }
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

# --- Abstauerze und Neustarts ---
Write-Host "[1] Abstauerze und Neustarts" -ForegroundColor Yellow
Collect-Events 'System'      @(41)            @(1)      'Kernel-Power (ungeplanter Neustart)'  'Absturz'
Collect-Events 'System'      @(1001,1002)     @(2,3)    'Windows Error Reporting'              'Absturz'
Collect-Events 'System'      @(6008)          $null     'Unerwartetes Herunterfahren'           'Absturz'
Collect-Events 'Application' @(1000,1001,1002) @(2,3)  'Anwendungsabsturz/-haenger'           'Absturz'

# --- System und Treiber ---
Write-Host "[2] System und Treiber" -ForegroundColor Yellow
Collect-Events 'System' @(7000,7001,7009,7011,7023,7024,7031,7034) @(1,2,3) 'Dienst-Fehler'              'System'
Collect-Events 'System' @(219,257)           $null     'Treiber konnte nicht geladen werden'  'System'
Collect-Events 'System' @(55,98,153)         $null     'Datensystem Fehler'                   'System'
Collect-Events 'System' @(2004,2013,2019,2020) $null   'Speicher/Pool Fehler'                 'System'
Collect-Events 'System' @(1,3,6,7,14,15)    @(1,2)    'Kritische Systemfehler'               'System'

# --- Netzwerk und WLAN ---
Write-Host "[3] Netzwerk und WLAN" -ForegroundColor Yellow
Collect-Events 'System' @(10317,10314,10315) $null     'WLAN-AutoConfig Verbindungsverlust'   'Netzwerk'
Collect-Events 'System' @(4199,4200)         $null     'IP-Konflikte'                         'Netzwerk'
Collect-Events 'System' @(1014)              $null     'DNS-Auflosung fehlgeschlagen'          'Netzwerk'
Collect-Events 'System' @(5719,5722)         $null     'Domaenen-Netzwerkanmeldung Fehler'    'Netzwerk'
Collect-Events 'Microsoft-Windows-NetworkProfile/Operational' @(10000,10001) $null 'Netzwerkprofil geaendert' 'Netzwerk'

# --- Energie und Standby ---
Write-Host "[4] Energie und Standby" -ForegroundColor Yellow
Collect-Events 'System' @(566,570)           $null     'Energieverwaltung Fehler'             'Energie'
Collect-Events 'Microsoft-Windows-Power-Troubleshooter/Operational' @(1) $null 'Standby/Resume Probleme' 'Energie'

# --- Hardware ---
Write-Host "[5] Hardware" -ForegroundColor Yellow
Collect-Events 'System' @(9,11,51,52)        $null     'Festplatten/Disk Fehler'              'Hardware'
Collect-Events 'System' @(43)                $null     'USB Geraet nicht erkannt'             'Hardware'

# --- Sicherheit ---
Write-Host "[6] Sicherheit" -ForegroundColor Yellow
Collect-Events 'Security' @(4625,4740)       $null     'Anmeldung fehlgeschlagen / Konto gesperrt' 'Sicherheit'
Collect-Events 'Security' @(4648)            $null     'Anmeldung mit expliziten Anmeldedaten'     'Sicherheit'

# --- Windows Update ---
Write-Host "[7] Windows Update" -ForegroundColor Yellow
Collect-Events 'System' @(20,24,25,31,34,35) @(2,3)   'Windows Update Fehler'               'Update'
Collect-Events 'Setup'   $null               @(2)      'Setup Fehler'                         'Update'

# --- Metadaten ---
Write-Host ""
Write-Host "[i] Systeminformationen sammeln..." -ForegroundColor Yellow
$os   = Get-CimInstance Win32_OperatingSystem
$cs   = Get-CimInstance Win32_ComputerSystem
$proc = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,
    @{N="Size_GB";E={[math]::Round($_.Size/1GB,1)}},
    @{N="Free_GB";E={[math]::Round($_.FreeSpace/1GB,1)}}

$metadata = @{
    ComputerName     = $env:COMPUTERNAME
    CollectedAt      = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    CollectedBy      = $env:USERNAME
    CollectorType    = "Windows11-Client"
    CollectorVersion = "1.1"
    HoursCollected   = $Hours
    OS               = "$($os.Caption) Build $($os.BuildNumber)"
    Architecture     = $os.OSArchitecture
    CPU              = $proc.Name
    RAM_GB           = [math]::Round($cs.TotalPhysicalMemory/1GB,1)
    Uptime_Hours     = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours,1)
    LastBoot         = $os.LastBootUpTime.ToString("yyyy-MM-ddTHH:mm:ss")
    Disks            = $disk
    Domain           = $cs.Domain
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
Write-Host "  Gesamt:    $($Summary.Total) Ereignisse"    -ForegroundColor White
Write-Host "  Kritisch:  $($Summary.Critical)"            -ForegroundColor Red
Write-Host "  Fehler:    $($Summary.Error)"               -ForegroundColor Red
Write-Host "  Warnungen: $($Summary.Warning)"             -ForegroundColor Yellow
Write-Host ""
Write-Host "  Datei gespeichert:" -ForegroundColor Green
Write-Host "  $OutputPath"        -ForegroundColor Cyan
Write-Host ""
Write-Host "  Jetzt auf AdminSheet hochladen:" -ForegroundColor Gray
Write-Host "  https://jluenthus.github.io/Cheatsheet/eventlog.html" -ForegroundColor Gray
Write-Host ""

Start-Process explorer.exe -ArgumentList "/select,`"$OutputPath`""
