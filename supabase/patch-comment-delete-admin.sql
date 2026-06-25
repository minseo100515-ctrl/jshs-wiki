-- 관리자 댓글 삭제 권한 (SQL Editor에서 실행)

create or replace function public.is_wiki_admin()
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
    false
  );
$$;

drop policy if exists "archives_delete_admin" on public."Archives";
create policy "archives_delete_admin"
  on public."Archives" for delete
  using (public.is_wiki_admin());
