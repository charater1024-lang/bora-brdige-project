# 로컬 개발과 비공개 설정

이 저장소는 실행 소스를 포함하지만 원래 서버의 DB·로그인 앱·API 키·Local AI 모델을 제공하지 않습니다. 무키 화면 탐색, 통합 기능 설정, 운영 배포를 구분하세요.

## 1. 의존성과 개발 서버

Node.js 22.16 이상, npm, Git을 준비합니다. 저장소 루트에서 잠금파일을 사용합니다.

```bash
npm ci
npm run dev
```

브라우저에서는 터미널에 표시된 로컬 주소로 접속합니다. 빌드는 `npm run build`, 정적 검사는 `npm run lint`와 `npx tsc --noEmit`입니다. 개발 서버는 개인 PC의 루프백에서 사용하고 외부 공개용 서버로 취급하지 마세요.

## 2. 필요한 경우에만 비공개 환경 파일 작성

`.env.example`을 `.env.local`로 복사하고 자신이 사용하는 환경에 맞게 편집합니다. 예제의 키·토큰은 비어 있으며 기본 서비스 주소는 원래 프로젝트의 공개 도메인입니다. 원래 서비스에 인증 요청이 향하지 않도록 로컬 주소를 명시하세요.

```dotenv
AUTH_MODE=external
APP_BASE_URL=http://127.0.0.1:3000
KAKAO_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback/kakao
NAVER_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback/naver
DISABLE_BILLABLE_APIS=true
AUTH_ALLOW_INSECURE_LAN=false
```

위 주소는 로컬 개발 예시입니다. 포트가 다르면 함께 수정하고, OAuth를 시험할 경우 제공기관이 해당 callback을 허용하는지 본인 개발 앱에서 확인합니다. 운영 앱의 주소를 임의로 바꾸지 마세요. 인증정보를 입력하지 않은 공급자는 로그인할 수 없습니다.

- `.env.local`과 실제 설정 파일은 Git에 추가하지 않습니다. `git check-ignore .env.local`로 제외 여부를 확인할 수 있습니다.
- `DISABLE_BILLABLE_APIS=true`를 유지합니다. 키만 넣었다고 자동으로 모든 제공기관이나 AI가 활성화되는 것은 아닙니다.
- 공개 도메인, API endpoint, 루프백 주소는 비밀값이 아닙니다. 하지만 새 설치에는 본인의 origin·callback·연락처·관리자 식별자를 설정해야 합니다.
- 새 환경용 키를 생성하는 것과 기존 DB를 계속 운영하는 것은 다릅니다. 기존 DB의 API 키 복호화에 쓰던 암호화 키를 잃거나 임의로 교체하면 복구할 수 없습니다.

## 3. DB 파일과 DB 구조를 구분

`db/schema.ts`와 `drizzle/`은 데이터 구조·변경 이력입니다. 실제 회원·자산·수집 데이터는 포함하지 않습니다. 개발 런타임은 로컬 D1 상태를 사용하며 데이터가 없는 화면은 빈 결과를 표시할 수 있습니다.

`npm run db:migrate:local`은 DB를 자동으로 찾거나 새 파일을 만드는 명령이 아닙니다. **이미 존재하는 격리 DB 파일과 적용할 SQL 파일을 명시해야 합니다.** 다음은 문법 예시이며 경로를 그대로 실행하면 안 됩니다.

```text
npm run db:migrate:local -- <existing-isolated.sqlite> <migration.sql> [more-migrations.sql...]
```

신규 DB인지 기존 DB인지, 런타임에서 생성된 테이블과 적용된 migration이 무엇인지 확인한 뒤 순서를 결정하세요. 운영 DB를 개발 테스트에 복사하거나 대상 DB를 검색 결과의 첫 파일로 추측하지 마세요. [DB 안내](../db/README.md), [스키마 안내](../drizzle/README.md)를 함께 읽습니다.

## 4. 기능별로 필요한 별도 준비

| 기능 | 필요한 입력·구성 | 없는 경우 |
| --- | --- | --- |
| 네이버·카카오 로그인 | 본인의 OAuth 앱과 callback 설정, DB | 해당 로그인 불가 |
| 계정 자산 저장 | 정상 세션과 DB | 비로그인 임시 입력만 사용 |
| 공식정보 수집 | 서비스별 승인·API 키·활성화·수집 실행 | 미연동·빈 결과 또는 기존 로컬 자료 |
| Local AI | Ollama 모델·FastAPI 게이트웨이·서로 다른 추론/관리자 토큰 | 추론 사용 불가 |
| 관리자 기능 | 검증한 provider:subject와 서버 설정 | 관리자 접근 차단 |

[Local LLM 설정](../local-llm-server/README.md)을 읽고 모델의 라이선스·메모리 요구량을 직접 확인하세요. 모델 파일은 저장소에 없습니다. 연결을 검증하기 전 과금형 공급자를 켜지 마세요.

## 5. 검사와 운영의 경계

검사 명령과 한계는 [tests](../tests/README.md)를 따릅니다. 합성 데이터로 실행되는 테스트 통과는 실제 OAuth 왕복·외부 API 승인·모델 답변 품질의 검증과 다릅니다.

운영은 별도 단계입니다. `deploy/`에는 Linux 서비스·백업·보안용 템플릿과 스크립트가 있지만 자동 실행하지 않습니다. 경로·계정·권한·DB 백업·복구·방화벽·TLS를 검토한 뒤 별도 운영 승인을 거쳐야 합니다. [공개 소스/운영 호환](public-runtime-parity.md)은 무중단 또는 자동 호환 보증이 아닙니다.
