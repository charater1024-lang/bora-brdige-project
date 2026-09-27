# AI 실행과 동의 기반 문맥

웹앱의 모델 호출 정책입니다. 별도 프로세스인 [Local LLM 게이트웨이](../../local-llm-server/README.md)와 구분합니다.

| 파일 | 역할 |
| --- | --- |
| `providers.ts` | OpenAI·Gemini·Claude·Local LLM 호출과 응답 제한 |
| `selected-runtime.ts` | 서버 설정에서 활성화되고 사용 가능한 엔진 선택 |
| `local-model-control.ts` | 내부 게이트웨이의 허용 모델 조회·전환 |
| `context-policy.ts`, `context-store.ts`, `history.ts` | 민감 문맥 정리, 동의 설정과 계정별 문맥·대화 처리 |
| `context-client.ts` | 브라우저의 문맥 설정 요청 보조 |
| `rate-limit.ts` | 사용자별 AI 요청 제한 |
| `evidence-intent.ts`, `manual-finance-intent.ts`, `product-capabilities.ts` | 근거·장부 질문과 제품이 지원하는 기능의 경계 |
| `safe-markdown.ts` | 응답 표시를 위한 안전한 Markdown 처리 |

요청 진입점은 [상담 API](../../app/api/ai/route.ts)입니다. 근거 검색·인용 정책은 [RAG](../rag/README.md), 암호화된 키·ON/OFF 설정은 [runtime-settings.ts](../runtime-settings.ts)가 담당합니다.

공개 사본에는 API 키, 실제 대화, 모델 가중치가 없습니다. 기본 예제는 유료 호출을 차단하며, 키가 있다는 이유만으로 엔진이 활성화되지 않습니다. Local LLM도 별도 모델 설치·실행, 서로 다른 추론/관리 토큰과 서버 설정이 필요합니다. 게이트웨이 토큰을 브라우저에 전달하지 않습니다.

대화·최근 활동·직접 입력 자산 문맥은 각각의 동의와 계정 경계를 따릅니다. 요청 제한·시간 초과·근거 검사는 안전장치이며 답변 정확성 보증은 아닙니다. 검증은 [테스트 안내](../../tests/README.md)의 AI/RAG 관련 회귀를 사용합니다.
