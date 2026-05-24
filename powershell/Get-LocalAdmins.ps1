<#
.SYNOPSIS
    Listet alle lokalen Administratoren auf einem oder mehreren Computern auf.

.DESCRIPTION
    Liest die lokale Administratoren-Gruppe aus und gibt alle Mitglieder
    mit Typ (Benutzer/Gruppe), Domäne und Herkunft aus.
    Unterstützt Einzelrechner, Computerlisten und Remote-Abfragen.

.PARAMETER ComputerName
    Ein oder mehrere Computernamen. Standard: lokaler Rechner.

.PARAMETER ExportCSV
    Pfad für CSV-Export. Optional.

.EXAMPLE
    .\Get-LocalAdmins.ps1
    .\Get-LocalAdmins.ps1 -ComputerName "PC01","PC02","SERVER01"
    .\Get-LocalAdmins.ps1 -ComputerName (Get-Content C:\computers.txt) -ExportCSV C:\admins.csv

.NOTES
    Autor: AdminSheet
    Version: 1.0
    Benötigt: Admin-Rechte für Remote-Abfragen, WinRM für Remote-Computer
#>

param(
    [string[]]$ComputerName = $env:COMPUTERNAME,
    [string]$ExportCSV = ""
)

$results = @()

foreach ($computer in $ComputerName) {
    Write-Host "Abfrage: $computer" -ForegroundColor Cyan
    try {
        $members = Invoke-Command -ComputerName $computer -ScriptBlock {
            $group = [ADSI]"WinNT://$env:COMPUTERNAME/Administratoren,group"
            # Fallback englisch
            if (-not $group.Path) {
                $group = [ADSI]"WinNT://$env:COMPUTERNAME/Administrators,group"
            }
            $group.Members() | ForEach-Object {
                $path = $_.GetType().InvokeMember("ADsPath", "GetProperty", $null, $_, $null)
                $name = $_.GetType().InvokeMember("Name",    "GetProperty", $null, $_, $null)
                $cls  = $_.GetType().InvokeMember("Class",   "GetProperty", $null, $_, $null)
                [PSCustomObject]@{
                    Name   = $name
                    Type   = $cls
                    Source = $path
                }
            }
        } -ErrorAction Stop

        foreach ($m in $members) {
            $results += [PSCustomObject]@{
                Computer = $computer
                Name     = $m.Name
                Type     = $m.Type
                Source   = $m.Source
            }
            $color = if ($m.Type -eq "Group") { "Yellow" } else { "White" }
            Write-Host "  [$($m.Type.PadRight(5))] $($m.Name)  ($($m.Source))" -ForegroundColor $color
        }
    } catch {
        Write-Warning "Fehler bei $computer`: $_"
        $results += [PSCustomObject]@{
            Computer = $computer
            Name     = "FEHLER"
            Type     = "-"
            Source   = $_.Exception.Message
        }
    }
}

Write-Host "`nGesamt: $($results.Count) Einträge auf $($ComputerName.Count) Computer(n)" -ForegroundColor Green

if ($ExportCSV) {
    $results | Export-Csv -Path $ExportCSV -Encoding UTF8 -NoTypeInformation
    Write-Host "Exportiert nach: $ExportCSV" -ForegroundColor Green
}

$results | Format-Table -AutoSize
