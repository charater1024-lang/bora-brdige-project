export const AI_PROVIDER_NAMES = ["openai", "gemini", "claude", "local"] as const;

export type AIProviderName = (typeof AI_PROVIDER_NAMES)[number];
export type AIMessageRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface AICompletionRequest {
  provider: AIProviderName;
  messages: AIMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional caller cancellation; never serialized into the provider payload. */
  signal?: AbortSignal;
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AICompletionResult {
  provider: AIProviderName;
  model: string;
  content: string;
  demo: boolean;
  demoReason?: "missing_credentials" | "missing_endpoint" | "provider_error";
  warning?: string;
  providerError?: "model_warming" | "local_inference_busy" | "local_inference_timeout";
  usage?: AIUsage;
}

export interface AIProviderEnvironment {
  AI_TIMEOUT_MS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_API_KEY?: string;
  CLAUDE_MODEL?: string;
  CLAUDE_BASE_URL?: string;
  LOCAL_LLM_BASE_URL?: string;
  LOCAL_LLM_API_KEY?: string;
  LOCAL_LLM_MODEL?: string;
}

export interface AIProviderAdapter {
  readonly name: AIProviderName;
  readonly defaultModel: string;
  isConfigured(env: AIProviderEnvironment): boolean;
  complete(
    request: AICompletionRequest,
    env: AIProviderEnvironment,
    fetcher: typeof fetch,
    timeoutMs: number,
  ): Promise<AICompletionResult>;
}

interface JsonRecord {
  [key: string]: unknown;
}

class ProviderAvailabilityError extends Error {
  readonly code: NonNullable<AICompletionResult["providerError"]>;
  constructor(code: NonNullable<AICompletionResult["providerError"]>) {
    super(code);
    this.code = code;
  }
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_TOKENS = 900;

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function requestedModel(request: AICompletionRequest, envModel: string | undefined, fallback: string) {
  return request.model?.trim().slice(0, 120) || envModel?.trim() || fallback;
}

function systemText(messages: AIMessage[]) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

function conversationMessages(messages: AIMessage[]) {
  return messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content.trim() }));
}

function latestUserText(messages: AIMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function fetchJsonWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  callerSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let rejectDeadline: (reason: Error) => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const abort = () => {
    controller.abort();
    rejectDeadline(new Error("provider_request_aborted"));
  };
  const timeout = setTimeout(abort, timeoutMs);
  callerSignal?.addEventListener("abort", abort, { once: true });
  try {
    if (callerSignal?.aborted) abort();
    // Keep the same deadline through headers AND the complete response body.
    // The race also bounds non-compliant fetch implementations that ignore abort.
    return await Promise.race([deadline, (async () => {
      if (controller.signal.aborted) throw new Error("provider_request_aborted");
      const response = await fetcher(input, { ...init, signal: controller.signal });
      return await readJson(response, controller.signal);
    })()]);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abort);
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<JsonRecord> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new Error("provider_request_aborted");
    while (reader) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("provider_request_aborted");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error("provider_response_too_large");
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
  let payload: JsonRecord = {};

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as JsonRecord;
      }
    } catch {
      // Keep the error returned to callers free of provider HTML or proxy details.
    }
  }

  if (!response.ok) {
    if (payload.detail === "model_warming" || payload.detail === "local_inference_busy"
      || payload.detail === "local_inference_timeout") {
      throw new ProviderAvailabilityError(payload.detail);
    }
    const nestedError = payload.error;
    const message =
      nestedError && typeof nestedError === "object" && "message" in nestedError
        ? String(nestedError.message)
        : typeof payload.message === "string"
          ? payload.message
          : `HTTP ${response.status}`;
    throw new Error(`Provider request failed: ${message.slice(0, 240)}`);
  }

  return payload;
}

function demoLocale(text: string): "ko" | "en" | "ja" | "zh" {
  if (/[가-힣]/u.test(text)) return "ko";
  if (/[ぁ-ゟ゠-ヿ]/u.test(text)) return "ja";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  return "en";
}

