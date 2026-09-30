<#
.SYNOPSIS
  업무보고 자동수집기 — 주간·월간 기간의 메일(Online 사서함 + 내 PC 의 .pst)과 첨부를 모아 업무보고 도구로 엽니다.

.DESCRIPTION
  주간보고.bat · 월간보고.bat 가 이 파일을 실행합니다. 직접 실행할 필요는 없습니다.

  하는 일
   1. 켜져 있는 클래식 Outlook(COM)에 붙습니다(Outlook 을 새로 띄우지 않음). 인터넷·서버·Graph API 를 쓰지 않습니다.
      Outlook 이 꺼져 있으면 「Outlook 을 먼저 켜 주세요」라고 알리고 끝냅니다.
   2. Outlook 에 열려 있는 「모든 데이터 파일」을 읽습니다 — Online 사서함(회사 메일 계정)과 .pst(Local 백업).
      수집설정.txt 의 PST폴더 를 적으면 그 폴더의 .pst 중 Outlook 에 안 열린 것을 잠깐 열었다가 끝나면 닫습니다.
   3. Online 사서함은 받은 편지함 · 보낸 편지함 두 폴더만 읽습니다(수집설정.txt 의 Online폴더 — 2026-09-30 답변).
      Outlook 의 기본 폴더 번호로 찾으므로 영어 · 한국어 Outlook 모두 같습니다.
      .pst 는 모든 메일 폴더 · 하위 폴더를 읽습니다(지운 편지함 · 정크 메일 · 설정한 제외폴더 제외).
      두 경우 모두 기간 안의 메일만 고릅니다.
      같은 메일이 Online 과 .pst 에 둘 다 있으면(Message-ID 가 같으면) 한 번만 담습니다.
   4. 메일마다 제목 · 보낸이 · 받는이 · 날짜 · 본문, 첨부 파일을 저장하고 첨부 글을 뽑습니다(내 PC 안에서만).
        워드 · 파워포인트 · 엑셀(.docx .pptx .xlsx) → 파일 안 XML 을 바로 읽어 글 뽑기(Office 를 띄우지 않음)
        PDF · PDF 호환 일러스트(.ai)                → 업무보고 도구(브라우저)가 pdf.js 로 읽음
        그림(JPEG · PNG 등) · 옛 Office · 한글       → 이름 · 크기만(그림 글자 읽기(OCR)는 2단계)
   5. 한 폴더에 manifest.json(목록) · 첨부 · 수집기록.txt 를 남기고, 업무보고 도구를 그 결과로 엽니다.

  읽기 전용입니다. Outlook 안의 메일을 옮기거나 지우거나 「읽음」으로 바꾸지 않고, 보내지도 않습니다.
  (쓰는 Outlook 기능: Stores · Folders · Items.Restrict · 속성 읽기 · 첨부 SaveAsFile(=내 PC 로 복사) · AddStoreEx/RemoveStore(설정한 경우만))

.PARAMETER Mode
  weekly(주간) 또는 monthly(월간).

.PARAMETER Which
  this(이번 주·이번 달) · last(지난 주·지난 달) · ask(물어보기, 기본값).

.PARAMETER RefDay
  기준일(yyyy-MM-dd). 비우면 오늘. 예: -RefDay 2026-09-25 -Which this → 그 날이 속한 주.

.PARAMETER NoOpen
  끝나고 업무보고 도구를 열지 않습니다.

.PARAMETER ListOnly
  저장하지 않고 읽을 데이터 파일 · 폴더와 기간 안 메일 수만 보여 줍니다(처음 한 번 확인용).

.NOTES
  data09-27 · 2026-09-30. 이 파일은 UTF-8(BOM) 입니다 — Windows PowerShell 5.1 에서 한글이 깨지지 않게.
  이 스크립트의 Outlook 부분은 개발 PC(macOS)에서 돌려 볼 수 없었습니다. 처음 한 번은 -ListOnly 로 확인해 주세요.
