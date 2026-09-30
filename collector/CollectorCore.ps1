<#
  업무보고 자동수집기 — Outlook 과 상관없는 순수 함수 모음 (Collect-OutlookMail.ps1 이 불러 씁니다)

  - 워드(.docx)·파워포인트(.pptx)·엑셀(.xlsx) 글 뽑기: 이 파일들은 zip 이라 안의 XML 을 바로 읽습니다.
    Office 를 띄우지 않고(설치 여부와 상관없이), 인터넷도 쓰지 않습니다.
  - 규칙은 js/collect-logic.js 의 docxXmlToText · pptxSlidesToText · xlsxToText 와 「같은 규칙」입니다(쌍둥이).
    macOS 개발 PC 에서는 PowerShell 을 돌릴 수 없어 JS 쌍둥이로 같은 예시 파일을 검사했습니다.
    Windows 에서는 collector\Test-Collector.ps1 로 이 파일이 JS 와 같은 글을 뽑는지 확인합니다.
  - 보고 기간 계산, 설정 파일 읽기, JSON 쓰기, 안전한 파일 이름도 여기 있습니다.
  이 파일은 UTF-8(BOM) 입니다 — Windows PowerShell 5.1 에서 한글이 깨지지 않게.
#>

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# ── XML 글자 풀기 (&lt; &amp; &#xAC00; …) ──
function ConvertFrom-XmlText([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return '' }
  $ev = [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    $k = $m.Groups[1].Value
    switch ($k) { 'lt' { return '<' } 'gt' { return '>' } 'amp' { return '&' } 'quot' { return '"' } 'apos' { return "'" } }
    try {
      if ($k.Substring(1, 1) -eq 'x') { $n = [Convert]::ToInt32($k.Substring(2), 16) } else { $n = [int]$k.Substring(1) }
      return [char]::ConvertFromUtf32($n)
    } catch { return '' }
  }
  return [regex]::Replace($s, '&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);', $ev)
}
function Format-Lines([string[]]$lines) {
  $t = (@($lines | ForEach-Object { ([string]$_) -replace '[ \t]+\z', '' }) -join "`n")
  $t = [regex]::Replace($t, '\n{3,}', "`n`n")
  return $t.Trim()
}

# ── Word ──
function Get-DocxParaText([string]$p) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($m in [regex]::Matches($p, '<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:tab/>|<w:br[^>]*/>|<w:cr/>')) {
    if ($m.Groups[1].Success) { [void]$sb.Append((ConvertFrom-XmlText $m.Groups[1].Value)) }
    elseif ($m.Value -eq '<w:tab/>') { [void]$sb.Append("`t") }
    else { [void]$sb.Append("`n") }
  }
  return $sb.ToString()
}
function Get-DocxTextFromXml([string]$xml) {
  $bm = [regex]::Match($xml, '<w:body[^>]*>([\s\S]*)</w:body>')
  $body = $xml; if ($bm.Success) { $body = $bm.Groups[1].Value }
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($m in [regex]::Matches($body, '<w:tbl>[\s\S]*?</w:tbl>|<w:p[ >][\s\S]*?</w:p>')) {
    $blk = $m.Value
    if ($blk.StartsWith('<w:tbl>')) {
      foreach ($tr in [regex]::Matches($blk, '<w:tr[ >][\s\S]*?</w:tr>')) {
        $cells = @()
        foreach ($tc in [regex]::Matches($tr.Value, '<w:tc[ >][\s\S]*?</w:tc>')) {
          $ps = @(); foreach ($p in [regex]::Matches($tc.Value, '<w:p[ >][\s\S]*?</w:p>')) { $ps += (Get-DocxParaText $p.Value) }
          $cells += ($ps -join ' ').Trim()
        }
        $out.Add(($cells -join ' | '))
      }
    } else { $out.Add((Get-DocxParaText $blk)) }
  }
  return Format-Lines $out.ToArray()
}

