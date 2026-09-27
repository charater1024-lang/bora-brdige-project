# 회귀 테스트

기능·권한·요청 제한·저장 경계·운영 도구의 계약을 검증합니다. 합성 입력과 격리된 fixture를 사용하며, 실제 회원 DB나 운영 환경 파일을 테스트 입력으로 넣지 마세요. 일부 테스트는 임시 파일·로컬 프로세스·loopback 서버를 만들므로 모든 검사가 순수한 읽기 작업인 것은 아닙니다.

## Node.js 테스트

저장소 루트에서 고정 의존성을 준비합니다. `npm test`는 빌드를 포함하며, 이름이 `tests/`에 있는 모든 파일을 자동 실행하는 방식은 아닙니다.

| 명령 | 범위 |
| --- | --- |
| `npm test` | 빌드와 기본 회귀, RAG·신뢰성·기존 운영 수정 회귀의 연결 실행 |
| `npm run test:followup-fixes` | 수집·조회·AI 제한시간·로그인 복구 등 후속 수정 |
| `npm run test:parity` | 배포 호환·권한·본문 제한·공개 소스·조회 경계 |
| `npm run test:ux` | 홈·내비게이션·차트·금액 입력·모바일 계약 |
| `npm run test:ops` | 운영 보조 스크립트와 런타임 관련 회귀 |
| `npm run test:public-source` | 공개 소스 검사기의 합성 회귀 |

집중 실행 예: `node --test --test-concurrency=1 tests/auth-callback-recovery.test.mjs`. 개별 테스트가 빌드 산출물을 사용하는지 먼저 확인하고, 필요한 경우 `npm run build`를 선행합니다. `npm run lint`, `npx tsc --noEmit`는 별도의 정적 검사입니다.

## Python과 Linux 통합 검사

게이트웨이·백업·준비 상태·자료 적재 관련 Python 테스트는 `test_*.py`에 있습니다. 표준 라이브러리만 사용하는 토큰 검사 예시는 다음과 같습니다.

```bash
python -m unittest discover -s tests -p test_local_llm_security.py -v
```

`test_local_llm_gateway.py`는 [Local LLM requirements](../local-llm-server/requirements.txt)를 설치한 격리 환경이 필요합니다. 운영 보조 테스트는 [운영 의존성](../deploy/requirements-ops.txt)과 각 테스트의 전제를 확인하세요. Python 테스트가 `npm test`에 모두 포함된 것은 아닙니다.

`npm run test:ops:integration`은 Linux/Bash의 감시기·Worker 정지 통합 검사입니다. Windows PowerShell에서 그대로 실행 가능한 검사로 취급하지 말고, 격리 Linux 환경에서 실행합니다. 이는 실제 운영 서버의 재부팅·부하 시험을 대신하지 않습니다.

## 결과 해석

테스트 통과는 검사한 계약의 회귀 신호입니다. 외부 API 이용 승인·현재 가용성, 실제 생성 응답 품질, 금융·법률적 정확성이나 운영 배포 완료를 보증하지 않습니다. 공개 사본의 키·실제 DB·운영 설정·모델 누락을 임의의 실제 자격증명으로 보충하지 마세요. 합성 평가의 범위는 [evaluation](../evaluation/README.md)에 별도로 설명되어 있습니다.
