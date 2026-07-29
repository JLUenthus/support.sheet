<#
.SYNOPSIS
    Richtet die App-Registrierung "enthus Dokumentation" fuer M365-Inventory.ps1 ein.
    Prueft ob App bereits vorhanden ist und fuehrt nur notwendige Aenderungen durch.

.DESCRIPTION
    Dieses Script:
    - Legt App-Registrierung an ODER aktualisiert vorhandene
    - Vergleicht vorhandene Permissions mit Soll-Zustand (Diff)
    - Setzt nur fehlende Permissions / erteilt nur fehlenden Consent
    - Erstellt neues Secret nur wenn kein gueltiges mehr vorhanden
    - Schreibt AppConfig-JSON fuer M365-Inventory.ps1

    Voraussetzung: Global Administrator im Zieltenant

.PARAMETER TenantId
    Verzeichnis-ID (Tenant-ID) des Zieltentants.

.PARAMETER SecretExpiryMonths
    Laufzeit eines neuen Client Secrets in Monaten. Standard: 24

.PARAMETER ForceNewSecret
    Erstellt immer ein neues Secret, auch wenn ein gueltiges existiert.

.PARAMETER OutputPath
    Pfad fuer die AppConfig-JSON. Standard: Gleiches Verzeichnis wie Script.

.PARAMETER AppName
    Name der App-Registrierung. Standard: "enthus Dokumentation"

.EXAMPLE
    .\M365-Setup-AppRegistration.ps1 -TenantId "514e7cb6-0485-450f-aeef-764e018e4215"

.EXAMPLE
    .\M365-Setup-AppRegistration.ps1 -TenantId "..." -ForceNewSecret

.NOTES
    Idempotent: Mehrfacher Aufruf ist sicher - es werden nur Aenderungen durchgefuehrt.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TenantId,

    [int]$SecretExpiryMonths = 24,

    [switch]$ForceNewSecret,

    [string]$OutputPath = "",

    [string]$AppName = "enthus Dokumentation"
)

$ErrorActionPreference = 'Stop'
$ScriptDir    = if ($OutputPath) { $OutputPath } else { $PSScriptRoot }
$LogPath      = Join-Path $ScriptDir "M365-Setup-Log-$(Get-Date -Format 'yyyyMMdd-HHmm').log"
Start-Transcript -Path $LogPath -Force | Out-Null

# ── Hilfsfunktionen ────────────────────────────────────────────────────────────
function Write-Step  { param([string]$T) Write-Host "`n  [$((Get-Date).ToString('HH:mm:ss'))] $T" -ForegroundColor Cyan }
function Write-OK    { param([string]$T) Write-Host "    ✓ $T" -ForegroundColor Green }
function Write-Warn  { param([string]$T) Write-Host "    ⚠ $T" -ForegroundColor Yellow }
function Write-Add   { param([string]$T) Write-Host "    + $T" -ForegroundColor DarkGreen }
function Write-Skip  { param([string]$T) Write-Host "    · $T" -ForegroundColor DarkGray }
function Write-Err   { param([string]$T) Write-Host "    ✗ $T" -ForegroundColor Red }

# ── Soll-Permissions definieren ────────────────────────────────────────────────
# Vollstaendige Liste aller Permissions die M365-Inventory.ps1 benoetigt
$RequiredGraphPermissions = @(
    'User.Read.All'
    'Group.Read.All'
    'Directory.Read.All'
    'AuditLog.Read.All'
    'Policy.Read.All'
    'Application.Read.All'
    'DeviceManagementConfiguration.Read.All'
    'DeviceManagementManagedDevices.Read.All'
    'Reports.Read.All'
    'Organization.Read.All'
    'RoleManagement.Read.Directory'
    'IdentityRiskyUser.Read.All'
    'IdentityRiskEvent.Read.All'
    'UserAuthenticationMethod.Read.All'
    'Sites.Read.All'
    'TeamSettings.Read.All'
    'IdentityProvider.Read.All'
    'InformationProtectionPolicy.Read.All'
    'PrivilegedAccess.Read.AzureAD'
    'Organization.ReadWrite.All'          # Benoetigt fuer Report-Anonymisierung deaktivieren (SharePoint Sites)
    'ReportSettings.ReadWrite.All'        # Benoetigt fuer admin/reportSettings (displayConcealedNames)
)

# SharePoint-eigene API Permission (nicht Graph!) fuer PnP App-only Auth
# AppId: 00000003-0000-0ff1-ce00-000000000000
$RequiredSharePointPermissions = @(
    'Sites.FullControl.All'   # Benoetigt fuer PnP.PowerShell App-only (Connect-PnPOnline -ClientSecret)
)

# Exchange Online API Permission (fuer Connect-ExchangeOnline -AppId)
# AppId: 00000002-0000-0ff1-ce00-000000000000 (Office 365 Exchange Online)
# Connect-ExchangeOnline mit -AppId verlangt einen Token fuer https://outlook.office365.com
# Ohne diese Permission: AADSTS650057 "Invalid resource"
$RequiredExchangePermissions = @(
    'Exchange.ManageAsApp'    # Application-Permission: EXO V3 App-only / Device-Code mit -AppId
)

