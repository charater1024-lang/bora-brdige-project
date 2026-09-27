# Worker 런타임 진입점

[index.ts](index.ts)는 vinext App Router 요청 처리기를 호출하고, 응답에 공통 보안 헤더를 적용합니다. `/_vinext/image` 요청은 별도의 이미지 최적화 경로로 처리합니다.

| 바인딩 | 용도 |
| --- | --- |
| `ASSETS` | 정적 리소스 읽기 |
| `DB` | 앱의 D1 저장소 연결 |
| `IMAGES` | 이미지 최적화 경로의 변환 기능 |

타입에 바인딩이 선언되어 있어도 실제 실행 환경의 준비를 보장하지 않습니다. [vite.config.ts](../vite.config.ts)가 개발용 Worker·D1 구성을 제공하며, 실제 계정의 D1 식별자나 운영 DB는 공개 소스에 포함하지 않습니다. 미사용 또는 미제공 이미지 기능은 대상 런타임에서 별도 확인해야 합니다.

개발은 루트의 `npm run dev`, 빌드는 `npm run build`를 사용합니다. [build](../build/)의 플러그인은 빌드 산출물과 migration을 묶지만, 빌드 자체가 호스팅 배포나 운영 migration을 수행하는 것은 아닙니다.

Linux의 로컬 운영 프로필은 [scripts/start-local-worker.mjs](../scripts/start-local-worker.mjs)를 통해 loopback의 Miniflare/workerd를 실행합니다. 생성된 런타임 설정에는 비밀값이 포함될 수 있으므로 공개하거나 커밋하지 않습니다. 개발 서버와 운영 프로필을 혼용하지 말고 [로컬 개발](../docs/local-development.md)·[배포 경계](../deploy/README.md)를 확인하세요.
