-- 슈퍼 관리자 2계정 설정 (SQL Editor에서 실행)
-- 1) Supabase 대시보드 → Authentication → Users → Add user 로 계정 2개를 먼저 만드세요.
--    - wiki-admin1@jeju-s.jje.hs.kr
--    - wiki-admin2@jeju-s.jje.hs.kr
--    비밀번호 8자 이상, Auto Confirm User 체크
-- 2) 아래 SQL 전체 실행

create or replace function public.is_jshs_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'wiki_role', '')) in ('super_admin', 'admin'),
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'wiki-admin1@jeju-s.jje.hs.kr',
      'wiki-admin2@jeju-s.jje.hs.kr'
    ),
    (auth.jwt() ->> 'email') ilike '%@jeju-s.jje.hs.kr',
    false
  );
$$;

update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'wiki_role', 'super_admin',
    'nickname', '위키관리자1',
    'display_name', '위키관리자1',
    'gen', '28'
  )
where lower(email) = 'wiki-admin1@jeju-s.jje.hs.kr';

update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'wiki_role', 'super_admin',
    'nickname', '위키관리자2',
    'display_name', '위키관리자2',
    'gen', '28'
  )
where lower(email) = 'wiki-admin2@jeju-s.jje.hs.kr';
