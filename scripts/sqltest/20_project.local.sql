-- ============================================================================
-- 로컬 검증 전용 — data09-27 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A · B 두 명과 비로그인(anon)을 번갈아 흉내 내어
--  ① 본인 행만 보이는가 ② 남의 보고서에 메일 · 항목을 끼워 넣을 수 없는가(복합 외래키)
--  ③ 기록(collect_run_log · report_history_log)은 고치거나 지울 수 없는가 ④ anon 은 아무것도 못 하는가
--  ⑤ 메일 본문 · 첨부 글을 DB 에 두지 않는 설계를 DB 가 지키는가 ⑥ CHECK · UNIQUE · 연쇄 삭제 를 잰다.
--  값은 전부 가상(예시 수집 결과와 같은 이야기).
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice '  OK   %', p_label; return; end if;
    raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 % — %)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %  (기대 SQLSTATE % 인데 성공했다)', p_label, p_state;
end;
$fn$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com')
on conflict (id) do nothing;

do $t$ begin raise notice '[프로젝트] data09-27 — 소유자 격리 · 내 보고서에만 · 기록 불변 · 본문 · 첨부 글 없음 · anon 차단 · 제약'; end $t$;

-- ----------------------------------------------------------------------------
-- 1. 사용자 A — 수집 1회 · 주간 보고서 1건 · 근거 메일 2통 · 항목 3건 · 승인 이력
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare v_run bigint; v_rep bigint;
begin
  insert into public.collect_run_log (period_type, period_start, period_end, computer, stores, mail_count, attachment_count, duplicates, skipped_folders)
  values ('weekly', '2026-09-21', '2026-09-27', 'EXAMPLE-PC', '[{"name":"me@example.com (가상)","kind":"online","mails":5},{"name":"Mail backup (가상)","kind":"pst","mails":2}]', 7, 8, 1, '{지운 편지함,정크 메일}')
  returning id into v_run;
  insert into public.report_period (report_type, period_start, period_end, title, author, collect_ref)
  values ('weekly', '2026-09-21', '2026-09-27', '디자인팀(가상)', '보고자(가상)', v_run) returning id into v_rep;
  insert into public.report_mail (period_ref, mail_id, message_id, store_kind, store_name, folder, direction, from_email, sent_day, subject, attachments) values
    (v_rep, 'E001', 'cab-101@example.com', 'online', 'me@example.com (가상)', '받은 편지함\캡 인테리어', 'received', 'lead@example.com', '2026-09-21', '[캡 인테리어 개선] 1차 시안 검토 회의 결과 공유',
     '[{"name":"캡_1차시안_검토회의록.docx","kind":"word","extract":"ok"},{"name":"B안_렌더링_정면.png","kind":"image","extract":"meta"}]'),
    (v_rep, 'E005', 'expo-301@example.com', 'online', 'me@example.com (가상)', '보낸 편지함', 'sent', 'me@example.com', '2026-09-24', '[전시회 준비] 부스 렌더링 v2 배포',
     '[{"name":"전시부스_렌더링_v2.pptx","kind":"ppt","extract":"ok"}]');
  insert into public.report_item (period_ref, item_id, origin, source, attachment, category, status, project, body, evidence, release_date) values
    (v_rep, 'R001', 'rule', 'body', '', '실적', '완료', '캡 인테리어 개선', '시안 3종 검토 완료, B안 최종 시안 선정', '{E001}', null),
    (v_rep, 'F001', 'rule', 'attachment', '캡_1차시안_검토회의록.docx', '이슈', '지연', '캡 인테리어 개선', '협력사 조작부 치수 회신 지연 — 확인 필요', '{E001}', null),
    (v_rep, 'R009', 'rule', 'body', '', '실적', '완료', '전시회 준비', '조명 위치 조정 · 관람 동선 안 반영', '{E005}', '2026-09-24');
  insert into public.report_history_log (report_type, period_start, period_end, counts, plans)
  values ('weekly', '2026-09-14', '2026-09-20', '{"performance":3,"plan":5,"issue":1}', '[{"project":"전시회 준비","text":"부스 렌더링 이미지 제출"}]');
  perform public._assert_eq((select count(*) from public.report_mail), 2::bigint, 'A 는 자기 근거 메일 2통을 본다');
  perform public._assert_eq((select owner_id from public.report_item where item_id = 'F001'), '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id 기본값이 auth.uid() 로 채워진다');
  perform public._assert_eq((select release_date from public.report_item where item_id = 'R009'), '2026-09-24'::date, '결과물 배포일을 항목에 둔다');
