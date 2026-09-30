# Supabase DB 스크립트

이 폴더에는 이 도구의 저장 데이터를 PostgreSQL(Supabase 또는 사내 PostgreSQL)로 옮길 때 쓰는 스키마가 들어 있습니다.
지금 도구는 **계정 없이 브라우저 저장소(localStorage)** 만 씁니다. DB 에 연결하는 코드는 2단계에서 붙입니다.

## 왜 DB 가 필요한가 (2단계)

- **보고 이력을 PC · 브라우저와 상관없이 남기기** — 승인한 보고서의 계획이 다음 보고의 「이전 계획 대비」에 쓰입니다. 브라우저 저장소는 PC 마다 따로이고 정리하면 사라집니다.
- **정해진 시간에 자동 실행(작업 스케줄러)** 할 때 수집 기록 · 초안을 한곳에 모으기.
- **팀 단위 보고** — 여러 사람의 주간보고를 모아 월간으로(권한 설계는 2단계).

## 메일 원문은 DB 에 두지 않습니다

사내 메일에는 기밀 · 개인정보가 섞여 있습니다. 보고서에 필요한 것은 **항목 문장**과 **어느 메일 · 어느 첨부가 근거인가**뿐이라, DB 에는 그것만 둡니다.

- `report_mail` 에는 본문 칸이 없습니다(Message-ID · 제목 · 날짜 · 데이터 파일 · 폴더로 Outlook 에서 다시 찾음).
- 첨부는 `[{name, kind, extract}]` 만 — **첨부 글(text)이 들어오면 DB 가 거절합니다**(`report_mail_no_attachment_text`).
- 원문과 첨부 파일은 수강생 PC 의 수집 폴더와 Outlook 에 그대로 있습니다.

## 테이블

| 테이블 | 용도 | localStorage 대응 |
|---|---|---|
| `collect_run_log` | 수집 1회 — 기간 · 데이터 파일별 메일 수(Online · .pst) · 첨부 수 · 같은 메일 수 · 뺀 폴더 · 알림 | `collect` |
| `report_period` | 보고서 1건 — 유형 · 기간 · 작성자 · 요약 · 승인, 어느 수집에서 만들었나 | `settings` · `approved` |
| `report_mail` | 근거 메일 — 메일 ID · Message-ID · 데이터 파일 · 폴더 · 보낸/받은 · 보낸이 · 날짜 · 제목 · 첨부 이름 · 프로젝트 | `mails[]` (본문 · 첨부 글 제외) |
| `report_item` | 실적 · 계획 · 이슈 한 줄 — 출처(본문 · 첨부 · 직접) · 첨부 이름 · 분류 · 상태 · 문장 · 날짜 · 결과물 배포일 · 근거 메일 ID | `items[]` |
| `report_history_log` | 승인한 보고서 — 다음 보고의 「이전 계획」 | `history[]` |

### 권한

- 모든 표에 RLS(행 수준 보안)를 켰고, 모든 행은 만든 사람만 봅니다(`owner_id = auth.uid()`, 자동으로 채워짐).
- 메일 · 항목은 `(owner_id, period_ref)` 복합 외래키로 **내 보고서에만** 붙습니다. 남의 보고서 번호를 알아내도 끼워 넣을 수 없습니다. 보고서의 `collect_ref` 도 내 수집 기록만 가리킵니다.
- 기록 표(`collect_run_log` · `report_history_log`)는 SELECT · INSERT 정책만 있고, UPDATE · DELETE 권한도 회수했습니다.
- 보고서를 지우면 그 메일 · 항목도 지워지지만, 수집 기록과 승인 이력은 남습니다.
- 로그인하지 않은 사용자(anon)는 어떤 표도 읽거나 쓸 수 없습니다.
- 앱에서 upsert 할 때 `onConflict` 는 `owner_id,report_type,period_start`(보고서) · `period_ref,mail_id`(메일) · `period_ref,item_id`(항목)입니다.

## 적용 방법

1. <https://supabase.com> 에 가입하고 이 도구 전용으로 새 프로젝트를 만듭니다(그래서 표 이름에 접두사가 없습니다). 사내 PostgreSQL 을 쓸 때는 `auth.uid()` 를 사내 로그인 체계에 맞게 바꿔야 합니다.
2. 왼쪽 메뉴 **SQL Editor** 에 `supabase/schema.sql` 내용을 전부 붙여넣고 **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고 정책 · 트리거는 지우고 다시 만듭니다.

## 확인 방법

1. **Table Editor** 에 위 5개 표가 있고, 표마다 RLS 가 켜져 있는지 봅니다.
2. **Authentication → Policies** 에서 정책이 16개(보고서 · 메일 · 항목 4개씩, 기록 2개 표는 SELECT · INSERT 2개씩)인지 봅니다.
3. SQL Editor 에서 함수 권한에 `anon` 이 없는지 봅니다.

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
```

## 로컬 검증 방법

운영에서 처음 실행하지 않도록, 임시 로컬 PostgreSQL 에 실제로 적용해 검사하는 도구를 함께 두었습니다(run.sh · 스텁 · 공통 검사는 data09-11 과 같은 파일).

```sh
./scripts/sqltest/run.sh
```

PostgreSQL 16 이상이 필요합니다(macOS: `brew install postgresql@17`). 임시 DB 를 만들어 쓰고 끝나면 지웁니다.
