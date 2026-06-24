# ============================================================
# Set-PowerSettings-Interactive.ps1
# Interaktive Konfiguration von Energie- und Adaptereinstellungen
# Als Administrator ausfuehren!
# ============================================================

function Show-Header {
    Clear-Host
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Power und Display Einstellungen" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Read-Timeout {
    param([string]$Prompt, [int]$Default)
    Write-Host "  $Prompt" -ForegroundColor Yellow
    Write-Host "  [Enter] = $Default Minuten (Standard), oder Wert eingeben (0 = niemals):" -ForegroundColor DarkGray
    $inp = Read-Host "  >> "
    if ([string]::IsNullOrWhiteSpace($inp)) { return $Default }
    $val = 0
    if ([int]::TryParse($inp, [ref]$val)) { return $val }
    Write-Host "  Ungueltige Eingabe, verwende Standard ($Default)." -ForegroundColor Red
    return $Default
}

function Ask-YesNo {
    param([string]$Prompt)
    do {
        $ans = Read-Host "  $Prompt (j/n)"
    } until ($ans -eq "j" -or $ans -eq "n")
    return ($ans -eq "j")
}

function Show-Info {
    param([string]$Text)
    Write-Host "  INFO: $Text" -ForegroundColor DarkCyan
}

function Show-Sep {
    Write-Host "  ------------------------------------------------------------" -ForegroundColor DarkGray
}

# -------------------------------------------------------
# Schritt 1 - Geraetetyp
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 1 - Geraetetyp" -ForegroundColor White
Write-Host ""
Write-Host "  [1]  Desktop" -ForegroundColor Green
Write-Host "  [2]  Laptop" -ForegroundColor Green
Write-Host ""
do {
    $deviceType = Read-Host "  Auswahl"
} until ($deviceType -eq "1" -or $deviceType -eq "2")

$isLaptop    = ($deviceType -eq "2")
$deviceLabel = if ($isLaptop) { "Laptop" } else { "Desktop" }

# -------------------------------------------------------
# Schritt 2 - Timeout-Werte
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 2 - Timeout-Werte fuer: $deviceLabel" -ForegroundColor White
Write-Host ""

if ($isLaptop) {
    Write-Host "  Netzbetrieb (AC)" -ForegroundColor Cyan
    $monitorAC = Read-Timeout -Prompt "Bildschirm ausschalten nach X Minuten (Netzbetrieb)" -Default 15
    $standbyAC = Read-Timeout -Prompt "Standby nach X Minuten (Netzbetrieb)" -Default 30
    Write-Host ""
    Write-Host "  Akkubetrieb (DC)" -ForegroundColor Cyan
    $monitorDC = Read-Timeout -Prompt "Bildschirm ausschalten nach X Minuten (Akkubetrieb)" -Default 5
    $standbyDC = Read-Timeout -Prompt "Standby nach X Minuten (Akkubetrieb)" -Default 15
} else {
    $monitorAC = Read-Timeout -Prompt "Bildschirm ausschalten nach X Minuten" -Default 15
    $standbyAC = Read-Timeout -Prompt "Standby nach X Minuten (0 = deaktiviert)" -Default 0
    $monitorDC = $monitorAC
    $standbyDC = $standbyAC
}

# -------------------------------------------------------
# Schritt 3 - Adapter Energiesparmodus
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 3 - Netzwerkadapter: Energiesparmodus" -ForegroundColor White
Write-Host ""
Show-Info "Windows darf Netzwerkadapter bei Inaktivitaet abschalten um Strom zu sparen."
Show-Info "Das kann dazu fuehren, dass Netzlaufwerke, VPN oder RDP-Sessions"
Show-Info "unerwartet getrennt werden - besonders nach kurzer Inaktivitaet."
if ($isLaptop) {
    Show-Info "Auf Laptops kostet das etwas Akku, ist aber fuer stabile Verbindungen empfohlen."
} else {
    Show-Info "Auf Desktops gibt es keinen Nachteil - Empfehlung: deaktivieren."
}
Write-Host ""
$setAdapterPower = Ask-YesNo -Prompt "Energiesparmodus aller Netzwerkadapter deaktivieren?"

