# BORA Judge Core 데이터셋 문서와 생성 이력

이 디렉터리는 BORA Bridge의 **내부 제출 준비도**를 재현 가능하게 점검하는 합성 평가 artifact를 보관합니다. 현재 실행 기준은 `bora-judge-core-v2.json`이며, 28개 offline replay 케이스를 합산해 자동점수 100점을 구성합니다.

이 점수는 해커톤 공식 점수, 금융상품 적합성 판정, 보안 인증, 모델 성능 인증이 아닙니다. 실제 고객·금융소비자·피해자·심사위원 데이터도 포함하지 않습니다.

기계 판독 가능한 현재 생성·검수 이력은 `bora-judge-core-v2.provenance.json`입니다. v1 fixture와 `bora-judge-core-v1.provenance.json`은 과거 버전의 이력으로 그대로 보존하며, v2 설명으로 소급 수정하지 않습니다.

## 현재 artifact

| 역할 | 파일 | 식별자 | SHA-256 |
| --- | --- | --- | --- |
| 실행 fixture | `bora-judge-core-v2.json` | `bora-judge-core-2026-08-11-v2` | `f849abc73a7389b4fb9ea74c405c2613f3365771852756aeb737f222687ca45e` |
| API 계약 fixture | `bora-api-contract-snapshots-v1.json` | `bora-api-contracts-2026-08-11` | `d84cf7f8b6bc82709f5b4031a115c13e1a5028c225bcef07e2126f082513ede5` |
| 제출 증거 구조 | `bora-submission-evidence-v1.json` | `bora-submission-evidence-2026-08-11` | `c440ddb2352e32573afd7142200bc31549a9ec9ce43cf0ac0f038caf5832ddfb` |
| 생성·검수 이력 | `bora-judge-core-v2.provenance.json` | `bora-judge-provenance/v2` | Git commit으로 추적 |

현재 runner는 `bora-evaluator/2.0`, 세션 schema는 v3입니다. core fixture의 schema는 `bora-judge-dataset/v2`, 케이스 수는 28, 자동점수 상한은 100, 수동점수는 0입니다. 전체 28건의 `execution`은 `offline-replay`입니다. v3 세션은 core·API snapshot·submission evidence 세 SHA-256을 함께 고정하며 어느 하나라도 달라지면 기존 세션에서 실행·확정할 수 없습니다.

SHA-256은 JSON을 파싱한 결과가 아니라 **LF 줄바꿈을 포함한 파일 원시 바이트**를 대상으로 합니다. `.gitattributes`가 `evaluation/datasets/*.json`을 LF로 고정합니다.

중요하게도 core SHA-256은 `bora-judge-core-v2.json` 한 파일의 바이트만 고정합니다. 별도 import되는 API snapshot과 submission evidence manifest의 바이트는 core hash에 포함되지 않습니다. 완전한 release 재현에는 위 세 JSON의 hash와 Git commit을 함께 보관해야 합니다.

## API snapshot에 대한 필수 고지

`bora-api-contract-snapshots-v1.json`은 **live capture가 아닙니다**.

- `sourceType`은 `normalized-contract-fixture`입니다.
- `liveCapture`는 `false`입니다.
- `externalCallsDuringEvaluation`은 `false`입니다.
- `recordedResponse`는 라우트 구현과 기존 테스트의 응답 계약을 개인정보 없이 정규화한 고정 예시입니다.
- 포함된 날짜, 상태, HTTPS URL, 합성 항목은 현재 운영 API에서 관측한 값이라는 뜻이 아닙니다.
- 이 snapshot은 현재 배포 가용성, 인증, 지연시간, 쿼터, 최신 공공데이터를 증명하지 않습니다.

따라서 결과에는 “저장된 API 계약 fixture 통과”라고 표현해야 합니다. “라이브 API 호출 성공”, “현재 API 200 확인”, “2026-08-10 데이터 실측”이라고 표현하면 안 됩니다. 실제 가용성은 자동 core 점수와 분리된 API 진단이나 배포 smoke test에서 확인해야 합니다.

## GPT-5.6 Sol의 실제 역할

2026-08-11 Codex 협업 작업에서 OpenAI GPT-5.6 Sol로 구성된 코딩 에이전트가 다음 작업을 지원했습니다.

1. 저장소의 TypeScript 구현, 테스트, 개인정보·금융안전 경계를 읽고 평가 표면을 선정했습니다.
2. 실제 사용자 기록을 사용하지 않고 일반·경계·고위험·적대적 합성 입력을 작성했습니다.
3. 기대값을 구현 코드와 기존 회귀 테스트의 계약에 맞춰 도출하고 반복 검토했습니다.
4. 외부 호출, 동일 Worker self-fetch, rate-limit 간섭, 증거 과장, dataset hash와 runner pin 위험을 검토했습니다.
5. API 계약 fixture와 제출 증거 manifest의 의미와 한계를 분리했습니다.

