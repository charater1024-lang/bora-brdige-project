"""Dependency-free token validation shared by the gateway and setup tooling."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
import secrets
from typing import Literal, Mapping


MIN_TOKEN_LENGTH = 32
TokenRole = Literal["api", "admin"]
_PLACEHOLDER_MARKERS = (
    "replacewith", "changeme", "placeholder", "yourtoken", "yourapikey",
    "youradmintoken", "yoursecret", "exampletoken", "exampleapikey",
    "exampleadmintoken", "examplesecret", "sampletoken", "demotoken",
    "testtoken", "inserttoken", "insertsecret", "setme",
)


class TokenConfigurationError(ValueError):
    """A safe error code; never includes configured secret values."""


class InvalidTokenError(ValueError):
    pass


def _validate_token(token: str | None, role: TokenRole) -> None:
    if not token:
        raise TokenConfigurationError(f"{role}_token_not_configured")
    compact = re.sub(r"[^a-z0-9]", "", token.lower())
    if (
        len(token) < MIN_TOKEN_LENGTH
        or not token.isascii()
        or any(character.isspace() or ord(character) < 33 or ord(character) > 126 for character in token)
        or any(marker in compact for marker in _PLACEHOLDER_MARKERS)
        or len(set(token)) == 1
    ):
        raise TokenConfigurationError(f"{role}_token_invalid_configuration")


@dataclass(frozen=True)
class GatewayTokens:
    api: str = field(repr=False)
    admin: str = field(repr=False)

    def __post_init__(self) -> None:
        _validate_token(self.api, "api")
        _validate_token(self.admin, "admin")
        if secrets.compare_digest(self.api, self.admin):
            raise TokenConfigurationError("api_admin_tokens_must_differ")

    @classmethod
    def from_environment(cls, environment: Mapping[str, str]) -> GatewayTokens:
        return cls(environment.get("LOCAL_LLM_API_KEY", ""), environment.get("LOCAL_LLM_ADMIN_TOKEN", ""))

    def require(self, role: TokenRole, provided: str) -> None:
        if role not in {"api", "admin"}:
            raise ValueError("unsupported_token_role")
        configured = self.api if role == "api" else self.admin
        # Bytes also make arbitrary Unicode input a clean rejection, not a 500.
        if not secrets.compare_digest(configured.encode("ascii"), provided.encode("utf-8")):
            raise InvalidTokenError("invalid_token")


def require_token(environment: Mapping[str, str], role: TokenRole, provided: str) -> None:
    # Always validate both credentials: no partially configured or shared-token
    # deployment may expose either inference or model administration.
    GatewayTokens.from_environment(environment).require(role, provided)