# -------------------------------------------------------
# Schritt 4 - Wake-on-LAN
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 4 - Wake-on-LAN (WoL)" -ForegroundColor White
Write-Host ""
Show-Info "Wake-on-LAN erlaubt es, einen PC per Netzwerkpaket aus dem Standby aufzuwecken."
Show-Info "Nuetzlich wenn Fernwartung oder automatische Updates im Standby benoetigt werden."
Show-Info "Wenn WoL nicht genutzt wird: deaktivieren, da Broadcast-Traffic im Netz"
Show-Info "sonst ungewollt den Standby unterbrechen kann."
if ($isLaptop) {
    Show-Info "Auf Laptops ist WoL meist irrelevant, da das Geraet selten im Standby am Netz haengt."
}
Write-Host ""
$disableWoL = Ask-YesNo -Prompt "Wake-on-LAN deaktivieren?"

# -------------------------------------------------------
# Schritt 5 - Schnellstart
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 5 - Schnellstart (Fast Startup)" -ForegroundColor White
Write-Host ""
Show-Info "Der Schnellstart speichert beim Herunterfahren den Kernel-Zustand (Hybrid-Ruhezustand)."
Show-Info "Das verkuerzt die Bootzeit, kann aber dazu fuehren dass Windows-Updates nicht"
Show-Info "korrekt abgeschlossen werden oder GPOs nicht sauber greifen."
Show-Info "In Domain-Umgebungen: Empfehlung deaktivieren."
if ($isLaptop) {
    Show-Info "Auf Laptops verlaengert das Deaktivieren die Bootzeit spuerbar."
}
Write-Host ""
$disableFastBoot = Ask-YesNo -Prompt "Schnellstart deaktivieren?"

# -------------------------------------------------------
# Schritt 6 - Netzwerk im Standby
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 6 - Netzwerk im Standby aktiv halten" -ForegroundColor White
Write-Host ""
Show-Info "Windows kann Netzwerkadapter im Standby aktiv lassen, damit VPN-Verbindungen"
Show-Info "oder Monitoring-Agents (RMM, Backup) auch bei inaktivem Geraet erreichbar bleiben."
Show-Info "Relevant wenn VPN-Clients wie FortiClient oder AnyConnect genutzt werden."
if ($isLaptop) {
    Show-Info "Auf Laptops erhoeht das den Akkuverbrauch im Standby spuerbar."
}
Write-Host ""
$keepNetInStandby = Ask-YesNo -Prompt "Netzwerk im Standby aktiv halten?"

# -------------------------------------------------------
# Zusammenfassung
# -------------------------------------------------------
Show-Header
Write-Host "  Zusammenfassung - Bitte pruefen" -ForegroundColor White
Write-Host ""
Write-Host "  Geraetetyp              : $deviceLabel" -ForegroundColor White

if ($isLaptop) {
    Write-Host ""
    Write-Host "  Netzbetrieb (AC)" -ForegroundColor Cyan
    Write-Host "    Bildschirm          : $(if ($monitorAC -eq 0) { 'Niemals' } else { "$monitorAC Minuten" })" -ForegroundColor White
    Write-Host "    Standby             : $(if ($standbyAC -eq 0) { 'Niemals' } else { "$standbyAC Minuten" })" -ForegroundColor White
    Write-Host ""
    Write-Host "  Akkubetrieb (DC)" -ForegroundColor Cyan
    Write-Host "    Bildschirm          : $(if ($monitorDC -eq 0) { 'Niemals' } else { "$monitorDC Minuten" })" -ForegroundColor White
    Write-Host "    Standby             : $(if ($standbyDC -eq 0) { 'Niemals' } else { "$standbyDC Minuten" })" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "    Bildschirm          : $(if ($monitorAC -eq 0) { 'Niemals' } else { "$monitorAC Minuten" })" -ForegroundColor White
    Write-Host "    Standby             : $(if ($standbyAC -eq 0) { 'Niemals (deaktiviert)' } else { "$standbyAC Minuten" })" -ForegroundColor White
}

Write-Host ""
Show-Sep
Write-Host "  Adapter Energiesparmodus deaktivieren : $(if ($setAdapterPower)  { 'Ja' } else { 'Nein' })" -ForegroundColor White
Write-Host "  Wake-on-LAN deaktivieren              : $(if ($disableWoL)       { 'Ja' } else { 'Nein' })" -ForegroundColor White
Write-Host "  Schnellstart deaktivieren             : $(if ($disableFastBoot)  { 'Ja' } else { 'Nein' })" -ForegroundColor White
Write-Host "  Netzwerk im Standby aktiv halten      : $(if ($keepNetInStandby) { 'Ja' } else { 'Nein' })" -ForegroundColor White
Show-Sep
Write-Host ""
$confirm = Ask-YesNo -Prompt "Einstellungen jetzt anwenden?"