end $t$;
commit;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  update public.report_period set status = '승인', approved_at = now();
  perform public._assert((select updated_at > created_at from public.report_period), 'updated_at 트리거가 수정 시각을 갱신한다');
  perform public._assert_raises($s$update public.collect_run_log set mail_count = 99$s$, '42501', 'A 도 수집 기록을 고칠 수 없다');
  perform public._assert_raises($s$delete from public.collect_run_log$s$, '42501', 'A 도 수집 기록을 지울 수 없다');
  perform public._assert_raises($s$update public.report_history_log set plans = '[]'$s$, '42501', 'A 도 승인 이력을 고칠 수 없다');
  perform public._assert_raises($s$delete from public.report_history_log$s$, '42501', 'A 도 승인 이력을 지울 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 2. 사용자 B — A 의 행을 보지도, 고치지도, 끼워 넣지도 못한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint; v_a bigint;
begin
  perform public._assert_eq(
    (select count(*) from public.collect_run_log) + (select count(*) from public.report_period) + (select count(*) from public.report_mail)
    + (select count(*) from public.report_item) + (select count(*) from public.report_history_log),
    0::bigint, 'B 에게는 A 의 행이 5개 표 어디에서도 보이지 않는다');
  update public.report_item set body = '조작';
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 항목에 닿지 않는다');
  delete from public.report_period;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 DELETE 는 A 의 보고서에 닿지 않는다');
  perform public._assert_raises(
    $s$insert into public.report_period (owner_id, report_type, period_start, period_end) values ('11111111-1111-1111-1111-111111111111', 'weekly', '2026-09-28', '2026-10-04')$s$,
    '42501', 'B 는 owner_id 를 A 로 적어 대신 쓸 수 없다');
  -- B 가 A 의 보고서 번호를 알아냈다고 가정한다(번호는 1부터 차례로 붙는다)
  perform public._assert_raises($s$insert into public.report_item (period_ref, item_id, origin, category, body, evidence) values (1, 'R900', 'rule', '실적', '끼워 넣기', '{E001}')$s$,
    '23503', 'B 는 자기 owner_id 로라도 A 의 보고서에 항목을 끼워 넣을 수 없다 (복합 외래키)');
  perform public._assert_raises($s$insert into public.report_mail (period_ref, mail_id) values (1, 'E900')$s$,
    '23503', 'B 는 A 의 보고서에 메일을 끼워 넣을 수 없다 (복합 외래키)');
  perform public._assert_raises($s$insert into public.report_period (report_type, period_start, period_end, collect_ref) values ('weekly', '2026-09-21', '2026-09-27', 1)$s$,
    '23503', 'B 는 A 의 수집 기록을 자기 보고서에 붙일 수 없다 (복합 외래키)');
  insert into public.report_period (report_type, period_start, period_end) values ('weekly', '2026-09-21', '2026-09-27');
  perform public._assert_eq((select count(*) from public.report_period), 1::bigint, '같은 기간이라도 사용자가 다르면 따로 저장된다');
end $t$;
commit;

do $t$
begin
  perform public._assert_eq((select count(*) from public.report_item where owner_id = '11111111-1111-1111-1111-111111111111'), 3::bigint, 'B 의 시도 뒤에도 A 의 항목 3건은 그대로다');
end $t$;

-- ----------------------------------------------------------------------------
-- 3. 비로그인(anon) — 읽기도 쓰기도 막힌다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '';
set local role anon;
do $t$
declare t text;
begin
  foreach t in array array['collect_run_log', 'report_period', 'report_mail', 'report_item', 'report_history_log']
  loop
    perform public._assert_raises(format('select * from public.%I', t), '42501', 'anon 은 ' || t || ' 를 읽을 수 없다');
  end loop;
  perform public._assert_raises($s$insert into public.collect_run_log (period_type, period_start, period_end) values ('weekly', '2026-09-21', '2026-09-27')$s$, '42501', 'anon 은 수집 기록을 남길 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 4. 정책 구조
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.polname, ', ') into v_bad
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%owner_id = auth.uid()%';
  perform public._assert(v_bad is null, '모든 정책이 owner_id = auth.uid() 로 묶여 있다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    16::bigint, '정책 수가 16개다 (보고서 · 메일 · 항목 4개씩 + 기록 2표 2개씩, 재실행해도 늘지 않는다)');
  perform public._assert(not has_table_privilege('authenticated', 'public.report_history_log', 'UPDATE') and not has_table_privilege('authenticated', 'public.collect_run_log', 'DELETE'),
    '기록 표는 authenticated 에게도 UPDATE · DELETE 권한이 없다');
  perform public._assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'report_mail' and column_name in ('body', 'text', 'main')),
    'report_mail 에 본문 칸이 없다(메일 원문은 DB 에 두지 않음)');
