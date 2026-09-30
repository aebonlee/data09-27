<#
.SYNOPSIS
  수집기 자가검사 — Outlook 없이, 수집기의 순수 함수(CollectorCore.ps1)만 검사합니다.

.DESCRIPTION
  - samples\collect\att 의 예시 워드 · 파워포인트 · 엑셀에서 글을 뽑아, 옆의 .txt(브라우저 쪽 JS 쌍둥이가 뽑은 글)와 같은지 봅니다.
    같으면 Windows 에서 수집기가 뽑는 글과 도구가 기대하는 글이 같다는 뜻입니다.
  - 보고 기간 계산, 설정 파일 읽기, JSON 쓰기(→ 다시 읽기), 파일 이름 다듬기도 봅니다.
  실행: 압축 푼 폴더에서
    powershell -NoProfile -ExecutionPolicy Bypass -File .\collector\Test-Collector.ps1
  (macOS · 리눅스에 PowerShell 7(pwsh)이 있으면 pwsh -File collector/Test-Collector.ps1 로도 돕니다)
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CollectorCore.ps1')
$root = Split-Path $PSScriptRoot -Parent
$sample = Join-Path (Join-Path $root 'samples') 'collect'
$script:pass = 0; $script:fail = 0
function Check([bool]$ok, [string]$label) {
  if ($ok) { $script:pass++; Write-Host ('  ok   ' + $label) } else { $script:fail++; Write-Host ('  FAIL ' + $label) -ForegroundColor Red }
}

Write-Host '[수집기 자가검사] 워드 · PPT · 엑셀 글 뽑기 = 브라우저 쪽(JS)과 같은가'
$files = @(Get-ChildItem -LiteralPath (Join-Path $sample 'att') -Recurse -File | Where-Object { $_.Extension -in '.docx', '.pptx', '.xlsx' })
Check ($files.Count -eq 3) ('예시 Office 파일 3개 (찾은 수 ' + $files.Count + ')')
foreach ($f in $files) {
  $kind = Get-AttachmentKind $f.Name
  $got = Get-OoxmlTextFromFile $f.FullName $kind
  $want = [IO.File]::ReadAllText($f.FullName + '.txt', [Text.Encoding]::UTF8)
  $same = ($got -ceq $want)
  if (-not $same) {
    $g = $got -split "`n"; $w = $want -split "`n"
    for ($i = 0; $i -lt [Math]::Max($g.Count, $w.Count); $i++) { if ($g[$i] -cne $w[$i]) { Write-Host ('       ' + ($i + 1) + '번째 줄 — 수집기: 「' + $g[$i] + '」 / 기대: 「' + $w[$i] + '」'); break } }
  }
  Check $same ($f.Name + ' (' + $kind + ')')
}

Write-Host '[수집기 자가검사] 순수 함수'
Check ((ConvertFrom-XmlText 'a &lt;b&gt; &amp; &#44032;&#xAC01;') -ceq 'a <b> & 가각') 'XML 글자 풀기'
$p = Get-ReportPeriod 'weekly' ([datetime]'2026-09-30') 'this' 1;  Check ($p.start -eq '2026-09-28' -and $p.end -eq '2026-10-04') '이번 주(월 시작)'
$p = Get-ReportPeriod 'weekly' ([datetime]'2026-09-30') 'last' 1;  Check ($p.start -eq '2026-09-21' -and $p.end -eq '2026-09-27') '지난 주'
$p = Get-ReportPeriod 'weekly' ([datetime]'2026-09-27') 'this' 0;  Check ($p.start -eq '2026-09-27' -and $p.end -eq '2026-10-03') '이번 주(일 시작)'
$p = Get-ReportPeriod 'monthly' ([datetime]'2026-09-30') 'this' 1; Check ($p.start -eq '2026-09-01' -and $p.end -eq '2026-09-30') '이번 달'
$p = Get-ReportPeriod 'monthly' ([datetime]'2026-01-15') 'last' 1; Check ($p.start -eq '2025-12-01' -and $p.end -eq '2025-12-31') '지난 달(해 넘김)'
$s = Read-CollectSettingsText ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '수집설정.txt'), [Text.Encoding]::UTF8))
Check ($s['첨부최대MB'] -eq '30' -and $s['_unknown'].Count -eq 0) '수집설정.txt 읽기'
Check ((Get-SkipFolderNames $s) -contains '지운 편지함') '지운 편지함은 늘 뺌'
$obj = [ordered]@{ a = "줄`n바꿈 `"따옴표`" \ 역슬래시"; n = 3; ok = $true; list = @(1, 'x'); empty = @(); nested = [ordered]@{ k = $null } }
$back = (ConvertTo-JsonText $obj) | ConvertFrom-Json
Check ($back.a -ceq $obj.a -and $back.n -eq 3 -and $back.ok -eq $true -and $back.list.Count -eq 2 -and $null -eq $back.nested.k) 'JSON 쓰기 → 다시 읽기'
Check ((Get-SafeName 'a:b*?"<>|.docx') -eq 'a_b______.docx') '파일 이름 다듬기'
Check ((Get-AttachmentKind 'x.AI') -eq 'illustrator' -and (Get-AttachmentKind 'y.jpeg') -eq 'image') '첨부 종류'
Check ((ConvertTo-FileUrlFromFull 'C:\Users\홍 길동\업무보고\index.html') -eq 'file:///C:/Users/%ED%99%8D%20%EA%B8%B8%EB%8F%99/%EC%97%85%EB%AC%B4%EB%B3%B4%EA%B3%A0/index.html') 'file 주소(드라이브 · 한글 · 빈칸)'
Check ((ConvertTo-FileUrlFromFull '\\srv\공유\a b.js') -eq 'file://srv/%EA%B3%B5%EC%9C%A0/a%20b.js') 'file 주소(네트워크 경로)'
Check ((ConvertTo-FileUrlFromFull '/Users/me/a b.js') -eq 'file:///Users/me/a%20b.js') 'file 주소(macOS · 리눅스)'
$ai = @(Get-ChildItem -LiteralPath (Join-Path $sample 'att') -Recurse -Filter *.ai)[0]
Check (Test-LooksPdf $ai.FullName) '일러스트(.ai) PDF 호환 머리'

Write-Host ''
Write-Host ('통과 ' + $script:pass + ' · 실패 ' + $script:fail)
if ($script:fail) { exit 1 }
