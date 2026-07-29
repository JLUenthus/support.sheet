#Requires -Version 5.1
<#
.SYNOPSIS
    Microsoft 365 Tenant Complete Inventory & Compliance Report Generator

.DESCRIPTION
    Generiert einen vollständigen HTML-Report über den M365-Tenant:
    - Entra ID (Benutzer, Gruppen, Conditional Access, App-Registrierungen, Rollen)
    - Exchange Online (Mailboxen, Anti-Spam/Phishing, DKIM/DMARC, Transport Rules)
    - Intune / Endpoint Manager (Geräte, Compliance, Profile, App Protection)
    - Microsoft Teams (Teams, Policies, External/Guest Access)
    - SharePoint Online (Sites, Sharing-Einstellungen, Storage)

    Einstellungen werden automatisch gegen folgende Empfehlungen geprüft:
    - CISA M365 Security Configuration Baseline
    - BSI IT-Grundschutz (APP.5.2, ORP.4, SYS.2.1)
    - Microsoft Security Baseline / Secure Score

.PARAMETER OutputPath
    Pfad zur HTML-Ausgabedatei. Standard: M365-Inventory-YYYYMMDD-HHmm.html

.PARAMETER TenantId
    Azure AD Tenant-ID (optional, wird sonst aus der Verbindung ermittelt)

.PARAMETER ConnectionTimeout
    Timeout in Sekunden für Graph-API-Anfragen. Standard: 30

.EXAMPLE
    .\M365-Inventory.ps1
    Startet interaktiv und fragt Modulauswahl sowie Authentifizierung ab.

.EXAMPLE
    .\M365-Inventory.ps1 -OutputPath "C:\Reports\M365-$(Get-Date -Format 'yyyyMMdd').html"

.NOTES
    Version:      1.0
    Autor:        IT-Abteilung
    Erstellt:     2025
    Erforderliche Module (werden geprüft und ggf. installiert):
      Microsoft.Graph, ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell
#>

# ============================================================
# VORAUSSETZUNGEN & BENÖTIGTE KOMPONENTEN
# ============================================================
#
# BETRIEBSSYSTEM
#   - Windows 10/11 oder Windows Server 2016 oder neuer
#   - PowerShell 5.1 oder neuer (empfohlen: PowerShell 7.x für bessere
#     Kompatibilität mit Microsoft.Graph-Modul)
#     PS 7 Download: https://github.com/PowerShell/PowerShell/releases
#   - Ausführungsrichtlinie: RemoteSigned oder Unrestricted
#     Setzen mit: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
#
# KONTO & BERECHTIGUNGEN
#   Für schreibgeschützte Inventarisierung wird empfohlen:
#   - Entra ID-Rolle "Global Reader" (alle Entra ID / Intune / Teams-Daten)
#     ODER folgende spezifische Rollen kombiniert:
#       * "User Administrator" (Read) → Benutzer & Gruppen
#       * "Security Reader"          → CA-Policies, Identity Protection
#       * "Reports Reader"           → Audit-Logs
#       * "Intune Service Administrator" (Read) → Gerätedaten
#       * "Teams Administrator"      → Teams-Einstellungen
#   - Exchange Online: "View-Only Organization Management" oder
#     "Global Reader" mit ExO-Scope
#   - SharePoint Online: "SharePoint Administrator" (Read)
#     (PnP.PowerShell benötigt SharePoint Admin-Rechte für Get-PnPTenantSite)
#   - Für Compliance-Checks (DMARC-DNS-Abfragen): keine besonderen Rechte
#
#   HINWEIS: "Global Administrator" ist NICHT erforderlich – Global Reader reicht
#   für nahezu alle Abfragen. Ausnahme: PIM-Status (Entra ID P2 + PIM-Leser).
#
# MODULE (werden vom Script geprüft und bei Bedarf automatisch installiert)
#   Manuelle Vorab-Installation möglich mit:
#
#   - Microsoft.Graph  (Entra ID, Intune, Teams)
#     Install-Module Microsoft.Graph -Scope CurrentUser -Force
#     Enthält folgende Sub-Module die benötigt werden:
#       Microsoft.Graph.Authentication, Microsoft.Graph.Users,
#       Microsoft.Graph.Groups, Microsoft.Graph.Identity.SignIns,
#       Microsoft.Graph.Applications, Microsoft.Graph.DeviceManagement,
#       Microsoft.Graph.Teams, Microsoft.Graph.Sites
#     Hinweis: Das Metapaket installiert alle Sub-Module (~600 MB).
#     Für schlanke Installation nur benötigte Sub-Module installieren.
#
#   - ExchangeOnlineManagement  (Exchange Online)
#     Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
#     Mindestversion: 3.0 (V3 API, REST-basiert)
#
#   - PnP.PowerShell  (SharePoint Online)
#     Install-Module PnP.PowerShell -Scope CurrentUser -Force
#     Mindestversion: 2.x (für Get-PnPTenantSite und Get-PnPHubSite)
#     Hinweis: Erfordert App-Registrierung im Entra ID ODER
#     interaktive Browser-Anmeldung (wird vom Script verwendet)
#
#   NICHT benötigt / nicht verwendet:
#   - MicrosoftTeams-Modul (Teams-Daten werden vollständig über Microsoft.Graph abgefragt)
#   - AzureAD / AzureADPreview (veraltet, durch Microsoft.Graph ersetzt)
#   - MSOnline (veraltet, durch Microsoft.Graph ersetzt)
#
# LIZENZEN IM TENANT
#   Für vollständige Abfragen werden folgende Lizenzen empfohlen:
#   - Entra ID P1 oder P2  → Conditional Access, Identity Protection
#   - Entra ID P2           → PIM-Status (nur INFO-Check, kein FAIL wenn fehlt)
#   - Microsoft Intune Plan 1 oder höher → Geräteverwaltung
#   - Microsoft Defender for Office 365 Plan 1/2 → Safe Attachments, Safe Links
#   Ohne diese Lizenzen werden die entsprechenden Abschnitte
#   mit Fehlerhinweis übersprungen (kein Scriptabbruch).
#
# NETZWERK & PORTS
#   - TCP 443 (HTTPS) zu folgenden Endpunkten (Commercial/Global):
#       * graph.microsoft.com           (Microsoft Graph API)
#       * login.microsoftonline.com     (Authentifizierung / OAuth)
#       * outlook.office365.com         (Exchange Online PowerShell)
#       * *.sharepoint.com              (SharePoint Online / PnP)
#   Deutschland-Cloud (zusaetzlich/alternativ):
#       * graph.microsoft.de            (Microsoft Graph API)
#       * login.microsoftonline.de      (Authentifizierung)
#       * *.sharepoint.de               (SharePoint Online)
#
# CLOUD-UMGEBUNGEN (Parameter -CloudEnvironment)
#   Leer / Global : Standard Commercial Cloud (weltweite Tenants)
#   HINWEIS: Die Microsoft Cloud Deutschland wurde 2021 migriert.
#   Tenants mit *.onmicrosoft.de laufen jetzt auf Global Cloud - kein CloudEnvironment noetig!
#   USGov         : Microsoft 365 GCC High
#   USGovDoD      : Microsoft 365 GCC DoD
#   China         : Microsoft 365 China (21Vianet)
#   Die Cloud-Umgebung wird automatisch aus der AppConfig erkannt
#   wenn der Tenant bereits einmal analysiert wurde.
#
#   - Ausgehende Verbindungen müssen Proxy-/Firewall-Regeln passieren können.
#     Bei Proxy-Umgebungen: Invoke-WebRequest -Proxy $ProxyUrl vorab testen.
#   - DNS-Auflösung nach außen für DMARC-Checks (_dmarc.<domain> TXT-Abfragen)
#
# AUSGABE
#   - HTML-Datei im Arbeitsverzeichnis (konfigurierbar über -OutputPath)
#   - Log-Datei (Transcript) im gleichen Verzeichnis: M365-Inventory-Log-YYYYMMDD-HHmm.log
#
# ERSTE AUSFÜHRUNG – EMPFOHLENE REIHENFOLGE
#   1. PowerShell als normaler Benutzer starten (NICHT als Admin erforderlich)
#   2. Ausführungsrichtlinie prüfen: Get-ExecutionPolicy
#   3. Module installieren (falls noch nicht vorhanden):
#        Install-Module Microsoft.Graph, ExchangeOnlineManagement, PnP.PowerShell -Scope CurrentUser
#   4. Script starten: .\M365-Inventory.ps1
#   5. Im Modulauswahl-Dialog gewünschte Bereiche wählen
#   6. Browser-Anmeldefenster für Graph und Exchange bestätigen
#   7. SharePoint Admin-URL eingeben (Format: https://<tenant>-admin.sharepoint.com)
#
# ============================================================

#   AUTHENTIFIZIERUNGSMODI
#   Das Script unterstuetzt zwei Modi:
#
#   Modus A: App-only (empfohlen fuer Serverumgebungen)
#     .\M365-Inventory.ps1 -ClientId <ID> -TenantId <ID> -ClientSecret <Secret>
#     - Kein Browser, kein Device-Code, kein WAM
#     - App-Registrierung braucht Application Permissions (nicht Delegated)
#     - Stabiler auf Windows Server ohne Desktop-Sitzung
#
#   Modus B: Delegiert / Device-Code (bisheriger Modus, interaktiv)
#     .\M365-Inventory.ps1 -ClientId <ID> -TenantId <ID>
#     - Benutzer-Login per Device-Code-Flow
#     - Exchange braucht weiterhin interaktiven Login
#
# ============================================================

[CmdletBinding()]
param(
    [string]$OutputPath        = "M365-Inventory-$(Get-Date -Format 'yyyyMMdd-HHmm').html",
    [string]$TenantId          = "",
    [string]$ClientId          = "",   # App-ID der "enthus Dokumentation" App-Registrierung
    [string]$ClientSecret      = "",   # Client Secret fuer App-only Auth (Modus A, empfohlen)
    [int]$ConnectionTimeout    = 30,
    [ValidateSet('Global','USGov','USGovDoD','China','')]
    [string]$CloudEnvironment  = "",   # Leer = Global/Commercial. USGov/USGovDoD/China fuer Behoerden-Clouds
    [switch]$SkipMFA,
    [switch]$SkipAppPerms,
    [switch]$VerboseOutput,
    [switch]$AllSitesFolders,           # Ordnerstruktur fuer alle Sites (Standard: Top 3 nach Storage)
    [int]$FolderDepth          = 99     # Maximale Ordnertiefe (Standard: unbegrenzt)
)

# ============================================================
# GLOBALE VARIABLEN
# ============================================================
# WAM-Einstellungen
# Graph < 2.34: MSAL_DISABLE_WAM verhindert WAM-Bug unter PS 5.1
# Graph >= 2.34: WAM ist erzwungen und kann nicht mehr deaktiviert werden,
#                aber -UseDeviceCode in Connect-MgGraph umgeht WAM vollstaendig
$env:MSAL_DISABLE_WAM = '1'
[System.Environment]::SetEnvironmentVariable('MSAL_DISABLE_WAM','1','Process')

$ScriptVersion        = '2.0'
# Baseline-Versionen (fuer Aktualitaetspruefung):
# CISA M365 Security Configuration Baseline: v1.0 (2023)
# CIS Microsoft 365 Foundations Benchmark:   v6.0.1 (Oktober 2025)
# BSI IT-Grundschutz:                        APP.5.2 (2023), ORP.4, SYS.2.1
# Microsoft Security Baseline:               M365 Apps v2309 (2023)
# Naechste Pruefung empfohlen: jaehrlich oder bei Major-Updates
$StartTime            = Get-Date
$ReportData           = @{}
$TranscriptPath       = "M365-Inventory-Log-$(Get-Date -Format 'yyyyMMdd-HHmm').log"
$Global:ErrorLog      = [System.Collections.Generic.List[string]]::new()
$Global:ComplianceFindings = [System.Collections.Generic.List[object]]::new()
$Global:VerboseMode   = $VerboseOutput.IsPresent
$Global:StepTimings   = [System.Collections.Generic.List[object]]::new()
$Global:SkipMFA       = $SkipMFA.IsPresent
$Global:SkipAppPerms  = $SkipAppPerms.IsPresent
$Global:CloudEnvironment = $CloudEnvironment   # '' = Global/Commercial, 'Germany' = Deutschland-Cloud, 'USGov' etc.
$Global:ClientId      = $ClientId
$Global:ClientSecret  = $ClientSecret          # Leer = Delegierter Flow, gesetzt = App-only
# AppConfig: tenant-spezifisch wenn TenantId bekannt, sonst default
# Wird spaeter nach TenantId-Aufloesung ggf. aktualisiert
$Global:AppConfigFile = Join-Path $PSScriptRoot "M365-Inventory-AppConfig.json"

# Verbindungsstatus je Dienst
$Global:Connected = @{
    Graph    = $false
    Exchange = $false
    Teams    = $false
    SPO      = $false
}

# ============================================================
# HILFSFUNKTIONEN
# ============================================================
function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Info','Warning','Error','Success','Verbose','Timing')]
        [string]$Level = 'Info'
    )
    $Stamp = (Get-Date).ToString('HH:mm:ss')
    switch ($Level) {
        'Info'    { Write-Host "  [$Stamp] $Message" -ForegroundColor Gray }
        'Success' { Write-Host "  [$Stamp] ✓ $Message" -ForegroundColor Green }
        'Warning' { Write-Host "  [$Stamp] ⚠ $Message" -ForegroundColor Yellow; $Global:ErrorLog.Add("⚠ $Message") }
        'Error'   { Write-Host "  [$Stamp] ✗ $Message" -ForegroundColor Red;    $Global:ErrorLog.Add("❌ $Message") }
        'Verbose' { if ($Global:VerboseMode) { Write-Host "  [$Stamp] » $Message" -ForegroundColor DarkCyan } }
        'Timing'  { if ($Global:VerboseMode) { Write-Host "  [$Stamp] ⏱ $Message" -ForegroundColor DarkYellow } }
    }
}

# ── Rate-Limit-sicherer Graph REST Wrapper ────────────────────────────────────
# Wiederholt automatisch bei 429/503/504 mit exponentiellem Backoff
# Niemals skippen - lieber warten
function Invoke-GraphRestMethod {
    param(
        [string]$Uri,
        [hashtable]$Headers,
        [string]$Method = 'GET',
        [int]$TimeoutSec = 30,
        [int]$MaxRetries = 10
    )
    $Attempt = 0
    $BaseDelay = 2  # Sekunden Basis-Wartezeit
    while ($true) {
        $Attempt++
        try {
            $Response = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method $Method `
                -TimeoutSec $TimeoutSec -ErrorAction Stop
            return $Response
        } catch {
            $EMsg = $_.Exception.Message
            $StatusCode = 0
            # HTTP-Statuscode extrahieren
            if ($_.Exception.Response) {
                $StatusCode = [int]$_.Exception.Response.StatusCode
            } elseif ($EMsg -match '(\d{3})') {
                $StatusCode = [int]$Matches[1]
            }

            # Retry-After Header auslesen falls vorhanden
            $RetryAfter = 0
            try {
                $RetryAfter = [int]$_.Exception.Response.Headers['Retry-After']
            } catch {}

            if ($StatusCode -eq 429 -or $StatusCode -eq 503 -or $StatusCode -eq 504) {
                if ($Attempt -gt $MaxRetries) {
                    Write-Log "Max Retries ($MaxRetries) erreicht fuer: $Uri" -Level Warning
                    return $null
                }
                # Retry-After beachten, sonst exponentieller Backoff
                $WaitSec = if ($RetryAfter -gt 0) { $RetryAfter }
                           else { [math]::Min($BaseDelay * [math]::Pow(2, $Attempt - 1), 120) }
                Write-Log "Rate Limit (HTTP $StatusCode) - warte $([int]$WaitSec)s (Versuch $Attempt/$MaxRetries)..." -Level Info
                Start-Sleep -Seconds $WaitSec
                continue
            } elseif ($EMsg -like '*timeout*' -or $EMsg -like '*timed out*') {
                if ($Attempt -gt 3) { return $null }
                $WaitSec = $Attempt * 5
                Write-Log "Timeout - warte $WaitSec`s und wiederhole (Versuch $Attempt)..." -Level Info
                Start-Sleep -Seconds $WaitSec
                continue
            } else {
                # Echter Fehler - nicht wiederholen
                return $null
            }
        }
    }
}

function Start-Step {
    param([string]$Name)
    $Global:StepTimings.Add([PSCustomObject]@{ Name=$Name; Start=Get-Date; End=$null; DurationSec=$null })
    Write-Log "START: $Name" -Level Verbose
}

function Stop-Step {
    param([string]$Name)
    $Step = $Global:StepTimings | Where-Object { $_.Name -eq $Name -and $null -eq $_.End } | Select-Object -Last 1
    if ($Step) {
        $Step.End = Get-Date
        $Step.DurationSec = [math]::Round(($Step.End - $Step.Start).TotalSeconds, 1)
        Write-Log "DONE:  $Name ($($Step.DurationSec)s)" -Level Timing
    }
}

function Write-VerboseData {
    param([string]$Label, $Data)
    if (-not $Global:VerboseMode) { return }
    if ($null -eq $Data) {
        Write-Log "$Label = null" -Level Verbose
    } elseif ($Data -is [System.Collections.ICollection]) {
        Write-Log "$Label = $($Data.Count) Eintraege" -Level Verbose
    } elseif ($Data -is [hashtable] -or $Data -is [PSCustomObject]) {
        Write-Log "$Label = $($Data | ConvertTo-Json -Depth 1 -Compress)" -Level Verbose
    } else {
        Write-Log "$Label = $Data" -Level Verbose
    }
}

function Write-Progress-Status {
    param([string]$Activity, [string]$Status, [int]$Percent = 0)
    Write-Progress -Activity $Activity -Status $Status -PercentComplete $Percent
    Write-Log $Status -Level Info
}

function Add-ComplianceFinding {
    param(
        [string]$Category,
        [string]$Control,
        [string]$Description,
        [ValidateSet('PASS','FAIL','WARNING','INFO','SKIPPED')]
        [string]$Status,
        [ValidateSet('Critical','High','Medium','Low','Info')]
        [string]$Severity = 'Medium',
        [string]$Source,       # CISA / BSI / MS-Baseline / Best-Practice
        [string]$Finding,
        [string]$Recommendation,
        [string]$Reference = ''
    )
    $Global:ComplianceFindings.Add([PSCustomObject]@{
        Category       = $Category
        Control        = $Control
        Description    = $Description
        Status         = $Status
        Severity       = $Severity
        Source         = $Source
        Finding        = $Finding
        Recommendation = $Recommendation
        Reference      = $Reference
    })
}

function Test-ModuleAvailable {
    param([string]$ModuleName)
    if (Get-Module -Name $ModuleName -ListAvailable) { return $true }
    Write-Log "Modul '$ModuleName' nicht installiert. Versuche Installation..." -Level Warning
    try {
        Install-Module -Name $ModuleName -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
        Write-Log "Modul '$ModuleName' erfolgreich installiert." -Level Success
        return $true
    }
    catch {
        Write-Log "Installation von '$ModuleName' fehlgeschlagen: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ============================================================
# STARTDIALOGE
# ============================================================
function Invoke-ModuleSelectionDialog {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     M365 Tenant Inventory v$ScriptVersion - Modulauswahl            ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Mit Nummer umschalten, [A] alle, [N] keine, [ENTER] starten." -ForegroundColor Yellow
    Write-Host ""

    # Exchange: im App-only Modus standardmaessig deaktiviert (benoetigt Device-Code)
    $ExchangeDefault = [string]::IsNullOrWhiteSpace($Global:ClientSecret)

    $Options = @(
        [PSCustomObject]@{ Key='1'; Label='Entra ID';              Desc='Benutzer, Gruppen, CA, Rollen, Apps';    Default=$true;            AlwaysOn=$false; Group='module' }
        [PSCustomObject]@{ Key='2'; Label='Exchange Online';       Desc='Mailboxen, Anti-Spam, DKIM, DMARC';     Default=$ExchangeDefault;  AlwaysOn=$false; Group='module' }
        [PSCustomObject]@{ Key='3'; Label='Intune';                Desc='Geräte, Compliance, Profile, Apps';     Default=$true;            AlwaysOn=$false; Group='module' }
        [PSCustomObject]@{ Key='4'; Label='Microsoft Teams';       Desc='Teams, Policies, External/Guest';       Default=$true;            AlwaysOn=$false; Group='module' }
        [PSCustomObject]@{ Key='5'; Label='SharePoint Online';     Desc='Sites, Sharing, Storage';               Default=$true;            AlwaysOn=$false; Group='module' }
        [PSCustomObject]@{ Key='6'; Label='Compliance-Check';      Desc='CISA / BSI / MS Baseline Prüfung';      Default=$true;            AlwaysOn=$false; Group='module' }
        [PSCustomObject]@{ Key='7'; Label='SPO: Ordner Top 3';     Desc='Ordnerstruktur der 3 größten Sites';    Default=$true;            AlwaysOn=$false; Group='spo' }
        [PSCustomObject]@{ Key='8'; Label='SPO: Ordner alle Sites';Desc='Ordnerstruktur aller Sites (langsam)';  Default=$false;           AlwaysOn=$false; Group='spo' }
        [PSCustomObject]@{ Key='9'; Label='SPO: Rechte Top 10';    Desc='Berechtigungen der 10 größten Sites';    Default=$false;           AlwaysOn=$false; Group='spo' }
        [PSCustomObject]@{ Key='0'; Label='SPO: Rechte alle Sites'; Desc='Berechtigungen aller Sites (langsam)';    Default=$false;           AlwaysOn=$false; Group='spo' }
    )

    $Selected = @{}
    foreach ($O in $Options) { $Selected[$O.Key] = $O.Default }

    $Done = $false
    while (-not $Done) {
        Write-Host "`r`n  Nr.  Status  Modul                    Beschreibung" -ForegroundColor White
        Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
        $LastGroup = ''
        foreach ($O in $Options) {
            if ($O.Group -ne $LastGroup -and $LastGroup -ne '') {
                Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
            }
            $LastGroup = $O.Group
            $SPODisabled = ($O.Group -eq 'spo' -and -not $Selected['5'])
            $Mark  = if ($Selected[$O.Key]) { "[X]" } else { "[ ]" }
            $Color = if ($O.AlwaysOn) { "DarkGray" }
                     elseif ($SPODisabled) { "DarkGray" }
                     elseif ($Selected[$O.Key]) { "Green" }
                     else { "Gray" }
            $Suffix = if ($SPODisabled) { " (SharePoint deaktiviert)" } else { "" }
            Write-Host ("  [{0}]  {1}  {2,-24} {3}{4}" -f $O.Key, $Mark, $O.Label, $O.Desc, $Suffix) -ForegroundColor $Color
        }
        Write-Host ""
        Write-Host "  [A] Alle   [N] Keine   [ENTER] Starten" -ForegroundColor Yellow
        Write-Host ""
        $Input = Read-Host "  Auswahl"

        if ([string]::IsNullOrWhiteSpace($Input)) { $Done = $true }
        elseif ($Input -eq 'A' -or $Input -eq 'a') { foreach ($O in $Options) { $Selected[$O.Key] = $true } }
        elseif ($Input -eq 'N' -or $Input -eq 'n') { foreach ($O in $Options) { if (-not $O.AlwaysOn) { $Selected[$O.Key] = $false } } }
        elseif ($Selected.ContainsKey($Input)) {
            $O = $Options | Where-Object { $_.Key -eq $Input }
            if ($O.AlwaysOn) {
                Write-Host "  ⚠ Pflichtmodul – kann nicht abgewählt werden." -ForegroundColor Red; Start-Sleep 1
            } elseif ($O.Group -eq 'spo' -and -not $Selected['5']) {
                # SPO-Optionen nur verfuegbar wenn SharePoint ausgewaehlt
                Write-Host "  ⚠ Erst SharePoint Online [5] aktivieren." -ForegroundColor Yellow; Start-Sleep 1
            } elseif ($Input -eq '7' -and -not $Selected['7']) {
                $Selected['7'] = $true; $Selected['8'] = $false
            } elseif ($Input -eq '8' -and -not $Selected['8']) {
                $Selected['8'] = $true; $Selected['7'] = $false
            } elseif ($Input -eq '9' -and -not $Selected['9']) {
                $Selected['9'] = $true; $Selected['0'] = $false
            } elseif ($Input -eq '0' -and -not $Selected['0']) {
                $Selected['0'] = $true; $Selected['9'] = $false
            } else {
                $Selected[$Input] = -not $Selected[$Input]
                # Wenn SharePoint deaktiviert wird -> SPO-Optionen auch deaktivieren
                if ($Input -eq '5' -and -not $Selected['5']) {
                    $Selected['7'] = $false; $Selected['8'] = $false
                    $Selected['9'] = $false; $Selected['0'] = $false
                }
            }
        }
    }

    $Global:SPOFolderMode = if ($Selected['8']) { 'All' } elseif ($Selected['7']) { 'Top3' } else { 'None' }
    $Global:SPOPermMode   = if ($Selected['0']) { 'All' } elseif ($Selected['9']) { 'Top10' } else { 'None' }

    $SelectedLabels = ($Options | Where-Object { $Selected[$_.Key] -and $_.Group -eq 'module' } | Select-Object -Exp Label) -join ', '
    if ($Global:SPOFolderMode -ne 'None') {
        $FolderLabel = if ($Global:SPOFolderMode -eq 'All') { ' + Ordner alle Sites' } else { ' + Ordner Top 3' }
        $SelectedLabels += $FolderLabel
    }
    if ($Global:SPOPermMode -ne 'None') {
        $PermLabel = if ($Global:SPOPermMode -eq 'All') { ' + Rechte alle Sites' } else { ' + Rechte Top 10' }
        $SelectedLabels += $PermLabel
    }
    Write-Host ""
    Write-Host "  ✅ Ausgewählt: $SelectedLabels" -ForegroundColor Green
    Write-Host ""

    return [PSCustomObject]@{
        EntraID    = $Selected['1']
        Exchange   = $Selected['2']
        Intune     = $Selected['3']
        Teams      = $Selected['4']
        SharePoint = $Selected['5']
        Compliance = $Selected['6']
    }
}


# ============================================================
# APP-REGISTRIERUNG ERSTELLEN / LADEN
# ============================================================
function Get-OrCreateAppRegistration {
    <#
    .SYNOPSIS
        Laedt App-ID und Konfiguration aus AppConfig-JSON.
        App-Registrierung wird durch M365-Setup-AppRegistration.ps1 angelegt.
    #>
    $AppName = "enthus Dokumentation"

    # Gespeicherte tenant-spezifische Config laden (hat Vorrang)
    if (-not [string]::IsNullOrWhiteSpace($TenantId)) {
        $TenantCfg = Join-Path $PSScriptRoot "M365-Inventory-AppConfig-$TenantId.json"
        if (Test-Path $TenantCfg) {
            try {
                $Cfg = Get-Content $TenantCfg -Raw | ConvertFrom-Json
                if ($Cfg.ClientId) {
                    $Global:ClientId = $Cfg.ClientId
                    if ($Cfg.TenantDomain -and -not $Global:TenantDomain) { $Global:TenantDomain = $Cfg.TenantDomain }
                    if ($Cfg.CloudEnvironment -and -not $Global:CloudEnvironment -and $Cfg.CloudEnvironment -ne 'Germany') {
                        $Global:CloudEnvironment = $Cfg.CloudEnvironment
                    }
                    # Client Secret aus Config laden falls nicht per Parameter uebergeben
                    if ([string]::IsNullOrWhiteSpace($Global:ClientSecret) -and $Cfg.ClientSecret) {
                        $Global:ClientSecret = $Cfg.ClientSecret
                        Write-Log "Client Secret aus Config geladen." -Level Info
                    }
                    Write-Log "App '$AppName' geladen: $($Cfg.ClientId)" -Level Success
                    return $Global:ClientId
                }
            } catch {}
        }
    }

    # Default AppConfig laden
    if ([string]::IsNullOrWhiteSpace($Global:ClientId) -and (Test-Path $Global:AppConfigFile)) {
        try {
            $Cfg = Get-Content $Global:AppConfigFile -Raw | ConvertFrom-Json
            if ($Cfg.ClientId) {
                $Global:ClientId = $Cfg.ClientId
                if ($Cfg.TenantId -and [string]::IsNullOrWhiteSpace($TenantId)) {
                    $script:TenantId = $Cfg.TenantId
                    Write-Log "TenantId aus Config: $($Cfg.TenantId)" -Level Info
                }
                Write-Log "App '$AppName' geladen: $($Cfg.ClientId)" -Level Success
                return $Global:ClientId
            }
        } catch {}
    }

    if (-not [string]::IsNullOrWhiteSpace($Global:ClientId)) {
        Write-Log "Verwende App-ID: $($Global:ClientId)" -Level Info
        return $Global:ClientId
    }

    # Keine App-ID gefunden - Hinweis auf Setup-Script
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "  ║  Keine App-Registrierung gefunden                           ║" -ForegroundColor Yellow
    Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Yellow
    Write-Host "  ║  App-Registrierung einmalig per Setup-Script anlegen:        ║" -ForegroundColor White
    Write-Host "  ║                                                              ║" -ForegroundColor White
    Write-Host "  ║  .\M365-Setup-AppRegistration.ps1 ``                         ║" -ForegroundColor Cyan
    Write-Host "  ║    -TenantId '<Verzeichnis-ID>'                             ║" -ForegroundColor Cyan
    Write-Host "  ║                                                              ║" -ForegroundColor White
    Write-Host "  ║  Das Script legt die App an, setzt alle Berechtigungen      ║" -ForegroundColor White
    Write-Host "  ║  und schreibt die AppConfig automatisch.                    ║" -ForegroundColor White
    Write-Host "  ║                                                              ║" -ForegroundColor White
    Write-Host "  ║  Oder App-ID manuell eingeben:                              ║" -ForegroundColor DarkGray
    Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""

    $ManualId = Read-Host "  App-ID eingeben (oder ENTER abbrechen)"
    if (-not [string]::IsNullOrWhiteSpace($ManualId)) {
        $Global:ClientId = $ManualId.Trim()
        $SaveCfg = @{ AppName=$AppName; ClientId=$Global:ClientId; TenantId=$TenantId; CreatedAt=(Get-Date -Format 'yyyy-MM-dd HH:mm') }
        $SaveCfg | ConvertTo-Json | Set-Content -Path $Global:AppConfigFile -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($TenantId)) {
            $SaveCfg | ConvertTo-Json | Set-Content -Path (Join-Path $PSScriptRoot "M365-Inventory-AppConfig-$TenantId.json") -Encoding UTF8
        }
        Write-Log "App-ID gespeichert." -Level Success
    }

    return $Global:ClientId
}


function Connect-M365Services {
    param([PSCustomObject]$ModConfig)
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║               M365 Authentifizierung                        ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    $__IsAppOnly = (-not [string]::IsNullOrWhiteSpace($Global:ClientSecret) -and
                    -not [string]::IsNullOrWhiteSpace($Global:ClientId))
    if ($__IsAppOnly) {
        Write-Host "  App-only Authentifizierung (Client Secret) - kein Browser-Login erforderlich." -ForegroundColor Green
    } else {
        Write-Host "  Es werden Browser-basierte Anmeldungen geöffnet." -ForegroundColor Yellow
        Write-Host "  Bitte verwenden Sie ein Konto mit ausreichenden Leserechten" -ForegroundColor Yellow
        Write-Host "  (Global Reader oder je Dienst spezifische Reader-Rollen)." -ForegroundColor Yellow
    }
    Write-Host ""

    # Microsoft Graph (Entra ID + Intune + Teams-Basis)
    # Device-Code-Flow umgeht WAM/msalruntime auf aelteren Windows-Systemen
    if ($ModConfig.EntraID -or $ModConfig.Intune -or $ModConfig.Teams -or $ModConfig.SharePoint -or $ModConfig.Exchange) {
        Write-Log "Verbinde mit Microsoft Graph..." -Level Info
        $env:MSAL_DISABLE_WAM  = '1'
        [System.Environment]::SetEnvironmentVariable('MSAL_DISABLE_WAM','1','Process')

        # Cloud-Umgebung erkennen anhand TenantId-Domain oder explizitem Parameter
        # Deutschland-Cloud (*.onmicrosoft.de / TenantId in bekanntem Germany-Range)
        # Manuell ueberschreibbar per $Global:CloudEnvironment Variable
        $GraphEnvironment = $null
        # Hinweis: Microsoft Cloud Deutschland wurde 2021 migriert.
        # *.onmicrosoft.de Tenants laufen jetzt auf Global Cloud - KEIN Germany-Environment!
        # Germany-Environment in Get-MgEnvironment existiert nicht mehr.
        if ($Global:CloudEnvironment -and $Global:CloudEnvironment -ne 'Germany') {
            $GraphEnvironment = $Global:CloudEnvironment
        }

        Write-Host "  -> Code erscheint gleich in dieser Konsole..." -ForegroundColor Cyan
        try {
            $GraphParams = @{ ErrorAction = 'Stop' }
            if (-not [string]::IsNullOrWhiteSpace($Global:ClientId))          { $GraphParams['ClientId']    = $Global:ClientId }
            if (-not [string]::IsNullOrWhiteSpace($TenantId))                 { $GraphParams['TenantId']    = $TenantId }
            if (-not [string]::IsNullOrWhiteSpace($GraphEnvironment))         { $GraphParams['Environment'] = $GraphEnvironment }

            if (-not [string]::IsNullOrWhiteSpace($Global:ClientSecret) -and
                -not [string]::IsNullOrWhiteSpace($Global:ClientId) -and
                -not [string]::IsNullOrWhiteSpace($TenantId)) {
                # ── Modus A: App-only mit Client Secret ──────────────────────
                # ClientSecretCredential-ParameterSet: ClientId steckt im PSCredential,
                # NICHT als separater Parameter - sonst Parameterkonflikt!
                Write-Host "  -> App-only Auth (Client Secret)..." -ForegroundColor Cyan
                $SecureSecret  = ConvertTo-SecureString $Global:ClientSecret -AsPlainText -Force
                $ClientSecCred = New-Object System.Management.Automation.PSCredential($Global:ClientId, $SecureSecret)
                $AppOnlyParams = @{
                    ClientSecretCredential = $ClientSecCred
                    TenantId               = $TenantId
                    ErrorAction            = 'Stop'
                }
                if (-not [string]::IsNullOrWhiteSpace($GraphEnvironment)) { $AppOnlyParams['Environment'] = $GraphEnvironment }
                Connect-MgGraph @AppOnlyParams -NoWelcome
            } else {
                # ── Modus B: Delegierter Flow mit Device-Code ─────────────────
                $Scopes = @(
                    'User.Read.All','Group.Read.All','Directory.Read.All',
                    'Policy.Read.All','Application.Read.All','AuditLog.Read.All',
                    'DeviceManagementConfiguration.Read.All',
                    'DeviceManagementManagedDevices.Read.All',
                    'TeamSettings.Read.All',
                    'Sites.Read.All','Reports.Read.All',
                    'IdentityRiskyUser.Read.All','IdentityRiskEvent.Read.All',
                    'UserAuthenticationMethod.Read.All',
                    'RoleManagement.Read.Directory',
                    'Organization.Read.All'
                )
                $GraphParams['Scopes']                  = $Scopes
                $GraphParams['UseDeviceAuthentication'] = $true
                if ([string]::IsNullOrWhiteSpace($TenantId)) { $GraphParams['Audience'] = 'organizations' }
                Connect-MgGraph @GraphParams
            }
            $Context = Get-MgContext
            $Global:Connected.Graph = $true

            # Cloud-Umgebung aus Context ableiten und merken fuer Exchange/SPO
            # Microsoft Cloud Deutschland migriert 2021 - keine Germany-Auto-Erkennung noetig
            Write-Log "Graph verbunden: $($Context.Account) @ $($Context.TenantId)$(if ($GraphEnvironment) {" [$GraphEnvironment]"} else {''})" -Level Success

            # DLL-Warmup: Einen Get-Mg* Aufruf machen um die korrekte Microsoft.Graph.Core
            # Version im .NET Assembly-Cache zu fixieren. Verhindert dass PnP.PowerShell
            # danach die aeltere Graph.Core 1.25.1 DLL laden und ueberschreiben kann.
            try {
                $null = Get-MgContext
                # Warmup-Call: App-only kann /me nicht nutzen
                $WarmupUri = if ([string]::IsNullOrWhiteSpace($Global:ClientSecret)) {
                    'https://graph.microsoft.com/v1.0/me?$select=id'
                } else {
                    'https://graph.microsoft.com/v1.0/organization?$select=id'
                }
                $null = Invoke-MgGraphRequest -Method GET -Uri $WarmupUri -ErrorAction SilentlyContinue -OutputType Json
            } catch {}

            if ($Context.TenantId -and $Global:ClientId) {
                $AutoCfgPath = Join-Path $PSScriptRoot "M365-Inventory-AppConfig-$($Context.TenantId).json"
                # Config anlegen oder aktualisieren
                $CfgObj = if (Test-Path $AutoCfgPath) { Get-Content $AutoCfgPath -Raw | ConvertFrom-Json } else { [PSCustomObject]@{} }
                $CfgObj | Add-Member -NotePropertyName AppName       -NotePropertyValue 'enthus Dokumentation' -Force
                $CfgObj | Add-Member -NotePropertyName ClientId      -NotePropertyValue $Global:ClientId -Force
                $CfgObj | Add-Member -NotePropertyName TenantId      -NotePropertyValue $Context.TenantId -Force
                $CfgObj | Add-Member -NotePropertyName Account       -NotePropertyValue $Context.Account -Force
                $CfgObj | Add-Member -NotePropertyName TenantDomain  -NotePropertyValue ($Context.Account -replace '^[^@]+@','') -Force
                $CfgObj | Add-Member -NotePropertyName CloudEnvironment -NotePropertyValue $Global:CloudEnvironment -Force
                $CfgObj | Add-Member -NotePropertyName CreatedAt     -NotePropertyValue (Get-Date -Format 'yyyy-MM-dd HH:mm') -Force

                # TenantDomain ermitteln - im App-only Modus ist Account leer, daher Graph API nutzen
                $DetectedDomain = $Context.Account -replace '^[^@]+@',''
                if ([string]::IsNullOrWhiteSpace($DetectedDomain) -or $DetectedDomain -notlike '*.onmicrosoft.*') {
                    try {
                        $OrgR = Invoke-MgGraphRequest -Method GET `
                            -Uri "https://graph.microsoft.com/v1.0/organization?`$select=verifiedDomains" `
                            -ErrorAction SilentlyContinue
                        $InitD = $OrgR.value[0].verifiedDomains | Where-Object { $_.isInitial -eq $true } | Select-Object -First 1
                        if ($InitD) { $DetectedDomain = $InitD.name }
                    } catch {}
                }
                if (-not [string]::IsNullOrWhiteSpace($DetectedDomain)) {
                    $Global:TenantDomain = $DetectedDomain
                    $CfgObj | Add-Member -NotePropertyName TenantDomain -NotePropertyValue $DetectedDomain -Force
                    # SPO-URL ableiten und in Config speichern
                    $SPOUrlFromDomain = "https://$(($DetectedDomain -replace '\.onmicrosoft\.(com|de)$',''))-admin.sharepoint.com"
                    $CfgObj | Add-Member -NotePropertyName SharePointAdminUrl -NotePropertyValue $SPOUrlFromDomain -Force
                }
                $CfgObj | ConvertTo-Json | Set-Content -Path $AutoCfgPath -Encoding UTF8
                Write-Log "Tenant-Config gespeichert: $AutoCfgPath" -Level Success
            }
        }
        catch {
            Write-Log "Graph-Verbindung fehlgeschlagen: $($_.Exception.Message)" -Level Error
            # Bei Deutschland-Cloud-Fehler: Hinweis
            if ($_.Exception.Message -like '*DeviceCode*' -or $_.Exception.Message -like '*authentication failed*') {
                Write-Host ""
                Write-Host "  ⚠ Graph-Login fehlgeschlagen. Moegliche Ursachen:" -ForegroundColor Yellow
                Write-Host "    1. Zu langsam beim Eingeben des Codes (Code laeuft nach ~15 Min ab)" -ForegroundColor Gray
                Write-Host "    2. Falscher Tenant - TenantId pruefen (Entra Portal > Uebersicht > Verzeichnis-ID)" -ForegroundColor Gray
                Write-Host "    3. GCC/GovCloud: -CloudEnvironment USGov oder USGovDoD" -ForegroundColor Gray
                Write-Host ""
            }
        }
    }

    # Exchange Online (Device-Code-Flow - umgeht WAM/msalruntime-Probleme)
    if ($ModConfig.Exchange) {
        Write-Log "Verbinde mit Exchange Online (Device-Code)..." -Level Info
        Write-Host "  -> Oeffne https://microsoft.com/devicelogin und gib den angezeigten Code ein." -ForegroundColor Yellow
        try {
            # Exchange braucht Tenant-Kontext - aus mehreren Quellen ableiten
            $ExoOrg = $null

            # Quelle 1: Graph-Context (zuverlaessigste Quelle nach erfolgreichem Login)
            if ($Global:Connected.Graph) {
                try {
                    $MgCtx = Get-MgContext
                    if ($MgCtx -and $MgCtx.Account) {
                        # Account-Domain als Fallback (z.B. spielbankenniedersachsen.onmicrosoft.com)
                        $AccDomain = $MgCtx.Account -replace '^[^@]+@',''
                        if ($AccDomain -like '*.onmicrosoft.com') { $ExoOrg = $AccDomain }
                    }
                    # Versuche initiale Domain per Graph API
                    $OrgUri = "https://graph.microsoft.com/v1.0/organization?`$select=verifiedDomains"
                    $OrgResp = Invoke-MgGraphRequest -Method GET -Uri $OrgUri -ErrorAction SilentlyContinue
                    $InitDomain = $OrgResp.value[0].verifiedDomains | Where-Object { $_.isInitial -eq $true } | Select-Object -First 1
                    if ($InitDomain) { $ExoOrg = $InitDomain.name }
                } catch {}
            }

            # Quelle 2: onmicrosoft.com Domain aus TenantId ableiten via Graph
            if ([string]::IsNullOrWhiteSpace($ExoOrg) -and $Global:Connected.Graph) {
                try {
                    $MgCtx = Get-MgContext
                    if ($MgCtx.Account -like "*@*.onmicrosoft.com") {
                        $ExoOrg = $MgCtx.Account -replace "^[^@]+@",""
                    }
                } catch {}
            }

            Write-Log "Exchange Tenant-Kontext: $ExoOrg" -Level Info

            $ExoConnected = $false
            $IsAppOnlyMode = (-not [string]::IsNullOrWhiteSpace($Global:ClientSecret) -and
                              -not [string]::IsNullOrWhiteSpace($Global:ClientId))
            # Cloud-Environment fuer Exchange vorbereiten
            $ExoEnv = @{}
            if     ($Global:CloudEnvironment -eq 'USGov')    { $ExoEnv['ExchangeEnvironmentName'] = 'O365USGovGCCHigh' }
            elseif ($Global:CloudEnvironment -eq 'USGovDoD') { $ExoEnv['ExchangeEnvironmentName'] = 'O365USGovDoD' }
            elseif ($Global:CloudEnvironment -eq 'China')    { $ExoEnv['ExchangeEnvironmentName'] = 'O365China' }
            if ($ExoEnv.Count -gt 0) { Write-Host "  ℹ Exchange: $($ExoEnv['ExchangeEnvironmentName'])" -ForegroundColor Cyan }

            # Im App-only Modus: SSO-Versuch ueberspringen (kein $MgCtx.Account verfuegbar)
            # Direkt mit AppId + DelegatedOrganization per Device-Code (einmalig)
            if ($IsAppOnlyMode -and -not [string]::IsNullOrWhiteSpace($ExoOrg)) {
                Write-Host "  -> App-only Modus: Exchange benoetigt einmaligen Device-Code-Login..." -ForegroundColor Yellow
                try {
                    Connect-ExchangeOnline -ShowBanner:$false -Device `
                        -AppId $Global:ClientId -DelegatedOrganization $ExoOrg @ExoEnv -ErrorAction Stop
                    $ExoConnected = $true
                    Write-Log "Exchange verbunden (App-only + Device-Code)." -Level Success
                } catch {
                    Write-Log "Exchange mit AppId fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Info
                }
            }

            # Delegierter Modus: Versuch 1 - SSO ueber gecachten Graph-Token
            if (-not $ExoConnected -and -not $IsAppOnlyMode -and $Global:Connected.Graph) {
                try {
                    $MgCtx   = Get-MgContext
                    $UpnHint = $MgCtx.Account
                    if ($ExoOrg -and -not [string]::IsNullOrWhiteSpace($Global:ClientId)) {
                        Connect-ExchangeOnline -ShowBanner:$false -UserPrincipalName $UpnHint `
                            -AppId $Global:ClientId -DelegatedOrganization $ExoOrg @ExoEnv -ErrorAction Stop
                    } elseif ($ExoOrg) {
                        Connect-ExchangeOnline -ShowBanner:$false -UserPrincipalName $UpnHint `
                            -DelegatedOrganization $ExoOrg @ExoEnv -ErrorAction Stop
                    } else {
                        Connect-ExchangeOnline -ShowBanner:$false -UserPrincipalName $UpnHint @ExoEnv -ErrorAction Stop
                    }
                    $ExoConnected = $true
                    Write-Log "Exchange verbunden (SSO - kein zweiter Login noetig)." -Level Success
                } catch {
                    Write-Log "Exchange SSO fehlgeschlagen, versuche Device-Code..." -Level Info
                }
            }
            # Delegierter Modus: Versuch 2 - Device-Code mit AppId
            if (-not $ExoConnected -and -not [string]::IsNullOrWhiteSpace($Global:ClientId) -and -not [string]::IsNullOrWhiteSpace($ExoOrg)) {
                try {
                    Connect-ExchangeOnline -ShowBanner:$false -Device `
                        -AppId $Global:ClientId -DelegatedOrganization $ExoOrg @ExoEnv -ErrorAction Stop
                    $ExoConnected = $true
                } catch {
                    Write-Log "Exchange mit App-ID nicht moeglich - versuche Standard-Login..." -Level Info
                }
            }
            # Fallback: Standard Device-Code ohne AppId
            if (-not $ExoConnected) {
                Connect-ExchangeOnline -ShowBanner:$false -Device @ExoEnv -ErrorAction Stop
            }
            $Global:Connected.Exchange = $true
            Write-Log "Exchange Online verbunden." -Level Success
        }
        catch {
            Write-Log "Exchange-Verbindung fehlgeschlagen: $($_.Exception.Message)" -Level Error
        }
    }

    # SharePoint Online
    if ($ModConfig.SharePoint) {
        $IsAppOnly = -not [string]::IsNullOrWhiteSpace($Global:ClientSecret)

        if ($IsAppOnly) {
            # App-only Modus: Daten werden direkt per Graph API geladen (kein PnP/ACS noetig)
            # PnP 2.x + Client Secret nutzt Legacy ACS - seit Nov 2024 in neuen Tenants deaktiviert
            Write-Log "SharePoint: App-only Modus - Graph API wird genutzt (kein PnP)." -Level Info
            $Global:Connected.SPO = $true
        } else {
            # Delegierter Modus: PnP mit DeviceLogin
            $SPOUrlAuto = ''

            # URL ermitteln (AppConfig > Graph > TenantDomain > Prompt)
            if (-not [string]::IsNullOrWhiteSpace($TenantId)) {
                $TenantCfgFile = Join-Path $PSScriptRoot "M365-Inventory-AppConfig-$TenantId.json"
                if (Test-Path $TenantCfgFile) {
                    try {
                        $TCfg = Get-Content $TenantCfgFile -Raw | ConvertFrom-Json
                        if ($TCfg.SharePointAdminUrl) { $SPOUrlAuto = $TCfg.SharePointAdminUrl }
                    } catch {}
                }
            }
            if ([string]::IsNullOrWhiteSpace($SPOUrlAuto) -and $Global:Connected.Graph) {
                try {
                    $OrgI = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/organization?`$select=verifiedDomains" -EA SilentlyContinue
                    $InitD = $OrgI.value[0].verifiedDomains | Where-Object { $_.isInitial } | Select-Object -First 1
                    if ($InitD) { $SPOUrlAuto = "https://$(($InitD.name -replace '\.onmicrosoft\.(com|de)$',''))-admin.sharepoint.com" }
                } catch {}
            }
            if ([string]::IsNullOrWhiteSpace($SPOUrlAuto) -and $Global:TenantDomain) {
                $SPOUrlAuto = "https://$(($Global:TenantDomain -replace '\.onmicrosoft\.(com|de)$',''))-admin.sharepoint.com"
            }

            if ([string]::IsNullOrWhiteSpace($SPOUrlAuto)) {
                $SPOUrl = Read-Host "  SharePoint Admin URL (z.B. https://contoso-admin.sharepoint.com)"
            } else {
                Write-Host "  SharePoint Admin URL: $SPOUrlAuto" -ForegroundColor Cyan
                Write-Host "  [ENTER] = bestaetigen   [URL eingeben] = andere URL" -ForegroundColor DarkGray
                $SPOInput = Read-Host "  Eingabe"
                $SPOUrl = if ([string]::IsNullOrWhiteSpace($SPOInput)) { $SPOUrlAuto } else { $SPOInput.Trim() }
            }
            if ($SPOUrl -match '^(https://[^/]+)') { $SPOUrl = $Matches[1] }
            Write-Log "Verwende SPO-URL: $SPOUrl" -Level Info

            if (-not [string]::IsNullOrWhiteSpace($SPOUrl)) {
                $PnPCmd = Get-Command Connect-PnPOnline -ErrorAction SilentlyContinue
                $HasDevice = $PnPCmd -and $PnPCmd.Parameters.ContainsKey('DeviceLogin')
                $HaveClientId = -not [string]::IsNullOrWhiteSpace($Global:ClientId)
                $PnPAzureEnv = @{}
                if ($Global:CloudEnvironment -eq 'USGov') { $PnPAzureEnv['AzureEnvironment'] = 'USGovernment' }
                elseif ($Global:CloudEnvironment -eq 'China') { $PnPAzureEnv['AzureEnvironment'] = 'China' }

                $PnPTenant = $Global:TenantDomain
                if ([string]::IsNullOrWhiteSpace($PnPTenant)) { $PnPTenant = $TenantId }

                $env:PNPPOWERSHELL_UPDATECHECK = 'Off'
                $PnPConnected = $false

                if (-not $PnPConnected -and $HasDevice -and $HaveClientId -and $PnPTenant) {
                    try {
                        Connect-PnPOnline -Url $SPOUrl -DeviceLogin -ClientId $Global:ClientId -Tenant $PnPTenant @PnPAzureEnv -ErrorAction Stop
                        $PnPConnected = $true
                        Write-Log "SharePoint Online verbunden (DeviceLogin)." -Level Success
                    } catch {
                        Write-Log "DeviceLogin fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Info
                    }
                }
                if (-not $PnPConnected -and $HasDevice) {
                    try {
                        Connect-PnPOnline -Url $SPOUrl -DeviceLogin @PnPAzureEnv -ErrorAction Stop
                        $PnPConnected = $true
                        Write-Log "SharePoint Online verbunden (DeviceLogin Fallback)." -Level Success
                    } catch {
                        Write-Log "DeviceLogin Fallback fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Warning
                    }
                }
                $Global:Connected.SPO = $PnPConnected
            }
        }
    }

    Write-Host ""
    Write-Host "  Verbindungsstatus:" -ForegroundColor White
    Write-Host "    Graph    : $(if ($Global:Connected.Graph) {'✓ Verbunden'} else {'✗ Nicht verbunden'})" -ForegroundColor $(if ($Global:Connected.Graph) {'Green'} else {'Red'})
    Write-Host "    Exchange : $(if ($Global:Connected.Exchange) {'✓ Verbunden'} else {'✗ Nicht verbunden'})" -ForegroundColor $(if ($Global:Connected.Exchange) {'Green'} else {'Red'})
    Write-Host "    SPO      : $(if ($Global:Connected.SPO) {'✓ Verbunden'} else {'✗ Nicht verbunden'})" -ForegroundColor $(if ($Global:Connected.SPO) {'Green'} else {'Red'})
    Write-Host ""
}


# ============================================================
# TOKEN-REFRESH HILFSFUNKTION
# ============================================================
function Assert-GraphConnection {
    # Prueft ob Graph-Token noch gueltig ist und verbindet neu falls noetig
    # Unterscheidet zwischen DLL-Konflikt (PnP-Problem) und echtem Token-Ablauf
    try {
        $Ctx = Get-MgContext
        if (-not $Ctx) { throw "Kein Context" }
        # Schneller Test-Call - /me funktioniert NUR bei delegierter Auth
        # Bei App-only (Client Secret) anderen Endpoint verwenden
        if (-not [string]::IsNullOrWhiteSpace($Global:ClientSecret)) {
            # App-only: organization endpoint statt /me
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/organization?`$select=id" -ErrorAction Stop | Out-Null
        } else {
            Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/me?`$select=id" -ErrorAction Stop | Out-Null
        }
        return $true
    } catch {
        $ErrMsg = $_.Exception.Message
        # DLL-Konflikt (PnP.PowerShell hat Graph.Core 1.25.1 geladen) - KEIN Reconnect noetig
        if ($ErrMsg -like '*AzureIdentityAccessTokenProvider*' -or $ErrMsg -like '*Microsoft.Graph.Core*' -or $ErrMsg -like '*TypeLoadException*') {
            Write-Log "DLL-Versionskonflikt erkannt (PnP.PowerShell vs Microsoft.Graph)." -Level Warning
            Write-Log "Workaround: Starte PowerShell neu und lade Module in Reihenfolge: Graph -> Exchange -> PnP" -Level Warning
            # Trotzdem weitermachen - manche Cmdlets funktionieren trotz des Fehlers
            return $true
        }
        Write-Log "Graph-Token abgelaufen - verbinde neu..." -Level Warning
        try {
            $RParams = @{ ErrorAction = 'Stop' }
            if (-not [string]::IsNullOrWhiteSpace($Global:ClientId))          { $RParams['ClientId']    = $Global:ClientId }
            if (-not [string]::IsNullOrWhiteSpace($TenantId))                 { $RParams['TenantId']    = $TenantId }
            if (-not [string]::IsNullOrWhiteSpace($Global:CloudEnvironment))  { $RParams['Environment'] = $Global:CloudEnvironment }

            if (-not [string]::IsNullOrWhiteSpace($Global:ClientSecret) -and
                -not [string]::IsNullOrWhiteSpace($Global:ClientId) -and
                -not [string]::IsNullOrWhiteSpace($TenantId)) {
                $SecSec  = ConvertTo-SecureString $Global:ClientSecret -AsPlainText -Force
                $RCred   = New-Object System.Management.Automation.PSCredential($Global:ClientId, $SecSec)
                $RAppOnly = @{ ClientSecretCredential = $RCred; TenantId = $TenantId; ErrorAction = 'Stop' }
                if (-not [string]::IsNullOrWhiteSpace($Global:CloudEnvironment)) { $RAppOnly['Environment'] = $Global:CloudEnvironment }
                Connect-MgGraph @RAppOnly -NoWelcome
            } else {
                $env:MSAL_DISABLE_WAM = '1'
                [System.Environment]::SetEnvironmentVariable('MSAL_DISABLE_WAM','1','Process')
                $RScopes = @('User.Read.All','Group.Read.All','Directory.Read.All','Policy.Read.All',
                    'Application.Read.All','AuditLog.Read.All','DeviceManagementConfiguration.Read.All',
                    'DeviceManagementManagedDevices.Read.All','TeamSettings.Read.All','Sites.Read.All',
                    'Reports.Read.All','IdentityRiskyUser.Read.All','IdentityRiskEvent.Read.All',
                    'UserAuthenticationMethod.Read.All','RoleManagement.Read.Directory','Organization.Read.All')
                $RParams['Scopes'] = $RScopes
                $RParams['UseDeviceAuthentication'] = $true
                Connect-MgGraph @RParams
            }
            Write-Log "Graph-Token erneuert." -Level Success
            return $true
        } catch {
            Write-Log "Graph-Reconnect fehlgeschlagen: $($_.Exception.Message)" -Level Error
            return $false
        }
    }
}

# ============================================================
# ENTRA ID DATENSAMMLUNG
# ============================================================
function Get-EntraIDData {
    Write-Progress-Status "Entra ID" "Sammle Benutzer..." 10
    if (-not $Global:Connected.Graph) {
        Write-Log "Graph nicht verbunden – Entra ID wird übersprungen." -Level Warning
        return $false
    }

    if (-not (Assert-GraphConnection)) { return $false }
    try {
        # Benutzer
        Start-Step "Entra-Benutzer"
        Write-Log "Lade alle Benutzer..." -Level Info
        $Users = Get-MgUser -All -Property Id,DisplayName,UserPrincipalName,AccountEnabled,CreatedDateTime,LastPasswordChangeDateTime,PasswordPolicies,UserType,Department,JobTitle,Mail,MobilePhone,OnPremisesSyncEnabled,AssignedLicenses,SignInActivity -ErrorAction Stop
        Stop-Step "Entra-Benutzer"
        Write-VerboseData "Benutzer geladen" $Users.Count
        $GuestUsers  = $Users | Where-Object { $_.UserType -eq 'Guest' }
        $EnabledUsers = $Users | Where-Object { $_.AccountEnabled -eq $true -and $_.UserType -eq 'Member' }
        $DisabledUsers = $Users | Where-Object { $_.AccountEnabled -eq $false }

        # MFA-Status pro Benutzer (Authentication Methods)
        # Nur interne Member-Accounts (keine #EXT#-Gastkonten die sich ueber Home-Tenant authentifizieren)
        Start-Step "MFA-Check"
        if ($Global:SkipMFA) { Write-Log "MFA-Check uebersprungen (-SkipMFA)" -Level Warning }
        Write-Log "Prüfe MFA-Status..." -Level Info
        $InternalUsers = $EnabledUsers | Where-Object { $_.UserPrincipalName -notlike '*#EXT#*' }
        $MFAData = @{}
        if (-not $Global:SkipMFA) { foreach ($User in $InternalUsers | Select-Object -First 500) {
            try {
                $Methods = Get-MgUserAuthenticationMethod -UserId $User.Id -ErrorAction SilentlyContinue
                # Passwort-Methode (#microsoft.graph.passwordAuthenticationMethod) zaehlt nicht als MFA
                $MFAMethods = $Methods | Where-Object {
                    $_.AdditionalProperties['@odata.type'] -ne '#microsoft.graph.passwordAuthenticationMethod'
                }
                $MFAData[$User.Id] = @{
                    HasMFA      = ($MFAMethods.Count -gt 0)
                    MethodCount = $MFAMethods.Count
                    Methods     = ($MFAMethods | Select-Object -ExpandProperty AdditionalProperties | ForEach-Object { $_['@odata.type'] -replace '#microsoft.graph.','' }) -join ', '
                }
            } catch {}
        } } # end foreach / end SkipMFA
        # Nur User zaehlen die auch abgefragt wurden (API-Fehler nicht als 'kein MFA' werten)
        $MFAEnabled  = ($MFAData.Values | Where-Object { $_.HasMFA }).Count
        $MFADisabled = $MFAData.Count - $MFAEnabled
        $MFASkipped  = $InternalUsers.Count - $MFAData.Count  # Nicht abfragbar (Berechtigungsfehler etc.)
        Stop-Step "MFA-Check"
        Write-VerboseData "MFA enabled/disabled/skipped" "$MFAEnabled / $MFADisabled / $MFASkipped"

        # Gruppen
        Start-Step "Entra-Gruppen"
        Write-Log "Lade Gruppen..." -Level Info
        $Groups = Get-MgGroup -All -Property Id,DisplayName,GroupTypes,SecurityEnabled,MailEnabled,MembershipRule,CreatedDateTime,Description -ErrorAction Stop
        $M365Groups    = $Groups | Where-Object { $_.GroupTypes -contains 'Unified' }
        $SecurityGroups = $Groups | Where-Object { $_.SecurityEnabled -eq $true -and $_.GroupTypes -notcontains 'Unified' }
        $DynamicGroups  = $Groups | Where-Object { $_.MembershipRule -ne $null -and $_.MembershipRule -ne '' }
        Stop-Step "Entra-Gruppen"
        Write-VerboseData "Gruppen" "$($Groups.Count) total, $($M365Groups.Count) M365, $($SecurityGroups.Count) Security, $($DynamicGroups.Count) Dynamic"

        # Conditional Access Policies
        Write-Log "Lade Conditional Access Policies..." -Level Info
        $CAPolicies = Get-MgIdentityConditionalAccessPolicy -All -ErrorAction SilentlyContinue
        $CAEnabled   = $CAPolicies | Where-Object { $_.State -eq 'enabled' }
        $CADisabled  = $CAPolicies | Where-Object { $_.State -ne 'enabled' }

        # CA-basierte MFA-Durchsetzung pruefen
        $MFACAPolicies = $CAEnabled | Where-Object {
            $_.GrantControls -and (
                $_.GrantControls.BuiltInControls -contains 'mfa' -or
                $_.GrantControls.AuthenticationStrength -ne $null
            )
        }
        $MFAViaCA      = $MFACAPolicies.Count -gt 0
        # Policies die explizit ALLE User UND ALLE Apps abdecken
        $MFACACoversAll = @($MFACAPolicies | Where-Object {
            $_.Conditions.Users.IncludeUsers -contains 'All' -and
            $_.Conditions.Applications.IncludeApplications -contains 'All'
        })

        # Rollen & Zuweisungen
        Write-Log "Lade Rollen..." -Level Info
        $Roles = Get-MgDirectoryRole -All -ErrorAction SilentlyContinue
        $RoleAssignments = @()
        $PrivilegedRoles = @('Global Administrator','Privileged Role Administrator','Security Administrator','Exchange Administrator','SharePoint Administrator','User Administrator','Conditional Access Administrator','Application Administrator')
        foreach ($Role in $Roles | Where-Object { $_.DisplayName -in $PrivilegedRoles }) {
            try {
                $Members = Get-MgDirectoryRoleMember -DirectoryRoleId $Role.Id -ErrorAction SilentlyContinue
                foreach ($Member in $Members) {
                    $RoleAssignments += [PSCustomObject]@{
                        RoleName   = $Role.DisplayName
                        MemberId   = $Member.Id
                        MemberType = $Member.AdditionalProperties['@odata.type']
                        MemberName = $Member.AdditionalProperties['displayName']
                        MemberUPN  = $Member.AdditionalProperties['userPrincipalName']
                    }
                }
            } catch {}
        }

        # App-Registrierungen
        Write-Log "Lade App-Registrierungen..." -Level Info
        $Apps = Get-MgApplication -All -Property Id,DisplayName,CreatedDateTime,SignInAudience,PasswordCredentials,KeyCredentials,RequiredResourceAccess -ErrorAction SilentlyContinue
        $AppsWithExpiredCreds = $Apps | Where-Object {
            ($_.PasswordCredentials | Where-Object { $_.EndDateTime -lt (Get-Date) }).Count -gt 0 -or
            ($_.KeyCredentials      | Where-Object { $_.EndDateTime -lt (Get-Date) }).Count -gt 0
        }
        $AppsExpiringIn30Days = $Apps | Where-Object {
            ($_.PasswordCredentials | Where-Object { $_.EndDateTime -gt (Get-Date) -and $_.EndDateTime -lt (Get-Date).AddDays(30) }).Count -gt 0
        }

        # Enterprise Apps (Service Principals)
        $ServicePrincipals = Get-MgServicePrincipal -All -Property Id,DisplayName,AppId,AccountEnabled,CreatedDateTime,Tags -ErrorAction SilentlyContinue

        # Authentication Methods Policy (Tenant-weit)
        $AuthMethodsPolicy = Get-MgPolicyAuthenticationMethodPolicy -ErrorAction SilentlyContinue

        # Password Policy / SSPR
        $PasswordResetPolicy = Get-MgPolicyAuthorizationPolicy -ErrorAction SilentlyContinue

        # Identity Protection: Risky Users
        $RiskyUsers = @()
        try { $RiskyUsers = Get-MgRiskyUser -All -Filter "riskState eq 'atRisk' or riskState eq 'confirmedCompromised'" -ErrorAction SilentlyContinue } catch {}


        # ── Tenant-Metadaten ──────────────────────────────────────────────────────
        Write-Log "Lade Tenant-Metadaten und Lizenzen..." -Level Info
        $OrgData = $null
        try {
            $OrgResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/organization?`$select=id,displayName,createdDateTime,verifiedDomains,onPremisesSyncEnabled,onPremisesLastSyncDateTime,technicalNotificationMails,defaultUsageLocation" -ErrorAction SilentlyContinue
            $OrgData = $OrgResp.value[0]
        } catch {}
        $VerifiedDomains = if ($OrgData) { $OrgData.verifiedDomains } else { @() }
        $InitialDomain   = $VerifiedDomains | Where-Object { $_.isInitial -eq $true }  | Select-Object -First 1
        $DefaultDomain   = $VerifiedDomains | Where-Object { $_.isDefault -eq $true }  | Select-Object -First 1
        $TenantName      = if ($OrgData) { $OrgData.displayName } else { "Unbekannt" }
        $TenantCreated   = if ($OrgData -and $OrgData.createdDateTime) { ([datetime]$OrgData.createdDateTime).ToString("dd.MM.yyyy") } else { "Unbekannt" }
        $HybridSync      = if ($OrgData) { $OrgData.onPremisesSyncEnabled -eq $true } else { $false }
        $LastSyncTime    = if ($OrgData -and $OrgData.onPremisesLastSyncDateTime) { ([datetime]$OrgData.onPremisesLastSyncDateTime).ToString("dd.MM.yyyy HH:mm") } else { "n/a" }

        # ── Lizenz-Inventar ───────────────────────────────────────────────────────
        $SubscribedSKUs = @()
        try {
            $SKUResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/subscribedSkus" -ErrorAction SilentlyContinue
            $FriendlyNames = @{
                "SPE_E3"="Microsoft 365 E3"; "SPE_E5"="Microsoft 365 E5"
                "ENTERPRISEPACK"="Office 365 E3"; "ENTERPRISEPREMIUM"="Office 365 E5"
                "SPB"="Microsoft 365 Business Premium"; "O365_BUSINESS_PREMIUM"="Microsoft 365 Business Standard"
                "O365_BUSINESS_ESSENTIALS"="Microsoft 365 Business Basic"; "AAD_PREMIUM"="Entra ID P1"
                "AAD_PREMIUM_P2"="Entra ID P2"; "INTUNE_A"="Intune Plan 1"; "EMS"="EMS E3"; "EMSPREMIUM"="EMS E5"
                "ATP_ENTERPRISE"="Defender for Office 365 P1"; "THREAT_INTELLIGENCE"="Defender for Office 365 P2"
                "EXCHSTANDARD"="Exchange Online Plan 1"; "EXCHENTERPRISE"="Exchange Online Plan 2"
                "POWER_BI_PRO"="Power BI Pro"; "POWER_BI_PREMIUM_PER_USER"="Power BI Premium Per User"
                "PROJECTPREMIUM"="Project Plan 5"; "DEVELOPERPACK_E5"="Microsoft 365 E5 Developer"
            }
            $SubscribedSKUs = $SKUResp.value | ForEach-Object {
                $En = $_.prepaidUnits.enabled; $As = $_.consumedUnits
                [PSCustomObject]@{
                    SkuPartNum   = $_.skuPartNumber
                    FriendlyName = if ($FriendlyNames[$_.skuPartNumber]) { $FriendlyNames[$_.skuPartNumber] } else { $_.skuPartNumber }
                    Enabled      = $En
                    Assigned     = $As
                    Available    = $En - $As
                    CapStatus    = $_.capabilityStatus
                }
            } | Sort-Object Assigned -Descending
        } catch { Write-Log "Lizenz-Abfrage fehlgeschlagen: $($_.Exception.Message.Split("`n")[0])" -Level Warning }
        # Nur bezahlte Lizenzen zaehlen (keine Free/Trial/Store-SKUs)
        $_FreeSKUs = @('FLOW_FREE','POWER_BI_STANDARD','WINDOWS_STORE','RIGHTSMANAGEMENT_ADHOC','TEAMS_EXPLORATORY','POWER_BI_PRO')
        $PaidSKUs = $SubscribedSKUs | Where-Object { $_.Enabled -lt 10000 -and $_.SkuPartNum -notin $_FreeSKUs -and $_.Enabled -gt 0 }
        $TotalLicenses    = ($PaidSKUs | Measure-Object -Property Enabled  -Sum).Sum
        $AssignedLicenses = ($PaidSKUs | Measure-Object -Property Assigned -Sum).Sum
        $UnusedLicenses   = $TotalLicenses - $AssignedLicenses

        # ── Sign-In-Aktivitaet / Inaktive Benutzer ────────────────────────────────
        Write-Log "Pruefe Sign-In-Aktivitaet (benoetigt AAD P1/P2)..." -Level Info
        $InactiveUsers90 = @(); $InactiveUsers30 = @(); $NeverSignedIn = @()
        try {
            $SIUri = "https://graph.microsoft.com/v1.0/users?`$select=id,displayName,userPrincipalName,signInActivity,assignedLicenses&`$top=200&`$filter=accountEnabled eq true and userType eq 'Member'"
            $SIResp = Invoke-MgGraphRequest -Method GET -Uri $SIUri -ErrorAction SilentlyContinue
            $SIUsers = [System.Collections.Generic.List[object]]::new()
            if ($SIResp.value) { $SIUsers.AddRange($SIResp.value) }
            while ($SIResp."@odata.nextLink") {
                $SIResp = Invoke-MgGraphRequest -Method GET -Uri $SIResp."@odata.nextLink" -ErrorAction SilentlyContinue
                if ($SIResp.value) { $SIUsers.AddRange($SIResp.value) }
            }
            $Cut90 = (Get-Date).AddDays(-90); $Cut30 = (Get-Date).AddDays(-30)
            foreach ($U in $SIUsers) {
                if ($U.userPrincipalName -like "*#EXT#*") { continue }
                $LS   = if ($U.signInActivity -and $U.signInActivity.lastSignInDateTime) { [datetime]$U.signInActivity.lastSignInDateTime } else { $null }
                $HasL = ($U.assignedLicenses.Count -gt 0)
                $Row  = [PSCustomObject]@{ DisplayName=$U.displayName; UPN=$U.userPrincipalName; HasLicense=$HasL; LastSignIn=if($LS){$LS.ToString("dd.MM.yyyy")}else{"Nie"} }
                if     ($null -eq $LS)        { $NeverSignedIn   += $Row }
                elseif ($LS -lt $Cut90)       { $InactiveUsers90 += $Row }
                elseif ($LS -lt $Cut30)       { $InactiveUsers30 += $Row }
            }
        } catch { Write-Log "Sign-In-Daten nicht verfuegbar: $($_.Exception.Message.Split("`n")[0])" -Level Warning }

        # ── App-Permission Detail (High-Risk-Permissions) ─────────────────────────
        if ($Global:SkipAppPerms) { Write-Log "App-Permission-Analyse uebersprungen (-SkipAppPerms)" -Level Warning }
        Write-Log "Analysiere App-Berechtigungen..." -Level Info
        $AppPermDetails = @()
        $HighRiskPerms  = @("Mail.Read.All","Mail.ReadWrite.All","Mail.Send","Files.Read.All","Files.ReadWrite.All",
            "Sites.FullControl.All","Directory.ReadWrite.All","RoleManagement.ReadWrite.Directory",
            "User.ReadWrite.All","Application.ReadWrite.All","Policy.ReadWrite.All",
            "DeviceManagementConfiguration.ReadWrite.All","SecurityEvents.ReadWrite.All")
        if (-not $Global:SkipAppPerms) { try {
            $SPFilter = $ServicePrincipals | Where-Object { $_.AccountEnabled -eq $true -and $_.Tags -contains "WindowsAzureActiveDirectoryIntegratedApp" } | Select-Object -First 80
            foreach ($SP in $SPFilter) {
                try {
                    $OAuth2 = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($SP.Id)/oauth2PermissionGrants" -ErrorAction SilentlyContinue
                    $AppRA  = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($SP.Id)/appRoleAssignments" -ErrorAction SilentlyContinue
                    $Scopes = (($OAuth2.value | ForEach-Object { $_.scope }) -join " ").Trim()
                    $AppRoleNames = ($AppRA.value | ForEach-Object { $_.principalDisplayName }) -join ", "
                    $IsHigh = ($HighRiskPerms | Where-Object { $Scopes -like "*$_*" -or $AppRoleNames -like "*$_*" }).Count -gt 0
                    if ($Scopes -or $AppRoleNames) {
                        $AppPermDetails += [PSCustomObject]@{
                            AppName    = $SP.DisplayName
                            AppId      = $SP.AppId
                            Scopes     = if ($Scopes.Length -gt 300) { $Scopes.Substring(0,300)+"..." } else { $Scopes }
                            AppRoles   = $AppRoleNames
                            IsHighRisk = $IsHigh
                        }
                    }
                } catch {}
            }
        } catch { Write-Log "App-Berechtigungs-Analyse fehlgeschlagen." -Level Warning } } # end SkipAppPerms
        $HighRiskApps = $AppPermDetails | Where-Object { $_.IsHighRisk }

        # ── B2B / Cross-Tenant / Named Locations ──────────────────────────────────
        Write-Log "Pruefe B2B-Konfiguration und CA Named Locations..." -Level Info
        $B2BPolicy          = $null
        $CrossTenantPartners = @()
        $NamedLocations     = @()
        $ReportOnlyCA       = $CAPolicies | Where-Object { $_.State -eq "enabledForReportingButNotEnforced" }
        try { $B2BPolicy = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/policies/authorizationPolicy" -ErrorAction SilentlyContinue } catch {}
        try {
            $CTPResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy/partners" -ErrorAction SilentlyContinue
            $CrossTenantPartners = $CTPResp.value
        } catch {}
        try {
            $NLResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/namedLocations" -ErrorAction SilentlyContinue
            $NamedLocations = $NLResp.value
        } catch {}
        # CA-Luecken: Benutzer die von mindestens einer Policy ausgeschlossen sind
        $AllExcludedCA = @{}
        foreach ($CA in $CAEnabled) {
            foreach ($Id in (@($CA.Conditions.Users.ExcludeUsers) + @($CA.Conditions.Users.ExcludeGroups))) {
                if ($Id) { $AllExcludedCA[$Id] = $true }
            }
        }

        # ── Purview / Data Governance ─────────────────────────────────────────────
        Write-Log "Pruefe Data Governance..." -Level Info
        $SensitivityLabels = @(); $RetentionLabels = @()
        try {
            $LResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/informationProtection/policy/labels" -ErrorAction Stop
            $SensitivityLabels = $LResp.value
        } catch {}
        try {
            $RResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/security/labels/retentionLabels" -ErrorAction SilentlyContinue
            $RetentionLabels = $RResp.value
        } catch {}

        # ── PIM (Privileged Identity Management) ────────────────────────────────
        Write-Log "Pruefe PIM-Status..." -Level Info
        $PIMEnabled = $false
        $PIMRoleAssignments = @()
        $PIMEligibleRoles   = @()
        try {
            # Aktive PIM-Rollenzuweisungen (zeitgebunden)
            $PIMResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignmentScheduleInstances?`$expand=principal,roleDefinition" -ErrorAction Stop
            $PIMRoleAssignments = $PIMResp.value | ForEach-Object {
                [PSCustomObject]@{
                    RoleName      = $_.roleDefinition.displayName
                    PrincipalName = $_.principal.displayName
                    PrincipalUPN  = $_.principal.userPrincipalName
                    AssignmentType = $_.assignmentType  # 'Assigned' oder 'Activated'
                    StartDateTime = $_.startDateTime
                    EndDateTime   = $_.endDateTime
                    IsPermanent   = ($null -eq $_.endDateTime)
                    MemberType    = $_.memberType
                }
            }
            $PIMEnabled = $true
            # Berechtigte (eligible) Rollen
            $PIMEligResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?`$expand=principal,roleDefinition" -ErrorAction SilentlyContinue
            if ($PIMEligResp.value) {
                $PIMEligibleRoles = $PIMEligResp.value | ForEach-Object {
                    [PSCustomObject]@{
                        RoleName      = $_.roleDefinition.displayName
                        PrincipalName = $_.principal.displayName
                        PrincipalUPN  = $_.principal.userPrincipalName
                        StartDateTime = $_.startDateTime
                        EndDateTime   = $_.endDateTime
                    }
                }
            }
        } catch {
            Write-Log "PIM nicht verfuegbar (kein Entra ID P2 oder fehlende Berechtigung): $($_.Exception.Message.Split([char]10)[0])" -Level Verbose
        }

        # ── Enterprise Apps (Service Principals mit hohen Permissions) ───────────
        Write-Log "Pruefe Enterprise Apps..." -Level Info
        $EnterpriseApps = @()
        $DangerousEnterpriseApps = @()
        $HighRiskScopes = @('Mail.Read','Mail.ReadWrite','Mail.Send','Mail.Read.All','Mail.ReadWrite.All','Files.ReadWrite.All','Directory.ReadWrite.All','RoleManagement.ReadWrite.Directory','User.ReadWrite.All','Application.ReadWrite.All','full_access_as_app')
        try {
            # OAuth2-Grants (delegierte Permissions von Enterprise Apps)
            $OAuthGrants = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?`$top=999" -ErrorAction SilentlyContinue
            $SPMap = @{}
            foreach ($SP in $ServicePrincipals) { $SPMap[$SP.Id] = $SP.DisplayName }
            if ($OAuthGrants.value) {
                $EnterpriseApps = $OAuthGrants.value | ForEach-Object {
                    $AppName = $SPMap[$_.clientId]
                    if (-not $AppName) { $AppName = $_.clientId }
                    $Scopes = $_.scope -split ' '
                    $IsHighRisk = ($Scopes | Where-Object { $_ -in $HighRiskScopes }).Count -gt 0
                    [PSCustomObject]@{
                        AppName     = $AppName
                        ClientId    = $_.clientId
                        ConsentType = $_.consentType  # 'AllPrincipals' oder 'Principal'
                        Scopes      = $_.scope
                        IsHighRisk  = $IsHighRisk
                        HighRiskScopes = ($Scopes | Where-Object { $_ -in $HighRiskScopes }) -join ', '
                    }
                }
                $DangerousEnterpriseApps = $EnterpriseApps | Where-Object { $_.IsHighRisk -and $_.ConsentType -eq 'AllPrincipals' }
            }
        } catch { Write-Log "Enterprise Apps nicht abrufbar: $($_.Exception.Message.Split([char]10)[0])" -Level Verbose }

        # ── SSPR (Self-Service Password Reset) ───────────────────────────────────
        Write-Log "Pruefe SSPR-Konfiguration..." -Level Info
        $SSPRPolicy = $null
        try {
            $SSPRResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy" -ErrorAction Stop
            $SSPRPolicy = $SSPRResp
        } catch { Write-Log "SSPR-Policy nicht abrufbar" -Level Verbose }

        # ── Tenant-Einstellungen (Admin Center) ──────────────────────────────────
        Write-Log "Pruefe Tenant-Einstellungen..." -Level Info
        $TenantSettings = @{}
        try {
            # User darf Apps registrieren?
            $UserSettingsResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/policies/authorizationPolicy" -ErrorAction SilentlyContinue
            $TenantSettings['UsersCanRegisterApps']     = $UserSettingsResp.defaultUserRolePermissions.allowedToCreateApps
            $TenantSettings['UsersCanCreateTenants']    = $UserSettingsResp.defaultUserRolePermissions.allowedToCreateTenants
            $TenantSettings['UsersCanCreateSecGroups']  = $UserSettingsResp.defaultUserRolePermissions.allowedToCreateSecurityGroups
            $TenantSettings['GuestInvitePolicy']        = $UserSettingsResp.allowInvitesFrom  # 'adminsAndGuestInviters','admins','everyone','none'
            $TenantSettings['LinkedInEnabled']          = $UserSettingsResp.allowedToUseSSPR
        } catch { Write-Log "Tenant-Einstellungen nicht abrufbar" -Level Verbose }
        try {
            # Unternehmensbranding konfiguriert?
            $BrandingResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/organization?`$select=id" -ErrorAction SilentlyContinue
            $OrgId = $BrandingResp.value[0].id
            $BrandResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/organization/$OrgId/branding" -ErrorAction SilentlyContinue
            $TenantSettings['BrandingConfigured'] = ($null -ne $BrandResp -and $BrandResp.id -ne $null)
        } catch { $TenantSettings['BrandingConfigured'] = $false }
        try {
            # Audit Log Status
            $AuditResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/security/auditLog/queries?`$top=1" -ErrorAction SilentlyContinue
            $TenantSettings['AuditLogEnabled'] = $true
        } catch { $TenantSettings['AuditLogEnabled'] = $false }

        # ─────────────────────────────────────────────────────────────────────────
        $ReportData.EntraID = @{
            TotalUsers          = $Users.Count
            EnabledUsers        = $EnabledUsers.Count
            DisabledUsers       = $DisabledUsers.Count
            GuestUsers          = $GuestUsers.Count
            Users               = $Users | Select-Object -First 2000
            MFAEnabled          = $MFAEnabled
            MFADisabled         = $MFADisabled
            MFAData             = $MFAData
            TotalGroups         = $Groups.Count
            M365Groups          = $M365Groups
            SecurityGroups      = $SecurityGroups
            DynamicGroups       = $DynamicGroups
            CAPolicies          = $CAPolicies
            CAEnabled           = $CAEnabled.Count
            CADisabled          = $CADisabled.Count
            ReportOnlyCA        = $ReportOnlyCA
            NamedLocations      = $NamedLocations
            AllExcludedCA       = $AllExcludedCA
            IDNameMap           = $IDNameMap
            MFAViaCA            = $MFAViaCA
            MFACAPolicies       = $MFACAPolicies
            MFACACoversAll      = $MFACACoversAll
            RoleAssignments     = $RoleAssignments
            Apps                = $Apps
            AppsExpired         = $AppsWithExpiredCreds
            AppsExpiring        = $AppsExpiringIn30Days
            AppPermDetails      = $AppPermDetails
            HighRiskApps        = $HighRiskApps
            ServicePrincipals   = $ServicePrincipals
            RiskyUsers          = $RiskyUsers
            AuthMethodsPolicy   = $AuthMethodsPolicy
            TenantId            = (Get-MgContext).TenantId
            TenantDomain        = (Get-MgContext).Account -replace '^.*@',''
            TenantName          = $TenantName
            TenantCreated       = $TenantCreated
            VerifiedDomains     = $VerifiedDomains
            InitialDomain       = $InitialDomain
            DefaultDomain       = $DefaultDomain
            HybridSync          = $HybridSync
            LastSyncTime        = $LastSyncTime
            Licenses            = $SubscribedSKUs
            TotalLicenses       = $TotalLicenses
            AssignedLicenses    = $AssignedLicenses
            UnusedLicenses      = $UnusedLicenses
            InactiveUsers90     = $InactiveUsers90
            InactiveUsers30     = $InactiveUsers30
            NeverSignedIn       = $NeverSignedIn
            B2BPolicy           = $B2BPolicy
            CrossTenantPartners = $CrossTenantPartners
            SensitivityLabels       = $SensitivityLabels
            RetentionLabels         = $RetentionLabels
            PIMEnabled              = $PIMEnabled
            PIMRoleAssignments      = $PIMRoleAssignments
            PIMEligibleRoles        = $PIMEligibleRoles
            EnterpriseApps          = $EnterpriseApps
            DangerousEnterpriseApps = $DangerousEnterpriseApps
            SSPRPolicy              = $SSPRPolicy
            TenantSettings          = $TenantSettings
        }

        Write-Log "Entra ID: $($Users.Count) Benutzer, $($Groups.Count) Gruppen, $($CAPolicies.Count) CA-Policies, $($Apps.Count) App-Registrierungen" -Level Success
        return $true
    }
    catch {
        Write-Log "Fehler bei Entra ID Datensammlung: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ============================================================
# EXCHANGE ONLINE DATENSAMMLUNG
# ============================================================
function Get-ExchangeData {
    Write-Progress-Status "Exchange Online" "Sammle Mailboxen..." 30
    if (-not $Global:Connected.Exchange) {
        Write-Log "Exchange nicht verbunden – wird übersprungen." -Level Warning
        return $false
    }

    try {
        # Mailboxen
        Start-Step "Exchange-Mailboxen"
        Write-Log "Lade Mailboxen..." -Level Info
        $Mailboxes = Get-EXOMailbox -ResultSize Unlimited -Properties DisplayName,PrimarySmtpAddress,RecipientTypeDetails,IsInactiveMailbox,ForwardingAddress,ForwardingSmtpAddress,DeliverToMailboxAndForward,AuditEnabled,AuditAdmin,AuditDelegate,AuditOwner,RetainDeletedItemsFor,LitigationHoldEnabled,LitigationHoldDate,LitigationHoldOwner,LitigationHoldDuration,InPlaceHolds,RetentionHoldEnabled,RetentionPolicy,SingleItemRecoveryEnabled,DelayHoldApplied,ComplianceTagHoldApplied -ErrorAction Stop

        # Postfachgroessen (Get-EXOMailboxStatistics - separater Aufruf)
        Stop-Step "Exchange-Mailboxen"
        Start-Step "Postfachgroessen"
        Write-Log "Lade Postfachgroessen..." -Level Info
        $MailboxSizeMap = @{}
        try {
            # Alle Mailboxen per Pipeline uebergeben - EXOMailboxStatistics benoetigt Identity
            $MBStats = $Mailboxes | Get-EXOMailboxStatistics -ErrorAction SilentlyContinue
            foreach ($S in $MBStats) {
                # TotalItemSize als lesbare Groesse extrahieren (z.B. "1.5 GB (1,610,612,736 bytes)")
                $SizeStr  = $S.TotalItemSize.ToString()
                $SizeBytes = 0
                if ($SizeStr -match '\(([0-9,]+)\s+bytes\)') {
                    $SizeBytes = [long]($Matches[1] -replace ',','')
                }
                $SizeGB = [math]::Round($SizeBytes / 1GB, 2)
                $MailboxSizeMap[$S.DisplayName] = @{
                    SizeGB    = $SizeGB
                    SizeStr   = $SizeStr -replace '\s*\(.*\)',''
                    ItemCount = $S.ItemCount
                }
            }
        Stop-Step "Postfachgroessen"
        } catch { Write-Log "Postfachgroessen nicht abrufbar: $($_.Exception.Message.Split([char]10)[0])" -Level Warning }
        $UserMailboxes     = $Mailboxes | Where-Object { $_.RecipientTypeDetails -eq 'UserMailbox' }
        $SharedMailboxes   = $Mailboxes | Where-Object { $_.RecipientTypeDetails -eq 'SharedMailbox' }
        $ResourceMailboxes = $Mailboxes | Where-Object { $_.RecipientTypeDetails -in @('RoomMailbox','EquipmentMailbox') }
        $ForwardingEnabled = $Mailboxes | Where-Object { $_.ForwardingSmtpAddress -ne $null -or $_.ForwardingAddress -ne $null }
        $ExternalForwarding = $ForwardingEnabled | Where-Object {
            ($_.ForwardingSmtpAddress -and $_.ForwardingSmtpAddress -notlike "*$($_.PrimarySmtpAddress.Split('@')[1])") -or
            $_.ForwardingSmtpAddress -ne $null
        }

        # Anti-Spam Policies
        Write-Log "Lade Anti-Spam Policies..." -Level Info
        $AntiSpamPolicies    = Get-HostedContentFilterPolicy -ErrorAction SilentlyContinue
        $AntiPhishPolicies   = Get-AntiPhishPolicy -ErrorAction SilentlyContinue
        $AntiMalwarePolicies = Get-MalwareFilterPolicy -ErrorAction SilentlyContinue
        # Safe Attachments/Links benoetigen Defender for Office 365 Plan 1/2
        $SafeAttachPolicies  = @()
        $SafeLinksPolicies   = @()
        try { $SafeAttachPolicies = Get-SafeAttachmentPolicy -ErrorAction Stop } catch {
            Write-Log "Safe Attachment Policies nicht verfuegbar (Defender for Office 365 nicht lizenziert)" -Level Warning
        }
        try { $SafeLinksPolicies = Get-SafeLinksPolicy -ErrorAction Stop } catch {
            Write-Log "Safe Links Policies nicht verfuegbar (Defender for Office 365 nicht lizenziert)" -Level Warning
        }

        # DKIM
        Write-Log "Prüfe DKIM-Status..." -Level Info
        $DKIMConfigs = Get-DkimSigningConfig -ErrorAction SilentlyContinue

        # SPF-Pruefung via DNS (Get-AcceptedDomain liefert Domains, dann DNS pruefen)
        Write-Log "Pruefe SPF-Records..." -Level Info
        $SPFResults = [System.Collections.Generic.List[object]]::new()
        try {
            $AccDomains = Get-AcceptedDomain -ErrorAction SilentlyContinue
            foreach ($Dom in $AccDomains | Where-Object { $_.DomainType -ne 'InternalRelay' }) {
                try {
                    $TxtRecords = Resolve-DnsName -Name $Dom.DomainName -Type TXT -ErrorAction SilentlyContinue
                    $SPFRecord  = $TxtRecords | Where-Object { $_.Strings -match 'v=spf1' } | Select-Object -First 1
                    $SPFResults.Add([PSCustomObject]@{
                        Domain     = $Dom.DomainName
                        HasSPF     = ($null -ne $SPFRecord)
                        SPFRecord  = if ($SPFRecord) { ($SPFRecord.Strings -join '') } else { 'KEIN SPF-RECORD' }
                        IsDefault  = $Dom.Default
                    })
                } catch {
                    $SPFResults.Add([PSCustomObject]@{ Domain=$Dom.DomainName; HasSPF=$false; SPFRecord='DNS-Fehler'; IsDefault=$Dom.Default })
                }
            }
        } catch { Write-Log "SPF-Pruefung fehlgeschlagen" -Level Verbose }

        # Transport Rules
        Write-Log "Lade Transport Rules..." -Level Info
        $TransportRules = Get-TransportRule -ErrorAction SilentlyContinue

        # Accepted Domains
        $AcceptedDomains = Get-AcceptedDomain -ErrorAction SilentlyContinue

        # Remote Domains (external mail flow)
        $RemoteDomains = Get-RemoteDomain -ErrorAction SilentlyContinue

        # Outbound Spam Policy
        $OutboundSpamPolicies = Get-HostedOutboundSpamFilterPolicy -ErrorAction SilentlyContinue

        # Organisation Config
        Write-Log "Lade Organisation-Konfiguration..." -Level Info
        $OrgConfig = Get-OrganizationConfig -ErrorAction SilentlyContinue

        # Mailbox Audit Config
        $AuditConfig = Get-AdminAuditLogConfig -ErrorAction SilentlyContinue

        # OAuth Apps (Modern Auth)
        $ModernAuthStatus = $OrgConfig.OAuth2ClientProfileEnabled

        # External Sender Tags (neue EXO-Funktion)
        $ExternalTagEnabled = $OrgConfig.EnableOutlookReAdsTagging

        # Spoof Intelligence
        $SpoofPolicies = Get-SpoofIntelligenceInsight -ErrorAction SilentlyContinue

        # Connectors
        $InboundConnectors  = Get-InboundConnector -ErrorAction SilentlyContinue
        $OutboundConnectors = Get-OutboundConnector -ErrorAction SilentlyContinue

        # Remote-Domaenen (Rich-Text-Format Pruefung)
        Write-Log "Pruefe Remote-Domaenen..." -Level Info
        $RemoteDomainsDetail = @()
        try {
            $RemoteDomainsDetail = Get-RemoteDomain -ErrorAction SilentlyContinue | ForEach-Object {
                [PSCustomObject]@{
                    Name           = $_.Name
                    DomainName     = $_.DomainName
                    TNEFEnabled    = $_.TNEFEnabled  # True = Rich-Text aktiv (Problem!)
                    AutoReplyEnabled = $_.AutoReplyEnabled
                    AutoForwardEnabled = $_.AutoForwardEnabled
                }
            }
        } catch {}

        # Postfach-Delegierungen (FullAccess, SendAs)
        Write-Log "Pruefe Postfach-Delegierungen..." -Level Info
        $MailboxDelegations = [System.Collections.Generic.List[object]]::new()
        try {
            foreach ($MB in $UserMailboxes | Select-Object -First 200) {
                try {
                    $Perms = Get-MailboxPermission -Identity $MB.PrimarySmtpAddress -ErrorAction SilentlyContinue |
                        Where-Object { $_.AccessRights -contains 'FullAccess' -and -not $_.IsInherited -and $_.User -notlike 'NT AUTHORITY*' }
                    foreach ($P in $Perms) {
                        $MailboxDelegations.Add([PSCustomObject]@{
                            Mailbox     = $MB.DisplayName
                            MailboxUPN  = $MB.PrimarySmtpAddress
                            Delegate    = $P.User
                            AccessRight = 'FullAccess'
                        })
                    }
                    $SendAs = Get-RecipientPermission -Identity $MB.PrimarySmtpAddress -ErrorAction SilentlyContinue |
                        Where-Object { $_.AccessRights -contains 'SendAs' -and $_.Trustee -notlike 'NT AUTHORITY*' }
                    foreach ($S in $SendAs) {
                        $MailboxDelegations.Add([PSCustomObject]@{
                            Mailbox     = $MB.DisplayName
                            MailboxUPN  = $MB.PrimarySmtpAddress
                            Delegate    = $S.Trustee
                            AccessRight = 'SendAs'
                        })
                    }
                } catch {}
            }
        } catch { Write-Log "Delegierungen nicht abrufbar: $($_.Exception.Message.Split([char]10)[0])" -Level Verbose }

        # Shared Mailboxes mit aktiviertem Login (Sicherheitsrisiko)
        $SharedMailboxWithLogin = $SharedMailboxes | Where-Object {
            # Shared Mailboxen sollten AccountEnabled=False haben
            $_.AccountEnabled -ne $false
        }

        # Litigation Holds & Retention
        Write-Log "Prüfe Holds und Retention Policies..." -Level Info
        $LitigationHoldMailboxes = $Mailboxes | Where-Object { $_.LitigationHoldEnabled -eq $true }
        $InPlaceHoldMailboxes    = $Mailboxes | Where-Object { $_.InPlaceHolds.Count -gt 0 }
        $RetentionHoldMailboxes  = $Mailboxes | Where-Object { $_.RetentionHoldEnabled -eq $true }
        $ComplianceTagHolds      = $Mailboxes | Where-Object { $_.ComplianceTagHoldApplied -eq $true }
        $DelayHolds              = $Mailboxes | Where-Object { $_.DelayHoldApplied -eq $true }
        # Retention Policies aus Compliance Center
        $RetentionPolicies = @()
        try {
            $RetentionPolicies = Get-RetentionCompliancePolicy -ErrorAction Stop
        } catch {
            Write-Log "Retention Compliance Policies nicht abrufbar (Lizenz/Berechtigung)" -Level Verbose
        }

        $ReportData.Exchange = @{
            TotalMailboxes      = $Mailboxes.Count
            UserMailboxes       = $UserMailboxes
            SharedMailboxes     = $SharedMailboxes
            ResourceMailboxes   = $ResourceMailboxes
            ForwardingEnabled   = $ForwardingEnabled
            ExternalForwarding  = $ExternalForwarding
            AntiSpamPolicies    = $AntiSpamPolicies
            AntiPhishPolicies   = $AntiPhishPolicies
            AntiMalwarePolicies = $AntiMalwarePolicies
            SafeAttachPolicies  = $SafeAttachPolicies
            SafeLinksPolicies   = $SafeLinksPolicies
            DKIMConfigs         = $DKIMConfigs
            TransportRules      = $TransportRules
            AcceptedDomains     = $AcceptedDomains
            RemoteDomains       = $RemoteDomains
            OutboundSpamPolicies = $OutboundSpamPolicies
            OrgConfig           = $OrgConfig
            ModernAuthEnabled   = $ModernAuthStatus
            AuditConfig         = $AuditConfig
            InboundConnectors        = $InboundConnectors
            OutboundConnectors       = $OutboundConnectors
            MailboxSizeMap           = $MailboxSizeMap
            LitigationHoldMailboxes  = $LitigationHoldMailboxes
            InPlaceHoldMailboxes     = $InPlaceHoldMailboxes
            RetentionHoldMailboxes   = $RetentionHoldMailboxes
            ComplianceTagHolds       = $ComplianceTagHolds
            DelayHolds               = $DelayHolds
            RetentionPolicies        = $RetentionPolicies
            AllMailboxes             = $Mailboxes
            MailboxDelegations       = $MailboxDelegations
            SharedMailboxWithLogin   = $SharedMailboxWithLogin
            RemoteDomainsDetail      = $RemoteDomainsDetail
            SPFResults               = $SPFResults
        }

        Write-Log "Exchange: $($Mailboxes.Count) Mailboxen, $($DKIMConfigs.Count) DKIM-Domains, $($TransportRules.Count) Transport Rules" -Level Success
        return $true
    }
    catch {
        Write-Log "Fehler bei Exchange Datensammlung: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ============================================================
# INTUNE DATENSAMMLUNG
# ============================================================
function Get-IntuneData {
    Write-Progress-Status "Intune" "Sammle Gerätedaten..." 50
    if (-not $Global:Connected.Graph) {
        Write-Log "Graph nicht verbunden – Intune wird übersprungen." -Level Warning
        return $false
    }

    if (-not (Assert-GraphConnection)) { return $false }
    try {
        # Managed Devices
        Start-Step "Intune-Geraete"
        Write-Log "Lade verwaltete Geräte..." -Level Info
        $Devices = Get-MgDeviceManagementManagedDevice -All -Property Id,DeviceName,OperatingSystem,OsVersion,ComplianceState,ManagementAgent,DeviceEnrollmentType,LastSyncDateTime,UserDisplayName,UserPrincipalName,Manufacturer,Model,SerialNumber,IsEncrypted,JailBroken,PartnerReportedThreatState,AzureADDeviceId,AzureADRegistered,DeviceRegistrationState,ManagedDeviceOwnerType -ErrorAction Stop

        $WindowsDevices = $Devices | Where-Object { $_.OperatingSystem -eq 'Windows' }
        $iOSDevices     = $Devices | Where-Object { $_.OperatingSystem -eq 'iOS' }
        $AndroidDevices = $Devices | Where-Object { $_.OperatingSystem -eq 'Android' }
        $MacOSDevices   = $Devices | Where-Object { $_.OperatingSystem -eq 'macOS' }
        $CompliantDevices    = $Devices | Where-Object { $_.ComplianceState -eq 'compliant' }
        $NonCompliantDevices = $Devices | Where-Object { $_.ComplianceState -eq 'noncompliant' }
        $NotEncrypted        = $Devices | Where-Object { $_.IsEncrypted -eq $false }

        # ── Hybrid-Analyse: Management-Typ pro Gerät ─────────────────────────────
        Start-Step "Hybrid-Analyse"
        Write-Log "Analysiere Geraete-Verwaltungstypen..." -Level Info

        # Management-Agent Klassifizierung
        $PureIntune         = @($Devices | Where-Object { $_.ManagementAgent -eq 'mdm' -or $_.ManagementAgent -eq 'easMdm' })
        $PureSCCM           = @($Devices | Where-Object { $_.ManagementAgent -eq 'configurationManagerClient' })
        $CoManaged          = @($Devices | Where-Object { $_.ManagementAgent -like 'configurationManagerClientMdm*' })
        $OtherMgmt          = @($Devices | Where-Object { $_.ManagementAgent -notin @('mdm','easMdm','configurationManagerClient') -and $_.ManagementAgent -notlike 'configurationManagerClientMdm*' })

        # Enrollment-Typ Klassifizierung
        $HybridAADJoin      = @($Devices | Where-Object { $_.DeviceEnrollmentType -eq 'windowsAzureADJoin' -or $_.DeviceEnrollmentType -eq 'windowsCoManagement' })
        $AutopilotEnrolled  = @($Devices | Where-Object { $_.DeviceEnrollmentType -eq 'windowsAutoEnrollment' -and ($_.DeviceName -like 'DESKTOP-*' -or $_.DeviceName -like 'LAPTOP-*') })
        $GPODomainJoined    = @($Devices | Where-Object { $_.ManagementAgent -like '*configurationManager*' -or $_.DeviceEnrollmentType -eq 'windowsCoManagement' })

        # On-Premises-Sync-Check: Geraete die wahrscheinlich GPO-gesteuert sind
        # Indikator: SCCM-Agent oder Enrollment via Domain (nicht User-Enrollment)
        $GPOLikelyDevices = @($Devices | Where-Object {
            $_.ManagementAgent -like '*configurationManager*' -or
            $_.DeviceEnrollmentType -in @('windowsCoManagement', 'deviceEnrollmentManager')
        })

        # Entra-Geraete fuer Join-Typ (separat von Intune-Geraeten)
        $EntraDevices = @()
        try {
            $EDResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/devices?`$select=displayName,operatingSystem,trustType,registrationDateTime,approximateLastSignInDateTime,isCompliant,isManaged&`$top=999" -ErrorAction SilentlyContinue
            if ($EDResp.value) {
                $EntraDevices = $EDResp.value | ForEach-Object {
                    [PSCustomObject]@{
                        Name         = $_.displayName
                        OS           = $_.operatingSystem
                        TrustType    = $_.trustType  # 'AzureAd'=Cloud-only, 'ServerAd'=Hybrid-Join, 'Workplace'=Registered
                        JoinType     = switch ($_.trustType) {
                                           'AzureAd'   { 'Entra-Joined (Cloud)' }
                                           'ServerAd'  { 'Hybrid-Joined (On-Prem Domain)' }
                                           'Workplace' { 'Entra-Registered (BYOD)' }
                                           default     { $_.trustType }
                                       }
                        IsCompliant  = $_.isCompliant
                        IsManaged    = $_.isManaged
                        LastSignIn   = if ($_.approximateLastSignInDateTime) { ([datetime]$_.approximateLastSignInDateTime).ToString('dd.MM.yyyy') } else { '-' }
                        Registered   = if ($_.registrationDateTime) { ([datetime]$_.registrationDateTime).ToString('dd.MM.yyyy') } else { '-' }
                    }
                }
            }
        } catch { Write-Log "Entra-Geraete nicht abrufbar" -Level Verbose }

        $HybridJoinedEntra  = @($EntraDevices | Where-Object { $_.TrustType -eq 'ServerAd' })
        $CloudOnlyEntra     = @($EntraDevices | Where-Object { $_.TrustType -eq 'AzureAd' })
        $RegisteredEntra    = @($EntraDevices | Where-Object { $_.TrustType -eq 'Workplace' })

        # Hybrid-Score: Wie hybrid ist die Umgebung?
        $TotalWinDevices    = ($Devices | Where-Object { $_.OperatingSystem -like 'Windows*' }).Count
        $HybridPct          = if ($TotalWinDevices -gt 0) { [math]::Round(($GPOLikelyDevices.Count / $TotalWinDevices) * 100) } else { 0 }
        $HybridEnvironment  = if ($HybridPct -gt 50) { 'Ueberwiegend hybrid (GPO-dominant)' }
                              elseif ($HybridPct -gt 10) { 'Gemischt (Co-Management)' }
                              elseif ($ReportData.EntraID -and $ReportData.EntraID.HybridSync) { 'Hybrid-Sync aktiv (Cloud-first)' }
                              else { 'Cloud-only (Intune-native)' }
        Stop-Step "Hybrid-Analyse"
        $JailBroken          = $Devices | Where-Object { $_.JailBroken -ne 'Unknown' -and $_.JailBroken -ne 'False' -and $_.JailBroken -ne $false }

        # Non-Compliance Details: pro Geraet welche Einstellungen schlagen fehl
        Start-Step "Non-Compliance-Analyse"
        Write-Log "Analysiere Non-Compliance-Gruende ($($NonCompliantDevices.Count) non-compliant Geraete)..." -Level Info
        $NonComplianceDetails = @()
        $NonComplianceSummary = @{}  # Einstellung -> Anzahl betroffener Geraete
        foreach ($Device in $NonCompliantDevices) {
            try {
                $SettingStates = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$($Device.Id)/deviceCompliancePolicyStates" `
                    -ErrorAction SilentlyContinue
                foreach ($PolicyState in $SettingStates.value | Where-Object { $_.state -ne 'compliant' }) {
                    # Setting-Level Details holen
                    try {
                        $Settings = Invoke-MgGraphRequest -Method GET `
                            -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$($Device.Id)/deviceCompliancePolicyStates/$($PolicyState.id)/settingStates" `
                            -ErrorAction SilentlyContinue
                        foreach ($S in $Settings.value | Where-Object { $_.state -ne 'compliant' -and $_.state -ne 'notApplicable' }) {
                            $SettingName = $S.setting -replace '^.*\.',''-replace '([A-Z])',' $1' -replace '^\s',''
                            $NonComplianceDetails += [PSCustomObject]@{
                                DeviceName   = $Device.DeviceName
                                UserUPN      = $Device.UserPrincipalName
                                OS           = $Device.OperatingSystem
                                OSVersion    = $Device.OsVersion
                                PolicyName   = $PolicyState.displayName
                                Setting      = $SettingName
                                SettingRaw   = $S.setting
                                State        = $S.state
                                CurrentValue = if ($S.currentValue) { $S.currentValue } else { 'nicht gesetzt' }
                                LastSync     = if ($Device.LastSyncDateTime) { ([datetime]$Device.LastSyncDateTime).ToString('dd.MM.yyyy HH:mm') } else { 'Unbekannt' }
                            }
                            # Summary zaehlen
                            if (-not $NonComplianceSummary[$SettingName]) { $NonComplianceSummary[$SettingName] = 0 }
                            $NonComplianceSummary[$SettingName]++
                        }
                    } catch {}
                }
            } catch {
                Write-Log "Non-Compliance-Details fuer $($Device.DeviceName) nicht abrufbar." -Level Verbose
            }
        }
        Stop-Step "Non-Compliance-Analyse"
        Write-Log "Non-Compliance: $($NonComplianceDetails.Count) Findings auf $($NonCompliantDevices.Count) Geraeten" -Level Success
        Write-VerboseData "Non-Compliance-Findings" $NonComplianceDetails.Count

        # Compliance Policies
        Write-Log "Lade Compliance Policies..." -Level Info
        $CompliancePolicies = Get-MgDeviceManagementDeviceCompliancePolicy -All -ErrorAction SilentlyContinue
        $CompliancePolicyDetails = foreach ($Policy in $CompliancePolicies) {
            $Assignments = Get-MgDeviceManagementDeviceCompliancePolicyAssignment -DeviceCompliancePolicyId $Policy.Id -ErrorAction SilentlyContinue
            $Props = $Policy.AdditionalProperties
            [PSCustomObject]@{
                Name                    = $Policy.DisplayName
                Platform                = $Props['@odata.type'] -replace '#microsoft.graph.',''-replace 'CompliancePolicy',''
                Assignments             = $Assignments.Count
                CreatedAt               = $Policy.CreatedDateTime
                Modified                = $Policy.LastModifiedDateTime
                # Windows Compliance Settings (CIS relevant)
                BitLockerEnabled        = $Props['bitLockerEnabled']
                SecureBootEnabled       = $Props['secureBootEnabled']
                CodeIntegrityEnabled    = $Props['codeIntegrityEnabled']
                StorageRequireEncryption= $Props['storageRequireEncryption']
                PasswordRequired        = $Props['passwordRequired']
                PasswordMinLength       = $Props['passwordMinimumLength']
                PasswordBlockSimple     = $Props['passwordBlockSimple']
                PasswordMaxIdleBeforeLock= $Props['passwordMinutesOfInactivityBeforeLock']
                ActiveFirewallRequired  = $Props['activeFirewallRequired']
                AntivirusRequired       = $Props['antivirusRequired']
                AntiSpywareRequired     = $Props['antiSpywareRequired']
                DefenderEnabled         = $Props['defenderEnabled']
                RTPEnabled              = $Props['rtpEnabled']
                SignatureUpToDate        = $Props['signatureOutOfDate']
                OSMinVersion            = $Props['osMinimumVersion']
            }
        }

        # Configuration Profiles
        Write-Log "Lade Konfigurationsprofile..." -Level Info
        $ConfigProfiles = Get-MgDeviceManagementDeviceConfiguration -All -ErrorAction SilentlyContinue
        $ConfigProfileDetails = foreach ($Profile in $ConfigProfiles) {
            $Assignments = Get-MgDeviceManagementDeviceConfigurationAssignment -DeviceConfigurationId $Profile.Id -ErrorAction SilentlyContinue
            $PType = $Profile.AdditionalProperties['@odata.type'] -replace '#microsoft.graph.',''
            [PSCustomObject]@{
                Name                  = $Profile.DisplayName
                Platform              = $PType
                Assignments           = $Assignments.Count
                CreatedAt             = $Profile.CreatedDateTime
                IsBitLockerProfile    = ($PType -like '*BitLocker*' -or $Profile.DisplayName -like '*BitLocker*' -or $Profile.DisplayName -like '*CIS*BL*')
                IsDefenderProfile     = ($PType -like '*Defender*' -or $Profile.DisplayName -like '*Defender*' -or $Profile.DisplayName -like '*AV*' -or $Profile.DisplayName -like '*Antivirus*')
                IsFirewallProfile     = ($PType -like '*Firewall*' -or $Profile.DisplayName -like '*Firewall*')
                IsASRProfile          = ($Profile.DisplayName -like '*ASR*' -or $Profile.DisplayName -like '*Attack Surface*')
                IsWindowsHelloProfile = ($Profile.DisplayName -like '*Hello*' -or $Profile.DisplayName -like '*WHFB*' -or $Profile.DisplayName -like '*WHfB*')
                IsCISProfile          = ($Profile.DisplayName -like '*CIS*' -or $Profile.DisplayName -like '*Benchmark*')
                IsCredGuardProfile    = ($Profile.DisplayName -like '*Credential Guard*' -or $Profile.DisplayName -like '*CredGuard*' -or $Profile.DisplayName -like '*VBS*')
            }
        }

        # Security Baselines (intents = Intune Security Baseline Templates)
        Write-Log "Pruefe Security Baselines..." -Level Info
        $SecurityBaselines = @()
        try {
            $SBResp = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/intents?`$filter=isAssigned eq true" -ErrorAction SilentlyContinue
            if ($SBResp.value) {
                $SecurityBaselines = $SBResp.value | ForEach-Object {
                    [PSCustomObject]@{
                        Name         = $_.displayName
                        TemplateId   = $_.templateId
                        IsAssigned   = $_.isAssigned
                        LastModified = $_.lastModifiedDateTime
                    }
                }
            }
        } catch { Write-Log "Security Baselines nicht abrufbar" -Level Verbose }

        # App Protection Policies (MAM)
        Write-Log "Lade App Protection Policies..." -Level Info
        $AppProtectioniOS     = Get-MgDeviceAppManagementiOSManagedAppProtection -All -ErrorAction SilentlyContinue
        $AppProtectionAndroid = Get-MgDeviceAppManagementAndroidManagedAppProtection -All -ErrorAction SilentlyContinue

        # Windows Update Rings
        $UpdateRings = Get-MgDeviceManagementDeviceConfiguration -All -ErrorAction SilentlyContinue |
            Where-Object { $_.AdditionalProperties['@odata.type'] -like '*windowsUpdateForBusinessConfiguration*' }

        # Autopilot
        $AutopilotDevices = @()
        try {
            $AutopilotDevices = Get-MgDeviceManagementWindowsAutopilotDeviceIdentity -All -ErrorAction SilentlyContinue
        } catch {
            Write-Log "Autopilot-Daten nicht verfuegbar (Modul-Konflikt oder fehlende Lizenz): $($_.Exception.Message.Split([char]10)[0])" -Level Verbose
        }

        # Managed Apps
        $ManagedApps = Get-MgDeviceAppManagementMobileApp -All -ErrorAction SilentlyContinue | Where-Object {
            $_.AdditionalProperties['isAssigned'] -eq $true
        }

        $ReportData.Intune = @{
            TotalDevices        = $Devices.Count
            WindowsDevices      = $WindowsDevices
            iOSDevices          = $iOSDevices
            AndroidDevices      = $AndroidDevices
            MacOSDevices        = $MacOSDevices
            CompliantDevices    = $CompliantDevices.Count
            NonCompliantDevices = $NonCompliantDevices.Count
            NotEncrypted        = $NotEncrypted.Count
            JailBroken          = $JailBroken.Count
            CompliancePolicies  = $CompliancePolicyDetails
            ConfigProfiles      = $ConfigProfileDetails
            AppProtectioniOS    = $AppProtectioniOS.Count
            AppProtectionAndroid = $AppProtectionAndroid.Count
            UpdateRings         = $UpdateRings.Count
            AutopilotDevices    = $AutopilotDevices.Count
            ManagedApps         = $ManagedApps.Count
            SecurityBaselines   = $SecurityBaselines
            HasBitLockerProfile       = ($ConfigProfileDetails | Where-Object { $_.IsBitLockerProfile }).Count -gt 0
            HasDefenderProfile        = ($ConfigProfileDetails | Where-Object { $_.IsDefenderProfile }).Count -gt 0
            HasFirewallProfile        = ($ConfigProfileDetails | Where-Object { $_.IsFirewallProfile }).Count -gt 0
            HasASRProfile             = ($ConfigProfileDetails | Where-Object { $_.IsASRProfile }).Count -gt 0
            HasWindowsHelloProfile    = ($ConfigProfileDetails | Where-Object { $_.IsWindowsHelloProfile }).Count -gt 0
            HasCISProfiles            = ($ConfigProfileDetails | Where-Object { $_.IsCISProfile }).Count
            HasCredGuardProfile       = ($ConfigProfileDetails | Where-Object { $_.IsCredGuardProfile }).Count -gt 0
            # Hybrid-Analyse
            PureIntuneMgmt      = $PureIntune.Count
            PureSCCMMgmt        = $PureSCCM.Count
            CoManagedDevices    = $CoManaged.Count
            GPOLikelyDevices    = $GPOLikelyDevices.Count
            GPOLikelyList       = $GPOLikelyDevices | Select-Object DeviceName, ManagementAgent, DeviceEnrollmentType, UserDisplayName
            EntraDevices        = $EntraDevices
            HybridJoinedEntra   = $HybridJoinedEntra.Count
            CloudOnlyEntra      = $CloudOnlyEntra.Count
            RegisteredEntra     = $RegisteredEntra.Count
            HybridEnvironment   = $HybridEnvironment
            HybridPct           = $HybridPct
            AllDevices           = $Devices
            NonComplianceDetails = $NonComplianceDetails
            NonComplianceSummary = $NonComplianceSummary
        }

        Stop-Step "Intune-Geraete"
        Write-VerboseData "Geraete" "$($Devices.Count) total, $($CompliantDevices.Count) compliant, $($NonCompliantDevices.Count) non-compliant"
        # Benutzer mit Lizenz aber ohne verwaltetes Geraet
        Write-Log "Pruefe Geraete-Abdeckung..." -Level Info
        $UsersWithoutDevice = @()
        if ($ReportData.EntraID) {
            $ManagedUPNs = ($Devices | Where-Object { $_.UserPrincipalName } | Select-Object -ExpandProperty UserPrincipalName) | Sort-Object -Unique
            $LicensedMembers = $ReportData.EntraID.Users | Where-Object {
                $_.UserType -ne 'Guest' -and $_.AccountEnabled -eq $true -and
                $_.AssignedLicenses.Count -gt 0 -and
                $_.UserPrincipalName -notlike '*#EXT#*'
            }
            $UsersWithoutDevice = $LicensedMembers | Where-Object {
                $_.UserPrincipalName -notin $ManagedUPNs
            } | Select-Object DisplayName, UserPrincipalName, Department
            Write-Log "Benutzer mit Lizenz ohne Geraet: $($UsersWithoutDevice.Count)" -Level Info
        }
        $ReportData.Intune['UsersWithoutDevice'] = $UsersWithoutDevice

        Write-Log "Intune: $($Devices.Count) Geräte ($($CompliantDevices.Count) compliant, $($NonCompliantDevices.Count) non-compliant)" -Level Success
        return $true
    }
    catch {
        Write-Log "Fehler bei Intune Datensammlung: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ============================================================
# TEAMS DATENSAMMLUNG
# ============================================================
function Get-TeamsData {
    Write-Progress-Status "Microsoft Teams" "Sammle Teams-Daten..." 65
    if (-not $Global:Connected.Graph) {
        Write-Log "Graph nicht verbunden – Teams wird übersprungen." -Level Warning
        return $false
    }

    if (-not (Assert-GraphConnection)) { return $false }
    try {
        # Teams & Channels
        Start-Step "Teams"
        Write-Log "Lade Teams..." -Level Info
        # Graph 2.25.x: Get-MgTeam ohne -All, maximal 999 Teams per Request
        $Teams = @(Get-MgTeam -Top 999 -Property Id,DisplayName,Description,Visibility,IsArchived,CreatedDateTime -ErrorAction SilentlyContinue)
        $PublicTeams   = $Teams | Where-Object { $_.Visibility -eq 'Public' }
        $PrivateTeams  = $Teams | Where-Object { $_.Visibility -eq 'Private' }
        $ArchivedTeams = $Teams | Where-Object { $_.IsArchived -eq $true }

        # Teams Policies via Graph REST (Invoke-MgGraphRequest statt nicht verfuegbarem Cmdlet)
        Write-Log "Lade Teams-Einstellungen..." -Level Info
        $TeamsSettings  = $null
        $TeamsPolicies  = @{}
        try {
            $TeamsSettings = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/teamwork" -ErrorAction Stop
            $TeamsPolicies['TeamsAppSettings'] = $TeamsSettings
        } catch {
            Write-Log "Teams AppSettings uebersprungen (Scope/Lizenz fehlt): $(($_.Exception.Message -split '\n')[0])" -Level Warning
        }

        # Guest Access Settings
        try {
            $GuestSettings = Get-MgPolicyAuthorizationPolicy -ErrorAction SilentlyContinue
            $TeamsPolicies['GuestAccessEnabled'] = $GuestSettings.AllowInvitesFrom
        } catch {}

        # Channel Count
        $ChannelData = @()
        foreach ($Team in $Teams | Select-Object -First 100) {
            try {
                $Channels = Get-MgTeamChannel -TeamId $Team.Id -ErrorAction SilentlyContinue
                $ChannelData += [PSCustomObject]@{
                    TeamName     = $Team.DisplayName
                    Visibility   = $Team.Visibility
                    IsArchived   = $Team.IsArchived
                    ChannelCount = $Channels.Count
                    Created      = if ($Team.CreatedDateTime) { $Team.CreatedDateTime.ToString('dd.MM.yyyy') } else { 'Unbekannt' }
                }
            } catch {}
        }

        # Gaeste pro Team
        Write-Log "Pruefe Team-Gaeste..." -Level Info
        $TeamGuestDetails = [System.Collections.Generic.List[object]]::new()
        try {
            foreach ($T in $Teams | Select-Object -First 50) {
                try {
                    $GMembers = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/teams/$($T.Id)/members?`$top=100" -ErrorAction SilentlyContinue
                    $GGuests  = @($GMembers.value | Where-Object { $_.displayName -and ($_.email -like '*#EXT#*' -or $_.'@odata.type' -like '*guest*') })
                    if ($GGuests.Count -gt 0) {
                        $TeamGuestDetails.Add([PSCustomObject]@{
                            TeamName     = $T.DisplayName
                            GuestCount   = $GGuests.Count
                            GuestList    = ($GGuests | ForEach-Object { $_.displayName }) -join '; '
                            GuestDomains = (($GGuests | ForEach-Object { ($_.email -split '@')[1] } | Where-Object { $_ }) | Sort-Object -Unique) -join ', '
                        })
                    }
                } catch {}
            }
        } catch { Write-Log "Team-Gaeste nicht abrufbar" -Level Verbose }

        $ReportData.Teams = @{
            TotalTeams       = $Teams.Count
            PublicTeams      = $PublicTeams.Count
            PrivateTeams     = $PrivateTeams.Count
            ArchivedTeams    = $ArchivedTeams.Count
            TeamDetails      = $ChannelData
            TeamsPolicies    = $TeamsPolicies
            TeamsSettings    = $TeamsSettings
            TeamGuestDetails = $TeamGuestDetails
        }

        Stop-Step "Teams"
        Write-VerboseData "Teams" "$($Teams.Count) total, $($PublicTeams.Count) public, $($ArchivedTeams.Count) archived"
        Write-Log "Teams: $($Teams.Count) Teams ($($PublicTeams.Count) öffentlich, $($PrivateTeams.Count) privat, $($ArchivedTeams.Count) archiviert)" -Level Success
        return $true
    }
    catch {
        Write-Log "Fehler bei Teams Datensammlung: $($_.Exception.Message)" -Level Error
        return $false
    }
}

# ============================================================
# SHAREPOINT DATENSAMMLUNG
# ============================================================
function Get-SharePointData {
    Write-Progress-Status "SharePoint Online" "Sammle Sites..." 75
    # SharePoint-Daten komplett ueber Microsoft Graph - kein PnP/ACS noetig
    # PnP 2.x + Client Secret nutzt Legacy ACS (seit Nov 2024 in neuen Tenants deaktiviert)
    if (-not $Global:Connected.Graph) {
        Write-Log "Graph nicht verbunden - SPO wird uebersprungen." -Level Warning
        return $false
    }

    try {
        Write-Log "Lade Site Collections (Graph API)..." -Level Info

        # Alle Sites per Graph laden (paginiert, max 500 pro Request)
        $AllSites = [System.Collections.Generic.List[object]]::new()
        $OneDriveSites = [System.Collections.Generic.List[object]]::new()

        # Methode 1: SharePoint Admin REST API - liefert ALLE Sites inkl. .sharepoint.de, kein Cache
        $SitesLoaded = $false
        $EffectiveTenantId = if ($script:TenantId) { $script:TenantId } else { $TenantId }

        # Token holen
        $MgToken = $null
        try {
            $TokenBody = @{
                grant_type    = 'client_credentials'
                client_id     = $Global:ClientId
                client_secret = $Global:ClientSecret
                scope         = 'https://graph.microsoft.com/.default'
            }
            $TokenResp = Invoke-RestMethod -Method POST `
                -Uri "https://login.microsoftonline.com/$EffectiveTenantId/oauth2/v2.0/token" `
                -Body $TokenBody -ErrorAction Stop
            $MgToken = $TokenResp.access_token
            Write-Log "Token erhalten (Laenge: $($MgToken.Length))" -Level Info
        } catch {
            Write-Log "Token-Abruf fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Info
        }

        # Methode 1a: SharePoint Sites via Graph beta mit konsistenter Site-Liste
        if ($MgToken) {
            try {
                Write-Log "Lade Sites via Graph beta/sites..." -Level Info
                $AllSitesUri = "https://graph.microsoft.com/beta/sites?`$select=id,displayName,webUrl,createdDateTime,lastModifiedDateTime,siteCollection&`$top=200"
                $Headers = @{ Authorization = "Bearer $MgToken" }
                do {
                    $SitesPage = Invoke-RestMethod -Uri $AllSitesUri -Headers $Headers -ErrorAction Stop
                    foreach ($S in $SitesPage.value) {
                        if ($S.webUrl -like '*/personal/*') { $OneDriveSites.Add($S) }
                        else { $AllSites.Add($S) }
                    }
                    $AllSitesUri = $SitesPage.'@odata.nextLink'
                } while ($AllSitesUri)

                if ($AllSites.Count -gt 0) {
                    $SitesLoaded = $true
                    Write-Log "Sites via Graph beta geladen: $($AllSites.Count)" -Level Info
                }
            } catch {
                Write-Log "Graph beta/sites fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Info
            }
        }

        # Methode 1b: SharePoint Admin REST API (Token fuer sharepoint.com/.default)
        if (-not $SitesLoaded -and $MgToken -and -not [string]::IsNullOrWhiteSpace($Global:TenantDomain)) {
            try {
                $SPOTenant = $Global:TenantDomain -replace '\.onmicrosoft\.(com|de)$',''
                $SPOAdminUrl = "https://$SPOTenant-admin.sharepoint.com"
                Write-Log "Lade Sites via SharePoint Admin REST API: $SPOAdminUrl" -Level Info

                # SharePoint-spezifischen Token holen
                $SPOTokenBody = @{
                    grant_type    = 'client_credentials'
                    client_id     = $Global:ClientId
                    client_secret = $Global:ClientSecret
                    scope         = "$SPOAdminUrl/.default"
                }
                $SPOTokenResp = Invoke-RestMethod -Method POST `
                    -Uri "https://login.microsoftonline.com/$EffectiveTenantId/oauth2/v2.0/token" `
                    -Body $SPOTokenBody -ErrorAction Stop
                $SPOToken = $SPOTokenResp.access_token

                $SPOHeaders = @{ Authorization = "Bearer $SPOToken"; Accept = 'application/json;odata=verbose' }
                $SPOSitesUri = "$SPOAdminUrl/_api/web/webs?`$select=Title,Url,LastItemModifiedDate&`$top=500"
                $SPOResp = Invoke-RestMethod -Uri $SPOSitesUri -Headers $SPOHeaders -ErrorAction Stop

                foreach ($S in $SPOResp.d.results) {
                    $SiteObj = [PSCustomObject]@{
                        webUrl               = $S.Url
                        displayName          = $S.Title
                        lastModifiedDateTime = $S.LastItemModifiedDate
                    }
                    if ($S.Url -like '*/personal/*') { $OneDriveSites.Add($SiteObj) }
                    else { $AllSites.Add($SiteObj) }
                }
                if ($AllSites.Count -gt 0) {
                    $SitesLoaded = $true
                    Write-Log "Sites via SPO Admin REST geladen: $($AllSites.Count)" -Level Info
                }
            } catch {
                Write-Log "SPO Admin REST fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Info
            }
        }

                # Methode 2: Graph Sites Root-Enumeration (Fallback, findet nur .sharepoint.com)
        if (-not $SitesLoaded) {
            try {
                Write-Log "Lade Sites via Graph Root-Enumeration (Fallback)..." -Level Info
                $RootResp = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/sites/root/sites?`$select=id,displayName,webUrl,createdDateTime,lastModifiedDateTime&`$top=500" `
                    -ErrorAction Stop
                foreach ($S in $RootResp.value) {
                    if ($S.webUrl -like '*/personal/*') { $OneDriveSites.Add($S) }
                    else { $AllSites.Add($S) }
                }
                $RootSite = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/sites/root?`$select=id,displayName,webUrl,createdDateTime,lastModifiedDateTime" `
                    -ErrorAction SilentlyContinue
                if ($RootSite -and $RootSite.webUrl) { $AllSites.Add($RootSite) }
                if ($AllSites.Count -gt 0) { $SitesLoaded = $true }
            } catch {
                Write-Log "Root-Enumeration fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])" -Level Info
            }
        }

        if (-not $SitesLoaded) {
            throw "Keine Sites-Abfragemethode erfolgreich. Benoetigt: Reports.Read.All + Sites.Read.All"
        }

        # Tenant-Sharing-Einstellungen per Graph (SharePoint-Tenant-Settings)
        $TenantSharing = $null
        $DefaultLinkType = $null
        try {
            $SPSettingsResp = Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/v1.0/admin/sharepoint/settings" `
                -ErrorAction SilentlyContinue
            $TenantSharing = $SPSettingsResp.sharingCapability
            $DefaultLinkType = $SPSettingsResp.defaultSharingLinkType
        } catch {}

        # Storage-Daten per Graph anreichern (quota-Endpunkt pro Site)
        # Nur fuer Sites die noch kein StorageUsedBytes haben (Graph beta liefert keines)
        $StorageMap = @{}
        if ($SitesLoaded -and $MgToken) {
            Write-Log "Lade Storage-Daten per Graph drives..." -Level Info
            $StorageLoaded = 0
            foreach ($Site in $AllSites | Select-Object -First 200) {
                if ($Site.StorageUsedBytes -and $Site.StorageUsedBytes -gt 0) { continue }
                $SiteId = $Site.id
                if (-not $SiteId) { continue }
                try {
                    $DriveResp = Invoke-GraphRestMethod `
                        -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/drive?`$select=quota" `
                        -Headers @{ Authorization = "Bearer $MgToken" }
                    if ($DriveResp.quota.used -gt 0) {
                        $StorageMap[$Site.webUrl] = $DriveResp.quota.used
                        $StorageLoaded++
                    }
                } catch {}
            }
            if ($StorageLoaded -gt 0) { Write-Log "Storage fuer $StorageLoaded Sites geladen." -Level Info }
        }

        # Ordnerstruktur rekursiv laden (max 3 Ebenen, nur Ordner)
        Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
        $FolderMap = @{}
        if ($SitesLoaded -and $MgToken) {
            Write-Log "Lade Ordnerstruktur (bis 3 Ebenen)..." -Level Info

            # Hilfsfunktion: Ordner rekursiv laden und als HTML-Tree aufbauen
            function Get-FolderTree {
                param(
                    [string]$SiteId,
                    [string]$ItemId,
                    [int]$Depth,
                    [int]$MaxDepth,
                    [string]$Token
                )
                if ($Depth -gt $MaxDepth) { return '' }

                try {
                    $Uri = "https://graph.microsoft.com/v1.0/sites/$SiteId/drive/items/$ItemId/children?`$select=id,name,folder&`$filter=folder ne null&`$top=50"
                    $Resp = Invoke-GraphRestMethod -Uri $Uri `
                        -Headers @{ Authorization = "Bearer $Token" } `
                        -TimeoutSec 10
                    if (-not $Resp.value) { return '' }

                    $Folders = @($Resp.value | Where-Object { $_.folder })
                    if ($Folders.Count -eq 0) { return '' }

                    $Html = "<ul style='margin:0;padding-left:14px;list-style:none'>"
                    foreach ($F in $Folders) {
                        $Icon = if ($Depth -eq 1) { '📁' } else { '📂' }
                        $Children = ''
                        if ($Depth -lt $MaxDepth) {
                            $Children = Get-FolderTree -SiteId $SiteId -ItemId $F.id -Depth ($Depth+1) -MaxDepth $MaxDepth -Token $Token
                        }
                        $Html += "<li>$Icon $([System.Web.HttpUtility]::HtmlEncode($F.name))$Children</li>"
                    }
                    $Html += "</ul>"
                    return $Html
                } catch { return '' }
            }

            # Sites fuer Ordner-Scan bestimmen: aus Dialog-Auswahl (SPOFolderMode)
            $FolderMode = if ($Global:SPOFolderMode) { $Global:SPOFolderMode } elseif ($AllSitesFolders) { 'All' } else { 'Top3' }
            $SitesForFolders = if ($FolderMode -eq 'None') {
                @()
            } elseif ($FolderMode -eq 'All') {
                $AllSites
            } else {
                # Top 3 nach Storage
                $Top3 = $AllSites | Where-Object { $StorageMap[$_.webUrl] -gt 0 } |
                    Sort-Object { $StorageMap[$_.webUrl] } -Descending |
                    Select-Object -First 3
                if ($Top3.Count -eq 0) { $AllSites | Select-Object -First 3 } else { $Top3 }
            }

            if ($SitesForFolders.Count -eq 0) {
                Write-Log "Ordnerstruktur deaktiviert." -Level Info
            } else {
                Write-Log "Lade Ordnerstruktur fuer $($SitesForFolders.Count) Sites..." -Level Info
            }

            $FoldersLoaded = 0
            $FolderErrors  = 0
            $FolderIdx     = 0
            $FolderTotal   = @($SitesForFolders).Count
            foreach ($Site in $SitesForFolders) {
                $FolderIdx++
                $SiteName = if ($Site.displayName) { $Site.displayName } else { $Site.webUrl }
                Write-Host "  `r  Ordner [$FolderIdx/$FolderTotal] $SiteName..." -NoNewline -ForegroundColor Cyan
                $SiteId = $Site.id
                if (-not $SiteId) { $FolderErrors++; continue }
                try {
                    $RootResp = Invoke-GraphRestMethod `
                        -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/drive/root?`$select=id" `
                        -Headers @{ Authorization = "Bearer $MgToken" } `
                        -TimeoutSec 15
                    if (-not $RootResp.id) { continue }

                    $Tree = Get-FolderTree -SiteId $SiteId -ItemId $RootResp.id -Depth 1 -MaxDepth $FolderDepth -Token $MgToken
                    if ($Tree) { $FolderMap[$Site.webUrl] = $Tree; $FoldersLoaded++ }
                } catch {
                    $EMsg = $_.Exception.Message
                    if ($EMsg -like '*timeout*' -or $EMsg -like '*Timeout*' -or $EMsg -like '*timed out*') {
                        Write-Log "Ordner-Timeout fuer $SiteName - uebersprungen." -Level Warning
                    } else {
                        Write-Log "Ordner-Fehler fuer $SiteName`: $($EMsg.Split([char]10)[0])" -Level Info
                    }
                    $FolderErrors++
                }
            }
            Write-Host ""  # Zeilenumbruch nach Fortschrittsanzeige
            Write-Log "Ordnerstruktur: $FoldersLoaded geladen, $FolderErrors Fehler/Timeouts." -Level Info
        }

        # ── Berechtigungen laden (Site / Ordner / Sharing-Links) ──────────────────
        $PermMap = @{}  # webUrl -> @{ SitePerms; BrokenInheritance; SharingLinks }
        if ($Global:SPOPermMode -ne 'None' -and $MgToken -and $SitesLoaded) {
            $Headers = @{ Authorization = "Bearer $MgToken" }

            $SitesForPerms = if ($Global:SPOPermMode -eq 'All') {
                Write-Log "Lade Berechtigungen fuer alle $($AllSites.Count) Sites..." -Level Info
                $AllSites
            } else {
                Write-Log "Lade Berechtigungen fuer Top 10 Sites nach Storage..." -Level Info
                $Top10 = $AllSites | Where-Object { $StorageMap[$_.webUrl] -gt 0 } |
                    Sort-Object { $StorageMap[$_.webUrl] } -Descending | Select-Object -First 10
                if ($Top10.Count -eq 0) { $AllSites | Select-Object -First 10 } else { $Top10 }
            }

            $PermIdx   = 0
            $PermTotal = @($SitesForPerms).Count
            $PermErrors = 0
            foreach ($Site in $SitesForPerms) {
                $PermIdx++
                $SiteName = if ($Site.displayName) { $Site.displayName } else { $Site.webUrl }
                Write-Host "  `r  Berechtigungen [$PermIdx/$PermTotal] $SiteName..." -NoNewline -ForegroundColor Cyan
                $SiteId = $Site.id
                if (-not $SiteId) { $PermErrors++; continue }
                $SitePerm = @{ SitePerms = @(); BrokenInheritance = @(); SharingLinks = @() }

                # 1. Site-Berechtigungen (Besitzer/Mitglieder/Besucher via Graph)
                try {
                    $PermResp = Invoke-GraphRestMethod `
                        -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/permissions" `
                        -Headers $Headers -TimeoutSec 15
                    foreach ($P in $PermResp.value) {
                        $Roles = $P.roles -join ', '
                        $Who   = if ($P.grantedToV2.user) { $P.grantedToV2.user.displayName }
                                 elseif ($P.grantedToV2.group) { $P.grantedToV2.group.displayName }
                                 elseif ($P.grantedToV2.application) { $P.grantedToV2.application.displayName }
                                 else { 'Unbekannt' }
                        $SitePerm.SitePerms += [PSCustomObject]@{ Who=$Who; Roles=$Roles }
                    }
                } catch {}

                # 2. Sharing-Links (externe/anonyme Links auf Site-Ebene)
                try {
                    $LinksResp = Invoke-GraphRestMethod `
                        -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/drive/root/permissions" `
                        -Headers $Headers -TimeoutSec 15
                    foreach ($L in $LinksResp.value) {
                        if ($L.link) {
                            $SitePerm.SharingLinks += [PSCustomObject]@{
                                Type    = $L.link.type
                                Scope   = $L.link.scope
                                Url     = $L.link.webUrl
                                Expires = if ($L.expirationDateTime) { $L.expirationDateTime } else { 'Kein Ablauf' }
                            }
                        }
                    }
                } catch {}

                # 3. Gebrochene Vererbung: Unterordner mit abweichenden Rechten
                try {
                    $ItemsResp = Invoke-GraphRestMethod `
                        -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/drive/root/children?`$select=id,name,folder&`$top=50" `
                        -Headers $Headers -TimeoutSec 15
                    foreach ($Item in $ItemsResp.value | Where-Object { $_.folder }) {
                        try {
                            $ItemPerms = Invoke-GraphRestMethod `
                                -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/drive/items/$($Item.id)/permissions" `
                                -Headers $Headers -TimeoutSec 10
                            # Gebrochene Vererbung = Item hat eigene Permissions (nicht geerbt)
                            $OwnPerms = @($ItemPerms.value | Where-Object { -not $_.inheritedFrom })
                            if ($OwnPerms.Count -gt 0) {
                                $Who = $OwnPerms | ForEach-Object {
                                    if ($_.grantedToV2.user) { $_.grantedToV2.user.displayName }
                                    elseif ($_.grantedToV2.group) { $_.grantedToV2.group.displayName }
                                    else { '?' }
                                }
                                $SitePerm.BrokenInheritance += [PSCustomObject]@{
                                    Folder = $Item.name
                                    Users  = ($Who -join ', ')
                                    Count  = $OwnPerms.Count
                                }
                            }
                        } catch {}
                    }
                } catch {}

                $PermMap[$Site.webUrl] = $SitePerm

                # Wrapper behandelt Rate Limits automatisch
            }
            Write-Host ""
            Write-Log "Berechtigungen: $($PermMap.Count) Sites geladen, $PermErrors Fehler/Timeouts." -Level Info
        }

        # Site Details aufbereiten - Felder kommen je nach Methode unterschiedlich
        $SiteDetails = foreach ($Site in $AllSites | Select-Object -First 500) {
            # Storage: aus Drive-Endpunkt oder Usage Report
            $StorageGB = 0
            if ($Site.StorageUsedBytes -and $Site.StorageUsedBytes -gt 0) {
                $StorageGB = [math]::Round($Site.StorageUsedBytes / 1GB, 2)
            } elseif ($StorageMap[$Site.webUrl] -gt 0) {
                $StorageGB = [math]::Round($StorageMap[$Site.webUrl] / 1GB, 2)
            }
            $StorageLimitGB = 0
            if ($Site.StorageAllocBytes -and $Site.StorageAllocBytes -gt 0) {
                $StorageLimitGB = [math]::Round($Site.StorageAllocBytes / 1GB, 1)
            }
            [PSCustomObject]@{
                Url                 = $Site.webUrl
                Title               = if ($Site.displayName) { $Site.displayName } else { $Site.webUrl }
                Template            = if ($Site.Template) { $Site.Template } else { '' }
                SharingCapability   = if ($Site.ExternalSharing -eq 'On') { 'ExternalUserAndGuestSharing' } elseif ($Site.ExternalSharing) { $Site.ExternalSharing } else { '' }
                StorageUsageGB      = $StorageGB
                FolderTree          = if ($FolderMap[$Site.webUrl]) { $FolderMap[$Site.webUrl] } else { '<span style="color:#9ca3af">-</span>' }
                Permissions         = $PermMap[$Site.webUrl]
                StorageLimitGB      = $StorageLimitGB
                LastContentModified = $Site.lastModifiedDateTime
                Status              = if ($Site.isDeleted) { 'Deleted' } else { 'Active' }
                IsHubSite           = $false
                LockState           = 'Unlock'
            }
        }

        $PublicSites   = @($SiteDetails | Where-Object { $_.Url -notlike '*/personal/*' })
        $ExternalSites = @($SiteDetails | Where-Object { $_.SharingCapability -like '*External*' -or $_.SharingCapability -eq 'On' })
        $TotalStorageMB = ($SiteDetails | Measure-Object StorageUsageGB -Sum).Sum * 1024  # intern MB fuer Kompatibilitaet

        $ReportData.SharePoint = @{
            TotalSites      = $AllSites.Count
            OneDriveSites   = $OneDriveSites.Count
            PublicSites     = $PublicSites.Count
            ExternalSites   = $ExternalSites.Count
            SiteDetails     = $SiteDetails
            PermMap         = $PermMap
            HubSites        = @()
            TenantConfig    = $null
            TotalStorageMB  = $TotalStorageMB
            ExternalSharing = $TenantSharing
            DefaultLinkType = $DefaultLinkType
        }

        $Global:Connected.SPO = $true
        Write-Log "SharePoint: $($AllSites.Count) Sites via Graph API geladen." -Level Success
        return $true
    }
    catch {
        $SPOErrMsg = $_.Exception.Message
        Write-Log "Fehler bei SharePoint Datensammlung (Graph): $($SPOErrMsg.Split([char]10)[0])" -Level Error
        return $false
    }
}

# ============================================================
# COMPLIANCE-CHECKS
# ============================================================
function Invoke-ComplianceChecks {
    Write-Progress-Status "Compliance" "Prüfe Einstellungen gegen CISA/BSI/MS Baseline..." 85

    # ─── ENTRA ID CHECKS ────────────────────────────────────────────────────────
    if ($ReportData.EntraID) {
        $EID = $ReportData.EntraID

        # CISA MS.AAD.1.1 – MFA fuer alle Benutzer
        $MFAChecked  = $EID.MFAEnabled + $EID.MFADisabled
        $MFAPct      = if ($MFAChecked -gt 0) { [math]::Round(($EID.MFAEnabled / $MFAChecked) * 100, 1) } else { 0 }
        # CA-basierte MFA gilt als vollstaendige Abdeckung wenn alle User + alle Apps eingeschlossen
        $CAMFACoversAll = $EID.MFACACoversAll.Count -gt 0
        $MFAStatus   = if ($CAMFACoversAll) { 'PASS' } elseif ($EID.MFADisabled -eq 0) { 'PASS' } elseif ($EID.MFAViaCA -and $EID.MFADisabled -le 10) { 'WARNING' } elseif ($EID.MFADisabled -gt 10) { 'FAIL' } else { 'WARNING' }
        $MFASev      = if ($EID.MFADisabled -gt 10 -and -not $CAMFACoversAll) { 'Critical' } else { 'High' }
        $MFACANote   = if ($CAMFACoversAll) { " CA-Policy erzwingt MFA fuer alle User/Apps: $($EID.MFACAPolicies | Select-Object -ExpandProperty DisplayName | Join-String -Separator ', ')." } elseif ($EID.MFAViaCA) { " $($EID.MFACAPolicies.Count) CA-Policies mit MFA-Grant gefunden (kein vollstaendiger Alle-User-Scope)." } else { " Keine CA-Policy mit MFA-Erzwingung gefunden." }
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.1.1" `
            -Description "MFA fuer alle aktiven Benutzer erzwingen (per Auth-Methode oder CA)" `
            -Status $MFAStatus -Severity $MFASev `
            -Source "CISA, BSI ORP.4" `
            -Finding "$($EID.MFADisabled) von $MFAChecked geprueften internen Benutzern ohne registrierte MFA-Methode ($MFAPct% Abdeckung).$MFACANote" `
            -Recommendation "Aktivieren Sie eine Conditional Access Policy, die MFA fuer alle Benutzer erzwingt. Alternativ: Microsoft Entra Security Defaults aktivieren." `
            -Reference "https://www.cisa.gov/resources-tools/services/m365-security-configuration-baselines"

        # CISA MS.AAD.1.2 – Legacy Auth blockieren
        $LegacyAuthCA = $EID.CAPolicies | Where-Object {
            $_.State -eq 'enabled' -and
            $_.Conditions.ClientAppTypes -contains 'exchangeActiveSync' -and
            $_.GrantControls.Operator -eq 'OR' -and
            $_.GrantControls.BuiltInControls -contains 'block'
        }
        $LegacyStatus  = if ($LegacyAuthCA) { 'PASS' } else { 'FAIL' }
        $LegacyFinding = if ($LegacyAuthCA) { "CA-Policy fuer Legacy-Auth-Block gefunden." } else { "Keine CA-Policy gefunden, die Legacy-Authentifizierung blockiert." }
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.1.2" `
            -Description "Legacy-Authentifizierung blockieren" `
            -Status $LegacyStatus -Severity 'Critical' -Source "CISA, MS-Baseline" `
            -Finding $LegacyFinding `
            -Recommendation "Erstellen Sie eine Conditional Access Policy: Alle Benutzer, Client-Apps: Exchange ActiveSync + andere Clients - Block." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/conditional-access/block-legacy-authentication"

        # CISA MS.AAD.2.1 – Globale Administratoren minimieren
        $GlobalAdmins  = $EID.RoleAssignments | Where-Object { $_.RoleName -eq 'Global Administrator' }
        $GAStatus      = if ($GlobalAdmins.Count -le 4) { 'PASS' } elseif ($GlobalAdmins.Count -le 8) { 'WARNING' } else { 'FAIL' }
        $GASev         = if ($GlobalAdmins.Count -gt 8) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.2.1" `
            -Description "Anzahl globaler Administratoren minimieren (max. 8, empfohlen 2-4)" `
            -Status $GAStatus -Severity $GASev `
            -Source "CISA, BSI ORP.4, MS-Baseline" `
            -Finding "$($GlobalAdmins.Count) Benutzer mit Global Administrator Rolle: $(($GlobalAdmins.MemberName) -join ', ')" `
            -Recommendation "Reduzieren Sie die Anzahl globaler Admins auf maximal 4. Verwenden Sie stattdessen spezifische Admin-Rollen." `
            -Reference "https://www.cisa.gov/resources-tools/services/m365-security-configuration-baselines"

        # CISA MS.AAD.2.3 – Privilegierte Rollen mit PIM
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.2.3" `
            -Description "Privilegierte Rollen nur ueber PIM (just-in-time) vergeben" `
            -Status 'INFO' -Severity 'High' -Source "CISA, MS-Baseline" `
            -Finding "PIM-Status kann nur manuell im Entra Portal geprueft werden (erfordert P2-Lizenz)." `
            -Recommendation "Aktivieren Sie Entra ID PIM (P2-Lizenz erforderlich). Alle privilegierten Rollen als berechtigt statt aktiv konfigurieren." `
            -Reference "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure"

        # CISA MS.AAD.3.1 – Conditional Access: Alle Apps abdecken
        $AllAppsCA     = $EID.CAPolicies | Where-Object {
            $_.State -eq 'enabled' -and $_.Conditions.Applications.IncludeApplications -contains 'All'
        }
        $AllAppsStatus = if ($AllAppsCA) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.3.1" `
            -Description "CA-Policies decken alle Cloud-Apps ab" `
            -Status $AllAppsStatus -Severity 'Medium' -Source "CISA, MS-Baseline" `
            -Finding "$($AllAppsCA.Count) CA-Policies mit Scope Alle Apps" `
            -Recommendation "Stellen Sie sicher, dass mindestens eine CA-Policy alle Cloud-Apps abdeckt." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-cloud-apps"

        # BSI ORP.4 – Gastbenutzer-Zugang kontrollieren
        $GuestPct      = if ($EID.TotalUsers -gt 0) { [math]::Round(($EID.GuestUsers / $EID.TotalUsers) * 100, 1) } else { 0 }
        $GuestStatus   = if ($GuestPct -lt 20) { 'PASS' } elseif ($GuestPct -lt 40) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Entra ID" -Control "BSI ORP.4.A5" `
            -Description "Gastbenutzer-Zugang kontrollieren und begrenzen" `
            -Status $GuestStatus -Severity 'Medium' -Source "BSI ORP.4" `
            -Finding "$($EID.GuestUsers) Gastbenutzer ($GuestPct% aller Benutzer)" `
            -Recommendation "Pruefen Sie regelmaessig Gastbenutzerkonten. Implementieren Sie Access Reviews." `
            -Reference "https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/it-grundschutz_node.html"

        # Abgelaufene App-Credentials
        $AppExpStatus  = if ($EID.AppsExpired.Count -eq 0) { 'PASS' } else { 'FAIL' }
        $AppExpSev     = if ($EID.AppsExpired.Count -gt 0) { 'High' } else { 'Info' }
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.7.1" `
            -Description "App-Registrierungen mit abgelaufenen Credentials" `
            -Status $AppExpStatus -Severity $AppExpSev `
            -Source "MS-Baseline, Best Practice" `
            -Finding "$($EID.AppsExpired.Count) App-Registrierungen mit abgelaufenen Zertifikaten/Secrets" `
            -Recommendation "Erneuern Sie abgelaufene Credentials. Implementieren Sie Monitoring fuer ablaufende Credentials." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/app-provisioning/application-provisioning-alerts"

        # Risky Users
        if ($EID.RiskyUsers.Count -gt 0) {
            $RiskyList = ($EID.RiskyUsers | ForEach-Object {
                $Detail = switch ($_.RiskDetail) {
                    'userPerformedSecuredPasswordChange' { 'Passwort geaendert' }
                    'userPerformedSecuredPasswordReset'  { 'Passwort zurueckgesetzt' }
                    'adminGeneratedTemporaryPassword'    { 'Temp-Passwort' }
                    'aiConfirmedSigninSafe'              { 'KI: sicher bestaetigt' }
                    'userPassedMFADrivenByRiskBasedPolicy' { 'MFA bestanden' }
                    default { $_.RiskDetail }
                }
                "$($_.UserDisplayName) [$($_.UserPrincipalName)] - Risiko: $($_.RiskLevel) ($($_.RiskState)) - $Detail"
            }) -join "; "
            Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.8.1" `
                -Description "Riskante Benutzerkonten" `
                -Status 'FAIL' -Severity 'Critical' -Source "CISA, MS-Baseline" `
                -Finding "$($EID.RiskyUsers.Count) Benutzerkonten: $RiskyList" `
                -Recommendation "Untersuchen Sie alle riskanten Konten sofort. Erzwingen Sie Passwortaenderung und MFA-Re-Registrierung. Erwaegen Sie Kontosperrung bis zur Klaerung." `
                -Reference "https://learn.microsoft.com/en-us/entra/id-protection/concept-identity-protection-risks"
        } else {
            Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.8.1" `
                -Description "Riskante Benutzerkonten" -Status 'PASS' -Severity 'Info' -Source "CISA, MS-Baseline" `
                -Finding "Keine riskanten Benutzerkonten gefunden." -Recommendation "Prüfen Sie regelmäßig Identity Protection Reports."
        }
    }

    # ═══════════════════════════════════════════════════════════════════════════
    # CIS Microsoft Intune for Windows 11 Benchmark v4.0.0 (April 2025)
    # Referenz: https://www.cisecurity.org/benchmark/intune
    # Prueft OB sicherheitsrelevante Policies/Baselines konfiguriert sind
    # ═══════════════════════════════════════════════════════════════════════════
    if ($ReportData.Intune) {
        $IND2 = $ReportData.Intune

        # ── CIS Intune BL: BitLocker-Profil vorhanden ─────────────────────────
        $BLStatus = if ($IND2.HasBitLockerProfile) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.BL.1" `
            -Description "BitLocker-Konfigurationsprofil in Intune vorhanden" `
            -Status $BLStatus -Severity 'Critical' -Source "CIS Intune v4, BSI SYS.2.1" `
            -Finding "$(if ($BLStatus -eq 'FAIL') {'Kein BitLocker-Konfigurationsprofil - Geraete koennen unverschluesselt bleiben'} else {'BitLocker-Profil vorhanden'})" `
            -Recommendation "Intune > Endpoint Security > Disk Encryption > BitLocker Policy: AES-XTS 256-Bit, TPM, Recovery-Key-Backup in Entra ID" `
            -Reference "https://www.cisecurity.org/benchmark/intune"

        # ── CIS Intune L1: Defender Antivirus-Profil ──────────────────────────
        $DefStatus = if ($IND2.HasDefenderProfile) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.L1.AV" `
            -Description "Windows Defender Antivirus-Konfigurationsprofil vorhanden" `
            -Status $DefStatus -Severity 'High' -Source "CIS Intune v4, BSI SYS.2.1" `
            -Finding "$(if ($DefStatus -eq 'FAIL') {'Kein Defender-Profil - Realtime-Schutz, Cloudschutz und Scan-Einstellungen nicht zentral konfiguriert'} else {'Defender-Profil vorhanden'})" `
            -Recommendation "Intune > Endpoint Security > Antivirus > Windows Defender: Realtime, Cloudschutz High, PUA-Schutz, automatische Probenübermittlung aktivieren" `
            -Reference "https://www.cisecurity.org/benchmark/intune"

        # ── CIS Intune L1: Firewall-Profil ────────────────────────────────────
        $FWStatus = if ($IND2.HasFirewallProfile) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.L1.FW" `
            -Description "Windows Firewall-Konfigurationsprofil vorhanden" `
            -Status $FWStatus -Severity 'High' -Source "CIS Intune v4" `
            -Finding "$(if ($FWStatus -eq 'FAIL') {'Kein Firewall-Profil - Domain/Private/Public-Profile nicht zentral konfiguriert'} else {'Firewall-Profil vorhanden'})" `
            -Recommendation "Intune > Endpoint Security > Firewall > Windows Firewall Policy: Alle 3 Profile aktivieren, geblockte eingehende Verbindungen, Logging aktivieren" `
            -Reference "https://www.cisecurity.org/benchmark/intune"

        # ── CIS Intune L1: Attack Surface Reduction ───────────────────────────
        $ASRStatus = if ($IND2.HasASRProfile) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.L1.ASR" `
            -Description "Attack Surface Reduction (ASR) Regeln konfiguriert" `
            -Status $ASRStatus -Severity 'High' -Source "CIS Intune v4, CISA" `
            -Finding "$(if ($ASRStatus -eq 'WARNING') {'Keine ASR-Policy - Office-Makros, Skripte und Ransomware-Vektoren nicht blockiert'} else {'ASR-Profil vorhanden'})" `
            -Recommendation "Intune > Endpoint Security > Attack Surface Reduction > Mind. 16 ASR-Regeln auf Block. CIS v4 priorisiert: Ransomware-Schutz, Office-Makros, LSASS-Schutz" `
            -Reference "https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference"

        # ── CIS Intune L1: Windows Hello for Business ─────────────────────────
        $WHfBStatus = if ($IND2.HasWindowsHelloProfile) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.L1.WHfB" `
            -Description "Windows Hello for Business konfiguriert (passwortloser Login)" `
            -Status $WHfBStatus -Severity 'Medium' -Source "CIS Intune v4, CISA MS.AAD.4.1" `
            -Finding "$(if ($WHfBStatus -eq 'WARNING') {'Kein Windows Hello for Business Profil - kein phishing-resistenter Login fuer Endgeraete'} else {'Windows Hello for Business Profil vorhanden'})" `
            -Recommendation "Intune > Konfigurationsprofile > Identity Protection: WHfB aktivieren, PIN-Mindestaenge 8, Gross/Kleinbuchstaben und Sonderzeichen erfordern" `
            -Reference "https://learn.microsoft.com/en-us/mem/intune/protect/windows-hello"

        # ── Microsoft Security Baseline in Intune ─────────────────────────────
        $MSBLCount  = if ($IND2.SecurityBaselines) { $IND2.SecurityBaselines.Count } else { 0 }
        $MSBLStatus = if ($MSBLCount -gt 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.MSBL" `
            -Description "Microsoft Security Baseline in Intune aktiviert und zugewiesen" `
            -Status $MSBLStatus -Severity 'High' -Source "CIS Intune v4, MS-Baseline" `
            -Finding "$(if ($MSBLStatus -eq 'WARNING') {'Keine Microsoft Security Baseline als Intune-Profil zugewiesen - Hunderte sicherheitsrelevante Windows-Einstellungen unkonfiguriert'} else {"$MSBLCount Security Baseline(s) zugewiesen"})" `
            -Recommendation "Intune > Endpunktsicherheit > Sicherheitsbaselines > Windows 10/11-Baseline erstellen und zuweisen. Alternative: CIS Build Kit (JSON) importieren." `
            -Reference "https://learn.microsoft.com/en-us/mem/intune/protect/security-baselines"

        # ── Credential Guard / VBS ────────────────────────────────────────────
        $CGStatus = if ($IND2.HasCredGuardProfile) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.BL.VBS" `
            -Description "Credential Guard / Virtualization Based Security konfiguriert" `
            -Status $CGStatus -Severity 'High' -Source "CIS Intune v4 L2" `
            -Finding "$(if ($CGStatus -eq 'WARNING') {'Kein Credential Guard / VBS Profil - Pass-the-Hash Angriffe nicht abgewehrt'} else {'Credential Guard Profil vorhanden'})" `
            -Recommendation "Intune > Konfigurationsprofile > Credential Guard: VBS + UEFI Lock aktivieren (erfordert TPM 2.0, Secure Boot)" `
            -Reference "https://learn.microsoft.com/en-us/windows/security/identity-protection/credential-guard/credential-guard-manage"

        # ── Compliance Policy Windows: Sicherheits-Einstellungen pruefen ──────
        if ($IND2.CompliancePolicies.Count -gt 0) {
            $WinPol = @($IND2.CompliancePolicies | Where-Object { $_.Platform -like '*windows*' -or $_.Platform -like '*Windows10*' })
            if ($WinPol.Count -gt 0) {
                $NoBL   = @($WinPol | Where-Object { $_.BitLockerEnabled -ne $true -and $_.StorageRequireEncryption -ne $true })
                $NoSB   = @($WinPol | Where-Object { $_.SecureBootEnabled -ne $true })
                $NoAV2  = @($WinPol | Where-Object { $_.AntivirusRequired -ne $true })
                $NoFW2  = @($WinPol | Where-Object { $_.ActiveFirewallRequired -ne $true })
                $WeakP  = @($WinPol | Where-Object { $_.PasswordRequired -ne $true })

                $s = if ($NoBL.Count -eq 0) {'PASS'} else {'FAIL'}
                Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.CP.BL" `
                    -Description "Compliance Policy erfordert BitLocker/Geraeteverschluesselung" `
                    -Status $s -Severity 'Critical' -Source "CIS Intune v4, BSI SYS.2.1.A23" `
                    -Finding "$(if ($NoBL.Count -gt 0) {"$($NoBL.Count) Windows Compliance Policy/Policies ohne BitLocker-Anforderung"} else {'Alle Windows Policies erfordern BitLocker'})" `
                    -Recommendation "Compliance Policy > Windows > Geraeteintegrität > BitLocker erforderlich = Ja" `
                    -Reference "https://www.cisecurity.org/benchmark/intune"

                $s = if ($NoSB.Count -eq 0) {'PASS'} else {'WARNING'}
                Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.CP.SB" `
                    -Description "Compliance Policy erfordert Secure Boot" `
                    -Status $s -Severity 'High' -Source "CIS Intune v4" `
                    -Finding "$(if ($NoSB.Count -gt 0) {"$($NoSB.Count) Policy/Policies ohne Secure-Boot-Anforderung"} else {'Alle Windows Policies erfordern Secure Boot'})" `
                    -Recommendation "Compliance Policy > Windows > Geraeteintegrität > Sicheres Starten = Erforderlich" `
                    -Reference "https://www.cisecurity.org/benchmark/intune"

                $s = if ($NoAV2.Count -eq 0) {'PASS'} else {'FAIL'}
                Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.CP.AV" `
                    -Description "Compliance Policy erfordert aktiven Antivirenschutz" `
                    -Status $s -Severity 'High' -Source "CIS Intune v4" `
                    -Finding "$(if ($NoAV2.Count -gt 0) {"$($NoAV2.Count) Policy/Policies ohne Antivirus-Anforderung"} else {'Alle Windows Policies erfordern aktiven Antivirus'})" `
                    -Recommendation "Compliance Policy > Windows > Microsoft Defender Antivirus = Erforderlich" `
                    -Reference "https://www.cisecurity.org/benchmark/intune"

                $s = if ($NoFW2.Count -eq 0) {'PASS'} else {'WARNING'}
                Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.CP.FW" `
                    -Description "Compliance Policy erfordert aktive Windows Firewall" `
                    -Status $s -Severity 'Medium' -Source "CIS Intune v4" `
                    -Finding "$(if ($NoFW2.Count -gt 0) {"$($NoFW2.Count) Policy/Policies ohne Firewall-Anforderung"} else {'Alle Windows Policies erfordern aktive Firewall'})" `
                    -Recommendation "Compliance Policy > Windows > Windows Firewall = Erforderlich" `
                    -Reference "https://www.cisecurity.org/benchmark/intune"

                $s = if ($WeakP.Count -eq 0) {'PASS'} else {'FAIL'}
                Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.CP.PWD" `
                    -Description "Compliance Policy erfordert Geraetkennwort/-PIN" `
                    -Status $s -Severity 'High' -Source "CIS Intune v4" `
                    -Finding "$(if ($WeakP.Count -gt 0) {"$($WeakP.Count) Policy/Policies ohne Kennwortanforderung - Geraete koennen ohne PIN genutzt werden"} else {'Alle Windows Policies erfordern Kennwort/PIN'})" `
                    -Recommendation "Compliance Policy > Windows > Kennwort = Erforderlich, Mindestaenge >= 8, max. Inaktivitaet 15 Min." `
                    -Reference "https://www.cisecurity.org/benchmark/intune"
            }
        }

        # ── CIS Intune: CIS Build Kit erkannt ─────────────────────────────────
        if ($IND2.HasCISProfiles -gt 0) {
            Add-ComplianceFinding -Category "Intune" -Control "CIS.Intune.PROFILES" `
                -Description "CIS Benchmark Build Kit Profile importiert und erkannt" `
                -Status 'PASS' -Severity 'Info' -Source "CIS Intune v4" `
                -Finding "$($IND2.HasCISProfiles) Profile mit CIS-Bezeichnung gefunden" `
                -Recommendation "Benchmark-Versionen regelmaessig pruefen. Aktuell: CIS Intune v4.0.0 (April 2025)" `
                -Reference "https://www.cisecurity.org/benchmark/intune"
        }
    }

    # ── Hybrid-Umgebungs Compliance-Checks ────────────────────────────────────
    if ($ReportData.Intune) {
        $INDHYB = $ReportData.Intune

        if ($INDHYB.PureSCCMMgmt -gt 0) {
            Add-ComplianceFinding -Category "Intune" -Control "HYBRID.SCCM.1" `
                -Description "Geraete ausschliesslich per SCCM/GPO verwaltet (kein Intune)" `
                -Status "FAIL" -Severity "Critical" -Source "CIS Intune v4, BSI SYS.2.1" `
                -Finding "$($INDHYB.PureSCCMMgmt) Geraete mit Management-Agent 'configurationManagerClient' - Intune-Policies, CIS-Profile und Conditional Access greifen NICHT" `
                -Recommendation "Co-Management in SCCM aktivieren (SCCM > Administration > Cloud Services > Co-Management), dann Workloads schrittweise zu Intune verschieben." `
                -Reference "https://learn.microsoft.com/en-us/mem/configmgr/comanage/overview"
        }

        if ($INDHYB.CoManagedDevices -gt 0) {
            $CoMgmtStatus = if ($INDHYB.CoManagedDevices -gt $INDHYB.PureIntuneMgmt) { "WARNING" } else { "INFO" }
            Add-ComplianceFinding -Category "Intune" -Control "HYBRID.COMANAGE.1" `
                -Description "Co-Management aktiv - GPO und Intune-Policies koennen kollidieren" `
                -Status $CoMgmtStatus -Severity "Medium" -Source "CIS Intune v4" `
                -Finding "$($INDHYB.CoManagedDevices) Geraete im Co-Management. GPO-Workloads pruefen: Welche Einstellungen kommen von SCCM, welche von Intune?" `
                -Recommendation "Workloads schrittweise zu Intune: 1. Compliance, 2. Resource Access, 3. Endpoint Protection, 4. Device Config, 5. Windows Update" `
                -Reference "https://learn.microsoft.com/en-us/mem/configmgr/comanage/workloads"
        }

        if ($INDHYB.HybridJoinedEntra -gt 0) {
            $HybJoinPct = if ($INDHYB.EntraDevices.Count -gt 0) { [math]::Round(($INDHYB.HybridJoinedEntra / $INDHYB.EntraDevices.Count) * 100) } else { 0 }
            $HybJoinSt  = if ($HybJoinPct -gt 70) { "WARNING" } else { "INFO" }
            Add-ComplianceFinding -Category "Intune" -Control "HYBRID.JOIN.1" `
                -Description "Hybrid-Joined Geraete: Abhaengigkeit von On-Premises Active Directory" `
                -Status $HybJoinSt -Severity "Low" -Source "CIS.1.1.1, MS-Baseline" `
                -Finding "$($INDHYB.HybridJoinedEntra) von $($INDHYB.EntraDevices.Count) Geraeten ($HybJoinPct%) sind Hybrid-Joined" `
                -Recommendation "Langfristig zu Entra-Joined (Cloud-only) migrieren. Entra Connect Health regelmaessig ueberwachen." `
                -Reference "https://learn.microsoft.com/en-us/entra/identity/devices/hybrid-join-plan"
        }
    }

    # ─── NEUE COMPLIANCE CHECKS ──────────────────────────────────────────────────

    # Lizenzen / Inaktive User / Hybrid-Sync / App-Permissions / B2B / Governance
    if ($ReportData.EntraID) {
        $EID = $ReportData.EntraID

        # Inaktive Benutzer mit Lizenzen
        $InactiveWithLicense = (@($EID.InactiveUsers90) + @($EID.NeverSignedIn)) | Where-Object { $_.HasLicense }
        $InactStatus = if ($InactiveWithLicense.Count -eq 0) { 'PASS' } elseif ($InactiveWithLicense.Count -le 5) { 'WARNING' } else { 'FAIL' }
        $InactSev    = if ($InactiveWithLicense.Count -gt 5) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "Entra ID" -Control "INACT-1" `
            -Description "Inaktive Benutzer (>90 Tage kein Sign-In) mit aktiver Lizenz" `
            -Status $InactStatus -Severity $InactSev -Source "Best Practice, BSI ORP.4" `
            -Finding "$($InactiveWithLicense.Count) inaktive/nie angemeldete Benutzer haben noch aktive Lizenzen ($([int](($InactiveWithLicense.Count / [math]::Max($EID.EnabledUsers,1))*100))% der aktiven User)" `
            -Recommendation "Deaktivieren Sie inaktive Konten und entziehen Sie Lizenzen. Spart Lizenzkosten und reduziert Angriffsfläche." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/monitoring-health/concept-sign-ins"

        # CA Report-Only Policies
        $ROStatus = if ($EID.ReportOnlyCA.Count -eq 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Entra ID" -Control "CA-REPORTONLY" `
            -Description "Conditional Access Policies im Report-Only-Modus werden nicht durchgesetzt" `
            -Status $ROStatus -Severity 'Medium' -Source "Best Practice, CISA" `
            -Finding "$($EID.ReportOnlyCA.Count) CA-Policies sind nur im Report-Only-Modus (keine aktive Durchsetzung)" `
            -Recommendation "Pruefen Sie Report-Only-Policies und aktivieren Sie sie nach Validierung. Report-Only = keine Sicherheitswirkung." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-report-only"

        # High-Risk App Permissions
        $HRStatus = if ($EID.HighRiskApps.Count -eq 0) { 'PASS' } elseif ($EID.HighRiskApps.Count -le 3) { 'WARNING' } else { 'FAIL' }
        $HRSev    = if ($EID.HighRiskApps.Count -gt 3) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "Entra ID" -Control "APP-PERM-1" `
            -Description "Apps mit weitreichenden (High-Risk) API-Permissions" `
            -Status $HRStatus -Severity $HRSev -Source "Best Practice, MS-Baseline" `
            -Finding "$($EID.HighRiskApps.Count) Apps mit High-Risk Permissions (Mail.Read.All, Files.ReadWrite.All, Directory.ReadWrite.All u.a.)" `
            -Recommendation "Pruefen Sie jede App mit weitreichenden Permissions. Entfernen Sie nicht benoetigte Berechtigungen. Implementieren Sie App Governance." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent"

        # Hybrid Sync Status
        if ($EID.HybridSync) {
            Add-ComplianceFinding -Category "Entra ID" -Control "HYBRID-1" `
                -Description "Azure AD Connect / Hybrid-Sync aktiv" `
                -Status 'INFO' -Severity 'Info' -Source "Best Practice" `
                -Finding "Hybrid-Sync ist aktiv. Letzter Sync: $($EID.LastSyncTime). On-Premises-Abhaengigkeit besteht." `
                -Recommendation "Dokumentieren Sie die On-Premises-Abhaengigkeit fuer Uebergabe/Verkauf. Pruefen Sie ob Cloud-Only moeglich ist." `
                -Reference "https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/whatis-azure-ad-connect"
        }

        # B2B: Wer darf einladen
        if ($EID.B2BPolicy) {
            $AllowInvite = $EID.B2BPolicy.allowInvitesFrom
            $B2BStatus   = if ($AllowInvite -eq 'adminsAndGuestInviters' -or $AllowInvite -eq 'adminsAndSingleUserGuestInviters') { 'PASS' } elseif ($AllowInvite -eq 'everyone') { 'FAIL' } else { 'WARNING' }
            $B2BSev      = if ($AllowInvite -eq 'everyone') { 'High' } else { 'Medium' }
            Add-ComplianceFinding -Category "Entra ID" -Control "B2B-1" `
                -Description "Gaesteinladungen nur durch Administratoren erlauben" `
                -Status $B2BStatus -Severity $B2BSev -Source "CISA, BSI ORP.4" `
                -Finding "Gaesteinladungen erlaubt fuer: $AllowInvite" `
                -Recommendation "Setzen Sie allowInvitesFrom auf adminsAndGuestInviters oder adminsAndSingleUserGuestInviters." `
                -Reference "https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure"
        }

        # Sensitivity Labels
        $LabelStatus = if ($EID.SensitivityLabels.Count -gt 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Entra ID" -Control "GOV-LABELS" `
            -Description "Sensitivity Labels (Datenschutz-Klassifizierung) konfiguriert" `
            -Status $LabelStatus -Severity 'Medium' -Source "BSI ORP.1, Best Practice" `
            -Finding "$($EID.SensitivityLabels.Count) Sensitivity Labels konfiguriert" `
            -Recommendation "Konfigurieren Sie Sensitivity Labels fuer Datenklassifizierung (Vertraulich, Intern, Oeffentlich). Wichtig fuer DSGVO-Compliance." `
            -Reference "https://learn.microsoft.com/en-us/purview/sensitivity-labels"

        # Lizenz-Effizienz
        if ($EID.TotalLicenses -gt 0) {
            $LicUsePct   = [math]::Round(($EID.AssignedLicenses / $EID.TotalLicenses) * 100)
            $LicStatus   = if ($LicUsePct -ge 90) { 'PASS' } elseif ($LicUsePct -ge 70) { 'WARNING' } else { 'FAIL' }
            $LicSev      = if ($LicUsePct -lt 70) { 'Medium' } else { 'Low' }
            Add-ComplianceFinding -Category "Entra ID" -Control "LIC-1" `
                -Description "Lizenz-Auslastung optimieren" `
                -Status $LicStatus -Severity $LicSev -Source "Best Practice" `
                -Finding "$($EID.AssignedLicenses) von $($EID.TotalLicenses) Lizenzen genutzt ($LicUsePct%). $($EID.UnusedLicenses) ungenutzte Lizenzen." `
                -Recommendation "Pruefen Sie ungenutzte Lizenzen und erwaegen Sie Kuendigung oder Zuweisung. Direktes Einsparpotenzial." `
                -Reference "https://learn.microsoft.com/en-us/microsoft-365/admin/misc/license-overview"
        }
    }

    # ─── EXCHANGE CHECKS ─────────────────────────────────────────────────────────
    if ($ReportData.Exchange) {
        $EXO = $ReportData.Exchange

        # CISA MS.EXO.1.1 – DKIM fuer alle Domains
        $DKIMEnabled  = ($EXO.DKIMConfigs | Where-Object { $_.Enabled -eq $true }).Count
        $DKIMDisabled = ($EXO.DKIMConfigs | Where-Object { $_.Enabled -ne $true }).Count
        $DKIMStatus   = if ($DKIMDisabled -eq 0) { 'PASS' } elseif ($DKIMEnabled -gt 0) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.1.1" `
            -Description "DKIM fuer alle akzeptierten Domains aktivieren" `
            -Status $DKIMStatus -Severity 'High' -Source "CISA, BSI APP.5.2" `
            -Finding "$DKIMEnabled Domains mit DKIM, $DKIMDisabled Domains ohne DKIM" `
            -Recommendation "Aktivieren Sie DKIM fuer alle akzeptierten Domains: Set-DkimSigningConfig -Identity <domain> -Enabled true" `
            -Reference "https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure"

        # CISA MS.EXO.1.2 – DMARC Policy
        $DMARCStatus = @()
        foreach ($Domain in $EXO.AcceptedDomains) {
            try {
                $DNS = Resolve-DnsName "_dmarc.$($Domain.DomainName)" -Type TXT -ErrorAction SilentlyContinue
                $TXT = $DNS | Where-Object { $_.Strings -like "*v=DMARC1*" }
                $Policy = if ($TXT.Strings -match 'p=(reject|quarantine|none)') { $Matches[1] } else { 'fehlt' }
                $DMARCStatus += [PSCustomObject]@{ Domain = $Domain.DomainName; Policy = $Policy }
            } catch {}
        }
        $DMARCReject  = ($DMARCStatus | Where-Object { $_.Policy -eq 'reject' }).Count
        $DMARCMissing = ($DMARCStatus | Where-Object { $_.Policy -eq 'fehlt' }).Count
        $DMARCStat    = if ($DMARCMissing -eq 0 -and $DMARCReject -eq $DMARCStatus.Count) { 'PASS' } elseif ($DMARCMissing -gt 0) { 'FAIL' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.1.2" `
            -Description "DMARC mit p=reject oder p=quarantine fuer alle Domains" `
            -Status $DMARCStat -Severity 'High' -Source "CISA, BSI APP.5.2" `
            -Finding "$DMARCReject Domains mit p=reject, $DMARCMissing Domains ohne DMARC-Eintrag" `
            -Recommendation "Konfigurieren Sie DMARC fuer alle Domains mit p=reject oder p=quarantine." `
            -Reference "https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dmarc-configure"

        # CISA MS.EXO.4.1 – Externes Email-Forwarding deaktivieren
        $FwdStatus = if ($EXO.ExternalForwarding.Count -eq 0) { 'PASS' } else { 'FAIL' }
        $FwdSev    = if ($EXO.ExternalForwarding.Count -gt 0) { 'Critical' } else { 'Info' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.4.1" `
            -Description "Automatisches externes E-Mail-Forwarding deaktivieren" `
            -Status $FwdStatus -Severity $FwdSev `
            -Source "CISA, BSI APP.5.2" `
            -Finding "$($EXO.ExternalForwarding.Count) Mailboxen mit aktivem externen Forwarding" `
            -Recommendation "Erstellen Sie eine Transport Rule, die automatisches externes Forwarding blockiert." `
            -Reference "https://www.cisa.gov/resources-tools/services/m365-security-configuration-baselines"

        # CISA MS.EXO.7.1 – Modern Auth
        $ModAuthStatus  = if ($EXO.ModernAuthEnabled) { 'PASS' } else { 'FAIL' }
        $ModAuthSev     = if (-not $EXO.ModernAuthEnabled) { 'Critical' } else { 'Info' }
        $ModAuthFinding = if ($EXO.ModernAuthEnabled) { 'Modern Authentication: Aktiviert' } else { 'Modern Authentication: Deaktiviert' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.7.1" `
            -Description "Modern Authentication (OAuth) aktiviert" `
            -Status $ModAuthStatus -Severity $ModAuthSev `
            -Source "CISA, MS-Baseline" `
            -Finding $ModAuthFinding `
            -Recommendation "Aktivieren Sie Modern Auth: Set-OrganizationConfig -OAuth2ClientProfileEnabled true" `
            -Reference "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/enable-or-disable-modern-authentication-in-exchange-online"

        # Anti-Phishing Checks
        $DefaultAntiPhish     = $EXO.AntiPhishPolicies | Where-Object { $_.Name -eq 'Office365 AntiPhish Default' -or $_.IsDefault -eq $true }
        $ImpersonationEnabled = $DefaultAntiPhish | Where-Object { $_.EnableMailboxIntelligence -eq $true }
        $PhishStatus          = if ($ImpersonationEnabled) { 'PASS' } else { 'WARNING' }
        $PhishFinding         = if ($ImpersonationEnabled) { 'Mailbox Intelligence: Aktiv' } else { 'Mailbox Intelligence: Inaktiv' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.12.1" `
            -Description "Anti-Phishing: Mailbox Intelligence aktiviert" `
            -Status $PhishStatus -Severity 'High' -Source "CISA, MS-Baseline" `
            -Finding $PhishFinding `
            -Recommendation "Aktivieren Sie Mailbox Intelligence in der Anti-Phish Policy fuer besseren Schutz vor Impersonation-Angriffen." `
            -Reference "https://learn.microsoft.com/en-us/defender-office-365/anti-phishing-policies-mdo-configure"

        # Audit-Log
        $AuditStatus  = if ($EXO.OrgConfig.AuditDisabled -eq $false) { 'PASS' } else { 'FAIL' }
        $AuditFinding = if ($EXO.OrgConfig.AuditDisabled -eq $false) { 'Org-Level Audit: Aktiv' } else { 'Org-Level Audit: Deaktiviert' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.17.1" `
            -Description "Mailbox-Audit-Log aktiviert" `
            -Status $AuditStatus -Severity 'Medium' -Source "CISA, BSI OPS.1.1" `
            -Finding $AuditFinding `
            -Recommendation "Stellen Sie sicher, dass Mailbox-Auditing aktiviert ist: Set-OrganizationConfig -AuditDisabled false" `
            -Reference "https://learn.microsoft.com/en-us/purview/audit-mailboxes"
    }

    # ─── INTUNE CHECKS ───────────────────────────────────────────────────────────
    if ($ReportData.Intune) {
        $IND = $ReportData.Intune

        # CISA MS.DEFENDER.4.1 – Geraetecompliance
        $CompliancePct    = if ($IND.TotalDevices -gt 0) { [math]::Round(($IND.CompliantDevices / $IND.TotalDevices) * 100, 1) } else { 0 }
        $ComplianceStatus = if ($CompliancePct -ge 90) { 'PASS' } elseif ($CompliancePct -ge 70) { 'WARNING' } else { 'FAIL' }
        $ComplianceSev    = if ($CompliancePct -lt 70) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "Intune" -Control "MS.DEFENDER.4.1" `
            -Description "Geraetecompliance >= 80%" `
            -Status $ComplianceStatus -Severity $ComplianceSev `
            -Source "CISA, MS-Baseline" `
            -Finding "$($IND.CompliantDevices) von $($IND.TotalDevices) Geraeten compliant ($CompliancePct%)" `
            -Recommendation "Untersuchen Sie non-compliant Geraete. Stellen Sie sicher, dass CA-Policies compliant Geraete erzwingen." `
            -Reference "https://www.cisa.gov/resources-tools/services/m365-security-configuration-baselines"

        # Verschluesselung
        $EncStatus = if ($IND.NotEncrypted -eq 0) { 'PASS' } elseif ($IND.NotEncrypted -le 5) { 'WARNING' } else { 'FAIL' }
        $EncSev    = if ($IND.NotEncrypted -gt 5) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "Intune" -Control "BSI SYS.2.1.A23" `
            -Description "Geraete-Verschluesselung (BitLocker/FileVault)" `
            -Status $EncStatus -Severity $EncSev `
            -Source "BSI SYS.2.1, MS-Baseline" `
            -Finding "$($IND.NotEncrypted) Geraete ohne aktivierte Verschluesselung" `
            -Recommendation "Aktivieren Sie BitLocker (Windows) und FileVault (macOS) ueber Intune Configuration Profiles." `
            -Reference "https://learn.microsoft.com/en-us/intune/intune-service/protect/encrypt-devices"

        # Jailbroken Devices
        if ($IND.JailBroken -gt 0) {
            Add-ComplianceFinding -Category "Intune" -Control "MS.DEFENDER.4.2" `
                -Description "Jailbroken/Rooted Geräte" -Status 'FAIL' -Severity 'Critical' -Source "CISA, BSI" `
                -Finding "$($IND.JailBroken) Geräte als jailbroken/rooted markiert" `
                -Recommendation "Sperren Sie jailbroken Geräte sofort über Compliance Policy. Untersuchen Sie betroffene Nutzer."
        }

        # App Protection
        $AppProtStatus = if ($IND.AppProtectioniOS -gt 0 -and $IND.AppProtectionAndroid -gt 0) { 'PASS' } elseif ($IND.AppProtectioniOS -gt 0 -or $IND.AppProtectionAndroid -gt 0) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Intune" -Control "MS.DEFENDER.5.1" `
            -Description "App Protection Policies (MAM) vorhanden" `
            -Status $AppProtStatus -Severity 'High' -Source "CISA, BSI SYS.3.2" `
            -Finding "iOS App Protection Policies: $($IND.AppProtectioniOS), Android: $($IND.AppProtectionAndroid)" `
            -Recommendation "Erstellen Sie App Protection Policies fuer iOS und Android, die Datenverlust verhindern." `
            -Reference "https://learn.microsoft.com/en-us/intune/intune-service/apps/app-protection-policy"
    }

    # ─── SPF CHECKS (MS.EXO.2.1) ─────────────────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.SPFResults -and $ReportData.Exchange.SPFResults.Count -gt 0) {
        $NoSPF = @($ReportData.Exchange.SPFResults | Where-Object { -not $_.HasSPF })
        $SPFStatus = if ($NoSPF.Count -eq 0) { 'PASS' } elseif ($NoSPF.Count -le 2) { 'WARNING' } else { 'FAIL' }
        $SPFSev    = if ($NoSPF.Count -gt 2) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.2.1" `
            -Description "SPF-Record fuer alle akzeptierten Domains" `
            -Status $SPFStatus -Severity $SPFSev -Source "CISA, BSI APP.5.2" `
            -Finding "$($NoSPF.Count) von $($ReportData.Exchange.SPFResults.Count) Domains ohne SPF-Record" `
            -Recommendation "SPF anlegen: v=spf1 include:spf.protection.outlook.com -all" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/email-authentication-spf-configure"
    }

    # ─── ANTI-SPAM QUARANTINE (MS.EXO.10.1) ───────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.AntiSpamPolicies.Count -gt 0) {
        $DeleteAction = @($ReportData.Exchange.AntiSpamPolicies | Where-Object { $_.SpamAction -eq 'Delete' -or $_.HighConfidenceSpamAction -eq 'Delete' })
        $SpamQStatus = if ($DeleteAction.Count -eq 0) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "MS.EXO.10.1" `
            -Description "Spam-Aktion: Quarantaene statt Loeschen" `
            -Status $SpamQStatus -Severity 'Medium' -Source "CISA" `
            -Finding "$(if ($DeleteAction.Count -gt 0) {'Anti-Spam Policy loescht Mails statt Quarantaene - kein Recovery moeglich'} else {'Spam wird korrekt in Quarantaene geleitet'})" `
            -Recommendation "Anti-Spam Policy: SpamAction und HighConfidenceSpamAction = Quarantine" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spam-policies-configure"
    }

    # ─── PHISHING-RESISTENTE MFA FUER ADMINS (MS.AAD.4.1) ───────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.MFAData.Count -gt 0) {
        $EIDchk = $ReportData.EntraID
        $AdminUPNs2 = ($EIDchk.RoleAssignments | Where-Object { $_.RoleName -match 'Global Admin|Privileged|Security Admin|Billing' } | Select-Object -ExpandProperty MemberUPN) | Sort-Object -Unique
        $AdminsWeakMFA = @()
        foreach ($Upn2 in $AdminUPNs2 | Where-Object { $_ }) {
            $AU = $EIDchk.Users | Where-Object { $_.UserPrincipalName -eq $Upn2 } | Select-Object -First 1
            if ($AU) {
                $AMFA = $EIDchk.MFAData[$AU.Id]
                if ($AMFA -and -not ($AMFA.Methods -match 'fido2|windowsHello|passwordless')) { $AdminsWeakMFA += $Upn2 }
            }
        }
        $PhishMFAStatus = if ($AdminsWeakMFA.Count -eq 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Entra ID" -Control "MS.AAD.4.1" `
            -Description "Phishing-resistente MFA fuer privilegierte Rollen (FIDO2/Windows Hello)" `
            -Status $PhishMFAStatus -Severity 'High' -Source "CISA" `
            -Finding "$(if ($AdminsWeakMFA.Count -gt 0) {"$($AdminsWeakMFA.Count) Admins ohne phishing-resistente MFA"} else {'Alle geprueften Admins haben starke MFA oder kein MFA-Eintrag'})" `
            -Recommendation "FIDO2-Security-Key oder Windows Hello for Business fuer alle Admins" `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-strengths"
    }

    # ─── TEAMS CHECKS ────────────────────────────────────────────────────────────
    if ($ReportData.Teams) {
        $TMS = $ReportData.Teams

        # Oeffentliche Teams
        $PublicTeamPct    = if ($TMS.TotalTeams -gt 0) { [math]::Round(($TMS.PublicTeams / $TMS.TotalTeams) * 100, 1) } else { 0 }
        $PublicTeamStatus = if ($PublicTeamPct -lt 20) { 'PASS' } elseif ($PublicTeamPct -lt 50) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Microsoft Teams" -Control "MS.TEAMS.1.1" `
            -Description "Oeffentliche Teams minimieren" `
            -Status $PublicTeamStatus -Severity 'Medium' -Source "CISA, MS-Baseline" `
            -Finding "$($TMS.PublicTeams) oeffentliche Teams ($PublicTeamPct% aller Teams)" `
            -Recommendation "Pruefen Sie alle oeffentlichen Teams auf Notwendigkeit." `
            -Reference "https://www.cisa.gov/resources-tools/services/m365-security-configuration-baselines"

        # CISA MS.TEAMS.2.1 – Gast-Zugang
        Add-ComplianceFinding -Category "Microsoft Teams" -Control "MS.TEAMS.2.1" `
            -Description "Gastzugang in Teams konfiguriert und überprüft" `
            -Status 'INFO' -Severity 'Medium' -Source "CISA, BSI NET.4.2" `
            -Finding "Gastzugang-Konfiguration im Teams Admin Center prüfen (erfordert Teams-Admin-Rechte)." `
            -Recommendation "Schränken Sie Gastberechtigungen ein: Deaktivieren Sie 'Gäste können Kanäle erstellen/löschen'. Aktivieren Sie Gast-Ablaufdaten." `
            -Reference "https://learn.microsoft.com/en-us/microsoftteams/guest-access"
    }

    # ─── SHAREPOINT CHECKS ───────────────────────────────────────────────────────
    if ($ReportData.SharePoint) {
        $SPO = $ReportData.SharePoint

        # CISA MS.SHAREPOINT.1.1 – Externes Sharing einschränken
        $ExternalSharingLevel = $SPO.ExternalSharing
        $SharingStatus = switch ($ExternalSharingLevel) {
            'Disabled'                    { 'PASS' }
            'ExistingExternalUserSharing' { 'PASS' }
            'ExternalUserSharingOnly'     { 'WARNING' }
            'ExternalUserAndGuestSharing' { 'FAIL' }
            default                       { 'INFO' }
        }
        $SharingSev     = if ($SharingStatus -eq 'FAIL') { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "SharePoint Online" -Control "MS.SHAREPOINT.1.1" `
            -Description "Externes Sharing auf Tenant-Ebene einschraenken" `
            -Status $SharingStatus -Severity $SharingSev `
            -Source "CISA, BSI APP.2.1" `
            -Finding "Tenant-Sharing-Level: $ExternalSharingLevel" `
            -Recommendation "Setzen Sie das Sharing auf ExistingExternalUserSharing oder restriktiver." `
            -Reference "https://www.cisa.gov/resources-tools/services/m365-security-configuration-baselines"

        # Standardlink-Typ
        $LinkStatus = if ($SPO.DefaultLinkType -eq 'Internal' -or $SPO.DefaultLinkType -eq 'Direct') { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "SharePoint Online" -Control "MS.SHAREPOINT.1.2" `
            -Description "Standard-Sharing-Link auf Nur Personen in der Organisation" `
            -Status $LinkStatus -Severity 'Medium' -Source "CISA, Best Practice" `
            -Finding "Standard-Link-Typ: $($SPO.DefaultLinkType)" `
            -Recommendation "Aendern Sie den Standard-Link-Typ auf Specific people oder Only people in your organization." `
            -Reference "https://learn.microsoft.com/en-us/sharepoint/change-default-sharing-link"

        # Sites mit externem Sharing
        $ExtSiteStatus = if ($SPO.ExternalSites -eq 0) { 'PASS' } elseif ($SPO.ExternalSites -le 5) { 'WARNING' } else { 'FAIL' }
        $ExtSiteSev    = if ($SPO.ExternalSites -gt 5) { 'High' } else { 'Medium' }
        Add-ComplianceFinding -Category "SharePoint Online" -Control "MS.SHAREPOINT.2.1" `
            -Description "Sites mit externem Sharing ueberpruefen" `
            -Status $ExtSiteStatus -Severity $ExtSiteSev `
            -Source "CISA, BSI" `
            -Finding "$($SPO.ExternalSites) Sites haben externes Sharing aktiviert" `
            -Recommendation "Pruefen Sie alle Sites mit externem Sharing auf Notwendigkeit." `
            -Reference "https://learn.microsoft.com/en-us/sharepoint/external-sharing-overview"
    }

    # ── Tenant Admin Center Checks (aus Casinoland-Analyse) ─────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.TenantSettings.Count -gt 0) {
        $TS = $ReportData.EntraID.TenantSettings

        # User darf Apps registrieren (sollte deaktiviert sein)
        if ($TS['UsersCanRegisterApps'] -eq $true) {
            Add-ComplianceFinding -Category "Entra ID" -Control "TENANT-1" `
                -Description "Benutzer koennen eigene Apps registrieren" `
                -Status 'FAIL' -Severity 'High' -Source 'MS-Baseline' `
                -Finding "Benutzer duerfen eigene App-Registrierungen anlegen (Sicherheitsrisiko)" `
                -Recommendation "Deaktivieren: Entra > Benutzereinstellungen > App-Registrierungen = Nein" `
                -Reference "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles"
        }
        # User darf Mandanten erstellen
        if ($TS['UsersCanCreateTenants'] -eq $true) {
            Add-ComplianceFinding -Category "Entra ID" -Control "TENANT-2" `
                -Description "Benutzer koennen neue Entra-Mandanten erstellen" `
                -Status 'WARNING' -Severity 'Medium' -Source 'MS-Baseline' `
                -Finding "Benutzer duerfen eigenstaendig neue Mandanten anlegen" `
                -Recommendation "Deaktivieren: Entra > Benutzereinstellungen > Mandantenerstellung = Nein" `
                -Reference "https://learn.microsoft.com/en-us/entra/fundamentals/default-user-permissions"
        }
        # Branding fehlt
        if ($TS['BrandingConfigured'] -eq $false) {
            Add-ComplianceFinding -Category "Entra ID" -Control "BRAND-1" `
                -Description "Unternehmensbranding nicht konfiguriert" `
                -Status 'WARNING' -Severity 'Low' -Source 'BSI' `
                -Finding "Login-Seite hat kein Firmenbranding - Phishing-Gefahr erhoet" `
                -Recommendation "Entra > Unternehmensbranding konfigurieren (Logo, Hintergrund, Hinweistext)" `
                -Reference "https://learn.microsoft.com/en-us/entra/fundamentals/how-to-customize-branding"
        }
        # Gasteinladungen durch alle User
        if ($TS['GuestInvitePolicy'] -eq 'everyone') {
            Add-ComplianceFinding -Category "Entra ID" -Control "GUEST-INV-1" `
                -Description "Jeder Benutzer darf Gaeste einladen" `
                -Status 'FAIL' -Severity 'High' -Source 'CISA' `
                -Finding "Gasteinladungen sind fuer alle Benutzer erlaubt (inkl. Gaeste selbst)" `
                -Recommendation "Einschraenken auf Admins: Entra > Externe Identitaeten > Gasteinladungen" `
                -Reference "https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure"
        }
        # Audit Log inaktiv
        if ($TS['AuditLogEnabled'] -eq $false) {
            Add-ComplianceFinding -Category "Entra ID" -Control "AUDIT-1" `
                -Description "Unified Audit Log nicht aktiv" `
                -Status 'FAIL' -Severity 'Critical' -Source 'CISA, BSI' `
                -Finding "Purview/Audit-Log nicht aktiv - Angriffe koennen nicht nachvollzogen werden" `
                -Recommendation "Purview Compliance Portal > Audit aktivieren" `
                -Reference "https://learn.microsoft.com/en-us/purview/audit-log-enable-disable"
        }
    }

    # ── PIM Checks ──────────────────────────────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.PIMEnabled) {
        $EID = $ReportData.EntraID
        $PermanentPriv = $EID.PIMRoleAssignments | Where-Object { $_.IsPermanent -and $_.RoleName -match 'Global Admin|Privileged|Security Admin' }
        $PIMStatus = if ($PermanentPriv.Count -eq 0) { 'PASS' } elseif ($PermanentPriv.Count -le 3) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Entra ID" -Control "PIM-1" `
            -Description "Permanent zugewiesene privilegierte Rollen" `
            -Status $PIMStatus -Severity 'High' -Source "CISA, BSI" `
            -Finding "$($PermanentPriv.Count) privilegierte Rollen permanent zugewiesen (empfohlen: zeitgebunden via PIM)" `
            -Recommendation "Nutzen Sie PIM fuer zeitgebundene Admin-Rollen statt permanenter Zuweisung." `
            -Reference "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure"
    }

    # ── Enterprise Apps Checks ──────────────────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.DangerousEnterpriseApps.Count -gt 0) {
        $DangerCount = $ReportData.EntraID.DangerousEnterpriseApps.Count
        Add-ComplianceFinding -Category "Entra ID" -Control "EAPP-1" `
            -Description "Drittanbieter-Apps mit hohen Tenant-Berechtigungen" `
            -Status 'FAIL' -Severity 'Critical' -Source "CISA" `
            -Finding "$DangerCount Apps haben mandantenweiten Zugriff auf kritische Daten (Mail, Dateien, Verzeichnis)" `
            -Recommendation "Pruefen Sie alle Apps mit AllPrincipals-Consent. Widerrufen Sie unnoetige Berechtigungen." `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-consent-requests"
    }

    # ── Exchange Remote-Domaenen ────────────────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.RemoteDomainsDetail.Count -gt 0) {
        $TNEFDomains = $ReportData.Exchange.RemoteDomainsDetail | Where-Object { $_.TNEFEnabled -ne $false }
        if ($TNEFDomains.Count -gt 0) {
            Add-ComplianceFinding -Category "Exchange Online" -Control "EXO-RTF-1" `
                -Description "Rich-Text-Format (TNEF) in Remote-Domaenen aktiv" `
                -Status 'WARNING' -Severity 'Low' -Source 'MS-Baseline' `
                -Finding "$($TNEFDomains.Count) Remote-Domaenen haben TNEF/Rich-Text aktiv - kann Zustellprobleme verursachen" `
                -Recommendation "Exchange Admin Center > E-Mail-Fluss > Remote-Domaenen > TNEF deaktivieren" `
                -Reference "https://learn.microsoft.com/en-us/exchange/mail-flow/remote-domains/remote-domain-properties"
        }
        # Auto-Forward auf externe Domaenen
        $AutoFwdDomains = $ReportData.Exchange.RemoteDomainsDetail | Where-Object { $_.AutoForwardEnabled -eq $true }
        if ($AutoFwdDomains.Count -gt 0) {
            Add-ComplianceFinding -Category "Exchange Online" -Control "EXO-AFW-1" `
                -Description "Automatische Weiterleitung an externe Domaenen erlaubt" `
                -Status 'FAIL' -Severity 'High' -Source 'CISA' `
                -Finding "Auto-Forward an externe Empfaenger ist erlaubt (Datenleck-Risiko)" `
                -Recommendation "Remote-Domaenen: AutoForward deaktivieren oder per Transport-Rule blockieren" `
                -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/outbound-spam-policies-configure"
        }
    }

    # ── Shared Mailbox Login Check ───────────────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.SharedMailboxWithLogin.Count -gt 0) {
        $SMCount = $ReportData.Exchange.SharedMailboxWithLogin.Count
        Add-ComplianceFinding -Category "Exchange Online" -Control "EXO-SHM-1" `
            -Description "Shared Mailboxen mit aktiviertem direkten Login" `
            -Status 'FAIL' -Severity 'High' -Source "MS-Baseline" `
            -Finding "$SMCount Shared Mailboxen haben direkten Login aktiviert (Sicherheitsrisiko)" `
            -Recommendation "Deaktivieren Sie direkten Login auf Shared Mailboxen: Set-MsolUser -BlockCredential `$true" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/admin/email/about-shared-mailboxes"
    }

    # ── Intune Device Coverage ───────────────────────────────────────────────────
    if ($ReportData.Intune -and $ReportData.Intune.UsersWithoutDevice.Count -gt 0) {
        $NoDevCount = $ReportData.Intune.UsersWithoutDevice.Count
        $NoDevStatus = if ($NoDevCount -le 5) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Intune" -Control "INTUNE-COV-1" `
            -Description "Lizenzierte Benutzer ohne verwaltetes Geraet" `
            -Status $NoDevStatus -Severity 'Medium' -Source "BSI" `
            -Finding "$NoDevCount Benutzer haben eine Lizenz aber kein bei Intune registriertes Geraet" `
            -Recommendation "Registrieren Sie alle Geraete in Intune fuer vollstaendiges MDM." `
            -Reference "https://learn.microsoft.com/en-us/mem/intune/enrollment/device-enrollment"
    }

    # ═══════════════════════════════════════════════════════════════════════════════
    # CIS Microsoft 365 Foundations Benchmark v6.0.1 - Fehlende Controls
    # Referenz: https://www.cisecurity.org/benchmark/microsoft_365
    # Stand: CIS v6.0.1 (Oktober 2025)
    # ═══════════════════════════════════════════════════════════════════════════════

    # ── CIS 1.1.1 (L1) Admin-Konten sind Cloud-only ──────────────────────────────
    if ($ReportData.EntraID) {
        $EIDc = $ReportData.EntraID
        $AdminRoles = $EIDc.RoleAssignments | Where-Object { $_.RoleName -match 'Global Admin|Privileged Role Admin|Security Admin|Exchange Admin' }
        $OnPremAdmins = $AdminRoles | Where-Object {
            $u = $EIDc.Users | Where-Object { $_.UserPrincipalName -eq $_.MemberUPN } | Select-Object -First 1
            $u -and $u.OnPremisesSyncEnabled -eq $true
        }
        $SyncedAdmins = $EIDc.Users | Where-Object {
            $_.OnPremisesSyncEnabled -eq $true -and
            ($EIDc.RoleAssignments | Where-Object { $_.MemberUPN -eq $_.UserPrincipalName }).Count -gt 0
        }
        $CloudOnlyStatus = if ($SyncedAdmins.Count -eq 0) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Entra ID" -Control "CIS.1.1.1" `
            -Description "Administrative Konten sind Cloud-only (nicht On-Premises-sync)" `
            -Status $CloudOnlyStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if ($SyncedAdmins.Count -gt 0) {"$($SyncedAdmins.Count) Admin-Konten sind On-Premises synchronisiert (sollten dedizierte Cloud-Konten sein)"} else {'Alle Admin-Konten sind Cloud-only'})" `
            -Recommendation "Erstellen Sie dedizierte Cloud-only Admin-Konten. Hybride Konten sollen keine privilegierten Rollen erhalten." `
            -Reference "https://www.cisecurity.org/benchmark/microsoft_365"
    }

    # ── CIS 1.3.1 (L1) Kennwoerter laufen nie ab ─────────────────────────────────
    if ($ReportData.EntraID) {
        $OrgConfig = $ReportData.EntraID
        # Pruefen via Domain Password Policy - Domains mit Password-Expiry
        $PwdExpiry = $OrgConfig.VerifiedDomains | Where-Object {
            # Falls nicht 'never expire', dann Problem
            $_.PasswordValidityPeriodInDays -gt 0 -and $_.PasswordValidityPeriodInDays -lt 730 2>$null
        }
        # Vereinfachter Check: wenn Tenant-Setting vorhanden
        $PwdStatus = 'INFO'
        Add-ComplianceFinding -Category "Entra ID" -Control "CIS.1.3.1" `
            -Description "Kennwortablauf-Richtlinie: Kennwoerter laufen nie ab" `
            -Status $PwdStatus -Severity 'Low' -Source "CIS v6 L1" `
            -Finding "M365 Admin Center > Einstellungen > Sicherheit > Kennwortablaufrichtlinie pruefen (empfohlen: nie ablaufen, da MFA aktiv)" `
            -Recommendation "Wenn MFA aktiv ist: Kennwoerter auf 'Nie ablaufen' setzen (Admin Center > Sicherheit > Kennwortablauf)" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/admin/misc/password-policy-recommendations"
    }

    # ── CIS 1.3.5 (L1) Forms Phishing-Schutz ─────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.TenantSettings.Count -gt 0) {
        $FormsPhishing = $ReportData.EntraID.TenantSettings['FormsPhishingEnabled']
        $FormsStatus = if ($FormsPhishing -eq $true) { 'PASS' } elseif ($FormsPhishing -eq $false) { 'FAIL' } else { 'INFO' }
        Add-ComplianceFinding -Category "Entra ID" -Control "CIS.1.3.5" `
            -Description "Microsoft Forms: Interner Phishing-Schutz aktiviert" `
            -Status $FormsStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($FormsStatus -eq 'FAIL') {'Forms Phishing-Schutz ist deaktiviert'} else {'Status nicht automatisch pruefbar - manuell verifizieren'})" `
            -Recommendation "M365 Admin Center > Einstellungen > Microsoft Forms > Internen Schutz vor Phishing aktivieren" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/admin/misc/forms-phishing"
    }

    # ── CIS 2.1.2 (L1) Common Attachment Types Filter ────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.AntiMalwarePolicies.Count -gt 0) {
        $AttachFilter = $ReportData.Exchange.AntiMalwarePolicies | Where-Object { $_.EnableFileFilter -eq $true }
        $AttachStatus = if ($AttachFilter.Count -gt 0) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.2.1.2" `
            -Description "Common Attachment Types Filter aktiviert (Anti-Malware Policy)" `
            -Status $AttachStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if ($AttachStatus -eq 'FAIL') {'Kein Common Attachment Types Filter aktiv - gefaehrliche Dateitypen werden nicht blockiert'} else {"$($AttachFilter.Count) Anti-Malware Policy/Policies mit Attachment-Filter"})" `
            -Recommendation "Exchange Admin > Anti-Malware > Attachment-Filter aktivieren (blockiert .exe, .vbs, .js etc.)" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-malware-protection"
    }

    # ── CIS 2.1.3 (L1) Malware-Benachrichtigung fuer interne User ────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.AntiMalwarePolicies.Count -gt 0) {
        $MalNotify = $ReportData.Exchange.AntiMalwarePolicies | Where-Object { $_.EnableInternalSenderAdminNotifications -eq $true }
        $MalNotStatus = if ($MalNotify.Count -gt 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.2.1.3" `
            -Description "Malware-Benachrichtigung fuer intern gesendete Malware aktiviert" `
            -Status $MalNotStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($MalNotStatus -eq 'WARNING') {'Keine Admin-Benachrichtigung bei intern gesendeter Malware konfiguriert'} else {'Admin-Benachrichtigung aktiv'})" `
            -Recommendation "Anti-Malware Policy: EnableInternalSenderAdminNotifications aktivieren und Admin-E-Mail hinterlegen" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-malware-protection"
    }

    # ── CIS 2.1.6 (L1) Outbound Spam: Admin benachrichtigen ──────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.OutboundSpamPolicies.Count -gt 0) {
        $OutSpamNotify = $ReportData.Exchange.OutboundSpamPolicies | Where-Object {
            $_.NotifyOutboundSpam -eq $true -or $_.BccSuspiciousOutboundMail -eq $true
        }
        $OutSpamStatus = if ($OutSpamNotify.Count -gt 0) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.2.1.6" `
            -Description "Outbound-Spam-Richtlinie: Admins werden bei Spam-Versand benachrichtigt" `
            -Status $OutSpamStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($OutSpamStatus -eq 'FAIL') {'Keine Admin-Benachrichtigung bei Outbound-Spam konfiguriert - kompromittierte Konten bleiben unerkannt'} else {'Outbound-Spam-Benachrichtigung aktiv'})" `
            -Recommendation "Exchange Admin > Anti-Spam > Outbound-Richtlinie: NotifyOutboundSpam aktivieren" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/outbound-spam-policies-configure"
    }

    # ── CIS 2.1.12 (L1) Connection Filter IP Allow-List leer ─────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.AntiSpamPolicies.Count -gt 0) {
        $IPAllowList = $ReportData.Exchange.AntiSpamPolicies | Where-Object { $_.IPAllowList -and $_.IPAllowList.Count -gt 0 }
        $IPAlStatus = if ($IPAllowList.Count -eq 0) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.2.1.12" `
            -Description "Connection Filter: IP-Allow-List ist leer" `
            -Status $IPAlStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if ($IPAllowList.Count -gt 0) {'IP-Allow-List enthaelt Eintraege - diese IPs umgehen alle Spam-Filter'} else {'IP-Allow-List ist leer - korrekt'})" `
            -Recommendation "Exchange Admin > Connection-Filter > IP-Allow-List leeren. Stattdessen Safe Sender Lists pro Mailbox verwenden." `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/connection-filter-policies-configure"
    }

    # ── CIS 2.1.13 (L1) Connection Filter Safe-List deaktiviert ──────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.AntiSpamPolicies.Count -gt 0) {
        $SafeList = $ReportData.Exchange.AntiSpamPolicies | Where-Object { $_.EnableSafeList -eq $true }
        $SafeListStatus = if ($SafeList.Count -eq 0) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.2.1.13" `
            -Description "Connection Filter: Safe-List ist deaktiviert" `
            -Status $SafeListStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($SafeList.Count -gt 0) {'Connection Filter Safe-List ist aktiv - kann Spam-Schutz umgehen'} else {'Safe-List deaktiviert - korrekt'})" `
            -Recommendation "Exchange Admin > Connection-Filter Policy > EnableSafeList = False" `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/connection-filter-policies-configure"
    }

    # ── CIS 3.2.1 (L1) DLP Policies vorhanden ────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.RetentionPolicies -ne $null) {
        # DLP nicht direkt ueber EXO abrufbar, pruefen ob Sensitivity Labels als Proxy
        $HasDLP = ($ReportData.EntraID -and $ReportData.EntraID.SensitivityLabels.Count -gt 0)
        $DLPStatus = if ($HasDLP) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Compliance" -Control "CIS.3.2.1" `
            -Description "DLP-Richtlinien (Data Loss Prevention) vorhanden" `
            -Status $DLPStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if (-not $HasDLP) {'Keine DLP-Policies oder Sensitivity Labels konfiguriert - personenbezogene Daten ungeschuetzt'} else {'Sensitivity Labels vorhanden (DLP muss im Purview Portal verifiziert werden)'})" `
            -Recommendation "Microsoft Purview > Data Loss Prevention > DLP-Policies erstellen (Kreditkarten, Personalausweis, etc.)" `
            -Reference "https://learn.microsoft.com/en-us/purview/dlp-learn-about-dlp"
    }

    # ── CIS 5.1.3.1 (L1) Dynamische Gruppe fuer Gaeste ───────────────────────────
    if ($ReportData.EntraID) {
        $GuestDynGroup = $ReportData.EntraID.DynamicGroups | Where-Object {
            $_.MembershipRule -match 'userType' -and $_.MembershipRule -match 'Guest'
        }
        $GuestGroupStatus = if ($GuestDynGroup.Count -gt 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Entra ID" -Control "CIS.5.1.3.1" `
            -Description "Dynamische Gruppe fuer Gastbenutzer vorhanden" `
            -Status $GuestGroupStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($GuestGroupStatus -eq 'WARNING') {'Keine dynamische Gruppe fuer Gastbenutzer - erschwert Verwaltung und Zugriffssteuerung'} else {"Dynamische Gastgruppe vorhanden: $($GuestDynGroup[0].DisplayName)"})" `
            -Recommendation "Entra ID > Gruppen > Neue Gruppe > Dynamisch > Regel: (user.userType -eq 'Guest')" `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership"
    }

    # ── CIS 6.1.2 (L1) Mailbox Audit-Bypass deaktiviert ──────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.AuditConfig) {
        $AuditBypass = $ReportData.Exchange.AuditConfig.AuditBypassEnabled 2>$null
        $BypassStatus = if ($AuditBypass -ne $true) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.6.1.2" `
            -Description "Mailbox Audit-Bypass ist deaktiviert" `
            -Status $BypassStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if ($AuditBypass -eq $true) {'Audit-Bypass ist aktiviert - Mailbox-Aktivitaeten werden nicht protokolliert'} else {'Audit-Bypass deaktiviert - korrekt'})" `
            -Recommendation "Get-MailboxAuditBypassAssociation | Remove-MailboxAuditBypassAssociation" `
            -Reference "https://learn.microsoft.com/en-us/exchange/policy-and-compliance/mailbox-audit-logging/bypass-mailbox-audit-logging"
    }

    # ── CIS 6.5.2 (L1) MailTips aktiviert ────────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.OrgConfig) {
        $MailTipsEnabled = $ReportData.Exchange.OrgConfig.MailTipsAllTipsEnabled
        $MailTipsStatus = if ($MailTipsEnabled -eq $true) { 'PASS' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.6.5.2" `
            -Description "MailTips fuer alle Benutzer aktiviert" `
            -Status $MailTipsStatus -Severity 'Low' -Source "CIS v6 L1" `
            -Finding "$(if ($MailTipsStatus -eq 'FAIL') {'MailTips deaktiviert - Benutzer erhalten keine Warnhinweise bei externem Versand oder grossen Verteilergruppen'} else {'MailTips aktiviert'})" `
            -Recommendation "Set-OrganizationConfig -MailTipsAllTipsEnabled `$true" `
            -Reference "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/mailtips/mailtips"
    }

    # ── CIS 6.5.4 (L1) SMTP AUTH deaktiviert ────────────────────────────────────
    if ($ReportData.Exchange -and $ReportData.Exchange.OrgConfig) {
        $SmtpAuth = $ReportData.Exchange.OrgConfig.SmtpClientAuthenticationDisabled
        $SmtpStatus = if ($SmtpAuth -eq $true) { 'PASS' } elseif ($SmtpAuth -eq $false) { 'FAIL' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.6.5.4" `
            -Description "SMTP AUTH organisationsweit deaktiviert" `
            -Status $SmtpStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if ($SmtpStatus -eq 'FAIL') {'SMTP AUTH ist aktiviert - ermoeoelicht Basic-Auth-basierte Verbindungen (Sicherheitsrisiko)'} elseif ($SmtpStatus -eq 'WARNING') {'SMTP AUTH Status nicht pruefbar'} else {'SMTP AUTH deaktiviert - korrekt'})" `
            -Recommendation "Set-TransportConfig -SmtpClientAuthenticationDisabled `$true (dann pro Mailbox selektiv freigeben falls benoetigt)" `
            -Reference "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission"
    }

    # ── CIS 7.2.1 (L1) SharePoint Legacy Auth blockiert ─────────────────────────
    if ($ReportData.SharePoint) {
        $SPO = $ReportData.SharePoint
        $LegacyAuthSPO = $SPO.LegacyAuthEnabled 2>$null
        $SPOLegStatus = if ($LegacyAuthSPO -eq $false) { 'PASS' } elseif ($LegacyAuthSPO -eq $true) { 'FAIL' } else { 'INFO' }
        Add-ComplianceFinding -Category "SharePoint Online" -Control "CIS.7.2.1" `
            -Description "SharePoint: Legacy-Authentifizierung blockiert" `
            -Status $SPOLegStatus -Severity 'High' -Source "CIS v6 L1" `
            -Finding "$(if ($SPOLegStatus -eq 'FAIL') {'SharePoint erlaubt Legacy-Auth-Verbindungen ohne MFA'} elseif ($SPOLegStatus -eq 'INFO') {'Status nicht automatisch pruefbar - manuell verifizieren'} else {'Legacy-Auth blockiert - korrekt'})" `
            -Recommendation "SharePoint Admin Center > Zugriffssteuerung > Apps ohne moderne Authentifizierung > Blockieren" `
            -Reference "https://learn.microsoft.com/en-us/sharepoint/control-access-from-unmanaged-devices"
    }

    # ── CIS 8.1.2 (L1) Teams: Anonyme Meeting-Beitritte eingeschraenkt ──────────
    if ($ReportData.Teams -and $ReportData.Teams.TeamsSettings) {
        $AnonMeeting = $ReportData.Teams.TeamsSettings | Where-Object { $_.DisplayName -like '*AllowAnonymousUserToJoinMeeting*' } | Select-Object -First 1
        $AnonValue   = if ($AnonMeeting) { $AnonMeeting.Value } else { $null }
        $AnonStatus  = if ($AnonValue -eq $false) { 'PASS' } elseif ($AnonValue -eq $true) { 'WARNING' } else { 'INFO' }
        Add-ComplianceFinding -Category "Microsoft Teams" -Control "CIS.8.1.2" `
            -Description "Teams: Anonyme Benutzer koennen Meetings beitreten (kontrolliert)" `
            -Status $AnonStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($AnonStatus -eq 'WARNING') {'Anonyme Benutzer koennen Meetings beitreten ohne Identifikation'} else {'Status pruefbar - Teams Admin Center > Meeting Settings > Teilnehmer'})" `
            -Recommendation "Teams Admin Center > Besprechungseinstellungen > Anon-Beitritte deaktivieren oder Lobby erzwingen" `
            -Reference "https://learn.microsoft.com/en-us/microsoftteams/meeting-settings-in-teams"
    }

    # ── CIS 8.5.1 (L1) Teams: Lobby fuer externe Teilnehmer ─────────────────────
    if ($ReportData.Teams -and $ReportData.Teams.TeamsSettings) {
        $LobbyBypass = $ReportData.Teams.TeamsSettings | Where-Object { $_.DisplayName -like '*AutoAdmittedUsers*' } | Select-Object -First 1
        $LobbyValue  = if ($LobbyBypass) { $LobbyBypass.Value } else { $null }
        # 'Everyone' = keine Lobby; 'EveryoneInCompany' = korrekt
        $LobbyStatus = if ($LobbyValue -eq 'EveryoneInCompanyExcludingGuests' -or $LobbyValue -eq 'OrganizerOnly') { 'PASS' } `
                       elseif ($LobbyValue -eq 'Everyone') { 'FAIL' } else { 'INFO' }
        Add-ComplianceFinding -Category "Microsoft Teams" -Control "CIS.8.5.1" `
            -Description "Teams: Externe Teilnehmer warten in Lobby" `
            -Status $LobbyStatus -Severity 'Medium' -Source "CIS v6 L1" `
            -Finding "$(if ($LobbyStatus -eq 'FAIL') {'Alle Teilnehmer koennen Lobby umgehen - externe Personen treten direkt bei'} else {'Lobby-Einstellung pruefbar im Teams Admin Center'})" `
            -Recommendation "Teams Admin Center > Besprechungsrichtlinien > Automatisch zugelassen: EveryoneInCompanyExcludingGuests" `
            -Reference "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-participants-and-guests"
    }

    # ── CIS 8.6.1 (L1) Teams: Aufzeichnungs-Ablauf aktiviert ────────────────────
    if ($ReportData.Teams -and $ReportData.Teams.TeamsSettings) {
        $RecExpiry = $ReportData.Teams.TeamsSettings | Where-Object { $_.DisplayName -like '*NewMeetingRecordingExpirationDays*' } | Select-Object -First 1
        $RecValue  = if ($RecExpiry) { [int]$RecExpiry.Value } else { -1 }
        # -1 = kein Ablauf, sonst Tage
        $RecStatus = if ($RecValue -gt 0 -and $RecValue -le 180) { 'PASS' } elseif ($RecValue -le 0) { 'WARNING' } else { 'INFO' }
        Add-ComplianceFinding -Category "Microsoft Teams" -Control "CIS.8.6.1" `
            -Description "Teams: Aufzeichnungen laufen automatisch ab" `
            -Status $RecStatus -Severity 'Low' -Source "CIS v6 L1" `
            -Finding "$(if ($RecStatus -eq 'WARNING') {'Aufzeichnungen laufen nie ab - Speicherkosten und Datenschutzrisiko'} else {"Ablauf konfiguriert: $RecValue Tage"})" `
            -Recommendation "Teams Admin Center > Besprechungsrichtlinien > Aufzeichnungsablauf aktivieren (empfohlen: 60-120 Tage)" `
            -Reference "https://learn.microsoft.com/en-us/microsoftteams/meeting-recording"
    }

    # ── CIS L2 Controls (Enhanced - nur wenn konfigurierbar) ────────────────────

    # CIS 1.2.1 (L2) Keine oeffentlichen Gruppen ohne Genehmigung
    if ($ReportData.EntraID) {
        $PublicGroups = $ReportData.EntraID.M365Groups | Where-Object { $_.Visibility -eq 'Public' }
        $PubGrpStatus = if ($PublicGroups.Count -eq 0) { 'PASS' } elseif ($PublicGroups.Count -le 5) { 'WARNING' } else { 'FAIL' }
        Add-ComplianceFinding -Category "Entra ID" -Control "CIS.1.2.1" `
            -Description "Nur genehmigte oeffentliche M365-Gruppen vorhanden" `
            -Status $PubGrpStatus -Severity 'Medium' -Source "CIS v6 L2" `
            -Finding "$($PublicGroups.Count) oeffentliche M365-Gruppen (alle Org-Mitglieder koennen beitreten und Inhalte sehen)" `
            -Recommendation "Pruefen Sie alle oeffentlichen Gruppen. Setzen Sie nicht benoedigte auf 'Privat'." `
            -Reference "https://learn.microsoft.com/en-us/microsoft-365/admin/create-groups/compare-groups"
    }

    # CIS 1.3.3 (L2) Kalender-Extern-Teilen deaktiviert
    if ($ReportData.Exchange -and $ReportData.Exchange.OrgConfig) {
        $CalShare = $ReportData.Exchange.OrgConfig.SharingPolicyEnabled
        $CalStatus = if ($CalShare -eq $false) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Exchange Online" -Control "CIS.1.3.3" `
            -Description "Externes Teilen von Kalendern deaktiviert oder eingeschraenkt" `
            -Status $CalStatus -Severity 'Low' -Source "CIS v6 L2" `
            -Finding "$(if ($CalStatus -eq 'WARNING') {'Kalenderdaten koennen mit externen Personen geteilt werden'} else {'Externes Kalender-Sharing deaktiviert'})" `
            -Recommendation "Exchange Admin > Organisation > Freigabe > Freigaberichtlinien: Externes Teilen einschraenken" `
            -Reference "https://learn.microsoft.com/en-us/exchange/sharing/sharing-policies/sharing-policies"
    }

    # CIS 4.1 (L2) Geraete ohne Compliance-Policy als 'nicht compliant' markieren
    if ($ReportData.Intune -and $ReportData.Intune.CompliancePolicies.Count -gt 0) {
        # Pruefen ob Default-Compliance-Action konfiguriert ist
        $HasDefaultPolicy = $ReportData.Intune.CompliancePolicies | Where-Object { $_.Name -match 'default|Default' }
        $DefPolStatus = if ($HasDefaultPolicy.Count -gt 0) { 'PASS' } else { 'WARNING' }
        Add-ComplianceFinding -Category "Intune" -Control "CIS.4.1" `
            -Description "Geraete ohne Compliance-Policy als nicht-konform markieren" `
            -Status $DefPolStatus -Severity 'Medium' -Source "CIS v6 L2" `
            -Finding "$(if ($DefPolStatus -eq 'WARNING') {'Keine Default-Compliance-Policy - Geraete ohne Policy gelten als konform'} else {'Default-Compliance-Policy vorhanden'})" `
            -Recommendation "Intune > Geraete > Compliance-Richtlinien > Compliance-Einstellungen > Geraet ohne Richtlinie als nicht konform markieren" `
            -Reference "https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started"
    }

    # CIS 5.1.2.6 (L2) LinkedIn deaktiviert
    if ($ReportData.EntraID -and $ReportData.EntraID.TenantSettings.Count -gt 0) {
        $LinkedInTS = $ReportData.EntraID.TenantSettings['LinkedInEnabled']
        $LIStatus = if ($LinkedInTS -eq $false) { 'PASS' } elseif ($LinkedInTS -eq $true) { 'WARNING' } else { 'INFO' }
        Add-ComplianceFinding -Category "Entra ID" -Control "CIS.5.1.2.6" `
            -Description "LinkedIn-Kontoverbindungen deaktiviert" `
            -Status $LIStatus -Severity 'Low' -Source "CIS v6 L2" `
            -Finding "$(if ($LIStatus -eq 'WARNING') {'LinkedIn-Kontoverbindungen aktiviert - Datenschutzrisiko'} else {'Status: manuell im Entra Portal pruefen'})" `
            -Recommendation "Entra > Benutzereinstellungen > LinkedIn-Kontoverbindungen > Nein" `
            -Reference "https://learn.microsoft.com/en-us/entra/identity/users/linkedin-integration"
    }

    Write-Log "Compliance-Check abgeschlossen: $($Global:ComplianceFindings.Count) Prüfungen durchgeführt" -Level Success
    return $true
}

# ============================================================
# LIZENZ-GAP-ANALYSE
# ============================================================
function Get-LicenseGapAnalysis {
    <#
    Prueft welche sicherheitsrelevanten Lizenzen fehlen und gibt
    priorisierte Empfehlungen mit Begruendung aus.
    #>
    $Gaps = [System.Collections.Generic.List[object]]::new()

    if (-not $ReportData.EntraID) { return $Gaps }
    $EID = $ReportData.EntraID

    # Vorhandene Lizenz-SKUs normalisieren
    $HasLicenses = @{}
    foreach ($SKU in @($EID.Licenses)) {
        if ($SKU -and $SKU.SkuPartNumber) {
            $HasLicenses[$SKU.SkuPartNumber] = $true
        }
    }

    # Helper: Lizenz vorhanden?
    $Has = { param($Patterns) ($Patterns | Where-Object { $P = $_; $HasLicenses.Keys | Where-Object { $_ -like $P } }).Count -gt 0 }

    $HasP1 = & $Has @('AAD_PREMIUM*','EMS*','M365*','O365_BUSINESS_PREMIUM*','ENTERPRISEPREMIUM*','SPE_E3*','SPE_E5*')
    $HasP2 = & $Has @('AAD_PREMIUM_P2*','EMS_E5*','M365_E5*','SPE_E5*','IDENTITY_THREAT_PROTECTION*')
    $HasDefenderP1 = & $Has @('ATP_ENTERPRISE*','MDO*','M365_BUSINESS_PREMIUM*','DEFENDER_FOR_OFFICE*')
    $HasDefenderP2 = & $Has @('THREAT_INTELLIGENCE*','M365_E5*','DEFENDER_FOR_ENDPOINT_P2*')
    $HasIntuneP1 = & $Has @('INTUNE_A*','EMS*','M365*','MICROSOFTINTUNE*')
    $HasE3orBetter = & $Has @('*E3*','*E5*','SPE_*','M365*')

    # ── Entra ID P1 (Conditional Access, SSPR mit Writeback, Named Locations) ───
    if (-not $HasP1) {
        $Gaps.Add([PSCustomObject]@{
            Priority    = 1
            License     = 'Microsoft Entra ID P1'
            SKU         = 'AAD_PREMIUM / EMS E3 / M365 Business Premium'
            MonthlyEUR  = '~6 €/User'
            UnlocksWhat = 'Conditional Access, SSPR mit Password Writeback, Sign-In Risk Policies, Named Locations, Hybrid Join'
            WhyNeeded   = 'Ohne P1 koennen CISA-Pflichtcontrols (CA-basierte MFA, Legacy-Auth-Block) nicht umgesetzt werden. Aktuell: Keine CA-Policies moeglich.'
            CISAControls = 'MS.AAD.1.1, MS.AAD.1.2, MS.AAD.3.1'
            Urgency     = 'Kritisch'
        })
    }

    # ── Entra ID P2 (PIM, Identity Protection, Access Reviews) ──────────────────
    if (-not $HasP2) {
        $Gaps.Add([PSCustomObject]@{
            Priority    = 2
            License     = 'Microsoft Entra ID P2'
            SKU         = 'AAD_PREMIUM_P2 / EMS E5 / M365 E5'
            MonthlyEUR  = '~9 €/User (fuer Admins ausreichend)'
            UnlocksWhat = 'Privileged Identity Management (PIM), Identity Protection (Risk-Policies), Access Reviews'
            WhyNeeded   = 'PIM verhindert permanente Admin-Rollen (just-in-time). Identity Protection erkennt kompromittierte Konten automatisch.'
            CISAControls = 'MS.AAD.2.3, MS.AAD.8.1'
            Urgency     = if ($EID.RiskyUsers.Count -gt 0) { 'Kritisch' } else { 'Hoch' }
        })
    } elseif (-not $EID.PIMEnabled) {
        $Gaps.Add([PSCustomObject]@{
            Priority    = 2
            License     = 'Entra ID P2 vorhanden - PIM nicht aktiviert'
            SKU         = 'Kein Lizenzkauf noetig'
            MonthlyEUR  = '0 € (Lizenz vorhanden)'
            UnlocksWhat = 'PIM muss im Entra Portal aktiviert und konfiguriert werden'
            WhyNeeded   = 'P2-Lizenz vorhanden, aber PIM ist nicht aktiv. Privilegierte Rollen sind dauerhaft vergeben.'
            CISAControls = 'MS.AAD.2.3'
            Urgency     = 'Hoch'
        })
    }

    # ── Microsoft Defender for Office 365 P1 (Safe Links, Safe Attachments) ─────
    if (-not $HasDefenderP1 -and $ReportData.Exchange) {
        $NoSafeLinks = ($ReportData.Exchange.SafeLinksPolicies.Count -eq 0)
        $NoSafeAttach = ($ReportData.Exchange.SafeAttachPolicies.Count -eq 0)
        if ($NoSafeLinks -or $NoSafeAttach) {
            $Gaps.Add([PSCustomObject]@{
                Priority    = 3
                License     = 'Microsoft Defender for Office 365 P1'
                SKU         = 'ATP_ENTERPRISE / MDO_P1 / M365 Business Premium'
                MonthlyEUR  = '~2 €/User'
                UnlocksWhat = 'Safe Links (URL-Pruefung in Echtzeit), Safe Attachments (Sandbox fuer Anhaenge), Anti-Phishing (Impersonation-Schutz)'
                WhyNeeded   = 'Ohne Safe Links und Safe Attachments sind Phishing- und Malware-Angriffe per E-Mail schwerer abzuwehren. CISA Pflichtcontrols.'
                CISAControls = 'MS.EXO.8.1, MS.EXO.9.1'
                Urgency     = 'Hoch'
            })
        }
    }

    # ── Microsoft Intune (MDM/MAM) ───────────────────────────────────────────────
    if (-not $HasIntuneP1 -and $ReportData.Intune -and $ReportData.Intune.TotalDevices -eq 0) {
        $Gaps.Add([PSCustomObject]@{
            Priority    = 4
            License     = 'Microsoft Intune Plan 1'
            SKU         = 'INTUNE_A / EMS E3 / M365'
            MonthlyEUR  = '~8 €/User'
            UnlocksWhat = 'Mobile Device Management, Compliance Policies, App Protection, Autopilot, Config Profiles'
            WhyNeeded   = 'Keine Geraeteverwaltung aktiv. Endgeraete sind nicht zentral verwaltbar - kein erzwingbarer Sicherheitsstandard.'
            CISAControls = 'MS.DEFENDER.4.1, BSI SYS.2.1'
            Urgency     = 'Hoch'
        })
    }

    # ── Defender for Endpoint P2 (EDR, Threat Hunting) ──────────────────────────
    if (-not $HasDefenderP2 -and $ReportData.Intune -and $ReportData.Intune.TotalDevices -gt 0) {
        $ThreatDevices = @($ReportData.Intune.AllDevices | Where-Object { $_.PartnerReportedThreatState -notin @('unknown','activated','deactivated',$null) })
        if ($ThreatDevices.Count -gt 0) {
            $Gaps.Add([PSCustomObject]@{
                Priority    = 3
                License     = 'Microsoft Defender for Endpoint P2'
                SKU         = 'MDATP / M365_E5 / Defender for Business'
                MonthlyEUR  = '~5 €/Geraet oder M365 Business Premium'
                UnlocksWhat = 'Endpoint Detection and Response (EDR), Threat & Vulnerability Management, Automated Investigation'
                WhyNeeded   = "$($ThreatDevices.Count) Geraete melden Bedrohungsstatus. EDR ermoeglicht detaillierte Analyse und automatische Reaktion."
                CISAControls = 'MS.DEFENDER.5.1'
                Urgency     = 'Kritisch'
            })
        }
    }

    # ── Microsoft Purview (Compliance, DLP, Sensitivity Labels) ─────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.SensitivityLabels.Count -eq 0) {
        $HasPurview = & $Has @('*INFORMATION_PROTECTION*','*COMPLIANCE*','*E5*','*M365*')
        if (-not $HasPurview -or -not $HasE3orBetter) {
            $Gaps.Add([PSCustomObject]@{
                Priority    = 5
                License     = 'Microsoft Purview Information Protection'
                SKU         = 'M365 E3/E5 oder Purview Add-on'
                MonthlyEUR  = 'In M365 E3 enthalten'
                UnlocksWhat = 'Sensitivity Labels (Klassifizierung), DLP-Policies, Retention Policies, eDiscovery, Audit'
                WhyNeeded   = 'Keine Sensitivity Labels konfiguriert. Datenschutz-Klassifizierung und DSGVO-Compliance erfordert Purview.'
                CISAControls = 'BSI ORP.1, DSGVO Art. 32'
                Urgency     = 'Mittel'
            })
        }
    }

    return ($Gaps | Sort-Object Priority)
}

# ============================================================
# SCORE-BERECHNUNG
# ============================================================
function Get-ComplianceScore {
    $Findings = $Global:ComplianceFindings
    $Total    = ($Findings | Where-Object { $_.Status -ne 'SKIPPED' -and $_.Status -ne 'INFO' }).Count
    $Passed   = ($Findings | Where-Object { $_.Status -eq 'PASS' }).Count
    $Failed   = ($Findings | Where-Object { $_.Status -eq 'FAIL' }).Count
    $Warnings = ($Findings | Where-Object { $_.Status -eq 'WARNING' }).Count

    $Score = if ($Total -gt 0) { [math]::Round(($Passed / $Total) * 100) } else { 0 }

    $ByCategory = $Findings | Where-Object { $_.Status -ne 'INFO' -and $_.Status -ne 'SKIPPED' } |
        Group-Object Category | ForEach-Object {
            $CatTotal  = $_.Count
            $CatPassed = ($_.Group | Where-Object { $_.Status -eq 'PASS' }).Count
            $CatScore  = if ($CatTotal -gt 0) { [math]::Round(($CatPassed / $CatTotal) * 100) } else { 0 }
            [PSCustomObject]@{
                Category = $_.Name
                Total    = $CatTotal
                Passed   = $CatPassed
                Failed   = ($_.Group | Where-Object { $_.Status -eq 'FAIL' }).Count
                Warnings = ($_.Group | Where-Object { $_.Status -eq 'WARNING' }).Count
                Score    = $CatScore
            }
        }

    return @{
        Overall   = $Score
        Total     = $Total
        Passed    = $Passed
        Failed    = $Failed
        Warnings  = $Warnings
        ByCategory = $ByCategory
    }
}

# ============================================================
# HTML REPORT GENERIERUNG
# ============================================================
$HTMLHeader = @"
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M365 Tenant Inventory Report</title>
    <style>
        /* enthus CI: #1a2f5a (Dunkelblau), #c8e600 (Lime), #00b4d8 (Cyan), #f4f6f8 (Hellgrau) */
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background: #f4f6f8; color: #1a1a1a; line-height: 1.5; }
        .nav-container { position: fixed; top: 0; left: 0; width: 260px; height: 100vh; background: #1a2f5a; overflow-y: auto; z-index: 1000; box-shadow: 2px 0 8px rgba(0,0,0,0.15); }
        .nav-header { background: #1a2f5a; border-bottom: 3px solid #c8e600; color: white; padding: 18px 15px; font-weight: bold; font-size: 15px; }
        .nav-logo { color: #c8e600; font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
        .nav-version { font-size: 11px; opacity: 0.7; margin-top: 3px; color: #b0bec5; }
        .nav-menu { padding: 8px 0; margin: 0; list-style: none; }
        .nav-menu li a { display: block; padding: 8px 18px; color: #b0c4de; text-decoration: none; font-size: 13px; transition: background 0.2s; }
        .nav-menu li a:hover { background: #243d6b; color: #c8e600; }
        .nav-section { padding: 10px 18px 4px; font-size: 10px; color: #c8e600; text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; font-weight: 700; }
        .main-content { margin-left: 260px; padding: 24px; }
        .page-title { font-size: 26px; font-weight: 700; color: #1a2f5a; margin-bottom: 6px; }
        .page-subtitle { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
        .container { background: white; padding: 22px; border-radius: 8px; box-shadow: 0 1px 4px rgba(26,47,90,0.08); margin-bottom: 20px; border-top: 3px solid #1a2f5a; }
        h2 { color: #1a2f5a; font-size: 18px; font-weight: 700; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb; }
        h3 { color: #1a2f5a; font-size: 15px; font-weight: 600; margin: 18px 0 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #1a2f5a; color: white; font-weight: 600; padding: 10px 12px; text-align: left; }
        td { padding: 9px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
        tr:hover td { background: #f8faff; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .stat-card { background: #f4f6f8; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; border-bottom: 3px solid #1a2f5a; }
        .stat-number { font-size: 28px; font-weight: 700; color: #1a2f5a; }
        .stat-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
        .stat-card.critical { border-bottom-color: #dc2626; }
        .stat-card.critical .stat-number { color: #dc2626; }
        .stat-card.warning  { border-bottom-color: #d97706; }
        .stat-card.warning  .stat-number { color: #d97706; }
        .stat-card.success  { border-bottom-color: #16a34a; }
        .stat-card.success  .stat-number { color: #16a34a; }
        .badge { display: inline-block; padding: 2px 9px; border-radius: 12px; font-size: 11px; font-weight: 600; }
        .badge-pass     { background: #dcfce7; color: #15803d; }
        .badge-fail     { background: #fee2e2; color: #b91c1c; }
        .badge-warn     { background: #fef9c3; color: #92400e; }
        .badge-warning  { background: #fef9c3; color: #92400e; }
        .badge-info     { background: #dbeafe; color: #1d4ed8; }
        .badge-skipped  { background: #f3f4f6; color: #6b7280; }
        .badge-critical { background: #fee2e2; color: #7f1d1d; }
        .badge-high     { background: #ffedd5; color: #9a3412; }
        .badge-medium   { background: #fef9c3; color: #78350f; }
        .badge-low      { background: #f0fdf4; color: #166534; }
        .score-bar-wrap { height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden; margin: 6px 0; }
        .score-bar      { height: 100%; border-radius: 5px; transition: width 0.5s; }
        .score-green  { background: #c8e600; }
        .score-yellow { background: #eab308; }
        .score-red    { background: #ef4444; }
        .score-circle { display: inline-flex; align-items: center; justify-content: center; width: 90px; height: 90px; border-radius: 50%; font-size: 24px; font-weight: 700; border: 6px solid; }
        .score-circle.green  { color: #1a2f5a; border-color: #c8e600; }
        .score-circle.yellow { color: #92400e; border-color: #eab308; }
        .score-circle.red    { color: #b91c1c; border-color: #ef4444; }
        .collapsible { background: none; border: none; width: 100%; text-align: left; cursor: pointer; font-weight: 600; font-size: 14px; padding: 6px 0; color: #1a2f5a; }
        .collapsible:hover { color: #00b4d8; }
        .collapsible-content { display: none; margin-top: 8px; }
        .collapsible-content.open { display: block; }
        .rec-box { background: #f0f7ff; border-left: 4px solid #1a2f5a; border-radius: 0 6px 6px 0; padding: 10px 14px; margin-top: 6px; font-size: 13px; color: #1a2f5a; }
        .finding-box { background: #fef9c3; border-left: 4px solid #eab308; border-radius: 0 6px 6px 0; padding: 8px 14px; margin-top: 4px; font-size: 12px; }
        .tag-cisa { background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 4px; font-size: 10px; }
        .tag-bsi  { background: #f0fdf4; color: #14532d; padding: 1px 6px; border-radius: 4px; font-size: 10px; }
        .tag-ms   { background: #f0f9ff; color: #0c4a6e; padding: 1px 6px; border-radius: 4px; font-size: 10px; }
        .info-bar { background: #f4f6f8; border: 1px solid #dde3ec; border-left: 4px solid #00b4d8; border-radius: 0 8px 8px 0; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: #374151; }
        .critical-row td { background: #fff7f7; }
        .warning-row  td { background: #fffbeb; }
        a { color: #1a2f5a; text-decoration: none; }
        a:hover { color: #00b4d8; text-decoration: underline; }
        @media print { .nav-container { display: none; } .main-content { margin-left: 0; } }
    </style>
    <script>
        function toggleSection(id) {
            var el = document.getElementById(id);
            if (el) el.classList.toggle('open');
        }
    </script>
</head>
<body>
"@

function Generate-HTMLReport {
    param(
        [PSCustomObject]$ModConfig,
        [hashtable]$Score,
        [object[]]$LicenseGaps = @()
    )
    Write-Progress-Status "HTML" "Erstelle Report..." 95
    $sb      = [System.Text.StringBuilder]::new(4MB)
    $EndTime = Get-Date
    $Duration = $EndTime - $StartTime

    $sb.Append($HTMLHeader) | Out-Null

    # ── Navigation ──────────────────────────────────────────────────────────────
    $sb.AppendLine("<div class='nav-container'>") | Out-Null
    $sb.AppendLine("<div class='nav-header'><div class='nav-logo'>enthus</div>M365 Inventory<div class='nav-version'>v$ScriptVersion · $(Get-Date -Format 'dd.MM.yyyy HH:mm')</div></div>") | Out-Null
    $sb.AppendLine("<ul class='nav-menu'>") | Out-Null
    $sb.AppendLine("<li><a href='#summary'>📊 Executive Summary</a></li>") | Out-Null
    $sb.AppendLine("<li><a href='#compliance'>🛡 Compliance-Übersicht</a></li>") | Out-Null
    $sb.AppendLine("<li><a href='#compliance-details'>📋 Compliance-Details</a></li>") | Out-Null
    if ($LicenseGaps -and $LicenseGaps.Count -gt 0) {
        $sb.AppendLine("<li><a href='#license-gaps'>🔑 Lizenz-Empfehlungen</a></li>") | Out-Null
    }
    if ($ModConfig.EntraID) {
        $sb.AppendLine("<div class='nav-section'>Entra ID</div>") | Out-Null
        $sb.AppendLine("<li><a href='#tenant-meta'>🏢 Tenant</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#licenses'>📋 Lizenzen</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#entra-users'>👤 Benutzer</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#entra-groups'>👥 Gruppen</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#entra-ca'>🔐 Conditional Access</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#entra-roles'>🎖 Rollen</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#pim'>⏱ PIM</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#entra-apps'>📱 Apps</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#enterprise-apps'>🔗 Enterprise Apps</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#sspr'>🔑 SSPR</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#risky-users'>⚠️ Riskante User</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#inactive-users'>⏰ Inaktive User</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#app-permissions'>🔑 App-Berechtigungen</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#data-governance'>🗂 Governance</a></li>") | Out-Null
    }
    if ($ModConfig.Exchange) {
        $sb.AppendLine("<div class='nav-section'>Exchange Online</div>") | Out-Null
        $sb.AppendLine("<li><a href='#exo-mailboxes'>📬 Mailboxen</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#exo-holds'>🔒 Holds & Retention</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#exo-delegations'>👥 Delegierungen</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#exo-security'>🛡 E-Mail-Sicherheit</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#exo-transport'>⚙ Transport Rules</a></li>") | Out-Null
    }
    if ($ModConfig.Intune) {
        $sb.AppendLine("<div class='nav-section'>Intune</div>") | Out-Null
        $sb.AppendLine("<li><a href='#intune-devices'>💻 Geräte</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#intune-policies'>📑 Policies</a></li>") | Out-Null
    }
        $sb.AppendLine("<li><a href='#intune-coverage'>📵 Geraete-Abdeckung</a></li>") | Out-Null
        $sb.AppendLine("<li><a href='#intune-hybrid'>🏢 Hybrid-Analyse</a></li>") | Out-Null
    if ($ModConfig.Teams) {
        $sb.AppendLine("<div class='nav-section'>Teams</div>") | Out-Null
        $sb.AppendLine("<li><a href='#teams-overview'>💬 Teams-Übersicht</a></li>") | Out-Null
    }
    if ($ModConfig.SharePoint) {
        $sb.AppendLine("<div class='nav-section'>SharePoint</div>") | Out-Null
        $sb.AppendLine("<li><a href='#spo-sites'>🗂 Sites</a></li>") | Out-Null
    }
    $sb.AppendLine("<div class='nav-section'>System</div>") | Out-Null
    $sb.AppendLine("<li><a href='#error-log'>⚠ Fehlerprotokoll</a></li>") | Out-Null
    $sb.AppendLine("</ul></div>") | Out-Null
    $sb.AppendLine("<div class='main-content'>") | Out-Null

    # ── Page Title ───────────────────────────────────────────────────────────────
    $TenantLabel    = if ($ReportData.EntraID) { $ReportData.EntraID.TenantDomain } else { "M365 Tenant" }
    $TenantFullName = if ($ReportData.EntraID -and $ReportData.EntraID.TenantName) { $ReportData.EntraID.TenantName } else { $TenantLabel }
    $sb.AppendLine("<div class='page-title'>🏢 M365 Tenant Inventory &ndash; $TenantFullName</div>") | Out-Null
    $sb.AppendLine("<div class='page-subtitle'>Tenant-ID: <code>$(if ($ReportData.EntraID) {$ReportData.EntraID.TenantId})</code> &nbsp;·&nbsp; Domain: <strong>$TenantLabel</strong> &nbsp;·&nbsp; Erstellt: $($EndTime.ToString('dd.MM.yyyy HH:mm')) &nbsp;·&nbsp; Dauer: $([math]::Round($Duration.TotalMinutes,1)) Min &nbsp;·&nbsp; Erstellt von: $env:USERNAME</div>") | Out-Null

    # ── Executive Summary ─────────────────────────────────────────────────────────
    $sb.AppendLine("<div class='container' id='summary'>") | Out-Null
    $sb.AppendLine("<h2>📊 Executive Summary</h2>") | Out-Null

    # Score-Circle + Statistik
    $ScoreColor = if ($Score.Overall -ge 80) { 'green' } elseif ($Score.Overall -ge 60) { 'yellow' } else { 'red' }
    # Score-Trend laden
    $ScoreTrend = ""
    $TrendNote  = ""
    try {
        $TFPath = Join-Path $PSScriptRoot "M365-Inventory-Score-$($ReportData.EntraID.TenantId).json"
        if (Test-Path $TFPath) {
            $PrevScore = Get-Content $TFPath -Raw | ConvertFrom-Json
            $Diff = $Score.Overall - $PrevScore.Score
            if ($Diff -gt 0)      { $ScoreTrend = "<span style='color:#16a34a'>▲ +$Diff%</span>" }
            elseif ($Diff -lt 0)  { $ScoreTrend = "<span style='color:#dc2626'>▼ $Diff%</span>" }
            else                  { $ScoreTrend = "<span style='color:#6b7280'>= 0%</span>" }
            $TrendNote = "vs. $($PrevScore.Date)"
        }
    } catch {}
    $sb.AppendLine("<div style='display:flex; align-items:center; gap:30px; flex-wrap:wrap; margin-bottom:20px;'>") | Out-Null
    $TrendDiv = if ($ScoreTrend) { "<div style='font-size:13px;margin-top:4px;'>$ScoreTrend <small>$TrendNote</small></div>" } else { '' }
    $sb.AppendLine("<div style='text-align:center;'><div class='score-circle $ScoreColor'>$($Score.Overall)%</div><div style='font-size:12px;color:#6b7280;margin-top:6px;'>Compliance Score</div>$TrendDiv</div>") | Out-Null
    $sb.AppendLine("<div style='flex:1;min-width:300px;'>") | Out-Null
    $sb.AppendLine("<table style='width:100%;'>") | Out-Null
    $sb.AppendLine("<tr><th>Bereich</th><th>Score</th><th>PASS</th><th>FAIL</th><th>WARNING</th></tr>") | Out-Null
    foreach ($Cat in $Score.ByCategory) {
        $CatColor = if ($Cat.Score -ge 80) { 'score-green' } elseif ($Cat.Score -ge 60) { 'score-yellow' } else { 'score-red' }
        $sb.AppendLine("<tr><td>$($Cat.Category)</td><td><div class='score-bar-wrap'><div class='score-bar $CatColor' style='width:$($Cat.Score)%'></div></div>$($Cat.Score)%</td><td style='color:#16a34a'>$($Cat.Passed)</td><td style='color:#dc2626'>$($Cat.Failed)</td><td style='color:#d97706'>$($Cat.Warnings)</td></tr>") | Out-Null
    }
    $sb.AppendLine("</table></div></div>") | Out-Null

    # Stats
    $sb.AppendLine("<div class='stat-grid'>") | Out-Null
    if ($ReportData.EntraID) {
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($ReportData.EntraID.TotalUsers)</div><div class='stat-label'>Benutzer gesamt</div></div>") | Out-Null
        $_SC1 = if ($ReportData.EntraID.MFADisabled -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC1'><div class='stat-number'>$($ReportData.EntraID.MFADisabled)</div><div class='stat-label'>Ohne MFA</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($ReportData.EntraID.GuestUsers)</div><div class='stat-label'>Gastbenutzer</div></div>") | Out-Null
        $_SC2 = if ($ReportData.EntraID.RiskyUsers.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC2'><div class='stat-number'>$($ReportData.EntraID.RiskyUsers.Count)</div><div class='stat-label'>Riskante Benutzer</div></div>") | Out-Null
    }
    if ($ReportData.Exchange) {
        $_SC3 = if ($ReportData.Exchange.ExternalForwarding.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC3'><div class='stat-number'>$($ReportData.Exchange.ExternalForwarding.Count)</div><div class='stat-label'>Ext. Forwarding</div></div>") | Out-Null
    }
    if ($ReportData.Intune) {
        $_SC4 = if ($ReportData.Intune.NonCompliantDevices -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC4'><div class='stat-number'>$($ReportData.Intune.NonCompliantDevices)</div><div class='stat-label'>Non-compliant Geräte</div></div>") | Out-Null
    }
    $_SC5 = if ($Score.Failed -gt 0) { 'critical' } else { 'success' }
    $sb.AppendLine("<div class='stat-card $_SC5'><div class='stat-number'>$($Score.Failed)</div><div class='stat-label'>Compliance FAILs</div></div>") | Out-Null
    if ($ReportData.EntraID -and $ReportData.EntraID.TotalLicenses -gt 0) {
        $_SC6 = if ($ReportData.EntraID.UnusedLicenses -gt 10) { '' } else { '' }
        $sb.AppendLine("<div class='stat-card $_SC6'><div class='stat-number'>$($ReportData.EntraID.UnusedLicenses)</div><div class='stat-label'>Ungenutzte Lizenzen</div></div>") | Out-Null
    }
    if ($ReportData.EntraID) {
        $InactTot = $ReportData.EntraID.InactiveUsers90.Count + $ReportData.EntraID.NeverSignedIn.Count
        $_SC7 = if ($InactTot -gt 0) { '' } else { '' }
        $sb.AppendLine("<div class='stat-card $_SC7'><div class='stat-number'>$InactTot</div><div class='stat-label'>Inaktive User (>90d)</div></div>") | Out-Null
    }
    if ($ReportData.EntraID -and $ReportData.EntraID.PIMEnabled -eq $false) {
        $sb.AppendLine("<div class='stat-card critical'><div class='stat-number'>!</div><div class='stat-label'>PIM nicht aktiv</div></div>") | Out-Null
    }
    if ($ReportData.EntraID -and $ReportData.EntraID.DangerousEnterpriseApps.Count -gt 0) {
        $sb.AppendLine("<div class='stat-card critical'><div class='stat-number'>$($ReportData.EntraID.DangerousEnterpriseApps.Count)</div><div class='stat-label'>Krit. App-Grants</div></div>") | Out-Null
    }
    if ($ReportData.Exchange -and $ReportData.Exchange.SharedMailboxWithLogin.Count -gt 0) {
        $sb.AppendLine("<div class='stat-card critical'><div class='stat-number'>$($ReportData.Exchange.SharedMailboxWithLogin.Count)</div><div class='stat-label'>Shared MBX Login</div></div>") | Out-Null
    }
    if ($ReportData.Intune -and $ReportData.Intune.UsersWithoutDevice.Count -gt 0) {
        $sb.AppendLine("<div class='stat-card warning'><div class='stat-number'>$($ReportData.Intune.UsersWithoutDevice.Count)</div><div class='stat-label'>User ohne Geraet</div></div>") | Out-Null
    }
    if ($ReportData.Exchange -and $ReportData.Exchange.LitigationHoldMailboxes.Count -gt 0) {
        $sb.AppendLine("<div class='stat-card warning'><div class='stat-number'>$($ReportData.Exchange.LitigationHoldMailboxes.Count)</div><div class='stat-label'>Litigation Hold</div></div>") | Out-Null
    }
    $sb.AppendLine("</div>") | Out-Null

    # Kritische Findings direkt im Summary
    $TopCritical = $Global:ComplianceFindings | Where-Object { $_.Status -eq 'FAIL' -and $_.Severity -eq 'Critical' } | Select-Object -First 8
    if ($TopCritical.Count -gt 0) {
        $sb.AppendLine("<div style='background:#fff1f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin-top:16px;'>") | Out-Null
        $sb.AppendLine("<strong style='color:#dc2626;font-size:15px;'>🚨 Kritische Findings — Sofortiger Handlungsbedarf</strong><br><br>") | Out-Null
        $sb.AppendLine("<table><tr><th>Bereich</th><th>Kontrolle</th><th>Beschreibung</th><th>Finding</th></tr>") | Out-Null
        foreach ($F in $TopCritical) {
            $sb.AppendLine("<tr class='critical-row'><td>$($F.Category)</td><td><code>$($F.Control)</code></td><td>$($F.Description)</td><td>$($F.Finding)</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null
    }
    $sb.AppendLine("</div>") | Out-Null

    # ── Compliance-Übersicht ──────────────────────────────────────────────────────
    $sb.AppendLine("<div class='container' id='compliance'>") | Out-Null
    $sb.AppendLine("<h2>🛡 Compliance-Übersicht nach Kritikalität</h2>") | Out-Null

    $CriticalFindings = $Global:ComplianceFindings | Where-Object { $_.Status -eq 'FAIL' -and $_.Severity -eq 'Critical' } | Sort-Object Category
    $HighFindings     = $Global:ComplianceFindings | Where-Object { $_.Status -eq 'FAIL' -and $_.Severity -eq 'High' } | Sort-Object Category
    $WarnFindings     = $Global:ComplianceFindings | Where-Object { $_.Status -eq 'WARNING' } | Sort-Object Category

    foreach ($Group in @(@{Label='🔴 Kritisch'; Items=$CriticalFindings; Color='#fee2e2'},@{Label='🟠 Hoch'; Items=$HighFindings; Color='#ffedd5'},@{Label='🟡 Warnung'; Items=$WarnFindings; Color='#fef9c3'})) {
        if ($Group.Items.Count -gt 0) {
            $sb.AppendLine("<h3>$($Group.Label) ($($Group.Items.Count))</h3>") | Out-Null
            $sb.AppendLine("<table>") | Out-Null
            $sb.AppendLine("<tr><th>Kategorie</th><th>Control</th><th>Beschreibung</th><th>Befund</th><th>Quelle</th></tr>") | Out-Null
            foreach ($F in $Group.Items) {
                $SrcTags = $F.Source -split ',' | ForEach-Object {
                    $S = $_.Trim()
                    if ($S -like 'CISA*') { "<span class='tag-cisa'>$S</span>" }
                    elseif ($S -like 'BSI*') { "<span class='tag-bsi'>$S</span>" }
                    else { "<span class='tag-ms'>$S</span>" }
                }
                $sb.AppendLine("<tr style='background:$($Group.Color)'><td>$($F.Category)</td><td><code>$($F.Control)</code></td><td>$($F.Description)</td><td>$($F.Finding)</td><td>$($SrcTags -join ' ')</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }
    }
    $sb.AppendLine("</div>") | Out-Null

    # ── Compliance-Details (alle Prüfungen) ───────────────────────────────────────
    $sb.AppendLine("<div class='container' id='compliance-details'>") | Out-Null
    $sb.AppendLine("<h2>📋 Alle Compliance-Prüfungen</h2>") | Out-Null
    $sb.AppendLine("<table>") | Out-Null
    $sb.AppendLine("<tr><th>Status</th><th>Kategorie</th><th>Control</th><th>Beschreibung</th><th>Befund &amp; Empfehlung</th><th>Quelle</th><th>Priorität</th></tr>") | Out-Null
    foreach ($F in $Global:ComplianceFindings | Sort-Object @{E={$_.Status -replace 'FAIL','0' -replace 'WARNING','1' -replace 'PASS','2' -replace 'INFO','3'}}, Category) {
        $StatusBadge = "<span class='badge badge-$($F.Status.ToLower())'>$($F.Status)</span>"
        $SevBadge    = "<span class='badge badge-$($F.Severity.ToLower())'>$($F.Severity)</span>"
        $SrcTags = $F.Source -split ',' | ForEach-Object {
            $S = $_.Trim()
            if ($S -like 'CISA*') { "<span class='tag-cisa'>$S</span>" } elseif ($S -like 'BSI*') { "<span class='tag-bsi'>$S</span>" } else { "<span class='tag-ms'>$S</span>" }
        }
        $RowClass = if ($F.Status -eq 'FAIL') { "critical-row" } elseif ($F.Status -eq 'WARNING') { "warning-row" } else { "" }
        $CollapseId = "rec-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
        $sb.AppendLine("<tr class='$RowClass'><td>$StatusBadge</td><td>$($F.Category)</td><td><code>$($F.Control)</code></td><td>$($F.Description)</td>") | Out-Null
        $sb.AppendLine("<td><div class='finding-box'>$($F.Finding)</div>") | Out-Null
        if ($F.Recommendation) {
            $sb.AppendLine("<button class='collapsible' onclick='toggleSection(`"$CollapseId`")'>▶ Handlungsempfehlung</button>") | Out-Null
            $sb.AppendLine("<div class='collapsible-content rec-box' id='$CollapseId'>$($F.Recommendation)") | Out-Null
            if ($F.Reference) { $sb.AppendLine("<br><a href='$($F.Reference)' target='_blank'>📖 Dokumentation</a>") | Out-Null }
            $sb.AppendLine("</div></td>") | Out-Null
        } else { $sb.AppendLine("</td>") | Out-Null }
        $sb.AppendLine("<td>$($SrcTags -join ' ')</td><td>$SevBadge</td></tr>") | Out-Null
    }
    $sb.AppendLine("</table></div>") | Out-Null

    # ── LIZENZ-GAP-ANALYSE ────────────────────────────────────────────────────────
    if ($LicenseGaps -and $LicenseGaps.Count -gt 0) {
        $sb.AppendLine("<div class='container' id='license-gaps'>") | Out-Null
        $sb.AppendLine("<h2>🔑 Lizenz-Empfehlungen</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>Auf Basis der gesammelten Daten wurden Lizenz-Luecken identifiziert. Die Empfehlungen sind nach Dringlichkeit priorisiert.</div>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $Critical = @($LicenseGaps | Where-Object { $_.Urgency -eq 'Kritisch' })
        $High     = @($LicenseGaps | Where-Object { $_.Urgency -eq 'Hoch' })
        $Medium   = @($LicenseGaps | Where-Object { $_.Urgency -eq 'Mittel' })
        $_SC8 = if ($Critical.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC8'><div class='stat-number'>$($Critical.Count)</div><div class='stat-label'>Kritische Gaps</div></div>") | Out-Null
        $_SC9 = if ($High.Count -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC9'><div class='stat-number'>$($High.Count)</div><div class='stat-label'>Hohe Prioritaet</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($Medium.Count)</div><div class='stat-label'>Mittlere Prioritaet</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>#</th><th>Lizenz / Empfehlung</th><th>SKU / Paket</th><th>Kosten</th><th>Was wird freigeschaltet</th><th>Warum noetig</th><th>CISA/BSI Controls</th><th>Dringlichkeit</th></tr>") | Out-Null
        $i = 0
        foreach ($Gap in $LicenseGaps) {
            $i++
            $UrgClass = switch ($Gap.Urgency) {
                'Kritisch' { "critical-row" }
                'Hoch'     { "warning-row" }
                default    { "" }
            }
            $UrgBadge = switch ($Gap.Urgency) {
                'Kritisch' { "<span class='badge badge-fail'>Kritisch</span>" }
                'Hoch'     { "<span class='badge badge-warning'>Hoch</span>" }
                'Mittel'   { "<span class='badge badge-info'>Mittel</span>" }
                default    { "<span class='badge'>$($Gap.Urgency)</span>" }
            }
            $sb.AppendLine("<tr class='$UrgClass'><td><strong>$i</strong></td><td><strong>$($Gap.License)</strong></td><td><code>$($Gap.SKU)</code></td><td>$($Gap.MonthlyEUR)</td><td style='font-size:12px'>$($Gap.UnlocksWhat)</td><td style='font-size:12px'>$($Gap.WhyNeeded)</td><td><small>$($Gap.CISAControls)</small></td><td>$UrgBadge</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null
    }

    # ── TENANT METADATEN ──────────────────────────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.TenantName) {
        $EID = $ReportData.EntraID
        $sb.AppendLine("<div class='container' id='tenant-meta'>") | Out-Null
        $sb.AppendLine("<h2>🏢 Tenant-Metadaten</h2>") | Out-Null
        $sb.AppendLine("<table><tr><th>Eigenschaft</th><th>Wert</th></tr>") | Out-Null
        $sb.AppendLine("<tr><td>Tenant-Name</td><td><strong>$($EID.TenantName)</strong></td></tr>") | Out-Null
        $sb.AppendLine("<tr><td>Tenant-ID</td><td><code>$($EID.TenantId)</code></td></tr>") | Out-Null
        $sb.AppendLine("<tr><td>Erstellt am</td><td>$($EID.TenantCreated)</td></tr>") | Out-Null
        $sb.AppendLine("<tr><td>Initial-Domain</td><td>$($EID.InitialDomain.name)</td></tr>") | Out-Null
        $sb.AppendLine("<tr><td>Default-Domain</td><td>$($EID.DefaultDomain.name)</td></tr>") | Out-Null
        $_SC10 = if ($EID.HybridSync) { '<span class=' } else { '<span class=' }
        $sb.AppendLine("<tr><td>Hybrid-Sync (AD Connect)</td><td>$_SC10</td></tr>") | Out-Null
        $sb.AppendLine("<tr><td>Cross-Tenant-Partner</td><td>$($EID.CrossTenantPartners.Count) konfiguriert</td></tr>") | Out-Null
        $sb.AppendLine("<tr><td>CA Named Locations</td><td>$($EID.NamedLocations.Count) konfiguriert</td></tr>") | Out-Null
        $_SC11 = if ($EID.ReportOnlyCA.Count -gt 0) { '<span class=' } else { '<span class=' }
        $sb.AppendLine("<tr><td>CA Report-Only Policies</td><td>$_SC11</td></tr>") | Out-Null
        $sb.AppendLine("</table>") | Out-Null

        # Verifizierte Domains
        $sb.AppendLine("<h3>Verifizierte Domains ($($EID.VerifiedDomains.Count))</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Domain</th><th>Typ</th><th>Initial</th><th>Default</th><th>Status</th></tr>") | Out-Null
        foreach ($D in $EID.VerifiedDomains | Sort-Object name) {
            $Type = if ($D.isInitial) { "onmicrosoft.com" } elseif ($D.name -like "*.mail.onmicrosoft.com") { "Mail-Routing" } else { "Benutzerdefiniert" }
            $_SC12 = if ($D.isDefault) { '✓' } else { '-' }
            $_SC13 = if ($D.isInitial) { '✓' } else { '-' }
            $sb.AppendLine("<tr><td>$($D.name)</td><td>$Type</td><td>$_SC13</td><td>$_SC12</td><td><span class='badge badge-pass'>$($D.type)</span></td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        # Cross-Tenant Partners
        if ($EID.CrossTenantPartners.Count -gt 0) {
            $sb.AppendLine("<h3>Cross-Tenant-Zugriffsrichtlinien ($($EID.CrossTenantPartners.Count))</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Tenant-ID</th><th>Eingehend B2B</th><th>Ausgehend B2B</th></tr>") | Out-Null
            foreach ($CTP in $EID.CrossTenantPartners) {
                $InboundB2B  = if ($CTP.inboundTrust)  { "Konfiguriert" } else { "Standard" }
                $OutboundB2B = if ($CTP.b2bCollaborationOutbound) { "Konfiguriert" } else { "Standard" }
                $sb.AppendLine("<tr><td><code>$($CTP.tenantId)</code></td><td>$InboundB2B</td><td>$OutboundB2B</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── LIZENZ-INVENTAR ───────────────────────────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.Licenses.Count -gt 0) {
        $EID = $ReportData.EntraID
        $sb.AppendLine("<div class='container' id='licenses'>") | Out-Null
        $sb.AppendLine("<h2>📋 Lizenz-Inventar</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.TotalLicenses)</div><div class='stat-label'>Lizenzen gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>$($EID.AssignedLicenses)</div><div class='stat-label'>Zugewiesen</div></div>") | Out-Null
        $_SC14 = if ($EID.UnusedLicenses -gt 10) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC14'><div class='stat-number'>$($EID.UnusedLicenses)</div><div class='stat-label'>Ungenutzt</div></div>") | Out-Null
        $LicPct = if ($EID.TotalLicenses -gt 0) { [math]::Round(($EID.AssignedLicenses / $EID.TotalLicenses)*100) } else { 0 }
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$LicPct%</div><div class='stat-label'>Auslastung</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Lizenz</th><th>SKU-Name</th><th>Gekauft</th><th>Zugewiesen</th><th>Verfuegbar</th><th>Auslastung</th><th>Status</th></tr>") | Out-Null
        $FreeSKUs = @('FLOW_FREE','POWER_BI_STANDARD','WINDOWS_STORE','RIGHTSMANAGEMENT_ADHOC','TEAMS_EXPLORATORY','POWER_BI_PRO')
        $PaidLicenses = $EID.Licenses | Where-Object { $_.Enabled -lt 10000 -and $_.SkuPartNum -notin $FreeSKUs -and $_.Enabled -gt 0 }
        $FreeLicenses = $EID.Licenses | Where-Object { $_.Enabled -ge 10000 -or $_.SkuPartNum -in $FreeSKUs }
        foreach ($L in $PaidLicenses) {
            $LPct = if ($L.Enabled -gt 0) { [math]::Round(($L.Assigned / $L.Enabled)*100) } else { 0 }
            $LColor = if ($LPct -lt 70) { "warning" } elseif ($L.Available -eq 0) { "" } else { "" }
            $CapBadge = if ($L.CapStatus -eq "Suspended") { "<span class='badge badge-fail'>Gesperrt</span>" } elseif ($L.CapStatus -eq "Warning") { "<span class='badge badge-warn'>Warnung</span>" } else { "<span class='badge badge-pass'>Aktiv</span>" }
            $sb.AppendLine("<tr class='$LColor'><td><strong>$($L.FriendlyName)</strong></td><td><code>$($L.SkuPartNum)</code></td><td>$($L.Enabled)</td><td>$($L.Assigned)</td><td>$(if ($L.Available -lt 0) {'<span class="badge badge-fail">Ueberbucht</span>'} else {$L.Available})</td><td>$LPct%</td><td>$CapBadge</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null
        if ($FreeLicenses -and $FreeLicenses.Count -gt 0) {
            $FreeNames = ($FreeLicenses | Select-Object -ExpandProperty FriendlyName) -join ", "
            $sb.AppendLine("<div class='info-bar' style='background:#f0fdf4;border-color:#86efac;font-size:12px;'>Ausgeblendet: $($FreeLicenses.Count) kostenlose/Trial-Lizenzen (Enabled &ge; 10.000): $FreeNames</div>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── ENTRA ID ──────────────────────────────────────────────────────────────────
    if ($ReportData.EntraID) {
        $EID = $ReportData.EntraID

        # Benutzer
        $sb.AppendLine("<div class='container' id='entra-users'>") | Out-Null
        $sb.AppendLine("<h2>👤 Entra ID – Benutzer</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.TotalUsers)</div><div class='stat-label'>Benutzer gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>$($EID.EnabledUsers)</div><div class='stat-label'>Aktiv (Member)</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.DisabledUsers)</div><div class='stat-label'>Deaktiviert</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.GuestUsers)</div><div class='stat-label'>Gastbenutzer</div></div>") | Out-Null
        $_SC15 = if ($EID.MFADisabled -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC15'><div class='stat-number'>$($EID.MFAEnabled)</div><div class='stat-label'>Mit MFA</div></div>") | Out-Null
        $_SC16 = if ($EID.MFADisabled -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC16'><div class='stat-number'>$($EID.MFADisabled)</div><div class='stat-label'>Ohne MFA ⚠</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        # Benutzer aufteilen: Member und Gaeste, jeweils alphabetisch
        $MemberUsers = $EID.Users | Where-Object { $_.UserType -ne 'Guest' } | Sort-Object DisplayName
        $GuestUsers2 = $EID.Users | Where-Object { $_.UserType -eq 'Guest' }  | Sort-Object DisplayName
        $UserTableCols = "<table><tr><th>Anzeigename</th><th>UPN</th><th>Status</th><th>Abteilung</th><th>Lizenziert</th><th>MFA</th><th>On-Prem-Sync</th></tr>"

        # Abschnitt: Member
        $sb.AppendLine("<h3>👤 Member ($($MemberUsers.Count))</h3>") | Out-Null
        $sb.AppendLine($UserTableCols) | Out-Null
        foreach ($User in $MemberUsers | Select-Object -First 1000) {
            $RowC = if ($User.AccountEnabled -eq $false) { "warning-row" } else { "" }
            $Lic  = if ($User.AssignedLicenses.Count -gt 0) { "Ja ($($User.AssignedLicenses.Count))" } else { "Nein" }
            # MFA-Status aus MFAData
            $UserMFA = $EID.MFAData[$User.Id]
            if ($null -eq $UserMFA) {
                $MFACell = "<span class='badge'>-</span>"
            } elseif ($UserMFA.HasMFA) {
                $MFAMethodsDE = ($UserMFA.Methods -split ', ' | ForEach-Object {
                    switch ($_) {
                        'microsoftAuthenticatorAuthenticationMethod'  { 'Authenticator-App' }
                        'phoneAuthenticationMethod'                   { 'SMS/Anruf' }
                        'fido2AuthenticationMethod'                   { 'FIDO2-Key' }
                        'windowsHelloForBusinessAuthenticationMethod' { 'Windows Hello' }
                        'emailAuthenticationMethod'                   { 'E-Mail' }
                        'temporaryAccessPassAuthenticationMethod'     { 'Temp-Pass' }
                        'softwareOathAuthenticationMethod'            { 'TOTP/OTP' }
                        'passwordlessMicrosoftAuthenticatorAuthenticationMethod' { 'Passwordless' }
                        default { $_ }
                    }
                }) -join ', '
                $MFACell = "<span class='badge badge-pass'>Ja</span> <small>$MFAMethodsDE</small>"
            } else {
                $MFACell = "<span class='badge badge-fail'>Nein</span>"
            }
            $_SC17 = if ($User.OnPremisesSyncEnabled) { 'Ja' } else { 'Cloud' }
            $_SC18 = if ($User.AccountEnabled) { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr class='$RowC'><td>$($User.DisplayName)</td><td>$($User.UserPrincipalName)</td><td>$_SC18</td><td>$($User.Department)</td><td>$Lic</td><td>$MFACell</td><td>$_SC17</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        # Abschnitt: Gaeste
        $sb.AppendLine("<h3>🌐 Gastbenutzer ($($GuestUsers2.Count))</h3>") | Out-Null
        $sb.AppendLine($UserTableCols) | Out-Null
        foreach ($User in $GuestUsers2 | Select-Object -First 500) {
            $RowC = if ($User.AccountEnabled -eq $false) { "warning-row" } else { "" }
            $Lic  = if ($User.AssignedLicenses.Count -gt 0) { "Ja ($($User.AssignedLicenses.Count))" } else { "Nein" }
            $_SC19 = if ($User.OnPremisesSyncEnabled) { 'Ja' } else { 'Cloud' }
            $_SC20 = if ($User.AccountEnabled) { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr class='$RowC'><td>$($User.DisplayName)</td><td>$($User.UserPrincipalName)</td><td>$_SC20</td><td>$($User.Department)</td><td>$Lic</td><td><span class='badge'>-</span></td><td>$_SC19</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Gruppen
        $sb.AppendLine("<div class='container' id='entra-groups'>") | Out-Null
        $sb.AppendLine("<h2>👥 Entra ID – Gruppen</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.TotalGroups)</div><div class='stat-label'>Gruppen gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.M365Groups.Count)</div><div class='stat-label'>M365 Gruppen</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.SecurityGroups.Count)</div><div class='stat-label'>Security Groups</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.DynamicGroups.Count)</div><div class='stat-label'>Dynamisch</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Gruppenname</th><th>Typ</th><th>Mail-fähig</th><th>Dynamisch</th><th>Erstellt</th></tr>") | Out-Null
        foreach ($G in ($EID.M365Groups + $EID.SecurityGroups) | Select-Object -First 300 | Sort-Object DisplayName) {
            $GType = if ($G.GroupTypes -contains 'Unified') { "M365" } elseif ($G.SecurityEnabled) { "Security" } else { "Distribution" }
            $_SC21 = if ($G.MembershipRule) { '<span class=' } else { 'Statisch' }
            $_SC22 = if ($G.MailEnabled) { 'Ja' } else { 'Nein' }
            $sb.AppendLine("<tr><td>$($G.DisplayName)</td><td>$GType</td><td>$_SC22</td><td>$_SC21</td><td>$(if ($G.CreatedDateTime) {$G.CreatedDateTime.ToString('dd.MM.yyyy')} else {'-'})</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Conditional Access
        $sb.AppendLine("<div class='container' id='entra-ca'>") | Out-Null
        $sb.AppendLine("<h2>🔐 Conditional Access Policies ($($EID.CAPolicies.Count))</h2>") | Out-Null
        $CAMFANote = if ($EID.MFACACoversAll.Count -gt 0) { "<span class='badge badge-pass'>MFA per CA erzwungen (Alle User)</span>" } elseif ($EID.MFAViaCA) { "<span class='badge badge-warn'>MFA per CA teilweise erzwungen ($($EID.MFACAPolicies.Count) Policies)</span>" } else { "<span class='badge badge-fail'>Keine CA-Policy mit MFA-Erzwingung</span>" }
        $RONote = if ($EID.ReportOnlyCA.Count -gt 0) { " &nbsp;·&nbsp; <span class='badge badge-warn'>$($EID.ReportOnlyCA.Count) Report-Only (nicht aktiv)</span>" } else { '' }
        $sb.AppendLine("<div class='info-bar'>Aktiv: <strong>$($EID.CAEnabled)</strong> &nbsp;|&nbsp; Inaktiv/Report-only: <strong>$($EID.CADisabled)</strong> &nbsp;|&nbsp; MFA-Status: $CAMFANote$RONote</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Name</th><th>Status</th><th>Benutzer</th><th>Apps</th><th>Bedingungen</th><th>Grant</th></tr>") | Out-Null
        foreach ($CA in $EID.CAPolicies | Sort-Object State, DisplayName) {
            $CAStatus = if ($CA.State -eq 'enabled') { "<span class='badge badge-pass'>Aktiv</span>" } elseif ($CA.State -eq 'enabledForReportingButNotEnforced') { "<span class='badge badge-info'>Report-only</span>" } else { "<span class='badge badge-skipped'>Deaktiviert</span>" }
            $Users    = ($CA.Conditions.Users.IncludeUsers + $CA.Conditions.Users.IncludeGroups) -join ', '
            $Apps     = $CA.Conditions.Applications.IncludeApplications -join ', '
            $Grant    = if ($CA.GrantControls) { $CA.GrantControls.BuiltInControls -join ', ' } else { 'Kein Grant' }
            $sb.AppendLine("<tr><td>$($CA.DisplayName)</td><td>$CAStatus</td><td>$(if ($Users -eq 'All') {'Alle'} else {$Users})</td><td>$(if ($Apps -eq 'All') {'Alle'} else {$Apps})</td><td>$($CA.Conditions.ClientAppTypes -join ', ')</td><td>$Grant</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Rollen
        $sb.AppendLine("<div class='container' id='entra-roles'>") | Out-Null
        $sb.AppendLine("<h2>🎖 Privilegierte Rollenzuweisungen</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>Aufgeführt werden nur sicherheitskritische Rollen. Global Administrator: <strong>$(($EID.RoleAssignments | Where-Object { $_.RoleName -eq 'Global Administrator' }).Count)</strong> Zuweisungen.</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Rolle</th><th>Mitglied</th><th>UPN</th><th>Typ</th></tr>") | Out-Null
        foreach ($RA in $EID.RoleAssignments | Sort-Object RoleName, MemberName) {
            $RowC = if ($RA.RoleName -eq 'Global Administrator') { "critical-row" } else { "" }
            $sb.AppendLine("<tr class='$RowC'><td>$($RA.RoleName)</td><td>$($RA.MemberName)</td><td>$($RA.MemberUPN)</td><td>$($RA.MemberType -replace '#microsoft.graph.','')</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # PIM
        $sb.AppendLine("<div class='container' id='pim'>") | Out-Null
        $sb.AppendLine("<h2>⏱ Privileged Identity Management (PIM)</h2>") | Out-Null
        if ($EID.PIMEnabled) {
            $PermAssigned = $EID.PIMRoleAssignments | Where-Object { $_.IsPermanent }
            $TempAssigned = $EID.PIMRoleAssignments | Where-Object { -not $_.IsPermanent }
            $sb.AppendLine("<div class='stat-grid'>") | Out-Null
            $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>✓</div><div class='stat-label'>PIM aktiv</div></div>") | Out-Null
            $_SC23 = if ($PermAssigned.Count -gt 2) { 'critical' } else { 'warning' }
            $sb.AppendLine("<div class='stat-card $_SC23'>") | Out-Null
            $sb.AppendLine("<div class='stat-number'>$($PermAssigned.Count)</div><div class='stat-label'>Permanent zugewiesen</div></div>") | Out-Null
            $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>$($TempAssigned.Count)</div><div class='stat-label'>Zeitgebunden</div></div>") | Out-Null
            $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.PIMEligibleRoles.Count)</div><div class='stat-label'>Eligible Rollen</div></div>") | Out-Null
            $sb.AppendLine("</div>") | Out-Null
            $sb.AppendLine("<h3>Aktive Rollenzuweisungen</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Rolle</th><th>Benutzer</th><th>UPN</th><th>Typ</th><th>Gültig bis</th><th>Permanent</th></tr>") | Out-Null
            foreach ($PA in $EID.PIMRoleAssignments | Sort-Object -Property @{Expression='IsPermanent'; Descending=$true}, RoleName) {
                $EndDt = if ($PA.EndDateTime) { ([datetime]$PA.EndDateTime).ToString("dd.MM.yyyy HH:mm") } else { "Unbegrenzt" }
                $PermCell = if ($PA.IsPermanent) { "<span class='badge badge-fail'>Permanent</span>" } else { "<span class='badge badge-pass'>Zeitgebunden</span>" }
                $RowC = if ($PA.IsPermanent -and $PA.RoleName -match "Global Admin|Privileged") { "critical-row" } else { "" }
                $sb.AppendLine("<tr class='$RowC'><td>$($PA.RoleName)</td><td>$($PA.PrincipalName)</td><td>$($PA.PrincipalUPN)</td><td>$($PA.MemberType)</td><td>$EndDt</td><td>$PermCell</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
            if ($EID.PIMEligibleRoles.Count -gt 0) {
                $sb.AppendLine("<h3>Berechtigte (Eligible) Rollen</h3>") | Out-Null
                $sb.AppendLine("<div class='info-bar'>Diese Benutzer koennen die Rolle bei Bedarf aktivieren (Just-In-Time).</div>") | Out-Null
                $sb.AppendLine("<table><tr><th>Rolle</th><th>Benutzer</th><th>UPN</th><th>Eligible bis</th></tr>") | Out-Null
                foreach ($ER in $EID.PIMEligibleRoles | Sort-Object RoleName) {
                    $EndDt = if ($ER.EndDateTime) { ([datetime]$ER.EndDateTime).ToString("dd.MM.yyyy") } else { "Unbegrenzt" }
                    $sb.AppendLine("<tr><td>$($ER.RoleName)</td><td>$($ER.PrincipalName)</td><td>$($ER.PrincipalUPN)</td><td>$EndDt</td></tr>") | Out-Null
                }
                $sb.AppendLine("</table>") | Out-Null
            }
        } else {
            $sb.AppendLine("<div class='info-bar' style='background:#fff1f2;border-color:#fca5a5;'>PIM ist nicht aktiv oder Entra ID P2 fehlt. Privilegierte Rollen sind permanent zugewiesen - kein Just-In-Time-Zugriff.</div>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null

        # App-Registrierungen
        $sb.AppendLine("<div class='container' id='entra-apps'>") | Out-Null
        $sb.AppendLine("<h2>📱 App-Registrierungen ($($EID.Apps.Count))</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.Apps.Count)</div><div class='stat-label'>App-Registrierungen</div></div>") | Out-Null
        $_SC24 = if ($EID.AppsExpired.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC24'><div class='stat-number'>$($EID.AppsExpired.Count)</div><div class='stat-label'>Abgelaufene Credentials</div></div>") | Out-Null
        $_SC25 = if ($EID.AppsExpiring.Count -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC25'><div class='stat-number'>$($EID.AppsExpiring.Count)</div><div class='stat-label'>Läuft in 30 Tagen ab</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Anwendungsname</th><th>App-ID</th><th>Zielgruppe</th><th>Credentials</th><th>Erstellt</th></tr>") | Out-Null
        foreach ($App in $EID.Apps | Sort-Object DisplayName | Select-Object -First 300) {
            $HasExpired = ($App.PasswordCredentials | Where-Object { $_.EndDateTime -lt (Get-Date) }).Count -gt 0
            $RowC = if ($HasExpired) { "critical-row" } else { "" }
            $CredCount = $App.PasswordCredentials.Count + $App.KeyCredentials.Count
            $sb.AppendLine("<tr class='$RowC'><td>$($App.DisplayName)</td><td><code>$($App.AppId)</code></td><td>$($App.SignInAudience)</td><td>$CredCount Credential(s)$(if ($HasExpired) {' <span class="badge badge-fail">Abgelaufen</span>'})</td><td>$(if ($App.CreatedDateTime) {$App.CreatedDateTime.ToString('dd.MM.yyyy')} else {'-'})</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null
    }

    # ── RISKANTE BENUTZER ─────────────────────────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.RiskyUsers.Count -gt 0) {
        $EID = $ReportData.EntraID
        $sb.AppendLine("<div class='container' id='risky-users'>") | Out-Null
        $sb.AppendLine("<h2>⚠️ Riskante Benutzerkonten (Identity Protection)</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar' style='background:#fff1f2;border-color:#fca5a5;'>") | Out-Null
        $sb.AppendLine("<strong>$($EID.RiskyUsers.Count) Konten mit erhöhtem Risiko</strong> laut Microsoft Entra Identity Protection. ") | Out-Null
        $sb.AppendLine("Riskante Konten deuten auf kompromittierte Anmeldedaten, Brute-Force-Angriffe oder ungewöhnliche Anmeldemuster hin. Sofortiger Handlungsbedarf!") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table>") | Out-Null
        $sb.AppendLine("<tr><th>Benutzer</th><th>UPN</th><th>Risikolevel</th><th>Status</th><th>Grund</th><th>Zuletzt aktualisiert</th></tr>") | Out-Null
        foreach ($RU in ($EID.RiskyUsers | Sort-Object RiskLevel -Descending)) {
            $RiskBadge = switch ($RU.RiskLevel) {
                'high'   { "<span class='badge badge-fail'>Hoch</span>" }
                'medium' { "<span class='badge badge-warn'>Mittel</span>" }
                'low'    { "<span class='badge badge-info'>Niedrig</span>" }
                default  { "<span class='badge'>$($RU.RiskLevel)</span>" }
            }
            $StateBadge = switch ($RU.RiskState) {
                'atRisk'                { "<span class='badge badge-fail'>Aktives Risiko</span>" }
                'confirmedCompromised'  { "<span class='badge badge-fail'>Kompromittiert</span>" }
                'remediated'            { "<span class='badge badge-pass'>Behoben</span>" }
                'dismissed'             { "<span class='badge'>Ignoriert</span>" }
                default                 { "<span class='badge'>$($RU.RiskState)</span>" }
            }
            $DetailDE = switch ($RU.RiskDetail) {
                'none'                              { 'Kein Detail' }
                'adminGeneratedTemporaryPassword'   { 'Temp-Passwort durch Admin' }
                'userPerformedSecuredPasswordChange'{ 'Passwort geaendert' }
                'userPerformedSecuredPasswordReset' { 'Passwort zurueckgesetzt' }
                'aiConfirmedSigninSafe'             { 'KI: Anmeldung sicher' }
                'adminConfirmedSigninSafe'          { 'Admin: sicher bestaetigt' }
                'adminConfirmedUserCompromised'     { 'Admin: kompromittiert bestaetigt' }
                'adminDismissedAllRiskForUser'      { 'Risiko ignoriert' }
                'userPassedMFADrivenByRiskBasedPolicy' { 'MFA erfolgreich' }
                'unknownFutureValue'                { 'Unbekannt' }
                default                             { $RU.RiskDetail }
            }
            $LastUpd = if ($RU.RiskLastUpdatedDateTime) { ([datetime]$RU.RiskLastUpdatedDateTime).ToString('dd.MM.yyyy HH:mm') } else { '-' }
            $RowClass = if ($RU.RiskLevel -eq 'high' -or $RU.RiskState -eq 'confirmedCompromised') { ' class="critical"' } else { '' }
            $sb.AppendLine("<tr$RowClass><td><strong>$($RU.UserDisplayName)</strong></td><td><code>$($RU.UserPrincipalName)</code></td><td>$RiskBadge</td><td>$StateBadge</td><td>$DetailDE</td><td>$LastUpd</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null
        $sb.AppendLine("<div class='info-bar' style='margin-top:12px;'><strong>Empfohlene Massnahmen:</strong> ") | Out-Null
        $sb.AppendLine("(1) Passwortaenderung erzwingen, (2) MFA-Re-Registrierung, (3) Aktive Sessions beenden, ") | Out-Null
        $sb.AppendLine("(4) Sign-In-Logs pruefen, (5) Konto sperren bis zur Klaerung.</div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── INAKTIVE BENUTZER ─────────────────────────────────────────────────────────
    if ($ReportData.EntraID -and ($ReportData.EntraID.InactiveUsers90.Count -gt 0 -or $ReportData.EntraID.NeverSignedIn.Count -gt 0)) {
        $EID = $ReportData.EntraID
        $sb.AppendLine("<div class='container' id='inactive-users'>") | Out-Null
        $sb.AppendLine("<h2>⏰ Inaktive Benutzer</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>Zeigt interne Member-Accounts ohne Sign-In-Aktivitaet. Inaktive Accounts mit Lizenzen sind direktes Einsparpotenzial.</div>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $_SC26 = if ($EID.NeverSignedIn.Count -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC26'><div class='stat-number'>$($EID.NeverSignedIn.Count)</div><div class='stat-label'>Nie angemeldet</div></div>") | Out-Null
        $_SC27 = if ($EID.InactiveUsers90.Count -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC27'><div class='stat-number'>$($EID.InactiveUsers90.Count)</div><div class='stat-label'>Inaktiv >90 Tage</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.InactiveUsers30.Count)</div><div class='stat-label'>Inaktiv 30-90 Tage</div></div>") | Out-Null
        $LicWaste = (@($EID.InactiveUsers90) + @($EID.NeverSignedIn) | Where-Object { $_.HasLicense }).Count
        $_SC28 = if ($LicWaste -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC28'><div class='stat-number'>$LicWaste</div><div class='stat-label'>Inaktiv + Lizenz</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        $AllInactive = (@($EID.NeverSignedIn) + @($EID.InactiveUsers90)) | Sort-Object LastSignIn
        if ($AllInactive.Count -gt 0) {
            $sb.AppendLine("<h3>Nie / >90 Tage inaktiv ($($AllInactive.Count))</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Name</th><th>UPN</th><th>Letzter Sign-In</th><th>Lizenz</th></tr>") | Out-Null
            foreach ($U in $AllInactive | Select-Object -First 200) {
                $RowC = if ($U.HasLicense) { "critical-row" } else { "" }
                $_SC29 = if ($U.HasLicense) { '<span class=' } else { '<span class=' }
                $sb.AppendLine("<tr class='$RowC'><td>$($U.DisplayName)</td><td>$($U.UPN)</td><td>$($U.LastSignIn)</td><td>$_SC29</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── APP PERMISSIONS DETAIL ────────────────────────────────────────────────────
    if ($ReportData.EntraID -and $ReportData.EntraID.AppPermDetails.Count -gt 0) {
        $EID = $ReportData.EntraID
        $sb.AppendLine("<div class='container' id='app-permissions'>") | Out-Null
        $sb.AppendLine("<h2>🔑 App-Berechtigungen (Enterprise Apps)</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>Zeigt Enterprise Apps mit konfigurierten API-Berechtigungen. <strong>Rot markiert</strong>: Apps mit weitreichenden (High-Risk) Permissions.</div>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.AppPermDetails.Count)</div><div class='stat-label'>Apps mit Berechtigungen</div></div>") | Out-Null
        $_SC30 = if ($EID.HighRiskApps.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC30'><div class='stat-number'>$($EID.HighRiskApps.Count)</div><div class='stat-label'>High-Risk Apps</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>App-Name</th><th>App-ID</th><th>Delegierte Scopes</th><th>App-Rollen</th><th>Risiko</th></tr>") | Out-Null
        foreach ($AP in $EID.AppPermDetails | Sort-Object IsHighRisk -Descending | Select-Object -First 200) {
            $RowC = if ($AP.IsHighRisk) { "critical-row" } else { "" }
            $Risk = if ($AP.IsHighRisk) { "<span class='badge badge-fail'>High-Risk</span>" } else { "<span class='badge badge-pass'>Normal</span>" }
            $sb.AppendLine("<tr class='$RowC'><td>$($AP.AppName)</td><td><code>$($AP.AppId)</code></td><td style='font-size:11px;max-width:300px;word-break:break-all;'>$($AP.Scopes)</td><td>$($AP.AppRoles)</td><td>$Risk</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Enterprise Apps (OAuth-Grants)
        $sb.AppendLine("<div class='container' id='enterprise-apps'>") | Out-Null
        $sb.AppendLine("<h2>🔗 Drittanbieter-Apps (OAuth-Grants)</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>Apps von Drittanbietern die Benutzer Zugriff auf M365-Daten erteilt haben. <strong>Rot</strong>: Mandantenweiter Zugriff auf kritische Ressourcen (Mail, Dateien, Verzeichnis).</div>") | Out-Null
        if ($EID.EnterpriseApps.Count -gt 0) {
            $sb.AppendLine("<div class='stat-grid'>") | Out-Null
            $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EID.EnterpriseApps.Count)</div><div class='stat-label'>OAuth-Grants gesamt</div></div>") | Out-Null
            $_SC31 = if ($EID.DangerousEnterpriseApps.Count -gt 0) { 'critical' } else { 'success' }
            $sb.AppendLine("<div class='stat-card $_SC31'>") | Out-Null
            $sb.AppendLine("<div class='stat-number'>$($EID.DangerousEnterpriseApps.Count)</div><div class='stat-label'>Kritische Grants</div></div>") | Out-Null
            $AllPrinc = ($EID.EnterpriseApps | Where-Object { $_.ConsentType -eq "AllPrincipals" }).Count
            $_SC32 = if ($AllPrinc -gt 0) { 'warning' } else { 'success' }
            $sb.AppendLine("<div class='stat-card $_SC32'>") | Out-Null
            $sb.AppendLine("<div class='stat-number'>$AllPrinc</div><div class='stat-label'>Mandantenweiter Consent</div></div>") | Out-Null
            $sb.AppendLine("</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>App-Name</th><th>Consent-Typ</th><th>Berechtigungen</th><th>Risiko</th></tr>") | Out-Null
            foreach ($EA in $EID.EnterpriseApps | Sort-Object IsHighRisk -Descending | Select-Object -First 200) {
                $RowC = if ($EA.IsHighRisk -and $EA.ConsentType -eq "AllPrincipals") { "critical-row" } elseif ($EA.IsHighRisk) { "warning-row" } else { "" }
                $RiskBadge = if ($EA.IsHighRisk -and $EA.ConsentType -eq "AllPrincipals") { "<span class='badge badge-fail'>Kritisch</span>" } elseif ($EA.IsHighRisk) { "<span class='badge badge-warn'>High-Risk</span>" } else { "<span class='badge badge-pass'>Normal</span>" }
                $ConsentBadge = if ($EA.ConsentType -eq "AllPrincipals") { "<span class='badge badge-warn'>Alle Benutzer</span>" } else { "<span class='badge'>Einzeln</span>" }
                $ScopesShort = ($EA.Scopes -split " " | Select-Object -First 5) -join ", "
                $HighRiskNote = if ($EA.HighRiskScopes) { "<br><small style='color:#dc2626'>⚠ $($EA.HighRiskScopes)</small>" } else { "" }
                $sb.AppendLine("<tr class='$RowC'><td><strong>$($EA.AppName)</strong></td><td>$ConsentBadge</td><td style='font-size:11px'>$ScopesShort$HighRiskNote</td><td>$RiskBadge</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        } else {
            $sb.AppendLine("<p style='color:#6b7280'>Keine OAuth-Grants gefunden oder keine Berechtigung zum Abrufen.</p>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null

        # SSPR
        $sb.AppendLine("<div class='container' id='sspr'>") | Out-Null
        $sb.AppendLine("<h2>🔑 Self-Service Password Reset (SSPR)</h2>") | Out-Null
        if ($EID.SSPRPolicy) {
            $Policy = $EID.SSPRPolicy
            $EnabledMethods = @($Policy.authenticationMethods | Where-Object { $_.isRegistrationRequired -eq $true -or $_.state -eq "enabled" })
            $sb.AppendLine("<div class='stat-grid'>") | Out-Null
            $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EnabledMethods.Count)</div><div class='stat-label'>Aktive Methoden</div></div>") | Out-Null
            $sb.AppendLine("</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>Methode</th><th>Status</th><th>Registrierung erforderlich</th></tr>") | Out-Null
            foreach ($M in $Policy.authenticationMethods) {
                $MName = switch ($M.id) {
                    "Email"                    { "E-Mail OTP" }
                    "Sms"                      { "SMS" }
                    "MicrosoftAuthenticator"   { "Microsoft Authenticator" }
                    "Fido2"                    { "FIDO2 Security Key" }
                    "WindowsHelloForBusiness"  { "Windows Hello" }
                    "TemporaryAccessPass"       { "Temporary Access Pass" }
                    "SoftwareOath"             { "Software OATH Token" }
                    "Voice"                    { "Sprachanruf" }
                    default                    { $M.id }
                }
                $State = if ($M.state -eq "enabled") { "<span class='badge badge-pass'>Aktiv</span>" } else { "<span class='badge'>Inaktiv</span>" }
                $Reg   = if ($M.isRegistrationRequired) { "<span class='badge badge-warn'>Ja</span>" } else { "Nein" }
                $sb.AppendLine("<tr><td>$MName</td><td>$State</td><td>$Reg</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        } else {
            $sb.AppendLine("<p style='color:#6b7280'>SSPR-Policy nicht abrufbar.</p>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── DATA GOVERNANCE ───────────────────────────────────────────────────────────
    if ($ReportData.EntraID) {
        $EID = $ReportData.EntraID
        if ($EID.SensitivityLabels.Count -gt 0 -or $EID.RetentionLabels.Count -gt 0) {
            $sb.AppendLine("<div class='container' id='data-governance'>") | Out-Null
            $sb.AppendLine("<h2>🗂 Data Governance / Purview</h2>") | Out-Null
            $sb.AppendLine("<div class='stat-grid'>") | Out-Null
            $_SC33 = if ($EID.SensitivityLabels.Count -eq 0) { 'warning' } else { 'success' }
            $sb.AppendLine("<div class='stat-card $_SC33'><div class='stat-number'>$($EID.SensitivityLabels.Count)</div><div class='stat-label'>Sensitivity Labels</div></div>") | Out-Null
            $_SC34 = if ($EID.RetentionLabels.Count -eq 0) { 'warning' } else { 'success' }
            $sb.AppendLine("<div class='stat-card $_SC34'><div class='stat-number'>$($EID.RetentionLabels.Count)</div><div class='stat-label'>Retention Labels</div></div>") | Out-Null
            $sb.AppendLine("</div>") | Out-Null
            if ($EID.SensitivityLabels.Count -gt 0) {
                $sb.AppendLine("<h3>Sensitivity Labels</h3>") | Out-Null
                $sb.AppendLine("<table><tr><th>Name</th><th>Beschreibung</th><th>Prioritaet</th></tr>") | Out-Null
                foreach ($L in $EID.SensitivityLabels | Sort-Object priority) {
                    $sb.AppendLine("<tr><td><strong>$($L.name)</strong></td><td>$($L.description)</td><td>$($L.priority)</td></tr>") | Out-Null
                }
                $sb.AppendLine("</table>") | Out-Null
            } else {
                $sb.AppendLine("<div class='info-bar' style='background:#fef3c7;border-color:#f59e0b;'>⚠ Keine Sensitivity Labels konfiguriert. Fuer DSGVO-Compliance und Datenklassifizierung werden Labels empfohlen.</div>") | Out-Null
            }
            if ($EID.RetentionLabels.Count -gt 0) {
                $sb.AppendLine("<h3>Retention Labels ($($EID.RetentionLabels.Count))</h3>") | Out-Null
                $sb.AppendLine("<table><tr><th>Name</th><th>Aufbewahrungsdauer</th><th>Aktion</th></tr>") | Out-Null
                foreach ($RL in $EID.RetentionLabels | Select-Object -First 50) {
                    $sb.AppendLine("<tr><td>$($RL.displayName)</td><td>$($RL.retentionDuration)</td><td>$($RL.actionAfterRetentionPeriod)</td></tr>") | Out-Null
                }
                $sb.AppendLine("</table>") | Out-Null
            }
            $sb.AppendLine("</div>") | Out-Null
        } else {
            $sb.AppendLine("<div class='container' id='data-governance'>") | Out-Null
            $sb.AppendLine("<h2>🗂 Data Governance / Purview</h2>") | Out-Null
            $sb.AppendLine("<div class='info-bar' style='background:#fef3c7;border-color:#f59e0b;'>⚠ Keine Sensitivity Labels oder Retention Labels konfiguriert. Fuer DSGVO-Compliance und Informationsschutz werden diese empfohlen.</div>") | Out-Null
            $sb.AppendLine("</div>") | Out-Null
        }
    }

    # ── EXCHANGE ONLINE ───────────────────────────────────────────────────────────
    if ($ReportData.Exchange) {
        $EXO = $ReportData.Exchange

        $sb.AppendLine("<div class='container' id='exo-mailboxes'>") | Out-Null
        $sb.AppendLine("<h2>📬 Exchange Online – Mailboxen</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EXO.TotalMailboxes)</div><div class='stat-label'>Mailboxen gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EXO.UserMailboxes.Count)</div><div class='stat-label'>Benutzer-Mailboxen</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EXO.SharedMailboxes.Count)</div><div class='stat-label'>Shared Mailboxen</div></div>") | Out-Null
        $_SC35 = if ($EXO.ExternalForwarding.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC35'><div class='stat-number'>$($EXO.ExternalForwarding.Count)</div><div class='stat-label'>Ext. Forwarding ⚠</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        if ($EXO.ExternalForwarding.Count -gt 0) {
            $sb.AppendLine("<h3>⚠ Mailboxen mit externem Forwarding</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Mailbox</th><th>Weiterleitungsziel</th><th>Deliver &amp; Forward</th></tr>") | Out-Null
            foreach ($MB in $EXO.ExternalForwarding) {
                $Fwd = if ($MB.ForwardingSmtpAddress) { $MB.ForwardingSmtpAddress } else { $MB.ForwardingAddress }
                $sb.AppendLine("<tr class='critical-row'><td>$($MB.PrimarySmtpAddress)</td><td>$Fwd</td><td>$($MB.DeliverToMailboxAndForward)</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }

        # Gesamtgroesse berechnen
        $TotalSizeGB = ($EXO.MailboxSizeMap.Values | Measure-Object -Property SizeGB -Sum).Sum
        $TotalSizeGB = [math]::Round($TotalSizeGB, 2)
        $sb.AppendLine("<div class='info-bar'>Gesamt-Postfachvolumen: <strong>$TotalSizeGB GB</strong> ueber $($EXO.UserMailboxes.Count + $EXO.SharedMailboxes.Count) Mailboxen</div>") | Out-Null
        $sb.AppendLine("<h3>Alle Mailboxen</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Anzeigename</th><th>E-Mail</th><th>Typ</th><th>Groesse</th><th>Elemente</th><th>Audit</th></tr>") | Out-Null
        foreach ($MB in ($EXO.UserMailboxes + $EXO.SharedMailboxes) | Select-Object -First 400 | Sort-Object DisplayName) {
            $MBSize = $EXO.MailboxSizeMap[$MB.DisplayName]
            $SizeGB   = if ($MBSize) { "$($MBSize.SizeGB) GB" } else { '-' }
            $SizeColor = if ($MBSize -and $MBSize.SizeGB -gt 40) { 'style="color:#dc2626;font-weight:bold"' } elseif ($MBSize -and $MBSize.SizeGB -gt 20) { 'style="color:#d97706"' } else { '' }
            $ItemCnt  = if ($MBSize) { $MBSize.ItemCount } else { '-' }
            $_SC36 = if ($MB.AuditEnabled) { '<span class=\' } else { '<span class=\' }
            $sb.AppendLine("<tr><td>$($MB.DisplayName)</td><td>$($MB.PrimarySmtpAddress)</td><td>$($MB.RecipientTypeDetails)</td><td $SizeColor>$SizeGB</td><td>$ItemCnt</td><td>$_SC36</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null


        # ── Holds & Retention ─────────────────────────────────────────────────────
        $sb.AppendLine("<div class='container' id='exo-holds'>") | Out-Null
        $sb.AppendLine("<h2>🔒 Holds & Retention</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>Zeigt alle Mailboxen mit aktivem Litigation Hold, In-Place Hold oder Retention Policy. Relevant fuer eDiscovery, Compliance und rechtliche Aufbewahrungspflichten.</div>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $LitCount = $EXO.LitigationHoldMailboxes.Count
        $IPCount  = $EXO.InPlaceHoldMailboxes.Count
        $RetCount = $EXO.RetentionPolicies.Count
        $_SC37 = if ($LitCount -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC37'><div class='stat-number'>$LitCount</div><div class='stat-label'>Litigation Hold</div></div>") | Out-Null
        $_SC38 = if ($IPCount -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC38'><div class='stat-number'>$IPCount</div><div class='stat-label'>In-Place Hold</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($EXO.RetentionHoldMailboxes.Count)</div><div class='stat-label'>Retention Hold</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$RetCount</div><div class='stat-label'>Retention Policies</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        # Litigation Hold Tabelle
        $sb.AppendLine("<h3>⚖️ Litigation Hold ($LitCount Mailboxen)</h3>") | Out-Null
        if ($LitCount -eq 0) {
            $sb.AppendLine("<p style='color:#6b7280'>Kein Litigation Hold aktiv.</p>") | Out-Null
        } else {
            $sb.AppendLine("<div class='info-bar' style='background:#fffbeb;border-color:#fcd34d;'>Litigation Hold bewahrt alle Postfachinhalte auf – auch geloeschte Elemente. Wird haeufig fuer rechtliche Verfahren oder behördliche Auflagen gesetzt.</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>Mailbox</th><th>E-Mail</th><th>Hold seit</th><th>Gesetzt von</th><th>Dauer (Tage)</th><th>Single Item Recovery</th></tr>") | Out-Null
            foreach ($MB in $EXO.LitigationHoldMailboxes | Sort-Object DisplayName) {
                $HoldDate = if ($MB.LitigationHoldDate) { ([datetime]$MB.LitigationHoldDate).ToString("dd.MM.yyyy") } else { "-" }
                $HoldOwner = if ($MB.LitigationHoldOwner) { $MB.LitigationHoldOwner } else { "-" }
                $HoldDur   = if ($MB.LitigationHoldDuration -and $MB.LitigationHoldDuration -ne "Unlimited") { $MB.LitigationHoldDuration } else { "Unbegrenzt" }
                $SIR       = if ($MB.SingleItemRecoveryEnabled) { "<span class='badge badge-pass'>Ja</span>" } else { "<span class='badge'>Nein</span>" }
                $sb.AppendLine("<tr class='warning-row'><td><strong>$($MB.DisplayName)</strong></td><td>$($MB.PrimarySmtpAddress)</td><td>$HoldDate</td><td>$HoldOwner</td><td>$HoldDur</td><td>$SIR</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }

        # In-Place Hold Tabelle
        $sb.AppendLine("<h3>📌 In-Place Hold ($IPCount Mailboxen)</h3>") | Out-Null
        if ($IPCount -eq 0) {
            $sb.AppendLine("<p style='color:#6b7280'>Kein In-Place Hold aktiv.</p>") | Out-Null
        } else {
            $sb.AppendLine("<div class='info-bar'>In-Place Holds werden durch eDiscovery-Faelle oder Compliance-Policies ausgeloest. Jeder Hold hat eine eigene GUID.</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>Mailbox</th><th>E-Mail</th><th>Hold-IDs</th><th>Delay Hold</th></tr>") | Out-Null
            foreach ($MB in $EXO.InPlaceHoldMailboxes | Sort-Object DisplayName) {
                $HoldIds = ($MB.InPlaceHolds | ForEach-Object {
                    if ($_ -match '^UniH') { "<span class='badge badge-info'>Unified: $_</span>" }
                    elseif ($_ -match '^mbx') { "<span class='badge badge-warn'>MBX: $_</span>" }
                    else { "<span class='badge'>$_</span>" }
                }) -join " "
                $Delay = if ($MB.DelayHoldApplied) { "<span class='badge badge-warn'>Ja</span>" } else { "Nein" }
                $sb.AppendLine("<tr><td><strong>$($MB.DisplayName)</strong></td><td>$($MB.PrimarySmtpAddress)</td><td>$HoldIds</td><td>$Delay</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }

        # Retention Policies aus Compliance Center
        if ($EXO.RetentionPolicies.Count -gt 0) {
            $sb.AppendLine("<h3>📋 Retention Policies ($($EXO.RetentionPolicies.Count))</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Name</th><th>Status</th><th>Typ</th><th>Erstellt</th><th>Zuletzt geaendert</th></tr>") | Out-Null
            foreach ($RP in $EXO.RetentionPolicies | Sort-Object Name) {
                $RPStatus = if ($RP.Enabled) { "<span class='badge badge-pass'>Aktiv</span>" } else { "<span class='badge badge-skipped'>Inaktiv</span>" }
                $RPType   = if ($RP.IsAdaptivePolicy) { "Adaptiv" } else { "Statisch" }
                $RPDate   = if ($RP.WhenCreated) { ([datetime]$RP.WhenCreated).ToString("dd.MM.yyyy") } else { "-" }
                $RPMod    = if ($RP.WhenChangedUTC) { ([datetime]$RP.WhenChangedUTC).ToString("dd.MM.yyyy") } else { "-" }
                $sb.AppendLine("<tr><td><strong>$($RP.Name)</strong></td><td>$RPStatus</td><td>$RPType</td><td>$RPDate</td><td>$RPMod</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }

        # Überblick aller Mailboxen mit Hold-Status
        $sb.AppendLine("<h3>📊 Hold-Status aller Mailboxen</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Mailbox</th><th>E-Mail</th><th>Typ</th><th>Litigation Hold</th><th>In-Place Hold</th><th>Retention Policy</th><th>Retention Hold</th></tr>") | Out-Null
        $HoldMailboxes = $EXO.AllMailboxes | Where-Object {
            $_.LitigationHoldEnabled -or $_.InPlaceHolds.Count -gt 0 -or
            $_.RetentionPolicy -or $_.RetentionHoldEnabled
        } | Sort-Object DisplayName
        if ($HoldMailboxes.Count -eq 0) {
            $sb.AppendLine("<tr><td colspan='7' style='color:#6b7280;text-align:center'>Keine Mailboxen mit aktivem Hold oder Retention Policy gefunden.</td></tr>") | Out-Null
        } else {
            foreach ($MB in $HoldMailboxes) {
                $LitCell = if ($MB.LitigationHoldEnabled) { "<span class='badge badge-warn'>Aktiv</span>" } else { "-" }
                $IPCell  = if ($MB.InPlaceHolds.Count -gt 0) { "<span class='badge badge-info'>$($MB.InPlaceHolds.Count) Hold(s)</span>" } else { "-" }
                $RetPol  = if ($MB.RetentionPolicy) { "<span class='badge'>$($MB.RetentionPolicy)</span>" } else { "-" }
                $RetHold = if ($MB.RetentionHoldEnabled) { "<span class='badge badge-warn'>Aktiv</span>" } else { "-" }
                $sb.AppendLine("<tr><td>$($MB.DisplayName)</td><td>$($MB.PrimarySmtpAddress)</td><td>$($MB.RecipientTypeDetails)</td><td>$LitCell</td><td>$IPCell</td><td>$RetPol</td><td>$RetHold</td></tr>") | Out-Null
            }
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Postfach-Delegierungen
        $sb.AppendLine("<div class='container' id='exo-delegations'>") | Out-Null
        $sb.AppendLine("<h2>👥 Postfach-Delegierungen</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar'>FullAccess und SendAs-Berechtigungen auf Benutzerpostfaecher. Relevant fuer Insider-Risiko und Compliance.</div>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $FullAcc = @($EXO.MailboxDelegations | Where-Object { $_.AccessRight -eq "FullAccess" })
        $SendAs  = @($EXO.MailboxDelegations | Where-Object { $_.AccessRight -eq "SendAs" })
        $_SC39 = if ($FullAcc.Count -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC39'>") | Out-Null
        $sb.AppendLine("<div class='stat-number'>$($FullAcc.Count)</div><div class='stat-label'>FullAccess-Grants</div></div>") | Out-Null
        $_SC40 = if ($SendAs.Count -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC40'>") | Out-Null
        $sb.AppendLine("<div class='stat-number'>$($SendAs.Count)</div><div class='stat-label'>SendAs-Grants</div></div>") | Out-Null
        $SMLogin = @($EXO.SharedMailboxWithLogin)
        $_SC41 = if ($SMLogin.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC41'>") | Out-Null
        $sb.AppendLine("<div class='stat-number'>$($SMLogin.Count)</div><div class='stat-label'>Shared MBX mit Login</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        if ($EXO.MailboxDelegations.Count -gt 0) {
            $sb.AppendLine("<table><tr><th>Postfach</th><th>E-Mail</th><th>Delegiert an</th><th>Berechtigung</th></tr>") | Out-Null
            foreach ($D in $EXO.MailboxDelegations | Sort-Object AccessRight, Mailbox) {
                $AccBadge = if ($D.AccessRight -eq "FullAccess") { "<span class='badge badge-warn'>FullAccess</span>" } else { "<span class='badge badge-info'>SendAs</span>" }
                $sb.AppendLine("<tr><td><strong>$($D.Mailbox)</strong></td><td>$($D.MailboxUPN)</td><td>$($D.Delegate)</td><td>$AccBadge</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        } else {
            $sb.AppendLine("<p style='color:#6b7280'>Keine Delegierungen gefunden oder Abfrage auf 200 Postfaecher begrenzt.</p>") | Out-Null
        }
        if ($SMLogin.Count -gt 0) {
            $sb.AppendLine("<h3>⚠️ Shared Mailboxen mit aktivem Login ($($SMLogin.Count))</h3>") | Out-Null
            $sb.AppendLine("<div class='info-bar' style='background:#fff1f2;border-color:#fca5a5;'>Shared Mailboxen sollten keinen direkten Login ermoeglichen. Dies ist ein Sicherheitsrisiko.</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>Mailbox</th><th>E-Mail</th><th>Typ</th></tr>") | Out-Null
            foreach ($SM in $SMLogin) {
                $sb.AppendLine("<tr class='critical-row'><td>$($SM.DisplayName)</td><td>$($SM.PrimarySmtpAddress)</td><td>$($SM.RecipientTypeDetails)</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null

        # E-Mail-Sicherheit
        $sb.AppendLine("<div class='container' id='exo-security'>") | Out-Null
        $sb.AppendLine("<h2>🛡 E-Mail-Sicherheit</h2>") | Out-Null
        $sb.AppendLine("<h3>DKIM-Status</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Domain</th><th>DKIM aktiviert</th><th>Selector1</th><th>Selector2</th></tr>") | Out-Null
        foreach ($DKIM in $EXO.DKIMConfigs) {
            $_SC42 = if ($DKIM.Enabled) { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr><td>$($DKIM.Domain)</td><td>$_SC42</td><td>$($DKIM.Selector1CreatedTime)</td><td>$($DKIM.Selector2CreatedTime)</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        $sb.AppendLine("<h3>Anti-Spam Policies ($($EXO.AntiSpamPolicies.Count))</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Name</th><th>Spam-Aktion</th><th>HighConf-Spam</th><th>Phish-Aktion</th><th>Bulk-Level</th></tr>") | Out-Null
        foreach ($AS in $EXO.AntiSpamPolicies) {
            $sb.AppendLine("<tr><td>$($AS.Name)</td><td>$($AS.SpamAction)</td><td>$($AS.HighConfidenceSpamAction)</td><td>$($AS.PhishSpamAction)</td><td>$($AS.BulkThreshold)</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        $sb.AppendLine("<h3>Anti-Phishing Policies ($($EXO.AntiPhishPolicies.Count))</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Name</th><th>Mailbox Intelligence</th><th>Impersonation-Schutz</th><th>Spoof Intelligence</th></tr>") | Out-Null
        foreach ($AP in $EXO.AntiPhishPolicies) {
            $_SC43 = if ($AP.EnableSpoofIntelligence) { '<span class=' } else { '<span class=' }
            $_SC44 = if ($AP.EnableTargetedUserProtection -or $AP.EnableOrganizationDomainsProtection) { 'Aktiv' } else { 'Inaktiv' }
            $_SC45 = if ($AP.EnableMailboxIntelligence) { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr><td>$($AP.Name)</td><td>$_SC45</td><td>$_SC44</td><td>$_SC43</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        $sb.AppendLine("<h3>Akzeptierte Domains</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Domain</th><th>Typ</th><th>Standard</th></tr>") | Out-Null
        foreach ($Dom in $EXO.AcceptedDomains) {
            $_SC46 = if ($Dom.Default) { '<span class=' } else { 'Nein' }
            $sb.AppendLine("<tr><td>$($Dom.DomainName)</td><td>$($Dom.DomainType)</td><td>$_SC46</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Transport Rules
        $sb.AppendLine("<div class='container' id='exo-transport'>") | Out-Null
        $sb.AppendLine("<h2>⚙ Transport Rules ($($EXO.TransportRules.Count))</h2>") | Out-Null
        $sb.AppendLine("<table><tr><th>Name</th><th>Priorität</th><th>Aktiviert</th><th>Aktion</th><th>Beschreibung</th></tr>") | Out-Null
        foreach ($TR in $EXO.TransportRules | Sort-Object Priority) {
            $_SC47 = if ($TR.State -eq 'Enabled') { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr><td>$($TR.Name)</td><td>$($TR.Priority)</td><td>$_SC47</td><td>$($TR.Actions | ForEach-Object { $_.GetType().Name } | Select-Object -Unique | Join-String -Separator ', ')</td><td>$($TR.Comments)</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null
    }

    # ── INTUNE ────────────────────────────────────────────────────────────────────
    if ($ReportData.Intune) {
        $IND = $ReportData.Intune

        $sb.AppendLine("<div class='container' id='intune-devices'>") | Out-Null
        $sb.AppendLine("<h2>💻 Intune – Geräteinventar</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.TotalDevices)</div><div class='stat-label'>Geräte gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>$($IND.CompliantDevices)</div><div class='stat-label'>Compliant</div></div>") | Out-Null
        $_SC48 = if ($IND.NonCompliantDevices -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC48'><div class='stat-number'>$($IND.NonCompliantDevices)</div><div class='stat-label'>Non-compliant</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.WindowsDevices.Count)</div><div class='stat-label'>Windows</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.iOSDevices.Count)</div><div class='stat-label'>iOS</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.AndroidDevices.Count)</div><div class='stat-label'>Android</div></div>") | Out-Null
        $_SC49 = if ($IND.NotEncrypted -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC49'><div class='stat-number'>$($IND.NotEncrypted)</div><div class='stat-label'>Unverschlüsselt</div></div>") | Out-Null
        # Defender Threat State
        $ThreatDevices = $IND.AllDevices | Where-Object { $_.PartnerReportedThreatState -notin @('unknown','activated','deactivated') -and $_.PartnerReportedThreatState -ne $null }
        $_SC50 = if ($ThreatDevices.Count -gt 0) { 'critical' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC50'><div class='stat-number'>$($ThreatDevices.Count)</div><div class='stat-label'>Defender-Bedrohungen</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        $sb.AppendLine("<table><tr><th>Gerätename</th><th>Benutzer</th><th>OS</th><th>Version</th><th>Compliance</th><th>Verschlüsselt</th><th>Defender</th><th>Letzter Sync</th></tr>") | Out-Null
        foreach ($Dev in $IND.AllDevices | Select-Object -First 500 | Sort-Object ComplianceState, DeviceName) {
            $CompClass = if ($Dev.ComplianceState -eq 'compliant') { "badge-pass" } elseif ($Dev.ComplianceState -eq 'noncompliant') { "badge-fail" } else { "badge-info" }
            $ThreatState = $Dev.PartnerReportedThreatState
            $ThreatBadge = switch ($ThreatState) {
                'unknown'     { "<span class='badge'>-</span>" }
                'activated'   { "<span class='badge badge-pass'>Aktiv</span>" }
                'deactivated' { "<span class='badge badge-warn'>Inaktiv</span>" }
                'notReported' { "<span class='badge'>Kein Report</span>" }
                'malware'     { "<span class='badge badge-fail'>Malware!</span>" }
                'highSeverity'{ "<span class='badge badge-fail'>Hoch</span>" }
                'mediumSeverity'{ "<span class='badge badge-warn'>Mittel</span>" }
                'lowSeverity' { "<span class='badge badge-info'>Niedrig</span>" }
                'cleanedMalware'{ "<span class='badge badge-pass'>Bereinigt</span>" }
                default       { if ($ThreatState) { "<span class='badge badge-warn'>$ThreatState</span>" } else { "<span class='badge'>-</span>" } }
            }
            $RowC = if ($Dev.ComplianceState -eq 'noncompliant') { "warning-row" } elseif (-not $Dev.IsEncrypted) { "critical-row" } elseif ($ThreatState -in @('malware','highSeverity')) { "critical-row" } else { "" }
            $LastSync = if ($Dev.LastSyncDateTime) { $Dev.LastSyncDateTime.ToString('dd.MM.yyyy HH:mm') } else { 'Nie' }
            $_SC51 = if ($Dev.IsEncrypted) { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr class='$RowC'><td>$($Dev.DeviceName)</td><td>$($Dev.UserDisplayName)</td><td>$($Dev.OperatingSystem)</td><td>$($Dev.OsVersion)</td><td><span class='badge $CompClass'>$($Dev.ComplianceState)</span></td><td>$_SC51</td><td>$ThreatBadge</td><td>$LastSync</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        $sb.AppendLine("<div class='container' id='intune-policies'>") | Out-Null
        $sb.AppendLine("<h2>📑 Intune Policies &amp; Profile</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.CompliancePolicies.Count)</div><div class='stat-label'>Compliance Policies</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.ConfigProfiles.Count)</div><div class='stat-label'>Config Profile</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.AppProtectioniOS + $IND.AppProtectionAndroid)</div><div class='stat-label'>App Protection Policies</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.UpdateRings)</div><div class='stat-label'>Update Rings</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND.AutopilotDevices)</div><div class='stat-label'>Autopilot-Geräte</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        $sb.AppendLine("<h3>Compliance Policies</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Name</th><th>Plattform</th><th>Zuweisungen</th><th>Erstellt</th></tr>") | Out-Null
        foreach ($CP in $IND.CompliancePolicies) {
            $sb.AppendLine("<tr><td>$($CP.Name)</td><td>$($CP.Platform)</td><td>$($CP.Assignments)</td><td>$(if ($CP.CreatedAt) {$CP.CreatedAt.ToString('dd.MM.yyyy')} else {'-'})</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        $sb.AppendLine("<h3>Konfigurationsprofile</h3>") | Out-Null
        $sb.AppendLine("<table><tr><th>Name</th><th>Plattform</th><th>Zuweisungen</th><th>Erstellt</th></tr>") | Out-Null
        foreach ($CF in $IND.ConfigProfiles) {
            $sb.AppendLine("<tr><td>$($CF.Name)</td><td>$($CF.Platform)</td><td>$($CF.Assignments)</td><td>$(if ($CF.CreatedAt) {$CF.CreatedAt.ToString('dd.MM.yyyy')} else {'-'})</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null

        # Non-Compliance Details
        if ($IND.NonComplianceDetails -and $IND.NonComplianceDetails.Count -gt 0) {
            $sb.AppendLine("<div class='container' id='intune-noncompliant'>") | Out-Null
            $sb.AppendLine("<h2>⚠ Non-Compliance Analyse</h2>") | Out-Null
            $sb.AppendLine("<div class='info-bar'>Konkrete Einstellungen die auf non-compliant Geraeten fehlschlagen. Rot = jede fehlgeschlagene Einstellung.</div>") | Out-Null

            $sb.AppendLine("<h3>Haeufigste Ursachen</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Einstellung</th><th>Betroffene Geraete</th><th>Anteil</th></tr>") | Out-Null
            $TopCauses = $IND.NonComplianceSummary.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10
            foreach ($Cause in $TopCauses) {
                $Pct = if ($IND.NonCompliantDevices -gt 0) { [math]::Round(($Cause.Value / $IND.NonCompliantDevices) * 100) } else { 0 }
                $Bar = "<div style='background:#ef4444;height:8px;border-radius:4px;width:$([math]::Min($Pct,100))%;display:inline-block;margin-right:6px;vertical-align:middle;'></div>"
                $sb.AppendLine("<tr><td><strong>$($Cause.Key)</strong></td><td>$($Cause.Value)</td><td>$Bar $Pct%</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null

            $sb.AppendLine("<h3>Details pro Geraet ($($IND.NonComplianceDetails.Count) Findings auf $($IND.NonCompliantDevices) Geraeten)</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Geraet</th><th>Benutzer</th><th>OS</th><th>Version</th><th>Policy</th><th>Fehlgeschlagene Einstellung</th><th>Aktueller Wert</th><th>Status</th><th>Letzter Sync</th></tr>") | Out-Null
            foreach ($NC in $IND.NonComplianceDetails | Sort-Object DeviceName, PolicyName) {
                $SC = if ($NC.State -eq 'nonCompliant') { 'badge-fail' } elseif ($NC.State -eq 'error') { 'badge-warn' } else { 'badge-info' }
                $sb.AppendLine("<tr class='critical-row'><td><strong>$($NC.DeviceName)</strong></td><td>$($NC.UserUPN)</td><td>$($NC.OS)</td><td>$($NC.OSVersion)</td><td>$($NC.PolicyName)</td><td>$($NC.Setting)</td><td><code>$($NC.CurrentValue)</code></td><td><span class='badge $SC'>$($NC.State)</span></td><td>$($NC.LastSync)</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table></div>") | Out-Null
        } elseif ($IND.NonCompliantDevices -gt 0) {
            $sb.AppendLine("<div class='container' id='intune-noncompliant'>") | Out-Null
            $sb.AppendLine("<h2>⚠ Non-Compliance Analyse</h2>") | Out-Null
            $sb.AppendLine("<div class='info-bar' style='background:#fef3c7;border-color:#f59e0b;'>$($IND.NonCompliantDevices) non-compliant Geraete, aber keine Setting-Details abrufbar. Berechtigung pruefen: DeviceManagementConfiguration.Read.All</div>") | Out-Null
            $sb.AppendLine("</div>") | Out-Null
        }
    }

    # ── HYBRID-ANALYSE ────────────────────────────────────────────────────────────
    if ($ReportData.Intune -and ($ReportData.Intune.GPOLikelyDevices -gt 0 -or $ReportData.Intune.HybridJoinedEntra -gt 0 -or $ReportData.EntraID.HybridSync)) {
        $IND3 = $ReportData.Intune
        $sb.AppendLine("<div class='container' id='intune-hybrid'>") | Out-Null
        $sb.AppendLine("<h2>🏢 Hybrid-Analyse</h2>") | Out-Null

        # Umgebungstyp-Badge
        $EnvBadge = switch -Wildcard ($IND3.HybridEnvironment) {
            '*GPO-dominant*' { "<span class='badge badge-fail'>$($IND3.HybridEnvironment)</span>" }
            '*Co-Management*'{ "<span class='badge badge-warn'>$($IND3.HybridEnvironment)</span>" }
            '*Cloud-only*'   { "<span class='badge badge-pass'>$($IND3.HybridEnvironment)</span>" }
            default          { "<span class='badge badge-info'>$($IND3.HybridEnvironment)</span>" }
        }
        $sb.AppendLine("<div class='info-bar'>Umgebungstyp: $EnvBadge &nbsp;|&nbsp; GPO-/SCCM-Anteil: <strong>$($IND3.HybridPct)%</strong> der Windows-Geraete</div>") | Out-Null

        $SC_CoManaged  = if ($IND3.CoManagedDevices -gt 0) { 'warning' } else { '' }
        $SC_SCCM       = if ($IND3.PureSCCMMgmt -gt 0)    { 'critical' } else { '' }
        $SC_HybJoin    = if ($IND3.HybridJoinedEntra -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>$($IND3.PureIntuneMgmt)</div><div class='stat-label'>Cloud (Intune only)</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card $SC_CoManaged'><div class='stat-number'>$($IND3.CoManagedDevices)</div><div class='stat-label'>Co-Managed (SCCM+Intune)</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card $SC_SCCM'><div class='stat-number'>$($IND3.PureSCCMMgmt)</div><div class='stat-label'>Nur SCCM (GPO-only)</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card $SC_HybJoin'><div class='stat-number'>$($IND3.HybridJoinedEntra)</div><div class='stat-label'>Hybrid-Joined (On-Prem)</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card success'><div class='stat-number'>$($IND3.CloudOnlyEntra)</div><div class='stat-label'>Entra-Joined (Cloud)</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($IND3.RegisteredEntra)</div><div class='stat-label'>Registriert (BYOD)</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        # GPO/SCCM Geraete Tabelle
        if ($IND3.GPOLikelyDevices -gt 0) {
            $sb.AppendLine("<h3>⚠️ GPO/SCCM-verwaltete Geraete ($($IND3.GPOLikelyDevices))</h3>") | Out-Null
            $sb.AppendLine("<div class='info-bar' style='background:#fff1f2;border-color:#fca5a5;'>Diese Geraete werden (teilweise) ueber on-premises Group Policy oder SCCM/ConfigMgr verwaltet. Intune-Konfigurationsprofile wirken moeglicherweise nicht oder werden von GPOs ueberschrieben. Eine Migration zu Cloud-only oder Co-Management wird empfohlen.</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>Geraet</th><th>Benutzer</th><th>Management-Agent</th><th>Enrollment-Typ</th><th>Status</th></tr>") | Out-Null
            foreach ($Dev in $IND3.GPOLikelyList | Sort-Object ManagementAgent, DeviceName) {
                $AgentBadge = switch ($Dev.ManagementAgent) {
                    'configurationManagerClient'           { "<span class='badge badge-fail'>Nur SCCM/GPO</span>" }
                    'configurationManagerClientMdm'        { "<span class='badge badge-warn'>Co-Management</span>" }
                    'configurationManagerClientMdmEas'     { "<span class='badge badge-warn'>Co-Management+EAS</span>" }
                    default                                 { "<span class='badge'>$($Dev.ManagementAgent)</span>" }
                }
                $EnrollBadge = switch ($Dev.DeviceEnrollmentType) {
                    'windowsCoManagement'  { "<span class='badge badge-warn'>Co-Management</span>" }
                    'deviceEnrollmentManager' { "<span class='badge'>DEM</span>" }
                    default                { "<span class='badge badge-info'>$($Dev.DeviceEnrollmentType)</span>" }
                }
                $_SC52 = if ($Dev.ManagementAgent -eq 'configurationManagerClient') { '<span class=' } else { '<span class=' }
                $sb.AppendLine("<tr><td><strong>$($Dev.DeviceName)</strong></td><td>$($Dev.UserDisplayName)</td><td>$AgentBadge</td><td>$EnrollBadge</td><td>$_SC52</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }

        # Entra Device Join Types
        if ($IND3.EntraDevices.Count -gt 0) {
            $sb.AppendLine("<h3>🔗 Entra ID Geraete-Join-Typen ($($IND3.EntraDevices.Count) Geraete)</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Geraet</th><th>Betriebssystem</th><th>Join-Typ</th><th>Verwaltet</th><th>Konform</th><th>Letzter Login</th></tr>") | Out-Null
            foreach ($ED in $IND3.EntraDevices | Sort-Object TrustType, Name | Select-Object -First 200) {
                $JoinBadge = switch ($ED.TrustType) {
                    'AzureAd'   { "<span class='badge badge-pass'>Entra-Joined</span>" }
                    'ServerAd'  { "<span class='badge badge-warn'>Hybrid-Joined (On-Prem)</span>" }
                    'Workplace' { "<span class='badge badge-info'>Registriert (BYOD)</span>" }
                    default     { "<span class='badge'>$($ED.TrustType)</span>" }
                }
                $RowC     = if ($ED.TrustType -eq 'ServerAd') { 'warning-row' } else { '' }
                $MgdBadge = if ($ED.IsManaged) { "<span class='badge badge-pass'>Ja</span>" } else { "<span class='badge'>Nein</span>" }
                $CplBadge = if ($ED.IsCompliant -eq $true) { "<span class='badge badge-pass'>Ja</span>" } elseif ($ED.IsCompliant -eq $false) { "<span class='badge badge-fail'>Nein</span>" } else { "<span class='badge'>-</span>" }
                $sb.AppendLine("<tr class='$RowC'><td>$($ED.Name)</td><td>$($ED.OS)</td><td>$JoinBadge</td><td>$MgdBadge</td><td>$CplBadge</td><td>$($ED.LastSignIn)</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        }

        # Empfehlungen fuer Hybrid-Umgebung
        if ($IND3.HybridPct -gt 0 -or ($ReportData.EntraID -and $ReportData.EntraID.HybridSync)) {
            $sb.AppendLine("<h3>📋 Handlungsempfehlungen fuer Hybrid-Umgebungen</h3>") | Out-Null
            $sb.AppendLine("<table><tr><th>Thema</th><th>Problem</th><th>Empfehlung</th><th>Prioritaet</th></tr>") | Out-Null
            if ($IND3.PureSCCMMgmt -gt 0) {
                $sb.AppendLine("<tr class='critical-row'><td><strong>GPO-only Geraete</strong></td><td>$($IND3.PureSCCMMgmt) Geraete werden ausschliesslich per SCCM/GPO verwaltet - Intune-Compliance-Policies greifen nicht</td><td>Co-Management aktivieren (SCCM + Intune parallel) als ersten Schritt zur Cloud-Migration</td><td><span class='badge badge-fail'>Hoch</span></td></tr>") | Out-Null
            }
            if ($IND3.HybridJoinedEntra -gt 0) {
                $sb.AppendLine("<tr class='warning-row'><td><strong>Hybrid-Join</strong></td><td>$($IND3.HybridJoinedEntra) Geraete sind Hybrid-Joined - Abhaengigkeit von on-premises Active Directory</td><td>Langfristig zu Entra-Join (Cloud-only) migrieren - ermoeglicht vollstaendiges Intune-Management ohne AD-Abhaengigkeit</td><td><span class='badge badge-warn'>Mittel</span></td></tr>") | Out-Null
            }
            if ($IND3.CoManagedDevices -gt 0) {
                $sb.AppendLine("<tr class='warning-row'><td><strong>Co-Management</strong></td><td>$($IND3.CoManagedDevices) Geraete im Co-Management - GPO-Workloads koennen Intune-Policies ueberschreiben</td><td>Co-Management-Workloads schrittweise zu Intune verschieben: zuerst Compliance, dann Config Policies, dann Windows Update</td><td><span class='badge badge-warn'>Mittel</span></td></tr>") | Out-Null
            }
            if ($ReportData.EntraID -and $ReportData.EntraID.HybridSync) {
                $sb.AppendLine("<tr><td><strong>Entra Connect Sync</strong></td><td>On-Premises Active Directory wird mit Entra ID synchronisiert - Identitaeten haengen von On-Prem AD ab</td><td>Neue Benutzer direkt als Cloud-only anlegen. Fuer vollstaendige Cloud-Migration: Entra Connect Cloud Sync evaluieren</td><td><span class='badge badge-info'>Langfristig</span></td></tr>") | Out-Null
            }
            $sb.AppendLine("</table></div>") | Out-Null
        } else {
            $sb.AppendLine("</div>") | Out-Null
        }
    }

    # ── INTUNE GERAETE-ABDECKUNG ──────────────────────────────────────────────────
    if ($ReportData.Intune -and $ReportData.Intune.UsersWithoutDevice.Count -gt 0) {
        $INT = $ReportData.Intune
        $sb.AppendLine("<div class='container' id='intune-coverage'>") | Out-Null
        $sb.AppendLine("<h2>📵 Geraete-Abdeckung</h2>") | Out-Null
        $sb.AppendLine("<div class='info-bar' style='background:#fff1f2;border-color:#fca5a5;'>$($INT.UsersWithoutDevice.Count) lizenzierte Benutzer haben kein bei Intune registriertes Geraet. Dies sind potenzielle Sicherheitsluecken im MDM-Rollout.</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Benutzer</th><th>UPN</th><th>Abteilung</th></tr>") | Out-Null
        foreach ($U in $INT.UsersWithoutDevice | Sort-Object DisplayName) {
            $sb.AppendLine("<tr><td>$($U.DisplayName)</td><td>$($U.UserPrincipalName)</td><td>$($U.Department)</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table></div>") | Out-Null
    }

    # ── TEAMS ─────────────────────────────────────────────────────────────────────
    if ($ReportData.Teams) {
        $TMS = $ReportData.Teams
        $sb.AppendLine("<div class='container' id='teams-overview'>") | Out-Null
        $sb.AppendLine("<h2>💬 Microsoft Teams</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($TMS.TotalTeams)</div><div class='stat-label'>Teams gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card $(if ($TMS.PublicTeams -gt ($TMS.TotalTeams / 2)) {"warning"} else {"success"})'><div class='stat-number'>$($TMS.PublicTeams)</div><div class='stat-label'>Öffentlich</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($TMS.PrivateTeams)</div><div class='stat-label'>Privat</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($TMS.ArchivedTeams)</div><div class='stat-label'>Archiviert</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null
        $sb.AppendLine("<table><tr><th>Teamname</th><th>Sichtbarkeit</th><th>Archiviert</th><th>Kanäle</th><th>Erstellt</th></tr>") | Out-Null
        foreach ($T in $TMS.TeamDetails | Sort-Object TeamName) {
            $RowC = if ($T.Visibility -eq 'Public') { "warning-row" } else { "" }
            $_SC54 = if ($T.IsArchived) { 'Ja' } else { 'Nein' }
            $_SC55 = if ($T.Visibility -eq 'Public') { '<span class=' } else { '<span class=' }
            $sb.AppendLine("<tr class='$RowC'><td>$($T.TeamName)</td><td>$_SC55</td><td>$_SC54</td><td>$($T.ChannelCount)</td><td>$($T.Created)</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        # Gaeste pro Team
        if ($TMS.TeamGuestDetails -and $TMS.TeamGuestDetails.Count -gt 0) {
            $sb.AppendLine("<h3>🌐 Externe Gaeste in Teams ($($TMS.TeamGuestDetails.Count) Teams mit Gaesten)</h3>") | Out-Null
            $sb.AppendLine("<div class='info-bar'>Teams mit externen Gastbenutzern. Pruefen Sie regelmaessig ob Gastzugriff noch benoetigt wird.</div>") | Out-Null
            $sb.AppendLine("<table><tr><th>Team</th><th>Gaeste</th><th>Gastliste</th><th>Externe Domains</th></tr>") | Out-Null
            foreach ($TG in $TMS.TeamGuestDetails | Sort-Object GuestCount -Descending) {
                $RowC = if ($TG.GuestCount -gt 5) { "warning-row" } else { "" }
                $sb.AppendLine("<tr class='$RowC'><td><strong>$($TG.TeamName)</strong></td><td>$($TG.GuestCount)</td><td style='font-size:11px'>$($TG.GuestList)</td><td>$($TG.GuestDomains)</td></tr>") | Out-Null
            }
            $sb.AppendLine("</table>") | Out-Null
        } else {
            $sb.AppendLine("<p style='color:#6b7280'>Keine Teams mit externen Gaesten gefunden (oder Abfrage auf 50 Teams begrenzt).</p>") | Out-Null
        }
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── SHAREPOINT ────────────────────────────────────────────────────────────────
    if ($ReportData.SharePoint) {
        $SPO = $ReportData.SharePoint
        $sb.AppendLine("<div class='container' id='spo-sites'>") | Out-Null
        $sb.AppendLine("<h2>🗂 SharePoint Online – Sites</h2>") | Out-Null
        $sb.AppendLine("<div class='stat-grid'>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($SPO.TotalSites)</div><div class='stat-label'>Sites gesamt</div></div>") | Out-Null
        $_SC56 = if ($SPO.ExternalSites -gt 0) { 'warning' } else { 'success' }
        $sb.AppendLine("<div class='stat-card $_SC56'><div class='stat-number'>$($SPO.ExternalSites)</div><div class='stat-label'>Ext. Sharing aktiv</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$([math]::Round($SPO.TotalStorageMB / 1024, 1)) GB</div><div class='stat-label'>Storage gesamt</div></div>") | Out-Null
        $sb.AppendLine("<div class='stat-card'><div class='stat-number'>$($SPO.HubSites.Count)</div><div class='stat-label'>Hub Sites</div></div>") | Out-Null
        $sb.AppendLine("</div>") | Out-Null

        $sb.AppendLine("<div class='info-bar'>Tenant Sharing-Level: <strong>$($SPO.ExternalSharing)</strong> &nbsp;|&nbsp; Standard-Link: <strong>$($SPO.DefaultLinkType)</strong></div>") | Out-Null

        $sb.AppendLine("<table><tr><th>Site-URL</th><th>Titel</th><th>Template</th><th>Sharing</th><th>Storage (GB)</th><th>Ordner (Root)</th><th>Zuletzt geändert</th></tr>") | Out-Null
        foreach ($Site in $SPO.SiteDetails | Sort-Object StorageUsageGB -Descending | Select-Object -First 300) {
            $RowC = if ($Site.SharingCapability -eq 'ExternalUserAndGuestSharing') { "critical-row" } elseif ($Site.SharingCapability -ne 'Disabled') { "warning-row" } else { "" }
            $Modified = if ($Site.LastContentModified) { $Site.LastContentModified.ToString('dd.MM.yyyy') } else { '-' }
            $sb.AppendLine("<tr class='$RowC'><td><a href='$($Site.Url)' target='_blank'>$($Site.Url)</a></td><td>$($Site.Title)</td><td>$($Site.Template)</td><td>$($Site.SharingCapability)</td><td>$($Site.StorageUsageGB)</td><td style='font-size:11px;color:#374151;max-width:300px'>$($Site.FolderTree)</td><td>$Modified</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null

        # ── Berechtigungs-Abschnitt ───────────────────────────────────────────────
        if ($SPO.PermMap -and $SPO.PermMap.Count -gt 0) {
            $sb.AppendLine("<h2 style='margin-top:32px'>🔐 SharePoint – Berechtigungen</h2>") | Out-Null
            foreach ($SiteUrl in $SPO.PermMap.Keys | Sort-Object) {
                $Perm = $SPO.PermMap[$SiteUrl]
                $SiteTitle = ($SPO.SiteDetails | Where-Object { $_.Url -eq $SiteUrl } | Select-Object -First 1).Title
                $sb.AppendLine("<details style='margin-bottom:12px;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px'>") | Out-Null
                $sb.AppendLine("<summary style='cursor:pointer;font-weight:600;color:#1e3a5f'>$SiteTitle <span style='font-weight:normal;font-size:12px;color:#6b7280'>$SiteUrl</span></summary>") | Out-Null
                $sb.AppendLine("<div style='margin-top:12px'>") | Out-Null

                # Site-Berechtigungen
                if ($Perm.SitePerms -and $Perm.SitePerms.Count -gt 0) {
                    $sb.AppendLine("<h4 style='margin:0 0 6px;color:#374151'>👥 Site-Berechtigungen</h4>") | Out-Null
                    $sb.AppendLine("<table><tr><th>Benutzer/Gruppe</th><th>Rollen</th></tr>") | Out-Null
                    foreach ($P in $Perm.SitePerms) {
                        $sb.AppendLine("<tr><td>$($P.Who)</td><td>$($P.Roles)</td></tr>") | Out-Null
                    }
                    $sb.AppendLine("</table>") | Out-Null
                } else {
                    $sb.AppendLine("<p style='color:#9ca3af;font-size:12px'>Keine Site-Berechtigungen abrufbar</p>") | Out-Null
                }

                # Gebrochene Vererbung
                if ($Perm.BrokenInheritance -and $Perm.BrokenInheritance.Count -gt 0) {
                    $sb.AppendLine("<h4 style='margin:12px 0 6px;color:#d97706'>⚠ Gebrochene Vererbung ($($Perm.BrokenInheritance.Count) Ordner)</h4>") | Out-Null
                    $sb.AppendLine("<table><tr><th>Ordner</th><th>Benutzer/Gruppen</th><th>Anzahl Einträge</th></tr>") | Out-Null
                    foreach ($B in $Perm.BrokenInheritance) {
                        $sb.AppendLine("<tr class='warning-row'><td>$($B.Folder)</td><td>$($B.Users)</td><td>$($B.Count)</td></tr>") | Out-Null
                    }
                    $sb.AppendLine("</table>") | Out-Null
                } else {
                    $sb.AppendLine("<p style='color:#16a34a;font-size:12px'>✓ Keine gebrochene Vererbung gefunden</p>") | Out-Null
                }

                # Sharing-Links
                if ($Perm.SharingLinks -and $Perm.SharingLinks.Count -gt 0) {
                    $sb.AppendLine("<h4 style='margin:12px 0 6px;color:#dc2626'>🔗 Sharing-Links ($($Perm.SharingLinks.Count))</h4>") | Out-Null
                    $sb.AppendLine("<table><tr><th>Typ</th><th>Scope</th><th>Link</th><th>Ablauf</th></tr>") | Out-Null
                    foreach ($L in $Perm.SharingLinks) {
                        $RowC = if ($L.Scope -eq 'anonymous') { 'critical-row' } elseif ($L.Scope -eq 'organization') { '' } else { 'warning-row' }
                        $sb.AppendLine("<tr class='$RowC'><td>$($L.Type)</td><td>$($L.Scope)</td><td style='font-size:11px'>$($L.Url)</td><td>$($L.Expires)</td></tr>") | Out-Null
                    }
                    $sb.AppendLine("</table>") | Out-Null
                } else {
                    $sb.AppendLine("<p style='color:#16a34a;font-size:12px'>✓ Keine Sharing-Links gefunden</p>") | Out-Null
                }

                $sb.AppendLine("</div></details>") | Out-Null
            }
        }
        $sb.AppendLine("</div>") | Out-Null
    }

    # ── Fehlerprotokoll ───────────────────────────────────────────────────────────
    $sb.AppendLine("<div class='container' id='error-log'>") | Out-Null
    $sb.AppendLine("<h2>⚠ Protokoll ($($Global:ErrorLog.Count) Einträge)</h2>") | Out-Null
    if ($Global:ErrorLog.Count -eq 0) {
        $sb.AppendLine("<p style='color:#16a34a'>✓ Keine Fehler oder Warnungen aufgetreten.</p>") | Out-Null
    } else {
        $sb.AppendLine("<table><tr><th>#</th><th>Meldung</th></tr>") | Out-Null
        $i = 0
        foreach ($Entry in $Global:ErrorLog) {
            $i++
            $RowC = if ($Entry -match '^❌') { "critical-row" } else { "warning-row" }
            $sb.AppendLine("<tr class='$RowC'><td>$i</td><td>$Entry</td></tr>") | Out-Null
        }
        $sb.AppendLine("</table>") | Out-Null
    }
    $sb.AppendLine("</div>") | Out-Null

    # ── Footer ────────────────────────────────────────────────────────────────────
    $sb.AppendLine("<div style='text-align:center;color:#9ca3af;font-size:12px;padding:20px 0;'>M365 Inventory Report v$ScriptVersion · Erstellt von $env:USERNAME · $($EndTime.ToString('dd.MM.yyyy HH:mm')) · Compliance-Quellen: CISA M365 Baseline v1.0, CIS M365 Foundations Benchmark v6.0.1, BSI IT-Grundschutz, MS Security Baseline</div>") | Out-Null
    $sb.AppendLine("</div></body></html>") | Out-Null

    # OutputPath-Fallback falls leer (z.B. wenn TenantId nicht aufgeloest wurde)
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path $PSScriptRoot "M365-Inventory-$(Get-Date -Format 'yyyyMMdd-HHmm').html"
        Write-Log "OutputPath war leer - verwende Fallback: $OutputPath" -Level Warning
    }
    $sb.ToString() | Out-File -FilePath $OutputPath -Encoding UTF8

    # Score-Trend fuer Vergleich beim naechsten Lauf speichern
    try {
        if ($ReportData.EntraID -and $ReportData.EntraID.TenantId) {
            $TrendFile = Join-Path $PSScriptRoot "M365-Inventory-Score-$($ReportData.EntraID.TenantId).json"
            @{ Date=$EndTime.ToString("yyyy-MM-dd HH:mm"); Score=$Score.Overall; Pass=$Score.Passed; Fail=$Score.Failed; Warn=$Score.Warnings } |
                ConvertTo-Json | Set-Content -Path $TrendFile -Encoding UTF8
        }
    } catch {}

    Write-Log "HTML-Report gespeichert: $OutputPath" -Level Success
}

# ============================================================
# VERBINDUNGEN TRENNEN
# ============================================================
function Disconnect-M365Services {
    try { Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null } catch {}
    if ($Global:Connected.Exchange) {
        try {
            # Exchange-Disconnect kann WAM-Crash ausloesen - in separatem Job isolieren
            $DisconnectJob = Start-Job -ScriptBlock {
                Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue
                Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
            }
            Wait-Job $DisconnectJob -Timeout 5 | Out-Null
            Remove-Job $DisconnectJob -Force -ErrorAction SilentlyContinue
        } catch {}
    }
    if ($Global:Connected.SPO) {
        try { Disconnect-PnPOnline -ErrorAction SilentlyContinue | Out-Null } catch {}
    }
    Write-Log "Alle Verbindungen getrennt." -Level Info
}

# ============================================================
# MAIN
# ============================================================
function Main {
    Start-Transcript -Path $TranscriptPath -Force | Out-Null

    $ModConfig = Invoke-ModuleSelectionDialog

    # Module prüfen / installieren
    Write-Host ""
    Write-Host "  Prüfe erforderliche PowerShell-Module..." -ForegroundColor Yellow

    # Graph-Modul Kompatibilitaetsmatrix (Stand April 2026):
    #
    #  Graph-Version  | PS / .NET           | Status
    #  ----------------|---------------------|----------------------------------
    #  <= 2.25.0       | PS 5.1 / 7.x        | ✓ Vollst. kompatibel, kein WAM
    #  2.26 - 2.33     | PS 7.x / .NET 8+    | ⚠ WAM-Bug auf PS 5.1, sonst OK
    #  2.34 - 2.35     | PS 7.x / .NET 8+    | ✓ WAM Standard, Device-Code OK
    #  2.36+           | PS 7.x / .NET 10    | ✗ System.Text.Json 10 erforderlich
    #                  |                     |   Inkompatibel mit PS 7.5 (.NET 9)!
    #
    #  Empfehlung enthus: Microsoft.Graph 2.25.0 (stabil, alle PS-Versionen, alle .NET)
    #
    $GraphVer = (Get-Module Microsoft.Graph.Authentication -ListAvailable |
        Sort-Object Version -Descending | Select-Object -First 1).Version

    if ($null -eq $GraphVer) {
        Write-Host ""
        Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
        Write-Host "  ║  ✗ Microsoft.Graph nicht installiert!                       ║" -ForegroundColor Red
        Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Red
        Write-Host "  ║  Bitte einmalig ausfuehren:                                 ║" -ForegroundColor Yellow
        Write-Host "  ║                                                              ║" -ForegroundColor Yellow
        Write-Host "  ║  Install-Module Microsoft.Graph ``                           ║" -ForegroundColor Cyan
        Write-Host "  ║    -RequiredVersion 2.25.0 -Scope CurrentUser               ║" -ForegroundColor Cyan
        Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Red
        Write-Host ""
        Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
        exit 1
    }

    # PS-Version und .NET-Version ermitteln fuer Kompatibilitaetspruefung
    $DotNetVer = [System.Environment]::Version
    $PSMajor   = $PSVersionTable.PSVersion.Major

    # Graph 2.26+ auf PS 7 mit .NET < 10: System.Text.Json Konflikt
    # Graph 2.36 benoetigt System.Text.Json 10.0.0.0 - nur in .NET 10 vorhanden
    # PS 7.5 laeuft auf .NET 9 -> Inkompatibel
    $NeedsDotNet10 = $GraphVer -ge [version]'2.26.0' -and $DotNetVer.Major -lt 10 -and $PSMajor -ge 7
    if ($NeedsDotNet10) {
        Write-Host ""
        Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
        Write-Host "  ║  ✗ Microsoft.Graph $GraphVer inkompatibel mit PS $($PSVersionTable.PSVersion)    ║" -ForegroundColor Red
        Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Red
        Write-Host "  ║  Graph 2.26+ benoetigt System.Text.Json 10 (.NET 10).       ║" -ForegroundColor Yellow
        Write-Host "  ║  PS $($PSVersionTable.PSVersion) laeuft auf .NET $($DotNetVer.Major) - nicht kompatibel.     ║" -ForegroundColor Yellow
        Write-Host "  ║                                                              ║" -ForegroundColor Yellow
        Write-Host "  ║  Loesung A (empfohlen): Graph downgraden                    ║" -ForegroundColor White
        Write-Host "  ║  Install-Module Microsoft.Graph ``                           ║" -ForegroundColor Cyan
        Write-Host "  ║    -RequiredVersion 2.25.0 -Scope CurrentUser ``            ║" -ForegroundColor Cyan
        Write-Host "  ║    -Force -AllowClobber                                     ║" -ForegroundColor Cyan
        Write-Host "  ║                                                              ║" -ForegroundColor Yellow
        Write-Host "  ║  Loesung B: PowerShell auf 7.6+ updaten (benoetigt .NET 10) ║" -ForegroundColor White
        Write-Host "  ║  https://aka.ms/powershell/install                          ║" -ForegroundColor Cyan
        Write-Host "  ║                                                              ║" -ForegroundColor Yellow
        Write-Host "  ║  Danach PowerShell neu starten und Script erneut starten.   ║" -ForegroundColor Yellow
        Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Red
        Write-Host ""
        Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
        exit 1
    }

    # PS 5.1 + Graph 2.26-2.33: WAM-Bug, Device-Code-Flow als Workaround
    if ($GraphVer -ge [version]'2.26.0' -and $GraphVer -lt [version]'2.34.0' -and $PSMajor -le 5) {
        Write-Host "  ℹ Microsoft.Graph $GraphVer + PowerShell 5.1: Device-Code-Flow aktiv (WAM deaktiviert)." -ForegroundColor Cyan
        Write-Host ""
    }

    if ($GraphVer -eq [version]'2.25.0' -or $GraphVer -lt [version]'2.26.0') {
        Write-Host "  ✓ Microsoft.Graph $GraphVer (empfohlene Version, vollst. kompatibel)" -ForegroundColor Green
        Write-Host ""
    } elseif ($GraphVer -ge [version]'2.34.0') {
        Write-Host "  ✓ Microsoft.Graph $GraphVer (kompatibel - .NET $($DotNetVer.Major) vorhanden)" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "  ✓ Microsoft.Graph $GraphVer" -ForegroundColor Green
        Write-Host ""
    }

    # ── DLL-Konflikt: Microsoft.Graph.Core neue Version per Assembly.LoadFrom vorab laden ──
    # PnP.PowerShell und ExchangeOnlineManagement enthalten Graph.Core 1.25.1 als Abhaengigkeit.
    # .NET laedt immer die erste gefundene Version - daher MUSS die neue Version zuerst
    # im Assembly-Cache sein, BEVOR Import-Module PnP/Exchange ausgefuehrt wird.
    # Assembly.LoadFrom() erzwingt das Laden einer bestimmten DLL-Datei direkt.
    Write-Host "  Fixe DLL-Versionskonflikt..." -ForegroundColor DarkCyan
    try {
        $GraphAuthMod = Get-Module Microsoft.Graph.Authentication -ListAvailable |
            Sort-Object Version -Descending | Select-Object -First 1
        if ($GraphAuthMod) {
            $ModDir = Split-Path $GraphAuthMod.Path
            foreach ($DllName in @('Microsoft.Graph.Core.dll', 'Azure.Core.dll', 'Azure.Identity.dll', 'Microsoft.Identity.Client.dll')) {
                $DllFile = Get-ChildItem -Path $ModDir -Filter $DllName -Recurse -EA SilentlyContinue |
                    Sort-Object { try { [version]($_.VersionInfo.FileVersion) } catch { [version]'0.0' } } -Descending |
                    Select-Object -First 1
                if ($DllFile) {
                    try {
                        [System.Reflection.Assembly]::LoadFrom($DllFile.FullName) | Out-Null
                        Write-Host "    ✓ $DllName v$($DllFile.VersionInfo.FileVersion)" -ForegroundColor DarkGray
                    } catch { <# bereits geladen - OK #> }
                }
            }
        }
    } catch {
        Write-Log "DLL-Vorabladen: $($_.Exception.Message)" -Level Warning
    }
    Write-Host ""

    # ── Modul-Ladereihenfolge ist kritisch ──────────────────────────────────────
    # Reihenfolge: DLL-Vorabladen (oben) -> Graph -> Exchange -> PnP
    if ($ModConfig.EntraID -or $ModConfig.Intune -or $ModConfig.Teams -or $ModConfig.SharePoint -or $ModConfig.Exchange) {
        Test-ModuleAvailable -ModuleName 'Microsoft.Graph' | Out-Null
        # Graph-Kern-Module explizit vorladen damit die DLL-Version gesichert ist
        Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Users          -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Groups         -ErrorAction SilentlyContinue
    }
    if ($ModConfig.Exchange) {
        Test-ModuleAvailable -ModuleName 'ExchangeOnlineManagement' | Out-Null
        Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue
    }
    if ($ModConfig.SharePoint) {
        Test-ModuleAvailable -ModuleName 'PnP.PowerShell' | Out-Null
        # PnP ZULETZT laden - sonst ueberschreibt es Microsoft.Graph.Core
        Import-Module PnP.PowerShell -ErrorAction SilentlyContinue
    }

    # ── Config laden: Reihenfolge ist wichtig ─────────────────────────────────────
    # Schritt 1: Default-Config laden (gibt uns TenantId fuer tenant-spezifische Config)
    $DefaultCfgFile = Join-Path $PSScriptRoot "M365-Inventory-AppConfig.json"
    if ([string]::IsNullOrWhiteSpace($TenantId) -and (Test-Path $DefaultCfgFile)) {
        try {
            $DefCfg = Get-Content $DefaultCfgFile -Raw | ConvertFrom-Json
            if ($DefCfg.TenantId) {
                $script:TenantId = $DefCfg.TenantId
                Write-Log "TenantId aus Default-Config: $($DefCfg.TenantId)" -Level Info
            }
        } catch {}
    }

    # Schritt 2: Tenant-spezifische Config laden (hat alle Felder inkl. ClientSecret)
    if (-not [string]::IsNullOrWhiteSpace($TenantId)) {
        $TenantConfigFile = Join-Path $PSScriptRoot "M365-Inventory-AppConfig-$TenantId.json"
        if (Test-Path $TenantConfigFile) {
            $Global:AppConfigFile = $TenantConfigFile
            Write-Log "Verwende tenant-spezifische Config: $TenantConfigFile" -Level Info
            try {
                $TCfg = Get-Content $TenantConfigFile -Raw | ConvertFrom-Json
                if ($TCfg.ClientId -and [string]::IsNullOrWhiteSpace($Global:ClientId)) {
                    $Global:ClientId = $TCfg.ClientId
                }
                if ($TCfg.ClientSecret -and [string]::IsNullOrWhiteSpace($Global:ClientSecret)) {
                    $Global:ClientSecret = $TCfg.ClientSecret
                    Write-Log "Client Secret aus Config geladen." -Level Info
                }
                if ($TCfg.TenantDomain -and [string]::IsNullOrWhiteSpace($Global:TenantDomain)) {
                    $Global:TenantDomain = $TCfg.TenantDomain
                }
                if ($TCfg.SharePointAdminUrl -and [string]::IsNullOrWhiteSpace($Global:SPOAdminUrl)) {
                    $Global:SPOAdminUrl = $TCfg.SharePointAdminUrl
                }
                if ($TCfg.CloudEnvironment -and [string]::IsNullOrWhiteSpace($Global:CloudEnvironment) -and $TCfg.CloudEnvironment -ne 'Germany') {
                    $Global:CloudEnvironment = $TCfg.CloudEnvironment
                }
            } catch {}
        }
    }

    # Schritt 3: App-Registrierung laden (liest nochmals Config falls noetig)
    $AppId = Get-OrCreateAppRegistration
    if ($AppId) { Write-Log "Verwende App-Registrierung: enthus Dokumentation ($AppId)" -Level Info }

    # Schritt 4: TenantId per Prompt falls immer noch leer
    if ([string]::IsNullOrWhiteSpace($TenantId)) {
        Write-Host ""
        Write-Host "  Tenant-ID benoetigt (zu finden in Entra Portal > Uebersicht > Verzeichnis-ID)" -ForegroundColor Yellow
        $TenantInput = Read-Host "  Tenant-ID (Verzeichnis-ID)"
        if (-not [string]::IsNullOrWhiteSpace($TenantInput)) {
            $script:TenantId = $TenantInput.Trim()
            if (Test-Path $Global:AppConfigFile) {
                try {
                    $Cfg = Get-Content $Global:AppConfigFile -Raw | ConvertFrom-Json
                    $Cfg | Add-Member -NotePropertyName TenantId -NotePropertyValue $script:TenantId -Force
                    $Cfg | ConvertTo-Json | Set-Content $Global:AppConfigFile -Encoding UTF8
                } catch {}
            }
            Write-Log "TenantId gesetzt: $script:TenantId" -Level Success
        }
    } else {
        Write-Log "TenantId: $TenantId" -Level Info
    }

    Connect-M365Services -ModConfig $ModConfig

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║        M365 Tenant Inventory – Datensammlung startet         ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""

    # ── DLL-Konflikt Fix: Microsoft.Graph.Core neue Version vorab laden ──────
    # PnP.PowerShell und ExchangeOnlineManagement enthalten Microsoft.Graph.Core 1.25.1
    # als eingebettete Abhaengigkeit. Sobald diese Module geladen sind, schlaegt
    # Get-MgUser etc. mit TypeLoadException fehl.
    # Fix: Die neue Graph.Core.dll aus dem Microsoft.Graph-Modul explizit per
    # Assembly.LoadFrom laden, BEVOR Import-Module ausgefuehrt wird.
    # .NET verwendet dann die bereits geladene neue Version und ignoriert die alte.
    Write-Host "  [Init] Fixe DLL-Versionskonflikt (PnP vs Microsoft.Graph)..." -ForegroundColor DarkCyan
    try {
        $GraphAuthMod = Get-Module Microsoft.Graph.Authentication -ListAvailable |
            Sort-Object Version -Descending | Select-Object -First 1
        if ($GraphAuthMod) {
            $ModDir = Split-Path $GraphAuthMod.Path
            # Graph.Core.dll und Microsoft.Identity.Client.dll vorab laden
            foreach ($DllName in @('Microsoft.Graph.Core.dll','Azure.Core.dll','Azure.Identity.dll')) {
                $DllFile = Get-ChildItem -Path $ModDir -Filter $DllName -Recurse -EA SilentlyContinue |
                    Sort-Object { try { [version]($_.VersionInfo.FileVersion) } catch { [version]'0.0' } } -Descending |
                    Select-Object -First 1
                if ($DllFile) {
                    try {
                        [System.Reflection.Assembly]::LoadFrom($DllFile.FullName) | Out-Null
                        Write-Host "  [Init] ✓ $DllName v$($DllFile.VersionInfo.FileVersion)" -ForegroundColor DarkGray
                    } catch {
                        Write-Host "  [Init] ⚠ $DllName Vorabladen fehlgeschlagen" -ForegroundColor DarkYellow
                    }
                }
            }
        }
    } catch {
        Write-Log "DLL-Vorabladen fehlgeschlagen: $($_.Exception.Message)" -Level Warning
    }

    $Results = [ordered]@{}
    if ($ModConfig.EntraID)    { $Results['EntraID']    = (Get-EntraIDData)    }
    if ($ModConfig.Exchange)   { $Results['Exchange']   = (Get-ExchangeData)   }
    if ($ModConfig.Intune)     { $Results['Intune']     = (Get-IntuneData)     }
    if ($ModConfig.Teams)      { $Results['Teams']      = (Get-TeamsData)      }
    if ($ModConfig.SharePoint) { $Results['SharePoint'] = (Get-SharePointData) }
    if ($ModConfig.Compliance) { $Results['Compliance'] = (Invoke-ComplianceChecks) }

    $Successful = ($Results.Values | Where-Object { $_ -eq $true }).Count
    $Total      = $Results.Count
    Write-Host ""
    Write-Host "  Datensammlung: $Successful von $Total Modulen erfolgreich." -ForegroundColor $(if ($Successful -eq $Total) { 'Green' } else { 'Yellow' })

    $Score = Get-ComplianceScore
    Write-Host "  Compliance Score: $($Score.Overall)% (PASS: $($Score.Passed), FAIL: $($Score.Failed), WARN: $($Score.Warnings))" -ForegroundColor $(if ($Score.Overall -ge 80) { 'Green' } elseif ($Score.Overall -ge 60) { 'Yellow' } else { 'Red' })

    $LicGaps = Get-LicenseGapAnalysis
    if ($LicGaps.Count -gt 0) { Write-Log "Lizenz-Gaps: $($LicGaps.Count) Empfehlung(en) identifiziert" -Level Warning }

    Generate-HTMLReport -ModConfig $ModConfig -Score $Score -LicenseGaps $LicGaps

    Disconnect-M365Services

    # Timing-Zusammenfassung ausgeben
    if ($Global:VerboseMode -and $Global:StepTimings.Count -gt 0) {
        Write-Host ""
        Write-Host "  ⏱ Timing-Zusammenfassung:" -ForegroundColor DarkYellow
        foreach ($T in $Global:StepTimings | Where-Object { $null -ne $_.DurationSec } | Sort-Object DurationSec -Descending) {
            $Bar = "█" * [math]::Min([int]($T.DurationSec / 2), 30)
            Write-Host ("  {0,-30} {1,6}s  {2}" -f $T.Name, $T.DurationSec, $Bar) -ForegroundColor DarkYellow
        }
    }
    Write-Host ""
    Write-Host "✅ Report erstellt   : $OutputPath" -ForegroundColor Green
    Write-Host "📋 Fehler/Warnungen  : $($Global:ErrorLog.Count)" -ForegroundColor $(if ($Global:ErrorLog.Count -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host "📝 Logdatei          : $TranscriptPath" -ForegroundColor Gray

    Stop-Transcript | Out-Null

    $Open = Read-Host "`nReport jetzt öffnen? (j/n)"
    if ($Open -match '^[jJyY]$') { Start-Process $OutputPath }
}

Main
