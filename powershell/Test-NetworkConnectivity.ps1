<#
.SYNOPSIS
    Testet Netzwerkkonnektivität zu einer Liste von Hosts und Ports.

.DESCRIPTION
    Führt Ping- und Port-Tests für eine definierbare Zielliste durch.
    Nützlich für schnelle Netzwerkdiagnose, VPN-Checks oder
    Server-Erreichbarkeitstests nach Änderungen.
    Ergebnis: farbige Konsolenausgabe + optionaler CSV-Export.

.PARAMETER Targets
    Hashtable mit Hostname => Port-Array. Oder Standard-Targets verwenden.

.PARAMETER ExportCSV
    Pfad für CSV-Export. Optional.

.EXAMPLE
    .\Test-NetworkConnectivity.ps1
    .\Test-NetworkConnectivity.ps1 -ExportCSV "C:\netzwerk-check.csv"

.NOTES
    Autor: AdminSheet
    Version: 1.0
    Benötigt: PowerShell 5.1+, keine Admin-Rechte
#>

param(
    [string]$ExportCSV = ""
)

# Ziele anpassen:
$targets = @{
    "8.8.8.8"          = @(53)
    "1.1.1.1"          = @(53)
    "google.com"       = @(80, 443)
    "github.com"       = @(443)
    # Interne Beispiele – anpassen:
    # "dc01.firma.local" = @(389, 445, 3389)
    # "fileserver"       = @(445)
}

$results = @()
$total = 0; $ok = 0

Write-Host "`n Netzwerk-Konnektivitätstest – $(Get-Date -Format 'dd.MM.yyyy HH:mm')" -ForegroundColor Cyan
Write-Host ("-" * 65)

foreach ($host in $targets.Keys | Sort-Object) {
    # Ping
    $ping = Test-Connection -ComputerName $host -Count 1 -Quiet -ErrorAction SilentlyContinue
    $pingMs = if ($ping) {
        (Test-Connection -ComputerName $host -Count 1 -ErrorAction SilentlyContinue).ResponseTime
    } else { $null }

    $pingStatus = if ($ping) { "OK ($pingMs ms)" } else { "FAIL" }
    $pingColor  = if ($ping) { "Green" } else { "Red" }
    Write-Host "`nPing  $host" -NoNewline
    Write-Host "  $pingStatus" -ForegroundColor $pingColor

    $results += [PSCustomObject]@{
        Host   = $host
        Test   = "Ping"
        Port   = "-"
        Status = if ($ping) { "OK" } else { "FAIL" }
        Detail = $pingStatus
        Zeit   = Get-Date -Format "HH:mm:ss"
    }
    $total++; if ($ping) { $ok++ }

    # Port-Tests
    foreach ($port in $targets[$host]) {
        $total++
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $conn = $tcp.BeginConnect($host, $port, $null, $null)
            $wait = $conn.AsyncWaitHandle.WaitOne(1500, $false)
            if ($wait -and -not $tcp.Client.Connected) { throw }
            $tcp.EndConnect($conn)
            $tcp.Close()
            Write-Host "  Port $port" -NoNewline
            Write-Host "  OPEN" -ForegroundColor Green
            $results += [PSCustomObject]@{ Host=$host; Test="TCP"; Port=$port; Status="OPEN"; Detail="Verbindung OK"; Zeit=Get-Date -Format "HH:mm:ss" }
            $ok++
        } catch {
            Write-Host "  Port $port" -NoNewline
            Write-Host "  CLOSED/TIMEOUT" -ForegroundColor Red
            $results += [PSCustomObject]@{ Host=$host; Test="TCP"; Port=$port; Status="FAIL"; Detail="Keine Verbindung"; Zeit=Get-Date -Format "HH:mm:ss" }
        }
    }
}

Write-Host "`n$("-" * 65)"
Write-Host "Ergebnis: $ok/$total Tests erfolgreich" -ForegroundColor $(if ($ok -eq $total) { "Green" } else { "Yellow" })

if ($ExportCSV) {
    $results | Export-Csv -Path $ExportCSV -Encoding UTF8 -NoTypeInformation
    Write-Host "Exportiert: $ExportCSV" -ForegroundColor Green
}