정확한 표현은 “이 Codex 작업 세션에서 GPT-5.6 Sol 기반 에이전트가 코드 근거 합성 케이스의 작성과 검토를 지원했다”입니다.

다음은 주장하지 않습니다.

- GPT-5.6 Sol이 금융·법률·보안 정답을 독립 인증했다.
- OpenAI가 데이터셋, 제품 또는 평가 결과를 보증·인증했다.
- GPT-5.6 Sol의 학습 데이터 출처를 이 artifact가 증명한다.
- 금융·법률·보안 전문가 또는 해커톤 주최 측이 독립 검수했다.
- 서명된 inference log, portable model run ID 또는 제3자 검증 가능한 모델 실행 증명이 있다.

독립 전문가 검수 상태는 명시적으로 `not_performed`입니다. 외부 제출 전에 금융·법률·개인정보·보안·접근성·공정성 검토를 별도로 수행해야 합니다.

## 전자동 실행 중 호출 수

v2 core 자동평가는 저장된 fixture를 메모리에서 재생합니다.

| 항목 | core 자동평가 1회 |
| --- | ---: |
| GPT-5.6 Sol 또는 다른 생성형 모델 호출 | 0 |
| 유료 AI provider 호출 | 0 |
| 외부 HTTP/API 호출 | 0 |
| 라이브 API capture | 0 |
| 동일 Worker self-fetch | 0 |
| offline replay 케이스 | 28 |

모델은 **데이터셋 작성·코드 근거 검토 시점**에 사용됐고, 평가 실행 시 다시 호출되지 않습니다. 저장된 snapshot 안에 HTTPS 문자열이 존재하는 것은 네트워크 호출이 아닙니다. 또한 이 0-call 주장은 `runOfflineJudgeCases()`가 실행하는 core 자동평가 범위에 한정됩니다. 별도의 배포 진단, 사용자가 실행하는 실제 API 기능, CI dependency 설치까지 0-call이라고 주장하지 않습니다.

## 생성 방법과 oracle

1. **평가 표면 목록화**: 금융 계산, RAG 근거, 법률 의도, 보안 triage, 피싱 규칙, 필수 동의, AI 문맥 개인정보, 저장형 API 계약, 빌드 계약, 제출 증거를 선정했습니다.
2. **합성 입력 작성**: 실제 계좌·고객·피해 기록·비밀키 없이 최소 숫자와 문장을 작성했습니다. PII 제거 케이스의 이메일·전화·식별번호도 테스트 전용 합성 문자열입니다.
3. **코드 oracle 도출**: 계산값, enum, 검색 문서 ID, 점수, 거부 오류, redaction marker를 실제 구현에서 도출했습니다.
4. **정책 oracle 제한**: 주관적인 혁신성·사업성·발표력은 채점하지 않고, 제출 증거의 구조와 금지 주장 부재만 확인합니다.
5. **offline 고정**: API 응답은 live capture 대신 별도 계약 fixture로 저장하고, 모델·외부 API 없이 replay합니다.
6. **재현성 기록**: core ID, runner version, 세 artifact raw SHA-256, case별 input/output fingerprint, assertion과 sourceRefs를 결과에 기록합니다. 8자리 FNV‑1a‑32 값은 반복 비교용 비암호학적 fingerprint이며 artifact 무결성은 SHA-256으로 확인합니다.

모델이 제안한 문장 자체가 oracle은 아닙니다. oracle은 저장소 코드에서 결정되는 값 또는 dataset에 명시한 내부 준비도 정책입니다. 같은 저장소에서 기대값을 도출하는 white-box 방식이므로 독립 benchmark보다 회귀 smoke set에 가깝습니다.

## 28개 시나리오의 실제 분포

`riskClass`는 각 케이스에 저장된 상호 배타적 주 분류이며 점수 가중치와 별개입니다.

| 분류 | 건수 | 비율 | 의미 |
| --- | ---: | ---: | --- |
| 일반 `typical` | 11 | 39.29% | 정상 입력, 저위험 대조군, 계약·증거 정상 구조 |
| 경계 `boundary` | 6 | 21.43% | 0원, 상한, 빈 신호, 미동의, 관련 없음, API 고지 경계 |
| 고위험 금융상황 `high-risk-finance` | 7 | 25.00% | 과도 지출, 피싱·불법추심, 고위험 거래, PII 노출 위험 |
| 적대적 `adversarial` | 4 | 14.29% | 신호 주입, 기관 사칭·원격제어, 허용 외 필드, prompt injection |

“고위험 금융상황”은 사고·행동 맥락을 뜻합니다. 사람이나 인구집단을 위험군으로 분류하지 않으며 민감 속성으로 개인 위험도를 산출하지 않습니다.

케이스 ID 분포:

