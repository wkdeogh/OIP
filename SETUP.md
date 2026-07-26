# OIP 설정

## 1. Supabase

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql) 전체를 실행합니다.
3. Project Settings → API에서 Project URL과 `service_role` 키를 복사합니다.

## 2. 비밀번호와 환경 변수

터미널에서 `npm run setup:secrets`를 실행하면 비밀번호 해시와 세션 키가 생성됩니다.

프로젝트 루트에 `.env.local`을 만들고 `.env.example` 항목을 채웁니다.

- `SUPABASE_URL`: Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase `service_role` 키
- `OIP_PASSWORD_HASH`, `OIP_SESSION_SECRET`, `OIP_SESSION_VERSION`: 위 명령의 출력값
- `PUBLIC_HOLIDAY_API_KEY`: 공공데이터포털 특일 정보 API 키(공휴일 동기화 구현 시 사용)

`service_role` 키와 세션 키는 GitHub에 올리지 마세요.

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

공통 비밀번호를 바꾼 뒤 기존 기기 인증을 모두 끊으려면 `OIP_SESSION_VERSION` 값을 1 올리고 다시 배포합니다.
