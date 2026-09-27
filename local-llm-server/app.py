from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from gateway_security import GatewayTokens, InvalidTokenError, TokenConfigurationError, TokenRole, require_token


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    ollama_model: str
    description: str
    recommended: bool = False
    temperature_cap: float = 0.6
    context_tokens: int = 4096


# Only these aliases may cause Ollama to download or load a model. Keeping the
# remote repository out of the request body prevents this API from becoming an
# arbitrary model downloader.
MODEL_SPECS = {
    spec.id: spec
    for spec in (
        ModelSpec(
            id="exaone4.0:1.2b-q4",
            label="EXAONE 4.0 1.2B Q4_K_M",
            ollama_model="hf.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q4_K_M",
            description="GTX 1650 4GB 추천 · 한국어/영어 · 공식 LG AI Research GGUF",
            recommended=True,
            temperature_cap=0.6,
        ),
        ModelSpec(
            id="exaone3.5:2.4b",
            label="EXAONE 3.5 2.4B Q4",
            ollama_model="exaone3.5:2.4b",
            description="한국어 품질 우선 · 4GB VRAM 호환",
            temperature_cap=0.5,
        ),
        ModelSpec(
            id="qwen2.5:1.5b",
            label="Qwen 2.5 1.5B Q4",
            ollama_model="qwen2.5:1.5b",
            description="한국어/영어 경량 대안",
            temperature_cap=0.6,
        ),
        ModelSpec(
            id="gemma3:1b",
            label="Gemma 3 1B Q4",
            ollama_model="gemma3:1b",
            description="초경량 기능 테스트",
            temperature_cap=0.6,
        ),
    )
}

DEFAULT_MODEL = os.getenv("LOCAL_LLM_DEFAULT_MODEL", "exaone4.0:1.2b-q4")
STATE_PATH = Path(os.getenv("LOCAL_LLM_STATE_PATH", "./runtime/model-state.json")).resolve()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "10m")
MODEL_LOAD_TIMEOUT_SECONDS = max(30, min(1800, int(os.getenv("LOCAL_LLM_MODEL_LOAD_TIMEOUT_SECONDS", "900"))))
MAX_INPUT_CHARS = max(1_000, int(os.getenv("LOCAL_LLM_MAX_INPUT_CHARS", "48000")))
INFERENCE_TIMEOUT_SECONDS = max(1, min(300, float(os.getenv("LOCAL_LLM_INFERENCE_TIMEOUT_SECONDS", "20"))))
MAX_CONCURRENT = max(1, min(4, int(os.getenv("LOCAL_LLM_MAX_CONCURRENT", "1"))))
MAX_QUEUED = max(0, min(16, int(os.getenv("LOCAL_LLM_MAX_QUEUED", "4"))))
QUEUE_TIMEOUT_SECONDS = max(0.1, min(10, float(os.getenv("LOCAL_LLM_QUEUE_TIMEOUT_SECONDS", "2"))))


class ModelWarmingError(Exception):
    pass


class InferenceBusyError(Exception):
    pass


class AdmissionGate:
    """One event-loop-local, bounded queue; no background inference threads."""
    def __init__(self) -> None:
        self.active = 0
        self.queued = 0
        self.condition = asyncio.Condition()

    @asynccontextmanager
    async def slot(self):
        async with self.condition:
            if self.active >= MAX_CONCURRENT:
                if self.queued >= MAX_QUEUED:
                    raise InferenceBusyError()
                self.queued += 1
                try:
                    await asyncio.wait_for(
                        self.condition.wait_for(lambda: self.active < MAX_CONCURRENT),
                        timeout=QUEUE_TIMEOUT_SECONDS,
                    )
                except TimeoutError as error:
                    raise InferenceBusyError() from error
                finally:
                    self.queued -= 1
            self.active += 1
        try:
            yield
        finally:
            async with self.condition:
                self.active -= 1
                self.condition.notify(1)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=24_000)


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)
    max_tokens: int = Field(default=768, ge=32, le=2048)
    temperature: float = Field(default=0.2, ge=0, le=1)
    stream: bool = False


class ActivateModelRequest(BaseModel):
    model: str


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        return ""
    return authorization[7:].strip()


