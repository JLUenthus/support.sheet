#Requires -Version 5.1
<#
.SYNOPSIS
    Datenträger-Analyse mit Oberfläche: zeigt, wo der Speicherplatz geblieben ist, und räumt nur nach ausdrücklicher Auswahl auf.
.DESCRIPTION
    Zeigt in einem Fenster (wie TreeSize) die größten Ordner, Dateien und Dateitypen eines Laufwerks oder Ordners,
    listet bekannte Aufräumziele (Temp, Absturzabbilder, Browser-Caches usw.) mit Größen und löscht nur, was der
    Nutzer ausdrücklich auswählt und bestätigt. Nichts wird hochgeladen, nichts läuft automatisch.

    Läuft mit und ohne Administratorrechte (ohne: eingeschränkter Umfang, Systemziele sind dann ausgegraut).
    Es gibt keine Installation, keine Netzwerkzugriffe, keine Änderungen an Registry, Diensten oder Einstellungen.
    Das Skript liest und löscht nur Dateien nach Auswahl und schreibt ein Protokoll.

    Was das Skript NIE löscht: Laufwerks-Stämme, Windows, Programme, Benutzerprofile und deren Dokumente,
    Desktop, Bilder, Videos, Musik, Downloads, OneDrive-Stämme, Windows.old, Komponentenspeicher (WinSxS),
    Schattenkopien, hiberfil.sys, Auslagerungsdatei. Diese werden höchstens mit Größe und Hinweis angezeigt.
    Verknüpfungen (Junctions, Symlinks, Cloud-Platzhalter) werden nie verfolgt und nie gezählt.

    Größen sind logische Dateigrößen (wie im Explorer unter "Größe", nicht "Größe auf Datenträger"). Hardlinks
    (Komponentenspeicher) lassen sich nicht exakt erfassen: Die Summen können dort vom belegten Platz abweichen.
.PARAMETER Path
    Zu analysierender Laufwerks-Stamm oder Ordner. Standard: das Systemlaufwerk.
.PARAMETER NoGui
    Kein Fenster: schreibt eine Textübersicht (nur lesend), für Sitzungen ohne Desktop.
.PARAMETER Top
    Anzahl der Einträge je Abschnitt im Konsolenbericht. Standard: 30.
.PARAMETER ExportHtml
    Schreibt den Bericht als HTML-Datei (ohne Fenster). Der Bericht enthält Pfade und Benutzernamen und gehört nicht in öffentliche Tickets.
.PARAMETER LogPath
    Ordner für die Löschprotokolle. Standard: %LOCALAPPDATA%\DiskAnalyzer\logs
.PARAMETER SelfTest
    Baut das Fenster, scannt den mit -Path angegebenen Ordner und prüft die Oberfläche, ohne etwas zu löschen. Ohne Desktop: "nicht geprüft".
.PARAMETER ExtraCleanupRoot
    Zusätzliche Aufräumziele (Ordner). Die Schutzprüfung gilt auch hier. Vor allem für Tests.
.PARAMETER SkipSystemTargets
    Misst und zeigt nur die mit -ExtraCleanupRoot angegebenen Ziele (Tests).
.PARAMETER SkipHintSizes
    Ermittelt die Größen der reinen Hinweis-Einträge nicht (WinSxS, Windows.old dauern lange).
.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Disk-Analyzer-GUI.ps1
    Startet das Fenster für das Systemlaufwerk.
.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Disk-Analyzer-GUI.ps1 -NoGui -Path D:\ -Top 20
    Textübersicht für D:\ in der Konsole, nur lesend.
.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Disk-Analyzer-GUI.ps1 -ExportHtml C:\Temp\bericht.html
    Schreibt einen HTML-Bericht, ohne ein Fenster zu öffnen.
.NOTES
    Autor: support.sheet | Version: 1.0
    Benötigt: Windows PowerShell 5.1 oder neuer, Desktop für die Oberfläche. Administratorrechte sind optional
    (für Systemziele nötig). Kein Netzwerk, keine Installation.
#>
[CmdletBinding()]
param(
    [string]$Path,
    [switch]$NoGui,
    [int]$Top = 30,
    [string]$ExportHtml,
    [string]$LogPath,
    [switch]$SelfTest,
    [string[]]$ExtraCleanupRoot = @(),
    [switch]$SkipSystemTargets,
    [switch]$SkipHintSizes
)

$ScriptVersion = '1.0'
$script:IsDotSourced = ($MyInvocation.InvocationName -eq '.')
$script:ScriptPath = $PSCommandPath
$script:ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$script:LogDir = $null
$script:De = [System.Globalization.CultureInfo]::GetCultureInfo('de-DE')
$script:ExitCode = 0

# ============================================================
# Allgemeine Hilfen
# ============================================================
function Test-IsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -lt 0) { $Bytes = 0 }
    $units = 'Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'
    $i = 0; $v = $Bytes
    while ($v -ge 1024 -and $i -lt ($units.Count - 1)) { $v = $v / 1024; $i++ }
    if ($i -eq 0) { return ([string]([long]$v)) + ' Bytes' }
    return $v.ToString('N1', $script:De) + ' ' + $units[$i]
}

function Format-Percent {
    param([double]$Part, [double]$Whole)
    if ($Whole -le 0) { return '0 %' }
    return (($Part / $Whole) * 100).ToString('N1', $script:De) + ' %'
}

