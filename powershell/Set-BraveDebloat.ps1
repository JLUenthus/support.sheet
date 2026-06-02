#Requires -Version 3.0
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Brave Browser – Debloat & Enterprise Hardening

.DESCRIPTION
    Deaktiviert Brave Rewards, Leo AI, Crypto Wallet, VPN, Tor und Telemetrie
    per Windows Registry (HKLM Policies). Wirkt fuer alle Benutzer auf dem System.
    Ideal fuer verwaltete Arbeitsplaetze, MSP-Deployments und Terminalserver.

.NOTES
    - Muss als Administrator ausgefuehrt werden
    - Aenderungen gelten nach Browser-Neustart
    - Kein Brave-Update ueberschreibt Policy-Einstellungen
    - Rueckgaengig machen: Registry-Schluessel loeschen
      Remove-Item -Path "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave" -Recurse -Force

.USAGE
    .\Set-BraveDebloat.ps1
    .\Set-BraveDebloat.ps1 -WhatIf        # Vorschau ohne Aenderungen
    .\Set-BraveDebloat.ps1 -Rollback      # Alle Policy-Eintraege entfernen
#>

param(
    [switch]$WhatIf,
    [switch]$Rollback
)

$RegistryPath = "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave"

# ── Rollback ──────────────────────────────────────────────────
if ($Rollback) {
    if (Test-Path $RegistryPath) {
        Remove-Item -Path $RegistryPath -Recurse -Force
        Write-Host "Alle Brave-Policies entfernt. Brave-Neustart erforderlich." -ForegroundColor Green
    } else {
        Write-Host "Keine Brave-Policies gefunden – nichts zu entfernen." -ForegroundColor Yellow
    }
    exit 0
}

# ── Policy-Eintraege ──────────────────────────────────────────
$Policies = @(
    # Brave-spezifische Features deaktivieren
    @{ Name = "BraveRewardsDisabled";                    Value = 1; Desc = "Brave Rewards (BAT-Krypto)" },
    @{ Name = "BraveWalletDisabled";                     Value = 1; Desc = "Crypto Wallet" },
    @{ Name = "BraveVPNDisabled";                        Value = 1; Desc = "Brave VPN" },
    @{ Name = "BraveAIChatEnabled";                      Value = 0; Desc = "Leo AI Chat" },
    @{ Name = "BraveNewsDisabled";                       Value = 1; Desc = "Brave News Feed" },
    @{ Name = "BraveTalkDisabled";                       Value = 1; Desc = "Brave Talk (Video)" },
    @{ Name = "TorDisabled";                             Value = 1; Desc = "Tor Private Window" },

    # Telemetrie und Datensammlung
    @{ Name = "BraveStatsPingEnabled";                   Value = 0; Desc = "Nutzungsstatistiken" },
    @{ Name = "BraveP3AEnabled";                         Value = 0; Desc = "P3A Produktanalyse" },
    @{ Name = "UrlKeyedAnonymizedDataCollectionEnabled"; Value = 0; Desc = "URL-basierte Datensammlung" },
    @{ Name = "MetricsReportingEnabled";                 Value = 0; Desc = "Metriken-Reporting" },

    # Safe Browsing Extended Reporting (sendet URLs an Google)
    @{ Name = "SafeBrowsingExtendedReportingEnabled";    Value = 0; Desc = "Safe Browsing Extended Reporting" }
)

# ── WhatIf-Modus ──────────────────────────────────────────────
if ($WhatIf) {
    Write-Host ""
    Write-Host "  [VORSCHAU] Folgende Aenderungen wuerden vorgenommen:" -ForegroundColor Yellow
    Write-Host "  Registry-Pfad: $RegistryPath" -ForegroundColor DarkGray
    Write-Host ""
    $Policies | ForEach-Object {
        $action = if ($_.Value -eq 1) { "Deaktiviert" } else { "Aktiviert (auf 0)" }
        Write-Host "  [$action] $($_.Desc)" -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "  Ausfuehren ohne -WhatIf um Aenderungen anzuwenden." -ForegroundColor DarkGray
    exit 0
}

# ── Registry-Schluessel anlegen falls nicht vorhanden ─────────
if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
    Write-Host "Registry-Pfad erstellt: $RegistryPath" -ForegroundColor DarkGray
}

# ── Policies setzen ───────────────────────────────────────────
Write-Host ""
Write-Host "  Brave Debloat & Hardening" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""

$Success = 0
$Failed  = 0

foreach ($Policy in $Policies) {
    try {
        Set-ItemProperty -Path $RegistryPath -Name $Policy.Name -Value $Policy.Value -Type DWord -Force
        $status = if ($Policy.Value -eq 1) { "deaktiviert" } else { "blockiert" }
        Write-Host "  [OK] $($Policy.Desc) $status" -ForegroundColor Green
        $Success++
    }
    catch {
        Write-Host "  [FAIL] $($Policy.Name): $_" -ForegroundColor Red
        $Failed++
    }
}

# ── Zusammenfassung ───────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "  $Success Eintraege gesetzt, $Failed Fehler." -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "  Brave-Browser neu starten damit Aenderungen wirksam werden." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Rueckgaengig machen:" -ForegroundColor DarkGray
Write-Host "    .\Set-BraveDebloat.ps1 -Rollback" -ForegroundColor DarkGray
Write-Host ""
