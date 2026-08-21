#Requires -Version 5.1
<#
.SYNOPSIS
    GPO-Sammelscript fuer den support.sheet GPO Analyzer.
.DESCRIPTION
    Erzeugt einen moeglichst vollstaendigen Snapshot aller GPOs der aktuellen
    Domaene (Inventar, Einstellungen, Links, Security Filtering, WMI-Filter,
    Block Inheritance) sowie eine reine Rohdaten-/DC-Evidenz-Sammlung der
    Computerobjekte (computers.json, fuer kuenftige BSI-Scope-Coverage) und
    verpackt alles als ZIP zum Hochladen auf gpo.html.
.NOTES
    Autor: support.sheet | Version: 1.1
    Benoetigt: PowerShell 5.1+, RSAT-Module GroupPolicy und ActiveDirectory
    Ausfuehrung: auf einem Domain Controller oder einem domaenen-verbundenen
    Client mit installierten RSAT-Tools. Keine Admin-Rechte noetig, nur
    Leserechte auf GPOs/AD.
#>

$ScriptVersion = '1.1'

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   support.sheet - GPO Analyzer Snapshot Collector    " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ── Modul-Check (frueh und klar melden) ─────────────────────
$missingModules = @(@('GroupPolicy', 'ActiveDirectory') | Where-Object { -not (Get-Module -ListAvailable -Name $_) })
if ($missingModules.Count -gt 0) {
    Write-Host "  FEHLER: Benoetigte PowerShell-Module fehlen: $($missingModules -join ', ')" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Dieses Script braucht die RSAT-Tools fuer Gruppenrichtlinien" -ForegroundColor Yellow
    Write-Host "  und Active Directory (fuer OUs, WMI-Filter und Sites)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Auf einem Client (Windows 10/11):" -ForegroundColor Gray
    Write-Host "  Einstellungen > Optionale Features > RSAT: Gruppenrichtlinienverwaltungs-Tools" -ForegroundColor Gray
    Write-Host "  Einstellungen > Optionale Features > RSAT: Active Directory-Modul fuer PowerShell" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Auf einem Domain Controller sind beide Module normalerweise bereits vorhanden." -ForegroundColor Gray
    Write-Host ""
    exit 1
}

