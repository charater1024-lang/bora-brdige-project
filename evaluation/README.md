# 합성 평가와 검증 기록

내부 회귀·제출 준비도를 점검하는 데이터셋과 버전별 검증 설명입니다. 실제 고객 기록, 운영 DB, 모델 가중치 또는 운영 로그를 배포하는 폴더가 아닙니다.

## 평가 종류

| 평가 | 위치·실행 | 해석 |
| --- | --- | --- |
| Core v2 | [데이터셋 안내](datasets/README.md), `npm run eval:judge` | 28개 저장 합성 사례의 내부 계약 회귀 |
| Coverage v17 | [v17 artifact](datasets/bora-judge-coverage-v17/), `npm run eval:judge:coverage` | 기존 600개 사례를 후보 소스·의존성 해시에 연결한 오프라인 재생 |
| RAG 진단 v1 | [진단 안내](datasets/bora-rag-benchmark-v1.README.md), `npm run eval:rag` | 합성 질문의 검색·문맥·인용 관련 진단 |
| 릴리스 검증 문서 | 이 폴더의 버전별 `.md` | 해당 변경의 검사 범위·관찰과 미검증 항목 |

현재 소스는 v0.8.11 후보입니다. 이 폴더의 기록이나 평가 성공은 후보의 운영 배포 완료, 장기 무장애, 실시간 API 가용성, 외부 심사 점수를 뜻하지 않습니다. 모델 호출 없는 재생 점수를 실제 생성형 모델의 정답률로 표시하면 안 됩니다.

## 실행과 보존

루트에서 고정 의존성을 설치한 뒤 다음 명령을 사용합니다.

```bash
npm run eval:judge
npm run eval:judge:validate-coverage
npm run eval:judge:coverage
npm run eval:rag
```

coverage-v17의 `manifest.json`, `integrity.json`, `provenance.json`, `release.json`은 데이터·소스·의존성의 해시를 연결합니다. 소스가 달라지면 검증이 실패할 수 있으며, 검증을 통과시키려고 기존 봉인 파일이나 과거 점수를 덮어쓰면 안 됩니다. 변경된 평가 기준은 새 식별자로 구분합니다.

일부 README와 설정 파일도 봉인된 소스 목록에 포함됩니다. 공개 설명 추가 시에도 해시 검증을 다시 확인하세요. 과거 버전은 당시의 증거로 보존하며 새 실행 결과로 소급 해석하지 않습니다.

원천 데이터 최신성, 실제 OAuth·외부 API·모델, 금융·법률 적합성, 접근성과 사용자 경험은 별도 검증 대상입니다. [테스트 안내](../tests/README.md)와 [공개 소스 보안](../SECURITY.md)을 함께 확인하세요.