#>
[CmdletBinding()]
param(
  [ValidateSet('weekly', 'monthly')][string]$Mode = 'weekly',
  [ValidateSet('this', 'last', 'ask')][string]$Which = 'ask',
  [string]$RefDay = '',
  [string]$SettingsFile = '',
  [string]$OutDir = '',
  [switch]$NoOpen,
  [switch]$ListOnly,
  [switch]$NoPause,
  [object]$MockNamespace = $null     # 시험용(가짜 Outlook — test/pwsh/Run-MockCollect.ps1). 평소에는 쓰지 않습니다
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CollectorCore.ps1')

$olMail = 43                  # OlObjectClass.olMail — 회의 요청 · 배달 보고 등은 건너뜀
$olFolderDeletedItems = 3
$olFolderSentMail = 5
$olFolderInbox = 6
$olFolderJunk = 23
$olExchangePublicFolder = 3   # OlExchangeStoreType — 공용 폴더는 읽지 않음
$olStoreUnicode = 3
$PR_INTERNET_MESSAGE_ID = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'
$PR_IN_REPLY_TO_ID      = 'http://schemas.microsoft.com/mapi/proptag/0x1042001F'
$PR_INTERNET_REFERENCES = 'http://schemas.microsoft.com/mapi/proptag/0x1039001F'
$PR_ATTACHMENT_HIDDEN   = 'http://schemas.microsoft.com/mapi/proptag/0x7FFE000B'
$PR_SMTP_ADDRESS        = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001F'
$Inv = [Globalization.CultureInfo]::InvariantCulture
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$ToolRoot = Split-Path $PSScriptRoot -Parent

function Say([string]$msg, [string]$color = '') { if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg } }
function Stop-WithMessage([string]$msg) {
  Say ''; Say $msg 'Yellow'
  exit 1     # 창 멈춤(pause)은 .bat 이 합니다
}
function Get-Prop($obj, [string]$tag) { try { return $obj.PropertyAccessor.GetProperty($tag) } catch { return $null } }
function Get-SmtpOf($addrEntry, [string]$fallback) {
  try {
    if ($addrEntry -and $addrEntry.Type -eq 'EX') {
      $u = $addrEntry.GetExchangeUser(); if ($u -and $u.PrimarySmtpAddress) { return [string]$u.PrimarySmtpAddress }
      $s = Get-Prop $addrEntry $PR_SMTP_ADDRESS; if ($s) { return [string]$s }
    }
  } catch { }
  return [string]$fallback
}
function Get-Recipients($item) {
  $to = @(); $cc = @()
  try {
    foreach ($r in $item.Recipients) {
      $mail = [string](Get-Prop $r $PR_SMTP_ADDRESS); if (-not $mail) { $mail = Get-SmtpOf $r.AddressEntry ([string]$r.Address) }
      $one = [ordered]@{ name = [string]$r.Name; email = $mail }
      if ($r.Type -eq 2) { $cc += , $one } elseif ($r.Type -eq 1) { $to += , $one }
    }
  } catch { }
  return @{ to = $to; cc = $cc }
}

# ── 1. 설정 · 기간 ─────────────────────────────
if (-not $SettingsFile) { $SettingsFile = Join-Path $PSScriptRoot '수집설정.txt' }
$settingsText = ''; if (Test-Path -LiteralPath $SettingsFile) { $settingsText = [IO.File]::ReadAllText($SettingsFile, [Text.Encoding]::UTF8) }
$S = Read-CollectSettingsText $settingsText
if ($S['_unknown'].Count) { Say ('수집설정.txt 에 모르는 이름이 있어 건너뜁니다: ' + ($S['_unknown'] -join ', ')) 'Yellow' }
$weekStart = 1; if ($S['주시작'] -eq '일') { $weekStart = 0 }
$ref = (Get-Date).Date; if ($RefDay) { $ref = [datetime]::ParseExact($RefDay, 'yyyy-MM-dd', $Inv) }