end $t$;

-- ----------------------------------------------------------------------------
-- 5. CHECK · UNIQUE · 연쇄 삭제
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare v_rep bigint;
begin
  select id into v_rep from public.report_period limit 1;
  perform public._assert_raises(format($s$insert into public.report_mail (period_ref, mail_id, attachments) values (%s, 'E010', '[{"name":"a.docx","kind":"word","text":"회의록 전문"}]')$s$, v_rep),
    '23514', '첨부 글(text)은 DB 에 넣을 수 없다 — 이름 · 종류 · 상태만');
  perform public._assert_raises(format($s$insert into public.report_mail (period_ref, mail_id, store_kind) values (%s, 'E011', 'imap')$s$, v_rep), '23514', '데이터 파일 종류는 online · pst · manual 중 하나다');
  perform public._assert_raises(format($s$insert into public.report_mail (period_ref, mail_id) values (%s, 'M0001')$s$, v_rep), '23514', '메일 ID 는 E001 형식이다');
  perform public._assert_raises(format($s$insert into public.report_mail (period_ref, mail_id, message_id) values (%s, 'E012', 'cab-101@example.com')$s$, v_rep), '23505', '한 보고서에 같은 Message-ID 메일은 한 번만(Online · .pst 중복)');
  perform public._assert_raises(format($s$insert into public.report_item (period_ref, item_id, origin, source, attachment, category, body, evidence) values (%s, 'R020', 'rule', 'attachment', 'a.docx', '실적', '문장', '{E001}')$s$, v_rep),
    '23514', '첨부에서 뽑은 항목은 F 번호다');
  perform public._assert_raises(format($s$insert into public.report_item (period_ref, item_id, origin, source, category, body, evidence) values (%s, 'F020', 'rule', 'attachment', '실적', '문장', '{E001}')$s$, v_rep),
    '23514', '첨부에서 뽑은 항목은 첨부 이름이 있어야 한다');
  perform public._assert_raises(format($s$insert into public.report_item (period_ref, item_id, origin, category, status, body) values (%s, 'R021', 'rule', '실적', '완료', '근거 없는 완료')$s$, v_rep),
    '23514', '근거 메일 없는 규칙 항목은 「확인 필요」여야 한다');
  perform public._assert_raises(format($s$insert into public.report_item (period_ref, item_id, origin, category, body, evidence) values (%s, 'R022', 'rule', '잡담', '문장', '{E001}')$s$, v_rep), '23514', '분류는 실적 · 계획 · 이슈 중 하나다');
  perform public._assert_raises($s$insert into public.collect_run_log (period_type, period_start, period_end) values ('weekly', '2026-09-21', '2026-12-31')$s$, '23514', '수집 기간은 한 달을 넘지 않는다');
  perform public._assert_raises($s$insert into public.collect_run_log (period_type, period_start, period_end, stores) values ('weekly', '2026-09-21', '2026-09-27', '{}')$s$, '23514', '데이터 파일 목록은 배열이다');
  perform public._assert_raises($s$update public.report_period set approved_at = null$s$, '23514', '승인 상태와 승인 시각은 짝이다');
  perform public._assert_raises($s$insert into public.report_period (report_type, period_start, period_end) values ('weekly', '2026-09-21', '2026-09-27')$s$, '23505', '같은 사용자 · 유형 · 시작일 보고서는 하나뿐이다');

  delete from public.report_period where id = v_rep;
  perform public._assert_eq((select count(*) from public.report_mail) + (select count(*) from public.report_item), 0::bigint, '보고서를 지우면 그 메일 · 항목도 함께 지워진다');
  perform public._assert_eq((select count(*) from public.collect_run_log) + (select count(*) from public.report_history_log), 2::bigint, '보고서를 지워도 수집 기록 · 승인 이력은 남는다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 6. 함수 권한
-- ----------------------------------------------------------------------------
do $t$
begin
  perform public._assert(not has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE'), 'anon 은 트리거 함수를 실행할 수 없다');
  perform public._assert(has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE'), 'authenticated 는 트리거 함수를 실행할 수 있다(수정이 막히지 않게)');
end $t$;
