export const JUDGE_EXPORT_SCHEMA_VERSION = "bora-judge-export/v3";

export function sanitizeJudgeText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/giu, "[secret-redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{12,}|Basic\s+[A-Za-z0-9+/=]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|ya29\.[A-Za-z0-9._-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/giu, "[secret-redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "[secret-redacted]")
    .replace(/\b(https?:\/\/)[^\s/:@]+:[^\s/@]+@/giu, "$1[userinfo-redacted]@")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|token|secret)\s*[:=]\s*[^\s,;]+/giu, "[secret-redacted]")
    .replace(/([?&#](?:token|access_token|api_key|key|secret)=)[^&#\s]+/giu, "$1[secret-redacted]")
    .replace(/\b(?:passport|여권)\s*(?:number|번호)?\s*[:=]?\s*[A-Z0-9-]{6,20}\b/giu, "[id-redacted]")
    .replace(/[\p{Letter}\p{Number}._%+-]+@[\p{Letter}\p{Number}.-]+\.[A-Za-z]{2,}/giu, "[email-redacted]")
    .replace(/\b\d{6}[- ]?[1-8]\d{6}\b/gu, "[id-redacted]")
    .replace(/\b(?:\d[- ]?){12,19}\b/gu, "[financial-id-redacted]")
    .replace(/(?:\+?82[-.\s]?)?0?1[016789](?:[-.\s]?\d){7,8}/gu, "[phone-redacted]")
    .trim()
    .slice(0, maximum);
}