# Langer Pfad: \\?\ vor Laufwerks- und UNC-Pfade (hebt die Grenze von 260 Zeichen auf)
function ConvertTo-LongPath {
    param([string]$P)
    if ($P.StartsWith('\\?\')) { return $P }
    if ($P.StartsWith('\\')) { return '\\?\UNC\' + $P.Substring(2) }
    if ($P.Length -ge 2 -and $P[1] -eq ':') { return '\\?\' + $P }
    return $P
}

function ConvertFrom-LongPath {
    param([string]$P)
    if ($P.StartsWith('\\?\UNC\')) { return '\\' + $P.Substring(8) }
    if ($P.StartsWith('\\?\')) { return $P.Substring(4) }
    return $P
}

# 8.3-Kurznamen (z. B. C:\Users\JAN-LU~1) durch die langen Namen ersetzen, damit Vergleiche stimmen
function Expand-ShortPath {
    param([string]$Full)
    if ($Full.IndexOf('~') -lt 0) { return $Full }
    $root = [System.IO.Path]::GetPathRoot($Full)
    $rest = $Full.Substring($root.Length)
    $cur = $root
    foreach ($seg in ($rest -split '\\')) {
        if ($seg -eq '') { continue }
        $name = $seg
        if ($seg.IndexOf('~') -ge 0 -and [System.IO.Directory]::Exists($cur)) {
            try {
                $m = [System.IO.Directory]::GetFileSystemEntries($cur, $seg)
                if ($m.Count -eq 1) { $name = [System.IO.Path]::GetFileName($m[0]) }
            } catch { }
        }
        $cur = [System.IO.Path]::Combine($cur, $name)
    }
    return $cur
}

function Get-NormalizedPath {
    param([string]$P)
    $p2 = ConvertFrom-LongPath $P
    $p2 = [System.IO.Path]::GetFullPath($p2)
    $p2 = Expand-ShortPath $p2
    $root = [System.IO.Path]::GetPathRoot($p2)
    if ($p2.Length -gt $root.Length) { $p2 = $p2.TrimEnd('\') }
    return $p2
}

function Get-LogFolder {
    param([string]$Requested)
    $dir = $Requested
    if ([string]::IsNullOrWhiteSpace($dir)) { $dir = Join-Path $env:LOCALAPPDATA 'DiskAnalyzer\logs' }
    return $dir
}

function Get-DriveText {
    param([string]$Root)
    try {
        $d = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot((Get-NormalizedPath $Root)))
        $used = $d.TotalSize - $d.AvailableFreeSpace
        return [pscustomobject]@{ Name = $d.Name; Total = $d.TotalSize; Free = $d.AvailableFreeSpace; Used = $used; Label = $d.VolumeLabel; Format = $d.DriveFormat }
    } catch { return $null }
}

# ============================================================
# Schutzprüfung vor jedem Löschen
# ============================================================
# Context: Manual (frei gewählte Elemente: Stämme, Windows, Programme und die Bereiche unter Windows/Programme sind tabu),
#          CleanupRoot (ein Aufräumziel selbst: nur Stämme und Verknüpfungen werden abgelehnt),
#          CleanupItem (Element eines Aufräumziels: muss streng unterhalb eines Ziels liegen).
function Get-ProtectedPathSets {
    $exact = New-Object 'System.Collections.Generic.List[object]'
    $trees = New-Object 'System.Collections.Generic.List[object]'
    $sysDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }
    $usersDir = $sysDrive + '\Users'
    $add = {
        param($list, $p, $why)
        if ([string]::IsNullOrWhiteSpace($p)) { return }
        try { $list.Add(@{ Path = (Get-NormalizedPath $p); Why = $why }) } catch { }
    }
    & $add $exact $env:windir 'Windows-Ordner'
    & $add $exact $env:ProgramFiles 'Program Files'
    & $add $exact ${env:ProgramFiles(x86)} 'Program Files (x86)'
    & $add $exact $env:ProgramW6432 'Program Files'
    & $add $exact $env:ProgramData 'ProgramData'
    & $add $exact $usersDir 'Ordner Users'
    & $add $exact $env:USERPROFILE 'Benutzerprofil'
    & $add $exact $env:APPDATA 'AppData (Roaming)'
    & $add $exact $env:LOCALAPPDATA 'AppData (Local)'
    foreach ($v in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) { & $add $exact $v 'OneDrive-Stamm' }
    foreach ($f in 'Desktop', 'MyDocuments', 'MyPictures', 'MyVideos', 'MyMusic', 'Favorites') {
        try { & $add $exact ([Environment]::GetFolderPath($f)) 'Benutzerordner' } catch { }
    }
    if ($env:USERPROFILE) { & $add $exact (Join-Path $env:USERPROFILE 'Downloads') 'Benutzerordner (Downloads)' }
    & $add $trees $env:windir 'Windows-Ordner (Systemdateien)'
    & $add $trees $env:ProgramFiles 'Program Files (installierte Programme)'
    & $add $trees ${env:ProgramFiles(x86)} 'Program Files (x86) (installierte Programme)'
    & $add $trees ($sysDrive + '\Windows.old') 'Windows.old (nur über Einstellungen > System > Speicher)'
    & $add $trees ($sysDrive + '\System Volume Information') 'System Volume Information (Schattenkopien)'
    & $add $trees ($sysDrive + '\$Recycle.Bin') 'Papierkorb (über das Aufräumziel Papierkorb leeren)'
    & $add $trees ($sysDrive + '\Recovery') 'Wiederherstellungspartition-Daten'
    & $add $trees ($sysDrive + '\$WinREAgent') 'Windows-Wiederherstellung'
    & $add $trees ($usersDir + '\Default') 'Standardprofil'
    foreach ($f in 'hiberfil.sys', 'pagefile.sys', 'swapfile.sys') { & $add $trees ($sysDrive + '\' + $f) ($f + ' (über powercfg bzw. Systemeinstellungen)') }
    return @{ Exact = $exact; Trees = $trees; UsersDir = (Get-NormalizedPath $usersDir) }
}

function Test-SafeDeletePath {
    [CmdletBinding()]
    param(
        [string]$Path,
        [ValidateSet('Manual', 'CleanupRoot', 'CleanupItem')][string]$Context = 'Manual',
        [string[]]$TargetRoots = @(),
        [string[]]$ExtraProtected = @()
    )
    $res = { param($ok, $why) [pscustomobject]@{ Safe = $ok; Reason = $why; Path = $Path } }
    if ([string]::IsNullOrWhiteSpace($Path)) { return (& $res $false 'Kein Pfad angegeben.') }
    try { $full = Get-NormalizedPath $Path } catch { return (& $res $false ('Der Pfad ist nicht auswertbar: ' + $_.Exception.Message)) }
    $ic = [System.StringComparison]::OrdinalIgnoreCase
    $root = [System.IO.Path]::GetPathRoot($full)
    if ($full.TrimEnd('\') -eq $root.TrimEnd('\')) { return (& $res $false 'Ein Laufwerks-Stamm wird nie gelöscht.') }
    $sets = Get-ProtectedPathSets
    foreach ($e in $sets.Exact) { if ([string]::Equals($full, $e.Path, $ic)) { return (& $res $false ('Geschützt: ' + $e.Why + '.')) } }
    foreach ($x in $ExtraProtected) {
        if ($x) { try { if ([string]::Equals($full, (Get-NormalizedPath $x), $ic)) { return (& $res $false 'Geschützt (vom Aufrufer).') } } catch { } }
    }
    # Profil-Stamm und bekannte Benutzerordner jedes Profils
    $parent = [System.IO.Path]::GetDirectoryName($full)
    if ($parent -and [string]::Equals($parent, $sets.UsersDir, $ic)) { return (& $res $false 'Geschützt: ein Benutzerprofil.') }
    if ($parent) {
        $pp = [System.IO.Path]::GetDirectoryName($parent)
        if ($pp -and [string]::Equals($pp, $sets.UsersDir, $ic)) {
            $leaf = [System.IO.Path]::GetFileName($full)
            if ($leaf -match '^(Desktop|Documents|Dokumente|Pictures|Bilder|Videos|Music|Musik|Downloads|Favorites|Contacts|Links|AppData|OneDrive.*)$') { return (& $res $false 'Geschützt: ein Benutzerordner oder OneDrive-Stamm.') }
        }
    }
    # Ordner des Skripts und Protokollordner: weder selbst noch ein Vorgänger davon
    $own = @()
    if ($script:ScriptDir) { $own += , @($script:ScriptDir, 'Der Ordner des Skripts') }
    if ($script:ScriptPath) { $own += , @($script:ScriptPath, 'Das Skript selbst') }
    $logDirNow = if ($script:LogDir) { $script:LogDir } else { Get-LogFolder $null }
    $own += , @($logDirNow, 'Der Protokollordner')
    foreach ($o in $own) {
        try {
            $op = Get-NormalizedPath $o[0]
            if ([string]::Equals($full, $op, $ic) -or $op.StartsWith($full.TrimEnd('\') + '\', $ic)) { return (& $res $false ('Geschützt: ' + $o[1] + ' (oder ein Ordner darüber).')) }
        } catch { }
    }
    if ($Context -eq 'Manual') {
        foreach ($t in $sets.Trees) {
            if ([string]::Equals($full, $t.Path, $ic) -or $full.StartsWith($t.Path.TrimEnd('\') + '\', $ic)) { return (& $res $false ('Geschützt: ' + $t.Why + '.')) }
        }
    }
    if ($Context -eq 'CleanupItem') {
        $under = $false
        foreach ($tr in $TargetRoots) {
            try { $r = Get-NormalizedPath $tr; if ($full.StartsWith($r.TrimEnd('\') + '\', $ic)) { $under = $true; break } } catch { }
        }
        if (-not $under) { return (& $res $false 'Der Pfad liegt nicht unterhalb eines Aufräumziels.') }
    }
    # Verknüpfungen (Reparse Points) im Pfad oder in einem Vorgänger
    $cur = $full
    $exists = $false
    while ($cur) {
        $lp = ConvertTo-LongPath $cur
        $attr = $null
        try { $attr = [System.IO.File]::GetAttributes($lp) } catch { $attr = $null }
        if ($null -ne $attr) {
            if ($cur -eq $full) { $exists = $true }
            if (([int]$attr -band 0x400) -ne 0) { return (& $res $false ('Eine Verknüpfung (Reparse Point) liegt im Pfad: ' + $cur)) }
        }
        $next = [System.IO.Path]::GetDirectoryName($cur)
        if ($next -eq $cur) { break }
        $cur = $next
    }
    if (-not $exists) { return (& $res $false 'Der Pfad existiert nicht.') }
    return (& $res $true '')
}

# ============================================================
# Scan (läuft im Hintergrund-Runspace der Oberfläche oder direkt)
# ============================================================
# Rekursiv über .NET-Aufzählungen (nicht Get-ChildItem), iterativ (keine Rekursionstiefe), Pfade immer mit \\?\.
# Verknüpfungen und Cloud-Platzhalter werden nie verfolgt, geöffnet oder gezählt. Je Ordner nur Summen,
# dazu die größten Dateien und eine Summe je Endung.
function Invoke-DiskScan {
    param([string]$Root, [hashtable]$State, [int]$TopCount = 200)
    if (-not $State) { $State = [hashtable]::Synchronized(@{}) }
    foreach ($k in 'Files', 'Dirs', 'Errors', 'Links', 'Cloud') { if (-not $State.ContainsKey($k)) { $State[$k] = 0 } }
    if (-not $State.ContainsKey('Bytes')) { $State['Bytes'] = [long]0 }
    if (-not $State.ContainsKey('Cancel')) { $State['Cancel'] = $false }
    $State['Cancelled'] = $false
    $State['Current'] = ''
    $State['ErrorPaths'] = New-Object 'System.Collections.Generic.List[string]'
    $State['LinkPaths'] = New-Object 'System.Collections.Generic.List[string]'

    function FromLong([string]$p) {
        if ($p.StartsWith('\\?\UNC\')) { return '\\' + $p.Substring(8) }
        if ($p.StartsWith('\\?\')) { return $p.Substring(4) }
        return $p
    }
    function NewNode([string]$path, [string]$name, $modified) {
        return @{ Name = $name; Path = $path; Size = [long]0; OwnSize = [long]0; Files = 0; OwnFiles = 0; Dirs = 0; Modified = $modified; Children = (New-Object 'System.Collections.Generic.List[object]') }
    }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $full = [System.IO.Path]::GetFullPath($Root)
    $lp = if ($full.StartsWith('\\?\')) { $full } elseif ($full.StartsWith('\\')) { '\\?\UNC\' + $full.Substring(2) } else { '\\?\' + $full }
    $display = FromLong $lp
    $leaf = [System.IO.Path]::GetFileName($display.TrimEnd('\'))
    if (-not $leaf) { $leaf = $display }
    $rootInfo = New-Object System.IO.DirectoryInfo($lp)
    $rootNode = NewNode $display $leaf $rootInfo.LastWriteTime

    $top = New-Object 'System.Collections.Generic.List[object]'
    $topMin = [long]-1
    $ext = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $stack = New-Object 'System.Collections.Generic.Stack[object]'
    $nFiles = 0; $nDirs = 0; $nBytes = [long]0; $nErr = 0; $nLink = 0; $nCloud = 0; $tick = 0
    $cloudMask = 0x400000 -bor 0x40000 -bor 0x1000

    $en = $null
    try { $en = $rootInfo.EnumerateFileSystemInfos().GetEnumerator() } catch { $nErr++; $State.ErrorPaths.Add($display) }
    if ($en) { $stack.Push(@{ Node = $rootNode; Enum = $en }) }

    while ($stack.Count -gt 0) {
        if ($State.Cancel) { $State.Cancelled = $true; break }
        $frame = $stack.Peek()
        $has = $false
        try { $has = $frame.Enum.MoveNext() } catch { $nErr++; if ($State.ErrorPaths.Count -lt 500) { $State.ErrorPaths.Add($frame.Node.Path) }; $has = $false }
        if (-not $has) {
            try { $frame.Enum.Dispose() } catch { }
            [void]$stack.Pop()
            if ($stack.Count -gt 0) {
                $par = $stack.Peek().Node
                $par.Size += $frame.Node.Size
                $par.Files += $frame.Node.Files
                $par.Dirs += $frame.Node.Dirs + 1
            }
            continue
        }
        $e = $frame.Enum.Current
        $attr = [int]$e.Attributes
        if (($attr -band 0x10) -ne 0) {
            if (($attr -band 0x400) -ne 0) {
                $nLink++
                if ($State.LinkPaths.Count -lt 500) { $State.LinkPaths.Add((FromLong $e.FullName)) }
            } else {
                $child = NewNode (FromLong $e.FullName) $e.Name $e.LastWriteTime
                $frame.Node.Children.Add($child)
                $nDirs++
                $cen = $null
                try { $cen = $e.EnumerateFileSystemInfos().GetEnumerator() } catch { $nErr++; if ($State.ErrorPaths.Count -lt 500) { $State.ErrorPaths.Add($child.Path) } }
                if ($cen) { $stack.Push(@{ Node = $child; Enum = $cen }) } else { $frame.Node.Dirs += 1 }
            }
        } else {
            if (($attr -band 0x400) -ne 0) {
                if (($attr -band $cloudMask) -ne 0) { $nCloud++ } else { $nLink++; if ($State.LinkPaths.Count -lt 500) { $State.LinkPaths.Add((FromLong $e.FullName)) } }
            } elseif (($attr -band $cloudMask) -ne 0) {
                $nCloud++
            } else {
                $len = [long]$e.Length
                $node = $frame.Node
                $node.OwnSize += $len; $node.OwnFiles += 1; $node.Size += $len; $node.Files += 1
                $nFiles++; $nBytes += $len
                $x = [System.IO.Path]::GetExtension($e.Name).ToLowerInvariant()
                if (-not $x) { $x = '(ohne)' }
                $slot = $null
                if ($ext.TryGetValue($x, [ref]$slot)) { $slot.Size += $len; $slot.Count += 1 } else { $ext[$x] = @{ Ext = $x; Size = $len; Count = 1 } }
                if ($top.Count -lt $TopCount -or $len -gt $topMin) {
                    $top.Add(@{ Path = (FromLong $e.FullName); Size = $len; Modified = $e.LastWriteTime; Ext = $x })
                    if ($top.Count -ge ($TopCount * 2)) {
                        $top.Sort([System.Comparison[object]] { param($a, $b) $b.Size.CompareTo($a.Size) })
                        $top.RemoveRange($TopCount, $top.Count - $TopCount)
                        $topMin = $top[$TopCount - 1].Size
                    }
                }
            }
        }
        $tick++
        if (($tick -band 255) -eq 0) {
            $State.Files = $nFiles; $State.Dirs = $nDirs; $State.Bytes = $nBytes; $State.Errors = $nErr; $State.Links = $nLink; $State.Cloud = $nCloud
            $State.Current = $frame.Node.Path
        }
    }
    # bei Abbruch die offenen Ordner mit ihren bisherigen Summen nach oben rechnen
    while ($stack.Count -gt 1) {
        $f2 = $stack.Pop()
        try { $f2.Enum.Dispose() } catch { }
        $par2 = $stack.Peek().Node
        $par2.Size += $f2.Node.Size; $par2.Files += $f2.Node.Files; $par2.Dirs += $f2.Node.Dirs + 1
    }
    $top.Sort([System.Comparison[object]] { param($a, $b) $b.Size.CompareTo($a.Size) })
    if ($top.Count -gt $TopCount) { $top.RemoveRange($TopCount, $top.Count - $TopCount) }
    $extList = New-Object 'System.Collections.Generic.List[object]'
    foreach ($kv in $ext.GetEnumerator()) { $extList.Add($kv.Value) }
    $extList.Sort([System.Comparison[object]] { param($a, $b) $b.Size.CompareTo($a.Size) })
    $State.Files = $nFiles; $State.Dirs = $nDirs; $State.Bytes = $nBytes; $State.Errors = $nErr; $State.Links = $nLink; $State.Cloud = $nCloud
    $watch.Stop()
    return [pscustomobject]@{
        Root = $rootNode; TopFiles = $top.ToArray(); Extensions = $extList.ToArray()
        Files = $nFiles; Dirs = $nDirs; Bytes = $nBytes; Errors = $nErr; ErrorPaths = @($State.ErrorPaths)
        Links = $nLink; LinkPaths = @($State.LinkPaths); Cloud = $nCloud; Cancelled = [bool]$State.Cancelled; Seconds = $watch.Elapsed.TotalSeconds
    }
}

# ============================================================
# Kandidaten zum Löschen (gemeinsam für Messen und Löschen, damit die Zahlen übereinstimmen)
# ============================================================
function Get-DeletionCandidates {
    param([string]$Root, [int]$MinAgeDays = 0, [datetime]$Now = (Get-Date), [hashtable]$State)
    $cut = $null
    if ($MinAgeDays -gt 0) { $cut = $Now.AddDays(-$MinAgeDays) }
    $files = New-Object 'System.Collections.Generic.List[object]'
    $dirs = New-Object 'System.Collections.Generic.List[string]'
    $skipped = New-Object 'System.Collections.Generic.List[object]'
    $r = @{ Files = $files; Dirs = $dirs; Skipped = $skipped; SkippedTotal = 0; Young = 0; YoungBytes = [long]0; Errors = 0; Bytes = [long]0; Count = 0; HasLinks = $false; Exists = $false }
    $lp = ConvertTo-LongPath $Root
    $skip = {
        param($p, $why)
        $r.SkippedTotal++
        if ($skipped.Count -lt 1000) { $skipped.Add(@{ Path = (ConvertFrom-LongPath $p); Reason = $why }) }
    }
    $isFile = $false
    try { $isFile = [System.IO.File]::Exists($lp) } catch { }
    if ($isFile) {
        $r.Exists = $true
        try {
            $fi = New-Object System.IO.FileInfo($lp)
            $attr = [int]$fi.Attributes
            if (($attr -band 0x400) -ne 0) { & $skip $lp 'Verknüpfung, nicht berührt'; $r.HasLinks = $true }
            elseif (($attr -band 0x1) -ne 0) { & $skip $lp 'schreibgeschützt' }
            elseif ($cut -and $fi.LastWriteTime -ge $cut) { $r.Young++; $r.YoungBytes += $fi.Length }
            else { $files.Add(@{ P = $lp; S = [long]$fi.Length; M = $fi.LastWriteTime }); $r.Bytes += $fi.Length; $r.Count++ }
        } catch { $r.Errors++ }
        return $r
    }
    $di = New-Object System.IO.DirectoryInfo($lp)
    if (-not $di.Exists) { return $r }
    $r.Exists = $true
    $stack = New-Object 'System.Collections.Generic.Stack[object]'
    $en = $null
    try { $en = $di.EnumerateFileSystemInfos().GetEnumerator() } catch { $r.Errors++ }
    if ($en) { $stack.Push($en) }
    $tick = 0
    while ($stack.Count -gt 0) {
        if ($State -and $State.Cancel) { break }
        $cur = $stack.Peek()
        $has = $false
        try { $has = $cur.MoveNext() } catch { $r.Errors++; $has = $false }
        if (-not $has) { try { $cur.Dispose() } catch { }; [void]$stack.Pop(); continue }
        $e = $cur.Current
        $attr = [int]$e.Attributes
        if (($attr -band 0x10) -ne 0) {
            if (($attr -band 0x400) -ne 0) { & $skip $e.FullName 'Verknüpfung, nicht durchlaufen'; $r.HasLinks = $true; continue }
            $dirs.Add($e.FullName)
            $ce = $null
            try { $ce = $e.EnumerateFileSystemInfos().GetEnumerator() } catch { $r.Errors++ }
            if ($ce) { $stack.Push($ce) }
        } else {
            if (($attr -band 0x400) -ne 0) { & $skip $e.FullName 'Verknüpfung oder Cloud-Platzhalter, nicht berührt'; $r.HasLinks = $true; continue }
            if (($attr -band 0x1) -ne 0) { & $skip $e.FullName 'schreibgeschützt (Schreibschutz im Explorer aufheben)'; continue }
            if ($cut -and $e.LastWriteTime -ge $cut) { $r.Young++; $r.YoungBytes += [long]$e.Length; continue }
            $files.Add(@{ P = $e.FullName; S = [long]$e.Length; M = $e.LastWriteTime }); $r.Bytes += [long]$e.Length; $r.Count++
        }
        $tick++
        if ($State -and ($tick -band 255) -eq 0) { $State.Current = ConvertFrom-LongPath $e.FullName }
    }
    return $r
}

# ============================================================
# Löschen
# ============================================================
function Get-FreeSpaceMap {
    param([string[]]$Paths)
    $m = @{}
    foreach ($p in $Paths) {
        try {
            $root = [System.IO.Path]::GetPathRoot((Get-NormalizedPath $p))
            if ($root -and -not $m.ContainsKey($root)) { $m[$root] = (New-Object System.IO.DriveInfo($root)).AvailableFreeSpace }
        } catch { }
    }
    return $m
}

# Mode Manual: Paths sind vom Nutzer gewählte Dateien oder Ordner (der Ordner selbst wird mit entfernt).
# Mode Cleanup: Targets sind Aufräumziele aus Get-CleanupTargets (nur der Inhalt, der Zielordner bleibt bestehen).
# -Probelauf löscht nichts und liefert dieselbe Auswertung. Schreibgeschützte Dateien werden nie gelöscht, sondern gemeldet.
function Remove-Selected {
    [CmdletBinding()]
    param(
        [ValidateSet('Manual', 'Cleanup')][string]$Mode = 'Manual',
        [string[]]$Paths = @(),
        [object[]]$Targets = @(),
        [string[]]$TargetRoots = @(),
        [int]$MinAgeDays = 0,
        [switch]$Probelauf,
        [switch]$ToRecycleBin,
        [string]$LogPath,
        [scriptblock]$Progress
    )
    $started = Get-Date
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $logDir = Get-LogFolder $LogPath
    $script:LogDir = $logDir
    [void][System.IO.Directory]::CreateDirectory($logDir)
    $stamp = $started.ToString('yyyyMMdd-HHmmss')
    $logFile = Join-Path $logDir ('deletion-' + $stamp + '.log')
    $n = 1
    while ([System.IO.File]::Exists($logFile)) { $n++; $logFile = Join-Path $logDir ('deletion-' + $stamp + '-' + $n + '.log') }
    $enc = New-Object System.Text.UTF8Encoding($true)
    $w = New-Object System.IO.StreamWriter($logFile, $false, $enc)
    $modeText = if ($Probelauf) { $Mode + ' (Probelauf, es wird nichts gelöscht)' } else { $Mode + $(if ($ToRecycleBin) { ' (Papierkorb)' } else { ' (endgültig)' }) }
    $w.WriteLine('Datenträger-Analyse, Löschprotokoll')
    $w.WriteLine('Zeitpunkt: ' + $started.ToString('yyyy-MM-dd HH:mm:ss'))
    $w.WriteLine('Benutzer: ' + $env:USERDOMAIN + '\' + $env:USERNAME)
    $w.WriteLine('Rechner: ' + $env:COMPUTERNAME)
    $w.WriteLine('Modus: ' + $modeText)
    $w.WriteLine('Administrator: ' + (Test-IsAdmin))
    $w.WriteLine('----')
    $deleted = 0; $deletedBytes = [long]0; $deletedDirs = 0
    $skipped = New-Object 'System.Collections.Generic.List[object]'
    $refused = New-Object 'System.Collections.Generic.List[object]'
    $items = New-Object 'System.Collections.Generic.List[object]'
    try {
        if ($Mode -eq 'Manual') { foreach ($p in $Paths) { $items.Add(@{ Path = $p; Target = $null; Age = $MinAgeDays }) } }
        else {
            foreach ($t in $Targets) {
                foreach ($p in $t.Paths) { $items.Add(@{ Path = $p; Target = $t; Age = $t.MinAgeDays }) }
                if ($t.Kind -eq 'RecycleBin' -and -not $t.Paths) { $items.Add(@{ Path = $null; Target = $t; Age = 0 }) }
            }
        }
        $freeBefore = Get-FreeSpaceMap @($items | Where-Object { $_.Path } | ForEach-Object { $_.Path })
        $roots = @($TargetRoots)
        if ($Mode -eq 'Cleanup' -and -not $roots) { $roots = @($Targets | ForEach-Object { $_.Paths } | Where-Object { $_ }) }
        $doneCount = 0
        foreach ($it in $items) {
            if ($it.Target -and $it.Target.Kind -eq 'RecycleBin') {
                $t = $it.Target
                if ($Probelauf) { $w.WriteLine(('[Probelauf] {0} Bytes, {1} Elemente, Papierkorb würde geleert' -f $t.Size, $t.Count)); $deleted += $t.Count; $deletedBytes += $t.Size }
                else {
                    try { Clear-RecycleBin -DriveLetter ($env:SystemDrive.Substring(0, 1)) -Force -ErrorAction Stop; $w.WriteLine(('[gelöscht] {0} Bytes, {1} Elemente, Papierkorb geleert' -f $t.Size, $t.Count)); $deleted += $t.Count; $deletedBytes += $t.Size }
                    catch { $skipped.Add(@{ Path = 'Papierkorb'; Reason = $_.Exception.Message }); $w.WriteLine('[übersprungen] Papierkorb: ' + $_.Exception.Message) }
                }
                continue
            }
            $ctx = if ($Mode -eq 'Manual') { 'Manual' } else { 'CleanupRoot' }
            $chk = Test-SafeDeletePath -Path $it.Path -Context $ctx -TargetRoots $roots
            if (-not $chk.Safe) { $refused.Add(@{ Path = $it.Path; Reason = $chk.Reason }); $w.WriteLine('[abgelehnt] ' + $it.Path + ' : ' + $chk.Reason); continue }
            $norm = Get-NormalizedPath $it.Path
            $cand = Get-DeletionCandidates -Root $norm -MinAgeDays $it.Age
            foreach ($s in $cand.Skipped) { $skipped.Add($s); $w.WriteLine('[übersprungen] ' + $s.Path + ' : ' + $s.Reason) }
            if ($ToRecycleBin -and $Mode -eq 'Manual') {
                # Der Papierkorb übernimmt ganze Elemente; Ordner mit Verknüpfungen werden dafür nicht angefasst
                if ($cand.HasLinks) { $skipped.Add(@{ Path = $norm; Reason = 'enthält Verknüpfungen, nicht in den Papierkorb verschoben' }); $w.WriteLine('[übersprungen] ' + $norm + ' : enthält Verknüpfungen'); continue }
                if ($Probelauf) { $deleted += $cand.Count; $deletedBytes += $cand.Bytes; $w.WriteLine(('[Probelauf] {0} Bytes {1}' -f $cand.Bytes, $norm)); continue }
                try {
                    Add-Type -AssemblyName Microsoft.VisualBasic
                    $ui = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs; $cn = [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
                    if ([System.IO.Directory]::Exists((ConvertTo-LongPath $norm))) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($norm, $ui, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, $cn) }
                    else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($norm, $ui, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, $cn) }
                    $deleted += $cand.Count; $deletedBytes += $cand.Bytes
                    $w.WriteLine(('[Papierkorb] {0} Bytes {1}' -f $cand.Bytes, $norm))
                } catch { $skipped.Add(@{ Path = $norm; Reason = $_.Exception.Message }); $w.WriteLine('[übersprungen] ' + $norm + ' : ' + $_.Exception.Message) }
                continue
            }
            foreach ($f in $cand.Files) {
                $disp = ConvertFrom-LongPath $f.P
                $doneCount++
                if ($Progress -and ($doneCount % 100) -eq 0) { try { & $Progress $doneCount $disp } catch { } }
                if ($Probelauf) { $deleted++; $deletedBytes += $f.S; $w.WriteLine(('[Probelauf] {0} Bytes {1}' -f $f.S, $disp)); continue }
                try {
                    [System.IO.File]::Delete($f.P)
                    $deleted++; $deletedBytes += $f.S
                    $w.WriteLine(('[gelöscht] {0} Bytes {1}' -f $f.S, $disp))
                } catch {
                    $ex = $_.Exception
                    if ($ex.InnerException) { $ex = $ex.InnerException }
                    $why = if ($ex -is [System.UnauthorizedAccessException]) { 'Zugriff verweigert' }
                           elseif ($ex -is [System.IO.FileNotFoundException] -or $ex -is [System.IO.DirectoryNotFoundException]) { 'nicht mehr vorhanden' }
                           elseif ($ex -is [System.IO.IOException]) { 'in Benutzung' }
                           else { $ex.Message }
                    $skipped.Add(@{ Path = $disp; Reason = $why }); $w.WriteLine('[übersprungen] ' + $disp + ' : ' + $why + ' (' + $ex.Message + ')')
                }
            }
            if (-not $Probelauf) {
                # leere Unterordner entfernen (von unten nach oben); der Zielordner selbst bleibt im Aufräummodus bestehen
                $dl = New-Object 'System.Collections.Generic.List[string]'
                $dl.AddRange($cand.Dirs); $dl.Reverse()
                if ($Mode -eq 'Manual') { $dl.Add((ConvertTo-LongPath $norm)) }
                foreach ($d in $dl) {
                    try {
                        if (([int][System.IO.File]::GetAttributes($d) -band 0x400) -ne 0) { continue }
                        if ([System.IO.Directory]::GetFileSystemEntries($d).Count -eq 0) { [System.IO.Directory]::Delete($d); $deletedDirs++; $w.WriteLine('[Ordner entfernt] ' + (ConvertFrom-LongPath $d)) }
                    } catch { }
                }
            }
        }
        $freeAfter = Get-FreeSpaceMap @($items | Where-Object { $_.Path } | ForEach-Object { $_.Path })
    } finally {
        $watch.Stop()
        if ($w) {
            $w.WriteLine('----')
            $w.WriteLine('Gelöscht: ' + $deleted + ' Dateien, ' + $deletedBytes + ' Bytes (' + (Format-Size $deletedBytes) + '), ' + $deletedDirs + ' leere Ordner')
            $w.WriteLine('Übersprungen: ' + $skipped.Count)
            $w.WriteLine('Abgelehnt (Schutzprüfung): ' + $refused.Count)
            if ($freeBefore -and $freeAfter) { foreach ($k in $freeBefore.Keys) { $w.WriteLine(('Freier Platz {0} vorher {1} Bytes, nachher {2} Bytes' -f $k, $freeBefore[$k], $freeAfter[$k])) } }
            $w.WriteLine('Dauer: ' + $watch.Elapsed.TotalSeconds.ToString('N1', $script:De) + ' s')
            $w.Dispose()
        }
    }
    return [pscustomobject]@{
        Mode = $Mode; Probelauf = [bool]$Probelauf; Deleted = $deleted; DeletedBytes = $deletedBytes; DeletedDirs = $deletedDirs
        Skipped = $skipped.ToArray(); Refused = $refused.ToArray(); FreeBefore = $freeBefore; FreeAfter = $freeAfter; LogFile = $logFile; Seconds = $watch.Elapsed.TotalSeconds
    }
}

# ============================================================
# Aufräumziele
# ============================================================
function Get-CleanupTargets {
    [CmdletBinding()]
    param(
        [int]$MinAgeDays = 7,
        [string[]]$ExtraRoots = @(),
        [switch]$SkipSystem,
        [switch]$HintSizes,
        [hashtable]$State,
        [bool]$IsAdmin = (Test-IsAdmin)
    )
    $targets = New-Object 'System.Collections.Generic.List[object]'
    $sysDrive = if ($env:SystemDrive) { $env:SystemDrive } else { 'C:' }
    $win = $env:windir
    $existing = {
        param($list)
        $o = @()
        foreach ($p in $list) { if ($p -and ([System.IO.Directory]::Exists($p) -or [System.IO.File]::Exists($p))) { $o += (Get-NormalizedPath $p) } }
        return , $o
    }
    $browserCaches = {
        param($userData)
        $o = @()
        if ($userData -and [System.IO.Directory]::Exists($userData)) {
            foreach ($prof in [System.IO.Directory]::GetDirectories($userData)) {
                $pn = [System.IO.Path]::GetFileName($prof)
                if ($pn -match '^(Default|Profile \d+|Guest Profile)$') {
                    foreach ($c in 'Cache', 'Code Cache', 'GPUCache') { $cp = Join-Path $prof $c; if ([System.IO.Directory]::Exists($cp)) { $o += $cp } }
                }
            }
        }
        return , $o
    }
    $defs = New-Object 'System.Collections.Generic.List[object]'
    $add = {
        param($id, $name, $tier, $paths, $admin, $age, $note, $kind)
        $defs.Add(@{ Id = $id; Name = $name; Tier = $tier; Paths = $paths; Admin = $admin; Age = $age; Note = $note; Kind = $kind })
    }
    if (-not $SkipSystem) {
        & $add 'user-temp' 'Benutzer-Temp' 'Sicher' (& $existing @($env:TEMP)) $false $MinAgeDays ('Dateien im Temp-Ordner des Benutzers, älter als ' + $MinAgeDays + ' Tage. Dateien in Benutzung werden übersprungen.') 'Folder'
        & $add 'win-temp' 'Windows-Temp' 'Sicher' (& $existing @((Join-Path $win 'Temp'))) $true $MinAgeDays ('Temp-Ordner von Windows, älter als ' + $MinAgeDays + ' Tage. Benötigt Administratorrechte.') 'Folder'
        $rbRoot = $null
        try { $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rbRoot = $sysDrive + '\$Recycle.Bin\' + $sid } catch { }
        & $add 'recycle' 'Papierkorb' 'Sicher' (& $existing @($rbRoot)) $false 0 'Der Papierkorb des Systemlaufwerks wird geleert (endgültig).' 'RecycleBin'
        & $add 'dumps-user' 'Absturzabbilder (Benutzer)' 'Sicher' (& $existing @((Join-Path $env:LOCALAPPDATA 'CrashDumps'))) $false 0 'Absturzabbilder der Programme des Benutzers.' 'Folder'
        & $add 'dumps-sys' 'Absturzabbilder (System)' 'Sicher' (& $existing @((Join-Path $win 'Minidump'), (Join-Path $win 'MEMORY.DMP'))) $true 0 'Minidumps und MEMORY.DMP. Benötigt Administratorrechte.' 'Folder'
        & $add 'wer' 'Windows-Fehlerberichte' 'Sicher' (& $existing @((Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportArchive'), (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportQueue'))) $true 0 'Gesammelte Fehlerberichte. Benötigt Administratorrechte.' 'Folder'
        & $add 'edge-cache' 'Browser-Cache Edge' 'Sicher' (& $browserCaches (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')) $false 0 'Nur die Cache-Ordner der Profile (Cache, Code Cache, GPUCache), nie das Profil selbst. Edge sollte beendet sein.' 'Folder'
        & $add 'chrome-cache' 'Browser-Cache Chrome' 'Sicher' (& $browserCaches (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data')) $false 0 'Nur die Cache-Ordner der Profile (Cache, Code Cache, GPUCache), nie das Profil selbst. Chrome sollte beendet sein.' 'Folder'
        & $add 'do-cache' 'Cache der Lieferoptimierung' 'Sicher' (& $existing @((Join-Path $env:ProgramData 'Microsoft\Windows\DeliveryOptimization\Cache'), (Join-Path $win 'ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache'))) $true 0 'Zwischengespeicherte Windows-Updates für die Verteilung. Benötigt Administratorrechte.' 'Folder'
        & $add 'sw-dist' 'Windows-Update-Downloads (SoftwareDistribution\Download)' 'Bedacht' (& $existing @((Join-Path $win 'SoftwareDistribution\Download'))) $true 0 'Nur aufräumen, wenn kein Update läuft. Benötigt Administratorrechte. Der Dienst wird nicht angehalten, Dateien in Benutzung bleiben stehen.' 'Folder'
    }
    $ei = 0
    foreach ($x in $ExtraRoots) {
        $ei++
        $np = $null
        try { $np = Get-NormalizedPath $x } catch { }
        $leaf = if ($np) { [System.IO.Path]::GetFileName($np) } else { $x }
        & $add ('extra-' + $ei) ('Zusatzziel: ' + $leaf) 'Sicher' (& $existing @($np)) $false $MinAgeDays ('Zusätzliches Ziel, älter als ' + $MinAgeDays + ' Tage.') 'Folder'
    }
    foreach ($d in $defs) {
        $paths = @($d.Paths | Where-Object { $_ })
        $protectedWhy = $null
        foreach ($p in $paths) {
            $chk = Test-SafeDeletePath -Path $p -Context CleanupRoot
            if (-not $chk.Safe -and $chk.Reason -ne 'Der Pfad existiert nicht.') { $protectedWhy = $chk.Reason; break }
        }
        $size = [long]0; $count = 0; $errs = 0
        if ($protectedWhy) { $paths = @() }
        foreach ($p in $paths) {
            $c = Get-DeletionCandidates -Root $p -MinAgeDays $d.Age -State $State
            $size += $c.Bytes; $count += $c.Count; $errs += $c.Errors
        }
        $targets.Add([pscustomobject]@{
            Id = $d.Id; Name = $d.Name; Tier = $d.Tier; Kind = $d.Kind; Paths = $paths; NeedsAdmin = [bool]$d.Admin
            Available = (-not $d.Admin -or $IsAdmin) -and -not $protectedWhy; MinAgeDays = [int]$d.Age
            Size = $size; Count = $count; ReadErrors = $errs; Note = $(if ($protectedWhy) { 'Abgelehnt: ' + $protectedWhy } else { $d.Note })
        })
    }
    # reine Hinweise, ohne Knopf zum Löschen
    if (-not $SkipSystem) {
        $fileSize = { param($p) try { $fi = New-Object System.IO.FileInfo($p); if ($fi.Exists) { return [long]$fi.Length } } catch { }; return [long]-1 }
        $dirSize = {
            param($p)
            if (-not $HintSizes) { return [long]-1 }
            if (-not [System.IO.Directory]::Exists($p)) { return [long]-1 }
            $c = Get-DeletionCandidates -Root $p -MinAgeDays 0 -State $State
            return [long]($c.Bytes + $c.YoungBytes)
        }
        $hints = @(
            @{ Id = 'hiberfil'; Name = 'hiberfil.sys (Ruhezustand)'; Path = ($sysDrive + '\hiberfil.sys'); Size = (& $fileSize ($sysDrive + '\hiberfil.sys')); Note = 'Wird nicht gelöscht. Abschalten mit "powercfg /hibernate off" (Administrator-Konsole), Verkleinern mit "powercfg /hibernate /size 50".' },
            @{ Id = 'pagefile'; Name = 'pagefile.sys (Auslagerungsdatei)'; Path = ($sysDrive + '\pagefile.sys'); Size = (& $fileSize ($sysDrive + '\pagefile.sys')); Note = 'Wird nicht gelöscht. Größe ändern unter Einstellungen > System > Info > Erweiterte Systemeinstellungen > Leistung > Erweitert > Virtueller Arbeitsspeicher.' },
            @{ Id = 'windows-old'; Name = 'Windows.old'; Path = ($sysDrive + '\Windows.old'); Size = (& $dirSize ($sysDrive + '\Windows.old')); Note = 'Wird nicht gelöscht. Bereinigen unter Einstellungen > System > Speicher > Temporäre Dateien > "Vorherige Windows-Installation(en)" (danach ist kein Zurücksetzen auf die alte Version mehr möglich).' },
            @{ Id = 'winsxs'; Name = 'Komponentenspeicher (WinSxS)'; Path = ($win + '\WinSxS'); Size = (& $dirSize ($win + '\WinSxS')); Note = 'Wird nicht gelöscht. Bereinigen in einer Administrator-Konsole mit "DISM /Online /Cleanup-Image /AnalyzeComponentStore" und danach "DISM /Online /Cleanup-Image /StartComponentCleanup". Die Größenangabe ist logisch und enthält Hardlinks mehrfach.' },
            @{ Id = 'shadow'; Name = 'Schattenkopien (Systemwiederherstellung)'; Path = ($sysDrive + '\System Volume Information'); Size = [long]-1; Note = 'Wird nicht gelöscht, die Größe ist ohne Administratorrechte nicht lesbar. Belegung ansehen mit "vssadmin list shadowstorage", Obergrenze ändern unter Einstellungen > System > Info > Computerschutz.' }
        )
        foreach ($h in $hints) {
            $exists = [System.IO.Directory]::Exists($h.Path) -or [System.IO.File]::Exists($h.Path)
            $targets.Add([pscustomobject]@{
                Id = $h.Id; Name = $h.Name; Tier = 'Hinweis'; Kind = 'Info'; Paths = @($(if ($exists) { $h.Path })); NeedsAdmin = $false; Available = $false; MinAgeDays = 0
                Size = [long]$h.Size; Count = 0; ReadErrors = 0; Note = $h.Note
            })
        }
    }
    return $targets.ToArray()
}

# ============================================================
# Berichte
# ============================================================
function Get-FlatFolders {
    param($Root, [int]$MaxDepth = 4)
    $out = New-Object 'System.Collections.Generic.List[object]'
    $stack = New-Object 'System.Collections.Generic.Stack[object]'
    $stack.Push(@{ N = $Root; D = 0 })
    while ($stack.Count -gt 0) {
        $f = $stack.Pop()
        if ($f.D -gt 0) { $out.Add(@{ Node = $f.N; Depth = $f.D }) }
        if ($f.D -lt $MaxDepth) { foreach ($c in $f.N.Children) { $stack.Push(@{ N = $c; D = $f.D + 1 }) } }
    }
    $out.Sort([System.Comparison[object]] { param($a, $b) $b.Node.Size.CompareTo($a.Node.Size) })
    return $out
}

function New-TextReport {
    param($Scan, $Targets, $Drive, [int]$Top = 30)
    $L = New-Object 'System.Collections.Generic.List[string]'
    $total = [double]$Scan.Root.Size
    $L.Add('Datenträger-Analyse (nur lesend), Version ' + $ScriptVersion)
    $L.Add('Rechner: ' + $env:COMPUTERNAME + '   Benutzer: ' + $env:USERNAME + '   Zeit: ' + (Get-Date).ToString('yyyy-MM-dd HH:mm'))
    $L.Add('Pfad: ' + $Scan.Root.Path + '   Dauer: ' + $Scan.Seconds.ToString('N1', $script:De) + ' s   Administrator: ' + (Test-IsAdmin))
    $L.Add('')
    $L.Add('== Datenträger ==')
    if ($Drive) { $L.Add(('{0} gesamt {1}, frei {2} ({3}), belegt {4}' -f $Drive.Name, (Format-Size $Drive.Total), (Format-Size $Drive.Free), (Format-Percent $Drive.Free $Drive.Total), (Format-Size $Drive.Used))) } else { $L.Add('Keine Angaben zum Datenträger verfügbar.') }
    $L.Add('Gezählt: ' + $Scan.Files + ' Dateien, ' + $Scan.Dirs + ' Ordner, ' + (Format-Size $Scan.Bytes) + ' (logische Dateigrößen, nicht belegter Platz)')
    $L.Add('')
    $L.Add('== Hinweise zum Scan ==')
    $L.Add($Scan.Errors.ToString() + ' Ordner nicht lesbar')
    $L.Add($Scan.Links.ToString() + ' Verknüpfungen, nicht gezählt')
    $L.Add($Scan.Cloud.ToString() + ' Cloud-Platzhalter, nicht geöffnet und nicht gezählt')
    if ($Scan.Cancelled) { $L.Add('Der Scan wurde abgebrochen, die Summen sind unvollständig.') }
    $L.Add('Hardlinks (Komponentenspeicher) lassen sich nicht exakt erfassen.')
    $L.Add('')
    $L.Add('== Größte Ordner (bis Tiefe 4, Top ' + $Top + ') ==')
    foreach ($f in (Get-FlatFolders $Scan.Root 4 | Select-Object -First $Top)) { $L.Add(('{0,12}  {1,7}  {2}' -f (Format-Size $f.Node.Size), (Format-Percent $f.Node.Size $total), $f.Node.Path)) }
    $L.Add('')
    $L.Add('== Größte Dateien (Top ' + $Top + ') ==')
    foreach ($f in ($Scan.TopFiles | Select-Object -First $Top)) { $L.Add(('{0,12}  {1}  {2}' -f (Format-Size $f.Size), $f.Modified.ToString('yyyy-MM-dd'), $f.Path)) }
    $L.Add('')
    $L.Add('== Dateitypen (Top ' + $Top + ') ==')
    foreach ($x in ($Scan.Extensions | Select-Object -First $Top)) { $L.Add(('{0,12}  {1,9} Dateien  {2}' -f (Format-Size $x.Size), $x.Count, $x.Ext)) }
    $L.Add('')
    $L.Add('== Aufräumziele ==')
    if ($Targets) {
        foreach ($t in ($Targets | Where-Object { $_.Tier -ne 'Hinweis' })) {
            $mark = if ($t.Tier -eq 'Bedacht') { ' [mit Bedacht]' } else { '' }
            $adm = if ($t.NeedsAdmin) { ' (Administrator nötig' + $(if ($t.Available) { '' } else { ', nicht verfügbar' }) + ')' } else { '' }
            $L.Add(('{0,12}  {1,8} Dateien  {2}{3}{4}' -f (Format-Size $t.Size), $t.Count, $t.Name, $mark, $adm))
        }
        $L.Add('')
        $L.Add('== Nur Hinweis (wird nie gelöscht) ==')
        foreach ($t in ($Targets | Where-Object { $_.Tier -eq 'Hinweis' })) {
            $sz = if ($t.Size -ge 0) { Format-Size $t.Size } else { 'Größe nicht ermittelt' }
            $L.Add(('{0}: {1}' -f $t.Name, $sz)); $L.Add('    ' + $t.Note)
        }
    } else { $L.Add('Keine Aufräumziele ermittelt.') }
    $L.Add('')
    $L.Add('Der Bericht enthält Pfade und Benutzernamen und gehört nicht in öffentliche Tickets.')
    return $L.ToArray()
}

function New-HtmlReport {
    param($Scan, $Targets, $Drive, [int]$Top = 50)
    $h = { param($s) [System.Net.WebUtility]::HtmlEncode([string]$s) }
    $total = [double]$Scan.Root.Size
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('<!DOCTYPE html>')
    [void]$sb.AppendLine('<html lang="de"><head><meta charset="utf-8"><title>Datenträger-Analyse</title>')
    [void]$sb.AppendLine('<style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;margin:8px 0 20px}th,td{border:1px solid #bbb;padding:4px 8px;text-align:left;font-size:13px}th{background:#eee}td.n{text-align:right}h2{margin-top:24px}.hint{background:#fff6d6;border:1px solid #e0c060;padding:8px 12px}</style>')
    [void]$sb.AppendLine('</head><body>')
    [void]$sb.AppendLine('<h1>Datenträger-Analyse</h1>')
    [void]$sb.AppendLine('<p class="hint">Dieser Bericht enthält Pfade und Benutzernamen und gehört nicht in öffentliche Tickets. Größen sind logische Dateigrößen.</p>')
    [void]$sb.AppendLine('<p>Rechner: ' + (& $h $env:COMPUTERNAME) + ', Benutzer: ' + (& $h $env:USERNAME) + ', Zeit: ' + (& $h (Get-Date).ToString('yyyy-MM-dd HH:mm')) + '<br>Pfad: ' + (& $h $Scan.Root.Path) + ', Dauer: ' + (& $h $Scan.Seconds.ToString('N1', $script:De)) + ' s</p>')
    if ($Drive) { [void]$sb.AppendLine('<p>Datenträger ' + (& $h $Drive.Name) + ': gesamt ' + (& $h (Format-Size $Drive.Total)) + ', frei ' + (& $h (Format-Size $Drive.Free)) + ' (' + (& $h (Format-Percent $Drive.Free $Drive.Total)) + ')</p>') }
    [void]$sb.AppendLine('<p>' + $Scan.Files + ' Dateien, ' + $Scan.Dirs + ' Ordner, ' + (& $h (Format-Size $Scan.Bytes)) + '. ' + $Scan.Errors + ' Ordner nicht lesbar, ' + $Scan.Links + ' Verknüpfungen nicht gezählt, ' + $Scan.Cloud + ' Cloud-Platzhalter nicht gezählt.</p>')
    [void]$sb.AppendLine('<h2>Größte Ordner</h2><table><tr><th>Ordner</th><th>Größe</th><th>Anteil</th><th>Dateien</th></tr>')
    foreach ($f in (Get-FlatFolders $Scan.Root 4 | Select-Object -First $Top)) { [void]$sb.AppendLine('<tr><td>' + (& $h $f.Node.Path) + '</td><td class="n">' + (& $h (Format-Size $f.Node.Size)) + '</td><td class="n">' + (& $h (Format-Percent $f.Node.Size $total)) + '</td><td class="n">' + $f.Node.Files + '</td></tr>') }
    [void]$sb.AppendLine('</table><h2>Größte Dateien</h2><table><tr><th>Pfad</th><th>Größe</th><th>Geändert</th></tr>')
    foreach ($f in ($Scan.TopFiles | Select-Object -First $Top)) { [void]$sb.AppendLine('<tr><td>' + (& $h $f.Path) + '</td><td class="n">' + (& $h (Format-Size $f.Size)) + '</td><td>' + (& $h $f.Modified.ToString('yyyy-MM-dd')) + '</td></tr>') }
    [void]$sb.AppendLine('</table><h2>Dateitypen</h2><table><tr><th>Endung</th><th>Größe</th><th>Dateien</th></tr>')
    foreach ($x in ($Scan.Extensions | Select-Object -First $Top)) { [void]$sb.AppendLine('<tr><td>' + (& $h $x.Ext) + '</td><td class="n">' + (& $h (Format-Size $x.Size)) + '</td><td class="n">' + $x.Count + '</td></tr>') }
    [void]$sb.AppendLine('</table>')
    if ($Targets) {
        [void]$sb.AppendLine('<h2>Aufräumziele</h2><table><tr><th>Ziel</th><th>Stufe</th><th>Größe</th><th>Dateien</th><th>Hinweis</th></tr>')
        foreach ($t in $Targets) {
            $sz = if ($t.Size -ge 0) { Format-Size $t.Size } else { 'nicht ermittelt' }
            [void]$sb.AppendLine('<tr><td>' + (& $h $t.Name) + '</td><td>' + (& $h $t.Tier) + '</td><td class="n">' + (& $h $sz) + '</td><td class="n">' + $t.Count + '</td><td>' + (& $h $t.Note) + '</td></tr>')
        }
        [void]$sb.AppendLine('</table>')
    }
    [void]$sb.AppendLine('</body></html>')
    return $sb.ToString()
}

function Get-ScanContext {
    param([string]$Root, [int]$Top)
    $state = [hashtable]::Synchronized(@{ Cancel = $false })
    $scan = Invoke-DiskScan -Root $Root -State $state -TopCount 200
    $targets = Get-CleanupTargets -MinAgeDays 7 -ExtraRoots $ExtraCleanupRoot -SkipSystem:$SkipSystemTargets -HintSizes:(-not $SkipHintSizes) -State $null
    return @{ Scan = $scan; Targets = $targets; Drive = (Get-DriveText $Root) }
}

# ============================================================
# Oberfläche (WinForms), die Logik bleibt in den Funktionen oben
# ============================================================
function Get-DiskScanJobScript {
    $names = 'Invoke-DiskScan'
    $txt = New-Object System.Text.StringBuilder
    foreach ($n in $names) { [void]$txt.AppendLine('function ' + $n + ' {' + (Get-Command $n -CommandType Function).ScriptBlock.ToString() + '}') }
    return $txt.ToString()
}

function Get-TargetsJobScript {
    $names = 'Test-IsAdmin', 'ConvertTo-LongPath', 'ConvertFrom-LongPath', 'Expand-ShortPath', 'Get-NormalizedPath', 'Get-LogFolder', 'Get-ProtectedPathSets', 'Test-SafeDeletePath', 'Get-DeletionCandidates', 'Get-CleanupTargets'
    $txt = New-Object System.Text.StringBuilder
    foreach ($n in $names) { [void]$txt.AppendLine('function ' + $n + ' {' + (Get-Command $n -CommandType Function).ScriptBlock.ToString() + '}') }
    return $txt.ToString()
}

function Start-BackgroundJob {
    param([string]$FunctionsText, [string]$CallText, [hashtable]$Variables)
    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = 'MTA'
    $rs.Open()
    foreach ($k in $Variables.Keys) { $rs.SessionStateProxy.SetVariable($k, $Variables[$k]) }
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($FunctionsText + "`n" + $CallText)
    $handle = $ps.BeginInvoke()
    return @{ Ps = $ps; Rs = $rs; Handle = $handle }
}

function Stop-BackgroundJob {
    param($Job)
    if (-not $Job) { return }
    try { if ($Job.Ps -and -not $Job.Handle.IsCompleted) { $Job.Ps.Stop() } } catch { }
    try { if ($Job.Ps) { $Job.Ps.Dispose() } } catch { }
    try { if ($Job.Rs) { $Job.Rs.Close(); $Job.Rs.Dispose() } } catch { }
}

# Aus der Oberfläche: Auswahl löschen. Confirm ist ein Skriptblock, der $true liefern muss; ohne Bestätigung passiert nichts.
function Invoke-GuiDelete {
    param([string[]]$Paths, [bool]$Permanent, [scriptblock]$Confirm, [scriptblock]$Progress)
    $answer = $false
    if ($Confirm) { try { $answer = [bool](& $Confirm) } catch { $answer = $false } }
    if (-not $answer) { return [pscustomobject]@{ Cancelled = $true; Result = $null } }
    $res = Remove-Selected -Mode Manual -Paths $Paths -ToRecycleBin:(-not $Permanent) -LogPath $script:LogDir -Progress $Progress
    return [pscustomobject]@{ Cancelled = $false; Result = $res }
}

function Show-ResultDialog {
    param($Result, [string]$Title = 'Ergebnis')
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $verb = if ($Result.Probelauf) { 'Probelauf: würde löschen' } else { 'Gelöscht' }
    $lines.Add(('{0}: {1} Dateien, {2}, {3} leere Ordner' -f $verb, $Result.Deleted, (Format-Size $Result.DeletedBytes), $Result.DeletedDirs))
    if ($Result.Skipped.Count) { $lines.Add(''); $lines.Add('Übersprungen: ' + $Result.Skipped.Count); foreach ($s in ($Result.Skipped | Select-Object -First 12)) { $lines.Add('  ' + $s.Path + ' : ' + $s.Reason) }; if ($Result.Skipped.Count -gt 12) { $lines.Add('  und ' + ($Result.Skipped.Count - 12) + ' weitere (siehe Protokoll)') } }
    if ($Result.Refused.Count) { $lines.Add(''); $lines.Add('Abgelehnt durch die Schutzprüfung: ' + $Result.Refused.Count); foreach ($s in ($Result.Refused | Select-Object -First 8)) { $lines.Add('  ' + $s.Path + ' : ' + $s.Reason) } }
    if ($Result.FreeBefore) { $lines.Add(''); foreach ($k in $Result.FreeBefore.Keys) { $lines.Add(('Freier Platz auf {0} vorher {1}, nachher {2}' -f $k, (Format-Size $Result.FreeBefore[$k]), (Format-Size $Result.FreeAfter[$k]))) } }
    $lines.Add(''); $lines.Add('Protokoll: ' + $Result.LogFile)
    [void][System.Windows.Forms.MessageBox]::Show(($lines -join "`r`n"), $Title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
}

# Bestätigung für "Auswahl löschen": Zahl, Größe, erste Pfade, Wahl Papierkorb (Standard) oder endgültig
function Show-DeleteConfirm {
    param([string[]]$Paths, [long]$Bytes)
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Auswahl löschen'; $f.StartPosition = 'CenterParent'; $f.Size = New-Object System.Drawing.Size(640, 420)
    $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ShowInTaskbar = $false
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Location = '12,12'; $lbl.Size = '600,40'
    $lbl.Text = ('{0} Elemente, zusammen {1}, sollen gelöscht werden. Die ersten Pfade:' -f $Paths.Count, (Format-Size $Bytes))
    $lb = New-Object System.Windows.Forms.ListBox
    $lb.Location = '12,56'; $lb.Size = '600,150'; $lb.HorizontalScrollBar = $true
    foreach ($p in ($Paths | Select-Object -First 8)) { [void]$lb.Items.Add($p) }
    if ($Paths.Count -gt 8) { [void]$lb.Items.Add('und ' + ($Paths.Count - 8) + ' weitere') }
    $rb1 = New-Object System.Windows.Forms.RadioButton
    $rb1.Location = '12,216'; $rb1.Size = '600,40'; $rb1.Checked = $true
    $rb1.Text = 'In den Papierkorb verschieben (empfohlen). Der Platz wird erst frei, wenn der Papierkorb geleert wird.'
    $rb2 = New-Object System.Windows.Forms.RadioButton
    $rb2.Location = '12,260'; $rb2.Size = '600,24'
    $rb2.Text = 'Endgültig löschen (nicht rückgängig zu machen)'
    $ok = New-Object System.Windows.Forms.Button; $ok.Text = 'Löschen'; $ok.Location = '420,340'; $ok.Size = '90,30'; $ok.DialogResult = 'OK'
    $cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'Abbrechen'; $cancel.Location = '520,340'; $cancel.Size = '90,30'; $cancel.DialogResult = 'Cancel'
    $f.Controls.AddRange(@($lbl, $lb, $rb1, $rb2, $ok, $cancel))
    $f.AcceptButton = $cancel; $f.CancelButton = $cancel
    $dr = $f.ShowDialog($script:Ui.Form)
    $permanent = $rb2.Checked
    $f.Dispose()
    if ($dr -ne 'OK') { return $null }
    if ($permanent) {
        $m = [System.Windows.Forms.MessageBox]::Show(('{0} Elemente werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden.' -f $Paths.Count), 'Endgültig löschen?', [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Warning, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
        if ($m -ne 'OK') { return $null }
    }
    return @{ Permanent = $permanent }
}

function Get-PathsSize {
    param([string[]]$Paths)
    $sum = [long]0
    foreach ($p in $Paths) {
        $node = $script:Ui.NodeByPath[$p]
        if ($node) { $sum += $node.Size }
        elseif ($script:Ui.FileSize.ContainsKey($p)) { $sum += $script:Ui.FileSize[$p] }
        else { try { $sum += (New-Object System.IO.FileInfo((ConvertTo-LongPath $p))).Length } catch { } }
    }
    return $sum
}

function Invoke-DeleteFromGui {
    param([string[]]$Paths)
    if (-not $Paths -or $Paths.Count -eq 0) { return }
    # geschützte Pfade vorab mit Begründung ablehnen
    $ok = New-Object 'System.Collections.Generic.List[string]'; $bad = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in $Paths) { $c = Test-SafeDeletePath -Path $p -Context Manual; if ($c.Safe) { $ok.Add($p) } else { $bad.Add($p + ' : ' + $c.Reason) } }
    if ($bad.Count) { [void][System.Windows.Forms.MessageBox]::Show(("Diese Pfade werden nicht gelöscht:`r`n`r`n" + (($bad | Select-Object -First 10) -join "`r`n")), 'Geschützt', 'OK', 'Warning') }
    if ($ok.Count -eq 0) { return }
    $bytes = Get-PathsSize $ok.ToArray()
    $choice = Show-DeleteConfirm -Paths $ok.ToArray() -Bytes $bytes
    if (-not $choice) { return }
    $script:Ui.Form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
    try {
        $r = Invoke-GuiDelete -Paths $ok.ToArray() -Permanent $choice.Permanent -Confirm { $true } -Progress { param($n, $p) $script:Ui.StatusLabel.Text = ('Lösche … ' + $n + ' Dateien'); [System.Windows.Forms.Application]::DoEvents() }
    } finally { $script:Ui.Form.Cursor = [System.Windows.Forms.Cursors]::Default }
    Show-ResultDialog -Result $r.Result
    Update-DriveInfo
    $script:Ui.StatusLabel.Text = 'Die Ansicht zeigt den Stand des letzten Scans. Für aktuelle Größen neu scannen.'
}

function Update-DriveInfo {
    $d = Get-DriveText $script:Ui.PathBox.Text
    if ($d) {
        $script:Ui.FreeLabel.Text = ('{0} frei von {1} ({2} frei)' -f (Format-Size $d.Free), (Format-Size $d.Total), (Format-Percent $d.Free $d.Total))
        $pct = [int][math]::Round(($d.Used / [double]$d.Total) * 100)
        $script:Ui.FreeBar.Value = [math]::Max(0, [math]::Min(100, $pct))
    } else { $script:Ui.FreeLabel.Text = 'Keine Angaben zum Datenträger'; $script:Ui.FreeBar.Value = 0 }
}

function Add-TreeChildren {
    param($TreeNode)
    $node = $TreeNode.Tag
    $TreeNode.Nodes.Clear()
    $kids = @($node.Children | Sort-Object { $_.Size } -Descending)
    $parentSize = [double]$node.Size
    foreach ($c in $kids) {
        $t = New-Object System.Windows.Forms.TreeNode(('{0}  ({1}, {2})' -f $c.Name, (Format-Size $c.Size), (Format-Percent $c.Size $parentSize)))
        $t.Tag = $c
        if ($c.Children.Count -gt 0) { [void]$t.Nodes.Add((New-Object System.Windows.Forms.TreeNode('…'))) }
        [void]$TreeNode.Nodes.Add($t)
    }
}

function Show-FolderList {
    param($Node)
    $rows = New-Object 'System.Collections.Generic.List[object]'
    $parent = [double]$Node.Size
    foreach ($c in $Node.Children) { $rows.Add(@{ Name = $c.Name; Size = $c.Size; Pct = $(if ($parent -gt 0) { $c.Size / $parent } else { 0 }); Files = $c.Files; Modified = $c.Modified; Path = $c.Path; Folder = $true }) }
    if ($Node.OwnFiles -gt 0) { $rows.Add(@{ Name = '[Dateien in diesem Ordner]'; Size = $Node.OwnSize; Pct = $(if ($parent -gt 0) { $Node.OwnSize / $parent } else { 0 }); Files = $Node.OwnFiles; Modified = $Node.Modified; Path = $null; Folder = $false }) }
    $script:Ui.FolderRows = $rows
    Fill-FolderList
}

function Fill-FolderList {
    $lv = $script:Ui.FolderList
    $rows = $script:Ui.FolderRows.ToArray()
    $col = $script:Ui.FolderSort.Col; $desc = $script:Ui.FolderSort.Desc
    $key = switch ($col) { 0 { 'Name' } 1 { 'Size' } 2 { 'Pct' } 3 { 'Files' } 4 { 'Modified' } default { 'Size' } }
    $rows = @($rows | Sort-Object { $_[$key] } -Descending:$desc)
    $lv.BeginUpdate(); $lv.Items.Clear()
    foreach ($r in $rows) {
        $it = [System.Windows.Forms.ListViewItem]::new([string[]]@($r.Name, (Format-Size $r.Size), (($r.Pct * 100).ToString('N1', $script:De) + ' %'), ([string]$r.Files), $r.Modified.ToString('yyyy-MM-dd HH:mm')))
        $it.Tag = $r
        [void]$lv.Items.Add($it)
    }
    $lv.EndUpdate()
}

function Complete-Scan {
    $job = $script:Ui.ScanJob
    $result = $null
    try { $out = $job.Ps.EndInvoke($job.Handle); $result = $out | Where-Object { $_ -and $_.PSObject.Properties['Root'] } | Select-Object -First 1 } catch { $script:Ui.StatusLabel.Text = 'Scan fehlgeschlagen: ' + $_.Exception.Message }
    Stop-BackgroundJob $job
    $script:Ui.ScanJob = $null
    $script:Ui.BtnScan.Enabled = $true; $script:Ui.BtnCancel.Enabled = $false
    if (-not $result) { return }
    $script:Ui.Result = $result
    $script:Ui.NodeByPath = @{}; $script:Ui.FileSize = @{}
    $stack = New-Object 'System.Collections.Generic.Stack[object]'; $stack.Push($result.Root)
    while ($stack.Count) { $n = $stack.Pop(); $script:Ui.NodeByPath[$n.Path] = $n; foreach ($c in $n.Children) { $stack.Push($c) } }
    foreach ($f in $result.TopFiles) { $script:Ui.FileSize[$f.Path] = $f.Size }
    # Reiter füllen
    $tv = $script:Ui.Tree; $tv.BeginUpdate(); $tv.Nodes.Clear()
    $rootT = New-Object System.Windows.Forms.TreeNode(('{0}  ({1})' -f $result.Root.Path, (Format-Size $result.Root.Size)))
    $rootT.Tag = $result.Root
    [void]$tv.Nodes.Add($rootT)
    Add-TreeChildren $rootT
    $rootT.Expand(); $tv.SelectedNode = $rootT; $tv.EndUpdate()
    Show-FolderList $result.Root
    $lf = $script:Ui.FilesList; $lf.BeginUpdate(); $lf.Items.Clear()
    foreach ($f in $result.TopFiles) { $it = [System.Windows.Forms.ListViewItem]::new([string[]]@($f.Path, (Format-Size $f.Size), $f.Modified.ToString('yyyy-MM-dd HH:mm'), $f.Ext)); $it.Tag = $f; [void]$lf.Items.Add($it) }
    $lf.EndUpdate()
    $lt = $script:Ui.TypesList; $lt.BeginUpdate(); $lt.Items.Clear()
    foreach ($x in $result.Extensions) { $it = [System.Windows.Forms.ListViewItem]::new([string[]]@($x.Ext, (Format-Size $x.Size), (Format-Percent $x.Size $result.Root.Size), [string]$x.Count)); [void]$lt.Items.Add($it) }
    $lt.EndUpdate()
    $msg = ('{0} Dateien, {1} Ordner, {2} in {3} s. {4} Ordner nicht lesbar, {5} Verknüpfungen, nicht gezählt, {6} Cloud-Platzhalter, nicht gezählt.' -f $result.Files, $result.Dirs, (Format-Size $result.Bytes), $result.Seconds.ToString('N1', $script:De), $result.Errors, $result.Links, $result.Cloud)
    if ($result.Cancelled) { $msg = 'Abgebrochen, Summen unvollständig. ' + $msg }
    $script:Ui.StatusLabel.Text = $msg
    $script:Ui.ScanDone = $true
    Update-DriveInfo
}

function Start-ScanFromGui {
    if ($script:Ui.ScanJob) { return }
    $p = $script:Ui.PathBox.Text.Trim()
    if (-not [System.IO.Directory]::Exists($p)) { [void][System.Windows.Forms.MessageBox]::Show('Der Pfad existiert nicht.', 'Scannen', 'OK', 'Warning'); return }
    $state = [hashtable]::Synchronized(@{ Cancel = $false })
    $script:Ui.ScanState = $state
    $script:Ui.ScanStarted = Get-Date
    $script:Ui.ScanDone = $false
    $script:Ui.BtnScan.Enabled = $false; $script:Ui.BtnCancel.Enabled = $true
    $script:Ui.StatusLabel.Text = 'Scan läuft …'
    $script:Ui.ScanJob = Start-BackgroundJob -FunctionsText (Get-DiskScanJobScript) -CallText 'Invoke-DiskScan -Root $ScanRoot -State $ScanState -TopCount 200' -Variables @{ ScanRoot = $p; ScanState = $state }
}

function Start-TargetsFromGui {
    if ($script:Ui.TargetsJob) { return }
    $script:Ui.TargetsDone = $false
    $age = [int]$script:Ui.AgeBox.Value
    $script:Ui.BtnTargets.Enabled = $false
    $script:Ui.TargetsState = [hashtable]::Synchronized(@{ Cancel = $false })
    $call = 'Get-CleanupTargets -MinAgeDays $TgAge -ExtraRoots $TgExtra -SkipSystem:$TgSkipSystem -HintSizes:$TgHints -State $TgState'
    $script:Ui.TargetsJob = Start-BackgroundJob -FunctionsText (Get-TargetsJobScript) -CallText $call -Variables @{ TgAge = $age; TgExtra = @($ExtraCleanupRoot); TgSkipSystem = [bool]$SkipSystemTargets; TgHints = (-not $SkipHintSizes); TgState = $script:Ui.TargetsState }
}

function Complete-Targets {
    $job = $script:Ui.TargetsJob
    $targets = @()
    try { $targets = @($job.Ps.EndInvoke($job.Handle) | Where-Object { $_ -and $_.PSObject.Properties['Tier'] }) } catch { }
    Stop-BackgroundJob $job
    $script:Ui.TargetsJob = $null
    $script:Ui.Targets = $targets
    $script:Ui.BtnTargets.Enabled = $true
    $lv = $script:Ui.TargetList
    $script:Ui.Refilling = $true
    $lv.BeginUpdate(); $lv.Items.Clear()
    $groupSafe = $lv.Groups['safe']; $groupCare = $lv.Groups['care']
    foreach ($t in ($targets | Where-Object { $_.Tier -ne 'Hinweis' })) {
        $adm = if ($t.NeedsAdmin) { 'ja' } else { 'nein' }
        $age = if ($t.MinAgeDays -gt 0) { [string]$t.MinAgeDays + ' Tage' } else { 'kein' }
        $it = [System.Windows.Forms.ListViewItem]::new([string[]]@($t.Name, (Format-Size $t.Size), [string]$t.Count, $adm, $age))
        $it.Tag = $t
        $it.Group = $(if ($t.Tier -eq 'Bedacht') { $groupCare } else { $groupSafe })
        $it.ToolTipText = $t.Note + $(if ($t.NeedsAdmin -and -not $t.Available) { ' Dieses Ziel braucht Administratorrechte und ist deshalb nicht auswählbar.' } else { '' })
        if (-not $t.Available) { $it.ForeColor = [System.Drawing.Color]::Gray }
        [void]$lv.Items.Add($it)
        $it.Checked = ($t.Tier -eq 'Sicher' -and $t.Available -and $t.Paths.Count -gt 0)
    }
    $lv.EndUpdate()
    $script:Ui.Refilling = $false
    $hl = $script:Ui.HintList; $hl.BeginUpdate(); $hl.Items.Clear()
    foreach ($t in ($targets | Where-Object { $_.Tier -eq 'Hinweis' })) {
        $sz = if ($t.Size -ge 0) { Format-Size $t.Size } else { 'nicht ermittelt' }
        $it = [System.Windows.Forms.ListViewItem]::new([string[]]@($t.Name, $sz, $t.Note)); $it.ToolTipText = $t.Note; [void]$hl.Items.Add($it)
    }
    $hl.EndUpdate()
    $script:Ui.TargetsDone = $true
    Update-CleanupButtons
}

function Update-CleanupButtons {
    $n = 0
    foreach ($it in $script:Ui.TargetList.CheckedItems) { if ($it.Tag.Available -and $it.Tag.Paths.Count -gt 0) { $n++ } }
    $script:Ui.BtnCleanup.Enabled = ($n -gt 0 -and -not $script:Ui.TargetsJob)
}

function Invoke-CleanupFromGui {
    $sel = @(); foreach ($it in $script:Ui.TargetList.CheckedItems) { if ($it.Tag.Available -and $it.Tag.Paths.Count -gt 0) { $sel += $it.Tag } }
    if (-not $sel) { return }
    $sum = ($sel | Measure-Object -Property Size -Sum).Sum
    $lines = ($sel | ForEach-Object { ('{0}: {1}, {2} Dateien{3}' -f $_.Name, (Format-Size $_.Size), $_.Count, $(if ($_.MinAgeDays -gt 0) { ', älter als ' + $_.MinAgeDays + ' Tage' } else { '' })) }) -join "`r`n"
    $probe = $script:Ui.ChkProbe.Checked
    $head = if ($probe) { 'PROBELAUF: Es wird nichts gelöscht, nur ausgewertet.' } else { 'Diese Ziele werden endgültig aufgeräumt (ohne Papierkorb):' }
    $m = [System.Windows.Forms.MessageBox]::Show(($head + "`r`n`r`n" + $lines + "`r`n`r`nZusammen etwa " + (Format-Size $sum) + '. Fortfahren?'), 'Aufräumen bestätigen', [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ($m -ne 'OK') { return }
    $roots = @($sel | ForEach-Object { $_.Paths })
    $script:Ui.Form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
    try { $r = Remove-Selected -Mode Cleanup -Targets $sel -TargetRoots $roots -Probelauf:$probe -LogPath $script:LogDir -Progress { param($n, $p) $script:Ui.StatusLabel.Text = ('Räume auf … ' + $n + ' Dateien'); [System.Windows.Forms.Application]::DoEvents() } }
    finally { $script:Ui.Form.Cursor = [System.Windows.Forms.Cursors]::Default }
    Show-ResultDialog -Result $r -Title $(if ($probe) { 'Ergebnis des Probelaufs' } else { 'Ergebnis' })
    Update-DriveInfo
    if (-not $probe) { Start-TargetsFromGui }
}

function New-MainWindow {
    param([string]$StartPath)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName Microsoft.VisualBasic
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $ui = @{}
    $script:Ui = $ui
    $ui.NodeByPath = @{}; $ui.FileSize = @{}; $ui.FolderRows = @(); $ui.FolderSort = @{ Col = 1; Desc = $true }; $ui.Targets = @()
    $ui.ScanJob = $null; $ui.TargetsJob = $null; $ui.Result = $null; $ui.ScanDone = $false; $ui.TargetsDone = $false; $ui.Refilling = $false
    $font = New-Object System.Drawing.Font('Segoe UI', 9)
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Datenträger-Analyse ' + $ScriptVersion
    $f.Size = New-Object System.Drawing.Size(1100, 740); $f.MinimumSize = New-Object System.Drawing.Size(860, 560)
    $f.StartPosition = 'CenterScreen'; $f.Font = $font
    $ui.Form = $f
    $top = New-Object System.Windows.Forms.Panel; $top.Dock = 'Top'; $top.Height = 132
    $lblDrive = New-Object System.Windows.Forms.Label; $lblDrive.Text = 'Laufwerk:'; $lblDrive.Location = '10,12'; $lblDrive.AutoSize = $true
    $cb = New-Object System.Windows.Forms.ComboBox; $cb.DropDownStyle = 'DropDownList'; $cb.Location = '80,8'; $cb.Width = 80
    foreach ($d in [System.IO.DriveInfo]::GetDrives()) { if ($d.DriveType -eq 'Fixed' -and $d.IsReady) { [void]$cb.Items.Add($d.Name) } }
    $ui.DriveBox = $cb
    $lblPath = New-Object System.Windows.Forms.Label; $lblPath.Text = 'Pfad:'; $lblPath.Location = '176,12'; $lblPath.AutoSize = $true
    $pb = New-Object System.Windows.Forms.TextBox; $pb.Location = '216,8'; $pb.Width = 520; $pb.Anchor = 'Top,Left,Right'; $pb.Text = $StartPath
    $ui.PathBox = $pb
    $bs = New-Object System.Windows.Forms.Button; $bs.Text = 'Scannen'; $bs.Location = '750,6'; $bs.Size = '90,27'; $bs.Anchor = 'Top,Right'
    $bc = New-Object System.Windows.Forms.Button; $bc.Text = 'Abbrechen'; $bc.Location = '848,6'; $bc.Size = '90,27'; $bc.Anchor = 'Top,Right'; $bc.Enabled = $false
    $ui.BtnScan = $bs; $ui.BtnCancel = $bc
    $fl = New-Object System.Windows.Forms.Label; $fl.Location = '10,44'; $fl.Size = '560,20'; $fl.Text = ''
    $fb = New-Object System.Windows.Forms.ProgressBar; $fb.Location = '10,66'; $fb.Size = '560,16'; $fb.Anchor = 'Top,Left,Right'
    $ui.FreeLabel = $fl; $ui.FreeBar = $fb
    $pl = New-Object System.Windows.Forms.Label; $pl.Location = '10,90'; $pl.Size = '1060,36'; $pl.Anchor = 'Top,Left,Right'; $pl.Text = 'Bereit. Größen sind logische Dateigrößen (nicht der belegte Platz); Hardlinks sind nicht exakt erfassbar.'
    $ui.StatusLabel = $pl
    $admin = Test-IsAdmin
    $al = New-Object System.Windows.Forms.Label; $al.Location = '590,40'; $al.Size = '350,42'; $al.Anchor = 'Top,Right'; $al.ForeColor = [System.Drawing.Color]::DarkRed
    $al.Text = $(if ($admin) { 'Administratorrechte: ja' } else { 'Ohne Administratorrechte: Systemziele (Windows-Temp, Fehlerberichte u. a.) sind nicht verfügbar.' })
    $ba = New-Object System.Windows.Forms.Button; $ba.Text = 'Als Administrator neu starten'; $ba.Location = '946,44'; $ba.Size = '140,34'; $ba.Anchor = 'Top,Right'; $ba.Visible = (-not $admin)
    $ui.BtnAdmin = $ba
    $top.Controls.AddRange(@($lblDrive, $cb, $lblPath, $pb, $bs, $bc, $fl, $fb, $pl, $al, $ba))
    $tabs = New-Object System.Windows.Forms.TabControl; $tabs.Dock = 'Fill'
    $ui.Tabs = $tabs
    # Reiter 1: Ordner
    $t1 = New-Object System.Windows.Forms.TabPage('Ordner')
    $sp = New-Object System.Windows.Forms.SplitContainer; $sp.Dock = 'Fill'
    $ui.Split = $sp
    # Teilung erst setzen, wenn das Fenster seine Größe hat (vorher rutscht sie an den rechten Rand und die Liste zeigt nur eine Spalte)
    $f.Add_Shown({ try { $script:Ui.Split.SplitterDistance = [int]([math]::Max(200, $script:Ui.Split.Width * 0.5)) } catch { } })
    $tv = New-Object System.Windows.Forms.TreeView; $tv.Dock = 'Fill'; $tv.HideSelection = $false
    $ui.Tree = $tv
    $lv = New-Object System.Windows.Forms.ListView; $lv.Dock = 'Fill'; $lv.View = 'Details'; $lv.FullRowSelect = $true; $lv.MultiSelect = $true; $lv.HideSelection = $false
    foreach ($c in @(@('Name', 220), @('Größe', 90), @('Prozent', 70), @('Dateien', 80), @('Geändert', 120))) { [void]$lv.Columns.Add($c[0], $c[1]) }
    $ui.FolderList = $lv
    $bdel = New-Object System.Windows.Forms.Button; $bdel.Text = 'Auswahl löschen'; $bdel.Dock = 'Bottom'; $bdel.Height = 30; $bdel.Enabled = $false
    $ui.BtnDeleteFolder = $bdel
    $sp.Panel1.Controls.Add($tv); $sp.Panel2.Controls.Add($lv); $sp.Panel2.Controls.Add($bdel)
    $t1.Controls.Add($sp)
    # Reiter 2: Größte Dateien
    $t2 = New-Object System.Windows.Forms.TabPage('Größte Dateien')
    $lf = New-Object System.Windows.Forms.ListView; $lf.Dock = 'Fill'; $lf.View = 'Details'; $lf.FullRowSelect = $true; $lf.MultiSelect = $true; $lf.HideSelection = $false
    foreach ($c in @(@('Pfad', 560), @('Größe', 90), @('Geändert', 120), @('Endung', 70))) { [void]$lf.Columns.Add($c[0], $c[1]) }
    $ui.FilesList = $lf
    $bdel2 = New-Object System.Windows.Forms.Button; $bdel2.Text = 'Auswahl löschen'; $bdel2.Dock = 'Bottom'; $bdel2.Height = 30; $bdel2.Enabled = $false
    $ui.BtnDeleteFiles = $bdel2
    $t2.Controls.Add($lf); $t2.Controls.Add($bdel2)
    # Reiter 3: Dateitypen
    $t3 = New-Object System.Windows.Forms.TabPage('Dateitypen')
    $lt = New-Object System.Windows.Forms.ListView; $lt.Dock = 'Fill'; $lt.View = 'Details'; $lt.FullRowSelect = $true
    foreach ($c in @(@('Endung', 140), @('Größe', 100), @('Anteil', 80), @('Dateien', 100))) { [void]$lt.Columns.Add($c[0], $c[1]) }
    $ui.TypesList = $lt
    $t3.Controls.Add($lt)
    # Reiter 4: Aufräumen
    $t4 = New-Object System.Windows.Forms.TabPage('Aufräumen')
    $tl = New-Object System.Windows.Forms.ListView; $tl.Dock = 'Fill'; $tl.View = 'Details'; $tl.CheckBoxes = $true; $tl.FullRowSelect = $true; $tl.ShowItemToolTips = $true; $tl.HideSelection = $false
    foreach ($c in @(@('Ziel', 330), @('Größe', 90), @('Dateien', 80), @('Administrator', 90), @('Mindestalter', 90))) { [void]$tl.Columns.Add($c[0], $c[1]) }
    [void]$tl.Groups.Add((New-Object System.Windows.Forms.ListViewGroup('safe', 'Sicher (vorausgewählt)')))
    [void]$tl.Groups.Add((New-Object System.Windows.Forms.ListViewGroup('care', 'Mit Bedacht (nicht vorausgewählt): nur, wenn kein Update läuft')))
    $ui.TargetList = $tl
    $hint = New-Object System.Windows.Forms.ListView; $hint.Dock = 'Bottom'; $hint.Height = 150; $hint.View = 'Details'; $hint.FullRowSelect = $true; $hint.ShowItemToolTips = $true
    foreach ($c in @(@('Nur Hinweis (wird nie gelöscht)', 250), @('Größe', 100), @('So bereinigen Sie es', 620))) { [void]$hint.Columns.Add($c[0], $c[1]) }
    $ui.HintList = $hint
    $bar = New-Object System.Windows.Forms.Panel; $bar.Dock = 'Top'; $bar.Height = 40
    $lage = New-Object System.Windows.Forms.Label; $lage.Text = 'Älter als (Tage):'; $lage.Location = '8,12'; $lage.AutoSize = $true
    $nud = New-Object System.Windows.Forms.NumericUpDown; $nud.Location = '110,8'; $nud.Width = 60; $nud.Minimum = 0; $nud.Maximum = 3650; $nud.Value = 7
    $ui.AgeBox = $nud
    $chk = New-Object System.Windows.Forms.CheckBox; $chk.Text = 'Probelauf (nichts löschen)'; $chk.Location = '190,9'; $chk.AutoSize = $true; $chk.Checked = $false
    $ui.ChkProbe = $chk
    $btg = New-Object System.Windows.Forms.Button; $btg.Text = 'Ziele neu ermitteln'; $btg.Location = '390,5'; $btg.Size = '140,28'
    $ui.BtnTargets = $btg
    $bcl = New-Object System.Windows.Forms.Button; $bcl.Text = 'Ausgewählte aufräumen'; $bcl.Location = '540,5'; $bcl.Size = '160,28'; $bcl.Enabled = $false
    $ui.BtnCleanup = $bcl
    $bar.Controls.AddRange(@($lage, $nud, $chk, $btg, $bcl))
    $t4.Controls.Add($tl); $t4.Controls.Add($hint); $t4.Controls.Add($bar)
    $tabs.TabPages.AddRange(@($t1, $t2, $t3, $t4))
    $f.Controls.Add($tabs); $f.Controls.Add($top)
    # Kontextmenüs
    $mk = {
        param($withDelete)
        $cm = New-Object System.Windows.Forms.ContextMenuStrip
        $m1 = $cm.Items.Add('Im Explorer zeigen'); $m2 = $cm.Items.Add('Pfad kopieren'); $m3 = $cm.Items.Add('Auswahl löschen')
        return @{ Menu = $cm; Show = $m1; Copy = $m2; Delete = $m3 }
    }
    $cmF = & $mk $true; $lv.ContextMenuStrip = $cmF.Menu
    $cmT = & $mk $true; $tv.ContextMenuStrip = $cmT.Menu
    $cmL = & $mk $true; $lf.ContextMenuStrip = $cmL.Menu
    $ui.SelFolderPaths = { @($script:Ui.FolderList.SelectedItems | Where-Object { $_.Tag.Path } | ForEach-Object { $_.Tag.Path }) }
    $ui.SelFilePaths = { @($script:Ui.FilesList.SelectedItems | ForEach-Object { $_.Tag.Path }) }
    $ui.ShowIn = { param($p) if ($p -and (Test-Path -LiteralPath $p)) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $p + '"') } }
    $cmF.Show.Add_Click({ $p = @(& $script:Ui.SelFolderPaths) | Select-Object -First 1; & $script:Ui.ShowIn $p })
    $cmF.Copy.Add_Click({ $p = @(& $script:Ui.SelFolderPaths) | Select-Object -First 1; if ($p) { [System.Windows.Forms.Clipboard]::SetText($p) } })
    $cmF.Delete.Add_Click({ Invoke-DeleteFromGui -Paths @(& $script:Ui.SelFolderPaths) })
    $cmT.Show.Add_Click({ $n = $script:Ui.Tree.SelectedNode; if ($n) { & $script:Ui.ShowIn $n.Tag.Path } })
    $cmT.Copy.Add_Click({ $n = $script:Ui.Tree.SelectedNode; if ($n) { [System.Windows.Forms.Clipboard]::SetText($n.Tag.Path) } })
    $cmT.Delete.Add_Click({ $n = $script:Ui.Tree.SelectedNode; if ($n) { Invoke-DeleteFromGui -Paths @($n.Tag.Path) } })
    $cmL.Show.Add_Click({ $p = @(& $script:Ui.SelFilePaths) | Select-Object -First 1; & $script:Ui.ShowIn $p })
    $cmL.Copy.Add_Click({ $p = @(& $script:Ui.SelFilePaths) | Select-Object -First 1; if ($p) { [System.Windows.Forms.Clipboard]::SetText($p) } })
    $cmL.Delete.Add_Click({ Invoke-DeleteFromGui -Paths @(& $script:Ui.SelFilePaths) })
    # Ereignisse
    $cb.Add_SelectedIndexChanged({ if ($script:Ui.DriveBox.SelectedItem) { $script:Ui.PathBox.Text = [string]$script:Ui.DriveBox.SelectedItem; Update-DriveInfo } })
    $bs.Add_Click({ Start-ScanFromGui })
    $bc.Add_Click({ if ($script:Ui.ScanState) { $script:Ui.ScanState.Cancel = $true } })
    $tv.Add_BeforeExpand({ param($s, $e) $n = $e.Node; if ($n.Nodes.Count -eq 1 -and $n.Nodes[0].Tag -eq $null -and $n.Tag.Children.Count -gt 0) { Add-TreeChildren $n } })
    $tv.Add_AfterSelect({ param($s, $e) if ($e.Node -and $e.Node.Tag) { Show-FolderList $e.Node.Tag } })
    $lv.Add_ColumnClick({ param($s, $e) $st = $script:Ui.FolderSort; if ($st.Col -eq $e.Column) { $st.Desc = -not $st.Desc } else { $st.Col = $e.Column; $st.Desc = ($e.Column -ne 0) }; Fill-FolderList })
    $lv.Add_SelectedIndexChanged({ $script:Ui.BtnDeleteFolder.Enabled = (@(& { $script:Ui.FolderList.SelectedItems | Where-Object { $_.Tag.Path } }).Count -gt 0) })
    $lf.Add_SelectedIndexChanged({ $script:Ui.BtnDeleteFiles.Enabled = ($script:Ui.FilesList.SelectedItems.Count -gt 0) })
    $bdel.Add_Click({ Invoke-DeleteFromGui -Paths @($script:Ui.FolderList.SelectedItems | Where-Object { $_.Tag.Path } | ForEach-Object { $_.Tag.Path }) })
    $bdel2.Add_Click({ Invoke-DeleteFromGui -Paths @($script:Ui.FilesList.SelectedItems | ForEach-Object { $_.Tag.Path }) })
    $tl.Add_ItemCheck({ param($s, $e) if (-not $script:Ui.Refilling) { $it = $s.Items[$e.Index]; if ($it.Tag -and -not ($it.Tag.Available -and $it.Tag.Paths.Count -gt 0)) { $e.NewValue = $e.CurrentValue } } })
    $tl.Add_ItemChecked({ Update-CleanupButtons })
    $btg.Add_Click({ Start-TargetsFromGui })
    $bcl.Add_Click({ Invoke-CleanupFromGui })
    $ba.Add_Click({
        $m = [System.Windows.Forms.MessageBox]::Show('Das Programm wird mit Administratorrechten neu gestartet (Windows fragt nach). Fortfahren?', 'Als Administrator neu starten', [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
        if ($m -ne 'OK') { return }
        try {
            $exe = (Get-Process -Id $PID).Path
            $argText = '-NoProfile -ExecutionPolicy Bypass -STA -File "' + $script:ScriptPath + '" -Path "' + $script:Ui.PathBox.Text + '"'
            Start-Process -FilePath $exe -ArgumentList $argText -Verb RunAs -ErrorAction Stop
            $script:Ui.Form.Close()
        } catch { [void][System.Windows.Forms.MessageBox]::Show('Der Neustart wurde nicht ausgeführt: ' + $_.Exception.Message, 'Als Administrator neu starten', 'OK', 'Information') }
    })
    # Timer: fragt den Fortschritt ab (keine Ereignishandler aus dem Runspace)
    $timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 300
    $timer.Add_Tick({
      $ui2 = $script:Ui
      try {
        if ($ui2.ScanJob) {
            if ($ui2.ScanJob.Handle.IsCompleted) { Complete-Scan }
            elseif ($ui2.ScanState) {
                $s = $ui2.ScanState
                $sec = ((Get-Date) - $ui2.ScanStarted).TotalSeconds
                $ui2.StatusLabel.Text = ('Scan läuft: {0} Dateien, {1} Ordner, {2}, {3} nicht lesbar, {4} s. {5}' -f $s.Files, $s.Dirs, (Format-Size $s.Bytes), $s.Errors, $sec.ToString('N0', $script:De), $s.Current)
            }
        }
        if ($ui2.TargetsJob -and $ui2.TargetsJob.Handle.IsCompleted) { Complete-Targets }
      } catch {
        $ui2.LastError = $_.Exception.Message + ' (Zeile ' + $_.InvocationInfo.ScriptLineNumber + ')'
        $ui2.StatusLabel.Text = 'Fehler in der Oberfläche: ' + $ui2.LastError
        if ($ui2.ScanJob -and $ui2.ScanJob.Handle.IsCompleted) { Stop-BackgroundJob $ui2.ScanJob; $ui2.ScanJob = $null; $ui2.BtnScan.Enabled = $true; $ui2.BtnCancel.Enabled = $false }
      }
    })
    $ui.Timer = $timer
    $f.Add_Shown({ $script:Ui.Timer.Start(); Start-TargetsFromGui })
    $f.Add_FormClosing({
        $script:Ui.Timer.Stop()
        if ($script:Ui.ScanState) { $script:Ui.ScanState.Cancel = $true }
        if ($script:Ui.TargetsState) { $script:Ui.TargetsState.Cancel = $true }
        Stop-BackgroundJob $script:Ui.ScanJob; $script:Ui.ScanJob = $null
        Stop-BackgroundJob $script:Ui.TargetsJob; $script:Ui.TargetsJob = $null
    })
    $sel = $cb.Items.IndexOf((Get-NormalizedPath $StartPath).Substring(0, 3))
    if ($sel -ge 0) { $cb.SelectedIndex = $sel; $pb.Text = $StartPath }
    Update-DriveInfo
    return $f
}

# Rauchtest der Oberfläche: baut das Fenster, scannt -Path, prüft Bäume, Listen, Knöpfe; löscht nichts außer bei ausdrücklicher Bestätigung in der Prüflogik
function Invoke-GuiSelfTest {
    param([string]$Root)
    $fails = New-Object 'System.Collections.Generic.List[string]'
    $check = { param($ok, $msg) if ($ok) { Write-Output ('OK: ' + $msg) } else { Write-Output ('FEHLER: ' + $msg); $fails.Add($msg) } }
    if (-not [Environment]::UserInteractive) { Write-Output 'NICHT GEPRÜFT: keine Desktopsitzung'; $script:ExitCode = 2; return }
    $form = $null
    try {
        $form = New-MainWindow -StartPath $Root
        $form.ShowInTaskbar = $false; $form.Opacity = 0
        $form.Show()
        [System.Windows.Forms.Application]::DoEvents()
        & $check ($form.Handle -ne [IntPtr]::Zero) 'Fenster wurde gebaut'
        & $check (-not $script:Ui.BtnDeleteFolder.Enabled -and -not $script:Ui.BtnDeleteFiles.Enabled -and -not $script:Ui.BtnCleanup.Enabled) 'Löschen und Aufräumen sind ohne Auswahl gesperrt'
        $script:Ui.PathBox.Text = $Root
        Start-ScanFromGui
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not $script:Ui.ScanDone -and $watch.Elapsed.TotalSeconds -lt 120) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
        & $check $script:Ui.ScanDone ('Scan im Hintergrund beendet' + $(if ($script:Ui.LastError) { ' [' + $script:Ui.LastError + ']' } else { '' }))
        $res = $script:Ui.Result
        $ref = Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }
        $refSize = [long]($ref | Measure-Object -Property Length -Sum).Sum
        & $check ($res -and $res.Root.Size -eq $refSize) ('Summe des Baums stimmt (' + $(if ($res) { $res.Root.Size } else { '?' }) + ' erwartet ' + $refSize + ')')
        & $check ($res -and $res.Files -eq @($ref).Count) 'Dateizahl stimmt'
        & $check ($script:Ui.Tree.Nodes.Count -eq 1 -and $script:Ui.Tree.Nodes[0].Tag.Size -eq $refSize) 'Baum enthält den Wurzelknoten mit der Summe'
        & $check ($script:Ui.Tree.Nodes[0].Nodes.Count -eq $res.Root.Children.Count) 'Baum enthält alle Unterordner der ersten Ebene'
        & $check ($script:Ui.FolderList.Items.Count -ge $res.Root.Children.Count) 'Liste der Ordner gefüllt'
        & $check ($script:Ui.FilesList.Items.Count -eq [math]::Min(200, @($ref).Count)) 'Liste der größten Dateien gefüllt'
        & $check ($script:Ui.TypesList.Items.Count -eq $res.Extensions.Count -and $res.Extensions.Count -gt 0) 'Liste der Dateitypen gefüllt'
        $w2 = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not $script:Ui.TargetsDone -and $w2.Elapsed.TotalSeconds -lt 120) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
        & $check $script:Ui.TargetsDone 'Aufräumziele ermittelt'
        $extraNames = @($script:Ui.TargetList.Items | Where-Object { $_.Text -like 'Zusatzziel:*' })
        & $check ($extraNames.Count -eq @($ExtraCleanupRoot).Count) ('Reiter Aufräumen zeigt die Ziele des Testbaums (' + $extraNames.Count + ')')
        & $check (@($script:Ui.TargetList.Items | Where-Object { $_.Checked }).Count -ge 1) 'Ziele der Stufe Sicher sind vorausgewählt'
        & $check (-not ($script:Ui.TargetList.Items | Where-Object { $_.Tag.Tier -eq 'Bedacht' -and $_.Checked })) 'Ziele "Mit Bedacht" sind nicht vorausgewählt'
        & $check ($script:Ui.HintList.Items.Count -ge 1 -or $SkipSystemTargets) 'Nur-Hinweis-Einträge vorhanden'
        & $check (-not $script:Ui.ChkProbe.Checked) 'Probelauf ist standardmäßig aus, aber sichtbar'
        # Löschaufruf ohne Bestätigung löscht nichts
        $victim = Join-Path $Root 'selbsttest-nicht-loeschen.txt'
        [System.IO.File]::WriteAllText($victim, 'x')
        $out = Invoke-GuiDelete -Paths @($victim) -Permanent $true -Confirm $null
        & $check ($out.Cancelled -and [System.IO.File]::Exists($victim)) 'Löschaufruf ohne Bestätigung löscht nichts'
        $out2 = Invoke-GuiDelete -Paths @($victim) -Permanent $true -Confirm { $false }
        & $check ($out2.Cancelled -and [System.IO.File]::Exists($victim)) 'Löschaufruf mit Nein löscht nichts'
        Remove-Item -LiteralPath $victim -Force -ErrorAction SilentlyContinue
        $job = $script:Ui.ScanJob
        $form.Close()
        [System.Windows.Forms.Application]::DoEvents()
        & $check (-not $script:Ui.ScanJob -and -not $script:Ui.TargetsJob) 'Hintergrundjobs sind beendet'
    } catch { & $check $false ('Ausnahme: ' + $_.Exception.Message) }
    finally { if ($form) { try { $form.Dispose() } catch { } } }
    if ($fails.Count -gt 0) { Write-Output ('SELBSTTEST: ' + $fails.Count + ' Fehler'); $script:ExitCode = 1; return }
    Write-Output 'SELBSTTEST: bestanden'
    $script:ExitCode = 0
}

# ============================================================
# Start
# ============================================================
function Invoke-Main {
    if ([string]::IsNullOrWhiteSpace($Path)) { $Path = if ($env:SystemDrive) { $env:SystemDrive + '\' } else { 'C:\' } }
    $script:LogDir = Get-LogFolder $LogPath
    if (-not [System.IO.Directory]::Exists($Path)) { Write-Output ('FEHLER: Der Pfad existiert nicht: ' + $Path); $script:ExitCode = 1; return }
    $Path = Get-NormalizedPath $Path
    if ($SelfTest) { Invoke-GuiSelfTest -Root $Path; return }
    if ($NoGui -or $ExportHtml) {
        $ctx = Get-ScanContext -Root $Path -Top $Top
        if ($NoGui) { New-TextReport -Scan $ctx.Scan -Targets $ctx.Targets -Drive $ctx.Drive -Top $Top }
        if ($ExportHtml) {
            $html = New-HtmlReport -Scan $ctx.Scan -Targets $ctx.Targets -Drive $ctx.Drive -Top ([math]::Max($Top, 50))
            [System.IO.File]::WriteAllText($ExportHtml, $html, (New-Object System.Text.UTF8Encoding($false)))
            Write-Output ('Bericht geschrieben: ' + $ExportHtml)
        }
        $script:ExitCode = 0
        return
    }
    # Oberfläche braucht einen STA-Thread
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
        $exe = (Get-Process -Id $PID).Path
        $argText = '-NoProfile -ExecutionPolicy Bypass -STA -File "' + $script:ScriptPath + '" -Path "' + $Path + '"'
        if ($LogPath) { $argText += ' -LogPath "' + $LogPath + '"' }
        $p = Start-Process -FilePath $exe -ArgumentList $argText -Wait -PassThru
        $script:ExitCode = $p.ExitCode
        return
    }
    $form = New-MainWindow -StartPath $Path
    [void][System.Windows.Forms.Application]::Run($form)
    $script:ExitCode = 0
}

if (-not $script:IsDotSourced) {
    Invoke-Main
    exit $script:ExitCode
}