if (-not $confirm) {
    Write-Host ""
    Write-Host "  Abgebrochen. Keine Aenderungen vorgenommen." -ForegroundColor Red
    exit
}

# -------------------------------------------------------
# Anwenden
# -------------------------------------------------------
Write-Host ""
Write-Host "  Wende Einstellungen an..." -ForegroundColor Cyan
Write-Host ""

# Hoechstleistung aktivieren
$highPerfGuid = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
powercfg -duplicatescheme $highPerfGuid 2>&1 | Out-Null
powercfg -setactive $highPerfGuid
Write-Host "  [OK] Energieprofil: Hoechstleistung aktiviert" -ForegroundColor Green

# Bildschirm-Timeout
powercfg -change -monitor-timeout-ac $monitorAC
Write-Host "  [OK] Bildschirm-Timeout AC: $monitorAC Min" -ForegroundColor Green
powercfg -change -monitor-timeout-dc $monitorDC
if ($isLaptop) { Write-Host "  [OK] Bildschirm-Timeout DC: $monitorDC Min" -ForegroundColor Green }

# Standby-Timeout
powercfg -change -standby-timeout-ac $standbyAC
Write-Host "  [OK] Standby-Timeout AC: $standbyAC Min" -ForegroundColor Green
powercfg -change -standby-timeout-dc $standbyDC
if ($isLaptop) { Write-Host "  [OK] Standby-Timeout DC: $standbyDC Min" -ForegroundColor Green }

# Netzwerk im Standby
if ($keepNetInStandby) {
    $netSubGuid   = "19cbb8fa-5279-450e-9fac-8a3d5fedd0c1"
    $netSettingOn = "12bbebe6-58d6-4636-95bb-3217ef867c1a"
    powercfg -setacvalueindex $highPerfGuid $netSubGuid $netSettingOn 0
    powercfg -setdcvalueindex $highPerfGuid $netSubGuid $netSettingOn 0
    Write-Host "  [OK] Netzwerk im Standby: aktiv" -ForegroundColor Green
}

# Schnellstart deaktivieren
if ($disableFastBoot) {
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" `
        -Name HiberbootEnabled -Value 0 -Type DWord
    Write-Host "  [OK] Schnellstart deaktiviert" -ForegroundColor Green
}

# Adapter Energiesparmodus deaktivieren
if ($setAdapterPower) {
    Get-NetAdapter | ForEach-Object {
        $adapter = $_
        try {
            $pnpDevice = Get-PnpDevice -FriendlyName $adapter.InterfaceDescription -ErrorAction Stop
            $devPath   = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($pnpDevice.InstanceId)\Device Parameters"
            if (Test-Path $devPath) {
                Set-ItemProperty -Path $devPath -Name AllowIdleIrpInD3 -Value 0 -Type DWord -ErrorAction SilentlyContinue
            }
            $wmi = Get-WmiObject MSPower_DeviceEnable -Namespace root\wmi -ErrorAction Stop |
                   Where-Object { $_.InstanceName -like "*$($pnpDevice.InstanceId)*" }
            if ($wmi) { $wmi.Enable = $false; $wmi.Put() | Out-Null }
            Write-Host "  [OK] Adapter '$($adapter.Name)': Energiesparmodus deaktiviert" -ForegroundColor Green
        } catch {
            Write-Host "  [!] Adapter '$($adapter.Name)': kein WMI-Eintrag (uebersprungen)" -ForegroundColor Yellow
        }
    }
}

# Wake-on-LAN deaktivieren
if ($disableWoL) {
    Get-NetAdapter | ForEach-Object {
        Disable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket -WakeOnPattern -ErrorAction SilentlyContinue
        Write-Host "  [OK] WoL deaktiviert: $($_.Name)" -ForegroundColor Green
    }
}

powercfg -setactive $highPerfGuid

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  FERTIG - Alle Einstellungen wurden gesetzt." -ForegroundColor Cyan
Write-Host "  Bitte neu starten, damit alle Adapter-Einstellungen" -ForegroundColor Cyan
Write-Host "  vollstaendig uebernommen werden." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
