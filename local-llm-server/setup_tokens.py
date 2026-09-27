"""Create private gateway credentials without printing them or replacing defaults."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import secrets
import tempfile

from gateway_security import GatewayTokens


SERVER_DIRECTORY = Path(__file__).resolve().parent
_TOKEN_ASSIGNMENT = re.compile(r"^\s*(?:export\s+)?(LOCAL_LLM_API_KEY|LOCAL_LLM_ADMIN_TOKEN)\s*=")


def _require_single_line_settings(content: str) -> None:
    """Reject syntax we cannot safely rewrite, without including values in errors.

    Both shell sourcing and systemd EnvironmentFile support multiline values.
    A line inside such a value can look like a token assignment, so rejecting
    the whole input is safer than partially replacing it. Quoted single-line
    settings and comments are preserved verbatim by the writer below.
    """
    for line in content.splitlines():
        quote = None
        escaped = False
        for position, character in enumerate(line):
            if escaped:
                escaped = False
            elif character == "\\" and quote != "'":
                escaped = True
            elif quote:
                if character == quote:
                    quote = None
            elif character == "#" and (position == 0 or line[position - 1].isspace()):
                break
            elif character in {"'", '"'}:
                quote = character
        if quote or escaped:
            raise ValueError("Multiline or continued .env settings are not supported; no files were changed.")


def initialize_env(directory: Path = SERVER_DIRECTORY, *, overwrite: bool = False) -> Path:
    """Write only directory/.env; explicit rotation preserves unrelated settings."""
    destination = directory / ".env"
    if destination.is_symlink():
        raise ValueError("Refusing to replace a symlinked .env.")
    if destination.exists() and not overwrite:
        raise FileExistsError(".env already exists; use --force only to rotate both tokens.")

    source = destination if destination.exists() else directory / ".env.example"
    existing = source.read_text(encoding="utf-8-sig")
    _require_single_line_settings(existing)
    api = secrets.token_urlsafe(32)
    admin = secrets.token_urlsafe(32)
    while secrets.compare_digest(api, admin):
        admin = secrets.token_urlsafe(32)
    GatewayTokens(api, admin)
    replacements = {"LOCAL_LLM_API_KEY": api, "LOCAL_LLM_ADMIN_TOKEN": admin}
    lines = []
    seen = set()
    for line in existing.splitlines():
        match = _TOKEN_ASSIGNMENT.match(line)
        if match:
            name = match.group(1)
            if name not in seen:
                lines.append(f"{name}={replacements[name]}")
                seen.add(name)
        else:
            lines.append(line)
    for name, value in replacements.items():
        if name not in seen:
            lines.append(f"{name}={value}")
    content = "\n".join(lines) + "\n"

    # Fully write a private file before publication. A hard link publishes a new
    # .env atomically without replacing a concurrently created file. Unsupported
    # filesystems fail safely rather than falling back to a partial direct write.
    descriptor, temporary_name = tempfile.mkstemp(prefix=".env.", suffix=".tmp", dir=directory)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if overwrite:
            os.replace(temporary, destination)
        else:
            os.link(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Save two independent random tokens to local-llm-server/.env without displaying them.")
    parser.add_argument("--force", action="store_true", help="Explicitly rotate both tokens in an existing .env; preserve other settings.")
    arguments = parser.parse_args()
    try:
        initialize_env(overwrite=arguments.force)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Token setup failed: {error}\n")
    print("Saved private tokens to .env. Values were not displayed. Synchronize web-app credentials before restarting services.")


if __name__ == "__main__":
    main()