function demoContent(request: AICompletionRequest) {
  const query = latestUserText(request.messages);
  const isPhishing = /피싱|스미싱|사기|의심|phishing|scam|詐欺|フィッシング|诈骗|钓鱼/i.test(query);
  const locale = demoLocale(query);

  const general = {
    ko: "현재 선택한 AI의 인증 정보가 없어 안전한 데모 모드로 답변합니다. 연결된 공식 금융 자료의 출처와 기준일을 확인하고, 실제 가입·송금·투자 전에는 해당 기관의 최신 원문과 조건을 다시 확인해 주세요.",
    en: "The selected AI is running in safe demo mode because its credentials are not configured. Check the cited official source and its review date, and confirm the latest terms with the institution before applying, transferring money, or investing.",
    ja: "選択したAIの認証情報が未設定のため、安全なデモモードで回答しています。引用された公的資料と確認日を確認し、申請・送金・投資の前に必ず公式機関の最新条件を再確認してください。",
    zh: "所选 AI 尚未配置认证信息，因此当前使用安全演示模式。请核对引用的官方来源及复核日期，并在申请、转账或投资前向相关机构确认最新条件。",
  };
  const phishing = {
    ko: "현재 데모 모드입니다. 의심 메시지의 링크·첨부파일을 열거나 송금하지 말고, 메시지에 적힌 번호가 아닌 공식 채널로 기관을 직접 확인하세요. 이미 송금했다면 즉시 금융회사와 112에 지급정지를 요청하고, 피싱 상담·신고는 1394를 이용할 수 있습니다.",
    en: "Demo mode is active. Do not open links or attachments, share credentials, or transfer money. Verify the organization through an independently found official channel. If money was sent in Korea, contact the bank and 112 immediately to request a payment freeze; phishing reports and advice are available at 1394.",
    ja: "現在はデモモードです。不審なリンクや添付ファイルを開かず、認証情報の共有や送金をしないでください。メッセージ内の連絡先ではなく、公式窓口を自分で確認してください。韓国で送金済みの場合は、金融機関と112に直ちに支払停止を依頼し、相談・通報は1394を利用できます。",
    zh: "当前为演示模式。请勿打开可疑链接或附件、提供验证码或转账，并通过自行查找的官方渠道核实机构身份。如已在韩国转账，请立即联系金融机构和 112 申请止付；诈骗咨询与举报可拨打 1394。",
  };

  return (isPhishing ? phishing : general)[locale];
}

function demoResult(
  request: AICompletionRequest,
  model: string,
  reason: AICompletionResult["demoReason"],
  warning?: string,
): AICompletionResult {
  return {
    provider: request.provider,
    model,
    content: demoContent(request),
    demo: true,
    demoReason: reason,
    warning,
  };
}