Say ''
Say '=== 업무보고 자동수집 (읽기 전용 · 내 PC 안에서만) ===' 'Cyan'
if ($Which -eq 'ask') {
  $a = Get-ReportPeriod $Mode $ref 'this' $weekStart; $b = Get-ReportPeriod $Mode $ref 'last' $weekStart
  $unit = '주'; if ($Mode -eq 'monthly') { $unit = '달' }
  Say ('  1) 이번 ' + $unit + ' : ' + $a.start + ' ~ ' + $a.end)
  Say ('  2) 지난 ' + $unit + ' : ' + $b.start + ' ~ ' + $b.end)
  $ans = Read-Host '번호를 누르고 Enter (그냥 Enter = 1)'
  if ($ans.Trim() -eq '2') { $Which = 'last' } else { $Which = 'this' }
}
$P = Get-ReportPeriod $Mode $ref $Which $weekStart
$start = [datetime]::ParseExact($P.start, 'yyyy-MM-dd', $Inv)
$end = [datetime]::ParseExact($P.end, 'yyyy-MM-dd', $Inv).AddDays(1)          # 마지막 날 24시까지
$modeKo = '주간'; if ($Mode -eq 'monthly') { $modeKo = '월간' }
Say ('보고 기간: ' + $modeKo + ' ' + $P.start + ' ~ ' + $P.end) 'Green'

$maxMails = 5000; [void][int]::TryParse($S['최대메일수'], [ref]$maxMails)
$maxAttMB = 30; [void][int]::TryParse($S['첨부최대MB'], [ref]$maxAttMB)
$smallImgKB = 15; [void][int]::TryParse($S['작은그림KB'], [ref]$smallImgKB)
$pdfBudgetMB = 60; [void][int]::TryParse($S['PDF포함MB'], [ref]$pdfBudgetMB)
$keepFiles = ($S['첨부저장'] -ne '아니오')
$skipNames = Get-SkipFolderNames $S
$OS = Get-OnlineScope $S; $onlineScope = $OS.scope
if (-not $OS.ok) { Say ('수집설정.txt 의 Online폴더 값(' + $S['Online폴더'] + ')을 몰라 기본값(받은보낸 = 받은 편지함 · 보낸 편지함만)으로 읽습니다.') 'Yellow' }

# ── 2. Outlook 연결 — 켜져 있는 Outlook 에 붙습니다(2026-09-30 답변: 늘 켜 둠) ──
# Outlook 이 꺼져 있으면 새로 띄우지 않고 알립니다. 수집기가 몰래 띄운 Outlook 은 화면에 안 보여 사용자가 끄기 어렵기 때문입니다.
if (-not $MockNamespace -and -not (Get-Process -Name 'OUTLOOK' -ErrorAction SilentlyContinue)) {
  Stop-WithMessage ("Outlook 이 꺼져 있습니다.`n" +
    " - 평소처럼 클래식 Outlook 을 켜고, 왼쪽에 받은 편지함과 .pst(데이터 파일)가 보이면 이 창을 닫고 다시 실행해 주세요.`n" +
    " - 이 도구는 Outlook 이 설치되고 회사 계정으로 로그인된 이 PC 에서만 메일을 읽을 수 있습니다.")
}
try {
  if ($MockNamespace) { $ns = $MockNamespace }
  else {
    # 켜진 Outlook 에 붙기. (GetActiveObject 가 안 되는 환경에서는 New-Object 가 켜진 Outlook 을 돌려줍니다 — 위에서 켜져 있는 것을 확인함)
    try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
    catch { $ol = New-Object -ComObject Outlook.Application }
    $ns = $ol.GetNamespace('MAPI')
  }
} catch {
  Stop-WithMessage ("Outlook 에 연결하지 못했습니다: " + $_.Exception.Message + "`n" +
    " - 「클래식 Outlook」이 설치되어 있어야 합니다(오른쪽 위 「새 Outlook」 스위치가 켜져 있으면 끄고 다시 해 주세요).`n" +
    " - PowerShell 이나 이 파일을 「관리자 권한으로 실행」하지 말아 주세요(Outlook 과 권한이 다르면 연결이 거부됩니다).`n" +
    " - Outlook 을 한 번 켜서 메일이 보이는지 확인한 뒤 다시 실행해 주세요.")
}
$myAddresses = @()
try { foreach ($acc in $ns.Accounts) { if ($acc.SmtpAddress) { $myAddresses += ([string]$acc.SmtpAddress).ToLower() } } } catch { }