# ── Header ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   enthus M365 Inventory - App-Registrierung Setup v2        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Tenant-ID  : $TenantId" -ForegroundColor White
Write-Host "  App-Name   : $AppName" -ForegroundColor White
Write-Host "  Idempotent : Nur notwendige Aenderungen werden durchgefuehrt" -ForegroundColor DarkGray
Write-Host ""

# ── Modul pruefen ──────────────────────────────────────────────────────────────
Write-Step "Pruefe Microsoft.Graph Modul..."
$DotNetMajor = [System.Environment]::Version.Major

$GraphVer = (Get-Module Microsoft.Graph.Authentication -ListAvailable |
    Sort-Object Version -Descending | Select-Object -First 1).Version

if (-not $GraphVer) {
    Write-Warn "Microsoft.Graph nicht installiert - installiere 2.25.0..."
    Install-Module Microsoft.Graph -RequiredVersion 2.25.0 -Scope CurrentUser -Force -AllowClobber
    $GraphVer = [version]'2.25.0'
}

if ($GraphVer -ge [version]'2.26.0') {
    # Sicherstellen dass 2.25.0 installiert ist
    $Has225 = Get-Module Microsoft.Graph.Authentication -ListAvailable |
        Where-Object { $_.Version -eq [version]'2.25.0' }
    if (-not $Has225) {
        Write-Warn "Installiere Graph 2.25.0..."
        Install-Module Microsoft.Graph -RequiredVersion 2.25.0 -Scope CurrentUser -Force -AllowClobber
    }
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "  ║  Graph $($GraphVer) ist inkompatibel                              ║" -ForegroundColor Yellow
    Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Yellow
    Write-Host "  ║  Graph 2.26+ hat einen Token-Cache Bug mit Device-Code-     ║" -ForegroundColor White
    Write-Host "  ║  Authentifizierung. Version 2.25.0 ist bereits installiert. ║" -ForegroundColor White
    Write-Host "  ║                                                              ║" -ForegroundColor White
    Write-Host "  ║  Neuere Version(en) deinstallieren:                         ║" -ForegroundColor Cyan
    # Alle Versionen >= 2.26 auflisten
    $NewerVers = Get-Module Microsoft.Graph.Authentication -ListAvailable |
        Where-Object { $_.Version -ge [version]'2.26.0' } |
        Sort-Object Version -Descending
    foreach ($V in $NewerVers) {
        Write-Host "  ║  Uninstall-Module Microsoft.Graph -RequiredVersion $($V.Version) -Force" -ForegroundColor White
    }
    Write-Host "  ║                                                              ║" -ForegroundColor White
    Write-Host "  ║  Danach dieses Script erneut starten.                       ║" -ForegroundColor White
    Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

Write-OK "Microsoft.Graph $GraphVer (.NET $DotNetMajor)"

# ── Verbinden ──────────────────────────────────────────────────────────────────
Write-Step "Verbinde als Global Administrator..."
Write-Host "    Bitte mit Global-Administrator-Konto anmelden:" -ForegroundColor Yellow

# WAM deaktivieren - verhindert "Object reference" Bug in Graph 2.26+
$env:MSAL_DISABLE_WAM = '1'
$env:MSAL_DISABLE_WAM_BROKER = '1'
[System.Environment]::SetEnvironmentVariable('MSAL_DISABLE_WAM','1','Process')
[System.Environment]::SetEnvironmentVariable('MSAL_DISABLE_WAM_BROKER','1','Process')

$ConnectScopes = @(
    'Application.ReadWrite.All'
    'AppRoleAssignment.ReadWrite.All'
    'Directory.Read.All'
    'RoleManagement.ReadWrite.Directory'
)

# Graph 2.26+ Kompatibilitaet: -UseDeviceAuthentication hat Token-Cache Bug mit WAM
# Workaround: ueber Environment + explizites NoWelcome
$MgGraphParams = @{
    Scopes              = $ConnectScopes
    TenantId            = $TenantId
    UseDeviceAuthentication = $true
    NoWelcome           = $true
    ErrorAction         = 'Stop'
}
Connect-MgGraph @MgGraphParams

# Token-Validierung: sicherstellen dass API-Calls wirklich funktionieren
# (Connect meldet Erfolg aber Token kann intern korrupt sein - Graph 2.26+ Bug)
$Ctx = $null
$TokenValid = $false
try {
    $Ctx = Get-MgContext
    if ($Ctx) {
        # Test-Call gegen /organization - schlaegt fehl wenn Token defekt
        $null = Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/organization?`$select=id" `
            -ErrorAction Stop
        $TokenValid = $true
    }
} catch {
    $TokenErr = $_.Exception.Message
}

if (-not $TokenValid) {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "  ║  Token-Fehler nach Connect-MgGraph                          ║" -ForegroundColor Red
    Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Red
    Write-Host "  ║  Ursache: Graph 2.26+ WAM-Token-Cache Bug                  ║" -ForegroundColor Yellow
    Write-Host "  ║                                                              ║" -ForegroundColor Yellow
    Write-Host "  ║  Loesung A (empfohlen): Graph 2.25.0 installieren           ║" -ForegroundColor Cyan
    Write-Host "  ║  Install-Module Microsoft.Graph -RequiredVersion 2.25.0 ``  ║" -ForegroundColor White
    Write-Host "  ║    -Force -AllowClobber -Scope CurrentUser                  ║" -ForegroundColor White
    Write-Host "  ║                                                              ║" -ForegroundColor Yellow
    Write-Host "  ║  Loesung B: PowerShell-Session neu starten und erneut       ║" -ForegroundColor Cyan
    Write-Host "  ║  versuchen (Token-Cache wird geleert)                       ║" -ForegroundColor White
    Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Fehler: $TokenErr" -ForegroundColor DarkGray
    Write-Host ""
    throw "Token-Validierung fehlgeschlagen - Graph-Version inkompatibel."
}

Write-OK "Verbunden als: $($Ctx.Account)"

# ── Microsoft Graph Service Principal laden ────────────────────────────────────
Write-Step "Lade Microsoft Graph Service Principal..."
$GraphSP = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$GraphAppRoles = @{}
foreach ($R in $GraphSP.AppRoles) { $GraphAppRoles[$R.Value] = $R.Id }

# Soll-RoleIds ermitteln und unbekannte Permissions warnen
$RequiredRoleIds = [System.Collections.Generic.List[guid]]::new()
foreach ($PermName in $RequiredGraphPermissions) {
    if ($GraphAppRoles.ContainsKey($PermName)) {
        $RequiredRoleIds.Add([guid]$GraphAppRoles[$PermName])
    } else {
        Write-Warn "Permission nicht in Graph-SP gefunden (Tippfehler?): $PermName"
    }
}
Write-OK "$($RequiredRoleIds.Count) erforderliche Graph-Permissions definiert."

# SharePoint-eigene API Service Principal laden (separate API, nicht Graph)
Write-Step "Lade SharePoint Service Principal..."
$SharePointSP = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0ff1-ce00-000000000000'" -ErrorAction SilentlyContinue
$SharePointAppRoles = @{}
$RequiredSharePointRoleIds = [System.Collections.Generic.List[guid]]::new()
if ($SharePointSP) {
    foreach ($R in $SharePointSP.AppRoles) { $SharePointAppRoles[$R.Value] = $R.Id }
    foreach ($PermName in $RequiredSharePointPermissions) {
        if ($SharePointAppRoles.ContainsKey($PermName)) {
            $RequiredSharePointRoleIds.Add([guid]$SharePointAppRoles[$PermName])
        } else {
            Write-Warn "SharePoint-Permission nicht gefunden: $PermName"
        }
    }
    Write-OK "$($RequiredSharePointRoleIds.Count) erforderliche SharePoint-Permissions definiert."
} else {
    Write-Warn "SharePoint Service Principal nicht gefunden - SPO App-only Auth nicht moeglich."
}

# Exchange Online Service Principal laden
Write-Step "Lade Exchange Online Service Principal..."
$ExchangeSP = Get-MgServicePrincipal -Filter "appId eq '00000002-0000-0ff1-ce00-000000000000'" -ErrorAction SilentlyContinue
$ExchangeAppRoles = @{}
$RequiredExchangeRoleIds = [System.Collections.Generic.List[guid]]::new()
if ($ExchangeSP) {
    foreach ($R in $ExchangeSP.AppRoles) { $ExchangeAppRoles[$R.Value] = $R.Id }
    foreach ($PermName in $RequiredExchangePermissions) {
        if ($ExchangeAppRoles.ContainsKey($PermName)) {
            $RequiredExchangeRoleIds.Add([guid]$ExchangeAppRoles[$PermName])
        } else {
            Write-Warn "Exchange-Permission nicht gefunden: $PermName"
        }
    }
    Write-OK "$($RequiredExchangeRoleIds.Count) erforderliche Exchange-Permissions definiert."
} else {
    Write-Warn "Exchange Online Service Principal nicht gefunden."
}

# ── App-Registrierung pruefen / anlegen ───────────────────────────────────────
Write-Step "Pruefe App-Registrierung '$AppName'..."

$App = Get-MgApplication -Filter "displayName eq '$AppName'" -ErrorAction SilentlyContinue |
    Select-Object -First 1

$IsNew = $false
if ($App) {
    Write-OK "App vorhanden: $($App.AppId) (angelegt: $($App.CreatedDateTime.ToString('dd.MM.yyyy')))"
} else {
    Write-Add "Lege neue App-Registrierung an..."
    $App = New-MgApplication `
        -DisplayName $AppName `
        -SignInAudience 'AzureADMyOrg' `
        -IsFallbackPublicClient `
        -PublicClient @{ RedirectUris = @('https://login.microsoftonline.com/common/oauth2/nativeclient') }
    Write-OK "App angelegt: $($App.AppId)"
    $IsNew = $true
    Start-Sleep -Seconds 5  # Replikationsverzoegerung
}

# Service Principal sicherstellen
$AppSP = Get-MgServicePrincipal -Filter "appId eq '$($App.AppId)'" -ErrorAction SilentlyContinue
if (-not $AppSP) {
    Write-Add "Lege Service Principal an..."
    $AppSP = New-MgServicePrincipal -AppId $App.AppId
    Start-Sleep -Seconds 5
    Write-OK "Service Principal: $($AppSP.Id)"
}

# ── Permissions vergleichen (Diff) ─────────────────────────────────────────────
Write-Step "Vergleiche Permissions (Soll/Ist)..."

# IST: Aktuell in App-Registrierung hinterlegte RequiredResourceAccess
$CurrentGraphAccess = $App.RequiredResourceAccess |
    Where-Object { $_.ResourceAppId -eq '00000003-0000-0000-c000-000000000000' }
$CurrentRoleIds = if ($CurrentGraphAccess) {
    @($CurrentGraphAccess.ResourceAccess | Where-Object { $_.Type -eq 'Role' } | Select-Object -ExpandProperty Id)
} else { @() }

# Diff berechnen
$ToAdd    = $RequiredRoleIds | Where-Object { $_ -notin $CurrentRoleIds }
$ToRemove = $CurrentRoleIds  | Where-Object { $_ -notin $RequiredRoleIds }

# Reverse-Lookup fuer lesbare Namen
$RoleIdToName = @{}
foreach ($K in $GraphAppRoles.Keys) { $RoleIdToName[[guid]$GraphAppRoles[$K]] = $K }

# Bestehende SharePoint-Permissions ermitteln (unabhaengig vom Graph-Diff)
$CurrentSPOAccess = $App.RequiredResourceAccess |
    Where-Object { $_.ResourceAppId -eq '00000003-0000-0ff1-ce00-000000000000' }
$CurrentSPORoleIds = if ($CurrentSPOAccess) {
    @($CurrentSPOAccess.ResourceAccess | Where-Object { $_.Type -eq 'Role' } | Select-Object -ExpandProperty Id)
} else { @() }
$SPOToAdd = $RequiredSharePointRoleIds | Where-Object { $_ -notin $CurrentSPORoleIds }
$AllSPORoleIds = @(($CurrentSPORoleIds + $SPOToAdd) | Select-Object -Unique)

# Bestehende Exchange-Permissions ermitteln (unabhaengig von Graph- und SPO-Diff)
$CurrentEXOAccess = $App.RequiredResourceAccess |
    Where-Object { $_.ResourceAppId -eq '00000002-0000-0ff1-ce00-000000000000' }
$CurrentEXORoleIds = if ($CurrentEXOAccess) {
    @($CurrentEXOAccess.ResourceAccess | Where-Object { $_.Type -eq 'Role' } | Select-Object -ExpandProperty Id)
} else { @() }
$EXOToAdd = $RequiredExchangeRoleIds | Where-Object { $_ -notin $CurrentEXORoleIds }
$AllEXORoleIds = @(($CurrentEXORoleIds + $EXOToAdd) | Select-Object -Unique)

$NeedsUpdate = ($ToAdd.Count -gt 0) -or ($SPOToAdd.Count -gt 0) -or ($EXOToAdd.Count -gt 0)

if (-not $NeedsUpdate) {
    Write-OK "Alle Permissions bereits vorhanden (Graph: $($RequiredRoleIds.Count), SharePoint: $($RequiredSharePointRoleIds.Count), Exchange: $($RequiredExchangeRoleIds.Count))."
} else {
    if ($ToAdd.Count -gt 0) {
        Write-Host "    Neue Graph-Permissions ($($ToAdd.Count)):" -ForegroundColor White
        foreach ($Id in $ToAdd) { Write-Add "  $($RoleIdToName[$Id])" }
    }
    if ($SPOToAdd.Count -gt 0) {
        Write-Host "    Neue SharePoint-Permissions ($($SPOToAdd.Count)):" -ForegroundColor White
        Write-Add "  Sites.FullControl.All"
    }
    if ($EXOToAdd.Count -gt 0) {
        Write-Host "    Neue Exchange-Permissions ($($EXOToAdd.Count)):" -ForegroundColor White
        Write-Add "  Exchange.ManageAsApp"
    }
    if ($ToRemove.Count -gt 0) {
        Write-Host "    Nicht mehr benoetigte Permissions ($($ToRemove.Count)):" -ForegroundColor DarkGray
        foreach ($Id in $ToRemove) { Write-Skip "  $($RoleIdToName[$Id]) (beibehalten)" }
    }

    $AllGraphRoleIds = [guid[]]@(($CurrentRoleIds + $ToAdd) | Select-Object -Unique)

    # ResourceAccess explizit als typisiertes Array bauen
    # Verhindert 400 BadRequest bei neuen Apps (leere CurrentRoleIds + neue ToAdd)
    $ResourcesPayload = [System.Collections.Generic.List[hashtable]]::new()

    if ($AllGraphRoleIds.Count -gt 0) {
        $GraphRA = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($Id in $AllGraphRoleIds) { $GraphRA.Add(@{ Id = $Id.ToString(); Type = 'Role' }) }
        $ResourcesPayload.Add(@{ ResourceAppId = '00000003-0000-0000-c000-000000000000'; ResourceAccess = $GraphRA.ToArray() })
    }
    if ($AllSPORoleIds.Count -gt 0) {
        $SPOR = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($Id in $AllSPORoleIds) { $SPOR.Add(@{ Id = $Id.ToString(); Type = 'Role' }) }
        $ResourcesPayload.Add(@{ ResourceAppId = '00000003-0000-0ff1-ce00-000000000000'; ResourceAccess = $SPOR.ToArray() })
    }
    if ($AllEXORoleIds.Count -gt 0) {
        $EXOR = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($Id in $AllEXORoleIds) { $EXOR.Add(@{ Id = $Id.ToString(); Type = 'Role' }) }
        $ResourcesPayload.Add(@{ ResourceAppId = '00000002-0000-0ff1-ce00-000000000000'; ResourceAccess = $EXOR.ToArray() })
    }

    if ($ResourcesPayload.Count -gt 0) {
        Update-MgApplication -ApplicationId $App.Id -RequiredResourceAccess $ResourcesPayload.ToArray()
        Write-OK "Permissions aktualisiert (Graph: $($AllGraphRoleIds.Count), SharePoint: $($AllSPORoleIds.Count), Exchange: $($AllEXORoleIds.Count))."
    }
}

# ── Admin-Consent vergleichen (Diff) ──────────────────────────────────────────
Write-Step "Pruefe Admin-Consent..."

$ExistingConsent = @(Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $AppSP.Id -All -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty AppRoleId)

# Graph Consent
$ConsentMissing = $RequiredRoleIds | Where-Object { $_ -notin $ExistingConsent }
$ConsentCount   = 0

if ($ConsentMissing.Count -eq 0) {
    Write-OK "Graph Admin-Consent vollstaendig - alle $($RequiredRoleIds.Count) Permissions haben Consent."
} else {
    Write-Host "    Fehlender Graph-Consent ($($ConsentMissing.Count) Permissions):" -ForegroundColor White
    foreach ($RoleId in $ConsentMissing) {
        Write-Add "  $($RoleIdToName[$RoleId])"
        try {
            New-MgServicePrincipalAppRoleAssignment `
                -ServicePrincipalId $AppSP.Id `
                -PrincipalId        $AppSP.Id `
                -ResourceId         $GraphSP.Id `
                -AppRoleId          $RoleId `
                -ErrorAction Stop | Out-Null
            $ConsentCount++
        } catch {
            Write-Err "Consent fehlgeschlagen fuer $($RoleIdToName[$RoleId]): $($_.Exception.Message.Split([char]10)[0])"
        }
    }
    Write-OK "Admin-Consent fuer $ConsentCount Permissions erteilt."
}

# SharePoint Consent
if ($SharePointSP -and $RequiredSharePointRoleIds.Count -gt 0) {
    $SPOConsentMissing = $RequiredSharePointRoleIds | Where-Object { $_ -notin $ExistingConsent }
    $SPOConsentCount = 0
    if ($SPOConsentMissing.Count -eq 0) {
        Write-OK "SharePoint Admin-Consent vollstaendig."
    } else {
        Write-Host "    Fehlender SharePoint-Consent ($($SPOConsentMissing.Count) Permissions):" -ForegroundColor White
        $SPORoleIdToName = @{}
        foreach ($K in $SharePointAppRoles.Keys) { $SPORoleIdToName[[guid]$SharePointAppRoles[$K]] = $K }
        foreach ($RoleId in $SPOConsentMissing) {
            Write-Add "  $($SPORoleIdToName[$RoleId])"
            try {
                New-MgServicePrincipalAppRoleAssignment `
                    -ServicePrincipalId $AppSP.Id `
                    -PrincipalId        $AppSP.Id `
                    -ResourceId         $SharePointSP.Id `
                    -AppRoleId          $RoleId `
                    -ErrorAction Stop | Out-Null
                $SPOConsentCount++
            } catch {
                Write-Err "SharePoint Consent fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])"
            }
        }
        Write-OK "SharePoint Admin-Consent fuer $SPOConsentCount Permissions erteilt."
    }
}

