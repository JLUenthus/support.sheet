# ============================================================
# Set-PowerPlan-Win11.ps1
# Führe als Administrator aus!
# ============================================================

# --- 1) Höchstleistungs-Profil aktivieren ---
$highPerfGuid = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"

powercfg -duplicatescheme $highPerfGuid 2>&1 | Out-Null
powercfg -setactive $highPerfGuid
Write-Host "[OK] Energieprofil: Höchstleistung aktiviert" -ForegroundColor Green


# --- 2) Standby-Zeiten anpassen  ---
powercfg -change -standby-timeout-ac 30
powercfg -change -standby-timeout-dc 30
Write-Host "[OK] Standby-Timeout: 30 Minuten (AC + DC)" -ForegroundColor Green


# --- 3) VPN bleibt im Standby bestehen ---
$netSubGuid    = "19cbb8fa-5279-450e-9fac-8a3d5fedd0c1"
$netSettingOn  = "12bbebe6-58d6-4636-95bb-3217ef867c1a"

powercfg -setacvalueindex $highPerfGuid $netSubGuid $netSettingOn 0
powercfg -setdcvalueindex $highPerfGuid $netSubGuid $netSettingOn 0

Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" `
  -Name HiberbootEnabled -Value 0 -Type DWord
Write-Host "[OK] Netzwerk im Standby: aktiv bleiben" -ForegroundColor Green
Write-Host "[OK] Schnellstart: deaktiviert" -ForegroundColor Green


# --- 4) Netzwerkadapter: Power-Management im Gerätemanager ---
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
        Write-Host "[OK] Adapter '$($adapter.Name)': Energiesparmodus deaktiviert" -ForegroundColor Green
    } catch {
        Write-Host "[!] Adapter '$($adapter.Name)': Kein WMI-Eintrag (übersprungen)" -ForegroundColor Yellow
    }
}

# --- 4b) Wake-on-LAN deaktivieren ---
Get-NetAdapter | ForEach-Object {
    Disable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket -WakeOnPattern -EA SilentlyContinue
    Write-Host "[OK] Wake-on-LAN deaktiviert: $($_.Name)" -ForegroundColor Green
}

# --- 5) Änderungen sofort übernehmen ---
powercfg -setactive $highPerfGuid
Write-Host "
[FERTIG] Energieprofil gesetzt und aktiv." -ForegroundColor Cyan
Write-Host "Bitte einmal neu starten, um alle Adapter-Einstellungen zu übernehmen."