# ── 3. (선택) PST폴더 의 .pst 잠깐 열기 ────────
$added = @()
$pstDir = [Environment]::ExpandEnvironmentVariables([string]$S['PST폴더'])
if ($pstDir) {
  if (-not (Test-Path -LiteralPath $pstDir)) { Say ('PST폴더 를 찾지 못했습니다: ' + $pstDir + ' — 이미 Outlook 에 열린 데이터 파일만 읽습니다.') 'Yellow' }
  else {
    $open = @{}; foreach ($st in $ns.Stores) { try { if ($st.FilePath) { $open[([string]$st.FilePath).ToLower()] = 1 } } catch { } }
    foreach ($f in (Get-ChildItem -LiteralPath $pstDir -Filter *.pst -File)) {
      if ($open.ContainsKey($f.FullName.ToLower())) { continue }
      if ($f.IsReadOnly) { Say ('  읽기 전용 파일이라 Outlook 이 열 수 없습니다(속성에서 「읽기 전용」을 끄거나 복사본을 쓰세요): ' + $f.Name) 'Yellow'; continue }
      try {
        $ns.AddStoreEx($f.FullName, $olStoreUnicode)
        foreach ($st in $ns.Stores) { if (([string]$st.FilePath).ToLower() -eq $f.FullName.ToLower()) { $added += , $st } }
        Say ('  .pst 를 잠깐 열었습니다(끝나면 닫음): ' + $f.Name)
      } catch { Say ('  .pst 를 열지 못했습니다(다른 프로그램이 쓰는 중이거나 손상): ' + $f.Name + ' — ' + $_.Exception.Message) 'Yellow' }
    }
  }
}

# ── 4. 데이터 파일 · 폴더 돌기 ─────────────────
function Get-DefaultId($store, [int]$kind) { try { return [string]$store.GetDefaultFolder($kind).EntryID } catch { return '' } }
function Get-MailFolders($folder, $skipIds, [string[]]$names, $acc, $skipped) {
  foreach ($f in $folder.Folders) {
    $nm = [string]$f.Name
    if ($skipIds -contains [string]$f.EntryID -or $names -contains $nm) { $skipped.Add([string]$f.FolderPath) | Out-Null; continue }
    if ($f.DefaultItemType -eq 0) { $acc.Add($f) | Out-Null }     # olMailItem — 일정 · 연락처 · 작업 폴더는 건너뜀
    Get-MailFolders $f $skipIds $names $acc $skipped
  }
}
<# 기간 안 항목. Restrict 로 거르고, Restrict 가 0 건인데 폴더의 가장 최근 메일이 기간 안이면
   (날짜 형식이 PC 지역 설정과 안 맞은 경우) 최신순으로 훑어 고릅니다. 모든 항목의 날짜를 한 번 더 확인합니다. #>
function Get-ItemsInRange($folder, [string]$field, [datetime]$from, [datetime]$to) {
  $items = $folder.Items
  $fmt = { param($d) $d.ToString('d') + ' ' + $d.ToString('HH:mm') }
  $filter = '[' + $field + "] >= '" + (& $fmt $from) + "' AND [" + $field + "] < '" + (& $fmt $to) + "'"
  $list = New-Object System.Collections.ArrayList
  $restricted = $null
  try { $restricted = $items.Restrict($filter) } catch { $restricted = $null }
  if ($restricted -and $restricted.Count -gt 0) { foreach ($it in $restricted) { [void]$list.Add($it) }; return , $list }
  $items.Sort('[' + $field + ']', $true)
  foreach ($it in $items) {
    $t = $null; try { $t = $it.$field } catch { continue }
    if ($null -eq $t) { continue }
    if ($t -ge $to) { continue }
    if ($t -lt $from) { break }
    [void]$list.Add($it)
  }
  if ($list.Count -and $null -ne $restricted) { $Script:restrictFallback++ }
  return , $list
}

<# Online 사서함: 받은 편지함 · 보낸 편지함(기본 폴더 번호 6 · 5 — 언어와 상관없음). 받은보낸하위 면 그 하위 폴더도.
   기본 폴더를 못 찾으면(드물게 권한 · 추가 사서함) 맨 위 폴더 이름으로 한 번 더 찾습니다. #>
