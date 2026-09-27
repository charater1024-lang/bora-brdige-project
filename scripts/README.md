# 개발·검증·운영 보조 도구

이 폴더는 하나의 설치 순서가 아닙니다. 실행 전에 해당 파일의 인수·출력·쓰기 대상과 필요한 권한을 확인하세요. 아래 명령은 저장소 루트 기준입니다.

## 소스 검사와 오프라인 평가

| 진입점 | 범위 |
| --- | --- |
| `npm run check:public-source:head` | 현재 Git 커밋의 공개 금지 파일·비밀값 패턴 검사 |
| `npm run check:public-source:history` | 도달 가능한 Git 이력 검사. 과거 이력을 공개해도 된다는 자동 보증은 아님 |
| `npm run test:public-source` | 공개 소스 검사기의 합성 회귀 테스트 |
| `npm run eval:judge` | core-v2의 저장된 28개 합성 사례 재생 |
| `npm run eval:judge:validate-coverage` | 봉인된 coverage-v17 파일·소스 해시 검증 |
| `npm run eval:judge:coverage` | coverage-v17의 600개 합성 사례 재생 |
| `npm run eval:rag` | 저장된 합성 RAG 진단 |

Git 검사·내보내기는 유효한 Git 저장소를 전제로 합니다. 이 평가들은 운영 API 가용성이나 실제 모델 품질 검사가 아닙니다. 전체 실행 조건은 [평가](../evaluation/README.md)와 [테스트](../tests/README.md)를 참고하세요.

## 로컬 파일을 만드는 도구

- `run-vinext.mjs`: 개발·빌드·시작 래퍼. 개발 서버와 빌드는 로컬 상태·산출물을 만들 수 있습니다.
- `install-git-hooks.mjs`: 해당 저장소의 커밋 전 검사 설정을 변경합니다.
- `export-public-source.mjs`: 깨끗한 커밋을 검사한 뒤 `output/`에 이력 없는 ZIP을 만듭니다. 배포하거나 GitHub에 업로드하지 않습니다.
- `build-local-runtime-config.mjs`: 비공개 환경 파일을 실행 설정에 병합합니다. 출력 파일은 비밀정보이며 Git·공유 ZIP에 포함하면 안 됩니다.
- `generate-judge-coverage-corpus*.mjs`: 평가 artifact 생성·봉인 도구입니다. 기존 봉인 결과를 갱신하는 일반 실행 명령이 아닙니다.
- `build-seoul-commercial-boundaries.mjs`, `build_naver_review_pdf.py`: 별도 자료·문서 생성 도구입니다. 입력·의존성과 출력 공개 가능 여부를 먼저 확인합니다.

## DB 접근·변경과 운영 경계

| 파일 | 주의사항 |
| --- | --- |
| `audit-public-data.mjs` | 지정 SQLite를 읽기 전용으로 검사. 운영 상태가 출력될 수 있으므로 결과 공개 전 검토 |
| `verify-public-rag-index.mjs` | 원본 DB는 읽기 전용, 색인은 메모리에서 검증. `--local-model-env`는 실제 로컬 모델 호출을 추가하므로 단순 오프라인 검사와 다름 |
| `apply-local-sqlite-migrations.mjs` | 명시한 기존 DB에 명시한 migration을 적용하는 쓰기 작업 |
| `repair-youth-policy-dates.mjs` | `--check`와 `--apply`를 구분. 적용은 검증된 비공개 백업 필요 |
| `requeue-public-data.mjs` | 수집 상태를 변경하며 후속 스케줄러의 외부 호출·쿼터 소비로 이어질 수 있음 |
| `import-seoul-commercial-sales.py` | 자료 적재 도구. 실제 DB·API 대상으로 실행하기 전 모드와 대상을 검토 |
| `rotate-scheduler-secret.mjs` | 비밀값과 관련 실행 설정을 변경하는 자격증명 교체 작업 |
| `stage-catalog-ux-release.mjs`, `verify-catalog-ux-release.mjs` | 특정 릴리스 전제의 준비·검증. 일반 신규 설치 과정이 아님 |
| `start-local-worker.mjs`, `local-worker-options.mjs`, `local-worker-recovery.mjs` | 로컬 운영 Worker 시작·구성·복구 보조. 격리된 개발 서버 명령과 구분 |

`npm run db:migrate:local`에는 `-- <database.sqlite> <migration.sql...>` 인수가 필요합니다. DB를 자동 선택하거나 신규 DB·전체 스키마를 자동 준비하는 명령이 아닙니다. 합성/격리 DB에서 먼저 검증하고 실제 DB에는 별도 승인·백업·복구 절차를 적용합니다.

[deploy](../deploy/README.md)의 서비스 설치·전환 스크립트는 운영 상태를 바꿀 수 있습니다. 공개 소스를 읽거나 테스트하려고 실행하지 마세요. 실제 DB·API 키·운영 환경·모델은 공개 사본에 없으며, 이 문서의 존재가 해당 설정이나 서비스의 설치 완료를 의미하지 않습니다.
