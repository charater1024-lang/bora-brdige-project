# 공식 자료 수집·저장·조회

제공기관 응답을 공통 형식으로 정리하고, 사이트 공용 저장소와 호출 예산 안에서 갱신하는 모듈입니다. 사용자 화면을 열 때마다 모든 제공기관을 호출하는 구조가 아닙니다.

| 파일·묶음 | 책임 |
| --- | --- |
| `types.ts`, `policies.ts` | 공통 데이터 계약과 원천별 갱신·호출 정책 |
| `adapters.ts`, `*-adapter.ts`, `*-adapters.ts` | 공식 응답의 수집·정규화 |
| `service.ts` | 스냅샷 조회, 수집 조정, 카탈로그 검색·페이지 처리 |
| `cache.ts` | D1 저장, 수집 잠금, 호출 예약·정산과 카탈로그 세대 |
| `access.ts` | 공개/로그인 사용자별 조회 범위와 응답 투영 |
| `dates.ts`, `urls.ts`, `text.ts`, `bounded-response.ts` | 날짜·링크·텍스트와 응답 크기 검증 |
| `history.ts`, `exchange-backfill.ts` | 실제 수집된 환율 이력과 초기 이력 보충 |
| `commercial-*`, `seoul-commercial-*`, `startup-*`, `youth-*` | 상권·창업·청년 분야의 조회·매칭·표시 정책 |
| `analysis.ts`, `item-analysis-cache.ts`, `recommendations.ts` | 항목 설명 캐시와 추천 관련 처리 |
| `operations-view.ts`, `retention.ts` | 현재 수집 상태·최근 정상 자료 표시와 보존 정책 |

[대시보드 GET](../../app/api/public-data/dashboard/route.ts)은 저장 자료를 조회하며 외부 수집을 기다리지 않습니다. 내부 예약 수집과 인증된 새로고침은 별도 [API 경로](../../app/api/public-data/)를 사용하고, 원천별 주기·쿼터·실패 대기시간을 지킵니다. 수집 실패 시 직전 정상 자료와 현재 실패 상태를 구분합니다.

실제 수집 DB와 API 키는 공개 사본에 없습니다. 빈 키/비활성 원천은 미연동 상태이며, 승인받은 키를 비공개로 주입하고 명시적으로 활성화해야 합니다. 기본 OFF 상태를 일괄 해제하거나 보호 예산을 우회하지 마세요. 자료가 없다는 이유로 금융값·임대료·정책 자격을 합성하지 않습니다.

저장 자료를 AI 근거로 사용하는 부분은 [RAG](../rag/README.md), DB 구조는 [db](../../db/README.md), 수집 복구·자료 보정 도구의 변경 위험은 [scripts](../../scripts/README.md)에 설명되어 있습니다. 공식 출처·기준일·부분 수집 여부를 확인해야 하며 제공기관 이용 승인을 코드가 대신하지 않습니다.
