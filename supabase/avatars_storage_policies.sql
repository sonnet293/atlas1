-- Supabase 대시보드 > SQL Editor 에서 실행.
-- avatars 버킷: 로그인한 Firebase 유저가 자기 폴더(avatars/{firebase uid}/...)에만 업로드/덮어쓰기/삭제 가능.
-- 읽기는 공개 버킷 URL(/object/public/...)로 하므로 정책과 무관.
--
-- Firebase 토큰에는 role 클레임이 없어 요청이 anon 역할로 들어오고, uid가 UUID가 아니라 auth.uid()도 못 쓴다.
-- 그래서 anon, authenticated 둘 다 대상으로 하고, 토큰 발급자/대상(iss/aud)이 이 Firebase 프로젝트인지와
-- 폴더 이름 = 토큰의 sub(Firebase uid)인지로 검사한다. (Supabase 기본 anon 키 토큰은 iss가 달라 통과 못 함)

drop policy if exists "avatars_select_own" on storage.objects;
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

create policy "avatars_select_own" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'avatars'
    and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/atlas-f52d2'
    and auth.jwt() ->> 'aud' = 'atlas-f52d2'
    and (storage.foldername(name))[1] = auth.jwt() ->> 'sub'
  );

create policy "avatars_insert_own" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'avatars'
    and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/atlas-f52d2'
    and auth.jwt() ->> 'aud' = 'atlas-f52d2'
    and (storage.foldername(name))[1] = auth.jwt() ->> 'sub'
  );

create policy "avatars_update_own" on storage.objects
  for update to anon, authenticated
  using (
    bucket_id = 'avatars'
    and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/atlas-f52d2'
    and auth.jwt() ->> 'aud' = 'atlas-f52d2'
    and (storage.foldername(name))[1] = auth.jwt() ->> 'sub'
  )
  with check (
    bucket_id = 'avatars'
    and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/atlas-f52d2'
    and auth.jwt() ->> 'aud' = 'atlas-f52d2'
    and (storage.foldername(name))[1] = auth.jwt() ->> 'sub'
  );

create policy "avatars_delete_own" on storage.objects
  for delete to anon, authenticated
  using (
    bucket_id = 'avatars'
    and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/atlas-f52d2'
    and auth.jwt() ->> 'aud' = 'atlas-f52d2'
    and (storage.foldername(name))[1] = auth.jwt() ->> 'sub'
  );