# ── PowerPoint — $slides = @( @{ n = 1; xml = '…' } … ) ──
function Get-PptxTextFromSlides($slides) {
  $blocks = @()
  foreach ($s in @($slides | Sort-Object { [int]$_.n })) {
    $lines = @()
    foreach ($m in [regex]::Matches([string]$s.xml, '<a:p[ >][\s\S]*?</a:p>')) {
      $sb = New-Object System.Text.StringBuilder
      foreach ($k in [regex]::Matches($m.Value, '<a:t>([^<]*)</a:t>|<a:br[^>]*/>')) {
        if ($k.Groups[1].Success) { [void]$sb.Append((ConvertFrom-XmlText $k.Groups[1].Value)) } else { [void]$sb.Append("`n") }
      }
      $t = $sb.ToString().Trim()
      if ($t) { $lines += $t }
    }
    $blocks += ('[슬라이드 ' + $s.n + "]`n" + ($lines -join "`n"))
  }
  return Format-Lines $blocks
}

# ── Excel ──
function Get-XmlAttr([string]$tag, [string]$name) {
  $m = [regex]::Match($tag, '\s' + [regex]::Escape($name) + '="([^"]*)"')
  if ($m.Success) { return (ConvertFrom-XmlText $m.Groups[1].Value) } else { return '' }
}
function Get-XlsxShared([string]$xml) {
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($si in [regex]::Matches([string]$xml, '<si>[\s\S]*?</si>')) {
    $s = [regex]::Replace($si.Value, '<rPh[\s\S]*?</rPh>', '')
    $sb = New-Object System.Text.StringBuilder
    foreach ($m in [regex]::Matches($s, '<t(?:\s[^>]*)?>([^<]*)</t>')) { [void]$sb.Append((ConvertFrom-XmlText $m.Groups[1].Value)) }
    $list.Add($sb.ToString())
  }
  return , $list.ToArray()
}
function Get-XlsxSheetList([string]$workbookXml, [string]$relsXml) {
  $rels = @{}
  foreach ($r in [regex]::Matches([string]$relsXml, '<Relationship\b[^>]*/?>')) { $rels[(Get-XmlAttr $r.Value 'Id')] = (Get-XmlAttr $r.Value 'Target') }
  $out = @()
  foreach ($s in [regex]::Matches([string]$workbookXml, '<sheet\b[^>]*/?>')) {
    $t = [string]$rels[(Get-XmlAttr $s.Value 'r:id')]
    if ($t.StartsWith('/')) { $p = $t.Substring(1) } else { $p = 'xl/' + ($t -replace '^\./', '') }
    $out += , @{ name = (Get-XmlAttr $s.Value 'name'); path = $p }
  }
  return , $out
}
function Get-XlsxSheetLines([string]$xml, [string[]]$shared, [int]$maxRows = 200) {
  $lines = @()
  foreach ($m in [regex]::Matches([string]$xml, '<row\b[^>]*?(?:/>|>([\s\S]*?)</row>)')) {
    if ($lines.Count -ge $maxRows) { break }
    if (-not $m.Groups[1].Success) { continue }
    $vals = @()
    foreach ($c in [regex]::Matches($m.Groups[1].Value, '<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)')) {
      $t = Get-XmlAttr (' ' + $c.Groups[1].Value) 't'
      $inner = ''; if ($c.Groups[2].Success) { $inner = $c.Groups[2].Value }
      $vm = [regex]::Match($inner, '<v>([^<]*)</v>')
      $val = ''
      if ($t -eq 's') { $i = 0; if ($vm.Success -and [int]::TryParse($vm.Groups[1].Value, [ref]$i) -and $i -lt $shared.Count) { $val = $shared[$i] } }
      elseif ($t -eq 'inlineStr') { foreach ($q in [regex]::Matches($inner, '<t(?:\s[^>]*)?>([^<]*)</t>')) { $val += (ConvertFrom-XmlText $q.Groups[1].Value) } }
      elseif ($t -eq 'b') { if ($vm.Success) { if ($vm.Groups[1].Value -eq '1') { $val = 'TRUE' } elseif ($vm.Groups[1].Value -eq '0') { $val = 'FALSE' } } }
      elseif ($vm.Success) { $val = ConvertFrom-XmlText $vm.Groups[1].Value }
      if ($val.Trim()) { $vals += $val.Trim() }
    }
    if ($vals.Count) { $lines += ($vals -join ' | ') }
  }
  return , $lines
}
function Get-XlsxText($parts) {
  $shared = Get-XlsxShared $parts.shared
  $blocks = @()
  foreach ($s in (Get-XlsxSheetList $parts.workbook $parts.rels)) {
    if (-not $parts.sheets.ContainsKey($s.path) -or $null -eq $parts.sheets[$s.path]) { continue }
    $blocks += ('[시트 ' + $s.name + "]`n" + ((Get-XlsxSheetLines $parts.sheets[$s.path] $shared) -join "`n"))
  }
  return Format-Lines $blocks
}