function Get-OnlineFolders($st, $root, [string]$scope, $skipIds, [string[]]$names, $acc, $skipped) {
  $found = @()
  foreach ($k in @($olFolderInbox, $olFolderSentMail)) {
    $f = $null; try { $f = $st.GetDefaultFolder($k) } catch { $f = $null }
    if ($null -eq $f) {
      $want = @('받은 편지함', 'Inbox'); if ($k -eq $olFolderSentMail) { $want = @('보낸 편지함', 'Sent Items') }
      foreach ($c in $root.Folders) { if ($want -contains [string]$c.Name) { $f = $c; break } }
    }
    if ($null -ne $f) { $found += , $f }
  }
  foreach ($f in $found) {
    $acc.Add($f) | Out-Null
    if ($scope -eq 'inbox-sent-sub') { Get-MailFolders $f $skipIds $names $acc $skipped }
  }
  return $found.Count
}

$Script:restrictFallback = 0
$stores = @(); $skippedFolders = New-Object System.Collections.ArrayList
$targets = New-Object System.Collections.ArrayList
foreach ($st in $ns.Stores) {
  try { if ($st.ExchangeStoreType -eq $olExchangePublicFolder) { continue } } catch { }
  $path = ''; try { $path = [string]$st.FilePath } catch { }
  $kind = 'online'; if ($path -match '\.pst$') { $kind = 'pst' }
  $root = $null; try { $root = $st.GetRootFolder() } catch { Say ('  열 수 없는 데이터 파일을 건너뜁니다: ' + $st.DisplayName) 'Yellow'; continue }
  $skipIds = @((Get-DefaultId $st $olFolderDeletedItems), (Get-DefaultId $st $olFolderJunk)) | Where-Object { $_ }
  $sentId = Get-DefaultId $st $olFolderSentMail
  $folders = New-Object System.Collections.ArrayList
  $scope = 'all'
  if ($kind -eq 'online' -and $onlineScope -ne 'all') {
    $scope = $onlineScope
    if ((Get-OnlineFolders $st $root $scope $skipIds $skipNames $folders $skippedFolders) -eq 0) { Say ('  받은 편지함 · 보낸 편지함을 찾지 못해 건너뜁니다: ' + $st.DisplayName) 'Yellow' }
  } else { Get-MailFolders $root $skipIds $skipNames $folders $skippedFolders }
  $info = [ordered]@{ name = [string]$st.DisplayName; kind = $kind; path = $path; scope = $scope; folders = $folders.Count; mails = 0; added = [bool]($added | Where-Object { $_.StoreID -eq $st.StoreID }) }
  $stores += , $info
  foreach ($f in $folders) { [void]$targets.Add(@{ store = $info; folder = $f; sent = ([string]$f.EntryID -eq $sentId -or @('보낸 편지함', 'Sent Items') -contains [string]$f.Name) }) }
}
Say ('데이터 파일 ' + $stores.Count + '개 · 메일 폴더 ' + $targets.Count + '개를 읽습니다. (뺀 폴더 ' + $skippedFolders.Count + '개: 지운 편지함 · 정크 메일 · 제외폴더)')
$scopeKo = @{ 'inbox-sent' = '받은 편지함 · 보낸 편지함만'; 'inbox-sent-sub' = '받은 편지함 · 보낸 편지함과 하위 폴더'; 'all' = '모든 메일 폴더' }
foreach ($s in $stores) { $k = 'Online 사서함'; if ($s.kind -eq 'pst') { $k = 'Local(.pst)' }; Say ('  - ' + $k + ' : ' + $s.name + ' (폴더 ' + $s.folders + '개 · ' + $scopeKo[$s.scope] + ')') }
if ($ListOnly) { foreach ($t in $targets) { Say ('      ' + ([string]$t.folder.FolderPath -replace '^\\\\', '')) } }

