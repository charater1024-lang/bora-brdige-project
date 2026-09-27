# 내부 관측·백업·복구 검증

이 문서는 공개 코드의 기능을 설명합니다. 실제 운영 적용 여부는 배포 기록과 해당 서버의 서비스/타이머 상태로 확인해야 합니다. 예시 경로를 그대로 실행하지 마세요.

## 재시작과 진단의 분리

기존 `bora-bridge-healthcheck`는 웹 복구 판단용입니다. 공개 `/api/health`는 최소 상태만 제공하며, DB 준비 확인은 초기 스키마 캐시만 믿지 않고 매번 실제 조회를 합니다. 1.5초 안에 끝나지 않으면 실패하고, 끝나지 않은 이전 조회가 있으면 추가 조회를 쌓지 않습니다. D1 Promise 자체를 취소하는 기능은 아니므로 실행기 수준의 장애 복구는 별도로 필요합니다.

`bora-deep-readiness`는 5분 간격의 **관측 전용** 타이머입니다. 웹/공개 HTTPS 주소, 세션·회원·자산 테이블의 읽기 가능 여부, LLM gateway와 실제 모델 상주 여부, 최근 검증된 백업을 확인합니다. 오류는 비공개 상태 파일과 journal에 남기고 실패 종료하지만, `OnFailure`로 웹을 재시작하지 않습니다. 미사용으로 모델이 내려간 상태는 경고이며 장애 재시작 조건이 아닙니다.

공급자별 `public_api_source_state`도 읽기 전용으로 확인합니다. 연속 실패(3회 이상은 반복 실패), 예정 수집 시각보다 1시간 이상 지연, 성공 기록 없음 등을 공급자 ID와 집계 수로 기록하며 웹이 정상이어도 `warning`으로 구분합니다. 비활성/자격 정보 없음이라는 마지막 기록은 활성 실패 집계에서 제외합니다. 이는 마지막 저장 상태의 관측이며 실제 키 유효성이나 현재 활성 설정을 별도로 검증한 결과는 아닙니다. 원본 오류 문자열·키·개인정보는 조회 결과나 로그에 담지 않고 알 수 없는 공급자 ID는 수만 기록합니다. 수집 상태 테이블을 읽지 못해도 정상으로 간주하지 않습니다. 공급자 장애나 경고는 웹 재시작을 유발하지 않습니다.

공개 HTTPS 검사는 HTTP 200과 정확한 최소 JSON `{"status":"ok"}`를 모두 확인해야 성공입니다. 실패 사유는 `timeout`, `blocked`, `cf_blocked`, `unavailable`, `invalid_response` 등 닫힌 코드로만 기록합니다. `cf_blocked`는 실제 HTTP 403에 Cloudflare 헤더가 동반된 경우만 사용하며 단순 시간 초과를 차단으로 추정하지 않습니다. 프록시 환경 변수, 리디렉션, TLS 검증 우회나 인증 토큰은 사용하지 않습니다. 일시 실패도 정상으로 표시하지 않으며 다음 관측 결과와 함께 판단하세요.

이 검사는 OAuth 로그인, 사용자 자산 쓰기, 실제 AI 추론이나 외부 사본 복원을 대신하지 않습니다. 결과에 해당 검증을 하지 않았다는 표시를 남깁니다. 운영 알림 시스템은 `deep-readiness.json`의 실패/오래된 관측과 `latest-status.json`의 백업 실패/오래된 백업을 감시해야 합니다. 알림 수신자 설정 없이 알림까지 설치됐다고 판단하면 안 됩니다.

## 보안 백업

`deploy/backup-bora-sqlite.py`는 원본 SQLite를 **읽기 전용** 연결로 열고 온라인 백업합니다. 동일 파일시스템의 0700 임시 폴더에서 0600 스냅샷을 만들고 `quick_check`, 외래키 검사, 별도 DB로 복원 및 재검사를 수행합니다. 원본 DB를 교체하거나 삭제하는 기능은 없습니다.

공개키가 있으면 3072비트 이상 RSA-OAEP-SHA256으로 일회용 AES-256 키를 감싸고, AES-GCM 스트리밍으로 암호화합니다. 암호화 파일을 다시 읽어 인증 태그와 평문 해시를 검증한 뒤에만 성공 처리합니다. 서버에는 RSA 개인키가 필요하지 않습니다. 공개키가 없으면 로컬 0600 평문 백업이 생성되므로 외부 전송을 금지해야 합니다.

서버 최종 산출물은 `bora-db-<UTC>-<random>.boraenc`, 동명 `.json` 메타데이터, `latest-status.json`입니다. 메타데이터에는 해시·크기·테이블 수·검증 결과·공개키 지문만 있으며 실제 행 값이나 키는 포함하지 않습니다. 기본 최근 14개를 보존하되 이 도구의 검증된 메타데이터가 있는 파일만 정리합니다. 실패하거나 출처를 알 수 없는 파일은 자동 삭제하지 않습니다. 성공/실패 후 임시 평문 폴더는 제거하지만 물리 매체의 보안 삭제를 의미하지는 않습니다. 파일시스템 암호화와 디스크 접근 통제를 함께 사용하세요.

암호화 형식은 `BORAENC1\n` + 4바이트 big-endian JSON 헤더 길이 + UTF-8 헤더 + 암호문 + 16바이트 GCM 태그입니다. 헤더에는 `algorithm`, base64 `wrapped_key`, base64 `nonce`, 정수 `plaintext_size`가 들어갑니다. AAD는 magic·길이·헤더 바이트 전체입니다. 공개키 지문은 DER SubjectPublicKeyInfo의 SHA-256입니다. 암호문과 메타데이터는 함께 보관해야 합니다.