const openAIAdapter: AIProviderAdapter = {
  name: "openai",
  defaultModel: "gpt-5.6-terra",
  isConfigured: (env) => Boolean(env.OPENAI_API_KEY?.trim()),
  async complete(request, env, fetcher, timeoutMs) {
    const model = requestedModel(request, env.OPENAI_MODEL, this.defaultModel);
    const baseUrl = trimSlash(env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1");
    const instructions = systemText(request.messages);
    const payload = await fetchJsonWithTimeout(
      fetcher,
      `${baseUrl}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY?.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: conversationMessages(request.messages),
          ...(instructions ? { instructions } : {}),
          max_output_tokens: clamp(request.maxTokens, DEFAULT_MAX_TOKENS, 128, 8_000),
          store: false,
        }),
      },
      timeoutMs,
      request.signal,
    );
    const output = Array.isArray(payload.output) ? payload.output : [];
    const content = output
      .flatMap((item) => {
        if (!item || typeof item !== "object" || !("content" in item)) return [];
        return Array.isArray(item.content) ? item.content : [];
      })
      .filter(
        (part): part is { type: string; text: string } =>
          Boolean(
            part &&
              typeof part === "object" &&
              "type" in part &&
              part.type === "output_text" &&
              "text" in part &&
              typeof part.text === "string",
          ),
      )
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!content) throw new Error("Provider returned no text output");
    const usage = jsonRecord(payload.usage);

    return {
      provider: "openai",
      model: typeof payload.model === "string" ? payload.model : model,
      content,
      demo: false,
      usage: {
        inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
        totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
      },
    };
  },
};

const geminiAdapter: AIProviderAdapter = {
  name: "gemini",
  defaultModel: "gemini-3.5-flash",
  isConfigured: (env) => Boolean(env.GEMINI_API_KEY?.trim()),
  async complete(request, env, fetcher, timeoutMs) {
    const model = requestedModel(request, env.GEMINI_MODEL, this.defaultModel);
    const baseUrl = trimSlash(
      env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta",
    );
    const instructions = systemText(request.messages);
    const contents = conversationMessages(request.messages).map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const omitDeprecatedSampling = /^gemini-3\.(5|6)(?:-|$)/u.test(model);
    const payload = await fetchJsonWithTimeout(
      fetcher,
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY?.trim() || "",
        },
        body: JSON.stringify({
          contents,
          ...(instructions ? { systemInstruction: { parts: [{ text: instructions }] } } : {}),
          generationConfig: {
            maxOutputTokens: clamp(request.maxTokens, DEFAULT_MAX_TOKENS, 128, 8_000),
            ...(!omitDeprecatedSampling
              ? { temperature: Math.min(1, Math.max(0, request.temperature ?? 0.25)) }
              : {}),
          },
        }),
      },
      timeoutMs,
      request.signal,
    );
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = jsonRecord(candidates[0]);
    const candidateContent = jsonRecord(first.content);
    const parts: unknown[] = Array.isArray(candidateContent.parts) ? candidateContent.parts : [];
    const content = parts.map((part) => textValue(part)).filter(Boolean).join("\n").trim();

    if (!content) throw new Error("Provider returned no text output");
    const usage = jsonRecord(payload.usageMetadata);

    return {
      provider: "gemini",
      model,
      content,
      demo: false,
      usage: {
        inputTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined,
        outputTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined,
        totalTokens: typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : undefined,
      },
    };
  },
};

const claudeAdapter: AIProviderAdapter = {
  name: "claude",
  defaultModel: "claude-sonnet-5",
  isConfigured: (env) => Boolean((env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY)?.trim()),
  async complete(request, env, fetcher, timeoutMs) {
    const model = requestedModel(request, env.CLAUDE_MODEL, this.defaultModel);
    const baseUrl = trimSlash(env.CLAUDE_BASE_URL?.trim() || "https://api.anthropic.com/v1");
    const system = systemText(request.messages);
    const payload = await fetchJsonWithTimeout(
      fetcher,
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY)?.trim() || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: clamp(request.maxTokens, DEFAULT_MAX_TOKENS, 128, 8_000),
          messages: conversationMessages(request.messages),
          ...(system ? { system } : {}),
          temperature: Math.min(1, Math.max(0, request.temperature ?? 0.25)),
        }),
      },
      timeoutMs,
      request.signal,
    );
    const content = textValue(payload.content).trim();

    if (!content) throw new Error("Provider returned no text output");
    const usage = jsonRecord(payload.usage);
    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;

    return {
      provider: "claude",
      model: typeof payload.model === "string" ? payload.model : model,
      content,
      demo: false,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
      },
    };
  },
};

const localAdapter: AIProviderAdapter = {
  name: "local",
  defaultModel: "local-model",
  isConfigured: (env) => Boolean(env.LOCAL_LLM_BASE_URL?.trim()),
  async complete(request, env, fetcher, timeoutMs) {
    const model = requestedModel(request, env.LOCAL_LLM_MODEL, this.defaultModel);
    const baseUrl = trimSlash(env.LOCAL_LLM_BASE_URL?.trim() || "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.LOCAL_LLM_API_KEY?.trim()) {
      headers.Authorization = `Bearer ${env.LOCAL_LLM_API_KEY.trim()}`;
    }
    const payload = await fetchJsonWithTimeout(
      fetcher,
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: request.messages,
          max_tokens: clamp(request.maxTokens, DEFAULT_MAX_TOKENS, 128, 8_000),
          temperature: Math.min(1, Math.max(0, request.temperature ?? 0.25)),
          stream: false,
        }),
      },
      timeoutMs,
      request.signal,
    );
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0];
    const message = first && typeof first === "object" && "message" in first ? first.message : undefined;
    const content =
      message && typeof message === "object" && "content" in message ? textValue(message.content).trim() : "";

    if (!content) throw new Error("Provider returned no text output");
    const usage = jsonRecord(payload.usage);

    return {
      provider: "local",
      model: typeof payload.model === "string" ? payload.model : model,
      content,
      demo: false,
      usage: {
        inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
        outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
        totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
      },
    };
  },
};

export const AI_PROVIDER_ADAPTERS: Record<AIProviderName, AIProviderAdapter> = {
  openai: openAIAdapter,
  gemini: geminiAdapter,
  claude: claudeAdapter,
  local: localAdapter,
};

export function isAIProviderName(value: unknown): value is AIProviderName {
  return typeof value === "string" && AI_PROVIDER_NAMES.includes(value as AIProviderName);
}

export function getAIProviderAdapter(provider: AIProviderName) {
  return AI_PROVIDER_ADAPTERS[provider];
}

export async function generateAICompletion(
  request: AICompletionRequest,
  options: {
    env?: AIProviderEnvironment;
    fetcher?: typeof fetch;
  } = {},
): Promise<AICompletionResult> {
  const env = options.env ?? {};
  const adapter = getAIProviderAdapter(request.provider);
  const model = requestedModel(
    request,
    request.provider === "openai"
      ? env.OPENAI_MODEL
      : request.provider === "gemini"
        ? env.GEMINI_MODEL
        : request.provider === "claude"
          ? env.CLAUDE_MODEL
          : env.LOCAL_LLM_MODEL,
    adapter.defaultModel,
  );

  if (!adapter.isConfigured(env)) {
    return demoResult(
      request,
      model,
      request.provider === "local" ? "missing_endpoint" : "missing_credentials",
      request.provider === "local"
        ? "LOCAL_LLM_BASE_URL is not configured; a safe demo response was returned."
        : `${request.provider} credentials are not configured; a safe demo response was returned.`,
    );
  }

  const parsedTimeout = Number(env.AI_TIMEOUT_MS);
  const timeoutMs = clamp(parsedTimeout, DEFAULT_TIMEOUT_MS, 3_000, 60_000);

  try {
    return await adapter.complete(request, env, options.fetcher ?? fetch, timeoutMs);
  } catch (error) {
    const result = demoResult(
      request,
      model,
      "provider_error",
      `${request.provider} is temporarily unavailable; a safe demo response was returned.`,
    );
    if (error instanceof ProviderAvailabilityError) result.providerError = error.code;
    return result;
  }
}