# ── 5. 저장 폴더 ──────────────────────────────
if (-not $OutDir) {
  $base = [Environment]::ExpandEnvironmentVariables([string]$S['저장위치'])
  if (-not $base) { $base = Join-Path ([Environment]::GetFolderPath('MyDocuments')) '업무보고_수집' }
  $OutDir = Join-Path $base ($P.start + '_' + $modeKo + '_' + (Get-Date).ToString('MMdd-HHmm'))
}
if (-not $ListOnly) { New-Item -ItemType Directory -Force -Path (Join-Path $OutDir 'att') | Out-Null }

# ── 6. 메일 · 첨부 ────────────────────────────
$mails = New-Object System.Collections.ArrayList
$seen = @{}; $dup = 0; $other = 0; $warnings = New-Object System.Collections.ArrayList
$pdfData = [ordered]@{}; $pdfBytes = 0; $n = 0; $fi = 0
foreach ($t in $targets) {
  $fi++
  $f = $t.folder; $field = 'ReceivedTime'; if ($t.sent) { $field = 'SentOn' }
  Write-Progress -Activity '메일 모으는 중' -Status ([string]$f.FolderPath) -PercentComplete ([Math]::Min(100, [int](100 * $fi / [Math]::Max(1, $targets.Count))))
  $inRange = $null
  try { $inRange = Get-ItemsInRange $f $field $start $end } catch { [void]$warnings.Add('폴더를 읽지 못했습니다: ' + $f.FolderPath + ' — ' + $_.Exception.Message); continue }
  $cnt = 0
  foreach ($it in $inRange) {
    if ($mails.Count -ge $maxMails) { break }
    if ($it.Class -ne $olMail) { $other++; continue }
    $when = $it.$field
    if ($when -lt $start -or $when -ge $end) { continue }
    $mid = [string](Get-Prop $it $PR_INTERNET_MESSAGE_ID)
    $key = $mid.ToLower(); if (-not $key) { $key = ([string]$it.SenderEmailAddress + '|' + $when.ToString('s') + '|' + [string]$it.Subject).ToLower() }
    if ($seen.ContainsKey($key)) { $dup++; continue }
    $seen[$key] = 1
    $cnt++; $t.store.mails++
    if ($ListOnly) { continue }
    $n++; $id = 'M' + $n.ToString('0000')
    $fromAddr = ''; try { $fromAddr = Get-SmtpOf $it.Sender ([string]$it.SenderEmailAddress) } catch { $fromAddr = [string]$it.SenderEmailAddress }
    $rc = Get-Recipients $it
    $dir = 'received'; if ($t.sent -or ($myAddresses -contains $fromAddr.ToLower())) { $dir = 'sent' }
    $body = [string]$it.Body; if ($body.Length -gt 30000) { $body = $body.Substring(0, 30000) }
    $refs = @(([string](Get-Prop $it $PR_INTERNET_REFERENCES)) -split '\s+' | Where-Object { $_ })
    $atts = @()
    $attDir = Join-Path (Join-Path $OutDir 'att') $id
    foreach ($a in $it.Attachments) {
      if ((Get-Prop $a $PR_ATTACHMENT_HIDDEN) -eq $true) { continue }       # 본문에 박힌 그림(서명 로고 등)
      $name = [string]$a.FileName; if (-not $name) { $name = [string]$a.DisplayName }
      $kind = Get-AttachmentKind $name
      $size = [int64]0; try { $size = [int64]$a.Size } catch { }
      $rec = [ordered]@{ name = $name; kind = $kind; size = $size; file = ''; extract = 'meta'; text = ''; note = '' }
      if ($a.Type -ne 1) { $rec.note = '파일이 아닌 첨부(첨부 메일 · 링크 등) — 이름만'; $atts += , $rec; continue }   # 1 = olByValue
      if ($kind -eq 'image' -and $size -lt $smallImgKB * 1024) { continue }                                         # 서명 로고 같은 작은 그림
      if ($size -gt $maxAttMB * 1MB) { $rec.extract = 'too-large'; $rec.note = ('' + [Math]::Round($size / 1MB) + 'MB — 첨부최대MB 보다 커서 저장하지 않음'); $atts += , $rec; continue }
      New-Item -ItemType Directory -Force -Path $attDir | Out-Null
      $safe = Get-SafeName $name; $path = Join-Path $attDir $safe; $k2 = 2
      while (Test-Path -LiteralPath $path) { $path = Join-Path $attDir ([IO.Path]::GetFileNameWithoutExtension($safe) + '_' + $k2 + [IO.Path]::GetExtension($safe)); $k2++ }
      try { $a.SaveAsFile($path) } catch { $rec.extract = 'error'; $rec.note = '저장하지 못함: ' + $_.Exception.Message; $atts += , $rec; continue }
      $rel = 'att/' + $id + '/' + (Split-Path $path -Leaf)
      $rec.file = $rel
      try {
        switch ($kind) {
          { $_ -in 'word', 'ppt', 'excel' } {
            $txt = Get-OoxmlTextFromFile $path $kind
            if ($txt.Trim()) { $rec.extract = 'ok'; $rec.text = $txt } else { $rec.extract = 'empty' }
          }
          'text' { $rec.text = Read-TextFileSmart $path; $rec.extract = 'ok' }
          { $_ -in 'pdf', 'illustrator' } {
            if (Test-LooksPdf $path) {
              $rec.extract = 'browser'
              $len = (Get-Item -LiteralPath $path).Length
              if ($pdfBytes + $len -le $pdfBudgetMB * 1MB) { $pdfData[$rel] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)); $pdfBytes += $len }
              else { $rec.note = 'PDF포함MB 를 넘어 자동 열기에 담지 못함 — 도구에서 「수집 폴더 열기」로 고르면 읽습니다' }
            } else { $rec.extract = 'meta'; $rec.note = 'PDF 호환으로 저장되지 않은 일러스트 — 이름 · 크기만' }
          }
          'image' { $rec.extract = 'meta'; $rec.note = '그림 — 이름 · 크기만(글자 읽기는 2단계)' }
          { $_ -in 'old-office', 'hwp' } { $rec.extract = 'unsupported'; $rec.note = '옛 Office · 한글 파일은 1단계에서 글을 뽑지 않음(2단계)' }
          default { $rec.extract = 'meta' }
        }
      } catch { $rec.extract = 'error'; $rec.note = '글을 뽑다가 오류: ' + $_.Exception.Message }
      if ($rec.text.Length -gt 20000) { $rec.text = $rec.text.Substring(0, 20000) }
      if ($rec.extract -eq 'ok') { [IO.File]::WriteAllText($path + '.txt', $rec.text, $Utf8) }
      if (-not $keepFiles -and $rec.extract -ne 'browser') { Remove-Item -LiteralPath $path -Force; $rec.file = '' }   # 내가 방금 저장한 복사본만 지움
      $atts += , $rec
    }
    $folderPath = ([string]$f.FolderPath) -replace '^\\\\[^\\]+\\', ''
    [void]$mails.Add([ordered]@{
      id = $id; store = $t.store.name; storeKind = $t.store.kind; folder = $folderPath; direction = $dir
      messageId = $mid; inReplyTo = [string](Get-Prop $it $PR_IN_REPLY_TO_ID); references = $refs
      from = [ordered]@{ name = [string]$it.SenderName; email = $fromAddr }; to = $rc.to; cc = $rc.cc
      sentAt = $when.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $Inv); day = $when.ToString('yyyy-MM-dd', $Inv); time = $when.ToString('HH:mm', $Inv)
      subject = [string]$it.Subject; body = $body; attachments = $atts
    })
  }
  if ($cnt) { Say ('  ' + $f.FolderPath + ' : ' + $cnt + '통') }
}
Write-Progress -Activity '메일 모으는 중' -Completed
if ($Script:restrictFallback) { [void]$warnings.Add('Outlook 날짜 거르기(Restrict)가 ' + $Script:restrictFallback + '개 폴더에서 0 건이라 최신순 훑기로 대신했습니다(PC 지역 설정의 날짜 형식 차이). 결과는 같지만 느릴 수 있습니다.') }

