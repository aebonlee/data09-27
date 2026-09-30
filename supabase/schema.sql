-- ============================================================================
-- data09-27 — 업무보고 자동생성 Agent
-- Supabase(PostgreSQL) DB 스키마 + RLS
--
--  실행 위치 : 수강생 본인 Supabase 프로젝트(또는 사내 PostgreSQL)의 SQL Editor 에서 실행
--              (Dashboard → SQL Editor → 이 파일 전체를 붙여넣고 Run)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  지금 도구는 브라우저 localStorage 의 `data09-27.report` 한 칸에 모든 것을 둡니다. DB 연결은 2단계입니다.
--    collect          → collect_run_log   (수집 1회 = 기간 · 데이터 파일별 메일 수 · 첨부 수) — 기록이라 고치거나 지우지 않음
--    settings·period  → report_period     (보고서 1건 = 유형 · 기간 · 작성자 · 요약 · 승인)
--    mails[]          → report_mail       (근거 메일의 「찾아갈 수 있는 정보」만 — 본문 · 첨부 글 칸이 없다)
--    items[]          → report_item       (실적 · 계획 · 이슈 한 줄 = 보고서 문장 + 근거 메일 ID)
--    history[]        → report_history_log(승인한 보고서 — 다음 보고의 「이전 계획」) — 기록이라 덧붙이기만
--
--  설계: 메일 본문과 첨부 글은 DB 에 두지 않는다. 사내 메일은 기밀 · 개인정보가 섞여 있고, 보고서에 필요한 것은
--        항목 문장과 「어느 메일 · 어느 첨부가 근거인가」뿐이다. 원문은 수강생 PC 의 수집 폴더 · Outlook 에 그대로 있다.
--        report_mail.attachments 에 글(text) 칸이 들어오면 DB 가 막는다(report_mail_no_attachment_text).
--  권한 원칙 : 모든 행은 만든 사람(owner_id = auth.uid())만 봅니다(개인 도구 전제).
--              메일 · 항목은 (owner_id, period_ref) 복합 외래키로 「내 보고서」에만 붙습니다.
--  이 스키마는 수강생 본인 프로젝트 전제라 테이블 이름에 접두사를 붙이지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 실행 위치 가드 — 드림아이티비즈 공용 프로젝트에서는 여기서 멈춘다
--   이 파일은 접두사 없는 이름(collect_run_log · report_period · report_mail · report_item · set_updated_at() …)을 쓴다. 공용 프로젝트에는 같은 이름의
--   개체가 이미 있을 수 있고 다른 사이트 정책이 그것을 쓰므로, 실행하면 그 사이트들이
--   깨진다(2026-09-30 실제 사고 — data09-01 schema.sql 이 공용 프로젝트의 is_admin() 을 덮어씀).
-- ----------------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.www_profiles') is not null or to_regclass('public.user_profiles') is not null then
    raise exception '공용 프로젝트입니다 — schema.sql 은 수강생 본인 Supabase 프로젝트 전용입니다. 공용 프로젝트에서는 실행하지 마세요.';
  end if;
end;
$guard$;

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 수집 1회 기록 — 수집기(주간보고.bat · 월간보고.bat)가 만든 manifest 의 요약
create table if not exists public.collect_run_log (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  period_type     text not null check (period_type in ('weekly', 'monthly')),
  period_start    date not null,
  period_end      date not null,
  generated_at    timestamptz not null default now(),
  computer        text not null default '',
  stores          jsonb not null default '[]'::jsonb check (jsonb_typeof(stores) = 'array'),   -- [{name, kind: online|pst, mails}]
  mail_count      integer not null default 0 check (mail_count >= 0),
  attachment_count integer not null default 0 check (attachment_count >= 0),
  duplicates      integer not null default 0 check (duplicates >= 0),              -- Online 과 .pst 에 함께 있던 같은 메일 수
  skipped_folders text[] not null default '{}',
  warnings        text[] not null default '{}',
  created_at      timestamptz not null default now(),
  constraint collect_run_log_range check (period_end >= period_start and period_end - period_start <= 31),
  constraint collect_run_log_owner_id_uniq unique (owner_id, id)
);

-- 보고서 1건 — 같은 사용자 · 유형 · 시작일이면 같은 보고서(upsert onConflict = 'owner_id,report_type,period_start')
create table if not exists public.report_period (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  report_type     text not null check (report_type in ('weekly', 'monthly')),
  period_start    date not null,
  period_end      date not null,
  title           text not null default '',
  author          text not null default '',
  summary         text not null default '',
  status          text not null default '초안' check (status in ('초안', '승인')),
  approved_at     timestamptz,
  collect_ref     bigint,                                                            -- 어느 수집에서 만들었나(없으면 직접 넣은 메일)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint report_period_range check (period_end >= period_start and period_end - period_start <= 31),
  constraint report_period_approved check ((status = '승인') = (approved_at is not null)),
  constraint report_period_uniq unique (owner_id, report_type, period_start),
  constraint report_period_owner_id_uniq unique (owner_id, id),
  constraint report_period_collect_fk foreign key (owner_id, collect_ref) references public.collect_run_log (owner_id, id)
);

