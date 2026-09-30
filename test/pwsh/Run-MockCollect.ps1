<#
.SYNOPSIS
  가짜 Outlook 으로 수집기(Collect-OutlookMail.ps1)를 끝까지 돌려 봅니다 — Outlook 이 없는 PC(macOS · 리눅스의 pwsh 포함)에서.

.DESCRIPTION
  samples\collect\manifest.json 의 가상 메일 7통과 첨부 원본으로 「Outlook 과 같은 모양의 가짜 객체」
  (Namespace · Stores · Folders · Items.Restrict/Sort · PropertyAccessor · Attachments.SaveAsFile)를 만들고,
  함정 메일(지운 편지함 · 정크 · 기간 밖 · 회의 요청 · Online 과 .pst 에 같은 메일 · 숨은 서명 그림 · 작은 로고 · 첨부 메일 ·
  공용 폴더 · 일정 폴더)을 섞어 수집기를 실행합니다. 그 결과가 예시 manifest 와 같은지 대조합니다.

  확인하는 것: 폴더 돌기와 빼기 규칙, 기간 거르기(Restrict · 그것이 0 건일 때 훑기), 같은 메일 한 번만, 첨부 저장 · 글 뽑기,
  결과 파일(manifest.json · manifest.js · pdfdata.js · 보고서_열기.html).
  확인하지 못하는 것(진짜 Outlook 에서만): Restrict 날짜 형식이 PC 지역 설정과 맞는지, Exchange 주소(EX) → SMTP 바꾸기,
  Outlook 보안 확인 창, AddStoreEx 로 .pst 열기, 아주 많은 메일에서의 속도.

  실행: pwsh -NoProfile -File test/pwsh/Run-MockCollect.ps1 [-Restrict ok|empty]
        (Windows PowerShell 5.1 에서는 클래스 문법 때문에 PowerShell 7 을 권합니다)
