import {
  environmentValue,
  runtimeAiProviderSettings,
  runtimeSecret,
} from "@/lib/runtime-settings";
import type { AIProviderEnvironment, AIProviderName } from "./providers";

function privateLocalBaseUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase();
    const privateIpv4 = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./u.test(host);
    if ((url.protocol === "http:" || url.protocol === "https:")
      && (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || privateIpv4)
      && !url.username && !url.password) {
      return url.toString().replace(/\/$/u, "");
    }
  } catch {
    // Public, credential-bearing and malformed endpoints are never used.
  }
  return null;
}

export async function selectedAiRuntime() {
  const settings = await runtimeAiProviderSettings().catch(() => []);
  const selected = settings.find((setting) => setting.enabled && setting.configured);
  if (!selected) return null;

  const provider = selected.id as AIProviderName;
  const [openaiKey, geminiKey, claudeKey, localKey, localUrl] = await Promise.all([
    provider === "openai" ? runtimeSecret("OPENAI_API_KEY") : null,
    provider === "gemini" ? runtimeSecret("GEMINI_API_KEY") : null,
    provider === "claude" ? runtimeSecret("CLAUDE_API_KEY") : null,
    provider === "local" ? runtimeSecret("LOCAL_LLM_API_KEY") : null,
    provider === "local" ? environmentValue("LOCAL_LLM_BASE_URL") : null,
  ]);
  const safeLocalUrl = provider === "local" ? privateLocalBaseUrl(localUrl) : null;
  if (provider === "local" && !safeLocalUrl) return null;

  const env: AIProviderEnvironment = {
    AI_TIMEOUT_MS: await environmentValue("AI_TIMEOUT_MS") ?? undefined,
    OPENAI_API_KEY: openaiKey ?? undefined,
    OPENAI_MODEL: provider === "openai" ? selected.modelId : undefined,
    OPENAI_BASE_URL: await environmentValue("OPENAI_BASE_URL") ?? undefined,
    GEMINI_API_KEY: geminiKey ?? undefined,
    GEMINI_MODEL: provider === "gemini" ? selected.modelId : undefined,
    GEMINI_BASE_URL: await environmentValue("GEMINI_BASE_URL") ?? undefined,
    ANTHROPIC_API_KEY: claudeKey ?? undefined,
    CLAUDE_API_KEY: claudeKey ?? undefined,
    CLAUDE_MODEL: provider === "claude" ? selected.modelId : undefined,
    CLAUDE_BASE_URL: await environmentValue("CLAUDE_BASE_URL") ?? undefined,
    LOCAL_LLM_BASE_URL: safeLocalUrl ?? undefined,
    LOCAL_LLM_API_KEY: localKey ?? undefined,
    LOCAL_LLM_MODEL: provider === "local" ? selected.modelId : undefined,
  };

  return {
    provider,
    model: selected.modelId,
    billingRisk: selected.billingRisk,
    env,
  };
}