def _require_secret(role: TokenRole, provided: str) -> None:
    try:
        require_token(os.environ, role, provided)
    except TokenConfigurationError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    except InvalidTokenError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token") from error


def require_api_token(authorization: str | None = Header(default=None)) -> None:
    _require_secret("api", _bearer_token(authorization))


def require_admin_token(authorization: str | None = Header(default=None)) -> None:
    _require_secret("admin", _bearer_token(authorization))


class OllamaManager:
    def __init__(self) -> None:
        self._state_lock = threading.RLock()
        self._loader_thread: threading.Thread | None = None
        self.selected_model = self._read_selected_model()
        self.loaded_model: str | None = None
        self.state = "idle"
        self.last_error: str | None = None
        self.progress: str | None = None

    def _read_selected_model(self) -> str:
        try:
            data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
            selected = data.get("selected_model")
            if selected in MODEL_SPECS:
                return selected
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass
        return DEFAULT_MODEL if DEFAULT_MODEL in MODEL_SPECS else next(iter(MODEL_SPECS))

    def _write_selected_model(self) -> None:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATE_PATH.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"selected_model": self.selected_model, "updated_at": time.time()}),
            encoding="utf-8",
        )
        os.replace(temporary, STATE_PATH)

    def _client(self, read_timeout: float | None = None) -> httpx.Client:
        return httpx.Client(
            base_url=OLLAMA_BASE_URL,
            timeout=httpx.Timeout(connect=5, read=read_timeout, write=30, pool=5),
            follow_redirects=False,
            trust_env=False,
        )

    def _async_client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=OLLAMA_BASE_URL,
            timeout=httpx.Timeout(connect=3, read=timeout, write=min(10, timeout), pool=2),
            follow_redirects=False,
            trust_env=False,
        )

    def _ollama_health(self) -> dict[str, Any]:
        try:
            with self._client(3) as client:
                response = client.get("/api/ps")
                response.raise_for_status()
                payload = response.json()
            residents = payload.get("models", [])
            model = MODEL_SPECS[self.selected_model].ollama_model
            resident = any(item.get("name") == model or item.get("model") == model for item in residents)
            return {"reachable": True, "resident_models": len(residents), "selected_model_resident": resident}
        except Exception as error:
            return {"reachable": False, "resident_models": 0, "selected_model_resident": False, "error": type(error).__name__}

    def status(self, include_health: bool = True) -> dict[str, Any]:
        with self._state_lock:
            spec = MODEL_SPECS[self.selected_model]
            result = {
                "state": self.state,
                "selected_model": self.selected_model,
                "loaded_model": self.loaded_model,
                "resolved_repository": spec.ollama_model,
                "fallback_reason": None,
                "last_error": self.last_error,
                "progress": self.progress,
                "runtime": "ollama",
                "keep_alive": OLLAMA_KEEP_ALIVE,
            }
        if include_health:
            result["ollama"] = self._ollama_health()
            result["resident"] = result["ollama"].get("selected_model_resident", False)
            if result["state"] == "ready" and not result["resident"]:
                result["state"] = "cold" if result["ollama"]["reachable"] else "unavailable"
                result["loaded_model"] = None
        return result

    def request_activation(self, model_id: str, *, force: bool = False) -> dict[str, Any]:
        if model_id not in MODEL_SPECS:
            raise ValueError("unsupported_model")
        with self._state_lock:
            self.selected_model = model_id
            if force:
                self.loaded_model = None
            self.state = "ready" if self.loaded_model == model_id else "pulling"
            self.last_error = None
            self.progress = "모델 준비 요청됨"
            self._write_selected_model()
            if self.loaded_model != model_id and (not self._loader_thread or not self._loader_thread.is_alive()):
                self._loader_thread = threading.Thread(target=self._load_loop, daemon=True, name="ollama-model-loader")
                self._loader_thread.start()
        return self.status(include_health=False)

    def _load_loop(self) -> None:
        while True:
            with self._state_lock:
                target = self.selected_model
            try:
                asyncio.run(asyncio.wait_for(self._load(target), timeout=MODEL_LOAD_TIMEOUT_SECONDS))
            except Exception as error:
                with self._state_lock:
                    self.state = "error"
                    self.last_error = type(error).__name__
                    self.progress = "Ollama 모델 준비 실패"
                return
            with self._state_lock:
                if self.selected_model == target:
                    self.state = "ready"
                    self.last_error = None
                    self.progress = "모델 준비 완료"
                    return
                self.state = "pulling"
                self.progress = "새로 선택한 모델로 전환 중"

    async def _load(self, model_id: str) -> None:
        spec = MODEL_SPECS[model_id]
        with self._state_lock:
            previous = self.loaded_model
            self.state = "pulling"
            self.progress = "최초 실행 시 모델 파일을 무료로 다운로드합니다"

        async with self._async_client(MODEL_LOAD_TIMEOUT_SECONDS) as client:
            if previous and previous != model_id:
                previous_spec = MODEL_SPECS[previous]
                unload = await client.post(
                    "/api/generate",
                    json={"model": previous_spec.ollama_model, "prompt": "", "stream": False, "keep_alive": 0},
                )
                # A missing old model must not prevent loading the requested one.
                if unload.status_code >= 500:
                    unload.raise_for_status()

            installed = await client.get("/api/tags")
            installed.raise_for_status()
            if not any(item.get("name") == spec.ollama_model or item.get("model") == spec.ollama_model
                       for item in installed.json().get("models", [])):
                pull = await client.post("/api/pull", json={"model": spec.ollama_model, "stream": False})
                pull.raise_for_status()

            with self._state_lock:
                self.state = "loading"
                self.progress = "GPU 메모리에 모델을 올리는 중"
            preload = await client.post(
                "/api/generate",
                json={"model": spec.ollama_model, "prompt": "", "stream": False, "keep_alive": OLLAMA_KEEP_ALIVE},
            )
            preload.raise_for_status()

        with self._state_lock:
            self.loaded_model = model_id

    async def _require_ready(self, model_id: str) -> None:
        with self._state_lock:
            if model_id != self.selected_model:
                raise ValueError("model_not_active")
            if self._loader_thread and self._loader_thread.is_alive():
                raise ModelWarmingError()
        async with self._async_client(3) as client:
            response = await client.get("/api/ps")
            response.raise_for_status()
            model = MODEL_SPECS[model_id].ollama_model
            resident = any(item.get("name") == model or item.get("model") == model
                           for item in response.json().get("models", []))
        if not resident:
            self.request_activation(model_id, force=True)
            raise ModelWarmingError()
        with self._state_lock:
            if model_id != self.selected_model:
                raise ValueError("model_changed_during_request")
            self.loaded_model = model_id
            self.state = "ready"

    async def complete(self, request: ChatCompletionRequest) -> dict[str, Any]:
        if request.model not in MODEL_SPECS:
            raise ValueError("unsupported_model")
        if request.stream:
            raise ValueError("streaming_not_supported")
        if sum(len(message.content) for message in request.messages) > MAX_INPUT_CHARS:
            raise ValueError("input_too_large")

        await self._require_ready(request.model)
        spec = MODEL_SPECS[request.model]
        async with self._async_client(INFERENCE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                "/api/chat",
                json={
                    "model": spec.ollama_model,
                    "messages": [message.model_dump() for message in request.messages],
                    "stream": False,
                    "think": False,
                    "keep_alive": OLLAMA_KEEP_ALIVE,
                    "options": {
                        "temperature": min(request.temperature, spec.temperature_cap),
                        "num_predict": request.max_tokens,
                        "num_ctx": spec.context_tokens,
                    },
                },
            )
            response.raise_for_status()
            result = response.json()

        content = str(result.get("message", {}).get("content", "")).strip()
        if not content:
            raise RuntimeError("empty_model_response")
        prompt_tokens = int(result.get("prompt_eval_count") or 0)
        completion_tokens = int(result.get("eval_count") or 0)
        return {
            "id": f"chatcmpl-local-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": result.get("done_reason") or "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }


manager = OllamaManager()


@asynccontextmanager
async def lifespan(_: FastAPI):
    app.state.inference_gate = AdmissionGate()
    try:
        GatewayTokens.from_environment(os.environ)
        configured = True
    except TokenConfigurationError:
        configured = False
    # Leave health diagnostics available, but never download/load models for an
    # insecure setup. Authenticated routes fail closed with HTTP 503 as well.
    if configured and os.getenv("LOCAL_LLM_AUTOLOAD", "true").strip().lower() not in {"0", "false", "no", "off"}:
        manager.request_activation(manager.selected_model)
    yield


app = FastAPI(
    title="BORA Ollama Gateway",
    version="2.2.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, Any]:
    current = manager.status()
    configuration_error = None
    try:
        GatewayTokens.from_environment(os.environ)
    except TokenConfigurationError as error:
        # TokenConfigurationError contains a fixed diagnostic code, never a key.
        configuration_error = str(error)
    available = current["ollama"]["reachable"] and configuration_error is None
    return {
        "status": "ok" if available else "degraded",
        "ready": available and current["state"] == "ready" and current.get("resident", False),
        "auth_configured": configuration_error is None,
        "configuration_error": configuration_error,
        "runtime": "ollama",
        "model_state": current["state"],
        "selected_model": current["selected_model"],
        "ollama": current["ollama"],
        "queue": {
            "active": getattr(getattr(app.state, "inference_gate", None), "active", 0),
            "waiting": getattr(getattr(app.state, "inference_gate", None), "queued", 0),
            "max_concurrent": MAX_CONCURRENT,
            "max_queued": MAX_QUEUED,
        },
    }


@app.get("/v1/models", dependencies=[Depends(require_api_token)])
def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [{"id": model.id, "object": "model", "owned_by": "bora-ollama"} for model in MODEL_SPECS.values()],
    }


@app.get("/admin/status", dependencies=[Depends(require_admin_token)])
def admin_status() -> dict[str, Any]:
    return manager.status()


@app.get("/admin/models", dependencies=[Depends(require_admin_token)])
def admin_models() -> dict[str, Any]:
    return {"models": [asdict(model) for model in MODEL_SPECS.values()], "runtime": manager.status()}


@app.post("/admin/models/activate", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_admin_token)])
def activate_model(request: ActivateModelRequest) -> dict[str, Any]:
    try:
        return manager.request_activation(request.model)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.post("/v1/chat/completions", dependencies=[Depends(require_api_token)])