# Exchange Online Consent
if ($ExchangeSP -and $RequiredExchangeRoleIds.Count -gt 0) {
    $EXOConsentMissing = $RequiredExchangeRoleIds | Where-Object { $_ -notin $ExistingConsent }
    $EXOConsentCount = 0
    if ($EXOConsentMissing.Count -eq 0) {
        Write-OK "Exchange Online Admin-Consent vollstaendig."
    } else {
        Write-Host "    Fehlender Exchange-Consent ($($EXOConsentMissing.Count) Permissions):" -ForegroundColor White
        $EXORoleIdToName = @{}
        foreach ($K in $ExchangeAppRoles.Keys) { $EXORoleIdToName[[guid]$ExchangeAppRoles[$K]] = $K }
        foreach ($RoleId in $EXOConsentMissing) {
            Write-Add "  $($EXORoleIdToName[$RoleId])"
            try {
                New-MgServicePrincipalAppRoleAssignment `
                    -ServicePrincipalId $AppSP.Id `
                    -PrincipalId        $AppSP.Id `
                    -ResourceId         $ExchangeSP.Id `
                    -AppRoleId          $RoleId `
                    -ErrorAction Stop | Out-Null
                $EXOConsentCount++
            } catch {
                Write-Err "Exchange Consent fehlgeschlagen: $($_.Exception.Message.Split([char]10)[0])"
            }
        }
        Write-OK "Exchange Admin-Consent fuer $EXOConsentCount Permissions erteilt."
    }
}

# ── Public Client Flow sicherstellen ──────────────────────────────────────────
Write-Step "Pruefe Public Client Flow Einstellung..."
$AppDetails = Get-MgApplication -ApplicationId $App.Id
if ($AppDetails.IsFallbackPublicClient -ne $true) {
    Update-MgApplication -ApplicationId $App.Id -IsFallbackPublicClient
    Write-OK "'Oeffentliche Clientflows zulassen' aktiviert."
} else {
    Write-Skip "'Oeffentliche Clientflows zulassen' bereits aktiv."
}

# ── Client Secret pruefen / erstellen ─────────────────────────────────────────
Write-Step "Pruefe Client Secrets..."

$AppRefresh      = Get-MgApplication -ApplicationId $App.Id
$ExistingSecrets = @($AppRefresh.PasswordCredentials)
$Now             = Get-Date
$ValidSecrets    = @($ExistingSecrets | Where-Object {
    $_.EndDateTime -gt $Now.AddDays(30)  # Mindestens 30 Tage noch gueltig
})

$ClientSecret = $null

if ($ValidSecrets.Count -gt 0 -and -not $ForceNewSecret) {
    # Gueltiges Secret vorhanden - Anzeige fuer welche Secrets existieren
    Write-Skip "$($ValidSecrets.Count) gueltiges Secret(s) vorhanden:"
    foreach ($S in $ValidSecrets) {
        $DaysLeft = [int]($S.EndDateTime - $Now).TotalDays
        Write-Skip "  '$($S.DisplayName)' - gueltig bis $($S.EndDateTime.ToString('dd.MM.yyyy')) (noch $DaysLeft Tage)"
    }
    Write-Warn "Kein neues Secret erstellt. Secret-Wert ist nicht abrufbar."
    Write-Warn "Verwende -ForceNewSecret um ein neues Secret zu erstellen."
    Write-Warn "Oder trage das vorhandene Secret manuell in die AppConfig ein."
} else {
    if ($ForceNewSecret) {
        Write-Add "ForceNewSecret: Erstelle neues Secret..."
    } elseif ($ExistingSecrets.Count -gt 0) {
        Write-Warn "Alle Secrets abgelaufen oder laufen bald ab - erstelle neues..."
    } else {
        Write-Add "Kein Secret vorhanden - erstelle neues..."
    }

    $SecretName   = "enthus-inventory-$(Get-Date -Format 'yyyy-MM')"
    $SecretExpiry = $Now.AddMonths($SecretExpiryMonths)

    $SecretResult = Add-MgApplicationPassword -ApplicationId $App.Id -PasswordCredential @{
        DisplayName = $SecretName
        EndDateTime = $SecretExpiry
    }
    $ClientSecret = $SecretResult.SecretText

    Write-OK "Secret '$SecretName' erstellt (gueltig bis: $($SecretExpiry.ToString('dd.MM.yyyy')))"
    Write-Host ""
    Write-Host "  ┌──────────────────────────────────────────────────────────────┐" -ForegroundColor Yellow
    Write-Host "  │  ⚠ Client Secret - nur EINMAL sichtbar - jetzt sichern!     │" -ForegroundColor Red
    Write-Host "  │                                                              │" -ForegroundColor Yellow
    Write-Host "  │  $ClientSecret" -ForegroundColor Yellow
    Write-Host "  │                                                              │" -ForegroundColor Yellow
    Write-Host "  └──────────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
}

# ── Tenant-Domain ermitteln ────────────────────────────────────────────────────
$TenantDomain = ''
try {
    $OrgInfo = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/organization?`$select=verifiedDomains" -EA SilentlyContinue
    $InitD = $OrgInfo.value[0].verifiedDomains | Where-Object { $_.isInitial -eq $true } | Select-Object -First 1
    if ($InitD) { $TenantDomain = $InitD.name }
} catch {}

# ── AppConfig schreiben ────────────────────────────────────────────────────────
Write-Step "Schreibe AppConfig-JSON..."

$TenantCfgPath = Join-Path $ScriptDir "M365-Inventory-AppConfig-$TenantId.json"

# Bestehende Config laden um Secret nicht zu ueberschreiben falls kein neues erstellt wurde
$ExistingCfg = $null
if (Test-Path $TenantCfgPath) {
    try { $ExistingCfg = Get-Content $TenantCfgPath -Raw | ConvertFrom-Json } catch {}
}

$AppConfig = [ordered]@{
    AppName         = $AppName
    ClientId        = $App.AppId
    TenantId        = $TenantId
    TenantDomain    = $TenantDomain
    CloudEnvironment= ''
    CreatedAt       = if ($IsNew) { (Get-Date -Format 'yyyy-MM-dd HH:mm') } else { $ExistingCfg.CreatedAt }
    UpdatedAt       = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    SetupBy         = $Ctx.Account
    SecretExpiry    = if ($ClientSecret) { $SecretExpiry.ToString('yyyy-MM-dd') } else { $ExistingCfg.SecretExpiry }
    # Secret: Neues Secret speichern, oder vorhandenes aus Config beibehalten
    ClientSecret    = if ($ClientSecret) { $ClientSecret } else { $ExistingCfg.ClientSecret }
}

$AppConfig | ConvertTo-Json | Set-Content -Path $TenantCfgPath -Encoding UTF8

# Default-Config (ohne Secret)
$DefaultCfgPath = Join-Path $ScriptDir "M365-Inventory-AppConfig.json"
[ordered]@{
    AppName      = $AppName
    ClientId     = $App.AppId
    TenantId     = $TenantId
    TenantDomain = $TenantDomain
    UpdatedAt    = (Get-Date -Format 'yyyy-MM-dd HH:mm')
} | ConvertTo-Json | Set-Content -Path $DefaultCfgPath -Encoding UTF8

Write-OK "AppConfig: $TenantCfgPath"

# ── Rollen fuer den eingeloggten Admin-Account pruefen / zuweisen ──────────────
Write-Step "Pruefe Entra-Rollen fuer $($Ctx.Account)..."

# Rollen die fuer M365-Inventory benoetigt werden
$RequiredRoles = @(
    @{ Name = 'Global Reader';            TemplateId = 'f2ef992c-3afb-46b9-b7cf-a126ee74c451' }
    @{ Name = 'SharePoint Administrator'; TemplateId = 'f28a1f50-f6e7-4571-818b-6a12f2af6b6c' }
)

# Aktuell eingeloggten User-Objekt laden
$CurrentUser = $null
try {
    $Me = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/me?`$select=id,displayName,userPrincipalName" -EA Stop
    $CurrentUser = [PSCustomObject]@{ Id = $Me.id; DisplayName = $Me.displayName; UPN = $Me.userPrincipalName }
    Write-Skip "Account: $($CurrentUser.DisplayName) ($($CurrentUser.UPN))"
} catch {
    Write-Warn "Aktuellen User nicht ermittelbar (App-only Context?) - Rollenzuweisung uebersprungen."
}

# ── SharePoint Administrator Rolle auch dem Service Principal (App) zuweisen ──
# Bei App-only Auth (Client Secret) laeuft PnP als die App, nicht als User.
# Die App braucht die Rolle direkt als Service Principal.
Write-Step "Pruefe SharePoint Administrator Rolle fuer App (Service Principal)..."
$SPAdminTemplateId = 'f28a1f50-f6e7-4571-818b-6a12f2af6b6c'
try {
    $SPAdminRole = Get-MgDirectoryRole -Filter "roleTemplateId eq '$SPAdminTemplateId'" -ErrorAction SilentlyContinue
    if (-not $SPAdminRole) {
        $SPAdminRole = New-MgDirectoryRole -RoleTemplateId $SPAdminTemplateId -ErrorAction Stop
        Write-Add "SharePoint Administrator Rolle im Tenant aktiviert."
    }
    $AppAlreadyMember = Get-MgDirectoryRoleMember -DirectoryRoleId $SPAdminRole.Id -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -eq $AppSP.Id }
    if ($AppAlreadyMember) {
        Write-Skip "App-SP hat SharePoint Administrator Rolle bereits."
    } else {
        New-MgDirectoryRoleMemberByRef -DirectoryRoleId $SPAdminRole.Id `
            -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($AppSP.Id)" } `
            -ErrorAction Stop
        Write-Add "SharePoint Administrator Rolle der App (Service Principal) zugewiesen."
    }
} catch {
    $EMsg = $_.Exception.Message
    if ($EMsg -like '*already exists*' -or $EMsg -like '*already present*') {
        Write-Skip "App-SP hat SharePoint Administrator Rolle bereits."
    } else {
        Write-Warn "Rollenzuweisung fuer App-SP fehlgeschlagen: $($EMsg.Split([char]10)[0])"
    }
}

# ── Exchange Administrator Rolle dem Service Principal (App) zuweisen ─────────
# Exchange.ManageAsApp benoetigt zusaetzlich eine Entra-Admin-Rolle auf dem SP.
# Ohne Rolle: AADSTS650057 "Invalid resource" bei Connect-ExchangeOnline -AppId.
# Minimum: Exchange Administrator (nicht Global Admin noetig).
Write-Step "Pruefe Exchange Administrator Rolle fuer App (Service Principal)..."
$ExoAdminTemplateId = '29232cdf-9323-42fd-ade2-1d097af3e4de'  # Exchange Administrator
try {
    $ExoAdminRole = Get-MgDirectoryRole -Filter "roleTemplateId eq '$ExoAdminTemplateId'" -ErrorAction SilentlyContinue
    if (-not $ExoAdminRole) {
        $ExoAdminRole = New-MgDirectoryRole -RoleTemplateId $ExoAdminTemplateId -ErrorAction Stop
        Write-Add "Exchange Administrator Rolle im Tenant aktiviert."
    }
    $AppEXOMember = Get-MgDirectoryRoleMember -DirectoryRoleId $ExoAdminRole.Id -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -eq $AppSP.Id }
    if ($AppEXOMember) {
        Write-Skip "App-SP hat Exchange Administrator Rolle bereits."
    } else {
        New-MgDirectoryRoleMemberByRef -DirectoryRoleId $ExoAdminRole.Id `
            -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($AppSP.Id)" } `
            -ErrorAction Stop
        Write-Add "Exchange Administrator Rolle der App (Service Principal) zugewiesen."
    }
} catch {
    $EMsg = $_.Exception.Message
    if ($EMsg -like '*already exists*' -or $EMsg -like '*already present*') {
        Write-Skip "App-SP hat Exchange Administrator Rolle bereits."
    } else {
        Write-Warn "Exchange-Rollenzuweisung fuer App-SP fehlgeschlagen: $($EMsg.Split([char]10)[0])"
    }
}

if ($CurrentUser) {
    foreach ($Role in $RequiredRoles) {
        # Rollendefinition laden
        $RoleDef = Get-MgDirectoryRoleTemplate -DirectoryRoleTemplateId $Role.TemplateId -ErrorAction SilentlyContinue
        if (-not $RoleDef) {
            Write-Warn "Rollendefinition nicht gefunden: $($Role.Name)"
            continue
        }

        # Pruefe ob Rolle bereits im Tenant aktiviert ist (muss aktiviert sein bevor man zuweisen kann)
        $ActiveRole = Get-MgDirectoryRole -Filter "roleTemplateId eq '$($Role.TemplateId)'" -ErrorAction SilentlyContinue
        if (-not $ActiveRole) {
            # Rolle im Tenant aktivieren
            try {
                $ActiveRole = New-MgDirectoryRole -RoleTemplateId $Role.TemplateId -ErrorAction Stop
                Write-Add "Rolle '$($Role.Name)' im Tenant aktiviert."
            } catch {
                Write-Warn "Rolle '$($Role.Name)' konnte nicht aktiviert werden: $($_.Exception.Message.Split([char]10)[0])"
                continue
            }
        }

        # Pruefe ob User die Rolle bereits hat
        $ExistingMember = Get-MgDirectoryRoleMember -DirectoryRoleId $ActiveRole.Id -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -eq $CurrentUser.Id }

        if ($ExistingMember) {
            Write-Skip "'$($Role.Name)' bereits zugewiesen."
        } else {
            try {
                New-MgDirectoryRoleMemberByRef -DirectoryRoleId $ActiveRole.Id `
                    -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($CurrentUser.Id)" } `
                    -ErrorAction Stop
                Write-Add "'$($Role.Name)' zugewiesen."
            } catch {
                $EMsg = $_.Exception.Message
                if ($EMsg -like '*already exists*' -or $EMsg -like '*already present*') {
                    Write-Skip "'$($Role.Name)' bereits zugewiesen (Race-Condition ignoriert)."
                } else {
                    Write-Warn "'$($Role.Name)' konnte nicht zugewiesen werden: $($EMsg.Split([char]10)[0])"
                    Write-Warn "Manuell zuweisen: Entra Portal > Rollen > $($Role.Name) > Zuweisungen hinzufuegen"
                }
            }
        }
    }
}