try {
    Import-Module GroupPolicy -ErrorAction Stop
    Import-Module ActiveDirectory -ErrorAction Stop
} catch {
    Write-Host "  FEHLER: Module konnten nicht geladen werden: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

try {
    $domain = Get-ADDomain -ErrorAction Stop
} catch {
    Write-Host "  FEHLER: Keine Verbindung zu einer Active-Directory-Domaene moeglich." -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Gray
    exit 1
}

Write-Host "  Umgebung: $($domain.DNSRoot)" -ForegroundColor Gray
Write-Host "  Domain:    $($domain.DNSRoot)" -ForegroundColor Gray
Write-Host ""

# ── Hilfsfunktionen: JSON-Ausgabe ────────────────────────────
# ConvertTo-Json kollabiert ein einzelnes Array-Element beim Pipen zu einem
# reinen Objekt (kein Array mehr) und ein leeres Array zu gar keiner Ausgabe.
# Der fruehere "Komma-Operator vor dem Pipe"-Workaround ((, $Items) |
# ConvertTo-Json) hat sich in echten Windows-PowerShell-5.1-Laeufen
# (Domain Controller) als selbst fehlerhaft erwiesen: statt eines sauberen
# JSON-Arrays [ ... ] wurde teils {"value": [ ... ]} erzeugt, was der
# Browser-seitige JSON.parse() zurecht ablehnt. Deshalb hier stattdessen
# jedes Element EINZELN mit -Compress serialisiert und das Array manuell
# per String-Join gebaut - das umgeht ConvertTo-Json's Pipeline-/Anzahl-
# abhaengiges Verhalten komplett, unabhaengig von PS-Version/-Edition.
# Ausserdem: [System.IO.File]::WriteAllText statt Out-File -Encoding UTF8,
# da Out-File in Windows PowerShell 5.1 (Desktop Edition) immer eine
# UTF-8-BOM schreibt, die JSON.parse() beim Einlesen ebenfalls als
# ungueltiges Zeichen ablehnt.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-JsonArray {
    param([object[]]$Items, [Parameter(Mandatory)][string]$Path, [int]$Depth = 12)
    if ($null -eq $Items) { $Items = @() }
    if ($Items.Count -eq 0) {
        $json = '[]'
    } else {
        $itemsJson = $Items | ForEach-Object { $_ | ConvertTo-Json -Depth $Depth -Compress }
        $json = '[' + ($itemsJson -join ',') + ']'
    }
    [System.IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
}

function Write-JsonObject {
    param($Data, [Parameter(Mandatory)][string]$Path, [int]$Depth = 12)
    $json = $Data | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
}

function Normalize-Guid {
    param([string]$Value)
    if (-not $Value) { return $null }
    return ($Value -replace '[{}]', '').ToUpperInvariant()
}

# ── Hilfsfunktionen: GPO-Report-XML parsen ──────────────────
# Die Namespace-Praefixe im GPO-Report-XML (q1, q2, ...) sind nicht stabil
# ueber Windows-/GPMC-Versionen hinweg. XPath mit local-name() umgeht das
# Problem, ohne einen XmlNamespaceManager pflegen zu muessen.

# Kategorie-Verschachtelung ist je nach GPMC-Version leicht unterschiedlich
# (verschachtelte <Category><Name>.../Category> oder ein flaches
# <Category>Text</Category>). Beide Formen werden abgedeckt.
#
# Bugfix (real-data-verifiziert an echter Get-GPOReport-XML, siehe
# edge-base-report.xml/edge-chromium-report.xml): der urspruengliche
# Flach-Text-Check "$current.ChildNodes.Count -eq 0" war falsch - ein
# Element mit reinem Textinhalt (z.B. <Category>Microsoft Edge-Update/
# Anwendungen/Microsoft Edge</Category>) hat trotzdem genau 1 Kind-Knoten
# (den Text-Knoten selbst), ChildNodes.Count ist dort also 1, nicht 0. Die
# Bedingung griff dadurch nie, jede flache Category wurde stillschweigend
# zu $null - mit der Folge, dass mehrere fachlich unterschiedliche
# Policies mit gleichem Namen (z.B. "Installation zulassen" fuer
# verschiedene Microsoft-Edge-Kanaele) im normalisierten Modell identisch
# aussahen. Korrigiert: prueft auf Abwesenheit von Kind-ELEMENTEN
# (SelectSingleNode("*")), nicht auf Abwesenheit jeglicher Kind-Knoten.
function Get-CategoryPath {
    param([System.Xml.XmlNode]$PolicyNode)
    $current = $PolicyNode.SelectSingleNode("*[local-name()='Category']")
    if (-not $current) { return $null }

    $names = New-Object System.Collections.Generic.List[string]
    while ($current) {
        $nameNode = $current.SelectSingleNode("*[local-name()='Name']")
        if ($nameNode -and $nameNode.InnerText) {
            $names.Add($nameNode.InnerText)
        } elseif ($current.InnerText -and -not $current.SelectSingleNode("*")) {
            $names.Add($current.InnerText)
        }
        $current = $current.SelectSingleNode("*[local-name()='Category']")
    }
    if ($names.Count -eq 0) { return $null }
    return ($names -join ' > ')
}

# Best-effort Wert-Extraktion: liefert eine stabile Textdarstellung der
# Policy-Parameter (Dropdown/Text/Boolean/Decimal/...), keine vollstaendige
# semantische Auswertung. Reicht fuer Gleichheits-/Konfliktvergleiche im
# Analyzer, was der eigentliche Zweck ist.
function Get-PolicyValueSummary {
    param([System.Xml.XmlNode]$PolicyNode)
    $ignoreNames = @('Name', 'State', 'Category', 'Explain', 'Supported', 'Precedence')
    $parts = New-Object System.Collections.Generic.List[string]

    function Walk-ValueNode {
        param([System.Xml.XmlNode]$Node)
        foreach ($child in $Node.ChildNodes) {
            if ($child.NodeType -ne 'Element') { continue }
            if ($ignoreNames -contains $child.LocalName) { continue }

            $childElements = @($child.ChildNodes | Where-Object { $_.NodeType -eq 'Element' })
            if ($childElements.Count -gt 0) {
                $nameNode = $child.SelectSingleNode("*[local-name()='Name']")
                $valueNode = $child.SelectSingleNode("*[local-name()='Value']")
                if (-not $valueNode) { $valueNode = $child.SelectSingleNode("*[local-name()='State']") }
                if ($nameNode -and $valueNode) {
                    $parts.Add("$($nameNode.InnerText)=$($valueNode.InnerText)")
                } else {
                    Walk-ValueNode -Node $child
                }
            } elseif ($child.InnerText) {
                $parts.Add("$($child.LocalName)=$($child.InnerText)")
            }
        }
    }

    Walk-ValueNode -Node $PolicyNode
    return ($parts -join '; ')
}

function Get-AdmTmplSettings {
    param([System.Xml.XmlNode]$ScopeNode, [string]$Scope)
    $results = @()
    $policyNodes = @($ScopeNode.SelectNodes(".//*[local-name()='Policy']"))
    foreach ($p in $policyNodes) {
        $nameNode = $p.SelectSingleNode("*[local-name()='Name']")
        $stateNode = $p.SelectSingleNode("*[local-name()='State']")
        if (-not $nameNode -or -not $stateNode) { continue }
        $results += [ordered]@{
            scope    = $Scope
            category = Get-CategoryPath -PolicyNode $p
            name     = $nameNode.InnerText
            state    = $stateNode.InnerText
            value    = Get-PolicyValueSummary -PolicyNode $p
        }
    }
    return $results
}

# Account-Richtlinie (Kennwort-/Sperrrichtlinie) liegt als eigener Knoten
# direkt unter Computer\ExtensionData\Extension, nicht als Policy-Element.
function Get-AccountPolicySettings {
    param([System.Xml.XmlNode]$ComputerNode)
    $results = @()
    $accountNodes = @($ComputerNode.SelectNodes(".//*[local-name()='Account']"))
    foreach ($acct in $accountNodes) {
        foreach ($child in $acct.ChildNodes) {
            if ($child.NodeType -ne 'Element') { continue }
            $results += [ordered]@{
                scope    = 'Computer'
                category = 'Security Settings > Account Policies'
                name     = $child.LocalName
                state    = 'Configured'
                value    = $child.InnerText
            }
        }
    }
    return $results
}

# Verifizierte SystemAccessPolicyName -> deutscher Anzeigename-Zuordnung.
# <SecurityOptions>-Knoten ohne <Display>/<KeyName> (System-Access-Policy-
# Knoten, z.B. Kontosperr-/Anmeldezeit-bezogene Einstellungen) trugen
# vorher immer den generischen Namen "Unbekannte Security Option", obwohl
# ihr <SystemAccessPolicyName> ein fester, dokumentierter Schema-Bezeichner
# ist (real-data-verifiziert an einem echten Default-Domain-Policy-Report
# einer Kundenumgebung).
# Nur EXPLIZIT gegen oeffentliche Microsoft-Quellen verifizierte Eintraege
# hier aufnehmen (siehe Quellenangaben je Eintrag) - keine geratenen
# Uebersetzungen. Fachliche Bedeutung bestaetigt durch [MS-GPSB] (offizielle
# Protokoll-/Schema-Dokumentation der System-Access-Policy-Schluessel),
# exakter deutscher Anzeigename bestaetigt durch die deutschsprachige
# LocalPoliciesSecurityOptions-Policy-CSP-Dokumentation von Microsoft.
$SystemAccessPolicyDisplayNames = @{
    # Quelle 1 (fachliche Bedeutung): [MS-GPSB] "Account Lockout Policies" -
    # https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-gpsb/2cd39c97-97cd-4859-a7b4-1229dad5f53d
    # "This setting controls whether SMB client sessions with the SMB
    # server will be forcibly disconnected when the client's logon hours
    # expire."
    # Quelle 2 (exakter deutscher Anzeigename): Microsoft Learn,
    # LocalPoliciesSecurityOptions-Richtlinien-CSP (de-de) -
    # https://learn.microsoft.com/de-de/windows/client-management/mdm/policy-csp-localpoliciessecurityoptions
    # "MicrosoftNetworkServer_DisconnectClientsWhenLogonHoursExpire" ->
    # "Clients nach Ablauf der Anmeldezeiten trennen"
    'ForceLogoffWhenHourExpire' = 'Microsoft-Netzwerkserver: Clients nach Ablauf der Anmeldezeiten trennen'
    # Quelle 1 (fachliche Bedeutung): [MS-GPSB] "Local Account Policies" -
    # https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-gpsb/d6eaa54a-f609-48e9-8461-b32738d77a47
    # "When enabled, this setting allows an anonymous user to query the
    # local LSA policy."
    # Quelle 2 (exakter deutscher Anzeigename): Microsoft Learn,
    # LocalPoliciesSecurityOptions-Richtlinien-CSP (de-de),
    # "NetworkAccess_AllowAnonymousSIDOrNameTranslation" ->
    # "Netzwerkzugriff: Anonyme SID-/Namensübersetzung zulassen"
    'LSAAnonymousNameLookup' = 'Netzwerkzugriff: Anonyme SID-/Namensübersetzung zulassen'
}

function Get-SecurityOptionsSettings {
    param([System.Xml.XmlNode]$ComputerNode)
    $results = @()
    $optionNodes = @($ComputerNode.SelectNodes(".//*[local-name()='SecurityOptions']"))
    foreach ($opt in $optionNodes) {
        $displayNameNode = $opt.SelectSingleNode("*[local-name()='Display']/*[local-name()='Name']")
        $keyNameNode = $opt.SelectSingleNode("*[local-name()='KeyName']")
        $sysAccessNode = $opt.SelectSingleNode("*[local-name()='SystemAccessPolicyName']")
        $name = if ($displayNameNode) {
            $displayNameNode.InnerText
        } elseif ($keyNameNode) {
            $keyNameNode.InnerText
        } elseif ($sysAccessNode) {
            # Rohschluessel darf nie verloren gehen: bei fehlender
            # verifizierter Zuordnung faellt der Rohschluessel selbst in
            # den generischen Namen, statt stillschweigend zu "Unbekannte
            # Security Option" ohne jede Spur zu werden.
            $rawKey = $sysAccessNode.InnerText
            if ($SystemAccessPolicyDisplayNames.Contains($rawKey)) { $SystemAccessPolicyDisplayNames[$rawKey] } else { "Unbekannte Security Option ($rawKey)" }
        } else {
            'Unbekannte Security Option'
        }

        $valueNode = $opt.SelectSingleNode("*[local-name()='SettingNumber']")
        if (-not $valueNode) { $valueNode = $opt.SelectSingleNode("*[local-name()='SettingBoolean']") }
        if (-not $valueNode) { $valueNode = $opt.SelectSingleNode("*[local-name()='SettingString']") }

        $results += [ordered]@{
            scope    = 'Computer'
            category = 'Security Settings > Security Options'
            name     = $name
            state    = 'Configured'
            value    = if ($valueNode) { $valueNode.InnerText } else { $null }
        }
    }
    return $results
}

function Get-UserRightsSettings {
    param([System.Xml.XmlNode]$ComputerNode)
    $results = @()
    $rightNodes = @($ComputerNode.SelectNodes(".//*[local-name()='UserRightsAssignment']"))
    foreach ($right in $rightNodes) {
        $nameNode = $right.SelectSingleNode("*[local-name()='Name']")
        $members = @($right.SelectNodes("*[local-name()='Member']/*[local-name()='Name']") | ForEach-Object { $_.InnerText })
        $results += [ordered]@{
            scope    = 'Computer'
            category = 'Security Settings > User Rights Assignment'
            name     = if ($nameNode) { $nameNode.InnerText } else { 'Unbekanntes Recht' }
            state    = 'Configured'
            value    = ($members -join ', ')
        }
    }
    return $results
}

# Computer- und User-Scope werden absichtlich in getrennten try/catch-
# Bloecken gelesen: schlaegt nur einer der beiden Scopes fehl (z.B.
# beschaedigtes XML-Fragment in einer Kategorie), bleibt der andere Scope
# trotzdem nutzbar, statt den kompletten Report wegzuwerfen. $Warnings
# sammelt scope-bezogene Fehler und macht dem Aufrufer die Unterscheidung
# complete (keine Warnings) / partial (einzelne Scopes fehlgeschlagen)
# moeglich - der Report insgesamt gilt nur als "failed", wenn das XML
# selbst nicht mal geparst werden konnte (siehe Aufrufer unten).
function ConvertFrom-GpoReportXml {
    param([Parameter(Mandatory)][string]$Xml, [ref]$Warnings)
    $doc = [xml]$Xml
    $settings = @()

    $computerNode = $doc.SelectSingleNode("//*[local-name()='Computer']")
    $userNode = $doc.SelectSingleNode("//*[local-name()='User']")

    if ($computerNode) {
        try {
            $settings += Get-AdmTmplSettings -ScopeNode $computerNode -Scope 'Computer'
            $settings += Get-AccountPolicySettings -ComputerNode $computerNode
            $settings += Get-SecurityOptionsSettings -ComputerNode $computerNode
            $settings += Get-UserRightsSettings -ComputerNode $computerNode
        } catch {
            $Warnings.Value += "Computer Configuration konnte nicht vollstaendig gelesen werden: $($_.Exception.Message)"
        }
    }
    if ($userNode) {
        try {
            $settings += Get-AdmTmplSettings -ScopeNode $userNode -Scope 'User'
        } catch {
            $Warnings.Value += "User Configuration konnte nicht vollstaendig gelesen werden: $($_.Exception.Message)"
        }
    }
    return $settings
}

# WMI-Filter-Query steckt kodiert in msWMI-Parm2, pro Klausel im Format
# <len(lang)>;<len(namespace)>;<len(query)>;<lang>;<namespace>;<query>;
# vorangestellt durch <Anzahl Klauseln>;. Bestaetigt an echten AD-Rohdaten
# einer Kundenumgebung (Filter "Win 10"):
#   1;3;10;84;WQL;root\CIMv2;select * from Win32_OperatingSystem where
#   Version like "10.0.2%" and ProductType="1";
# Die vorherige Version dieser Funktion nahm faelschlich einen festen
# 4-Feld-Versatz pro Klausel an und extrahierte dadurch Index 4 ("WQL",
# die Sprachkennung) statt der eigentlichen Query ab Index 6 - alle vier
# WMI-Filter im echten 82-GPO-Snapshot zeigten dadurch identisch "WQL"
# statt eines echten Query-Texts.
# Die Laengenfelder sind die einzig verlaessliche Grenze fuer <query> - ein
# reines Split-by-";" wuerde eine Query mit eingebetteten Semikolons an der
# falschen Stelle abschneiden. Deshalb wird ab der ersten Klausel
# zeichenweise anhand der Laengenangaben durchlaufen statt blind zu
# splitten; nur der fuehrende "<Anzahl>;" wird per einzelnem IndexOf
# gelesen. Best effort - bei mehreren ANDed Klauseln werden die
# Query-Texte weiterhin verkettet.
function Get-WmiFilterQueryText {
    param([string]$Raw)
    if (-not $Raw) { return $null }
    try {
        $firstSemi = $Raw.IndexOf(';')
        if ($firstSemi -lt 0) { return $null }
        $count = [int]$Raw.Substring(0, $firstSemi)
        $pos = $firstSemi + 1
        $queries = New-Object System.Collections.Generic.List[string]

        for ($i = 0; $i -lt $count; $i++) {
            $langSemi = $Raw.IndexOf(';', $pos)
            if ($langSemi -lt 0) { break }
            $langLen = [int]$Raw.Substring($pos, $langSemi - $pos)
            $pos = $langSemi + 1

            $nsSemi = $Raw.IndexOf(';', $pos)
            if ($nsSemi -lt 0) { break }
            $nsLen = [int]$Raw.Substring($pos, $nsSemi - $pos)
            $pos = $nsSemi + 1

            $querySemi = $Raw.IndexOf(';', $pos)
            if ($querySemi -lt 0) { break }
            $queryLen = [int]$Raw.Substring($pos, $querySemi - $pos)
            $pos = $querySemi + 1

            # <lang> und <namespace> ueberspringen (je Laenge + trennendes ";")
            $pos += $langLen + 1
            $pos += $nsLen + 1

            if ($pos + $queryLen -gt $Raw.Length) { break }
            $query = $Raw.Substring($pos, $queryLen)
            $pos += $queryLen
            if ($pos -lt $Raw.Length -and $Raw[$pos] -eq ';') {
                $query += ';'
                $pos += 1
            }
            if ($query) { $queries.Add($query) }
        }

        if ($queries.Count -eq 0) { return $null }
        return ($queries -join ' AND ')
    } catch {
        return $null
    }
}

# ── 1) GPO-Inventar + Einstellungen ─────────────────────────
Write-Host "[1] GPOs sammeln ..." -ForegroundColor Yellow
$allGpos = @(Get-GPO -All -Domain $domain.DNSRoot -ErrorAction Stop)
Write-Host "  $($allGpos.Count) GPOs gefunden." -ForegroundColor Gray

$gpoRecords = @()
$skippedGpos = @()

foreach ($gpo in $allGpos) {
    $wmiFilterId = $null
    if ($gpo.WmiFilter -and $gpo.WmiFilter.Path -match 'ID="(\{[0-9A-Fa-f-]+\})"') {
        $wmiFilterId = Normalize-Guid -Value $matches[1]
    }

    # reportError bleibt nur gesetzt, wenn der Report insgesamt nicht lesbar
    # war (Get-GPOReport-Aufruf schlaegt fehl oder das zurueckgegebene XML
    # laesst sich nicht mal parsen) - das ist der einzige echte "failed"-
    # Fall. Schlaegt nur ein einzelner Scope (Computer/User) innerhalb eines
    # ansonsten lesbaren Reports fehl, bleibt reportError leer und der
    # Report gilt als "partial" (parseWarnings traegt den Grund) - der
    # jeweils andere Scope bleibt nutzbar statt komplett verworfen zu werden.
    $settings = @()
    $reportError = $null
    $parseWarnings = @()
    try {
        $reportXml = Get-GPOReport -Guid $gpo.Id -ReportType Xml -Domain $domain.DNSRoot -ErrorAction Stop
    } catch {
        $reportError = $_.Exception.Message
    }

    if (-not $reportError) {
        try {
            $warningsRef = [ref]@()
            $settings = @(ConvertFrom-GpoReportXml -Xml $reportXml -Warnings $warningsRef)
            $parseWarnings = @($warningsRef.Value)
        } catch {
            # XML selbst nicht parsebar (z.B. abgeschnittener/beschaedigter
            # Report) - das betrifft beide Scopes gleichermassen, damit
            # zaehlt das als komplett fehlgeschlagen, nicht nur "partial".
            $reportError = "GPO-Report-XML konnte nicht geparst werden: $($_.Exception.Message)"
        }
    }

    $parseStatus = if ($reportError) { 'failed' } elseif ($parseWarnings.Count -gt 0) { 'partial' } else { 'complete' }

    if ($reportError) {
        $skippedGpos += [ordered]@{
            id    = $gpo.Id.Guid
            name  = $gpo.DisplayName
            error = $reportError
        }
    }

    $gpoRecords += [ordered]@{
        id                    = $gpo.Id.Guid
        name                  = $gpo.DisplayName
        status                = $gpo.GpoStatus.ToString()
        created               = $gpo.CreationTime.ToString('yyyy-MM-ddTHH:mm:ss')
        modified              = $gpo.ModificationTime.ToString('yyyy-MM-ddTHH:mm:ss')
        computerConfigEnabled = [bool]$gpo.Computer.Enabled
        userConfigEnabled     = [bool]$gpo.User.Enabled
        wmiFilterId           = $wmiFilterId
        settings              = $settings
        reportError           = $reportError
        parseStatus           = $parseStatus
        parseWarnings         = $parseWarnings
    }
}

if ($skippedGpos.Count -gt 0) {
    Write-Host "  $($skippedGpos.Count) GPO(s) ohne lesbaren Report (siehe Zusammenfassung am Ende)." -ForegroundColor Yellow
}

# ── 2) Security Filtering ───────────────────────────────────
Write-Host "[2] Security Filtering sammeln ..." -ForegroundColor Yellow
$filterRecords = @()
foreach ($gpo in $allGpos) {
    try {
        $perms = @(Get-GPPermission -Guid $gpo.Id -All -ErrorAction Stop)
    } catch {
        continue
    }
    $applyPerms = @($perms | Where-Object { $_.Permission -eq 'GpoApply' })
    foreach ($perm in $applyPerms) {
        $filterRecords += [ordered]@{
            gpoId      = $gpo.Id.Guid
            trustee    = $perm.Trustee.Name
            trusteeSid = if ($perm.Trustee.Sid) { $perm.Trustee.Sid.Value } else { $null }
            permission = $perm.Permission.ToString()
        }
    }
}

# ── 3) WMI-Filter-Katalog ────────────────────────────────────
Write-Host "[3] WMI-Filter sammeln ..." -ForegroundColor Yellow
$wmiFilterRecords = @()
try {
    $somObjects = @(Get-ADObject -Filter "objectClass -eq 'msWMI-Som'" -Properties 'msWMI-Name', 'msWMI-ID', 'msWMI-Parm2' -ErrorAction Stop)
    foreach ($som in $somObjects) {
        $filterId = Normalize-Guid -Value $som.'msWMI-ID'
        $linkedGpoIds = @($gpoRecords | Where-Object { $_.wmiFilterId -and $_.wmiFilterId -eq $filterId } | ForEach-Object { $_.id })
        $wmiFilterRecords += [ordered]@{
            id           = $filterId
            name         = $som.'msWMI-Name'
            query        = Get-WmiFilterQueryText -Raw $som.'msWMI-Parm2'
            linkedGpoIds = $linkedGpoIds
        }
    }
} catch {
    Write-Host "  WMI-Filter konnten nicht gelesen werden: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ── 4) Links + Block Inheritance (Domain/OU rekursiv, Sites separat) ──
Write-Host "[4] Links und Block Inheritance sammeln ..." -ForegroundColor Yellow
$linkRecords = @()

function Add-LinkRecordFromInheritance {
    param([string]$Target, [string]$TargetType, $Inheritance)
    $script:linkRecords += [ordered]@{
        target           = $Target
        targetType       = $TargetType
        blockInheritance = [bool]$Inheritance.GpoInheritanceBlocked
        gpoLinks         = @($Inheritance.GpoLinks | ForEach-Object {
                [ordered]@{
                    gpoId       = $_.GpoId.Guid
                    order       = $_.Order
                    enforced    = [bool]$_.Enforced
                    linkEnabled = [bool]$_.Enabled
                }
            })
    }
}

try {
    $domainInheritance = Get-GPInheritance -Target $domain.DistinguishedName -ErrorAction Stop
    Add-LinkRecordFromInheritance -Target $domain.DistinguishedName -TargetType 'Domain' -Inheritance $domainInheritance
} catch {
    Write-Host "  Domain-Verknuepfungen konnten nicht gelesen werden: $($_.Exception.Message)" -ForegroundColor Yellow
}

$ous = @(Get-ADOrganizationalUnit -Filter * -Properties DistinguishedName -ErrorAction Stop)
foreach ($ou in $ous) {
    try {
        $inheritance = Get-GPInheritance -Target $ou.DistinguishedName -ErrorAction Stop
        Add-LinkRecordFromInheritance -Target $ou.DistinguishedName -TargetType 'OU' -Inheritance $inheritance
    } catch {
        Write-Host "  Verknuepfungen fuer $($ou.DistinguishedName) konnten nicht gelesen werden: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Get-GPInheritance kennt nur Domain/OU. Site-Verknuepfungen stecken im
# gPLink-Attribut des Site-Objekts in der Configuration-Partition und
# muessen manuell geparst werden: "[LDAP://cn={GUID},...;<Flag>]" je Link,
# Flag-Bit 0 = deaktiviert, Bit 1 = enforced. Fehlt der Zugriff auf die
# Configuration-Partition, wird dieser Teil ohne Abbruch uebersprungen.
try {
    $configNC = (Get-ADRootDSE -ErrorAction Stop).ConfigurationNamingContext
    $sites = @(Get-ADObject -SearchBase $configNC -Filter "objectClass -eq 'site'" -Properties 'gPLink', 'distinguishedName' -ErrorAction Stop)
    foreach ($site in $sites) {
        if (-not $site.gPLink) { continue }
        $siteLinkMatches = [regex]::Matches($site.gPLink, '\[LDAP://cn=(\{[0-9A-Fa-f-]+\}),cn=policies,cn=system,[^;]+;(\d+)\]')
        $siteLinks = @()
        $order = 1
        foreach ($m in $siteLinkMatches) {
            $flag = [int]$m.Groups[2].Value
            $siteLinks += [ordered]@{
                gpoId       = Normalize-Guid -Value $m.Groups[1].Value
                order       = $order
                enforced    = (($flag -band 2) -ne 0)
                linkEnabled = (($flag -band 1) -eq 0)
            }
            $order++
        }
        $linkRecords += [ordered]@{
            target           = $site.DistinguishedName
            targetType       = 'Site'
            blockInheritance = $false
            gpoLinks         = $siteLinks
        }
    }
} catch {
    Write-Host "  Site-Verknuepfungen konnten nicht gelesen werden: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ── 5) Computerobjekte (Rohdaten + Domain-Controller-Evidenz) ──
# Reine Rohdaten- und Struktur-Evidenz-Sammlung fuer eine kuenftige BSI-
# Scope-Coverage (Domain Controller/Member Server/Client/Unknown, siehe
# V3.2.1/V3.2.1.1/V3.2.2-Analysen) - KEINE semantische Rollen-
# klassifikation hier. isDomainController/isReadOnlyDomainController sind
# reine Struktursignale (Get-ADDomainController-Cross-Reference ueber
# ComputerObjectDN, keine Namens-/OU-Heuristik) und deshalb bereits jetzt
# sicher bestimmbar. Die OS-string-basierte Member-Server-/Client-/
# Unknown-Unterscheidung braucht dagegen eine konservative, Unknown-
# tolerante Bewertungslogik mit echtem Beurteilungsspielraum - das ist
# keine reine Datentransformation mehr und gehoert deshalb bewusst NICHT
# in dieses rein rohdatenerfassende Collector-Skript (separater,
# nachgelagerter Schritt).
Write-Host "[5] Computerobjekte sammeln ..." -ForegroundColor Yellow
$computerRecords = @()
$SERVER_TRUST_ACCOUNT = 0x2000
try {
    $adComputers = @(Get-ADComputer -Filter * -Properties DistinguishedName, OperatingSystem, OperatingSystemVersion, Enabled, userAccountControl -ErrorAction Stop)

    # Get-ADDomainController ist fuer die DC-Rollenzuordnung massgeblich
    # (siehe Auftrag) - ComputerObjectDN verknuepft das DC-Objekt direkt und
    # eindeutig mit dem zugehoerigen Computerobjekt, ganz ohne Namensabgleich.
    $dcInfoByDn = @{}
    try {
        $dcRecords = @(Get-ADDomainController -Filter * -ErrorAction Stop)
        foreach ($dc in $dcRecords) {
            if ($dc.ComputerObjectDN) {
                $dcInfoByDn[$dc.ComputerObjectDN.ToLowerInvariant()] = [bool]$dc.IsReadOnly
            }
        }
    } catch {
        Write-Host "  Domain-Controller-Evidenz (Get-ADDomainController) konnte nicht gelesen werden: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  isDomainController bleibt fuer alle Computerobjekte 'false' - keine Namens-/OU-Ersatzheuristik." -ForegroundColor Yellow
    }

    foreach ($comp in $adComputers) {
        $dn = $comp.DistinguishedName
        $dnKey = if ($dn) { $dn.ToLowerInvariant() } else { $null }
        $isDc = [bool]($dnKey -and $dcInfoByDn.ContainsKey($dnKey))
        $isRodc = [bool]($isDc -and $dcInfoByDn[$dnKey])

        # userAccountControl (SERVER_TRUST_ACCOUNT) ist nur eine
        # Gegenprobe, niemals massgeblich. Eine Abweichung wird transparent
        # gemeldet statt stillschweigend aufgeloest oder ignoriert zu
        # werden (Datenqualitaets-/Evidenzproblem, kein Rateergebnis).
        $hasServerTrustBit = (([int64]$comp.userAccountControl) -band $SERVER_TRUST_ACCOUNT) -ne 0
        if ($hasServerTrustBit -ne $isDc) {
            Write-Host "  Datenqualitaets-Hinweis: userAccountControl (SERVER_TRUST_ACCOUNT) und Get-ADDomainController stimmen fuer '$dn' nicht ueberein - Get-ADDomainController bleibt massgeblich." -ForegroundColor Yellow
        }

        $computerRecords += [ordered]@{
            distinguishedName          = $dn
            operatingSystem            = $comp.OperatingSystem
            operatingSystemVersion     = $comp.OperatingSystemVersion
            enabled                    = [bool]$comp.Enabled
            isDomainController         = $isDc
            isReadOnlyDomainController = $isRodc
        }
    }
} catch {
    Write-Host "  Computerobjekte konnten nicht gelesen werden (fehlende Berechtigung oder Fehler): $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  computers.json wird als leeres Array geschrieben - Computer-basierte Scope-Klassifikation ist fuer diesen Snapshot nicht verfuegbar." -ForegroundColor Yellow
}

# ── 6) Metadaten ─────────────────────────────────────────────
$collectedAt = Get-Date
$forest = $null
try { $forest = Get-ADForest -ErrorAction Stop } catch { $forest = $null }

$metadata = [ordered]@{
    # Umgebung: bewusst aus AD-Metadaten, nicht aus Kundendaten/Policy-Inhalten.
    environmentName  = $domain.DNSRoot
    domain           = $domain.DNSRoot
    domainNetBIOS    = $domain.NetBIOSName
    forest           = if ($forest) { $forest.Name } else { $null }
    collectedAt      = $collectedAt.ToString('yyyy-MM-ddTHH:mm:ss')
    collectedBy      = "$env:USERDOMAIN\$env:USERNAME"
    computerName     = $env:COMPUTERNAME
    gpoCount         = $gpoRecords.Count
    ouCount          = $ous.Count
    collectorVersion = $ScriptVersion
    skippedGpos      = $skippedGpos
}

# ── Verpacken ────────────────────────────────────────────────
Write-Host ""
Write-Host "[6] Snapshot verpacken ..." -ForegroundColor Yellow

$dateStamp = Get-Date -Format 'yyyy-MM-dd'
$outputRoot = 'C:\Temp'
if (-not (Test-Path $outputRoot)) {
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
}

$workDir = Join-Path $outputRoot "gpo-snapshot-$dateStamp-work"
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

Write-JsonArray -Items $gpoRecords -Path (Join-Path $workDir 'gpos.json')
Write-JsonArray -Items $linkRecords -Path (Join-Path $workDir 'links.json')
Write-JsonArray -Items $filterRecords -Path (Join-Path $workDir 'filters.json')
Write-JsonArray -Items $wmiFilterRecords -Path (Join-Path $workDir 'wmi-filters.json')
Write-JsonArray -Items $computerRecords -Path (Join-Path $workDir 'computers.json')
Write-JsonObject -Data $metadata -Path (Join-Path $workDir 'metadata.json')

$zipPath = Join-Path $outputRoot "gpo-snapshot-$dateStamp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $workDir '*') -DestinationPath $zipPath -Force
Remove-Item $workDir -Recurse -Force

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "              Sammlung abgeschlossen                  " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  GPOs:               $($gpoRecords.Count)" -ForegroundColor White
Write-Host "  OUs:                $($ous.Count)" -ForegroundColor White
Write-Host "  Links (Ziele):      $($linkRecords.Count)" -ForegroundColor White
Write-Host "  Security Filter:    $($filterRecords.Count)" -ForegroundColor White
Write-Host "  WMI-Filter:         $($wmiFilterRecords.Count)" -ForegroundColor White
Write-Host "  Computerobjekte:    $($computerRecords.Count)" -ForegroundColor White
if ($skippedGpos.Count -gt 0) {
    Write-Host ""
    Write-Host "  Uebersprungene GPOs (Report nicht lesbar):" -ForegroundColor Yellow
    foreach ($s in $skippedGpos) {
        Write-Host "    - $($s.name) [$($s.id)]: $($s.error)" -ForegroundColor Yellow
    }
}
Write-Host ""
Write-Host "  Datei gespeichert unter:" -ForegroundColor Green
Write-Host "  $zipPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Jetzt auf support.sheet hochladen (gpo.html)." -ForegroundColor Gray
Write-Host ""

Start-Process explorer.exe -ArgumentList "/select,`"$zipPath`""