- 일반 11: `finance-surplus`, `settlement-budget`, `money-unit-conversion`, `rag-foreign-grounding`, `phishing-low-risk`, `consent-current-versions`, `context-explicit-opt-in`, `api-health-snapshot`, `challenge-build-contract`, `submission-evidence-manifest`, `dataset-provenance`
- 경계 6: `finance-input-bounds`, `finance-zero`, `law-unknown-intent`, `triage-empty`, `consent-incomplete-rejected`, `api-public-data-snapshot`
- 고위험 금융상황 7: `settlement-over-budget`, `rag-phishing-grounding`, `law-voice-phishing-intent`, `law-debt-collection-intent`, `triage-high-priority`, `phishing-high-risk`, `context-pii-redaction`
- 적대적 4: `triage-allowlist`, `phishing-adversarial`, `context-extra-field-rejected`, `context-injection-rejected`

## suite와 점수 분포

| suite | 케이스 | 자동점수 |
| --- | ---: | ---: |
| `financial-correctness` | 6 | 18 |
| `evidence-grounding` | 5 | 15 |
| `financial-safety` | 6 | 24 |
| `privacy-consent` | 6 | 24 |
| `stored-api-contract` | 2 | 8 |
| `reproducibility` | 3 | 11 |
| 합계 | 28 | 100 |

critical 케이스는 15건입니다. 점수가 높아도 critical 케이스 실패는 별도로 노출되어야 합니다. 자동 100점은 내부 구현·안전·증거 완결성 점수이며 해커톤 공식 평가를 환산하지 않습니다.

## 코드·artifact 근거

| 영역 | 케이스 수 | 주요 근거 |
| --- | ---: | --- |
| 금융 계산 | 6 | `lib/manual-finance.ts`, `lib/foreign-settlement.ts`, `lib/money-input.ts` |
| RAG·법률 의도 | 5 | `lib/rag/knowledge.ts`, `lib/legal/financial-law.ts` |
| triage·피싱 | 6 | `lib/security-triage.ts`, `app/api/phishing/route.ts` |
| 동의·AI 문맥 개인정보 | 6 | `lib/auth/account-lifecycle.ts`, `lib/ai/context-store.ts` |
| 저장형 API 계약 | 2 | `bora-api-contract-snapshots-v1.json` 및 각 route/test sourceRefs |
| 재현성·제출 증거 | 3 | `lib/challenge-contract.ts`, `bora-submission-evidence-v1.json`, v2 fixture와 이 README |

core case의 `sourceRefs`는 코드 근거를 찾기 위한 workspace-relative evidence path입니다. `submission-evidence-manifest` 자동 검사는 requirement ID, 허용 상태, 금지 주장, reference **개수**를 확인하지만 모든 경로의 파일 존재나 내용의 품질을 판정하지 않습니다. 제출 bundle이 앱 repository 밖에 있는 경우 release 검수자가 실제 파일을 별도로 확인해야 합니다.

## submission evidence의 의미

`bora-submission-evidence-v1.json`의 `qualityClaim`은 `evidence-completeness-only`입니다.

- 요구사항 5개의 구조적 존재와 최소 evidence reference 수를 확인합니다.
- `documented`, `tested`, `hypothesis-not-measured` 상태를 구분합니다.
- `official-score`, `guaranteed-outcome`, `measured-without-baseline` 같은 금지 claim type이 없는지 확인합니다.
- evidence reference의 존재·정확성·설득력 또는 실제 KPI 성과를 자동 인증하지 않습니다.
- `hypothesis-not-measured`를 실측 효과로 표현하면 안 됩니다.

## 자동 검수와 사람 검수의 경계

자동 core 평가는 계산, 정규화, 검색 순위, 의도 enum, triage 점수, 피싱 규칙, 동의 파싱, 문맥 sanitization, 저장된 계약 구조, 증거 manifest 구조를 확인합니다.

별도 사람 검토가 필요한 항목:

- 금융 계산·안내의 제도 적합성과 최신성
- 법령, 신고 번호, 개인정보 처리의 법적 적합성
- 고위험 오탐·미탐의 수용 가능성
- 실제 배포 URL과 API의 현재 가용성·인증·쿼터·신선도
- 다국어 품질, 접근성, 인구집단별 공정성
- 생성형 AI 응답의 사실성·환각·안전성
- 문제 정의, 혁신성, 사업성, 발표 설득력과 KPI 실측

## 알려진 한계