# ── zip 파일에서 읽기 ──
function Read-ZipEntryText($zip, [string]$name) {
  $e = $zip.GetEntry($name)
  if ($null -eq $e) { return $null }
  $sr = New-Object System.IO.StreamReader($e.Open(), (New-Object System.Text.UTF8Encoding($false)))
  try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
}
<# 파일 → 글. $kind = word | ppt | excel. 읽기 전용으로 엽니다(원본을 바꾸지 않음) #>
function Get-OoxmlTextFromFile([string]$path, [string]$kind) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    if ($kind -eq 'word') { $x = Read-ZipEntryText $zip 'word/document.xml'; if ($null -eq $x) { return '' }; return Get-DocxTextFromXml $x }
    if ($kind -eq 'ppt') {
      $slides = @()
      foreach ($e in $zip.Entries) {
        $m = [regex]::Match($e.FullName, '^ppt/slides/slide(\d+)\.xml$')
        if ($m.Success) { $slides += , @{ n = [int]$m.Groups[1].Value; xml = (Read-ZipEntryText $zip $e.FullName) } }
      }
      return Get-PptxTextFromSlides $slides
    }
    if ($kind -eq 'excel') {
      $wb = Read-ZipEntryText $zip 'xl/workbook.xml'; $rels = Read-ZipEntryText $zip 'xl/_rels/workbook.xml.rels'
      $parts = @{ workbook = $wb; rels = $rels; shared = (Read-ZipEntryText $zip 'xl/sharedStrings.xml'); sheets = @{} }
      foreach ($s in (Get-XlsxSheetList $wb $rels)) { $parts.sheets[$s.path] = Read-ZipEntryText $zip $s.path }
      return Get-XlsxText $parts
    }
    return ''
  } finally { $zip.Dispose() }
}

