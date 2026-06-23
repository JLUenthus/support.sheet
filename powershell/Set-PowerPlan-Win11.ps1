# ============================================================
# Set-PowerSettings-Interactive.ps1
# Interaktive Konfiguration von Energie- und Adaptereinstellungen
# Führe als Administrator aus!
# ============================================================

function Show-Header {
    Clear-Host
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Power & Display Einstellungen — Interaktiv" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Read-Timeout {
    param([string]$Prompt, [int]$Default)
    Write-Host "  $Prompt" -ForegroundColor Yellow
    Write-Host "  [Enter] = $Default Minuten beibehalten, oder Wert eingeben (0 = niemals):" -ForegroundColor DarkGray
    $inp = Read-Host "  >> "
    if ([string]::IsNullOrWhiteSpace($inp)) { return $Default }
    $val = 0
    if ([int]::TryParse($inp, [ref]$val)) { return $val }
    Write-Host "  Ungültige Eingabe, verwende Standard ($Default)." -ForegroundColor Red
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

# -------------------------------------------------------
# Schritt 1 — Gerätetyp
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 1 — Gerätetyp" -ForegroundColor White
Write-Host ""
Write-Host "  [1]  Desktop" -ForegroundColor Green
Write-Host "  [2]  Laptop" -ForegroundColor Green
Write-Host ""
do { $deviceType = Read-Host "  Auswahl (1 oder 2)" } until ($deviceType -eq "1" -or $deviceType -eq "2")

$isLaptop    = ($deviceType -eq "2")
$deviceLabel = if ($isLaptop) { "Laptop" } else { "Desktop" }

# -------------------------------------------------------
# Schritt 2 — Timeout-Werte
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 2 — Timeout-Werte für: $deviceLabel" -ForegroundColor White
Write-Host ""

if ($isLaptop) {
    Write-Host "  --- Netzbetrieb (AC) ---" -ForegroundColor Cyan
    $monitorAC = Read-Timeout -Prompt "Bildschirm ausschalten nach X Minuten (Netzbetrieb)" -Default 15
    $standbyAC = Read-Timeout -Prompt "Standby nach X Minuten (Netzbetrieb)" -Default 30
    Write-Host ""
    Write-Host "  --- Akkubetrieb (DC) ---" -ForegroundColor Cyan
    $monitorDC = Read-Timeout -Prompt "Bildschirm ausschalten nach X Minuten (Akkubetrieb)" -Default 5
    $standbyDC = Read-Timeout -Prompt "Standby nach X Minuten (Akkubetrieb)" -Default 15
} else {
    $monitorAC = Read-Timeout -Prompt "Bildschirm ausschalten nach X Minuten" -Default 15
    $standbyAC = Read-Timeout -Prompt "Standby nach X Minuten (0 = deaktiviert empfohlen für Desktops)" -Default 0
    $monitorDC = $monitorAC
    $standbyDC = $standbyAC
}

# -------------------------------------------------------
# Schritt 3 — Adapter: Energiesparmodus
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 3 — Netzwerkadapter: Energiesparmodus" -ForegroundColor White
Write-Host ""
Show-Info "Windows erlaubt es, Netzwerkadapter bei Inaktivität abzuschalten, um Energie zu sparen."
Show-Info "Das kann dazu führen, dass Netzlaufwerke, VPN-Verbindungen oder RDP-Sessions"
Show-Info "unerwartet getrennt werden — besonders nach kurzer Inaktivität des Nutzers."
if ($isLaptop) {
    Show-Info "Auf Laptops kostet das etwas Akku, ist aber für stabile Netzwerkverbindungen empfohlen."
} else {
    Show-Info "Auf Desktops gibt es keinen Nachteil — Empfehlung: deaktivieren."
}
Write-Host ""
$setAdapterPower = Ask-YesNo -Prompt "Energiesparmodus aller Netzwerkadapter deaktivieren?"

# -------------------------------------------------------
# Schritt 4 — Wake-on-LAN
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 4 — Wake-on-LAN (WoL)" -ForegroundColor White
Write-Host ""
Show-Info "Wake-on-LAN erlaubt es, einen PC per Netzwerkpaket aus dem Standby aufzuwecken."
Show-Info "Nützlich wenn Fernwartung oder automatische Updates im ausgeschalteten Zustand"
Show-Info "gewünscht sind (z.B. nachts per RMM-Tool starten)."
Show-Info "Wenn WoL nicht genutzt wird, kann es deaktiviert werden — reduziert"
Show-Info "ungewolltes Aufwachen aus dem Standby durch Broadcast-Traffic im Netz."
if ($isLaptop) {
    Show-Info "Auf Laptops ist WoL oft irrelevant, da das Gerät selten im Standby am Netz hängt."
}
Write-Host ""
$disableWoL = Ask-YesNo -Prompt "Wake-on-LAN deaktivieren?"

# -------------------------------------------------------
# Schritt 5 — Schnellstart
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 5 — Schnellstart (Fast Startup)" -ForegroundColor White
Write-Host ""
Show-Info "Der Windows-Schnellstart lässt den PC beim Herunterfahren den Kernel-Zustand"
Show-Info "auf die Festplatte sichern (Hybrid-Ruhezustand). Das verkürzt die Bootzeit,"
Show-Info "kann aber dazu führen, dass Windows-Updates nicht korrekt abgeschlossen werden,"
Show-Info "GPOs nicht sauber greifen oder Treiber sich nicht vollständig zurücksetzen."
Show-Info "In Unternehmensumgebungen mit GPO/Domain-Join: Empfehlung deaktivieren."
if ($isLaptop) {
    Show-Info "Auf Laptops kann das Deaktivieren die Bootzeit spürbar verlängern."
}
Write-Host ""
$disableFastBoot = Ask-YesNo -Prompt "Schnellstart deaktivieren?"

# -------------------------------------------------------
# Schritt 6 — Netzwerk im Standby aktiv halten
# -------------------------------------------------------
Show-Header
Write-Host "  Schritt 6 — Netzwerk im Standby aktiv halten" -ForegroundColor White
Write-Host ""
Show-Info "Windows kann Netzwerkadapter im Standby aktiv lassen, damit z.B. VPN-Verbindungen"
Show-Info "oder Monitoring-Agents (RMM, Backup) auch bei inaktivem Gerät erreichbar bleiben."
Show-Info "Relevant wenn VPN-Clients wie FortiClient oder AnyConnect genutzt werden,"
Show-Info "die eine persistente Verbindung benötigen."
if ($isLaptop) {
    Show-Info "Auf Laptops erhöht das den Akkuverbrauch im Standby spürbar."
}
Write-Host ""
$keepNetInStandby = Ask-YesNo -Prompt "Netzwerk im Standby aktiv halten?"

# -------------------------------------------------------
# Zusammenfassung
# -------------------------------------------------------
Show-Header
Write-Host "  Zusammenfassung — Bitte prüfen" -ForegroundColor White
Write-Host ""
Write-Host "  Gerätetyp         : $deviceLabel" -ForegroundColor White

if ($isLaptop) {
    Write-Host ""
    Write-Host "  Netzbetrieb (AC)" -ForegroundColor Cyan
    Write-Host "    Bildschirm      : $(if ($monitorAC -eq 0) { 'Niemals' } else { "$monitorAC Minuten" })" -ForegroundColor White
    Write-Host "    Standby         : $(if ($standbyAC -eq 0) { 'Niemals' } else { "$standbyAC Minuten" })" -ForegroundColor White
    Write-Host ""
    Write-Host "  Akkubetrieb (DC)" -ForegroundColor Cyan
    Write-Host "    Bildschirm      : $(if ($monitorDC -eq 0) { 'Niemals' } else { "$monitorDC Minuten" })" -ForegroundColor White
    Write-Host "    Standby         : $(if ($standbyDC -eq 0) { 'Niemals' } else { "$standbyDC Minuten" })" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "    Bildschirm      : $(if ($monitorAC -eq 0) { 'Niemals' } else { "$monitorAC Minuten" })" -ForegroundColor White
    Write-Host "    Standby         : $(if ($standbyAC -eq 0) { 'Niemals (deaktiviert)' } else { "$standbyAC Minuten" })" -ForegroundColor White
}

Write-Host ""
Write-Host "  Adapter Energiesparmodus deaktivieren : $(if ($setAdapterPower)  { 'Ja' } else { 'Nein' })" -ForegroundColor White
Write-Host "  Wake-on-LAN deaktivieren              : $(if ($disableWoL)       { 'Ja' } else { 'Nein' })" -ForegroundColor White
Write-Host "  Schnellstart deaktivieren             : $(if ($disableFastBoot)  { 'Ja' } else { 'Nein' })" -ForegroundColor White
Write-Host "  Netzwerk im Standby aktiv halten      : $(if ($keepNetInStandby) { 'Ja' } else { 'Nein' })" -ForegroundColor White

Write-Host ""
Write-Host "  Einstellungen jetzt anwenden? (j/n)" -ForegroundColor Yellow
$confirm = Read-Host "  >> "

if ($confirm -ne "j") {
    Write-Host ""
    Write-Host "  Abgebrochen. Keine Änderungen vorgenommen." -ForegroundColor Red
    exit
}

# -------------------------------------------------------
# Anwenden
# -------------------------------------------------------
Write-Host ""
Write-Host "  Wende Einstellungen an..." -ForegroundColor Cyan
Write-Host ""

$highPerfGuid = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
powercfg -duplicatescheme $highPerfGuid 2>&1 | Out-Null
powercfg -setactive $highPerfGuid
Write-Host "  [OK] Energieprofil: Höchstleistung aktiviert" -ForegroundColor Green

powercfg -change -monitor-timeout-ac $monitorAC
Write-Host "  [OK] Bildschirm-Timeout (AC): $monitorAC Min" -ForegroundColor Green
powercfg -change -monitor-timeout-dc $monitorDC
if ($isLaptop) { Write-Host "  [OK] Bildschirm-Timeout (DC): $monitorDC Min" -ForegroundColor Green }

powercfg -change -standby-timeout-ac $standbyAC
Write-Host "  [OK] Standby-Timeout (AC): $standbyAC Min" -ForegroundColor Green
powercfg -change -standby-timeout-dc $standbyDC
if ($isLaptop) { Write-Host "  [OK] Standby-Timeout (DC): $standbyDC Min" -ForegroundColor Green }

if ($keepNetInStandby) {
    $netSubGuid   = "19cbb8fa-5279-450e-9fac-8a3d5fedd0c1"
    $netSettingOn = "12bbebe6-58d6-4636-95bb-3217ef867c1a"
    powercfg -setacvalueindex $highPerfGuid $netSubGuid $netSettingOn 0
    powercfg -setdcvalueindex $highPerfGuid $netSubGuid $netSettingOn 0
    Write-Host "  [OK] Netzwerk im Standby: aktiv bleiben" -ForegroundColor Green
}

if ($disableFastBoot) {
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" `
        -Name HiberbootEnabled -Value 0 -Type DWord
    Write-Host "  [OK] Schnellstart deaktiviert" -ForegroundColor Green
}

if ($setAdapterPower) {
    Get-NetAdapter | ForEach-Object {
        $adapter = $_
        try {
            $pnpDevice = Get-PnpDevice -FriendlyName $adapter.InterfaceDescription -EA Stop
            $devPath   = "HKLM:\SYSTEM\CurrentControlSet\Enum\$($pnpDevice.InstanceId)\Device Parameters"
            if (Test-Path $devPath) {
                Set-ItemProperty -Path $devPath -Name AllowIdleIrpInD3 -Value 0 -Type DWord -EA SilentlyContinue
            }
            $wmi = Get-WmiObject MSPower_DeviceEnable -Namespace root\wmi -EA Stop |
                   Where-Object { $_.InstanceName -like "*$($pnpDevice.InstanceId)*" }
            if ($wmi) { $wmi.Enable = $false; $wmi.Put() | Out-Null }
            Write-Host "  [OK] Adapter '$($adapter.Name)': Energiesparmodus deaktiviert" -ForegroundColor Green
        } catch {
            Write-Host "  [!] Adapter '$($adapter.Name)': Kein WMI-Eintrag (übersprungen)" -ForegroundColor Yellow
        }
    }
}

if ($disableWoL) {
    Get-NetAdapter | ForEach-Object {
        Disable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket -WakeOnPattern -EA SilentlyContinue
        Write-Host "  [OK] Wake-on-LAN deaktiviert: $($_.Name)" -ForegroundColor Green
    }
}

powercfg -setactive $highPerfGuid

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  [FERTIG] Alle Einstellungen wurden erfolgreich gesetzt." -ForegroundColor Cyan
Write-Host "  Bitte einmal neu starten, um alle Adapter-Einstellungen" -ForegroundColor Cyan
Write-Host "  vollständig zu übernehmen." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