# 잠깐 연 .pst 닫기
foreach ($st in $added) { try { $ns.RemoveStore($st.GetRootFolder()) } catch { [void]$warnings.Add('잠깐 연 .pst 를 닫지 못했습니다(Outlook 왼쪽에서 직접 닫아 주세요): ' + $st.DisplayName) } }

$total = 0; foreach ($s in $stores) { $total += $s.mails }
Say ''
Say ('기간 안 메일 ' + $total + '통 (Online/.pst 에 함께 있던 같은 메일 ' + $dup + '통은 한 번만) · 메일이 아닌 항목 ' + $other + '개 건너뜀') 'Green'
if ($ListOnly) { Say '(-ListOnly: 저장하지 않았습니다)'; if (-not $NoPause) { [void](Read-Host '엔터를 누르면 창을 닫습니다') }; exit 0 }

# ── 7. 결과 쓰기 ──────────────────────────────
$manifest = [ordered]@{
  schema = 'p27-collect-v1'; tool = 'data09-27 Collect-OutlookMail.ps1 (read-only)'
  generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm', $Inv); computer = $env:COMPUTERNAME
  period = $P; stores = $stores; skippedFolders = @($skippedFolders); duplicates = $dup; warnings = @($warnings)
  mails = @($mails)
}
$json = ConvertTo-JsonText $manifest
[IO.File]::WriteAllText((Join-Path $OutDir 'manifest.json'), $json, $Utf8)
[IO.File]::WriteAllText((Join-Path $OutDir 'manifest.js'), ('window.P27_COLLECT = ' + $json + ";`n"), $Utf8)
[IO.File]::WriteAllText((Join-Path $OutDir 'pdfdata.js'), ('window.P27_PDF = ' + (ConvertTo-JsonText $pdfData) + ";`n"), $Utf8)
$log = @('업무보고 자동수집 기록', ('기간: ' + $modeKo + ' ' + $P.start + ' ~ ' + $P.end), ('만든 때: ' + $manifest.generatedAt), '')
foreach ($s in $stores) { $log += ('데이터 파일: ' + $s.name + ' [' + $s.kind + '] ' + $s.path + ' — ' + $scopeKo[$s.scope] + ' — 메일 ' + $s.mails + '통') }
$log += ''; $log += ('뺀 폴더: ' + (@($skippedFolders) -join ', ')); $log += ('같은 메일 한 번만: ' + $dup + '통'); $log += @($warnings)
[IO.File]::WriteAllText((Join-Path $OutDir '수집기록.txt'), ($log -join "`r`n"), (New-Object System.Text.UTF8Encoding($true)))

