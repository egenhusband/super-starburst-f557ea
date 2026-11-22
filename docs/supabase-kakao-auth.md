# Supabase Kakao Auth Setup

카카오 로그인으로 결제 권한을 복원하려면 프론트 localStorage가 아니라 Supabase에 카카오 계정별 권한을 저장해야 한다.

## 1. Supabase SQL 적용

Supabase 프로젝트 `대출계산기`의 SQL Editor에서 아래 파일 내용을 실행한다.

`supabase/migrations/202608190001_create_kakao_entitlements.sql`

생성되는 테이블:

- `public.kakao_entitlements`
- `kakao_user_id` 기준으로 카카오 계정 1개당 권한 1개를 저장한다.
- RLS는 켜져 있지만 공개 정책은 만들지 않는다.
- 조회/저장은 Netlify Function이 `SUPABASE_SERVICE_ROLE_KEY`로만 수행한다.

## 2. Netlify 환경변수

Netlify Site settings > Environment variables에 추가한다.

- `SUPABASE_URL`: `https://dvkztssdytyduxeicomy.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase Project settings > API의 service_role key
- `PAYWALL_PASSWORD`: 현재 결제 비밀번호

주의: `SUPABASE_SERVICE_ROLE_KEY`는 절대 `index.html`, `kakao-auth.js` 같은 프론트 파일에 넣지 않는다.

## 3. 동작 흐름

1. 사용자가 비밀번호로 입장한다.
2. 카카오 저장 안내가 뜬다.
3. `카카오로 저장하기`를 누르면 Netlify Function이 카카오 access token을 검증한다.
4. 검증된 카카오 사용자 ID를 Supabase `kakao_entitlements`에 저장한다.
5. 다음 방문부터 `이미 결제했다면 카카오로 자동 입장하기`를 누르면 Supabase에서 권한을 확인하고 바로 입장한다.

## 4. 로컬 테스트

Supabase 환경변수가 없거나 Netlify Function 라우팅이 없는 로컬 환경에서는 기존 localStorage 방식으로 fallback된다.

실서버 테스트 전에는 Netlify 환경변수와 Supabase SQL 적용이 끝났는지 확인해야 한다.

## 5. 내 저장 (관심 단지 · 저장한 계산 · 출근지) — 2026-11 추가

SQL Editor에서 아래 파일을 실행한다. (`public.set_updated_at()` 함수는 기존 마이그레이션에서 이미 만들어져 있어야 한다.)

`supabase/migrations/202611220001_create_user_saved_items.sql`

- 테이블: `public.user_saved_items` (kakao_user_id, kind, item_key 복합 키)
- kind: `calculation`(최대 30개) · `apartment`(최대 200개) · `commute`(1개)
- 결제 여부와 무관하게 카카오로 연결한 사용자는 저장할 수 있다 (`kakao_entitlements`와 FK 없음).
- API: `POST /api/saved-items` `{ action: 'sync', accessToken, upserts, deletes }` → 전체 목록 반환
- 테이블이 아직 없으면 API가 `501 table_missing`을 돌려주고, 프론트는 이 기기(localStorage)에만 저장한 채로 동작한다.