# ── 파일 종류 (js/collect-logic.js 의 kindOf 와 같은 표) ──
function Get-AttachmentKind([string]$name) {
  $e = ''; $m = [regex]::Match($name, '\.([^.\\/]+)$'); if ($m.Success) { $e = $m.Groups[1].Value.ToLower() }
  switch -regex ($e) {
    '^(docx|docm|dotx)$' { return 'word' }        '^(pptx|pptm|ppsx)$' { return 'ppt' }        '^(xlsx|xlsm)$' { return 'excel' }
    '^pdf$' { return 'pdf' }                        '^ai$' { return 'illustrator' }              '^(png|jpe?g|gif|bmp|tiff?|webp|heic)$' { return 'image' }
    '^(txt|csv|md|log)$' { return 'text' }          '^(doc|ppt|xls)$' { return 'old-office' }    '^(hwp|hwpx)$' { return 'hwp' }
    '^(eml|msg)$' { return 'mail' }                 '^(zip|7z|rar|alz|egg)$' { return 'archive' }
  }
  return 'other'
}
function Test-LooksPdf([string]$path) {
  $fs = [System.IO.File]::OpenRead($path)
  try { $b = New-Object byte[] 4; $n = $fs.Read($b, 0, 4); return ($n -eq 4 -and $b[0] -eq 0x25 -and $b[1] -eq 0x50 -and $b[2] -eq 0x44 -and $b[3] -eq 0x46) }
  finally { $fs.Dispose() }
}
<# 글 파일(.txt·.csv) — UTF-8 로 읽고, 깨지면 한국어 Windows 기본(CP949)으로 #>
function Read-TextFileSmart([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  try { return (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes).TrimStart([char]0xFEFF) }
  catch { try { return [System.Text.Encoding]::GetEncoding(949).GetString($bytes) } catch { return [System.Text.Encoding]::UTF8.GetString($bytes) } }
}

# ── 업무보고 파일(.json) 알아보기 — 2026-09-30 답변 「보고서 파일은 메일로 송/수신」 ──
<# 받은 메일의 첨부 .json 중 이 도구가 만든 보고서 파일(형식 표시 "schema": "p27-report-file-v1")만 골라 그 글을 돌려줍니다.
   다른 .json(다른 프로그램의 설정 · 데이터)은 $null. 규칙은 js/rollup-logic.js 의 looksLikePackageText 와 같습니다(앞 4096자에서 찾음). #>
$Script:ReportMarker = '"schema"\s*:\s*"p27-report-file-v1"'
function Get-ReportPackageText([string]$path, [int64]$maxBytes = 5MB) {
  if ([IO.Path]::GetExtension($path).ToLower() -ne '.json') { return $null }
  if ((Get-Item -LiteralPath $path).Length -gt $maxBytes) { return $null }
  $t = Read-TextFileSmart $path
  $head = $t; if ($head.Length -gt 4096) { $head = $head.Substring(0, 4096) }
  if ($head -match $Script:ReportMarker) { return $t }
  return $null
}

# ── 보고 기간 (js/report-logic.js 의 periodFor 와 같은 계산) ──
<# $mode = weekly | monthly, $which = this | last, $weekStart = 1(월) | 0(일) #>
function Get-ReportPeriod([string]$mode, [datetime]$refDay, [string]$which = 'this', [int]$weekStart = 1) {
  $d = $refDay.Date
  if ($mode -eq 'monthly') {
    $first = New-Object DateTime($d.Year, $d.Month, 1)
    if ($which -eq 'last') { $first = $first.AddMonths(-1) }
    $last = $first.AddMonths(1).AddDays(-1)
    return [ordered]@{ type = 'monthly'; start = $first.ToString('yyyy-MM-dd'); end = $last.ToString('yyyy-MM-dd'); weekStart = $weekStart; label = ('' + $first.Year + '년 ' + $first.Month + '월') }
  }
  if ($which -eq 'last') { $d = $d.AddDays(-7) }
  $back = (([int]$d.DayOfWeek) - $weekStart + 7) % 7
  $s = $d.AddDays(-$back); $e = $s.AddDays(6)
  return [ordered]@{ type = 'weekly'; start = $s.ToString('yyyy-MM-dd'); end = $e.ToString('yyyy-MM-dd'); weekStart = $weekStart; label = ($s.ToString('yyyy-MM-dd') + ' ~ ' + $e.ToString('yyyy-MM-dd')) }
}

# ── 설정 파일 (수집설정.txt — 「이름=값」, # 은 설명) ──
$Script:SettingDefaults = [ordered]@{ 'Online폴더' = '받은보낸'; 'PST폴더' = ''; '제외폴더' = ''; '저장위치' = ''; '첨부최대MB' = '30'; '작은그림KB' = '15'; '최대메일수' = '5000'; '주시작' = '월'; '첨부저장' = '예'; 'PDF포함MB' = '60' }
$Script:AlwaysSkip = @('지운 편지함', 'Deleted Items', '정크 메일', '정크 전자 메일', 'Junk Email', 'Junk E-mail')
function Read-CollectSettingsText([string]$text) {
  $out = [ordered]@{}; foreach ($k in $Script:SettingDefaults.Keys) { $out[$k] = $Script:SettingDefaults[$k] }
  $unknown = @()
  foreach ($ln in ($text.TrimStart([char]0xFEFF) -split "\r?\n")) {
    $l = $ln.Trim(); if (-not $l -or $l.StartsWith('#')) { continue }
    $i = $l.IndexOf('='); if ($i -lt 1) { continue }
    $k = $l.Substring(0, $i).Trim(); $v = $l.Substring($i + 1).Trim()
    if ($out.Contains($k)) { $out[$k] = $v } else { $unknown += $k }
  }
  $out['_unknown'] = $unknown
  return $out
}
<# Online 사서함에서 읽을 범위 (js/collect-logic.js 의 onlineScope 와 같은 표)
   받은보낸(기본) = 받은 편지함 · 보낸 편지함 두 폴더만 / 받은보낸하위 = 두 폴더와 그 하위 폴더 / 전체 = 모든 메일 폴더
   모르는 값이면 기본값(받은보낸)을 쓰고 ok = $false 로 알립니다. #>
function Get-OnlineScope($settings) {
  $v = (([string]$settings['Online폴더']) -replace '[\s·,，+]', '')
  switch ($v) {
    '' { return @{ scope = 'inbox-sent'; ok = $true } }
    '받은보낸' { return @{ scope = 'inbox-sent'; ok = $true } }
    '받은보낸하위' { return @{ scope = 'inbox-sent-sub'; ok = $true } }
    '전체' { return @{ scope = 'all'; ok = $true } }
  }
  return @{ scope = 'inbox-sent'; ok = $false }
}
function Get-SkipFolderNames($settings) {
  $extra = @(([string]$settings['제외폴더']) -split '[,，]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  return @($Script:AlwaysSkip + $extra)
}

# ── 파일 이름 · 경로 ──
function Get-SafeName([string]$s, [int]$max = 80) {
  $s = ($s -replace '[\\/:*?"<>|\x00-\x1F]', '_').Trim().TrimEnd('.')
  if ($s.Length -gt $max) {
    $ext = [System.IO.Path]::GetExtension($s)
    if ($ext.Length -gt 10) { $ext = '' }
    $s = $s.Substring(0, $max - $ext.Length) + $ext
  }
  if (-not $s) { $s = '이름없음' }
  return $s
}
<# 전체 경로 → file:/// 주소. 한글 · 빈칸은 %인코딩, 드라이브 글자(C:)는 그대로, 네트워크 경로(\\서버\공유)는 file://서버/공유 #>
function ConvertTo-FileUrlFromFull([string]$full) {
  if ($full.StartsWith('\\')) { $prefix = 'file://'; $p = $full.Substring(2) -replace '\\', '/' }
  else { $prefix = 'file:///'; $p = ($full -replace '\\', '/').TrimStart('/') }
  $segs = foreach ($seg in $p.Split('/')) { if ($seg -match '^[A-Za-z]:$') { $seg } else { [Uri]::EscapeDataString($seg) } }
  return $prefix + ($segs -join '/')
}
function ConvertTo-FileUrl([string]$path) { return ConvertTo-FileUrlFromFull ([IO.Path]::GetFullPath($path)) }

# ── JSON 쓰기 (ConvertTo-Json 은 PowerShell 5.1 에서 깊이 제한·속도 문제가 있어 직접 씁니다) ──
$Script:JsonEsc = [System.Text.RegularExpressions.MatchEvaluator] {
  param($m)
  $c = [int][char]$m.Value
  switch ($c) { 34 { return '\"' } 92 { return '\\' } 10 { return '\n' } 13 { return '\r' } 9 { return '\t' } }
  return '\u' + $c.ToString('x4')
}
function ConvertTo-JsonString([string]$s) {
  # 한 글자씩 도는 대신 정규식으로 특수 글자만 바꿉니다(메일이 많을 때 빠르게)
  return '"' + [regex]::Replace($s, '[\\"\x00-\x1F\u2028\u2029]', $Script:JsonEsc) + '"'
}
function ConvertTo-JsonText($v, [string]$indent = '') {
  if ($null -eq $v) { return 'null' }
  if ($v -is [bool]) { if ($v) { return 'true' } else { return 'false' } }
  if ($v -is [string] -or $v -is [char]) { return ConvertTo-JsonString ([string]$v) }
  if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] -or $v -is [single] -or $v -is [int16] -or $v -is [byte]) {
    return ([string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0}', $v))
  }
  if ($v -is [datetime]) { return ConvertTo-JsonString ($v.ToString('yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)) }
  $in2 = $indent + ' '
  if ($v -is [System.Collections.IDictionary]) {
    $parts = @(); foreach ($k in $v.Keys) { $parts += ($in2 + (ConvertTo-JsonString ([string]$k)) + ': ' + (ConvertTo-JsonText $v[$k] $in2)) }
    if (-not $parts.Count) { return '{}' }
    return "{`n" + ($parts -join ",`n") + "`n" + $indent + '}'
  }
  if ($v -is [System.Collections.IEnumerable]) {
    $parts = @(); foreach ($x in $v) { $parts += ($in2 + (ConvertTo-JsonText $x $in2)) }
    if (-not $parts.Count) { return '[]' }
    return "[`n" + ($parts -join ",`n") + "`n" + $indent + ']'
  }
  return ConvertTo-JsonString ([string]$v)
}