#>
param([ValidateSet('ok', 'empty')][string]$Restrict = 'empty', [string]$OutDir = '', [switch]$Keep)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sample = Join-Path (Join-Path $root 'samples') 'collect'
$man = [IO.File]::ReadAllText((Join-Path $sample 'manifest.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$PR_MID = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'
$PR_IRT = 'http://schemas.microsoft.com/mapi/proptag/0x1042001F'
$PR_REF = 'http://schemas.microsoft.com/mapi/proptag/0x1039001F'
$PR_HIDDEN = 'http://schemas.microsoft.com/mapi/proptag/0x7FFE000B'
$PR_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001F'

class OlItems : System.Collections.Generic.List[object] {
  [string]$Mode = 'empty'
  [object] Restrict([string]$filter) {
    $r = [OlItems]::new()
    if ($this.Mode -eq 'empty') { return $r }       # PC 지역 설정과 날짜 형식이 안 맞아 0 건이 나온 경우를 흉내
    $m = [regex]::Match($filter, "^\[(\w+)\] >= '([^']+)' AND \[\w+\] < '([^']+)'$")
    if (-not $m.Success) { throw ('Restrict 형식이 다릅니다: ' + $filter) }
    $f = $m.Groups[1].Value; $a = [datetime]::Parse($m.Groups[2].Value); $b = [datetime]::Parse($m.Groups[3].Value)
    foreach ($x in $this) { $t = $x.$f; if ($t -ge $a -and $t -lt $b) { $r.Add($x) } }
    return $r
  }
  [void] Sort([string]$key, [bool]$desc) {
    $f = $key.Trim('[', ']'); $sorted = @($this | Sort-Object -Property $f -Descending:$desc)
    $this.Clear(); foreach ($x in $sorted) { $this.Add($x) }
  }
}
function New-PA($props) {
  $o = [pscustomobject]@{ P = $props }
  $o | Add-Member -MemberType ScriptMethod -Name GetProperty -Value { param($t) if ($this.P.ContainsKey($t)) { return $this.P[$t] } throw ('속성 없음 ' + $t) }
  return $o
}
function New-Folder([string]$name, [string]$path, [int]$type = 0) {
  $f = [pscustomobject]@{ Name = $name; EntryID = [guid]::NewGuid().ToString(); FolderPath = $path; DefaultItemType = $type; Folders = [System.Collections.ArrayList]::new(); Items = [OlItems]::new() }
  $f.Items.Mode = $Restrict
  return $f
}
function Get-Sub($parent, [string]$name) {
  foreach ($f in $parent.Folders) { if ($f.Name -eq $name) { return $f } }
  $f = New-Folder $name ($parent.FolderPath + '\' + $name); [void]$parent.Folders.Add($f); return $f
}
function New-Store([string]$name, [string]$file, [int]$exType = 0) {
  $r = New-Folder '' ('\\' + $name)
  $st = [pscustomobject]@{ DisplayName = $name; FilePath = $file; ExchangeStoreType = $exType; StoreID = [guid]::NewGuid().ToString(); Root = $r; Defaults = @{} }
  $st | Add-Member -MemberType ScriptMethod -Name GetRootFolder -Value { return $this.Root }
  $st | Add-Member -MemberType ScriptMethod -Name GetDefaultFolder -Value { param($k) if ($this.Defaults.ContainsKey([int]$k)) { return $this.Defaults[[int]$k] } throw '기본 폴더 없음' }
  foreach ($d in @(@(3, '지운 편지함'), @(5, '보낸 편지함'), @(23, '정크 메일'))) { $st.Defaults[$d[0]] = Get-Sub $r $d[1] }
  return $st
}
function New-Att([string]$name, [string]$src, [int]$type = 1, [bool]$hidden = $false, [int64]$size = -1) {
  if ($size -lt 0) { $size = (Get-Item -LiteralPath $src).Length }
  $a = [pscustomobject]@{ FileName = $name; DisplayName = $name; Size = $size; Type = $type; Src = $src; PropertyAccessor = (New-PA @{ $PR_HIDDEN = $hidden }) }
  $a | Add-Member -MemberType ScriptMethod -Name SaveAsFile -Value { param($p) Copy-Item -LiteralPath $this.Src -Destination $p }
  return $a
}
function New-Mail($m, [int]$class = 43, $atts = $null) {
  $t = [datetime]::ParseExact($m.day + ' ' + $m.time, 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
  $rc = @()
  foreach ($x in @($m.to)) { if ($x) { $rc += [pscustomobject]@{ Name = $x.name; Address = $x.email; Type = 1; AddressEntry = $null; PropertyAccessor = (New-PA @{ $PR_SMTP = $x.email }) } } }
  foreach ($x in @($m.cc)) { if ($x) { $rc += [pscustomobject]@{ Name = $x.name; Address = $x.email; Type = 2; AddressEntry = $null; PropertyAccessor = (New-PA @{ $PR_SMTP = $x.email }) } } }
  if ($null -eq $atts) { $atts = @(foreach ($a in @($m.attachments)) { if ($a) { New-Att $a.name (Join-Path $sample $a.file) } }) }
  return [pscustomobject]@{
    Class = $class; ReceivedTime = $t; SentOn = $t; Subject = $m.subject; SenderEmailAddress = $m.from.email; SenderName = $m.from.name; Sender = $null
    Recipients = $rc; Body = $m.body; Attachments = @($atts)
    PropertyAccessor = (New-PA @{ $PR_MID = '<' + $m.messageId + '>'; $PR_IRT = $(if ($m.inReplyTo) { '<' + $m.inReplyTo + '>' } else { '' }); $PR_REF = ((@($m.references) | Where-Object { $_ } | ForEach-Object { '<' + $_ + '>' }) -join ' ') })
  }
}

# ── 가짜 Outlook 만들기 ──
$online = New-Store 'me@example.com (가상)' 'C:\Users\user\AppData\Local\Microsoft\Outlook\me@example.com (가상).ost'
$pst = New-Store 'Mail backup (가상)' 'D:\메일백업(가상)\Mail backup.pst'
$public = New-Store '공용 폴더(가상)' '' 3
[void](Get-Sub $online.Root '일정').Items                                       # 메일 폴더가 아님(아래에서 형식 바꿈)
(Get-Sub $online.Root '일정').DefaultItemType = 1
foreach ($m in $man.mails) {
  $st = $online; if ($m.storeKind -eq 'pst') { $st = $pst }
  $f = $st.Root; foreach ($part in ($m.folder -split '\\')) { $f = Get-Sub $f $part }
  $f.Items.Add((New-Mail $m))
}
$tmpl = $man.mails[6]
function Clone-Mail($m, $patch) { $c = $m | ConvertTo-Json -Depth 6 | ConvertFrom-Json; foreach ($k in $patch.Keys) { $c.$k = $patch[$k] }; return $c }
# 함정 메일
(Get-Sub $online.Root '지운 편지함').Items.Add((New-Mail (Clone-Mail $tmpl @{ messageId = 'trash-1@example.com'; subject = '지운 메일' })))
(Get-Sub $online.Root '정크 메일').Items.Add((New-Mail (Clone-Mail $tmpl @{ messageId = 'junk-1@example.com'; subject = '광고' })))
(Get-Sub $online.Root '임시 보관함').Items.Add((New-Mail (Clone-Mail $tmpl @{ messageId = 'draft-1@example.com'; subject = '쓰다 만 메일' })))
(Get-Sub $online.Root '받은 편지함').Items.Add((New-Mail (Clone-Mail $tmpl @{ messageId = 'old-1@example.com'; subject = '지난주 메일'; day = '2026-09-18' })))
(Get-Sub $online.Root '받은 편지함').Items.Add((New-Mail (Clone-Mail $tmpl @{ messageId = 'meet-1@example.com'; subject = '회의 요청' }) 53))
(Get-Sub $public.Root '전사 공지').Items.Add((New-Mail (Clone-Mail $tmpl @{ messageId = 'pub-1@example.com'; subject = '공용 폴더 글' })))
$dupSrc = $man.mails | Where-Object { $_.id -eq 'M0006' }
$f = Get-Sub (Get-Sub $pst.Root '2026') '캡 인테리어'; $f.Items.Add((New-Mail $dupSrc))            # Online 과 같은 메일(Message-ID 같음)
$small = Join-Path ([IO.Path]::GetTempPath()) ('p27-logo-' + [guid]::NewGuid().ToString('N') + '.png'); [IO.File]::WriteAllBytes($small, [byte[]](1..200))
$first = $man.mails[0]
$m1 = (Get-Sub (Get-Sub $online.Root '받은 편지함') '캡 인테리어').Items | Where-Object { $_.Subject -eq $first.subject }
$m1.Attachments = @($m1.Attachments) + @((New-Att 'image001.png' (Join-Path $sample 'att/M0001/B안_렌더링_정면.png') 1 $true), (New-Att 'logo.png' $small))
$extra = Clone-Mail $tmpl @{ messageId = 'fwd-1@example.com'; subject = '[팀 공지] 참고 메일 전달'; day = '2026-09-26'; time = '09:00' }
(Get-Sub $online.Root '받은 편지함').Items.Add((New-Mail $extra 43 @((New-Att '회의 초대.msg' $null 5 $false 4096))))

$ns = [pscustomobject]@{ Accounts = @([pscustomobject]@{ SmtpAddress = 'me@example.com' }); Stores = @($online, $pst, $public) }
$ns | Add-Member -MemberType ScriptMethod -Name AddStoreEx -Value { param($p, $t) throw '시험에서는 .pst 를 열지 않습니다' }
$ns | Add-Member -MemberType ScriptMethod -Name RemoveStore -Value { param($f) }

# ── 수집기 실행 ──
if (-not $OutDir) { $OutDir = Join-Path ([IO.Path]::GetTempPath()) ('p27-mock-' + [guid]::NewGuid().ToString('N')) }
$settings = Join-Path ([IO.Path]::GetTempPath()) ('p27-set-' + [guid]::NewGuid().ToString('N') + '.txt')
[IO.File]::WriteAllText($settings, [IO.File]::ReadAllText((Join-Path $root 'collector/수집설정.txt'), [Text.Encoding]::UTF8), [Text.Encoding]::UTF8)
& (Join-Path $root 'collector/Collect-OutlookMail.ps1') -Mode weekly -Which this -RefDay 2026-09-24 -SettingsFile $settings -OutDir $OutDir -NoOpen -NoPause -MockNamespace $ns | Out-Host

# ── 대조 ──
$script:pass = 0; $script:fail = 0
function Check([bool]$ok, [string]$label) { if ($ok) { $script:pass++; Write-Host ('  ok   ' + $label) } else { $script:fail++; Write-Host ('  FAIL ' + $label) -ForegroundColor Red } }
$out = [IO.File]::ReadAllText((Join-Path $OutDir 'manifest.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Host ('[가짜 Outlook 수집 · Restrict=' + $Restrict + '] 결과 대조')
Check ($out.schema -eq 'p27-collect-v1' -and $out.period.start -eq '2026-09-21' -and $out.period.end -eq '2026-09-27') '형식 · 기간'
Check (@($out.mails).Count -eq 8) ('메일 8통(예시 7 + 첨부 메일 1) — 실제 ' + @($out.mails).Count)
Check ($out.duplicates -eq 1) ('Online · .pst 같은 메일 한 번만 — ' + $out.duplicates)
Check (@($out.stores).Count -eq 2) '공용 폴더 데이터 파일은 읽지 않음'
$sk = @($out.skippedFolders) -join ' | '
foreach ($n in '지운 편지함', '정크 메일', '임시 보관함') { Check ($sk -like ('*' + $n + '*')) ('뺀 폴더: ' + $n) }
$subj = @($out.mails | ForEach-Object { $_.subject })
foreach ($n in '지운 메일', '광고', '쓰다 만 메일', '지난주 메일', '회의 요청', '공용 폴더 글') { Check (-not ($subj -contains $n)) ('들어오면 안 되는 메일: ' + $n) }
if ($Restrict -eq 'empty') { Check ((@($out.warnings) -join ' ') -like '*Restrict*') 'Restrict 0 건 → 훑기로 대신했다는 알림' }
foreach ($want in $man.mails) {
  $got = @($out.mails | Where-Object { $_.messageId -eq ('<' + $want.messageId + '>') })
  if ($got.Count -ne 1) { Check $false ($want.id + ' 없음'); continue }
  $g = $got[0]
  $same = ($g.subject -ceq $want.subject) -and ($g.body -ceq $want.body) -and ($g.day -eq $want.day) -and ($g.time -eq $want.time) -and ($g.direction -eq $want.direction) -and
    ($g.store -eq $want.store) -and ($g.storeKind -eq $want.storeKind) -and ($g.folder -eq $want.folder) -and ($g.from.email -eq $want.from.email) -and
    ((@($g.to | ForEach-Object { $_.email }) -join ',') -eq (@($want.to | ForEach-Object { $_.email }) -join ',')) -and
    ((@($g.cc | ForEach-Object { $_.email }) -join ',') -eq (@($want.cc | ForEach-Object { $_.email }) -join ','))
  Check $same ($want.id + ' 메일 칸(제목 · 본문 · 날짜 · 보낸/받은 · 위치 · 주소)')
  $ga = @($g.attachments); $wa = @($want.attachments)
  $ok = ($ga.Count -eq $wa.Count)
  for ($i = 0; $ok -and $i -lt $wa.Count; $i++) {
    $ok = ($ga[$i].name -eq $wa[$i].name) -and ($ga[$i].kind -eq $wa[$i].kind) -and ($ga[$i].extract -eq $wa[$i].extract) -and ([string]$ga[$i].text -ceq [string]$wa[$i].text) -and
      ([string]$ga[$i].note -ceq [string]$wa[$i].note) -and ([int64]$ga[$i].size -eq [int64]$wa[$i].size) -and ((Split-Path $ga[$i].file -Leaf) -eq (Split-Path $wa[$i].file -Leaf)) -and
      (Test-Path -LiteralPath (Join-Path $OutDir $ga[$i].file))
    if (-not $ok) { Write-Host ('       첨부 차이: ' + $wa[$i].name + ' → ' + ($ga[$i] | ConvertTo-Json -Compress -Depth 3).Substring(0, 200)) }
  }
  Check $ok ($want.id + ' 첨부 ' + $wa.Count + '개(이름 · 종류 · 글 · 저장 파일, 숨은 서명 그림 · 작은 로고 빼기)')
}
$fw = @($out.mails | Where-Object { $_.subject -eq '[팀 공지] 참고 메일 전달' })[0]
Check ($fw.attachments.Count -eq 1 -and $fw.attachments[0].kind -eq 'mail' -and $fw.attachments[0].file -eq '') '첨부 메일(.msg) — 이름만'
$pdfjs = [IO.File]::ReadAllText((Join-Path $OutDir 'pdfdata.js'), [Text.Encoding]::UTF8)
Check ($pdfjs.StartsWith('window.P27_PDF = ') -and ($pdfjs -like '*조작부_치수도면_Rev2.pdf*') -and ($pdfjs -like '*로고_시안_B안.ai*')) 'pdfdata.js 에 PDF · 일러스트'
$mjs = [IO.File]::ReadAllText((Join-Path $OutDir 'manifest.js'), [Text.Encoding]::UTF8)
Check ($mjs.StartsWith('window.P27_COLLECT = {')) 'manifest.js'
$html = [IO.File]::ReadAllText((Join-Path $OutDir '보고서_열기.html'), [Text.Encoding]::UTF8)
Check (($html -like '*index.html#/make?collect=file%3A%2F%2F*manifest.js*') -and ($html -like '*location.replace(u)*')) '보고서_열기.html → 도구#/make?collect=…manifest.js'
Remove-Item -LiteralPath $small, $settings -Force
Write-Host ''
if ($Keep) { Write-Host ('통과 ' + $script:pass + ' · 실패 ' + $script:fail + '   (결과 폴더: ' + $OutDir + ')') }
else { Remove-Item -LiteralPath $OutDir -Recurse -Force; Write-Host ('통과 ' + $script:pass + ' · 실패 ' + $script:fail) }
if ($script:fail) { exit 1 }
