"""Actual FastAPI routes/lifespan; all model work and network access are mocked.

Run with the gateway's requirements installed. Dependency-free environments
skip this file; BORA_REQUIRE_GATEWAY_TESTS=1 makes missing dependencies a failure.
"""

from __future__ import annotations

import importlib.util
import asyncio
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

try:
    from fastapi.testclient import TestClient
except ImportError as error:
    if os.environ.get("BORA_REQUIRE_GATEWAY_TESTS") == "1":
        raise RuntimeError("Install local-llm-server/requirements.txt to run gateway integration tests.") from error
    raise unittest.SkipTest("Gateway integration tests require local-llm-server/requirements.txt.") from error


SERVER_DIRECTORY = Path(__file__).resolve().parents[1] / "local-llm-server"
# Deliberately synthetic, deterministic fixtures; never deployment credentials.
API = "0123456789abcdef" * 3
ADMIN = "fedcba9876543210" * 3


class GatewayRouteTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="bora-gateway-test-")
        self.addCleanup(temporary.cleanup)
        self.state_path = Path(temporary.name) / "model-state.json"
        self.enterContext(patch.dict(os.environ, {
            "LOCAL_LLM_API_KEY": API,
            "LOCAL_LLM_ADMIN_TOKEN": ADMIN,
            "LOCAL_LLM_AUTOLOAD": "false",
            "LOCAL_LLM_STATE_PATH": str(self.state_path),
            "LOCAL_LLM_DEFAULT_MODEL": "exaone4.0:1.2b-q4",
            "OLLAMA_BASE_URL": "http://127.0.0.1:1",
        }))
        # Even an accidental unmocked client call must not reach the live server.
        self.enterContext(patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden in gateway tests")))
        self.enterContext(patch.object(socket, "create_connection", side_effect=AssertionError("network forbidden in gateway tests")))
        previous_path = list(sys.path)
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), previous_path))
        sys.path.insert(0, str(SERVER_DIRECTORY))
        module_name = "bora_gateway_route_test_app"
        spec = importlib.util.spec_from_file_location(module_name, SERVER_DIRECTORY / "app.py")
        assert spec and spec.loader
        self.gateway = importlib.util.module_from_spec(spec)
        self.enterContext(patch.dict(sys.modules, {module_name: self.gateway}))
        spec.loader.exec_module(self.gateway)
        self.manager = self.gateway.manager
        self.health_probe = self.enterContext(patch.object(
            self.manager, "_ollama_health", return_value={"reachable": True, "resident_models": 1, "selected_model_resident": True},
        ))
        self.enterContext(patch.object(self.manager, "_client", side_effect=AssertionError("Ollama client forbidden in gateway tests")))
        self.activation = self.enterContext(patch.object(self.manager, "request_activation", return_value={"state": "pulling"}))
        self.completion = self.enterContext(patch.object(self.manager, "complete", new_callable=AsyncMock, return_value={
            "id": "synthetic-completion",
            "choices": [{"message": {"role": "assistant", "content": "synthetic response"}}],
        }))

    def tearDown(self):
        self.assertFalse(self.state_path.exists(), "Tests must not activate models or write model state.")

    def client(self):
        return TestClient(self.gateway.app)

    def test_healthy_ready_response_preserves_existing_fields(self):
        self.manager.state = "ready"
        self.manager.loaded_model = self.manager.selected_model
        with self.client() as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        value = response.json()
        self.assertEqual(value["status"], "ok")
        self.assertEqual(value["runtime"], "ollama")
        self.assertEqual(value["model_state"], "ready")
        self.assertEqual(value["selected_model"], self.manager.selected_model)
        self.assertTrue(value["ollama"]["reachable"])
        self.assertTrue(value["ready"])
        self.assertTrue(value["auth_configured"])
        self.assertIsNone(value["configuration_error"])
        self.activation.assert_not_called()

    def test_not_loaded_or_unreachable_is_not_ready(self):
        with self.client() as client:
            idle = client.get("/health").json()
            self.assertEqual(idle["status"], "ok")
            self.assertFalse(idle["ready"])
            self.manager.state = "ready"
            self.health_probe.return_value = {"reachable": False, "installed_models": 0, "error": "ConnectError"}
            unreachable = client.get("/health").json()
        self.assertEqual(unreachable["status"], "degraded")
        self.assertFalse(unreachable["ready"])
        self.assertTrue(unreachable["auth_configured"])

    def test_invalid_configuration_is_degraded_and_all_authenticated_routes_fail_closed(self):
        for invalid in ("", "short", API, "replace-with-a-separate-random-token"):
            with self.subTest(configuration_kind=len(invalid)):
                with patch.dict(os.environ, {"LOCAL_LLM_ADMIN_TOKEN": invalid, "LOCAL_LLM_AUTOLOAD": "true"}):
                    self.manager.state = "ready"
                    with self.client() as client:
                        health = client.get("/health")
                        public_models = client.get("/v1/models", headers={"Authorization": f"Bearer {API}"})
                        admin_status = client.get("/admin/status", headers={"Authorization": f"Bearer {ADMIN}"})
                    self.assertEqual(health.status_code, 200)
                    value = health.json()
                    self.assertEqual(value["status"], "degraded")
                    self.assertFalse(value["ready"])
                    self.assertFalse(value["auth_configured"])
                    self.assertIsInstance(value["configuration_error"], str)
                    self.assertEqual(public_models.status_code, 503)
                    self.assertEqual(admin_status.status_code, 503)
                    for response in (health, public_models, admin_status):
                        self.assertNotIn(API, response.text)
                        self.assertNotIn(ADMIN, response.text)
                        if invalid:
                            self.assertNotIn(invalid, response.text)
                self.activation.assert_not_called()

    def test_missing_api_configuration_blocks_admin_and_startup_loading(self):
        with patch.dict(os.environ, {"LOCAL_LLM_API_KEY": "", "LOCAL_LLM_AUTOLOAD": "true"}):
            with self.client() as client:
                health = client.get("/health").json()
                admin = client.get("/admin/status", headers={"Authorization": f"Bearer {ADMIN}"})
        self.assertEqual(health["configuration_error"], "api_token_not_configured")
        self.assertEqual(admin.status_code, 503)
        self.activation.assert_not_called()

    def test_valid_tokens_are_accepted_only_for_their_roles(self):
        with self.client() as client:
            self.assertEqual(client.get("/v1/models", headers={"Authorization": f"Bearer {API}"}).status_code, 200)
            self.assertEqual(client.get("/admin/status", headers={"Authorization": f"Bearer {ADMIN}"}).status_code, 200)
            self.assertEqual(client.get("/admin/models", headers={"Authorization": f"Bearer {ADMIN}"}).status_code, 200)
            for path, token in (("/v1/models", ADMIN), ("/admin/status", API), ("/v1/models", "wrong")):
                with self.subTest(path=path):
                    self.assertEqual(client.get(path, headers={"Authorization": f"Bearer {token}"}).status_code, 401)
            self.assertEqual(client.get("/v1/models").status_code, 401)
            self.assertEqual(client.get("/admin/status").status_code, 401)

    def test_valid_startup_autoload_is_invoked_once_without_real_model_work(self):
        with patch.dict(os.environ, {"LOCAL_LLM_AUTOLOAD": "true"}):
            with self.client() as client:
                self.assertEqual(client.get("/v1/models", headers={"Authorization": f"Bearer {API}"}).status_code, 200)
        self.activation.assert_called_once_with(self.manager.selected_model)

    def test_activation_and_completion_route_through_the_correct_authorization(self):
        chat = {"model": self.manager.selected_model, "messages": [{"role": "user", "content": "synthetic input"}]}
        with self.client() as client:
            denied_activation = client.post("/admin/models/activate", json={"model": self.manager.selected_model}, headers={"Authorization": f"Bearer {API}"})
            denied_chat = client.post("/v1/chat/completions", json=chat, headers={"Authorization": f"Bearer {ADMIN}"})
            self.assertEqual(denied_activation.status_code, 401)
            self.assertEqual(denied_chat.status_code, 401)
            self.activation.assert_not_called()
            self.completion.assert_not_called()
            activated = client.post("/admin/models/activate", json={"model": self.manager.selected_model}, headers={"Authorization": f"Bearer {ADMIN}"})
            completed = client.post("/v1/chat/completions", json=chat, headers={"Authorization": f"Bearer {API}"})
        self.assertEqual(activated.status_code, 202)
        self.assertEqual(completed.status_code, 200)
        self.activation.assert_called_once_with(self.manager.selected_model)
        self.completion.assert_called_once()
        self.assertEqual(completed.json()["choices"][0]["message"]["content"], "synthetic response")

    def test_health_rechecks_environment_without_exposing_old_or_new_tokens(self):
        self.manager.state = "ready"
        with self.client() as client:
            self.assertTrue(client.get("/health").json()["ready"])
            with patch.dict(os.environ, {"LOCAL_LLM_ADMIN_TOKEN": API}):
                bad = client.get("/health")
                self.assertFalse(bad.json()["ready"])
                self.assertEqual(bad.json()["configuration_error"], "api_admin_tokens_must_differ")
                self.assertNotIn(API, bad.text)
            self.assertTrue(client.get("/health").json()["ready"])

    def test_evicted_model_is_cold_not_ready_and_health_does_not_reload_it(self):
        self.manager.state = "ready"
        self.manager.loaded_model = self.manager.selected_model
        self.health_probe.return_value = {"reachable": True, "resident_models": 0, "selected_model_resident": False}
        with self.client() as client:
            value = client.get("/health").json()
            admin = client.get("/admin/status", headers={"Authorization": f"Bearer {ADMIN}"}).json()
        self.assertEqual(value["status"], "ok")
        self.assertFalse(value["ready"])
        self.assertEqual(value["model_state"], "cold")
        self.assertIsNone(admin["loaded_model"])
        self.activation.assert_not_called()

    def test_availability_errors_are_bounded_and_do_not_expose_backend_messages(self):
        chat = {"model": self.manager.selected_model, "messages": [{"role": "user", "content": "synthetic"}]}
        for error, code, detail in (
            (self.gateway.ModelWarmingError(), 503, "model_warming"),
            (self.gateway.InferenceBusyError(), 429, "local_inference_busy"),
            (TimeoutError("private exception"), 504, "local_inference_timeout"),
            (RuntimeError("private exception"), 503, "local_inference_unavailable"),
            (ValueError("private parser exception"), 503, "local_inference_unavailable"),
        ):
            with self.subTest(detail=detail):
                self.completion.side_effect = error
                with self.client() as client:
                    response = client.post("/v1/chat/completions", json=chat, headers={"Authorization": f"Bearer {API}"})
                    self.assertEqual(client.get("/health").json()["queue"]["active"], 0)
                self.assertEqual(response.status_code, code)
                self.assertEqual(response.json()["detail"], detail)
                self.assertNotIn("private exception", response.text)
                if code in (429, 503) and detail != "local_inference_unavailable":
                    self.assertIn("retry-after", response.headers)

    def test_timeout_cancels_inference_and_releases_capacity(self):
        async def run():
            cancelled = asyncio.Event()
            async def slow(*_):
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            self.completion.side_effect = slow
            self.gateway.app.state.inference_gate = self.gateway.AdmissionGate()
            request = self.gateway.ChatCompletionRequest(model=self.manager.selected_model,
                messages=[{"role": "user", "content": "synthetic"}])
            async def receive():
                await asyncio.Event().wait()
            connection = type("Connection", (), {"receive": AsyncMock(side_effect=receive)})()
            with patch.object(self.gateway, "INFERENCE_TIMEOUT_SECONDS", 0.02):
                with self.assertRaises(self.gateway.HTTPException) as raised:
                    await self.gateway.chat_completions(request, connection)
            self.assertEqual(raised.exception.status_code, 504)
            self.assertTrue(cancelled.is_set())
            self.assertEqual(self.gateway.app.state.inference_gate.active, 0)
        asyncio.run(run())

    def test_disconnected_client_cancels_inference_and_releases_capacity(self):
        async def run():
            cancelled = asyncio.Event()
            async def slow(*_):
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            self.completion.side_effect = slow
            self.gateway.app.state.inference_gate = self.gateway.AdmissionGate()
            request = self.gateway.ChatCompletionRequest(model=self.manager.selected_model,
                messages=[{"role": "user", "content": "synthetic"}])
            connection = type("Connection", (), {"receive": AsyncMock(return_value={"type": "http.disconnect"})})()
            with self.assertRaises(self.gateway.HTTPException) as raised:
                await self.gateway.chat_completions(request, connection)
            self.assertEqual(raised.exception.status_code, 499)
            self.assertTrue(cancelled.is_set())
            self.assertEqual(self.gateway.app.state.inference_gate.active, 0)
        asyncio.run(run())

    def test_admission_queue_is_bounded_and_cancelled_waiters_release_their_slot(self):
        async def run():
            gate = self.gateway.AdmissionGate()
            entered = asyncio.Event()
            async def wait():
                async with gate.slot():
                    entered.set()
            with patch.object(self.gateway, "MAX_CONCURRENT", 1), patch.object(self.gateway, "MAX_QUEUED", 1):
                async with gate.slot():
                    waiting = asyncio.create_task(wait())
                    await asyncio.sleep(0)
                    self.assertEqual(gate.queued, 1)
                    with self.assertRaises(self.gateway.InferenceBusyError):
                        async with gate.slot():
                            self.fail("queue overflow must not start inference")
                    waiting.cancel()
                    await asyncio.gather(waiting, return_exceptions=True)
                    self.assertEqual(gate.queued, 0)
                    self.assertFalse(entered.is_set())
                self.assertEqual(gate.active, 0)
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
