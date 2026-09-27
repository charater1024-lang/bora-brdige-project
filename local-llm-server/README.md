# BORA Ollama Gateway

웹앱과 Ollama 사이에서 모델 전환, 인증, 허용 목록을 담당하는 내부 전용 API입니다. Ollama와 이 게이트웨이는 모두 loopback 주소에만 바인딩하므로 인터넷에서 직접 접근할 수 없습니다.

## 이 폴더의 구성

| 파일 | 역할 |
| --- | --- |
| `app.py` | FastAPI 수명주기와 HTTP 엔드포인트 |
| `gateway_security.py` | 추론/관리 토큰 검증과 안전한 설정 오류 |
| `setup_tokens.py` | 값을 출력하지 않는 독립 토큰 생성·교체 |
| `.env.example` | 비밀값이 비어 있는 설정 예시 |
| `requirements.txt` | 게이트웨이 Python 의존성 |

웹앱의 상담·RAG·사용자 동의 정책은 이 폴더가 아니라 `app/api/ai`와 `lib`에 있습니다. [웹 API 안내](../app/api/README.md)와 [배포 안내](../deploy/README.md)를 함께 확인하세요. 모델 가중치와 `runtime` 상태는 Git에 포함하지 않습니다.

## GTX 1650 4GB 기본 모델

기본값은 LG AI Research의 공식 `EXAONE 4.0 1.2B GGUF` 중 `Q4_K_M`입니다.

```text
hf.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q4_K_M
```

공식 FP8 체크포인트는 최신 FP8 GPU를 대상으로 하므로 GTX 1650에서는 직접 실행하지 않습니다. 동일한 EXAONE 4.0 1.2B 아키텍처를 약 812MB의 Q4_K_M GGUF로 실행해 4GB VRAM에 맞춥니다. 웹 화면에는 실제 실행 형식인 `EXAONE 4.0 1.2B Q4`로 표시됩니다.

추가로 허용된 모델은 `EXAONE 3.5 2.4B`, `Qwen 2.5 1.5B`, 기능 테스트용 `Gemma 3 1B`입니다. 모두 한 번에 하나만 GPU 메모리에 유지됩니다.

## API

- `GET /health`: Ollama 연결과 선택 모델 상태
- `GET /v1/models`: 웹앱용 허용 모델 목록
- `POST /v1/chat/completions`: 인증이 필요한 OpenAI 호환 채팅
- `GET /admin/status`: 다운로드·로딩·활성 모델 상태
- `POST /admin/models/activate`: 허용 목록 안의 모델만 선택, 다운로드, 기존 모델 해제, 새 모델 예열

일반 추론 토큰과 관리자 토큰은 서로 다른 **32자 이상의 암호학적으로 안전한 난수**로 설정해야 합니다. 사람이 만든 암호나 문서 예시는 사용하지 마세요. 둘 중 하나라도 비어 있거나, 짧거나, 예시용 문자열이거나, 두 토큰이 같으면 추론·관리 API 모두 `503`으로 차단되고 시작 시 모델 자동 로딩도 하지 않습니다. 정상 설정에서 잘못된 요청 토큰은 `401`로 거부합니다. `/health`는 진단용으로 유지됩니다.

모델 ID 대신 임의 저장소 주소를 전달해 다운로드하게 만드는 기능은 제공하지 않습니다.

## 실행

Ollama가 먼저 `127.0.0.1:11434`에서 실행 중이어야 합니다.
아래 명령은 `local-llm-server` 디렉터리에서 실행합니다.

```bash
python3.11 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python setup_tokens.py
set -a && . ./.env && set +a
uvicorn app:app --host 127.0.0.1 --port 11435
```

`setup_tokens.py`는 표준 라이브러리의 `secrets.token_urlsafe(32)`로 각 256비트의 독립된 토큰을 만들고, Git에서 무시되는 `.env`에만 저장합니다. 토큰 값은 화면·로그에 출력하지 않습니다. Linux/macOS에서는 파일 권한을 `0600`으로 제한합니다. Windows에서는 비공개 사용자 디렉터리를 사용하고 해당 파일의 ACL을 제한하세요. `.env.example`의 비밀값은 의도적으로 비워 두었습니다.

기존 `.env`가 있으면 기본 실행은 실패하며 아무것도 덮어쓰지 않습니다. 두 토큰을 **의도적으로 교체**할 때만 `python setup_tokens.py --force`를 사용하세요. 다른 설정은 보존됩니다. 교체 전에 기존 환경 파일을 안전하게 백업하고, 웹앱의 두 토큰도 같은 값으로 갱신한 다음 게이트웨이와 웹앱을 재시작해야 합니다. 기존 32자 미만 토큰을 사용하던 배포는 업그레이드 전에 이 교체 작업이 필요합니다. 비밀값을 터미널, 채팅, Git, 명령행 인수에 붙여 넣지 마세요.

