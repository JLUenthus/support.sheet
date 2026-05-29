#Requires -Version 3.0
<#
.SYNOPSIS
    Exchange Pre-Shutdown Preflight Check
    Exchange 2016 / 2019 – Exchange Management Shell

.DESCRIPTION
    Prueft vor einem Exchange-Server-Neustart ob alle Voraussetzungen erfuellt sind.
    Zeigt Mail-Queues, Datenbankstatus, DAG-Gesundheit und aktive Verbindungen.
    Mit -ApplyMaintenance wird der Wartungsmodus automatisch gesetzt – 
    aber nur wenn alle Checks bestanden sind.

.USAGE
    .\Exchange-PreflightCheck.ps1
    .\Exchange-PreflightCheck.ps1 -Server EXCHSRV01
    .\Exchange-PreflightCheck.ps1 -Server EXCHSRV01 -DAGName DAG01
    .\Exchange-PreflightCheck.ps1 -Server EXCHSRV01 -DAGName DAG01 -ApplyMaintenance

.PARAMETER Server
    Name des zu pruefenden Exchange-Servers. Standard: lokaler Computer.

.PARAMETER DAGName
    Name der Database Availability Group (optional). 
    Wenn angegeben werden DAG-Mitglieder und Quorum-Status geprueft.

.PARAMETER ApplyMaintenance
    Wenn gesetzt: Wartungsmodus aktivieren nach bestandenen Checks.
    Ohne diesen Parameter: nur lesen, kein Eingriff.

.NOTES
    Muss in der Exchange Management Shell (EMS) ausgefuehrt werden.
    Oder: Add-PSSnapin Microsoft.Exchange.Management.PowerShell.SnapIn
#>

param(
    [string]$Server           = $env:COMPUTERNAME,
    [string]$DAGName          = "",
    [switch]$ApplyMaintenance
)

# ── Globale Zaehler ──────────────────────────────────────────
$script:WarnCount = 0
$script:FailCount = 0
$script:CheckLog  = [System.Collections.Generic.List[string]]::new()

# ── Ausgabe-Hilfsfunktionen ──────────────────────────────────
function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
}

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "  ── $Text" -ForegroundColor Yellow
    Write-Host ""
}

function Write-OK {
    param([string]$Msg)
    Write-Host "  [OK]   $Msg" -ForegroundColor Green
    $script:CheckLog.Add("[OK]   $Msg")
}

function Write-WARN {
    param([string]$Msg)
    Write-Host "  [WARN] $Msg" -ForegroundColor Yellow
    $script:CheckLog.Add("[WARN] $Msg")
    $script:WarnCount++
}

function Write-FAIL {
    param([string]$Msg)
    Write-Host "  [FAIL] $Msg" -ForegroundColor Red
    $script:CheckLog.Add("[FAIL] $Msg")
    $script:FailCount++
}

function Write-INFO {
    param([string]$Msg)
    Write-Host "  [INFO] $Msg" -ForegroundColor Cyan
    $script:CheckLog.Add("[INFO] $Msg")
}

function Write-CMD {
    param([string]$Msg)
    Write-Host "         > $Msg" -ForegroundColor DarkGray
}

