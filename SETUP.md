# OIP 설정

## 1. Supabase

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql) 전체를 실행합니다.
3. Project Settings → API에서 Project URL과 `service_role` 키를 복사합니다.

기존에 사용 중인 Supabase 프로젝트도 기능 업데이트 후 `supabase/schema.sql`
전체를 SQL Editor에서 한 번 다시 실행합니다. 기존 데이터는 유지되고 새 테이블만
추가됩니다.

## 2. 비밀번호와 환경 변수

프로젝트 루트에 `.env.local`을 만들고 `.env.example` 항목을 채웁니다.

- `SUPABASE_URL`: Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase `service_role` 키
- `OIP_PASSWORD`: 앱에서 그대로 사용할 공통 비밀번호
- `OIP_SESSION_VERSION`: 기본값 `1`
- `PUBLIC_HOLIDAY_API_KEY`: 공공데이터포털 한국천문연구원 특일 정보 API 키
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: 웹 푸시용 VAPID 키 쌍
- `VAPID_SUBJECT`: 푸시 발송자 연락처 (`mailto:본인이메일` 형식 권장)
- `CRON_SECRET`: 오전 8시 알림 작업 API를 보호하는 16자 이상의 임의 문자열

`service_role` 키와 비밀번호는 GitHub에 올리지 마세요. 환경 변수 이름에 `NEXT_PUBLIC_`을 붙이면 브라우저에 노출되므로 사용하지 않습니다.

캘린더를 처음 열면 해당 연도의 대한민국 공휴일을 자동으로 Supabase에 저장합니다. 공휴일이 보이지 않으면 `PUBLIC_HOLIDAY_API_KEY`가 Vercel의 Production 환경에 들어 있는지 확인하고 다시 배포합니다.

## 3. 로컬 실행

```bash
npm install
npm run dev
```

환경 변수 없이 로컬에서 확인할 때의 임시 비밀번호는 `oip`입니다. 데이터 연결이 없으면 예시 데이터 없이 빈 상태로 표시됩니다.

## 4. Vercel

1. Vercel에서 `wkdeogh/OIP` 저장소를 Import합니다.
2. 위 환경 변수를 Production, Preview에 각각 추가합니다.
3. Framework Preset은 Next.js로 두고 배포합니다. 빌드 명령은 저장소의 `vercel.json`에 이미 설정되어 있습니다.

`OIP_PASSWORD`를 변경하면 기존 세션도 자동으로 무효화됩니다. 비밀번호는 유지하면서 기존 기기 인증만 모두 끊으려면 `OIP_SESSION_VERSION` 값을 1 올리고 다시 배포합니다.

## 5. 아이폰 일정 푸시 알림

1. 최신 [`supabase/schema.sql`](./supabase/schema.sql)을 SQL Editor에서 다시 실행해 `push_subscriptions`, `push_delivery_log` 테이블을 만듭니다.
2. 프로젝트 폴더에서 아래 명령으로 VAPID 키를 한 번만 생성합니다.

```bash
npx web-push generate-vapid-keys --json
```

3. 출력된 `publicKey`, `privateKey`를 각각 Vercel의 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` 환경 변수에 저장합니다. `VAPID_SUBJECT`와 임의로 생성한 `CRON_SECRET`도 함께 저장합니다.
4. Production을 다시 배포합니다. 예약 작업은 UTC 23:00, 즉 한국시간 매일 오전 8시에 `/api/cron/calendar-reminders`를 호출합니다.
5. 각 아이폰의 홈 화면에서 OIP를 실행하고 헤더의 종 모양 버튼을 누른 뒤 알림을 허용합니다. 선택한 사용자에 해당하는 기기로 테스트 알림이 바로 도착합니다.

공통·개인 일정은 두 사용자에게 보이고, `나만보기` 일정은 작성자에게만 전송됩니다. 그날 보이는 일정이 없으면 푸시를 보내지 않습니다. 아이폰에서 종 버튼이 지원되지 않는다고 표시되면 기존 홈 화면 아이콘을 삭제한 뒤 Safari에서 OIP를 홈 화면에 다시 추가합니다.

Vercel Hobby 플랜은 예약 작업을 지정된 한 시간 안에 실행하므로 알림이 오전 8시~8시 59분 사이에 도착할 수 있습니다. Pro 이상은 지정한 분에 실행됩니다.
