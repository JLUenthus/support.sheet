<#
.SYNOPSIS
    Listet alle installierten Programme auf und exportiert sie als CSV oder HTML.

.DESCRIPTION
    Liest installierte Software aus der Registry (32- und 64-Bit) aus.
    Kann lokal oder remote ausgeführt werden.
    Filterbar nach Name oder Hersteller.
    Hilfreich für Lizenz-Audits, Software-Inventar und Compliance-Checks.

.PARAMETER ComputerName
    Zielcomputer. Standard: lokaler Rechner.

.PARAMETER Filter
    Filtert nach Name oder Hersteller (Wildcard-Suche).

.PARAMETER ExportCSV
    Pfad für CSV-Export.

.PARAMETER ExportHTML
    Pfad für HTML-Export.

.EXAMPLE
    .\Get-InstalledSoftware.ps1
    .\Get-InstalledSoftware.ps1 -Filter "Microsoft*"
    .\Get-InstalledSoftware.ps1 -ComputerName "PC01" -ExportCSV "C:\software.csv"
    .\Get-InstalledSoftware.ps1 -ExportHTML "$env:USERPROFILE\Desktop\software.html"

.NOTES
    Autor: AdminSheet
    Version: 1.0
    Benötigt: PowerShell 5.1+, Admin für Remote-Abfragen
#>

param(
    [string[]]$ComputerName = $env:COMPUTERNAME,
    [string]$Filter = "*",
    [string]$ExportCSV = "",
    [string]$ExportHTML = ""
)

$regPaths = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

$allResults = @()

foreach ($computer in $ComputerName) {
    Write-Host "Abfrage: $computer" -ForegroundColor Cyan

    $software = Invoke-Command -ComputerName $computer -ScriptBlock {
        param($paths, $filter)
        Get-ItemProperty $paths -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -and ($_.DisplayName -like $filter -or $_.Publisher -like $filter) } |
            Select-Object DisplayName, DisplayVersion, Publisher,
                @{N="InstallDatum";E={$_.InstallDate}},
                @{N="Größe_MB";E={if($_.EstimatedSize){[math]::Round($_.EstimatedSize/1024,1)}else{"-"}}}
    } -ArgumentList $regPaths, $Filter -ErrorAction SilentlyContinue |
        Sort-Object DisplayName

    foreach ($s in $software) {
        $allResults += [PSCustomObject]@{
            Computer    = $computer
            Name        = $s.DisplayName
            Version     = $s.DisplayVersion
            Hersteller  = $s.Publisher
            Installiert = $s.InstallDatum
            Groesse_MB  = $s.Größe_MB
        }
    }
    Write-Host "  $($software.Count) Programme gefunden" -ForegroundColor Green
}

# Ausgabe Konsole
$allResults | Format-Table -AutoSize

Write-Host "`nGesamt: $($allResults.Count) Programme" -ForegroundColor Cyan

# CSV Export
if ($ExportCSV) {
    $allResults | Export-Csv -Path $ExportCSV -Encoding UTF8 -NoTypeInformation
    Write-Host "CSV gespeichert: $ExportCSV" -ForegroundColor Green
}

# HTML Export
if ($ExportHTML) {
    $rows = $allResults | ForEach-Object {
        "<tr><td>$($_.Computer)</td><td>$($_.Name)</td><td>$($_.Version)</td><td>$($_.Hersteller)</td><td>$($_.Installiert)</td><td>$($_.Groesse_MB)</td></tr>"
    }
    $html = @"
<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Software Inventar</title>
<style>body{font-family:Segoe UI,sans-serif;background:#0f1117;color:#e0e4f0;padding:24px;}
h1{color:#7c8cf8;}table{width:100%;border-collapse:collapse;}
th{background:#1a1d2e;color:#7c8cf8;padding:8px;text-align:left;font-size:12px;}
td{padding:6px 8px;border-bottom:1px solid #2a2d3e;font-size:12px;}
tr:hover td{background:#21253a;}
input{background:#1a1d2e;border:1px solid #2a2d3e;color:#e0e4f0;padding:8px 12px;border-radius:6px;margin-bottom:16px;width:300px;}
</style></head><body>
<h1>📦 Software Inventar – $(Get-Date -Format 'dd.MM.yyyy HH:mm')</h1>
<input type="text" id="search" placeholder="Suchen..." oninput="filter()">
<table id="tbl"><tr><th>Computer</th><th>Name</th><th>Version</th><th>Hersteller</th><th>Installiert</th><th>Größe MB</th></tr>
$($rows -join "`n")</table>
<script>function filter(){var v=document.getElementById('search').value.toLowerCase();document.querySelectorAll('#tbl tr:not(:first-child)').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(v)?'':'none';});}</script>
</body></html>
"@
    $html | Out-File -FilePath $ExportHTML -Encoding UTF8
    Write-Host "HTML gespeichert: $ExportHTML" -ForegroundColor Green
    Start-Process $ExportHTML
}