# ── Exchange Shell pruefen ───────────────────────────────────
function Test-ExchangeShell {
    if (-not (Get-Command Get-ExchangeServer -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "  [FEHLER] Exchange-Cmdlets nicht verfuegbar!" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Bitte in der Exchange Management Shell ausfuehren:" -ForegroundColor Yellow
        Write-Host "    Add-PSSnapin Microsoft.Exchange.Management.PowerShell.SnapIn" -ForegroundColor DarkGray
        Write-Host ""
        exit 1
    }
}

# ── Server erreichbar pruefen ────────────────────────────────
function Test-ServerReachable {
    Write-Section "0. Server-Verbindung pruefen"
    if (-not (Test-Connection -ComputerName $Server -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
        Write-FAIL "Server '$Server' nicht erreichbar (Ping fehlgeschlagen)."
        exit 1
    }
    Write-OK "Server '$Server' erreichbar."
    try {
        $info = Get-ExchangeServer $Server -ErrorAction Stop
        Write-OK "Exchange-Version: $($info.AdminDisplayVersion)"
        Write-INFO "Rollen: $($info.ServerRole)"
    }
    catch {
        Write-FAIL "Get-ExchangeServer fehlgeschlagen: $_"
    }
}

# ── 1. Serverkomponenten ─────────────────────────────────────
function Check-ServerComponents {
    Write-Section "1. Serverkomponenten-Status"
    try {
        $components = Get-ServerComponentState -Identity $Server -ErrorAction Stop
        # ForwardSyncDaemon ist im normalen Betrieb oft Inactive – kein Problem
        $inactive = $components | Where-Object {
            $_.State -ne "Active" -and
            $_.Component -notin @("ForwardSyncDaemon","ProvisionedServer")
        }
        if ($inactive) {
            Write-WARN "$($inactive.Count) Komponente(n) nicht Active:"
            $inactive | ForEach-Object { Write-CMD "$($_.Component) = $($_.State)" }
        }
        else {
            Write-OK "Alle relevanten Komponenten sind Active."
        }
    }
    catch {
        Write-FAIL "Get-ServerComponentState fehlgeschlagen: $_"
    }
}

# ── 2. Mail-Flow und Queues ──────────────────────────────────
function Check-Queues {
    Write-Section "2. Mail-Flow und Queues"

    try {
        $queues = Get-Queue -Server $Server -ErrorAction Stop
        # Poison Queue und leere Shadow-Queues ignorieren
        $nonEmpty = $queues | Where-Object {
            $_.MessageCount -gt 0 -and
            $_.Identity -notlike "*\Poison*" -and
            $_.DeliveryType -ne "ShadowRedundancy"
        }
        if ($nonEmpty) {
            Write-WARN "$($nonEmpty.Count) nicht-leere Queue(s) gefunden:"
            $nonEmpty | Select-Object Identity, Status, MessageCount, DeliveryType, NextHopDomain |
                Format-Table -AutoSize | Out-String -Width 120 |
                ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
            Write-INFO "Mails in Queues anzeigen:"
            Write-CMD  "Get-Message -Server $Server | Select Subject,Status,LastError,Queue | ft -AutoSize"
            Write-INFO "Warten bis Queues leer sind oder Mails manuell umleiten:"
            Write-CMD  "Redirect-Message -Server $Server -Target <ZielserverFQDN>"
        }
        else {
            Write-OK "Alle Mail-Queues leer – kein Mail-Flow-Verlust beim Neustart."
        }
    }
    catch {
        Write-FAIL "Get-Queue fehlgeschlagen: $_"
    }

    # Send Connectors pruefen
    try {
        $connectors = Get-SendConnector -ErrorAction Stop |
            Where-Object { ($_.SourceTransportServers | ForEach-Object { $_.Name }) -contains $Server }
        if ($connectors) {
            Write-WARN "Dieser Server ist alleinige Quelle in Send Connector(s):"
            $connectors | ForEach-Object {
                $srcNames = $_.SourceTransportServers | ForEach-Object { $_.Name }
                Write-CMD "$($_.Name) → Quellen: $($srcNames -join ', ')"
            }
            Write-INFO "Sicherstellen dass ein anderer HubTransport-Server diese Rolle uebernimmt!"
        }
        else {
            Write-OK "Keine Send Connectors exklusiv auf diesem Server konfiguriert."
        }
    }
    catch {
        Write-WARN "Send Connector-Pruefung fehlgeschlagen (nicht kritisch): $_"
    }
}

# ── 3. Datenbanken und DAG ───────────────────────────────────
function Check-Databases {
    Write-Section "3. Datenbanken und DAG"

    # Aktive Datenbanken auf diesem Server
    try {
        $allCopies = Get-MailboxDatabaseCopyStatus * -ErrorAction Stop
        $activeDbs = $allCopies | Where-Object { $_.ActiveServerName -eq $Server }
        if ($activeDbs) {
            Write-WARN "$($activeDbs.Count) Datenbank(en) noch aktiv auf $Server – vor Shutdown verschieben:"
            $activeDbs | Select-Object Name, Status, CopyQueueLength |
                Format-Table -AutoSize | Out-String -Width 120 |
                ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
            Write-CMD "Move-ActiveMailboxDatabase -Server $Server -ActivateOnServer <Zielserver>"
        }
        else {
            Write-OK "Keine aktiven Datenbanken auf $Server – bereit fuer Shutdown."
        }
    }
    catch {
        Write-FAIL "Get-MailboxDatabaseCopyStatus * fehlgeschlagen: $_"
    }

    # Kopie-Gesundheit auf diesem Server
    try {
        $copies = Get-MailboxDatabaseCopyStatus -Server $Server -ErrorAction Stop

        $unhealthy = $copies | Where-Object {
            $_.Status -notin @("Healthy","Mounted","SeedingSource","Disconnected")
        }
        if ($unhealthy) {
            Write-WARN "$($unhealthy.Count) ungesunde Datenbankkopie(n):"
            $unhealthy | Select-Object Name, Status, CopyQueueLength, ReplayQueueLength |
                Format-Table -AutoSize | Out-String -Width 120 |
                ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        }
        else {
            Write-OK "Alle Datenbankkopien in gesundem Zustand."
        }

        # Replikations-Rueckstand pruefen (Queue > 10 = bedenklich)
        $highQueue = $copies | Where-Object { $_.CopyQueueLength -gt 10 -or $_.ReplayQueueLength -gt 10 }
        if ($highQueue) {
            Write-WARN "Replikations-Rueckstand erkannt (Queue > 10):"
            $highQueue | Select-Object Name, CopyQueueLength, ReplayQueueLength |
                Format-Table -AutoSize | Out-String -Width 120 |
                ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
            Write-INFO "Vor Shutdown warten bis Queues unter 10 fallen."
        }
        else {
            Write-OK "Replikations-Queues im normalen Bereich."
        }
    }
    catch {
        Write-FAIL "Get-MailboxDatabaseCopyStatus -Server fehlgeschlagen: $_"
    }

    # DAG-Status (nur wenn -DAGName angegeben)
    if ($DAGName -ne "") {
        try {
            $dag = Get-DatabaseAvailabilityGroup $DAGName -Status -ErrorAction Stop
            Write-OK "DAG '$DAGName': $($dag.Servers.Count) Mitglieder – $($dag.Servers -join ', ')"
            Write-INFO "Operational: $($dag.OperationalServers -join ', ')"

            # Quorum pruefen: mindestens 1 anderer Server muss operational bleiben
            $otherOp = $dag.OperationalServers | Where-Object { $_ -ne $Server }
            if (-not $otherOp) {
                Write-FAIL "KEIN anderer operational Server im DAG! Shutdown wuerde Quorum brechen."
            }
            else {
                Write-OK "Quorum gesichert – $($otherOp.Count) weitere operational Server."
            }
        }
        catch {
            Write-WARN "DAG '$DAGName' konnte nicht abgefragt werden: $_"
        }
    }
}

# ── 4. Verbindungen und Dienste ──────────────────────────────
function Check-Connections {
    Write-Section "4. Aktive Verbindungen und Dienste"

    # Postfaecher auf Server
    try {
        $stats = Get-MailboxStatistics -Server $Server -ErrorAction Stop |
            Where-Object { $_.IsValid -eq $true }
        Write-INFO "Aktive Postfaecher auf diesem Server: $($stats.Count)"
    }
    catch {
        Write-WARN "Get-MailboxStatistics fehlgeschlagen (nicht kritisch)."
    }

    # Receive Connectors
    try {
        $rcv = Get-ReceiveConnector -Server $Server -ErrorAction Stop
        if ($rcv.Count -gt 0) {
            Write-INFO "$($rcv.Count) Receive Connector(s) konfiguriert:"
            $rcv | ForEach-Object {
                $status = if ($_.Enabled) { "aktiviert" } else { "deaktiviert" }
                Write-CMD "$($_.Name) [$status]"
            }
        }
    }
    catch {
        Write-WARN "Receive Connectors konnten nicht abgefragt werden."
    }

    # Kritische Exchange-Dienste pruefen
    $criticalServices = @(
        "MSExchangeTransport",
        "MSExchangeIS",
        "MSExchangeRPC",
        "MSExchangeADTopology"
    )
    $stoppedServices = @()
    foreach ($svc in $criticalServices) {
        $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
        if ($s -and $s.Status -ne "Running") { $stoppedServices += $svc }
    }
    if ($stoppedServices) {
        Write-WARN "Gestoppte Exchange-Dienste: $($stoppedServices -join ', ')"
    }
    else {
        Write-OK "Alle kritischen Exchange-Dienste laufen."
    }
}

# ── 5. Wartungsmodus aktivieren ──────────────────────────────
function Apply-MaintenanceMode {
    Write-Section "5. Wartungsmodus aktivieren"

    if ($script:FailCount -gt 0) {
        Write-Host ""
        Write-Host "  [ABBRUCH] Wartungsmodus wird NICHT gesetzt." -ForegroundColor Red
        Write-Host "            Es gibt $($script:FailCount) offene Fehler – bitte erst beheben." -ForegroundColor Red
        Write-Host ""
        return
    }

    Write-INFO "Starte Wartungsmodus-Sequenz fuer $Server ..."

    # 1. HubTransport auf Draining
    try {
        Set-ServerComponentState $Server -Component HubTransport -State Draining -Requester Maintenance
        Write-OK "HubTransport = Draining (nimmt keine neuen Mails mehr an)"
    }
    catch {
        Write-FAIL "HubTransport Draining fehlgeschlagen: $_"
        return
    }

    # 2. Mails umleiten
    Write-INFO "Mails manuell umleiten (FQDN des Zielservers anpassen):"
    Write-CMD  "Redirect-Message -Server $Server -Target <ZielserverFQDN>"
    Write-Host ""
    Write-Host "  Warte auf manuelle Bestaetigung..." -ForegroundColor Yellow
    Write-Host "  Druecke ENTER wenn Mails umgeleitet wurden (oder STRG+C zum Abbrechen):" -ForegroundColor Yellow
    $null = Read-Host

    # 3. Cluster-Node suspendieren
    try {
        Suspend-ClusterNode -Name $Server -ErrorAction Stop
        Write-OK "Cluster-Node '$Server' suspendiert."
    }
    catch {
        Write-WARN "Suspend-ClusterNode fehlgeschlagen (kein Cluster oder bereits suspendiert): $_"
    }

    # 4. Datenbank-Auto-Aktivierung deaktivieren
    try {
        Set-MailboxServer $Server -DatabaseCopyActivationDisabledAndMoveNow $true -ErrorAction Stop
        Set-MailboxServer $Server -DatabaseCopyAutoActivationPolicy Blocked -ErrorAction Stop
        Write-OK "DatabaseCopyAutoActivationPolicy = Blocked"
    }
    catch {
        Write-FAIL "MailboxServer-Settings fehlgeschlagen: $_"
        return
    }

    # 5. ServerWideOffline setzen
    try {
        Set-ServerComponentState $Server -Component ServerWideOffline -State Inactive -Requester Maintenance -ErrorAction Stop
        Write-OK "ServerWideOffline = Inactive – Server ist jetzt im Wartungsmodus."
    }
    catch {
        Write-FAIL "ServerWideOffline fehlgeschlagen: $_"
        return
    }

    Write-Host ""
    Write-Host "  ─── Nach der Wartung zuruecksetzen ─────────────────────────" -ForegroundColor DarkCyan
    Write-CMD  "Set-ServerComponentState $Server -Component ServerWideOffline -State Active -Requester Maintenance"
    Write-CMD  "Set-ServerComponentState $Server -Component HubTransport -State Active -Requester Maintenance"
    Write-CMD  "Set-MailboxServer $Server -DatabaseCopyAutoActivationPolicy Unrestricted"
    Write-CMD  "Resume-ClusterNode -Name $Server"
    Write-Host ""
}

# ── Zusammenfassung ──────────────────────────────────────────
function Write-Summary {
    Write-Header "ZUSAMMENFASSUNG  |  Server: $Server"
    Write-Host ""

    $time = Get-Date -Format "dd.MM.yyyy HH:mm:ss"

    if ($script:FailCount -eq 0 -and $script:WarnCount -eq 0) {
        Write-Host "  ✓  ALLES OK – Server kann sicher heruntergefahren werden." -ForegroundColor Green
    }
    elseif ($script:FailCount -eq 0) {
        Write-Host "  ⚠  $($script:WarnCount) Warnung(en) – bitte vor Shutdown pruefen." -ForegroundColor Yellow
    }
    else {
        Write-Host "  ✗  $($script:FailCount) Fehler, $($script:WarnCount) Warnung(en)" -ForegroundColor Red
        Write-Host "     NICHT herunterfahren bis alle Fehler behoben sind!" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "  Empfohlene Reihenfolge fuer kontrollierten Shutdown:" -ForegroundColor DarkGray
    Write-Host "    1. .\Exchange-PreflightCheck.ps1 -Server $Server -ApplyMaintenance" -ForegroundColor DarkGray
    Write-Host "    2. Move-ActiveMailboxDatabase -Server $Server -ActivateOnServer <Ziel>" -ForegroundColor DarkGray
    Write-Host "    3. Stop-Service MSExchangeTransport" -ForegroundColor DarkGray
    Write-Host "    4. Server herunterfahren / Neustart" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Zeitpunkt: $time | Fehler: $($script:FailCount) | Warnungen: $($script:WarnCount)" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Hauptprogramm ────────────────────────────────────────────
Write-Header "Exchange Preflight Check  |  Server: $Server"
Write-Host "  Datum     : $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss')" -ForegroundColor DarkGray
Write-Host "  User      : $env:USERNAME" -ForegroundColor DarkGray
Write-Host "  Exchange  : Exchange Management Shell erforderlich" -ForegroundColor DarkGray
if ($DAGName)          { Write-Host "  DAG       : $DAGName" -ForegroundColor DarkGray }
if ($ApplyMaintenance) { Write-Host "  Modus     : PRUEFEN + WARTUNGSMODUS AKTIVIEREN" -ForegroundColor Yellow }
else                   { Write-Host "  Modus     : NUR PRUEFEN (kein Eingriff)" -ForegroundColor DarkGray }
Write-Host ""

Test-ExchangeShell
Test-ServerReachable
Check-ServerComponents
Check-Queues
Check-Databases
Check-Connections

if ($ApplyMaintenance) {
    Apply-MaintenanceMode
}

Write-Summary