async def chat_completions(request: ChatCompletionRequest, http_request: Request) -> dict[str, Any]:
    async def infer() -> dict[str, Any]:
        async with app.state.inference_gate.slot():
            return await manager.complete(request)

    async def disconnected() -> None:
        # FastAPI has already consumed/validated the JSON body. Wait directly
        # for ASGI disconnect: is_disconnected() uses an AnyIO CancelScope that
        # can swallow a concurrent Task.cancel() and hang response cleanup.
        while True:
            if (await http_request.receive()).get("type") == "http.disconnect":
                return

    inference = asyncio.create_task(infer())
    disconnect = asyncio.create_task(disconnected())
    try:
        async with asyncio.timeout(INFERENCE_TIMEOUT_SECONDS):
            done, _ = await asyncio.wait({inference, disconnect}, return_when=asyncio.FIRST_COMPLETED)
            if inference in done:
                return await inference
            raise HTTPException(status_code=499, detail="client_disconnected")
    except InferenceBusyError as error:
        raise HTTPException(status_code=429, detail="local_inference_busy", headers={"Retry-After": "2"}) from error
    except ModelWarmingError as error:
        raise HTTPException(status_code=503, detail="model_warming", headers={"Retry-After": "5"}) from error
    except ValueError as error:
        code = str(error)
        if code in {"unsupported_model", "streaming_not_supported", "input_too_large",
                    "model_not_active", "model_changed_during_request"}:
            raise HTTPException(status_code=409, detail=code) from error
        raise HTTPException(status_code=503, detail="local_inference_unavailable") from error
    except (TimeoutError, httpx.TimeoutException) as error:
        raise HTTPException(status_code=504, detail="local_inference_timeout") from error
    except HTTPException:
        raise
    except Exception as error:
        with manager._state_lock:
            manager.last_error = type(error).__name__
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="local_inference_unavailable") from error
    finally:
        for task in (inference, disconnect):
            task.cancel()
        done, pending = await asyncio.wait({inference, disconnect}, timeout=1)
        # Cleanup cannot extend a request indefinitely even if an ASGI adapter
        # ignores cancellation. Observe late exceptions without logging input.
        def observe(task: asyncio.Task) -> None:
            if not task.cancelled():
                task.exception()
        for task in done:
            observe(task)
        for task in pending:
            task.add_done_callback(observe)
