# OIP 설정

## 1. Supabase

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql) 전체를 실행합니다.
3. Project Settings → API에서 Project URL과 `service_role` 키를 복사합니다.

## 2. 비밀번호와 환경 변수

프로젝트 루트에 `.env.local`을 만들고 `.env.example` 항목을 채웁니다.

- `SUPABASE_URL`: Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase `service_role` 키
- `OIP_PASSWORD`: 앱에서 그대로 사용할 공통 비밀번호
- `OIP_SESSION_VERSION`: 기본값 `1`
- `PUBLIC_HOLIDAY_API_KEY`: 공공데이터포털 특일 정보 API 키(공휴일 동기화 구현 시 사용)

`service_role` 키와 비밀번호는 GitHub에 올리지 마세요. 환경 변수 이름에 `NEXT_PUBLIC_`을 붙이면 브라우저에 노출되므로 사용하지 않습니다.

## 3. 로컬 실행

```bash
npm install
npm run dev
```

환경 변수 없이 로컬에서 확인할 때의 임시 비밀번호는 `oip`이며, 데이터는 미리보기용이라 새로고침하면 초기화됩니다.

## 4. Vercel

1. Vercel에서 `wkdeogh/OIP` 저장소를 Import합니다.
2. 위 환경 변수를 Production, Preview에 각각 추가합니다.
3. Framework Preset은 Next.js로 두고 배포합니다. 빌드 명령은 저장소의 `vercel.json`에 이미 설정되어 있습니다.

`OIP_PASSWORD`를 변경하면 기존 세션도 자동으로 무효화됩니다. 비밀번호는 유지하면서 기존 기기 인증만 모두 끊으려면 `OIP_SESSION_VERSION` 값을 1 올리고 다시 배포합니다.