## 설치 전제와 운영 정책

1. 정확한 운영 DB 파일을 확인하고 기존 백업·쓰기 부하·빈 공간을 점검합니다. 자동 탐색으로 첫 번째 SQLite를 고르지 않습니다.
2. `~/.local/share/bora-bridge/encrypted-backups`와 `ops`를 해당 서비스 사용자만 접근 가능한 0700으로 준비합니다. `run-bora-ops-sandbox.sh`는 이 정확한 경로(백업은 `backups`도 허용)만 받아들이며 원본 DB는 프로젝트의 실제 D1 디렉터리로 한정합니다.
3. `deploy/ops.env.example`를 비공개 `~/.config/bora-bridge/ops.env`에 0600으로 구성합니다. 실제 경로·환경 파일·키·DB는 Git에 넣지 않습니다. 기본 백업 실행기 `/usr/bin/python3`에 `cryptography`가 필요합니다. LLM 가상환경은 변경하지 않습니다. 공개키는 `~/.config/bora-bridge/backup-public.pem`에 저장합니다.
4. 후보 환경의 합성 DB와 키로 테스트한 뒤 실제 첫 백업을 검증합니다. `bora-database-backup` 유닛은 네트워크가 격리되어 있고, 기본 일일 04:10(+최대 10분 지연)에 실행합니다. 시스템의 시간대를 확인하세요.
5. 사용자 승인된 Windows PC로 **암호문만** 복사하고, 해당 PC의 DPAPI로 보호한 개인키로 인증 복호화 및 격리 SQLite 복원을 확인합니다. 서버의 `offsite_copy_verified=false`는 PC 검증 결과와 별개이며 거짓 성공을 표시하지 않습니다.
6. 일일 백업 기준 잠재적 데이터 손실 목표는 최대 약 24시간(+실패 복구 지연)입니다. PC가 꺼져 있으면 외부 사본은 더 오래될 수 있습니다. 실제 복구시간은 별도 훈련으로 측정합니다. Windows 프로필/DPAPI 키 분실에 대비한 독립된 키 복구 수단은 별도 승인·구성이 필요합니다.

두 유닛은 Ubuntu의 사용자 namespace 제한 때문에 systemd의 중첩 `ProtectSystem`/`PrivateNetwork` 설정에 의존하지 않고 기존 웹 서비스와 같은 직접 Bubblewrap 방식을 사용합니다. 읽기 전용 루트와 정확한 DB·WAL·SHM 바인딩, capability 제거, private `/tmp`, 비밀 디렉터리 마스킹, 비어 있는 환경에서의 Python 격리를 적용합니다. 백업은 네트워크가 차단되고 백업 폴더만 영구 쓰기가 가능하며, 관측은 읽기 전용 백업 폴더와 쓰기 가능한 `ops` 폴더만 노출합니다. 주기적 백업 wrapper는 공개키를 필수로 요구하므로 평문 백업으로 조용히 전환하지 않습니다. 최초 실제 실행에서는 해당 호스트의 Bubblewrap/AppArmor 허용과 WAL 읽기 가능 여부를 확인하세요. 원본에 `immutable=1`을 사용해 최신 WAL을 무시하는 우회는 금지합니다.

## Windows 암호화 사본

`deploy/windows-backup-client.py init --directory <전용-보호폴더>`를 Windows에서 한 번 실행합니다. RSA 개인키는 평문 파일로 쓰지 않고 현재 Windows 계정의 DPAPI로 보호합니다. `backup-public.pem`만 서버로 전달하고 `recovery-key.dpapi`는 PC 밖으로 보내지 않습니다. 디렉터리 ACL은 현재 사용자와 SYSTEM만 허용합니다.

`deploy/install-windows-backup-task.ps1`에 cryptography가 설치된 Python 경로, SSH 사용자/호스트, 서버의 정확한 암호화 백업 디렉터리를 지정하면 로그인 시 및 매일 09·15·21시에 현재 사용자 작업을 등록합니다. PC가 켜져 있고 해당 Windows 사용자가 로그인했으며 SSH가 연결될 때 동작합니다. 서버가 사설망 주소라면 해당 네트워크/VPN에 있어야 합니다. 작업에는 SSH 비밀번호를 저장하지 않습니다. SSH 키 기반 인증과 호스트키 검증을 미리 완료해야 합니다.

클라이언트는 암호문·메타데이터 해시를 검증한 뒤 DPAPI 개인키로 실제 복호화하고 SQLite 무결성을 검사합니다. 복원 검사 임시 평문은 제거하며 `last-sync.json`에 성공 시각과 결과를 기록합니다. 자동 작업의 실패는 Windows 작업 스케줄러에서 별도로 확인해야 하며 오래된 성공 파일을 최신 성공으로 해석하지 마세요. PC 사본 자동 정리는 현재 하지 않으므로 디스크 여유와 보존 정책을 별도로 관리해야 합니다. Windows 프로필/PC 손실에도 복구하려면 독립적인 암호화 키 복구 수단이 추가로 필요합니다.

## 테스트 실행

```bash
python -m unittest discover -s tests -p 'test_ops_*.py' -v
python -m unittest discover -s tests -p test_windows_backup_client.py -v
node --test tests/auth-storage-readiness.test.mjs tests/ai-provider-deadline.test.mjs
```

위 테스트는 합성 DB·임시 키만 사용합니다. `test_windows_backup_client.py`의 포맷/위변조 검사는 DPAPI나 SSH 없이 다른 OS에서도 실행할 수 있습니다. 실제 DB와 개인키를 CI에 제공하지 마세요.