# 업무보고 도구를 이 결과로 여는 작은 페이지(브라우저 주소 뒤의 #… 가 빠지지 않도록 페이지 안에서 이동)
$toolUrl = ConvertTo-FileUrl (Join-Path $ToolRoot 'index.html')
$manUrl = ConvertTo-FileUrl (Join-Path $OutDir 'manifest.js')
$go = $toolUrl + '#/make?collect=' + [Uri]::EscapeDataString($manUrl)
$launcher = Join-Path $OutDir '보고서_열기.html'
$html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>업무보고 열기</title></head><body style="font-family:sans-serif;padding:24px">' +
  '<p>업무보고 도구를 여는 중입니다. 열리지 않으면 <a id="go">여기</a>를 눌러 주세요.</p>' +
  '<script>var u = ' + (ConvertTo-JsonString $go) + '; document.getElementById("go").href = u; location.replace(u);</script></body></html>'
[IO.File]::WriteAllText($launcher, $html, $Utf8)

Say ('저장 폴더: ' + $OutDir) 'Green'
foreach ($w in $warnings) { Say ('  주의: ' + $w) 'Yellow' }
if (-not $NoOpen) {
  if (Test-Path -LiteralPath (Join-Path $ToolRoot 'index.html')) { Start-Process -FilePath $launcher; Say '업무보고 도구를 엽니다. 창에서 「보고서 만들기」를 눌러 주세요.' }
  else { Say ('업무보고 도구(index.html)를 찾지 못했습니다. 도구를 열고 「수집 폴더 열기」로 위 폴더를 골라 주세요.') 'Yellow' }
}
if (-not $NoPause) { [void](Read-Host '엔터를 누르면 이 창을 닫습니다') }