# ── Disconnect ─────────────────────────────────────────────────────────────────
Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
Stop-Transcript | Out-Null

# ── Zusammenfassung ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   ✓ Setup abgeschlossen                                     ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Status   : $(if ($IsNew) {'Neu angelegt'} else {'Aktualisiert (nur Aenderungen)'})" -ForegroundColor White
Write-Host "║  App-ID   : $($App.AppId)" -ForegroundColor White
Write-Host "║  Permissions: $($RequiredRoleIds.Count) Graph + $($RequiredSharePointRoleIds.Count) SharePoint + $($RequiredExchangeRoleIds.Count) Exchange" -ForegroundColor White
Write-Host "║  Rollen   : Global Reader + SharePoint Administrator + Exchange Administrator" -ForegroundColor White
Write-Host "║  Log      : $([System.IO.Path]::GetFileName($LogPath))" -ForegroundColor White
Write-Host "╠══════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  M365-Inventory.ps1 starten:                                ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

if ($ClientSecret) {
    Write-Host "  .\M365-Inventory.ps1 ``" -ForegroundColor Cyan
    Write-Host "    -ClientId     `"$($App.AppId)`" ``" -ForegroundColor Cyan
    Write-Host "    -TenantId     `"$TenantId`" ``" -ForegroundColor Cyan
    Write-Host "    -ClientSecret `"$ClientSecret`"" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Oder direkt (Secret in AppConfig gespeichert):" -ForegroundColor DarkGray
    Write-Host "  .\M365-Inventory.ps1" -ForegroundColor Cyan
} else {
    Write-Host "  Secret nicht neu erstellt - trage vorhandenes Secret ein:" -ForegroundColor Yellow
    Write-Host "  .\M365-Inventory.ps1 ``" -ForegroundColor Cyan
    Write-Host "    -ClientId     `"$($App.AppId)`" ``" -ForegroundColor Cyan
    Write-Host "    -TenantId     `"$TenantId`" ``" -ForegroundColor Cyan
    Write-Host "    -ClientSecret `"<vorhandenes-secret>`"" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Neues Secret erzwingen:" -ForegroundColor DarkGray
    Write-Host "  .\M365-Setup-AppRegistration.ps1 -TenantId `"$TenantId`" -ForceNewSecret" -ForegroundColor DarkGray
}
Write-Host ""