1. 28건은 회귀용 smoke set이며 통계적 benchmark가 아닙니다.
2. 같은 저장소 코드에서 입력·기대값을 만든 white-box 평가라 구현 편향과 과적합 가능성이 있습니다.
3. 실제 사용자·사고·운영 트래픽 분포를 대표하지 않습니다.
4. 한국어 중심이며 세 피싱 케이스는 영어 locale입니다. 다국어 품질을 포괄하지 않습니다.
5. 독립 금융·법률·보안·개인정보·공정성 전문가 검수가 수행되지 않았습니다.
6. GPT-5.6 Sol provenance는 Codex 세션의 자기기술 기록이며 서명된 제3자 증명이 아닙니다.
7. 저장형 API snapshot은 live capture가 아니고 현재 가용성·최신성을 증명하지 않습니다.
8. submission evidence 검사는 참조 구조를 확인할 뿐 참조 파일의 실재·내용 품질을 모두 검증하지 않습니다.
9. core hash 하나는 별도 snapshot/evidence JSON의 바이트를 포함하지 않습니다.
10. 전자동 core 점수는 생성형 AI 응답 품질, 환각, 모델 공정성을 측정하지 않습니다.
11. public route parsing, rate limit, browser 통합, 네트워크 경계는 별도 통합 테스트가 필요합니다.
12. 주관적인 해커톤 평가 요소와 실측 KPI를 자동점수로 단정하지 않습니다.

## hash·version 정책

- core fixture 바이트가 바뀌면 core SHA-256을 다시 계산하고 pin을 갱신합니다.
- API snapshot 또는 submission evidence manifest가 바뀌면 각각의 hash와 provenance를 갱신합니다.
- 실행 의미, adapter 또는 채점 로직이 바뀌면 `runnerVersion`을 올립니다.
- 호환되지 않는 schema 변경은 새 파일과 새 dataset ID로 발행합니다.
- v1 provenance는 v1 이력으로 보존하고 v2 내용을 소급 기록하지 않습니다.
- provenance 문서만 바뀌고 실행 fixture가 바뀌지 않았다면 core hash나 runner version을 바꾸지 않습니다.
- release evidence에는 core·snapshot·submission manifest 세 hash, runner version, Git commit, test/build log를 함께 보관합니다.

## 재현 절차

Windows PowerShell:

```powershell
git check-attr text eol -- evaluation/datasets/bora-judge-core-v2.json evaluation/datasets/bora-api-contract-snapshots-v1.json evaluation/datasets/bora-submission-evidence-v1.json
Get-FileHash -Algorithm SHA256 -LiteralPath .\evaluation\datasets\bora-judge-core-v2.json
Get-FileHash -Algorithm SHA256 -LiteralPath .\evaluation\datasets\bora-api-contract-snapshots-v1.json
Get-FileHash -Algorithm SHA256 -LiteralPath .\evaluation\datasets\bora-submission-evidence-v1.json
node --test --test-concurrency=1 tests/judge-evaluation.test.mjs
npm run eval:judge
npm run build
```

POSIX shell:

```sh
git check-attr text eol -- evaluation/datasets/bora-judge-core-v2.json evaluation/datasets/bora-api-contract-snapshots-v1.json evaluation/datasets/bora-submission-evidence-v1.json
sha256sum evaluation/datasets/bora-judge-core-v2.json evaluation/datasets/bora-api-contract-snapshots-v1.json evaluation/datasets/bora-submission-evidence-v1.json
node --test --test-concurrency=1 tests/judge-evaluation.test.mjs
npm run eval:judge
npm run build
```

1. 재현할 Git commit을 checkout합니다.
2. 세 JSON의 Git attribute가 `text: set`, `eol: lf`인지 확인합니다.
3. 세 SHA-256을 이 README와 v2 provenance manifest의 값에 대조합니다.
4. committed lockfile로 dependency를 설치합니다.
5. focused dataset test와 `npm run eval:judge`를 실행해 세 raw SHA-256, 2회 byte-identical replay, 관찰된 fetch/현재시각 호출 0, 점수·fingerprint를 확인한 뒤 전체 test를 실행합니다.
6. 최종 build를 새로 생성해 stale `dist`를 배포하지 않습니다.
7. export에 dataset ID, core hash, runner version, case assertion/digest, 실행 시각이 포함됐는지 확인합니다.
8. 보조 artifact hash, Git commit, test/build logs와 수동 검수 기록을 함께 보존합니다.
9. live 배포/API 진단은 offline core 결과와 분리해 기록합니다.

명령 성공 여부는 각 release의 CI 로그나 검수 기록으로 보관해야 합니다. 이 문서와 provenance manifest 자체는 특정 build의 테스트 통과를 서명하는 attestation이 아닙니다.

## 버전 이력

- **v2 — 현재**: 28 offline replay 케이스, 자동 100점, 금융안전·개인정보·저장형 API 계약·제출 증거까지 확장. `bora-judge-core-v2.provenance.json` 사용.
- **v1 — 보존**: 16개 초기 내부 준비도 케이스. `bora-judge-core-v1.json`과 `bora-judge-core-v1.provenance.json`은 역사적 artifact이며 현재 runner source가 아닙니다.