토큰 생성기는 한 줄에 한 설정을 쓰는 `.env`를 지원합니다. 여러 줄 따옴표 값이나 역슬래시 줄 연결이 있으면 **파일을 변경하지 않고 거부**합니다. 기존 서비스에서 그런 문법을 사용한다면 검토 없이 `--force`를 반복하지 마세요. 최초 생성과 교체 모두 비공개 임시 파일에 쓰기를 완료한 뒤 공개하므로 쓰기 실패 시 불완전한 `.env`가 남지 않습니다. 최초 생성은 같은 파일 시스템의 하드 링크를 이용해 동시 실행 중 덮어쓰기도 방지합니다. 하드 링크가 불가능한 파일 시스템에서는 안전하게 실패합니다.

기본 모델 상태 파일은 실행 디렉터리 기준 `./runtime/model-state.json`입니다. 서비스의 작업 디렉터리를 지정하거나 `LOCAL_LLM_STATE_PATH`를 해당 서비스 계정이 쓸 수 있는 경로로 설정하세요.

웹앱에는 다음 값을 설정합니다.

```dotenv
LOCAL_LLM_BASE_URL=http://127.0.0.1:11435/v1
LOCAL_LLM_API_KEY=<게이트웨이와 동일한 추론 토큰>
LOCAL_LLM_ADMIN_TOKEN=<게이트웨이와 동일한 관리자 토큰>
LOCAL_LLM_MODEL=exaone4.0:1.2b-q4
```

최초 활성화 때만 모델을 내려받으며 외부 유료 AI API는 호출하지 않습니다.

인증·토큰 생성 테스트는 모델이나 추가 패키지 없이 저장소 루트에서 실행할 수 있습니다.

```bash
python -m unittest discover -s tests -p test_local_llm_security.py -v
```

실제 FastAPI 수명주기·HTTP 인증·준비 상태 테스트는 `requirements.txt`가 설치된 게이트웨이 가상 환경에서 실행합니다. Ollama 통신과 모델 작업은 모두 대체되며 운영 모델이나 상태 파일에 접근하지 않습니다.

```bash
python -m unittest discover -s tests -p test_local_llm_gateway.py -v
```

`/health`는 진단 응답을 위해 HTTP 200을 유지합니다. `status=ok`는 Ollama 연결과 토큰 구성이 모두 정상이라는 뜻입니다. `ready=true`는 `/api/ps`로 선택 모델이 실제 상주 중인 것을 확인했다는 뜻이며, 실제 추론의 성공까지 검증하지는 않습니다. 10분 기본 유지시간이 지나 모델이 내려가면 `model_state=cold`, `ready=false`로 표시하고, 헬스 조회 자체가 모델을 다시 올리지는 않습니다. 토큰 설정 오류 시에는 `status=degraded`, `ready=false`와 비밀값이 없는 `configuration_error` 코드가 표시됩니다.

## 처리시간·대기열·취소

추론은 비동기 HTTP로 실행하며 연결 종료·전체 제한시간 초과 시 Ollama 요청 소켓을 취소합니다. 추론 스레드를 남겨 계속 작업하는 방식은 사용하지 않습니다. Ollama 내부의 실제 계산 중단 시점까지 보장하는 것은 아닙니다.

기본 설정은 동시 추론 1개, 대기 4개, 대기 최대 2초, 대기를 포함한 추론 전체 최대 20초입니다. `LOCAL_LLM_MAX_CONCURRENT`, `LOCAL_LLM_MAX_QUEUED`, `LOCAL_LLM_QUEUE_TIMEOUT_SECONDS`, `LOCAL_LLM_INFERENCE_TIMEOUT_SECONDS`로 제한 범위 안에서 변경할 수 있습니다. 여러 gateway 프로세스를 실행하면 각 프로세스별 한도이므로 기본 단일 worker 구성을 유지하세요. 웹의 사용자별 분당 10회 제한은 이 전역 자원 제한과 별개입니다.

- 대기열 초과/대기 만료: `429 local_inference_busy`, `Retry-After: 2`
- 모델 비상주: 제한시간이 있는 백그라운드 준비를 시작하고 `503 model_warming`, `Retry-After: 5`
- 추론 전체 제한시간 초과: `504 local_inference_timeout`
- 추론 연결 오류: 내부 예외를 숨긴 `503 local_inference_unavailable`

모델 다운로드·예열에는 별도의 `LOCAL_LLM_MODEL_LOAD_TIMEOUT_SECONDS`(기본 900초, 최대 1800초)가 적용됩니다. 이미 설치된 모델은 다시 다운로드하지 않습니다. 실패나 제한시간 초과가 나면 상태를 오류로 표시하고 무한 재시작하지 않습니다. 첫 준비 중에는 상담 요청을 900초 동안 붙잡아 두지 않습니다.

웹 provider 호출도 헤더와 **응답 본문 전체**에 같은 제한시간을 적용하고 응답을 2MiB로 제한합니다. 호출자의 AbortSignal을 전달할 수 있으며, 기존 안전한 대체 응답 계약을 유지하되 위의 세 가지 가용성 사유를 `providerError`로 구분합니다. 쓰기/추론 요청을 자동 재시도하지 않습니다.