-- 근거 메일 — 본문 칸이 없다. 첨부는 [{name, kind, extract}] 만(글 없음)
create table if not exists public.report_mail (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  period_ref      bigint not null,
  mail_id         text not null check (mail_id ~ '^E[0-9]{3,}$'),                  -- 'E001'
  message_id      text not null default '',                                         -- Message-ID(같은 메일 판정 · Outlook 에서 다시 찾기)
  in_reply_to     text not null default '',
  store_kind      text not null default 'online' check (store_kind in ('online', 'pst', 'manual')),
  store_name      text not null default '',                                         -- 데이터 파일 이름(Online 사서함 · .pst)
  folder          text not null default '',
  direction       text not null default 'received' check (direction in ('received', 'sent')),
  from_name       text not null default '',
  from_email      text not null default '',
  sent_at         timestamptz,
  sent_day        date,
  subject         text not null default '',
  attachments     jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  project         text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint report_mail_uniq unique (period_ref, mail_id),
  constraint report_mail_period_fk foreign key (owner_id, period_ref) references public.report_period (owner_id, id) on delete cascade,
  constraint report_mail_no_attachment_text check (not jsonb_path_exists(attachments, '$[*].text'))
);
create unique index if not exists report_mail_msgid_uniq on public.report_mail (period_ref, message_id) where message_id <> '';
create index if not exists report_mail_day_idx on public.report_mail (owner_id, sent_day);

-- 실적 · 계획 · 이슈 항목 — 규칙 · AI 항목은 근거 메일이 있거나 「확인 필요」여야 한다
create table if not exists public.report_item (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  period_ref      bigint not null,
  item_id         text not null check (item_id ~ '^[RAMF][0-9]{3,}$'),             -- R 본문 규칙 · F 첨부 규칙 · A AI · M 직접 입력
  origin          text not null check (origin in ('rule', 'ai', 'manual')),
  source          text not null default 'body' check (source in ('body', 'attachment', 'manual')),
  attachment      text not null default '',                                         -- source = attachment 일 때 첨부 파일 이름
  category        text not null check (category in ('실적', '계획', '이슈')),
  status          text not null default '확인 필요' check (status in ('예정', '진행 중', '완료', '지연', '보류', '확인 필요')),
  project         text not null default '',
  task_name       text not null default '',
  body            text not null check (length(trim(body)) > 0),                     -- 보고서에 쓰는 한 문장(메일 원문 아님)
  item_date       date,
  release_date    date,                                                             -- 결과물 배포일(첨부 · 보낸 메일로 찾은 것)
  evidence        text[] not null default '{}',                                     -- 근거 mail_id 목록
  explicit        boolean not null default true,
  decision        boolean not null default false,
  conflict        text not null default '',
  reviewed        boolean not null default false,
  excluded        boolean not null default false,
  note            text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint report_item_uniq unique (period_ref, item_id),
  constraint report_item_period_fk foreign key (owner_id, period_ref) references public.report_period (owner_id, id) on delete cascade,
  constraint report_item_evidence check (origin = 'manual' or cardinality(evidence) >= 1 or status = '확인 필요'),
  constraint report_item_attachment check ((source = 'attachment') = (attachment <> '') and (source <> 'attachment' or left(item_id, 1) = 'F'))
);
create index if not exists report_item_period_idx on public.report_item (period_ref);

-- 승인한 보고서 — 쌓기만 한다. 같은 기간을 다시 승인하면 새 행이 쌓이고 최신 행을 쓴다
create table if not exists public.report_history_log (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  report_type     text not null check (report_type in ('weekly', 'monthly')),
  period_start    date not null,
  period_end      date not null,
  approved_at     timestamptz not null default now(),
  counts          jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),   -- {performance, plan, issue, check, mails}
  plans           jsonb not null default '[]'::jsonb check (jsonb_typeof(plans) = 'array'),     -- [{project, text}]
  created_at      timestamptz not null default now(),
  constraint report_history_log_range check (period_end >= period_start)
);
create index if not exists report_history_log_owner_idx on public.report_history_log (owner_id, period_end desc);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거 (search_path 고정)
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['report_period', 'report_mail', 'report_item']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만. 기록(_log)은 읽기 · 덧붙이기만(UPDATE/DELETE 정책 없음)
-- ----------------------------------------------------------------------------

alter table public.collect_run_log    enable row level security;
alter table public.report_period      enable row level security;
alter table public.report_mail        enable row level security;
alter table public.report_item        enable row level security;
alter table public.report_history_log enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['collect_run_log', 'report_period', 'report_mail', 'report_item', 'report_history_log']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
    if t not like '%log' then
      execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_update', t);
      execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', t || '_delete', t);
    end if;
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 표 권한 — Supabase 는 새 표마다 anon 에도 전 권한을 붙인다. 정책 + 권한 회수 두 겹.
--    기록 표는 authenticated 에게도 UPDATE · DELETE 권한을 주지 않는다.
-- ----------------------------------------------------------------------------

revoke all on public.collect_run_log, public.report_period, public.report_mail, public.report_item, public.report_history_log from anon;
revoke all on public.collect_run_log, public.report_history_log from authenticated;
grant select, insert, update, delete on public.report_period, public.report_mail, public.report_item to authenticated;
grant select, insert on public.collect_run_log, public.report_history_log to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한 — PUBLIC 과 anon 을 둘 다 끊는다(Supabase 가 anon 에 자동 부여하므로).
--    트리거 전용 함수는 authenticated 를 남긴다.
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated;

-- ============================================================================
-- 끝.
-- ============================================================================
