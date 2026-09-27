# 웹 화면과 API

Next.js App Router 형태의 React 화면과 서버 API입니다. 실제 개발·빌드는 vinext/Vite와 Cloudflare 호환 런타임을 사용합니다. 폴더별 책임을 문서화한 모듈 구조이며, 각각을 독립 배포하는 마이크로서비스 구조는 아닙니다.

## 화면 위치

| 위치 | 책임 |
| --- | --- |
| [page.tsx](page.tsx), [layout.tsx](layout.tsx) | 홈 화면과 공통 문서 구성 |
| [(dashboard)](%28dashboard%29/) | 자산·기회·안전·AI 이용 안내 페이지 |
| [(public-information)](%28public-information%29/) | 환율과 청년·금융·창업·고용·정착 정보 페이지 |
| [components](components/) | 화면별 UI, 입력·차트·요청 상태 처리, 공통 안내 |
| [mypage](mypage/) | 로그인 계정의 프로필·동의·데이터 관리 |
| [developer](developer/) | 관리자 설정과 내부 평가 화면 |
| [challenge](challenge/), [privacy](privacy/), [terms](terms/) | 프로젝트 소개와 정책 안내 |
| [api](api/README.md) | HTTP 요청 검증, 인증·권한 검사와 서버 기능 진입점 |

괄호가 있는 폴더는 URL에 나타나지 않는 라우트 그룹입니다. 금융 계산·인증·자료 수집·RAG 정책은 [lib](../lib/README.md), 저장 구조는 [db](../db/README.md)에 있습니다.

## 공개 소스의 실행 범위

- API 키, 운영 환경 파일, 실제 회원 DB, 모델 가중치는 포함하지 않습니다. [로컬 개발 안내](../docs/local-development.md)에 따라 별도 비공개 설정과 격리 저장소를 준비합니다.
- 빈 키의 예제 구성에서는 외부 API·OAuth·모델 연동을 사용할 수 없습니다. 필요한 설정과 명시적 활성화 전까지 미연동 상태를 유지하며, 유료 AI 차단 설정은 기본 유지합니다.
- 직접 입력 장부는 실제 은행 계좌 연동이 아닙니다. 로그인 계정 데이터와 비로그인 기기 임시 입력을 구분합니다.
- 화면의 버튼 숨김은 권한 검사가 아닙니다. 서버 API가 세션·동의·관리자 식별자와 요청 출처를 다시 확인합니다.

루트에서 `npm run dev`로 개발하고, 변경 검증은 [테스트 안내](../tests/README.md)를 따릅니다. `developer` 화면이나 `/health`의 표시만으로 실제 모델 준비·외부 API 가용성·운영 배포 완료를 판단하지 않습니다.
