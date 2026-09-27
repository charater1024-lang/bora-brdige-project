# 도메인 로직과 공통 정책

화면과 API에서 사용하는 TypeScript 모듈입니다. 별도 패키지가 아니라 기존 앱 안의 책임별 경계이며, 경로와 import 구조를 유지합니다.

## 하위 모듈

| 위치 | 책임과 경계 |
| --- | --- |
| [auth](auth/) | OAuth·세션·동의·계정 수명주기·관리자 권한. 사용자 ID는 인증 결과에서 결정 |
| [ai](ai/README.md) | 제공자 어댑터, 활성 엔진 선택, 동의 기반 문맥·대화, 요청 제한 |
| [rag](rag/README.md) | 질문 해석, 저장 자료 검색, 제한된 근거 문맥과 인용 검사 |
| [public-data](public-data/README.md) | 공식 API 어댑터, 공용 캐시·쿼터·수집, 검색·추천용 조회 |
| [legal](legal/) | 공식 법령의 고정 주제 조회·캐시·요약 품질과 공개 문의 주소 처리 |
| [http](http/) | 스트리밍 요청 본문 크기 제한과 공통 보안 헤더 |

## 루트의 기능 모듈

- `manual-finance*.ts`, `money-input.ts`: 직접 입력 장부의 계산·검증·저장. 외부 계좌 조회가 아닙니다.
- `daily-finance-guide.ts`, `financial-missions.ts`, `foreign-settlement.ts`: 금융 행동 안내·미션·정착 계산.
- `security-triage.ts`, `safe-browsing-v5.ts`, `phishing-reputation-quota.ts`: 위험 대응 안내와 선택적 URL 평판 조회·쿼터.
- `runtime-settings.ts`: 서버의 환경 설정, 암호화된 자격증명과 제공자 ON/OFF 상태.
- `judge-*.ts`, `challenge-contract.ts`: 합성 평가 계약·실행·이력·내보내기. [평가 범위](../evaluation/README.md)를 함께 확인합니다.

## 의존성과 개인정보 경계

[app/api](../app/api/README.md)가 요청을 검증한 뒤 해당 모듈을 호출하고, 저장이 필요한 서버 모듈은 [db](../db/README.md)를 사용합니다. 일부 계산·표시 헬퍼만 브라우저에서도 사용하므로, `lib` 전체를 브라우저 공용 코드로 취급하지 마세요. DB 접근·자격증명·제공자 호출 모듈을 클라이언트 컴포넌트로 가져오면 안 됩니다.

공개 사본은 실행 코드와 스키마만 제공합니다. 실제 DB·API 키·관리자 식별자·운영 설정·모델은 별도로 준비하며 Git에 넣지 않습니다. 예제의 빈 키와 비활성 상태를 임의의 데모 자격증명으로 대체하지 않습니다. 정책·법령·모델 응답은 금융·법률적 결과를 보장하지 않습니다.

관련 안내: [로컬 개발](../docs/local-development.md) · [회귀 테스트](../tests/README.md) · [보안](../SECURITY.md)
