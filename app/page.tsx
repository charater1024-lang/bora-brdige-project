"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Accessibility,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  ClipboardPaste,
  Clock3,
  Database,
  ExternalLink,
  FileSearch,
  Globe2,
  Home,
  Lightbulb,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  MessageCircleQuestion,
  PiggyBank,
  ScanSearch,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { BoraDailyGuide } from "./components/bora-daily-guide";
import HomeControlCenter, { HomeControlCenterActions, type HomeSessionSnapshot, type HomeSessionUser } from "./components/home-control-center";
import { InformationShortcuts } from "./components/information-shortcuts";
import { FinancialLawSafety } from "./components/financial-law-safety";
import { FinancialMissionCenter } from "./components/financial-mission-center";
import { HomeFinanceStatus } from "./components/home-finance-status";
import { PersonalAssetWorkbook } from "./components/personal-asset-workbook";
import PublicDataOverview from "./components/public-data-overview";
import SafeMarkdown, { citationTargetId, citedSafeSources, type AiEvidenceSource } from "./components/safe-markdown";
import { SecurityTriageLab } from "./components/security-triage-lab";
import { personalizedLocalGreeting } from "@/lib/local-greeting";
import { recordRecentActivity, setRecentActivityClientConsent } from "@/lib/ai/context-client";
import { sanitizeConversationContext } from "@/lib/ai/context-policy";
import { manualFinanceSummary } from "@/lib/manual-finance";
import { fetchAuthJson, localLogoutCompleted } from "@/lib/auth/client-requests";
import type { ManualFinanceSnapshot } from "@/lib/manual-finance-snapshot";
import {
  canonicalWonFromMoneyInput,
  formatCanonicalWonInput,
  normalizeManualMoneyInput,
  type ManualMoneyUnit,
} from "@/lib/money-input";

type Locale = "ko" | "en" | "ja" | "zh";
type View = "home" | "assets" | "safety" | "opportunity" | "ai";
type HomeWidget = "today" | "summary" | "exchange" | "insights";
type AiTopicCode = "saving" | "spending" | "safety" | "startup" | "investment" | "settlement" | "other";
type AiSource = AiEvidenceSource;
type AiAnswerMode = "model" | "safe-demo" | "provider-fallback" | "rules" | "product-guide" | "unavailable" | "sign-in" | "consent-required" | "legal-unavailable";

export function principalRequestMatches(
  currentGeneration: number,
  currentUserId: string | null,
  requestGeneration: number,
  requestUserId: string,
) {
  return currentGeneration === requestGeneration && currentUserId === requestUserId;
}
type AiContextMode = "cached-official-law" | "live-official-law" | "live-public-data" | "stored-public-data" | "reviewed-knowledge" | "none";
type AiReplyMeta = {
  providerError?: "model_warming" | "local_inference_busy" | "local_inference_timeout" | null;
  mode: AiAnswerMode;
  contextMode?: AiContextMode;
  provider?: string;
  warning?: string;
  memoryStored?: boolean;
  memoryApplied?: number;
  conversationContextApplied?: number;
  recentActivityApplied?: number;
  retrieval?: { contextualized: boolean; status: string; method?: string };
  grounding?: {
    status: "citation-value-checks-passed" | "citation-only-checks-passed" | "excerpt-fallback" | "not-checked";
    numericChecksApplied?: boolean;
  };
};
type AiSessionTurnStatus = "pending" | "complete" | "error" | "sign-in";
const aiRuntimeNotice = {
  ko: { model_warming: "AI 모델을 준비하고 있어요. 현재는 대체 안내이며 잠시 후 직접 다시 시도할 수 있습니다.", local_inference_busy: "AI가 다른 요청을 처리하고 있어요. 현재는 대체 안내이며 잠시 후 다시 시도해 주세요.", local_inference_timeout: "AI 응답 시간이 초과되었습니다. 대체 안내를 확인하거나 직접 다시 시도할 수 있습니다." },
  en: { model_warming: "The AI model is warming up. This is fallback guidance; you can retry shortly.", local_inference_busy: "The AI is busy with another request. This is fallback guidance; please retry shortly.", local_inference_timeout: "The AI response timed out. Fallback guidance is shown; you may retry manually." },
  ja: { model_warming: "AIモデルを準備中です。現在は代替案内です。しばらくしてから再試行できます。", local_inference_busy: "AIが別の依頼を処理中です。現在は代替案内です。しばらくしてから再試行してください。", local_inference_timeout: "AI応答がタイムアウトしました。代替案内を確認するか、再試行できます。" },
  zh: { model_warming: "AI模型正在准备中。当前为备用说明，可稍后手动重试。", local_inference_busy: "AI正在处理其他请求。当前为备用说明，请稍后重试。", local_inference_timeout: "AI响应超时。当前显示备用说明，可手动重试。" },
} as const;
type AiSessionTurn = {
  id: number;
  question: string;
  answer: string;
  status: AiSessionTurnStatus;
  meta: AiReplyMeta | null;
  sources: AiSource[];
};

function aiSessionContextMessages(turns: readonly AiSessionTurn[], consent: boolean, beforeTurnId: number) {
  if (!consent) return [];
  return turns.filter((turn) => turn.id < beforeTurnId && turn.status === "complete"
    && (turn.meta?.mode === "model" || turn.meta?.mode === "rules"))
    .slice(-3)
    .flatMap((turn) => {
      const excerpt = sanitizeConversationContext({ question: turn.question, answer: turn.answer });
      return excerpt ? [
        { role: "user" as const, content: excerpt.userExcerpt },
        { role: "assistant" as const, content: excerpt.assistantExcerpt },
      ] : [];
    });
}
type AiFinanceInsightState =
  | { status: "loading" | "empty" | "unavailable"; snapshot: null }
  | { status: "ready"; snapshot: ManualFinanceSnapshot };
type AiAnalytics = {
  authenticated: boolean;
  demo: boolean;
  topicStats: Array<{ topic: AiTopicCode; count: number }>;
  totalChats: number;
  last7Days: number;
  lastChatAt: string | null;
  memories: Array<{
    id: string;
    topic: AiTopicCode;
    summary: string;
    createdAt: string;
    updatedAt: string;
  }>;
};
type AiContextPreferenceResponse = {
  preferences: {
    memoryEnabled: boolean;
    conversationContextEnabled: boolean;
    recentActivityEnabled: boolean;
  };
  retention?: {
    days: number;
    maximumActivities: number;
    maximumConversations: number;
  };
  inventory?: {
    activities: number;
    conversations: number;
  };
};
type SessionSnapshot = HomeSessionSnapshot;
type PhishingExposure = "opened-link" | "installed-app" | "shared-credentials" | "sent-money";
const AI_SESSION_TURN_LIMIT = 8;
const HOME_SESSION_REQUEST_TIMEOUT_MS = 12_000;
const AI_REQUEST_TIMEOUT_MS = 45_000;
const AI_AUXILIARY_REQUEST_TIMEOUT_MS = 12_000;
const AI_QUESTION_MAX_LENGTH = 24_000;

async function fetchWithClientTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = AI_AUXILIARY_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
type PhishingResult = {
  riskLevel: "low" | "medium" | "high";
  score: number;
  assessmentStatus: "complete" | "partial" | "inconclusive";
  summary: string;
  signals: Array<{ id: string; label: string; weight: number }>;
  detectedUrls: Array<{ url: string; host: string; signals: string[]; signalLabels: string[]; partial: boolean }>;
  scoreBreakdown: {
    ruleScore: number;
    urlHeuristicScore: number;
    interactionBonus: number;
    criticalFloor: number;
    reputationFloor: number;
    total: number;
  };
  urlReputation?: {
    status: "not-requested" | "not-consented" | "disabled" | "available" | "cached" | "unavailable" | "quota-exhausted" | "storage-unavailable";
    provider: string | null;
    providerUrl?: string | null;
    advisory: boolean;
    queryParametersRemoved: boolean;
    consentApplied: boolean;
    submittedComponents: string | null;
  };
  incidentResponse: {
    level: "prevention" | "urgent" | "emergency";
    title: string;
    summary: string;
    exposureIds: PhishingExposure[];
  };
  recommendedActions: string[];
  officialResources: Array<{ id: string; label: string; purpose: string; href: string }>;
  disclaimer: string;
  ruleSetVersion: string;
  officialSourceReviewedAt: string;
  contacts?: {
    policeEmergency?: string;
    phishingHotline?: string;
    financialSupervisoryService?: string;
    kisaIncidentHelp?: string;
  };
};

const securityCopy: Record<Locale, {
  onDemand: string;
  ruleBased: string;
  result: Record<PhishingResult["riskLevel"], string>;
  evidence: string;
  noSignals: string;
  nextActions: string;
  checkedUrls: string;
  scoreLabel: string;
  scoreParts: { rules: string; url: string; interaction: string; floor: string };
  deleteNotice: string;
  privacyWarning: string;
  previewLabel: string;
  inertPreview: string;
  inboxBoundary: string;
  clipboardHelp: string;
  clipboardConsent: string;
  clipboardConsentHelp: string;
  clipboardConsentRequired: string;
  clipboardReading: string;
  clipboardPaste: string;
  clipboardLoaded: string;
  clipboardUnavailable: string;
  clipboardEmpty: string;
  clearInput: string;
  inputCleared: string;
  exposureTitle: string;
  exposureLead: string;
  exposureOptions: Record<PhishingExposure, string>;
  reputationConsent: string;
  reputationConsentHelp: string;
  reputationTerms: string;
  assessment: Record<PhishingResult["assessmentStatus"], string>;
  officialHelp: string;
  urlFindings: string;
  analysisFailed: string;
  rateLimited: string;
  tooLarge: string;
  characters: string;
  reputation: Record<"not-requested" | "not-consented" | "disabled" | "available" | "cached" | "unavailable" | "quota-exhausted" | "storage-unavailable", string>;
}> = {
  ko: {
    onDemand: "요청 시 점검 · 실시간 감시 아님",
    ruleBased: "설명 가능한 규칙과 선택적 악성 URL 조회",
    result: { low: "뚜렷한 위험 신호가 적습니다", medium: "추가 확인이 필요합니다", high: "고위험 신호가 발견되었습니다" },
    evidence: "발견한 경고 신호",
    noSignals: "일치한 규칙 신호가 없습니다. 안전을 보장한다는 뜻은 아닙니다.",
    nextActions: "지금 할 일",
    checkedUrls: "확인한 URL",
    scoreLabel: "경고 신호 점수 · 확률 아님",
    scoreParts: { rules: "규칙", url: "URL 휴리스틱", interaction: "조합 신호", floor: "안전 하한" },
    deleteNotice: "메시지 원문은 영구 저장하지 않으며 분석 직후 입력창에서 지웁니다.",
    privacyWarning: "붙여넣기 전에 이름·전화번호·계좌·카드·주민/외국인번호·OTP를 지워 주세요.",
    previewLabel: "가져온 텍스트 미리보기 · 문자 한 건이 맞는지 확인",
    inertPreview: "가져온 내용은 링크로 활성화하지 않는 일반 텍스트로만 표시합니다. BORA는 문자 속 링크·첨부파일·앱을 실행하지 않습니다. 문자 텍스트의 위험 신호를 점검하며 휴대폰 감염 여부를 진단하지는 않습니다.",
    inboxBoundary: "BORA Bridge는 문자함을 읽지 않으며, 사용자가 직접 복사해 가져온 텍스트만 점검합니다.",
    clipboardHelp: "문자 말풍선 하나를 길게 눌러 ‘텍스트 복사’를 선택하세요. 링크·첨부·미리보기·QR·전화번호·앱 설치 버튼은 열지 마세요.",
    clipboardConsent: "현재 클립보드 텍스트를 한 번 읽는 데 동의",
    clipboardConsentHelp: "이 체크는 BORA에서 이번 읽기 시도에 동의하는 선택이며 브라우저의 사이트 권한을 켜거나 끄지 않습니다. 버튼을 누르면 브라우저가 별도로 묻거나 기존 설정에 따라 허용·차단할 수 있고, 한 번 시도한 뒤 체크는 자동 해제됩니다.",
    clipboardConsentRequired: "먼저 이번 한 번의 클립보드 읽기에 동의해 주세요.",
    clipboardReading: "클립보드 읽기 요청 중…",
    clipboardPaste: "복사한 메시지 붙여넣기",
    clipboardLoaded: "현재 클립보드의 텍스트를 가져왔어요. 점검할 문자 한 건이 맞는지 확인하세요. 아직 분석하거나 외부 URL을 조회하지 않았습니다. 개인정보와 OTP를 지운 뒤 분석해 주세요.",
    clipboardUnavailable: "브라우저가 클립보드 읽기를 허용하지 않았어요. 입력창을 길게 눌러 직접 붙여넣어 주세요.",
    clipboardEmpty: "클립보드에 붙여넣을 텍스트가 없어요. 메시지를 먼저 복사해 주세요.",
    clearInput: "입력 지우기",
    inputCleared: "선택한 문자와 관련 선택값을 모두 지웠어요.",
    exposureTitle: "이미 한 행동이 있나요?",
    exposureLead: "해당하는 항목만 선택하면 피해 대응 순서를 조정합니다. 선택값도 저장하지 않습니다.",
    exposureOptions: { "opened-link": "링크를 열었음", "installed-app": "첨부파일·앱을 내려받아 열거나 설치·실행함", "shared-credentials": "비밀번호·OTP·신분정보를 제공함", "sent-money": "이미 송금함" },
    reputationConsent: "Google 악성 URL 평판 조회에 동의",
    reputationConsentHelp: "기본은 꺼짐입니다. 켜면 쿼리를 뺀 URL의 스킴·호스트·경로가 Google에 전송될 수 있으며, 위험 사이트를 놓치거나 정상 사이트를 잘못 표시할 수 있습니다. 남용 방지용 일 단위 HMAC 네트워크 키는 48시간이 지나면 다음 외부 조회 때 삭제 대상으로 정리합니다.",
    reputationTerms: "Google은 제출 URL과 관련 데이터를 보안 서비스 개선에 사용하거나 약관에 따라 제3자와 공유할 수 있습니다. Google 약관 확인",
    assessment: { complete: "점검 완료", partial: "부분 점검 · 외부 평판 또는 URL 일부 미확인", inconclusive: "판단 보류 · URL을 충분히 해석하지 못함" },
    officialHelp: "공식 대응 경로",
    urlFindings: "URL 근거",
    analysisFailed: "분석하지 못했습니다. 입력 형식과 잠시 후 재시도를 확인해 주세요.",
    rateLimited: "요청이 많습니다. 잠시 후 다시 시도해 주세요. 입력 내용은 그대로 유지됩니다.",
    tooLarge: "입력이 너무 깁니다. 개인정보를 지우고 20,000자 이내로 줄여 주세요.",
    characters: "자",
    reputation: { "not-requested": "URL 평판 조회 없음", "not-consented": "외부 조회 동의 안 함 · 로컬 규칙만 적용", disabled: "외부 URL 평판 운영 설정 꺼짐", available: "Google URL 평판 조회 완료", cached: "Google URL 평판 · 30분 이내 캐시", unavailable: "URL 평판 조회 실패 · 로컬 규칙만 적용", "quota-exhausted": "외부 조회 보호 한도 도달 · 로컬 규칙만 적용", "storage-unavailable": "보호 한도를 확인할 수 없어 외부 전송 중단 · 로컬 규칙만 적용" },
  },
  en: {
    onDemand: "On-demand check · not live monitoring",
    ruleBased: "Explainable rules with optional malicious-URL lookup",
    result: { low: "Few clear warning signals found", medium: "Further verification is needed", high: "High-risk warning signals found" },
    evidence: "Warning signals found",
    noSignals: "No rule matched. This does not guarantee that the message is safe.",
    nextActions: "What to do now",
    checkedUrls: "URLs checked",
    scoreLabel: "Warning-signal score · not a probability",
    scoreParts: { rules: "Rules", url: "URL heuristics", interaction: "Combined signals", floor: "Safety floor" },
    deleteNotice: "Message text is not retained and is cleared from the input after analysis.",
    privacyWarning: "Before pasting, remove names, phone, account/card, resident-ID, and OTP values.",
    previewLabel: "Imported-text preview · confirm it is one message",
    inertPreview: "Imported content is shown only as plain, non-link text. BORA does not launch links, attachments, or apps from the message. This checks warning signals in message text; it does not diagnose device infection.",
    inboxBoundary: "BORA Bridge does not read your inbox; it checks only text that you explicitly copy and import.",
    clipboardHelp: "Press and hold one message bubble and choose Copy text. Do not open links, attachments, previews, QR codes, phone numbers, or install buttons.",
    clipboardConsent: "Allow one read of the current clipboard text",
    clipboardConsentHelp: "This checkbox records consent for this BORA read attempt; it does not change your browser's site permission. When you press the button, the browser may ask separately or allow or block access under its current settings. The checkbox resets after one attempt.",
    clipboardConsentRequired: "First allow this one clipboard-read attempt.",
    clipboardReading: "Requesting clipboard access…",
    clipboardPaste: "Paste copied message",
    clipboardLoaded: "The current clipboard text was imported. Confirm that it is the one message you meant to check. It has not been analyzed or sent for external URL lookup. Remove personal data and OTP values before analysis.",
    clipboardUnavailable: "This browser did not allow clipboard access. Press and hold the input field to paste manually.",
    clipboardEmpty: "There is no text to paste. Copy the message first.",
    clearInput: "Clear input",
    inputCleared: "The selected message and its related choices were cleared.",
    exposureTitle: "Did you already take an action?",
    exposureLead: "Select only what happened to tailor the response order. Selections are not saved.",
    exposureOptions: { "opened-link": "Opened the link", "installed-app": "Downloaded or opened an attachment/app, or installed or ran an app", "shared-credentials": "Shared a password, OTP, or ID", "sent-money": "Already sent money" },
    reputationConsent: "Allow Google malicious-URL reputation lookup",
    reputationConsentHelp: "Off by default. If enabled, the URL scheme, host, and path—without query parameters—may be sent to Google. Risky sites may be missed and safe sites may be flagged in error. Daily HMAC network keys older than 48 hours are removed during the next external lookup cleanup.",
    reputationTerms: "Google may use submitted URLs and associated data to improve security services or share them under its terms. Review Google's terms",
    assessment: { complete: "Check complete", partial: "Partial check · reputation or part of a URL was not verified", inconclusive: "Inconclusive · the URL could not be parsed sufficiently" },
    officialHelp: "Official response channels",
    urlFindings: "URL evidence",
    analysisFailed: "We could not analyze this input. Check the format and try again shortly.",
    rateLimited: "Too many requests. Try again shortly; your input has been kept.",
    tooLarge: "The input is too long. Remove personal data and keep it within 20,000 characters.",
    characters: "characters",
    reputation: { "not-requested": "No URL reputation lookup", "not-consented": "External lookup not allowed · local rules only", disabled: "External URL reputation is not configured", available: "Google URL reputation checked", cached: "Google URL reputation · cache under 30 minutes", unavailable: "URL lookup unavailable · local rules only", "quota-exhausted": "External lookup safety limit reached · local rules only", "storage-unavailable": "External lookup stopped because its safety limit could not be verified · local rules only" },
  },
  ja: {
    onDemand: "依頼時のみ確認・リアルタイム監視ではありません",
    ruleBased: "説明可能なルールと任意の不正URL照会",
    result: { low: "明確な警告サインは少数です", medium: "追加確認が必要です", high: "高リスクの警告サインがあります" },
    evidence: "検出した警告サイン",
    noSignals: "一致したルールはありません。安全を保証するものではありません。",
    nextActions: "今すべきこと",
    checkedUrls: "確認したURL",
    scoreLabel: "警告サイン点数・確率ではありません",
    scoreParts: { rules: "ルール", url: "URLヒューリスティック", interaction: "組合せ信号", floor: "安全下限" },
    deleteNotice: "メッセージ原文は保存せず、分析後に入力欄から消去します。",
    privacyWarning: "貼り付け前に氏名・電話・口座・カード・在留番号・OTPを削除してください。",
    previewLabel: "取り込んだテキストのプレビュー・1件か確認",
    inertPreview: "取り込んだ内容はリンク化しない通常のテキストだけで表示します。BORAはメッセージ内のリンク・添付ファイル・アプリを起動しません。文面の危険サインを確認する機能であり、端末の感染診断は行いません。",
    inboxBoundary: "BORA Bridgeは受信箱を読み取らず、利用者が自分でコピーして取り込んだテキストだけを確認します。",
    clipboardHelp: "メッセージの吹き出し1件を長押しし、「テキストをコピー」を選んでください。リンク・添付・プレビュー・QR・電話番号・インストールボタンは開かないでください。",
    clipboardConsent: "現在のクリップボードを1回だけ読み取ることに同意",
    clipboardConsentHelp: "このチェックはBORAで今回の読み取りに同意する選択であり、ブラウザのサイト権限を変更するものではありません。ボタンを押すと、ブラウザが別途確認するか、現在の設定に従って許可・拒否します。1回の試行後にチェックは自動解除されます。",
    clipboardConsentRequired: "先に今回1回のクリップボード読み取りに同意してください。",
    clipboardReading: "クリップボードの読み取りを要求中…",
    clipboardPaste: "コピーしたメッセージを貼り付け",
    clipboardLoaded: "現在のクリップボードのテキストを取り込みました。確認したいメッセージ1件か確かめてください。まだ分析も外部URL照会もしていません。個人情報とOTPを削除してから分析してください。",
    clipboardUnavailable: "ブラウザがクリップボードの読み取りを許可しませんでした。入力欄を長押しして手動で貼り付けてください。",
    clipboardEmpty: "貼り付けるテキストがありません。先にメッセージをコピーしてください。",
    clearInput: "入力を消去",
    inputCleared: "選択したメッセージと関連する選択内容をすべて消去しました。",
    exposureTitle: "すでに行った操作はありますか？",
    exposureLead: "該当項目だけを選ぶと対応順を調整します。選択値は保存しません。",
    exposureOptions: { "opened-link": "リンクを開いた", "installed-app": "添付・アプリをダウンロードして開いた、または導入・実行した", "shared-credentials": "パスワード・OTP・本人情報を渡した", "sent-money": "すでに送金した" },
    reputationConsent: "Googleの不正URL評価照会に同意",
    reputationConsentHelp: "初期値はオフ。オンにするとクエリを除いたURLの方式・ホスト・パスがGoogleへ送られる場合があります。危険サイトの見落としや安全サイトの誤判定もあり得ます。48時間を過ぎた日次HMACネットワークキーは、次回の外部照会時の整理処理で削除対象になります。",
    reputationTerms: "Googleは送信URLと関連データを安全サービスの改善に利用し、規約に基づき第三者と共有する場合があります。Google規約を確認",
    assessment: { complete: "確認完了", partial: "部分確認・外部評価またはURLの一部が未確認", inconclusive: "判断保留・URLを十分に解析できません" },
    officialHelp: "公式対応窓口",
    urlFindings: "URLの根拠",
    analysisFailed: "分析できませんでした。入力形式を確認し、しばらくして再試行してください。",
    rateLimited: "リクエストが多すぎます。しばらくして再試行してください。入力は保持されます。",
    tooLarge: "入力が長すぎます。個人情報を削除し、20,000文字以内にしてください。",
    characters: "文字",
    reputation: { "not-requested": "URL評価なし", "not-consented": "外部照会に未同意・ローカル規則のみ", disabled: "外部URL評価の運用設定なし", available: "Google URL評価を確認済み", cached: "Google URL評価・30分以内のキャッシュ", unavailable: "URL評価に失敗・ローカル規則のみ", "quota-exhausted": "外部照会の保護上限に到達・ローカル規則のみ", "storage-unavailable": "保護上限を確認できないため外部送信を中止・ローカル規則のみ" },
  },
  zh: {
    onDemand: "按需检查 · 并非实时监控",
    ruleBased: "可解释规则与可选恶意网址查询",
    result: { low: "发现的明显警告信号较少", medium: "需要进一步核实", high: "发现高风险警告信号" },
    evidence: "发现的警告信号",
    noSignals: "没有匹配规则，但这不代表信息一定安全。",
    nextActions: "现在该怎么做",
    checkedUrls: "已检查的网址",
    scoreLabel: "警告信号分数 · 不是概率",
    scoreParts: { rules: "规则", url: "网址启发式", interaction: "组合信号", floor: "安全下限" },
    deleteNotice: "不会长期保存消息原文，分析后会清空输入框。",
    privacyWarning: "粘贴前请删除姓名、电话、账号、卡号、身份证件号和验证码。",
    previewLabel: "已导入文字预览 · 请确认只有一条短信",
    inertPreview: "导入内容只会显示为不带链接的纯文本。BORA 不会启动短信中的链接、附件或应用。本功能检查短信文字中的风险信号，不诊断设备是否感染。",
    inboxBoundary: "BORA Bridge 不读取短信收件箱，只检查用户自行复制并导入的文字。",
    clipboardHelp: "请长按一条短信气泡并选择“复制文本”。不要打开链接、附件、预览、二维码、电话号码或安装按钮。",
    clipboardConsent: "同意仅本次读取当前剪贴板文字",
    clipboardConsentHelp: "此勾选仅表示同意BORA进行本次读取，不会更改浏览器的网站权限。点击按钮后，浏览器可能另行询问，或按当前设置允许或阻止；尝试一次后会自动取消勾选。",
    clipboardConsentRequired: "请先同意本次剪贴板读取。",
    clipboardReading: "正在请求读取剪贴板…",
    clipboardPaste: "粘贴已复制的消息",
    clipboardLoaded: "已导入当前剪贴板文字。请确认这是要检查的一条短信。尚未分析，也未进行外部网址查询。请删除个人信息和验证码后再分析。",
    clipboardUnavailable: "浏览器未允许读取剪贴板。请长按输入框并手动粘贴。",
    clipboardEmpty: "剪贴板中没有可粘贴的文字，请先复制消息。",
    clearInput: "清空输入",
    inputCleared: "已清除所选短信及其相关选项。",
    exposureTitle: "是否已经进行了操作？",
    exposureLead: "只选择实际发生的项目，以调整处置顺序；选择内容不会保存。",
    exposureOptions: { "opened-link": "打开了链接", "installed-app": "下载或打开了附件/应用，或安装、运行了应用", "shared-credentials": "提供了密码、验证码或身份信息", "sent-money": "已经转账" },
    reputationConsent: "同意使用 Google 恶意网址信誉查询",
    reputationConsentHelp: "默认关闭。开启后，去除查询参数的网址协议、主机和路径可能发送给 Google；仍可能漏报危险网站或误报正常网站。超过48小时的每日HMAC网络键会在下一次外部查询清理时列入删除。",
    reputationTerms: "Google可能使用提交的网址及相关数据改进安全服务，或依其条款与第三方共享。查看Google条款",
    assessment: { complete: "检查完成", partial: "部分检查 · 网址信誉或部分内容未核实", inconclusive: "暂缓判断 · 无法充分解析网址" },
    officialHelp: "官方处置渠道",
    urlFindings: "网址依据",
    analysisFailed: "无法完成分析。请检查输入格式并稍后重试。",
    rateLimited: "请求过多，请稍后重试；输入内容会保留。",
    tooLarge: "输入过长。请删除个人信息并控制在20,000字以内。",
    characters: "字",
    reputation: { "not-requested": "未查询网址信誉", "not-consented": "未同意外部查询 · 仅使用本地规则", disabled: "未配置外部网址信誉", available: "Google网址信誉查询完成", cached: "Google网址信誉 · 30分钟内缓存", unavailable: "网址查询失败 · 仅使用本地规则", "quota-exhausted": "外部查询达到保护上限 · 仅使用本地规则", "storage-unavailable": "无法核验保护上限，已停止外发 · 仅使用本地规则" },
  },
};

const localeTag: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const shellCopy = {
  ko: {
    recent: "최근 사용",
    recentEmpty: "아직 사용 기록이 없어요",
    challenge: "BORA Bridge란?",
    accountMenu: "계정 메뉴",
    myPage: "마이페이지",
    developer: "개발자 모드",
    signIn: "로그인하고 설정하기",
    signOut: "로그아웃",
    signingOut: "로그아웃 중…",
    signOutFailed: "로그아웃하지 못했습니다.",
    moreData: "전체 공식정보 분야 보기",
    moreDataLead: "청년·금융·창업·정착 분야 바로가기를 필요할 때 펼쳐보세요.",
    authSuccess: "로그인이 완료됐습니다. 맞춤 홈과 마이페이지가 연결됐어요.",
    authCancelled: "로그인이 취소되었습니다. 필요하면 마이페이지에서 다시 로그인해 주세요.",
    authFailed: "로그인을 완료하지 못했습니다. 마이페이지에서 다시 로그인하거나 잠시 후 재시도해 주세요.",
    footerOperations: "공식 근거 확인 · 접근성을 고려한 운영",
    footerPrivacy: "개인정보 처리방침",
    footerTerms: "이용약관",
    footerLegalNav: "법적 고지",
  },
  en: {
    recent: "Recently used",
    recentEmpty: "No recent features yet",
    challenge: "About BORA Bridge",
    accountMenu: "Account menu",
    myPage: "My page",
    developer: "Developer mode",
    signIn: "Sign in and manage",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "We couldn't sign you out.",
    moreData: "View all official information topics",
    moreDataLead: "Open shortcuts for youth, finance, startup and settlement information only when needed.",
    authSuccess: "Sign-in complete. Your personalized home and My page are connected.",
    authCancelled: "Sign-in was cancelled. You can try again from My page.",
    authFailed: "Sign-in could not be completed. Try again from My page or wait a moment and retry.",
    footerOperations: "Official evidence reviewed · accessibility-minded operation",
    footerPrivacy: "Privacy policy",
    footerTerms: "Terms of use",
    footerLegalNav: "Legal information",
  },
  ja: {
    recent: "最近使った機能",
    recentEmpty: "最近の利用履歴はありません",
    challenge: "BORA Bridgeとは？",
    accountMenu: "アカウントメニュー",
    myPage: "マイページ",
    developer: "開発者モード",
    signIn: "ログインして設定",
    signOut: "ログアウト",
    signingOut: "ログアウト中…",
    signOutFailed: "ログアウトできませんでした。",
    moreData: "すべての公式情報分野を見る",
    moreDataLead: "若者・金融・創業・定着のショートカットは必要な時だけ開けます。",
    authSuccess: "ログインが完了しました。ホームとマイページが連携されました。",
    authCancelled: "ログインをキャンセルしました。必要な場合はマイページから再度ログインしてください。",
    authFailed: "ログインを完了できませんでした。マイページから再度ログインするか、しばらくしてからお試しください。",
    footerOperations: "公式根拠を確認 · アクセシビリティに配慮した運用",
    footerPrivacy: "プライバシーポリシー",
    footerTerms: "利用規約",
    footerLegalNav: "法的情報",
  },
  zh: {
    recent: "最近使用",
    recentEmpty: "暂无使用记录",
    challenge: "关于 BORA Bridge",
    accountMenu: "账户菜单",
    myPage: "我的页面",
    developer: "开发者模式",
    signIn: "登录并设置",
    signOut: "退出登录",
    signingOut: "正在退出…",
    signOutFailed: "无法退出登录。",
    moreData: "查看全部官方信息领域",
    moreDataLead: "需要时再展开青年、金融、创业与安家信息入口。",
    authSuccess: "登录成功，个性化首页与我的页面已连接。",
    authCancelled: "登录已取消。如有需要，请从我的页面重新登录。",
    authFailed: "无法完成登录。请从我的页面重新登录，或稍后再试。",
    footerOperations: "核对官方依据 · 注重无障碍运营",
    footerPrivacy: "隐私政策",
    footerTerms: "使用条款",
    footerLegalNav: "法律信息",
  },
} satisfies Record<Locale, Record<string, string>>;

const RECENT_FEATURES_KEY = "bora-recent-features-v1";
const MAIN_VIEWS: View[] = ["home", "assets", "safety", "opportunity", "ai"];
const VIEW_PATHS: Record<View, string> = {
  home: "/",
  assets: "/assets",
  safety: "/safety",
  opportunity: "/opportunities",
  ai: "/ai-guide",
};

function viewFromPathname(pathname: string | null, fallback: View): View {
  return MAIN_VIEWS.find((view) => VIEW_PATHS[view] === pathname) ?? fallback;
}

const memoryCopy: Record<Locale, {
  title: string;
  lead: string;
  empty: string;
  forget: string;
  clear: string;
  confirmClear: string;
  consentLabel: string;
  consentOn: string;
  consentOff: string;
  consentOffLead: string;
}> = {
  ko: {
    title: "AI가 기억하는 핵심",
    lead: "대화 전문이 아닌 개인정보를 가린 짧은 목표·선호만 저장합니다.",
    empty: "저장된 핵심 메모가 없습니다.",
    forget: "이 메모 잊기",
    clear: "모두 잊기",
    confirmClear: "저장된 AI 핵심 메모를 모두 삭제할까요?",
    consentLabel: "다음 상담에 핵심 메모 사용",
    consentOn: "기억 켬",
    consentOff: "기억 끔",
    consentOffLead: "기본값은 꺼짐입니다. 끄면 기존 메모를 답변에 사용하지 않고 새 메모도 저장하지 않습니다.",
  },
  en: {
    title: "What AI remembers",
    lead: "Only short, redacted goals and preferences are saved—not full chats.",
    empty: "There are no saved key memories.",
    forget: "Forget this memory",
    clear: "Forget all",
    confirmClear: "Delete all saved AI memories?",
    consentLabel: "Use key memories in future chats",
    consentOn: "Memory on",
    consentOff: "Memory off",
    consentOffLead: "The default is off. When off, existing memories are not used in answers and new ones are not saved.",
  },
  ja: {
    title: "AIが記憶する要点",
    lead: "会話全文ではなく、個人情報を伏せた短い目標・好みだけを保存します。",
    empty: "保存された要点はありません。",
    forget: "この記憶を削除",
    clear: "すべて削除",
    confirmClear: "保存されたAIの記憶をすべて削除しますか？",
    consentLabel: "次回の相談で要点を使用",
    consentOn: "記憶オン",
    consentOff: "記憶オフ",
    consentOffLead: "初期設定はオフです。オフの場合、既存の記憶を回答に使用せず、新しい記憶も保存しません。",
  },
  zh: {
    title: "AI记住的要点",
    lead: "仅保存已隐藏个人信息的简短目标和偏好，不保存完整对话。",
    empty: "没有已保存的要点。",
    forget: "删除此记忆",
    clear: "全部删除",
    confirmClear: "删除所有已保存的AI记忆吗？",
    consentLabel: "在后续咨询中使用要点",
    consentOn: "记忆开启",
    consentOff: "记忆关闭",
    consentOffLead: "默认为关闭。关闭后不会在回答中使用已有记忆，也不会保存新的记忆。",
  },
};

const contextConsentCopy: Record<Locale, {
  privacySettings: string;
  privacySettingsLead: string;
  conversationTitle: string;
  conversationLead: string;
  conversationOn: string;
  conversationOff: string;
  activityTitle: string;
  activityLead: string;
  activityOn: string;
  activityOff: string;
  clear: string;
  clearConversationConfirm: string;
  clearActivityConfirm: string;
  savedCount: (count: number) => string;
  usedCount: (conversations: number, activities: number) => string;
  saving: string;
  saved: string;
  saveFailed: string;
}> = {
  ko: {
    privacySettings: "AI 개인정보·참조 설정",
    privacySettingsLead: "3개 항목은 모두 기본 OFF이며, 저장 맥락은 Local AI에서만 사용하고 외부 유료 AI에는 전달하지 않습니다.",
    conversationTitle: "최근 대화 맥락 참고",
    conversationLead: "일부 직접 식별자를 자동 제거한 최근 질문·답변 발췌를 최대 6건, 30일 보관합니다. ON이면 이 화면의 최근 완료 문답 최대 3건도 짧게 정제해 후속 질문과 함께 전달합니다. 과거 대화는 로컬 AI에서만 참고하며 외부 AI에는 보내지 않습니다. 민감정보는 입력하지 마세요. OFF이면 저장·조회·활용을 모두 중단합니다.",
    conversationOn: "대화 참고 켬",
    conversationOff: "대화 참고 끔",
    activityTitle: "최근 활동 참고",
    activityLead: "검색어나 URL 없이 연 메뉴, 정책·고용 공식 항목 ID, 선택 통화만 최대 40건, 30일 동안 보관합니다.",
    activityOn: "활동 참고 켬",
    activityOff: "활동 참고 끔",
    clear: "저장 내용 삭제",
    clearConversationConfirm: "저장된 최근 대화 맥락을 모두 삭제할까요?",
    clearActivityConfirm: "저장된 최근 활동을 모두 삭제할까요?",
    savedCount: (count) => `현재 ${count}건 보관`,
    usedCount: (conversations, activities) => `이번 답변: 최근 대화 ${conversations}건 · 최근 활동 ${activities}건 참고`,
    saving: "설정 저장 중…",
    saved: "AI 참조 설정을 저장했습니다.",
    saveFailed: "설정을 저장하지 못했습니다. 기존 설정을 유지합니다.",
  },
  en: {
    privacySettings: "AI privacy & context settings", privacySettingsLead: "All three choices default to OFF. Saved context is used only with Local AI and is never sent to a paid external AI.",
    conversationTitle: "Use recent conversation context", conversationLead: "Up to 6 question-answer excerpts with selected direct identifiers removed are kept for 30 days. ON also sends short, redacted excerpts from up to 3 completed turns in this tab with a follow-up question. Prior chat is used only by Local AI, never an external AI. Do not enter sensitive data. OFF stops storage, retrieval, and use.", conversationOn: "Conversation context on", conversationOff: "Conversation context off",
    activityTitle: "Use recent activity", activityLead: "Without searches or URLs, BORA keeps only opened menus, official policy/employment IDs, and selected currencies: up to 40 for 30 days.", activityOn: "Activity context on", activityOff: "Activity context off", clear: "Delete saved context", clearConversationConfirm: "Delete all saved recent conversation context?", clearActivityConfirm: "Delete all saved recent activity?", savedCount: (count) => `${count} currently retained`, usedCount: (conversations, activities) => `This answer used ${conversations} recent chats and ${activities} recent activities`, saving: "Saving settings…", saved: "AI context settings saved.", saveFailed: "Settings could not be saved. Existing settings were kept.",
  },
  ja: {
    privacySettings: "AIプライバシー・参照設定", privacySettingsLead: "3項目はすべて初期設定オフです。保存した文脈はLocal AIでのみ使用し、外部の有料AIには送信しません。",
    conversationTitle: "最近の会話文脈を参照", conversationLead: "一部の直接識別子を自動除去した質問・回答の抜粋を最大6件、30日間保存します。オンではこのタブの完了した問答最大3件も短く処理し、追加質問と送信します。過去の会話はローカルAIだけで参照し、外部AIには送信しません。機微情報は入力しないでください。オフでは保存・取得・利用を停止します。", conversationOn: "会話参照オン", conversationOff: "会話参照オフ",
    activityTitle: "最近の利用履歴を参照", activityLead: "検索語やURLは保存せず、開いたメニュー、政策・雇用の公式ID、選択通貨のみ最大40件、30日間保存します。", activityOn: "履歴参照オン", activityOff: "履歴参照オフ", clear: "保存内容を削除", clearConversationConfirm: "保存された最近の会話文脈をすべて削除しますか？", clearActivityConfirm: "保存された最近の利用履歴をすべて削除しますか？", savedCount: (count) => `現在${count}件保存`, usedCount: (conversations, activities) => `今回の回答：最近の会話${conversations}件・利用履歴${activities}件を参照`, saving: "設定を保存中…", saved: "AI参照設定を保存しました。", saveFailed: "設定を保存できませんでした。既存の設定を維持します。",
  },
  zh: {
    privacySettings: "AI隐私与参考设置", privacySettingsLead: "三个选项默认均为关闭。已保存上下文仅用于Local AI，不会发送给外部付费AI。",
    conversationTitle: "参考近期对话上下文", conversationLead: "对部分直接识别信息进行自动移除后，最多保留6条问答摘录、30天。开启后还会将本标签页最近完成的最多3轮问答简短脱敏，与追问一同发送。历史对话仅供本地AI参考，不会发送给外部AI。请勿输入敏感信息。关闭后停止保存、读取和使用。", conversationOn: "对话参考开启", conversationOff: "对话参考关闭",
    activityTitle: "参考近期活动", activityLead: "不保存搜索词或网址，仅保存打开的菜单、政策/就业官方ID及所选币种，最多40条、30天。", activityOn: "活动参考开启", activityOff: "活动参考关闭", clear: "删除已保存内容", clearConversationConfirm: "删除所有已保存的近期对话上下文吗？", clearActivityConfirm: "删除所有已保存的近期活动吗？", savedCount: (count) => `当前保留${count}条`, usedCount: (conversations, activities) => `本次回答参考了${conversations}条近期对话和${activities}条近期活动`, saving: "正在保存设置…", saved: "已保存AI参考设置。", saveFailed: "无法保存设置，已保留原设置。",
  },
};

const aiTrustCopy: Record<Locale, {
  model: string;
  safeDemo: string;
  providerFallback: string;
  rules: string;
  productGuide: string;
  unavailable: string;
  signIn: string;
  consentRequired: string;
  legalUnavailable: string;
  safeDemoLead: string;
  providerFallbackLead: string;
  rulesLead: string;
  productGuideLead: string;
  unavailableLead: string;
  consentRequiredLead: string;
  cachedLaw: string;
  liveLaw: string;
  livePublicData: string;
  storedPublicData: string;
  reviewedKnowledge: string;
}> = {
  ko: {
    model: "AI 생성 답변",
    safeDemo: "AI 미연결 · 고정 안전 안내",
    providerFallback: "AI 연결 실패 · 고정 안전 안내",
    rules: "근거 확인 안내",
    productGuide: "BORA Bridge 기능 안내",
    unavailable: "AI 서비스 이용 불가",
    signIn: "로그인 안내",
    consentRequired: "필수 동의 필요",
    legalUnavailable: "공식 법령 확인 실패",
    safeDemoLead: "모델이 생성한 답변이 아닙니다. AI 설정을 확인할 때까지 고정된 안전 안내만 표시합니다.",
    providerFallbackLead: "AI 호출에 실패했습니다. 아래 내용은 모델 답변이 아닌 고정된 안전 안내입니다.",
    rulesLead: "모델 답변 대신 확인 안내나 출처 발췌를 표시했습니다. 구체적인 조건과 예외는 원문을 확인하세요.",
    productGuideLead: "모델이나 공식자료 검색을 사용하지 않은 고정된 서비스 기능 안내입니다.",
    unavailableLead: "답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    consentRequiredLead: "AI 상담과 개인화 기능을 사용하려면 현재 이용약관과 개인정보 처리방침에 먼저 동의해 주세요.",
    cachedLaw: "저장된 최신 공식 법령 근거 재사용",
    liveLaw: "공식 법령 실시간 확인",
    livePublicData: "공공데이터 최신 저장본 사용",
    storedPublicData: "저장된 공식자료 검색",
    reviewedKnowledge: "검토된 지식 근거 사용",
  },
  en: {
    model: "AI-generated answer", safeDemo: "AI not connected · fixed safety notice", providerFallback: "AI connection failed · fixed safety notice", rules: "Evidence notice", productGuide: "BORA Bridge feature guide", unavailable: "AI unavailable", signIn: "Sign-in notice", consentRequired: "Consent required", legalUnavailable: "Official law unavailable",
    safeDemoLead: "This is not a model-generated answer. Only a fixed safety notice is shown until AI is configured.", providerFallbackLead: "The AI request failed. The text below is a fixed safety notice, not a model answer.", rulesLead: "A clarification notice or source excerpts are shown instead of a model answer. Check the original for conditions and exceptions.", productGuideLead: "This is a fixed service guide that does not call a model or search official records.", unavailableLead: "An answer could not be generated. Please try again later.", consentRequiredLead: "Accept the current terms and privacy policy before using AI consultation and personalized features.", cachedLaw: "Reused current cached official-law context", liveLaw: "Checked official law live", livePublicData: "Used the latest stored public data", storedPublicData: "Searched stored official data", reviewedKnowledge: "Used reviewed knowledge",
  },
  ja: {
    model: "AI生成回答", safeDemo: "AI未接続・固定安全案内", providerFallback: "AI接続失敗・固定安全案内", rules: "根拠確認案内", productGuide: "BORA Bridge機能案内", unavailable: "AIを利用できません", signIn: "ログイン案内", consentRequired: "必須同意が必要", legalUnavailable: "公式法令を確認できません",
    safeDemoLead: "モデルが生成した回答ではありません。AI設定を確認するまで固定の安全案内のみ表示します。", providerFallbackLead: "AI呼び出しに失敗しました。以下はモデル回答ではなく固定の安全案内です。", rulesLead: "モデル回答の代わりに確認案内または出典の抜粋を表示しています。条件や例外は原文で確認してください。", productGuideLead: "モデルや公式資料検索を使用しない固定のサービス機能案内です。", unavailableLead: "回答を生成できませんでした。しばらくしてから再度お試しください。", consentRequiredLead: "AI相談と個人向け機能を利用する前に、現在の利用規約とプライバシーポリシーに同意してください。", cachedLaw: "保存済みの最新公式法令根拠を再利用", liveLaw: "公式法令をリアルタイム確認", livePublicData: "最新の保存済み公共データを使用", storedPublicData: "保存済み公式資料を検索", reviewedKnowledge: "確認済み知識を使用",
  },
  zh: {
    model: "AI生成回答", safeDemo: "AI未连接 · 固定安全提示", providerFallback: "AI连接失败 · 固定安全提示", rules: "依据说明", productGuide: "BORA Bridge功能说明", unavailable: "AI服务不可用", signIn: "登录提示", consentRequired: "需要必要同意", legalUnavailable: "无法核实官方法规",
    safeDemoLead: "这不是模型生成的回答。在AI配置完成前仅显示固定安全提示。", providerFallbackLead: "AI调用失败。下方内容是固定安全提示，不是模型回答。", rulesLead: "当前显示确认提示或来源摘录，而非模型回答。具体条件及例外请核对原文。", productGuideLead: "这是不调用模型、也不搜索官方资料的固定服务功能说明。", unavailableLead: "无法生成回答，请稍后重试。", consentRequiredLead: "使用AI咨询和个性化功能前，请先同意当前的使用条款和隐私政策。", cachedLaw: "复用已保存的最新官方法规依据", liveLaw: "实时核实官方法规", livePublicData: "使用最新保存的公共数据", storedPublicData: "已搜索保存的官方资料", reviewedKnowledge: "使用已审核知识",
  },
};

const aiEvidenceCopy = {
  ko: {
    usedOnly: "이번 답변에서 인용한 출처만 표시합니다.",
    storedLead: "저장된 자료를 검색한 결과이며, 원문을 지금 실시간 조회한 것은 아닙니다.",
    excerpt: "검색에 사용한 발췌", missingExcerpt: "발췌가 제공되지 않았습니다. 공식 원문을 확인해 주세요.",
    published: "자료 게시일", effective: "법령 시행일", checked: "확인일", expires: "마감·유효 종료일", unknownDate: "정보 없음",
    basisNote: "수치의 기준일·기간은 발췌에 표시된 값을 확인하세요. 확인일과 다를 수 있습니다.",
    original: "공식 원문 열기", contextualized: "동의한 이전 질문을 참고해 검색했습니다.",
    excerptFallback: "답변 대신 저장된 근거의 발췌를 표시했습니다. 원문의 조건·예외를 확인해 주세요.",
  },
  en: {
    usedOnly: "Only sources cited in this answer are shown.", storedLead: "These are stored records, not a live check of the original pages.",
    excerpt: "Excerpt used for this answer", missingExcerpt: "No excerpt was provided. Check the official original.",
    published: "Published", effective: "Law effective date", checked: "Checked", expires: "Closing / expiry date", unknownDate: "Not provided",
    basisNote: "Check the excerpt for the figures' reference date or period. It can differ from the check date.",
    original: "Open official original", contextualized: "Search used a previous question you consented to share.",
    excerptFallback: "Stored source excerpts are shown instead of an answer. Check the original conditions and exceptions.",
  },
  ja: {
    usedOnly: "この回答で引用した出典のみ表示します。", storedLead: "保存済み資料の検索結果であり、原文のリアルタイム確認ではありません。",
    excerpt: "検索に使用した抜粋", missingExcerpt: "抜粋がありません。公式原文を確認してください。",
    published: "資料公開日", effective: "法令施行日", checked: "確認日", expires: "締切・有効期限", unknownDate: "情報なし",
    basisNote: "数値の基準日・期間は抜粋で確認してください。確認日とは異なる場合があります。",
    original: "公式原文を開く", contextualized: "共有に同意した以前の質問を参考に検索しました。",
    excerptFallback: "回答の代わりに保存済み根拠の抜粋を表示しています。原文の条件・例外を確認してください。",
  },
  zh: {
    usedOnly: "仅显示本回答实际引用的来源。", storedLead: "这是已保存资料的搜索结果，并非实时核对原始页面。",
    excerpt: "搜索使用的摘录", missingExcerpt: "未提供摘录，请查看官方原文。",
    published: "资料发布日期", effective: "法规生效日", checked: "核对日期", expires: "截止／有效期", unknownDate: "未提供",
    basisNote: "数值的基准日期或期间请查看摘录，可能与核对日期不同。",
    original: "打开官方原文", contextualized: "搜索参考了您同意分享的上一问题。",
    excerptFallback: "当前显示已保存依据的摘录，而非回答。请核对原文条件及例外。",
  },
} as const;

const aiInsightsCopy: Record<Locale, {
  protectedEngine: string;
  protectedEngineSub: string;
  checkingSources: string;
  topicTitle: string;
  topicLead: string;
  demoBadge: string;
  historyBadge: string;
  chats: string;
  thisWeek: string;
  todayPattern: string;
  todayPatternTitle: string;
  todayPatternBody: string;
  weeklyPattern: string;
  weeklyPatternLead: string;
  evidenceTitle: string;
  evidenceLead: string;
  evidenceEmpty: string;
  reviewed: string;
  savingTitle: string;
  savingLead: string;
  savingTips: Array<{ title: string; detail: string; amount: string }>;
  metadataOnly: string;
  userMessage: string;
  dataBasis: string;
}> = {
  ko: {
    protectedEngine: "비용 보호형 단일 AI",
    protectedEngineSub: "관리자가 승인한 엔진만 사용 · 공식 근거 검색 연결",
    checkingSources: "BORA AI · 공식 근거 확인",
    topicTitle: "상담 주제 통계",
    topicLead: "대화 내용 대신 주제 메타데이터만 집계해요.",
    demoBadge: "기록 0건",
    historyBadge: "내 상담 기록",
    chats: "누적 상담",
    thisWeek: "최근 7일",
    todayPattern: "오늘의 AI 추천 소비 패턴",
    todayPatternTitle: "직접 입력한 소비 내역이 0건입니다",
    todayPatternBody: "사용자가 소비 내역을 직접 입력하고 저장하기 전에는 시간대별 소비를 추정하거나 추천하지 않습니다.",
    weeklyPattern: "금주의 소비 패턴",
    weeklyPatternLead: "직접 저장한 주간 소비 데이터가 0건입니다.",
    evidenceTitle: "검색 근거",
    evidenceLead: "답변에 사용한 공식 자료와 검토일을 확인하세요.",
    evidenceEmpty: "질문을 보내면 관련 공식 검색 근거가 여기에 표시됩니다.",
    reviewed: "검토",
    savingTitle: "이번 주 절약 방식",
    savingLead: "실제 소비 금액을 저장하면 근거 기반으로 제안합니다.",
    savingTips: [
      { title: "소비 금액 입력", detail: "직접 입력한 소비 금액만 계산해요", amount: "0원" },
      { title: "고정비 확인", detail: "직접 저장한 고정비 내역 0건", amount: "0원" },
      { title: "변동비 확인", detail: "직접 저장한 변동비 내역 0건", amount: "0원" },
    ],
    metadataOnly: "질문 원문과 답변 전문은 저장하지 않습니다. 주제 통계와 개인정보를 가린 짧은 핵심 메모만 보관합니다.",
    userMessage: "내 질문",
    dataBasis: "사용한 개인 소비 데이터 0건",
  },
  en: {
    protectedEngine: "Cost-protected single AI", protectedEngineSub: "Only the admin-approved engine · official-source search connected", checkingSources: "BORA AI · Checking official sources",
    topicTitle: "Conversation topics", topicLead: "Only topic metadata is counted, not your conversation text.", demoBadge: "0 records", historyBadge: "My history", chats: "All chats", thisWeek: "Last 7 days",
    todayPattern: "Today's AI spending pattern", todayPatternTitle: "0 manually saved spending records", todayPatternBody: "No time-of-day pattern or amount is estimated until you enter and save spending records.",
    weeklyPattern: "This week's spending", weeklyPatternLead: "There are 0 manually saved weekly spending records.", evidenceTitle: "Search evidence", evidenceLead: "Review the official sources and review dates used in the answer.", evidenceEmpty: "Send a question to see the relevant official sources here.", reviewed: "Reviewed",
    savingTitle: "Ways to save this week", savingLead: "Evidence-based suggestions appear after you save real spending amounts.", savingTips: [{ title: "Enter spending amounts", detail: "Only amounts you enter are calculated", amount: "₩0" }, { title: "Review fixed costs", detail: "0 saved fixed-cost records", amount: "₩0" }, { title: "Review variable costs", detail: "0 saved variable-cost records", amount: "₩0" }],
    metadataOnly: "BORA does not store full questions or answers. It keeps topic statistics and short, redacted key memories only.", userMessage: "Your question", dataBasis: "0 personal spending records used",
  },
  ja: {
    protectedEngine: "コスト保護型の単一AI", protectedEngineSub: "管理者承認済みエンジンのみ · 公式根拠検索に接続", checkingSources: "BORA AI · 公式根拠を確認中",
    topicTitle: "相談テーマ統計", topicLead: "会話本文ではなくテーマ情報のみ集計します。", demoBadge: "記録0件", historyBadge: "相談履歴", chats: "累計相談", thisWeek: "直近7日",
    todayPattern: "今日のAI支出パターン", todayPatternTitle: "手入力で保存した支出は0件です", todayPatternBody: "支出を入力して保存するまでは、時間帯別パターンや金額を推定しません。",
    weeklyPattern: "今週の支出パターン", weeklyPatternLead: "手入力で保存した週間支出は0件です。", evidenceTitle: "検索根拠", evidenceLead: "回答に使用した公式資料と確認日を表示します。", evidenceEmpty: "質問すると関連する公式根拠が表示されます。", reviewed: "確認",
    savingTitle: "今週の節約方法", savingLead: "実際の支出額を保存すると根拠付きで提案します。", savingTips: [{ title: "支出額を入力", detail: "入力した金額だけを計算します", amount: "0ウォン" }, { title: "固定費確認", detail: "保存済み固定費0件", amount: "0ウォン" }, { title: "変動費確認", detail: "保存済み変動費0件", amount: "0ウォン" }],
    metadataOnly: "質問・回答の全文は保存せず、テーマ統計と個人情報を伏せた短い要点だけを保存します。", userMessage: "質問", dataBasis: "使用した個人支出データ0件",
  },
  zh: {
    protectedEngine: "费用保护型单一AI", protectedEngineSub: "仅使用管理员批准的引擎 · 已连接官方依据搜索", checkingSources: "BORA AI · 正在核对官方依据",
    topicTitle: "咨询主题统计", topicLead: "仅统计主题元数据，不保存对话正文。", demoBadge: "记录0条", historyBadge: "我的记录", chats: "累计咨询", thisWeek: "最近7天",
    todayPattern: "今日AI消费模式", todayPatternTitle: "手动保存的消费记录为0条", todayPatternBody: "在您手动输入并保存消费记录前，不会估算时段模式或金额。",
    weeklyPattern: "本周消费模式", weeklyPatternLead: "手动保存的周消费记录为0条。", evidenceTitle: "搜索依据", evidenceLead: "查看回答使用的官方资料和审核日期。", evidenceEmpty: "发送问题后，相关官方依据会显示在这里。", reviewed: "审核",
    savingTitle: "本周节省方式", savingLead: "保存真实消费金额后提供有依据的建议。", savingTips: [{ title: "输入消费金额", detail: "只计算您输入的金额", amount: "0韩元" }, { title: "检查固定支出", detail: "已保存固定支出0条", amount: "0韩元" }, { title: "检查可变支出", detail: "已保存可变支出0条", amount: "0韩元" }],
    metadataOnly: "不保存完整问题或回答，仅保留主题统计和已隐藏个人信息的简短要点。", userMessage: "我的问题", dataBasis: "使用的个人消费数据0条",
  },
};

const aiSessionCopy: Record<Locale, {
  transcriptLabel: string;
  sessionOnly: string;
  pending: string;
  retry: string;
  signInTitle: string;
  signInBody: string;
  signInAction: string;
  sources: string;
  evidenceSummary: string;
  insightsLoading: string;
  insightsEmptyTitle: string;
  insightsEmptyBody: string;
  insightsUnavailableTitle: string;
  insightsUnavailableBody: string;
  insightsAction: string;
  monthlyOutflow: string;
  monthlyBalance: string;
  cashflowMix: string;
  manualBasis: string;
  fixedExpenses: string;
  variableExpenses: string;
  debtPayment: string;
}> = {
  ko: {
    transcriptLabel: "현재 탭의 AI 상담 대화",
    sessionOnly: "화면의 최근 8개 문답은 새로고침하면 사라집니다. ‘최근 대화 맥락 참고’를 켜면 정제한 발췌가 별도로 전달·보관됩니다.",
    pending: "공식 근거를 확인하고 있어요.",
    retry: "다시 시도",
    signInTitle: "로그인하면 AI 상담을 시작할 수 있어요",
    signInBody: "네이버 또는 카카오 로그인 후 질문을 보내고 내 설정을 관리하세요.",
    signInAction: "로그인·마이페이지 열기",
    sources: "출처",
    evidenceSummary: "이 답변의 근거 펼치기",
    insightsLoading: "저장한 자산 장부를 확인하고 있어요.",
    insightsEmptyTitle: "소비·현금흐름 데이터가 아직 없어요",
    insightsEmptyBody: "자산 화면에서 월소득과 고정비·변동비·상환액을 저장하면 여기서 한 번에 요약해 드려요.",
    insightsUnavailableTitle: "자산 장부를 불러오지 못했어요",
    insightsUnavailableBody: "잠시 후 다시 열거나 자산 화면에서 저장 상태를 확인해 주세요.",
    insightsAction: "자산 장부 입력하기",
    monthlyOutflow: "이번 달 입력 지출·상환",
    monthlyBalance: "월 예상 잔액",
    cashflowMix: "입력한 현금흐름 구성",
    manualBasis: "직접 입력해 저장한 금액 기준",
    fixedExpenses: "고정비",
    variableExpenses: "변동비",
    debtPayment: "대출 상환",
  },
  en: {
    transcriptLabel: "AI consultation in this tab", sessionOnly: "The latest 8 turns disappear from this screen on refresh. If recent conversation context is ON, redacted excerpts are sent and retained separately.", pending: "Checking official evidence.", retry: "Try again", signInTitle: "Sign in to start an AI consultation", signInBody: "Sign in with Naver or Kakao to ask questions and manage your settings.", signInAction: "Open sign-in & My page", sources: "sources", evidenceSummary: "Open evidence for this answer", insightsLoading: "Checking your saved finance workbook.", insightsEmptyTitle: "No spending or cash-flow data yet", insightsEmptyBody: "Save monthly income, fixed and variable costs, and debt payments in Assets to see one concise summary here.", insightsUnavailableTitle: "Your finance workbook could not be loaded", insightsUnavailableBody: "Try again later or check its saved status in Assets.", insightsAction: "Enter finance data", monthlyOutflow: "Monthly outflow entered", monthlyBalance: "Estimated monthly balance", cashflowMix: "Entered cash-flow mix", manualBasis: "Based on amounts you entered and saved", fixedExpenses: "Fixed costs", variableExpenses: "Variable costs", debtPayment: "Debt payments",
  },
  ja: {
    transcriptLabel: "このタブのAI相談", sessionOnly: "画面の直近8件の問答は再読み込みで消えます。会話文脈参照がオンの場合、処理済み抜粋を別途送信・保存します。", pending: "公式根拠を確認しています。", retry: "再試行", signInTitle: "ログインするとAI相談を開始できます", signInBody: "NaverまたはKakaoでログインして質問と設定管理を行えます。", signInAction: "ログイン・マイページを開く", sources: "件の出典", evidenceSummary: "この回答の根拠を開く", insightsLoading: "保存済み資産台帳を確認しています。", insightsEmptyTitle: "支出・キャッシュフロー情報がまだありません", insightsEmptyBody: "資産画面で月収・固定費・変動費・返済額を保存すると、ここにまとめて表示します。", insightsUnavailableTitle: "資産台帳を読み込めませんでした", insightsUnavailableBody: "時間をおいて再度開くか、資産画面で保存状態を確認してください。", insightsAction: "資産台帳を入力", monthlyOutflow: "入力した月間支出・返済", monthlyBalance: "月間予想残高", cashflowMix: "入力済みキャッシュフロー構成", manualBasis: "入力・保存した金額を基準", fixedExpenses: "固定費", variableExpenses: "変動費", debtPayment: "ローン返済",
  },
  zh: {
    transcriptLabel: "当前标签页的AI咨询", sessionOnly: "屏幕上最近8轮问答会在刷新后消失。开启近期对话参考时，脱敏摘录会另行发送和保存。", pending: "正在核对官方依据。", retry: "重试", signInTitle: "登录后即可开始AI咨询", signInBody: "使用Naver或Kakao登录后可提问并管理设置。", signInAction: "打开登录与我的页面", sources: "条来源", evidenceSummary: "展开本回答的依据", insightsLoading: "正在检查已保存的资产账本。", insightsEmptyTitle: "尚无消费或现金流数据", insightsEmptyBody: "在资产页面保存月收入、固定支出、可变支出和还款额后，这里会集中显示摘要。", insightsUnavailableTitle: "无法加载资产账本", insightsUnavailableBody: "请稍后重试，或在资产页面确认保存状态。", insightsAction: "填写资产账本", monthlyOutflow: "已输入的月支出与还款", monthlyBalance: "月预计余额", cashflowMix: "已输入现金流构成", manualBasis: "以您输入并保存的金额为准", fixedExpenses: "固定支出", variableExpenses: "可变支出", debtPayment: "贷款还款",
  },
};

const legalAiUnavailableCopy: Record<Locale, string> = {
  ko: "현행 공식 법령 근거를 확인할 수 없어 법률 설명을 생성하지 않았습니다. 안심 화면의 금융 법령 가이드에서 연동 상태를 확인해 주세요.",
  en: "No legal explanation was generated because current official law could not be verified. Check the Financial-law guide on the Safety screen.",
  ja: "現行の公式法令根拠を確認できないため、法的説明を生成しませんでした。安心画面の金融法令ガイドで連携状態を確認してください。",
  zh: "由于无法核实现行官方法规依据，系统未生成法律说明。请在安心页面的金融法规指南中确认连接状态。",
};

const topicColors: Record<AiTopicCode, string> = {
  saving: "#6d5bd0", spending: "#8c78e0", safety: "#d05b67", startup: "#d49335", investment: "#438b83", settlement: "#7aa6d8", other: "#c9c2d8",
};

const topicLabels: Record<Locale, Record<AiTopicCode, string>> = {
  ko: { saving: "저축·자산", spending: "소비·예산", safety: "피싱·안전", startup: "창업·지원", investment: "투자·증시", settlement: "정착·환전", other: "기타" },
  en: { saving: "Saving", spending: "Spending", safety: "Safety", startup: "Startup", investment: "Investing", settlement: "Settlement", other: "Other" },
  ja: { saving: "貯蓄・資産", spending: "支出・予算", safety: "詐欺・安全", startup: "起業・支援", investment: "投資・市場", settlement: "定着・両替", other: "その他" },
  zh: { saving: "储蓄·资产", spending: "消费·预算", safety: "诈骗·安全", startup: "创业·扶持", investment: "投资·市场", settlement: "安家·换汇", other: "其他" },
};

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    brandTag: "모두를 잇는 AI 금융 동반자",
    home: "홈",
    assets: "자산",
    safety: "안심",
    opportunity: "기회",
    ai: "AI 상담",
    easyMode: "쉬운 모드",
    greeting: "안녕하세요",
    greetingSub: "직접 입력해 계정에 저장한 값과 공식 공공정보만 바탕으로 안내합니다.",
    updated: "계정 자산 장부 사용 가능",
    todayTitle: "현재 확인할 항목",
    todaySub: "개인 데이터와 읽지 않은 정보가 모두 0건입니다.",
    assetAction: "내 자산 장부 확인",
    assetDesc: "직접 입력한 값만 계산하며 로그인하면 다른 기기에서도 이어서 볼 수 있어요.",
    safetyAction: "검사한 의심 메시지 0건",
    safetyDesc: "문자나 URL을 직접 입력하면 위험 신호를 분석합니다.",
    startupAction: "읽지 않은 창업 정보 0건",
    startupDesc: "공식 API 동기화 후 확인된 정보만 표시합니다.",
    startPlan: "저축 계획 만들기",
    scanNow: "지금 분석하기",
    seeSupport: "지원 자격 보기",
    netWorth: "순자산",
    safeStatus: "금융 안전 상태",
    goalProgress: "비상금 목표",
    safe: "검사 전",
    good: "미설정",
    monthChange: "변동 데이터 0건",
    blocked: "검사 기록 0건",
    goalRemain: "목표 금액 0원",
    trendTitle: "내 자산 흐름",
    trendSub: "저장된 입력이 없으면 자산 흐름을 0으로 표시합니다.",
    cashflowTitle: "이번 달 현금흐름",
    income: "수입",
    spending: "지출",
    saving: "저축 가능",
    aiBrief: "BORA AI 브리핑",
    aiBriefBody: "저장된 소비 입력이 0건이므로 개인화 추천을 생성하지 않았습니다.",
    askWhy: "왜 그런가요?",
    sourceCount: "근거 0개 · 개인 데이터 0건 사용",
    goalTitle: "목표 시뮬레이터",
    goalSub: "목표 금액과 월 저축액을 입력해 도달 시점을 비교해 보세요.",
    goalAmount: "목표 금액",
    wonUnit: "원",
    manwonUnit: "만원",
    monthlySave: "매달 저축",
    arrive: "예상 도달",
    months: "개월",
    makePlan: "이 계획으로 시작",
    spendingTitle: "소비 패턴",
    spendingSub: "금액을 비교하기 쉬운 순서로 정리했어요.",
    housing: "주거·공과금", food: "식비", transport: "교통", shopping: "쇼핑",
    tableView: "표로 보기",
    safetyTitle: "의심 메시지는 링크·첨부파일을 열거나 응답·송금하기 전에 확인하세요",
    safetyLead: "설명 가능한 위험 규칙과 선택한 경우에만 악성 URL 평판을 함께 확인해요.",
    sampleMessage: "",
    analyze: "위험 분석하기",
    analyzing: "분석하고 있어요…",
    danger: "위험 가능성이 높아요",
    dangerLead: "송금하지 말고 아래 근거를 먼저 확인하세요.",
    risk1: "공식 기관이 아닌 단축 URL을 사용했어요.",
    risk2: "오늘 안에 송금을 재촉하고 있어요.",
    risk3: "등록금·환전 우대를 미끼로 계좌이체를 요구해요.",
    stopTransfer: "송금 멈추기",
    call1332: "피싱 신고·상담 1394",
    protectionSteps: "피해가 의심되면",
    step1: "은행에 지급정지를 요청하세요",
    step2: "112에 신고하고 사건번호를 받으세요",
    step3: "1394에서 피싱 신고·상담과 기관 연계를 요청하세요",
    opportunityTitle: "내 조건에 맞는 다음 기회",
    opportunityLead: "청년 자산형성, 창업지원, 한국 금융정착 정보를 공식 원문과 함께 찾아드려요.",
    opportunitySearch: "AI로 맞춤 기회 찾기",
    matched: "맞춤도",
    deadline: "마감",
    startupFund: "청년 로컬크리에이터 사업화 지원",
    startupFundDesc: "서울 · 외식/콘텐츠 · 예비창업자 조건과 일치",
    youthFund: "청년도약계좌 기여금 안내",
    youthFundDesc: "소득 구간을 반영한 월 예상 정부기여금 확인",
    settlePlan: "한국 금융정착 90일 플랜",
    settlePlanDesc: "계좌 · 통신 · 보험 · 세금 절차를 선택한 언어로 안내",
    viewOriginal: "공식 원문 보기",
    roadTitle: "정착 로드맵",
    day30: "30일",
    day60: "60일",
    day90: "90일",
    accountOpen: "본인인증·계좌 개설",
    transferSetup: "해외송금·자동이체",
    taxInsurance: "세금·보험 이해",
    marketTitle: "오늘의 시장 한눈에",
    marketCaution: "투자 권유가 아닌 학습용 정보이며, 기준일과 출처를 표시합니다.",
    aiTitle: "출처를 먼저 보여주는 금융 AI",
    aiLead: "내 데이터 사용 범위와 답변 근거를 확인하고, 실행 전에는 반드시 최종 검토해요.",
    engine: "AI 엔진",
    privateLocal: "Local AI는 BORA 서버에서 처리되며 외부 AI 제공사로 보내지 않아요",
    askPlaceholder: "예: 이번 달에 20만원을 더 모으려면 어떻게 해야 해?",
    send: "질문 보내기",
    thinking: "근거를 확인하고 있어요…",
    aiAnswer: "직접 저장한 소비 내역이 없어 맞춤 금액을 계산하지 않았습니다. 질문에 필요한 공식 근거가 있으면 출처와 함께 안내합니다.",
    aiSignIn: "AI 상담은 로그인 후 사용할 수 있어요. 마이페이지에서 네이버 또는 카카오로 로그인해 주세요.",
    evidence: "답변 근거",
    dataUsed: "사용한 개인 금융 데이터 0건",
    modelAuto: "자동 선택",
    privacy: "개인정보 보호",
    footer: "BORA는 금융 결정을 돕는 정보 서비스이며 투자·대출 계약을 대신하지 않습니다.",
    menu: "메뉴",
    close: "닫기",
  },
  en: {
    brandTag: "Your inclusive AI finance companion",
    home: "Home", assets: "Money", safety: "Safety", opportunity: "Explore", ai: "AI Guide",
    easyMode: "Easy mode", greeting: "Hello", greetingSub: "Only values you enter and save to your account, plus official public information, are used.", updated: "Account workbook available",
    todayTitle: "Items to review", todaySub: "Saved entries and unread records start at zero.", assetAction: "Review my money workbook", assetDesc: "Only your entries are calculated, and the same signed-in account can continue on another device.", safetyAction: "0 suspicious messages checked", safetyDesc: "Enter a message or URL to analyze its risk signals.", startupAction: "0 unread startup records", startupDesc: "Only information confirmed through official APIs is shown.", startPlan: "Build a savings plan", scanNow: "Scan now", seeSupport: "View information",
    netWorth: "Net worth", safeStatus: "Financial checks", goalProgress: "Emergency fund", safe: "Not checked", good: "Not set", monthChange: "0 change records", blocked: "0 check records", goalRemain: "₩0 goal",
    trendTitle: "Your wealth trend", trendSub: "Values remain zero until you save an entry.", cashflowTitle: "This month's cash flow", income: "Income", spending: "Spending", saving: "Available to save",
    aiBrief: "BORA AI brief", aiBriefBody: "No personalized recommendation was generated because there are 0 saved spending entries.", askWhy: "Why?", sourceCount: "0 sources · 0 personal records",
    goalTitle: "Goal simulator", goalSub: "Enter a target and monthly savings to compare arrival dates.", goalAmount: "Target amount", wonUnit: "KRW", manwonUnit: "10,000 KRW", monthlySave: "Monthly savings", arrive: "Estimated arrival", months: "months", makePlan: "Start this plan",
    spendingTitle: "Spending pattern", spendingSub: "Sorted for accurate comparison.", tableView: "View table",
    housing: "Housing & bills", food: "Food", transport: "Transport", shopping: "Shopping",
    safetyTitle: "Check a suspicious message before opening links or attachments, replying, or sending money", safetyLead: "Use explainable risk rules, plus malicious-URL reputation only when you choose it.", sampleMessage: "", analyze: "Analyze risk", analyzing: "Analyzing…", danger: "High-risk signals found", dangerLead: "Do not transfer money until you review these reasons.", risk1: "It uses a shortened, unofficial URL.", risk2: "It pressures you to transfer today.", risk3: "It uses tuition and exchange benefits as bait.", stopTransfer: "Stop transfer", call1332: "Call 1394 for phishing help", protectionSteps: "If you may be affected", step1: "Ask your bank to freeze the payment", step2: "Report to police at 112", step3: "Call 1394 for reporting, advice, and agency coordination",
    opportunityTitle: "Opportunities matched to you", opportunityLead: "Find youth savings, startup and settlement support with official sources.", opportunitySearch: "Find opportunities for me", matched: "Match", deadline: "Closes", startupFund: "Youth local creator startup grant", startupFundDesc: "Seoul · F&B/content · Pre-founder match", youthFund: "Youth Leap Account contribution", youthFundDesc: "Estimate public contribution by income band", settlePlan: "90-day Korea finance plan", settlePlanDesc: "Accounts · transfers · insurance · tax in your language", viewOriginal: "Open official source",
    roadTitle: "Settlement roadmap", day30: "Day 30", day60: "Day 60", day90: "Day 90", accountOpen: "Identity and bank account", transferSetup: "Remittance and autopay", taxInsurance: "Tax and insurance basics",
    marketTitle: "Market at a glance", marketCaution: "Learning information only, not investment advice. Date and source are always shown.",
    aiTitle: "A financial AI that shows sources first", aiLead: "See which data and evidence were used. Every action requires final review.", engine: "AI engine", privateLocal: "Local AI runs on BORA's server and is not sent to an external AI provider", askPlaceholder: "e.g. What official support information is available?", send: "Send question", thinking: "Checking evidence…", aiAnswer: "No personalized amount was calculated because there are 0 manually saved spending records.", aiSignIn: "Sign in from My Page with Naver or Kakao to use AI counseling.", evidence: "Evidence", dataUsed: "0 personal financial records used", modelAuto: "Auto", privacy: "Privacy", footer: "BORA supports informed decisions and does not replace a financial contract or professional advice.", menu: "Menu", close: "Close",
  },
  ja: {
    brandTag: "すべての人をつなぐAI金融パートナー", home: "ホーム", assets: "資産", safety: "安心", opportunity: "機会", ai: "AI相談", easyMode: "かんたんモード",
    greeting: "こんにちは", greetingSub: "自分で入力してアカウントに保存した値と公式情報だけを使用します。", updated: "アカウント台帳を利用可能", todayTitle: "確認項目", todaySub: "保存済み入力と未読情報は0件から始まります。", assetAction: "資産台帳を確認", assetDesc: "入力した値だけを計算し、同じアカウントなら別の端末でも続けられます。", safetyAction: "検査済みメッセージ0件", safetyDesc: "文章やURLを入力すると危険信号を分析します。", startupAction: "未読の創業情報0件", startupDesc: "公式APIで確認した情報だけを表示します。", startPlan: "貯蓄プラン作成", scanNow: "今すぐ分析", seeSupport: "情報を見る",
    netWorth: "純資産", safeStatus: "金融チェック", goalProgress: "緊急資金目標", safe: "未検査", good: "未設定", monthChange: "変動データ0件", blocked: "検査履歴0件", goalRemain: "目標0ウォン", trendTitle: "資産の推移", trendSub: "保存済み入力がなければ0で表示します。", cashflowTitle: "今月のキャッシュフロー", income: "収入", spending: "支出", saving: "貯蓄可能",
    aiBrief: "BORA AIブリーフ", aiBriefBody: "保存済み支出入力が0件のため、個別推薦は生成していません。", askWhy: "理由を見る", sourceCount: "根拠0件 · 個人データ0件", goalTitle: "目標シミュレーター", goalSub: "目標額と毎月の貯蓄額で到達時期を比較。", goalAmount: "目標額", wonUnit: "ウォン", manwonUnit: "万ウォン", monthlySave: "毎月の貯蓄", arrive: "予想到達", months: "か月", makePlan: "このプランで開始", spendingTitle: "支出パターン", spendingSub: "比較しやすい順に表示。", tableView: "表で見る",
    housing: "住居・公共料金", food: "食費", transport: "交通", shopping: "ショッピング",
    safetyTitle: "不審なメッセージは、リンクや添付ファイルを開く・返信する・送金する前に確認", safetyLead: "説明可能な危険ルールと、選択時のみ不正URL評価を確認します。", sampleMessage: "", analyze: "リスク分析", analyzing: "分析中…", danger: "危険性が高いです", dangerLead: "送金せず、根拠を確認してください。", risk1: "非公式の短縮URLです。", risk2: "本日中の送金を急がせています。", risk3: "学費と両替優遇を口実にしています。", stopTransfer: "送金を止める", call1332: "1394へ通報・相談", protectionSteps: "被害が疑われる場合", step1: "銀行に支払停止を依頼", step2: "112へ通報", step3: "1394で通報・相談と機関連携を依頼",
    opportunityTitle: "あなたに合う次の機会", opportunityLead: "若者向け資産形成・創業・韓国金融定着を公式資料から検索。", opportunitySearch: "自分に合う機会を探す", matched: "適合度", deadline: "締切", startupFund: "若者ローカルクリエイター支援", startupFundDesc: "ソウル · 飲食/コンテンツ · 創業前", youthFund: "青年跳躍口座の拠出案内", youthFundDesc: "所得区分による政府拠出を推定", settlePlan: "韓国金融定着90日プラン", settlePlanDesc: "口座・送金・保険・税金を選択言語で案内", viewOriginal: "公式原文", roadTitle: "定着ロードマップ", day30: "30日", day60: "60日", day90: "90日", accountOpen: "本人確認・口座開設", transferSetup: "海外送金・自動振替", taxInsurance: "税金・保険の理解", marketTitle: "今日の市場", marketCaution: "投資勧誘ではなく学習用情報です。基準日と出典を表示します。",
    aiTitle: "出典を先に示す金融AI", aiLead: "使用データと根拠を確認し、実行前には必ず最終確認します。", engine: "AIエンジン", privateLocal: "Local AIはBORAサーバーで処理し、外部AI事業者には送信しません", askPlaceholder: "例：利用できる公式支援情報は？", send: "質問する", thinking: "根拠を確認中…", aiAnswer: "手入力で保存した支出が0件のため、個別金額は計算していません。", aiSignIn: "AI相談を利用するには、マイページからNaverまたはKakaoでログインしてください。", evidence: "回答根拠", dataUsed: "使用した個人金融データ0件", modelAuto: "自動選択", privacy: "個人情報保護", footer: "BORAは意思決定を支援する情報サービスであり、投資や契約を代行しません。", menu: "メニュー", close: "閉じる",
  },
  zh: {
    brandTag: "连接每个人的AI金融伙伴", home: "首页", assets: "资产", safety: "安心", opportunity: "机会", ai: "AI顾问", easyMode: "简易模式",
    greeting: "您好", greetingSub: "仅使用您手动输入并保存到账户的数值以及官方信息。", updated: "可使用账户资产账本", todayTitle: "待确认项目", todaySub: "已保存输入和未读信息均从0条开始。", assetAction: "查看我的资产账本", assetDesc: "仅计算您输入的数值，同一登录账户可在其他设备继续使用。", safetyAction: "已检查消息0条", safetyDesc: "输入文字或URL后分析风险信号。", startupAction: "未读创业信息0条", startupDesc: "仅显示官方API确认的信息。", startPlan: "制定储蓄计划", scanNow: "立即分析", seeSupport: "查看信息",
    netWorth: "净资产", safeStatus: "金融检查", goalProgress: "应急资金目标", safe: "未检查", good: "未设置", monthChange: "变动数据0条", blocked: "检查记录0条", goalRemain: "目标0韩元", trendTitle: "资产趋势", trendSub: "没有已保存输入时显示为0。", cashflowTitle: "本月现金流", income: "收入", spending: "支出", saving: "可储蓄",
    aiBrief: "BORA AI简报", aiBriefBody: "已保存的消费输入为0条，因此未生成个性化建议。", askWhy: "为什么？", sourceCount: "依据0条 · 个人数据0条", goalTitle: "目标模拟器", goalSub: "输入目标金额和月储蓄额，比较完成时间。", goalAmount: "目标金额", wonUnit: "韩元", manwonUnit: "万韩元", monthlySave: "每月储蓄", arrive: "预计完成", months: "个月", makePlan: "按此计划开始", spendingTitle: "消费模式", spendingSub: "按易比较顺序排列。", tableView: "查看表格",
    housing: "住房·公共事业", food: "餐饮", transport: "交通", shopping: "购物",
    safetyTitle: "在打开链接或附件、回复或转账前检查可疑信息", safetyLead: "使用可解释的风险规则，并仅在您选择时查询恶意网址信誉。", sampleMessage: "", analyze: "分析风险", analyzing: "正在分析…", danger: "发现高风险信号", dangerLead: "请勿转账，先查看以下依据。", risk1: "使用非官方短网址。", risk2: "催促今天内转账。", risk3: "以学费和汇率优惠为诱饵。", stopTransfer: "停止转账", call1332: "拨打1394举报咨询", protectionSteps: "如怀疑受骗", step1: "联系银行申请止付", step2: "拨打112报警", step3: "拨打1394举报咨询并请求机构联动",
    opportunityTitle: "适合你的下一项机会", opportunityLead: "从官方来源查找青年储蓄、创业扶持和韩国金融安家信息。", opportunitySearch: "查找适合我的机会", matched: "匹配度", deadline: "截止", startupFund: "青年本地创作者创业扶持", startupFundDesc: "首尔 · 餐饮/内容 · 预备创业者", youthFund: "青年跃升账户补贴", youthFundDesc: "按收入区间估算政府补贴", settlePlan: "韩国金融安家90天计划", settlePlanDesc: "用你的语言说明账户、汇款、保险和税务", viewOriginal: "查看官方原文", roadTitle: "安家路线", day30: "30天", day60: "60天", day90: "90天", accountOpen: "实名认证·开设账户", transferSetup: "跨境汇款·自动扣款", taxInsurance: "了解税务·保险", marketTitle: "今日市场概览", marketCaution: "仅供学习，并非投资建议。始终标注日期和来源。",
    aiTitle: "先展示来源的金融AI", aiLead: "查看使用的数据与依据，任何执行都需最终确认。", engine: "AI引擎", privateLocal: "Local AI在BORA服务器处理，不会发送给外部AI提供商", askPlaceholder: "例如：有哪些官方扶持信息？", send: "发送问题", thinking: "正在核对依据…", aiAnswer: "手动保存的消费记录为0条，因此未计算个性化金额。", aiSignIn: "请先在我的页面使用Naver或Kakao登录，再使用AI咨询。", evidence: "回答依据", dataUsed: "使用的个人金融数据0条", modelAuto: "自动选择", privacy: "隐私保护", footer: "BORA提供决策信息，不代替投资建议或金融合同。", menu: "菜单", close: "关闭",
  },
};

const defaultHomeWidgets: HomeWidget[] = ["today", "summary", "exchange", "insights"];

const mascotCopy: Record<Locale, { name: string; message: string; alt: string; home: string }> = {
  ko: {
    name: "BORA 가이드 · 보리",
    message: "공식 근거부터 차근차근 같이 확인해요.",
    alt: "방패를 든 BORA 가이드 마스코트 보리",
    home: "BORA 홈으로 이동",
  },
  en: {
    name: "BORA guide · Bori",
    message: "Let’s start with official evidence.",
    alt: "Bori, the BORA guide mascot holding a shield",
    home: "Go to BORA home",
  },
  ja: {
    name: "BORAガイド・ボリ",
    message: "公式根拠から一緒に確認しましょう。",
    alt: "盾を持つBORAガイドのマスコット、ボリ",
    home: "BORAホームへ移動",
  },
  zh: {
    name: "BORA向导 · Bori",
    message: "让我们先从官方依据开始核对。",
    alt: "手持盾牌的BORA向导吉祥物Bori",
    home: "前往BORA首页",
  },
};

const homeExperienceCopy: Record<Locale, {
  eyebrow: string;
  title: string;
  signedOutLead: string;
  signedInLead: string;
  trustItems: [string, string, string];
}> = {
  ko: {
    eyebrow: "BORA ACTION HOME",
    title: "오늘 해야 할 금융 행동 하나부터",
    signedOutLead: "로그인하고 2분 금융 프로필을 만들면 내 상황에 맞는 자산·정책·안심 행동을 순서대로 안내합니다.",
    signedInLead: "저장된 금융 프로필과 공식 정보를 바탕으로 가장 중요한 다음 행동부터 안내합니다.",
    trustItems: ["공식 출처 우선", "직접 입력값만 계산", "실행 전 위험 확인"],
  },
  en: {
    eyebrow: "BORA ACTION HOME",
    title: "Start with one useful money action today",
    signedOutLead: "Sign in and build a two-minute money profile to receive ordered money, policy and safety actions.",
    signedInLead: "Your saved profile and official information are used to surface the most useful next action first.",
    trustItems: ["Official sources first", "Only your entries calculated", "Risk check before action"],
  },
  ja: {
    eyebrow: "BORA ACTION HOME",
    title: "今日必要な金融行動を一つずつ",
    signedOutLead: "ログインして2分の金融プロフィールを作ると、資産・政策・安心の行動を順番に案内します。",
    signedInLead: "保存済みプロフィールと公式情報から、最も重要な次の行動を先に案内します。",
    trustItems: ["公式出典を優先", "入力値だけを計算", "実行前にリスク確認"],
  },
  zh: {
    eyebrow: "BORA ACTION HOME",
    title: "从今天最重要的一项金融行动开始",
    signedOutLead: "登录并用2分钟建立金融资料，即可按顺序获得资产、政策与安全行动建议。",
    signedInLead: "根据已保存的金融资料和官方信息，优先提示最重要的下一步。",
    trustItems: ["官方来源优先", "仅计算手动输入", "行动前检查风险"],
  },
};

const accessibilityCopy: Record<Locale, {
  skip: string;
  primaryNav: string;
  mobileNav: string;
  language: string;
  openMenu: string;
  stateOn: string;
  stateOff: string;
  enableEasyMode: string;
  disableEasyMode: string;
}> = {
  ko: {
    skip: "본문으로 바로가기",
    primaryNav: "주요 메뉴",
    mobileNav: "모바일 주요 메뉴",
    language: "언어 선택",
    openMenu: "주요 메뉴 열기",
    stateOn: "켜짐",
    stateOff: "꺼짐",
    enableEasyMode: "쉬운 모드 켜기",
    disableEasyMode: "쉬운 모드 끄기",
  },
  en: {
    skip: "Skip to main content",
    primaryNav: "Primary navigation",
    mobileNav: "Mobile primary navigation",
    language: "Choose language",
    openMenu: "Open primary navigation",
    stateOn: "on",
    stateOff: "off",
    enableEasyMode: "Turn on Easy mode",
    disableEasyMode: "Turn off Easy mode",
  },
  ja: {
    skip: "本文へ移動",
    primaryNav: "メインメニュー",
    mobileNav: "モバイルメニュー",
    language: "言語を選択",
    openMenu: "メインメニューを開く",
    stateOn: "オン",
    stateOff: "オフ",
    enableEasyMode: "かんたんモードをオンにする",
    disableEasyMode: "かんたんモードをオフにする",
  },
  zh: {
    skip: "跳转到主要内容",
    primaryNav: "主菜单",
    mobileNav: "移动端主菜单",
    language: "选择语言",
    openMenu: "打开主菜单",
    stateOn: "已开启",
    stateOff: "已关闭",
    enableEasyMode: "开启简易模式",
    disableEasyMode: "关闭简易模式",
  },
};

const interactionCopy: Record<Locale, {
  dismissNotice: string;
  goalInputUnit: string;
  aiRemaining: (count: number) => string;
  goalPrompt: (goal: string, monthly: string) => string;
}> = {
  ko: {
    dismissNotice: "알림 닫기",
    goalInputUnit: "입력 단위",
    aiRemaining: (count) => `${count.toLocaleString("ko-KR")}자 남음`,
    goalPrompt: (goal, monthly) => `목표 ${goal}, 월 저축 ${monthly} 기준으로 공식 근거가 있는 계획을 설명해줘.`,
  },
  en: {
    dismissNotice: "Dismiss notification",
    goalInputUnit: "Input unit",
    aiRemaining: (count) => `${count.toLocaleString("en-US")} characters remaining`,
    goalPrompt: (goal, monthly) => `Explain an evidence-based plan for a ${goal} goal and ${monthly} in monthly savings.`,
  },
  ja: {
    dismissNotice: "通知を閉じる",
    goalInputUnit: "入力単位",
    aiRemaining: (count) => `残り${count.toLocaleString("ja-JP")}文字`,
    goalPrompt: (goal, monthly) => `目標${goal}、毎月${monthly}の貯蓄を前提に、公式根拠のある計画を説明してください。`,
  },
  zh: {
    dismissNotice: "关闭通知",
    goalInputUnit: "输入单位",
    aiRemaining: (count) => `还可输入${count.toLocaleString("zh-CN")}字`,
    goalPrompt: (goal, monthly) => `请根据目标${goal}、每月储蓄${monthly}，说明有官方依据的计划。`,
  },
};

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function isHomeWidget(value: unknown): value is HomeWidget {
  return typeof value === "string" && defaultHomeWidgets.includes(value as HomeWidget);
}

function isView(value: unknown): value is View {
  return typeof value === "string" && MAIN_VIEWS.includes(value as View);
}

function formatMoney(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTag[locale], { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function sessionUserFromResponse(session: SessionSnapshot): HomeSessionUser | null {
  if (!session.authenticated) return null;
  const provider = session.provider;
  if (provider !== "google" && provider !== "kakao" && provider !== "naver") return null;
  const email = typeof session.user?.email === "string" ? session.user.email.trim() : "";
  const displayName = typeof session.user?.displayName === "string"
    ? session.user.displayName.trim()
    : "";
  return {
    id: typeof session.user?.id === "string" ? session.user.id : `${provider}:${email}`,
    displayName: displayName || email || "BORA Member",
    email,
    provider,
    isDeveloper: session.isDeveloper === true,
  };
}

function sessionExpiryInstant(value: SessionSnapshot["expiresAt"]): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function HomePage({ initialView = "home" }: { initialView?: View }) {
  const pathname = usePathname();
  const [locale, setLocale] = useState<Locale>("ko");
  const activeView = viewFromPathname(pathname, initialView);
  const [easyMode, setEasyMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [monthlySave, setMonthlySave] = useState(0);
  const [goalAmount, setGoalAmount] = useState(0);
  const [goalAmountDraft, setGoalAmountDraft] = useState("");
  const [goalAmountUnit, setGoalAmountUnit] = useState<ManualMoneyUnit>("won");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiSessionTurns, setAiSessionTurns] = useState<AiSessionTurn[]>([]);
  const aiTurnSequenceRef = useRef(0);
  const aiRequestSequenceRef = useRef(0);
  const aiRequestAbortRef = useRef<AbortController | null>(null);
  const aiRequestTurnRef = useRef<number | null>(null);
  const aiTranscriptRef = useRef<HTMLDivElement>(null);
  const [aiAnalytics, setAiAnalytics] = useState<AiAnalytics | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFinanceInsightState, setAiFinanceInsightState] = useState<AiFinanceInsightState>({ status: "loading", snapshot: null });
  const [aiMemoryConsent, setAiMemoryConsent] = useState(false);
  const [aiConversationContextConsent, setAiConversationContextConsent] = useState(false);
  const [aiRecentActivityConsent, setAiRecentActivityConsent] = useState(false);
  const [aiConversationContextCount, setAiConversationContextCount] = useState(0);
  const [aiRecentActivityCount, setAiRecentActivityCount] = useState(0);
  const [aiContextPreferenceSaving, setAiContextPreferenceSaving] = useState(false);
  const [aiContextPreferenceNotice, setAiContextPreferenceNotice] = useState("");
  const [memoryDeleting, setMemoryDeleting] = useState(false);
  const [phishingText, setPhishingText] = useState("");
  const [phishingResult, setPhishingResult] = useState<PhishingResult | null>(null);
  const [phishingLoading, setPhishingLoading] = useState(false);
  const [phishingExposures, setPhishingExposures] = useState<PhishingExposure[]>([]);
  const [phishingReputationConsent, setPhishingReputationConsent] = useState(false);
  const [phishingClipboardConsent, setPhishingClipboardConsent] = useState(false);
  const [phishingClipboardReading, setPhishingClipboardReading] = useState(false);
  const [phishingError, setPhishingError] = useState("");
  const [phishingInputNotice, setPhishingInputNotice] = useState("");
  const phishingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const phishingClipboardRequestRef = useRef(0);
  const phishingAnalysisRequestRef = useRef(0);
  const phishingAnalysisAbortRef = useRef<AbortController | null>(null);
  const [homeWidgetOrder, setHomeWidgetOrder] = useState<HomeWidget[]>(defaultHomeWidgets);
  const [hiddenHomeWidgets, setHiddenHomeWidgets] = useState<HomeWidget[]>([]);
  const [currentUser, setCurrentUser] = useState<HomeSessionUser | null>(null);
  const [sessionState, setSessionState] = useState<"checking" | "signed-in" | "signed-out" | "unavailable">("checking");
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionSnapshot | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const sessionRequestSequenceRef = useRef(0);
  const sessionRequestAbortRef = useRef<AbortController | null>(null);
  const principalGenerationRef = useRef(0);
  const principalUserIdRef = useRef<string | null>(null);
  const [accountDialogRequest, setAccountDialogRequest] = useState(0);
  const [layoutDialogRequest, setLayoutDialogRequest] = useState(0);
  const sidebarAccountButtonRef = useRef<HTMLButtonElement>(null);
  const accountDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [recentViews, setRecentViews] = useState<View[]>([]);
  const [quickLogoutPending, setQuickLogoutPending] = useState(false);
  const [quickLogoutError, setQuickLogoutError] = useState(false);
  const [currentLocalHour, setCurrentLocalHour] = useState<number | null>(null);
  const [authNotice, setAuthNotice] = useState<"success" | "cancelled" | "failed" | null>(() => {
    if (typeof window === "undefined") return null;
    const auth = new URLSearchParams(window.location.search).get("auth");
    return auth === "success" || auth === "cancelled" || auth === "failed" ? auth : null;
  });
  const t = copy[locale];
  const aiT = aiInsightsCopy[locale];
  const securityT = securityCopy[locale];
  const shellT = shellCopy[locale];
  const mascotT = mascotCopy[locale];
  const homeT = homeExperienceCopy[locale];
  const a11yT = accessibilityCopy[locale];
  const interactionT = interactionCopy[locale];

  const synchronizePrincipal = useCallback((user: HomeSessionUser | null, nextState?: "signed-in" | "signed-out" | "unavailable") => {
    const nextUserId = user?.id ?? null;
    if (principalUserIdRef.current !== nextUserId) {
      principalGenerationRef.current += 1;
      principalUserIdRef.current = nextUserId;
      aiRequestSequenceRef.current += 1;
      aiRequestAbortRef.current?.abort();
      aiRequestAbortRef.current = null;
      aiRequestTurnRef.current = null;
      setAiLoading(false);
      setAiSessionTurns([]);
      setAiAnalytics(null);
      setAiFinanceInsightState({ status: nextUserId ? "loading" : "empty", snapshot: null });
      setAiMemoryConsent(false);
      setAiConversationContextConsent(false);
      setAiRecentActivityConsent(false);
      setAiConversationContextCount(0);
      setAiRecentActivityCount(0);
      setAiContextPreferenceSaving(false);
      setAiContextPreferenceNotice("");
      setMemoryDeleting(false);
      setRecentActivityClientConsent(nextUserId ? null : false);
    }
    setCurrentUser(user);
    setSessionState(nextState ?? (user ? "signed-in" : "signed-out"));
  }, []);

  const clearExpiredHomePrincipal = useCallback(() => {
    // The expiry timestamp comes from the authenticated server-side session.
    // Clear every principal-bound view before any later network revalidation so
    // a shared screen cannot retain the previous member's profile or finance
    // summary for even one React render after the deadline.
    sessionRequestSequenceRef.current += 1;
    sessionRequestAbortRef.current?.abort();
    sessionRequestAbortRef.current = null;
    setSessionSnapshot((current) => current ? {
      ...current,
      authenticated: false,
      expiresAt: null,
      provider: undefined,
      user: undefined,
    } : current);
    setSessionUnavailable(false);
    synchronizePrincipal(null, "signed-out");
  }, [synchronizePrincipal]);

  const principalMatches = useCallback((generation: number, userId: string) => {
    return principalRequestMatches(
      principalGenerationRef.current,
      principalUserIdRef.current,
      generation,
      userId,
    );
  }, []);

  useEffect(() => () => {
    aiRequestSequenceRef.current += 1;
    aiRequestAbortRef.current?.abort();
    aiRequestAbortRef.current = null;
    aiRequestTurnRef.current = null;
  }, []);

  const refreshHomeSession = useCallback(() => {
    const requestId = sessionRequestSequenceRef.current + 1;
    sessionRequestSequenceRef.current = requestId;
    sessionRequestAbortRef.current?.abort();
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, HOME_SESSION_REQUEST_TIMEOUT_MS);
    sessionRequestAbortRef.current = controller;
    window.queueMicrotask(() => {
      if (controller.signal.aborted || requestId !== sessionRequestSequenceRef.current) return;
      setSessionUnavailable(false);
      if (!principalUserIdRef.current) setSessionState("checking");
    });
    void (async () => {
      try {
        const response = await fetch("/api/session", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if ((controller.signal.aborted && !timedOut) || requestId !== sessionRequestSequenceRef.current) return;
        if (timedOut || !response.ok) throw new Error(timedOut ? "session_timeout" : "session_unavailable");
        const session = await response.json() as SessionSnapshot;
        if ((controller.signal.aborted && !timedOut) || requestId !== sessionRequestSequenceRef.current) return;
        if (timedOut) throw new Error("session_timeout");
        setSessionSnapshot(session);
        const user = sessionUserFromResponse(session);
        synchronizePrincipal(user);
        if (!user) {
          setAiMemoryConsent(false);
          setAiConversationContextConsent(false);
          setAiRecentActivityConsent(false);
          return;
        }
      } catch {
        if ((controller.signal.aborted && !timedOut) || requestId !== sessionRequestSequenceRef.current) return;
        setSessionUnavailable(true);
        if (!principalUserIdRef.current) setSessionState("unavailable");
      } finally {
        window.clearTimeout(timeoutId);
        if (requestId === sessionRequestSequenceRef.current) sessionRequestAbortRef.current = null;
      }
    })();
  }, [synchronizePrincipal]);

  useEffect(() => {
    refreshHomeSession();
    return () => {
      sessionRequestSequenceRef.current += 1;
      sessionRequestAbortRef.current?.abort();
      sessionRequestAbortRef.current = null;
    };
  }, [refreshHomeSession]);

  useEffect(() => {
    const revalidate = () => refreshHomeSession();
    const revalidateWhenVisible = () => {
      if (document.visibilityState === "visible") refreshHomeSession();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidateWhenVisible);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidateWhenVisible);
    };
  }, [refreshHomeSession]);

  useEffect(() => {
    if (!currentUser?.id) return;
    const expiresAt = sessionExpiryInstant(sessionSnapshot?.expiresAt);
    if (!expiresAt) return;
    let timeoutId = 0;
    const expireAtDeadline = () => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        timeoutId = window.setTimeout(expireAtDeadline, Math.min(remaining, 2_147_483_647));
        return;
      }
      clearExpiredHomePrincipal();
    };
    expireAtDeadline();
    return () => window.clearTimeout(timeoutId);
  }, [clearExpiredHomePrincipal, currentUser?.id, sessionSnapshot?.expiresAt]);

  useEffect(() => {
    if (!currentUser?.id) {
      setRecentActivityClientConsent(false);
      return;
    }
    setRecentActivityClientConsent(null);
    const userId = currentUser.id;
    const principalGeneration = principalGenerationRef.current;
    const controller = new AbortController();
    fetchWithClientTimeout("/api/ai/context", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("ai_context_preferences_unavailable");
      return await response.json() as AiContextPreferenceResponse;
    }).then((result) => {
      if (!principalMatches(principalGeneration, userId)) return;
      setAiMemoryConsent(result.preferences.memoryEnabled === true);
      setAiConversationContextConsent(result.preferences.conversationContextEnabled === true);
      setAiRecentActivityConsent(result.preferences.recentActivityEnabled === true);
      setRecentActivityClientConsent(result.preferences.recentActivityEnabled === true);
      setAiConversationContextCount(result.inventory?.conversations ?? 0);
      setAiRecentActivityCount(result.inventory?.activities ?? 0);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError") && principalMatches(principalGeneration, userId)) {
        setAiMemoryConsent(false);
        setAiConversationContextConsent(false);
        setAiRecentActivityConsent(false);
        setRecentActivityClientConsent(false);
      }
    });
    return () => controller.abort();
  }, [currentUser?.id, principalMatches]);

  const topicChartData = useMemo(() => {
    const topics = (aiAnalytics?.topicStats ?? []).filter((item) => item.count > 0);
    const total = topics.reduce((sum, item) => sum + item.count, 0);
    return topics.map((item) => ({
      ...item,
      name: topicLabels[locale][item.topic],
      color: topicColors[item.topic],
      sharePercent: total > 0 ? (item.count / total) * 100 : 0,
    }));
  }, [aiAnalytics?.topicStats, locale]);
  useEffect(() => {
    const savedLocale = window.localStorage.getItem("bora-locale") as Locale | null;
    const savedEasyMode = window.localStorage.getItem("bora-easy") === "true";
    const savedHomeLayout = window.localStorage.getItem("bora-home-layout-v1");
    const savedRecentViews = window.localStorage.getItem(RECENT_FEATURES_KEY);
    const timer = window.setTimeout(() => {
      if (savedLocale && copy[savedLocale]) {
        setLocale(savedLocale);
        setPhishingText("");
      }
      setEasyMode(savedEasyMode);
      if (savedHomeLayout) {
        try {
          const parsed = JSON.parse(savedHomeLayout) as { order?: unknown[]; hidden?: unknown[] };
          const savedOrder = parsed.order?.filter(isHomeWidget) ?? [];
          const savedHidden = parsed.hidden?.filter(isHomeWidget) ?? [];
          if (savedOrder.length) {
            setHomeWidgetOrder([...savedOrder, ...defaultHomeWidgets.filter((widget) => !savedOrder.includes(widget))]);
          }
          setHiddenHomeWidgets(savedHidden);
        } catch {
          window.localStorage.removeItem("bora-home-layout-v1");
        }
      }
      if (savedRecentViews) {
        try {
          const parsed = JSON.parse(savedRecentViews) as unknown;
          if (Array.isArray(parsed)) {
            setRecentViews(parsed.filter(isView).filter((view) => view !== "home").slice(0, 3));
          }
        } catch {
          window.localStorage.removeItem(RECENT_FEATURES_KEY);
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : locale;
  }, [locale]);

  useEffect(() => {
    if (!menuOpen) return;

    const sidebar = sidebarRef.current;
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (!sidebar) return;

    const focusable = Array.from(
      sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const menuTrigger = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;

    workspace?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => first?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    sidebar.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      sidebar.removeEventListener("keydown", handleKeyDown);
      workspace?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      menuTrigger?.focus();
    };
  }, [menuOpen]);

  useEffect(() => {
    const updateLocalHour = () => setCurrentLocalHour(new Date().getHours());
    updateLocalHour();
    const timer = window.setInterval(updateLocalHour, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeView !== "ai") return;
    if (!currentUser?.id) return;
    const userId = currentUser.id;
    const principalGeneration = principalGenerationRef.current;
    const controller = new AbortController();
    fetchWithClientTimeout("/api/ai/history", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI history unavailable");
        return await response.json() as AiAnalytics;
      })
      .then((analytics) => { if (principalMatches(principalGeneration, userId)) setAiAnalytics(analytics); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [activeView, currentUser, principalMatches]);

  useEffect(() => {
    if (activeView !== "ai") return;
    if (!currentUser?.id) {
      const reset = window.setTimeout(() => {
        setAiFinanceInsightState({ status: "empty", snapshot: null });
      }, 0);
      return () => window.clearTimeout(reset);
    }
    const controller = new AbortController();
    const userId = currentUser.id;
    const principalGeneration = principalGenerationRef.current;
    const markLoading = window.setTimeout(() => {
      if (!controller.signal.aborted && principalMatches(principalGeneration, userId)) {
        setAiFinanceInsightState({ status: "loading", snapshot: null });
      }
    }, 0);
    fetchWithClientTimeout("/api/finance/snapshot", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Finance snapshot unavailable");
      return await response.json() as { snapshot?: ManualFinanceSnapshot | null };
    }).then((result) => {
      window.clearTimeout(markLoading);
      if (!principalMatches(principalGeneration, userId)) return;
      setAiFinanceInsightState(result.snapshot
        ? { status: "ready", snapshot: result.snapshot }
        : { status: "empty", snapshot: null });
    }).catch((error: unknown) => {
      window.clearTimeout(markLoading);
      if (!(error instanceof DOMException && error.name === "AbortError") && principalMatches(principalGeneration, userId)) {
        setAiFinanceInsightState({ status: "unavailable", snapshot: null });
      }
    });
    return () => {
      window.clearTimeout(markLoading);
      controller.abort();
    };
  }, [activeView, currentUser?.id, principalMatches]);

  useEffect(() => {
    if (activeView !== "ai" || aiSessionTurns.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const transcript = aiTranscriptRef.current;
      transcript?.scrollTo({ top: transcript.scrollHeight, behavior: preferredScrollBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, aiSessionTurns]);

  const aiFinanceSummary = useMemo(() => aiFinanceInsightState.status === "ready"
    ? manualFinanceSummary(aiFinanceInsightState.snapshot.amounts)
    : null, [aiFinanceInsightState]);
  const hasAiFinanceInsights = Boolean(aiFinanceSummary
    && (aiFinanceSummary.amounts.monthlyIncome > 0 || aiFinanceSummary.monthlyOutflow > 0));

  function changeGoalAmountInput(value: string) {
    const normalized = normalizeManualMoneyInput(value, goalAmountUnit);
    const canonicalWon = canonicalWonFromMoneyInput(normalized, goalAmountUnit);
    setGoalAmountDraft(normalized);
    setGoalAmount(Math.max(0, Number(canonicalWon) || 0));
  }

  function changeGoalAmountUnit(nextUnit: ManualMoneyUnit) {
    setGoalAmountUnit(nextUnit);
    setGoalAmountDraft(goalAmount > 0 ? formatCanonicalWonInput(goalAmount, nextUnit) : "");
  }

  const goalMonths = monthlySave > 0 && goalAmount > 0 ? Math.ceil(goalAmount / monthlySave) : 0;
  const goalDate = useMemo(() => {
    if (goalMonths === 0) return "—";
    const date = new Date();
    date.setMonth(date.getMonth() + goalMonths);
    return new Intl.DateTimeFormat(localeTag[locale], { year: "numeric", month: "long" }).format(date);
  }, [goalMonths, locale]);

  const nav = [
    { id: "home" as View, label: t.home, icon: Home },
    { id: "assets" as View, label: t.assets, icon: WalletCards },
    { id: "safety" as View, label: t.safety, icon: ShieldCheck },
    { id: "opportunity" as View, label: t.opportunity, icon: Sparkles },
    { id: "ai" as View, label: t.ai, icon: Bot },
  ];
  const personalizedGreeting = personalizedLocalGreeting(
    locale,
    currentLocalHour,
    currentUser?.displayName,
  );

  function rememberRecentView(view: View) {
    if (currentUser) void recordRecentActivity({ activityType: "menu", targetCode: view });
    if (view === "home") return;
    setRecentViews((current) => {
      const next = [view, ...current.filter((item) => item !== view)].slice(0, 3);
      window.localStorage.setItem(RECENT_FEATURES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function openSidebarAccountDialog() {
    accountDialogTriggerRef.current = window.matchMedia("(max-width: 900px)").matches
      ? menuButtonRef.current
      : sidebarAccountButtonRef.current;
    setMenuOpen(false);
    setAccountDialogRequest((request) => request + 1);
  }

  function changeView(view: View) {
    setMenuOpen(false);
    rememberRecentView(view);
    const targetPath = VIEW_PATHS[view];
    if (window.location.pathname !== targetPath) {
      window.location.assign(targetPath);
      return;
    }
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
  }

  async function quickSignOut() {
    if (quickLogoutPending) return;
    setQuickLogoutPending(true);
    setQuickLogoutError(false);
    try {
      const { response, data } = await fetchAuthJson<unknown>("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!localLogoutCompleted(response, data)) throw new Error("Logout failed");
      setSessionSnapshot((current) => current ? { ...current, authenticated: false, expiresAt: null, provider: undefined, user: undefined } : current);
      synchronizePrincipal(null);
      window.location.assign("/");
    } catch {
      setQuickLogoutError(true);
      setQuickLogoutPending(false);
    }
  }

  function navigateMission(target: string) {
    if (["home", "assets", "safety", "opportunity", "ai"].includes(target)) {
      changeView(target as View);
      return;
    }
    if (target.startsWith("/")) window.location.assign(target);
  }

  function changeLocale(nextLocale: Locale) {
    invalidatePhishingAnalysis();
    setLocale(nextLocale);
    setPhishingText("");
    setPhishingResult(null);
    setPhishingExposures([]);
    setPhishingReputationConsent(false);
    setPhishingClipboardConsent(false);
    phishingClipboardRequestRef.current += 1;
    setPhishingClipboardReading(false);
    setPhishingError("");
    setPhishingInputNotice("");
    window.localStorage.setItem("bora-locale", nextLocale);
    window.dispatchEvent(new Event("bora-locale-change"));
  }

  function toggleEasyMode() {
    const nextEasyMode = !easyMode;
    setEasyMode(nextEasyMode);
    window.localStorage.setItem("bora-easy", String(nextEasyMode));
  }

  function saveHomeLayout(order: HomeWidget[], hidden: HomeWidget[]) {
    window.localStorage.setItem("bora-home-layout-v1", JSON.stringify({ order, hidden }));
  }

  function changeHomeWidgetOrder(nextOrder: string[]) {
    const safeOrder = nextOrder.filter(isHomeWidget);
    const completeOrder = [...safeOrder, ...defaultHomeWidgets.filter((widget) => !safeOrder.includes(widget))];
    setHomeWidgetOrder(completeOrder);
    saveHomeLayout(completeOrder, hiddenHomeWidgets);
  }

  function changeHiddenHomeWidgets(nextHidden: string[]) {
    const safeHidden = nextHidden.filter(isHomeWidget);
    setHiddenHomeWidgets(safeHidden);
    saveHomeLayout(homeWidgetOrder, safeHidden);
  }

  function resetHomeLayout() {
    setHomeWidgetOrder(defaultHomeWidgets);
    setHiddenHomeWidgets([]);
    saveHomeLayout(defaultHomeWidgets, []);
  }

  function widgetOrder(widget: HomeWidget) {
    const index = homeWidgetOrder.indexOf(widget);
    return index < 0 ? 99 : index;
  }

  async function analyzePhishing() {
    if (phishingLoading || phishingClipboardReading || !phishingText.trim()) return;
    phishingClipboardRequestRef.current += 1;
    setPhishingClipboardReading(false);
    setPhishingClipboardConsent(false);
    const requestId = phishingAnalysisRequestRef.current + 1;
    phishingAnalysisRequestRef.current = requestId;
    phishingAnalysisAbortRef.current?.abort();
    const controller = new AbortController();
    phishingAnalysisAbortRef.current = controller;
    const submittedText = phishingText;
    const submittedLocale = locale;
    const submittedExposures = [...phishingExposures];
    const submittedReputationConsent = phishingReputationConsent;
    setPhishingLoading(true);
    setPhishingResult(null);
    setPhishingError("");
    setPhishingInputNotice("");
    try {
      const response = await fetch("/api/phishing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: submittedText,
          locale: submittedLocale,
          exposures: submittedExposures,
          reputationConsent: submittedReputationConsent,
        }),
        signal: controller.signal,
      });
      if (requestId !== phishingAnalysisRequestRef.current) return;
      if (!response.ok) {
        setPhishingError(response.status === 429
          ? securityT.rateLimited
          : response.status === 413
            ? securityT.tooLarge
            : securityT.analysisFailed);
        return;
      }
      const data = (await response.json()) as PhishingResult;
      if (requestId !== phishingAnalysisRequestRef.current) return;
      setPhishingResult(data);
      setPhishingText("");
      setPhishingExposures([]);
      setPhishingReputationConsent(false);
      setPhishingClipboardConsent(false);
      phishingClipboardRequestRef.current += 1;
      setPhishingClipboardReading(false);
    } catch {
      if (controller.signal.aborted || requestId !== phishingAnalysisRequestRef.current) return;
      setPhishingResult(null);
      setPhishingError(securityT.analysisFailed);
    } finally {
      if (requestId === phishingAnalysisRequestRef.current) {
        phishingAnalysisAbortRef.current = null;
        setPhishingLoading(false);
      }
    }
  }

  function invalidatePhishingAnalysis() {
    phishingAnalysisRequestRef.current += 1;
    phishingAnalysisAbortRef.current?.abort();
    phishingAnalysisAbortRef.current = null;
    setPhishingLoading(false);
  }

  function togglePhishingExposure(exposure: PhishingExposure) {
    invalidatePhishingAnalysis();
    setPhishingResult(null);
    setPhishingError("");
    setPhishingExposures((current) => current.includes(exposure)
      ? current.filter((item) => item !== exposure)
      : [...current, exposure]);
  }

  async function pastePhishingFromClipboard() {
    if (phishingClipboardReading) return;
    invalidatePhishingAnalysis();
    setPhishingResult(null);
    setPhishingError("");
    setPhishingInputNotice("");
    if (!phishingClipboardConsent) {
      setPhishingError(securityT.clipboardConsentRequired);
      return;
    }
    const requestId = phishingClipboardRequestRef.current + 1;
    phishingClipboardRequestRef.current = requestId;
    setPhishingClipboardConsent(false);
    setPhishingClipboardReading(true);
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.readText) throw new Error("clipboard_unavailable");
      const clipboardText = await clipboard.readText();
      if (requestId !== phishingClipboardRequestRef.current) return;
      if (!clipboardText.trim()) {
        setPhishingError(securityT.clipboardEmpty);
        phishingTextareaRef.current?.focus();
        return;
      }
      if (clipboardText.length > 20_000) {
        setPhishingError(securityT.tooLarge);
        phishingTextareaRef.current?.focus();
        return;
      }
      invalidatePhishingAnalysis();
      setPhishingText(clipboardText);
      setPhishingExposures([]);
      setPhishingReputationConsent(false);
      setPhishingInputNotice(securityT.clipboardLoaded);
      window.requestAnimationFrame(() => phishingTextareaRef.current?.focus());
    } catch {
      if (requestId === phishingClipboardRequestRef.current) {
        setPhishingError(securityT.clipboardUnavailable);
        phishingTextareaRef.current?.focus();
      }
    } finally {
      if (requestId === phishingClipboardRequestRef.current) {
        setPhishingClipboardReading(false);
      }
    }
  }

  function clearPhishingInput() {
    invalidatePhishingAnalysis();
    setPhishingText("");
    setPhishingResult(null);
    setPhishingError("");
    setPhishingExposures([]);
    setPhishingReputationConsent(false);
    setPhishingClipboardConsent(false);
    phishingClipboardRequestRef.current += 1;
    setPhishingClipboardReading(false);
    setPhishingInputNotice(securityT.inputCleared);
    phishingTextareaRef.current?.focus();
  }

  async function askAi(event: FormEvent) {
    event.preventDefault();
    await submitAiQuestion(aiQuestion);
  }

  async function submitAiQuestion(question: string, retryTurnId?: number) {
    const submittedQuestion = question.trim();
    if (!submittedQuestion || aiLoading) return;
    const turnId = retryTurnId ?? ++aiTurnSequenceRef.current;
    if (retryTurnId) {
      setAiSessionTurns((turns) => turns.map((turn) => turn.id === retryTurnId
        ? { ...turn, answer: "", status: "pending", meta: null, sources: [] }
        : turn));
    } else {
      const pendingTurn: AiSessionTurn = {
        id: turnId,
        question: submittedQuestion,
        answer: "",
        status: "pending",
        meta: null,
        sources: [],
      };
      setAiSessionTurns((turns) => [...turns, pendingTurn].slice(-AI_SESSION_TURN_LIMIT));
    }
    setAiQuestion("");
    if (!currentUser) {
      setAiSessionTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, question: "", answer: t.aiSignIn, status: "sign-in", meta: { mode: "sign-in" } }
        : turn));
      return;
    }
    const requestingUserId = currentUser.id;
    const principalGeneration = principalGenerationRef.current;
    const priorConversationMessages = aiSessionContextMessages(aiSessionTurns, aiConversationContextConsent, turnId);
    const requestId = aiRequestSequenceRef.current + 1;
    aiRequestSequenceRef.current = requestId;
    const supersededTurnId = aiRequestTurnRef.current;
    aiRequestAbortRef.current?.abort();
    if (supersededTurnId !== null && supersededTurnId !== turnId) {
      setAiSessionTurns((turns) => turns.map((turn) => turn.id === supersededTurnId && turn.status === "pending"
        ? { ...turn, answer: aiTrustCopy[locale].unavailableLead, status: "error", meta: { mode: "unavailable" }, sources: [] }
        : turn));
    }
    const controller = new AbortController();
    aiRequestAbortRef.current = controller;
    aiRequestTurnRef.current = turnId;
    setAiLoading(true);
    try {
      const response = await fetchWithClientTimeout("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({
          message: submittedQuestion,
          locale,
          memoryConsent: aiMemoryConsent,
          conversationContextConsent: aiConversationContextConsent,
          recentActivityConsent: aiRecentActivityConsent,
          ...(aiConversationContextConsent && priorConversationMessages.length
            ? { messages: priorConversationMessages }
            : {}),
        }),
      }, AI_REQUEST_TIMEOUT_MS);
      const data = (await response.json()) as {
        answer?: string;
        sources?: AiSource[];
        error?: string;
        provider?: string;
        demo?: boolean;
        demoReason?: "missing_credentials" | "missing_endpoint" | "provider_error";
        providerError?: unknown;
        answerMode?: "model" | "safe-demo" | "provider-fallback" | "rules" | "product-guide";
        contextMode?: AiContextMode;
        warning?: string;
        memoryStored?: boolean;
        memoryApplied?: number;
        conversationContextStored?: boolean;
        conversationContextApplied?: number;
        recentActivityApplied?: number;
        retrieval?: AiReplyMeta["retrieval"];
        grounding?: AiReplyMeta["grounding"];
      };
      if (controller.signal.aborted || requestId !== aiRequestSequenceRef.current
        || !principalMatches(principalGeneration, requestingUserId)) return;
      if (!response.ok) {
        if (data.error === "authentication_required") {
          synchronizePrincipal(null);
          setAiSessionTurns([{
            id: turnId,
            question: "",
            answer: t.aiSignIn,
            status: "sign-in",
            meta: { mode: "sign-in" },
            sources: [],
          }]);
          return;
        }
        if (data.error === "required_consent_missing") {
          setAiSessionTurns((turns) => turns.map((turn) => turn.id === turnId
            ? { ...turn, answer: aiTrustCopy[locale].consentRequiredLead, status: "complete", meta: { mode: "consent-required" }, sources: [] }
            : turn));
          return;
        }
        if (data.error === "official_legal_basis_not_configured"
          || data.error === "official_legal_basis_unavailable") {
          setAiSessionTurns((turns) => turns.map((turn) => turn.id === turnId
            ? { ...turn, answer: legalAiUnavailableCopy[locale], status: "error", meta: { mode: "legal-unavailable" }, sources: [] }
            : turn));
          return;
        }
        throw new Error("AI unavailable");
      }
      const responseMode: AiReplyMeta["mode"] = data.answerMode
        ?? (data.demo
          ? data.demoReason === "provider_error" ? "provider-fallback" : "safe-demo"
          : "model");
      const replyMeta: AiReplyMeta = {
        providerError: data.providerError === "model_warming" || data.providerError === "local_inference_busy" || data.providerError === "local_inference_timeout" ? data.providerError : null,
        mode: responseMode,
        contextMode: data.contextMode,
        provider: data.provider,
        warning: data.warning,
        memoryStored: data.memoryStored,
        memoryApplied: data.memoryApplied,
        conversationContextApplied: data.conversationContextApplied,
        recentActivityApplied: data.recentActivityApplied,
        retrieval: data.retrieval,
        grounding: data.grounding,
      };
      const answer = data.answer || t.aiAnswer;
      const sources = citedSafeSources(data.sources, answer);
      setAiSessionTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, answer, status: "complete", meta: replyMeta, sources }
        : turn));
      if (data.conversationContextStored) {
        setAiConversationContextCount((count) => Math.min(6, count + 1));
      }
      if (data.answerMode !== "product-guide") {
        fetchWithClientTimeout("/api/ai/history", { cache: "no-store", credentials: "same-origin" })
          .then(async (historyResponse) => historyResponse.ok ? await historyResponse.json() as AiAnalytics : null)
          .then((analytics) => {
            if (analytics && principalMatches(principalGeneration, requestingUserId)) setAiAnalytics(analytics);
          })
          .catch(() => undefined);
      }
    } catch {
      if (controller.signal.aborted || requestId !== aiRequestSequenceRef.current
        || !principalMatches(principalGeneration, requestingUserId)) return;
      setAiSessionTurns((turns) => turns.map((turn) => turn.id === turnId
        ? { ...turn, answer: aiTrustCopy[locale].unavailableLead, status: "error", meta: { mode: "unavailable" }, sources: [] }
        : turn));
    } finally {
      if (requestId === aiRequestSequenceRef.current
        && principalMatches(principalGeneration, requestingUserId)) {
        aiRequestAbortRef.current = null;
        aiRequestTurnRef.current = null;
        setAiLoading(false);
      }
    }
  }

  function retryAiTurn(turn: AiSessionTurn) {
    void submitAiQuestion(turn.question, turn.id);
  }

  async function updateAiContextPreferences(update: Record<string, boolean>) {
    if (!currentUser?.id || aiContextPreferenceSaving) return false;
    const userId = currentUser.id;
    const principalGeneration = principalGenerationRef.current;
    setAiContextPreferenceSaving(true);
    setAiContextPreferenceNotice(contextConsentCopy[locale].saving);
    try {
      const response = await fetchWithClientTimeout("/api/ai/context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error("ai_context_preferences_unavailable");
      const result = await response.json() as AiContextPreferenceResponse;
      if (!principalMatches(principalGeneration, userId)) return false;
      setAiMemoryConsent(result.preferences.memoryEnabled === true);
      setAiConversationContextConsent(result.preferences.conversationContextEnabled === true);
      setAiRecentActivityConsent(result.preferences.recentActivityEnabled === true);
      setRecentActivityClientConsent(result.preferences.recentActivityEnabled === true);
      if (update.clearConversationContext) setAiConversationContextCount(0);
      if (update.clearRecentActivity) setAiRecentActivityCount(0);
      setAiContextPreferenceNotice(contextConsentCopy[locale].saved);
      return true;
    } catch {
      if (principalMatches(principalGeneration, userId)) {
        setAiContextPreferenceNotice(contextConsentCopy[locale].saveFailed);
      }
      return false;
    } finally {
      if (principalMatches(principalGeneration, userId)) setAiContextPreferenceSaving(false);
    }
  }

  function toggleAiMemoryConsent() {
    void updateAiContextPreferences({ memoryEnabled: !aiMemoryConsent });
  }

  function toggleAiConversationContextConsent() {
    void updateAiContextPreferences({
      conversationContextEnabled: !aiConversationContextConsent,
    });
  }

  function toggleAiRecentActivityConsent() {
    void updateAiContextPreferences({ recentActivityEnabled: !aiRecentActivityConsent });
  }

  function clearAiConversationContext() {
    if (!window.confirm(contextConsentCopy[locale].clearConversationConfirm)) return;
    void updateAiContextPreferences({ clearConversationContext: true });
  }

  function clearAiRecentActivity() {
    if (!window.confirm(contextConsentCopy[locale].clearActivityConfirm)) return;
    void updateAiContextPreferences({ clearRecentActivity: true });
  }

  async function deleteAiMemory(memoryId?: string) {
    if (!memoryId && !window.confirm(memoryCopy[locale].confirmClear)) return;
    if (!currentUser?.id) return;
    const userId = currentUser.id;
    const principalGeneration = principalGenerationRef.current;
    setMemoryDeleting(true);
    try {
      const response = await fetchWithClientTimeout("/api/ai/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(memoryId ? { memoryId } : { deleteAllMemories: true }),
      });
      if (!response.ok) throw new Error("AI memory delete failed");
      const historyResponse = await fetchWithClientTimeout("/api/ai/history", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (historyResponse.ok) {
        const analytics = await historyResponse.json() as AiAnalytics;
        if (principalMatches(principalGeneration, userId)) setAiAnalytics(analytics);
      }
    } catch {
      // Keep the current list visible if the server could not confirm deletion.
    } finally {
      if (principalMatches(principalGeneration, userId)) setMemoryDeleting(false);
    }
  }

  const sessionT = aiSessionCopy[locale];
  const trustT = aiTrustCopy[locale];
  const evidenceT = aiEvidenceCopy[locale];
  function aiTurnPresentation(meta: AiReplyMeta | null) {
    const answerLabel = meta
      ? {
        model: trustT.model,
        "safe-demo": trustT.safeDemo,
        "provider-fallback": trustT.providerFallback,
        rules: trustT.rules,
        unavailable: trustT.unavailable,
        "sign-in": trustT.signIn,
        "consent-required": trustT.consentRequired,
        "legal-unavailable": trustT.legalUnavailable,
        "product-guide": trustT.productGuide,
      }[meta.mode]
      : "BORA AI";
    const providerLabel = meta?.mode === "model" && meta.provider
      ? meta.provider === "local"
        ? "Local AI"
        : meta.provider === "openai"
          ? "OpenAI"
          : meta.provider === "gemini"
            ? "Gemini"
            : meta.provider === "claude"
              ? "Claude"
              : "AI"
      : null;
    const trustNotice = meta?.grounding?.status === "excerpt-fallback"
      ? evidenceT.excerptFallback
      : meta
      ? meta.mode === "safe-demo"
        ? trustT.safeDemoLead
        : meta.mode === "provider-fallback"
          ? trustT.providerFallbackLead
          : meta.mode === "product-guide"
            ? trustT.productGuideLead
          : meta.mode === "rules"
            ? trustT.rulesLead
            : meta.mode === "unavailable"
              ? trustT.unavailableLead
              : meta.mode === "consent-required"
                ? trustT.consentRequiredLead
                : null
      : null;
    const contextLabel = meta?.contextMode === "cached-official-law"
      ? trustT.cachedLaw
      : meta?.contextMode === "live-official-law"
        ? trustT.liveLaw
        : meta?.contextMode === "live-public-data"
          ? trustT.livePublicData
          : meta?.contextMode === "stored-public-data"
            ? trustT.storedPublicData
            : meta?.contextMode === "reviewed-knowledge"
              ? trustT.reviewedKnowledge
              : null;
    return { answerLabel, providerLabel, trustNotice, contextLabel };
  }
  function aiSourceDetails(sources: readonly AiSource[], prefix: string) {
    return sources.map((source, index) => <details className="ai-source-detail" id={citationTargetId(prefix, index + 1)} key={source.id}>
      <summary>
        <span className="ai-source-number" aria-hidden="true">{index + 1}</span>
        <span className="ai-source-heading"><span>{source.publisher}</span><strong>{source.title}</strong></span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="ai-source-body">
        <dl className="ai-source-dates">
          {source.publishedAt && <div><dt>{source.kind === "law" ? evidenceT.effective : evidenceT.published}</dt><dd><time dateTime={source.publishedAt}>{source.publishedAt}</time></dd></div>}
          <div><dt>{evidenceT.checked}</dt><dd>{source.reviewedAt ? <time dateTime={source.reviewedAt}>{source.reviewedAt}</time> : evidenceT.unknownDate}</dd></div>
          {source.expiresAt && <div><dt>{evidenceT.expires}</dt><dd><time dateTime={source.expiresAt}>{source.expiresAt}</time></dd></div>}
        </dl>
        {(source.kind === "statistic" || source.kind === "indicator") && <p className="ai-source-basis-note">{evidenceT.basisNote}</p>}
        <div className="ai-source-excerpt"><strong>{evidenceT.excerpt}</strong><p>{source.excerpt || evidenceT.missingExcerpt}</p></div>
        <a className="ai-source-official" href={source.url} target="_blank" rel="noopener noreferrer">{evidenceT.original}<ExternalLink size={14} aria-hidden="true" /></a>
      </div>
    </details>);
  }
  const lastFailedAiTurn = [...aiSessionTurns].reverse().find((turn) => turn.status === "error" || Boolean(turn.meta?.providerError)) ?? null;
  const latestEvidenceTurn = [...aiSessionTurns].reverse().find((turn) => turn.sources.length > 0) ?? null;
  const consentActionLabel = {
    ko: "마이페이지에서 필수 동의하기",
    en: "Review consent in My page",
    ja: "マイページで必須同意を確認",
    zh: "在我的页面完成必要同意",
  }[locale];
  const cashflowLabels = {
    fixedExpenses: sessionT.fixedExpenses,
    variableExpenses: sessionT.variableExpenses,
    debtPayment: sessionT.debtPayment,
  };

  return (
    <div className={`app-shell view-${activeView} ${easyMode ? "easy-mode" : ""}`}>
      <a className="skip-link" href="#main-content">{a11yT.skip}</a>
      <aside ref={sidebarRef} id="primary-navigation" className={`sidebar ${menuOpen ? "open" : ""}`} aria-label={a11yT.primaryNav} role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen ? true : undefined}>
        <div className="brand-row">
          <Link className="brand-home-link" href="/" aria-label={mascotT.home}>
            <span className="brand-mark" aria-hidden="true">B</span>
            <span className="brand-copy"><strong>BORA</strong><span>{t.brandTag}</span></span>
          </Link>
          <button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label={t.close}><X size={21} /></button>
        </div>
        <nav className="nav-list">
          {nav.map(({ id, label, icon: Icon }) => (
            <Link key={id} href={VIEW_PATHS[id]} className={activeView === id ? "active" : ""} onClick={() => {
              setMenuOpen(false);
              rememberRecentView(id);
            }} aria-current={activeView === id ? "page" : undefined}>
              <Icon size={20} strokeWidth={2} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <Link className="information-portal-entry" href="/information">
          <Database size={20} />
          <span><strong>{locale === "ko" ? "정책·공식 정보" : locale === "ja" ? "政策・公式情報" : locale === "zh" ? "政策与官方信息" : "Policy & official data"}</strong><small>{locale === "ko" ? "청년 · 금융 · 창업 · 정착" : locale === "ja" ? "若者 · 金融 · 創業 · 定着" : locale === "zh" ? "青年 · 金融 · 创业 · 落地" : "Youth · Finance · Startup · Settlement"}</small></span>
          <ChevronRight size={17} />
        </Link>
        <div className="sidebar-trust">
          <LockKeyhole size={18} />
          <div><strong>{t.privacy}</strong><span>{locale === "ko" ? "직접 입력 · 계정 저장" : locale === "ja" ? "直接入力・アカウント保存" : locale === "zh" ? "手动输入 · 账户保存" : "Manual entry · account saved"}</span></div>
          <ChevronRight size={17} />
        </div>
        <button
          ref={sidebarAccountButtonRef}
          type="button"
          className="sidebar-profile"
          onClick={openSidebarAccountDialog}
          aria-haspopup="dialog"
          aria-label={currentUser
            ? (locale === "ko" ? `${currentUser.displayName} 계정 메뉴 열기` : `Open ${currentUser.displayName} account menu`)
            : (locale === "ko" ? "BORA Member 로그인 옵션 열기" : "Open BORA Member sign-in options")}
        >
          <div className="avatar"><UserRound size={20} /></div>
          <div><strong>{currentUser?.displayName ?? "BORA Member"}</strong><span>{currentUser ? (locale === "ko" ? "로그인됨 · 마이페이지에서 설정" : "Signed in · Manage profile") : (locale === "ko" ? "로그인하여 맞춤 설정" : "Sign in to personalize")}</span></div>
          {currentUser ? <Settings2 size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}
        </button>
        {currentUser?.isDeveloper && <a className="developer-link" href="/developer"><Settings2 size={16} />{locale === "ko" ? "개발자 모드" : "Developer mode"}</a>}
      </aside>

      {menuOpen && <button className="sidebar-backdrop" aria-label={t.close} onClick={() => setMenuOpen(false)} />}

        <HomeControlCenter
          locale={locale}
          easyMode={easyMode}
          widgetOrder={homeWidgetOrder}
          hiddenWidgets={hiddenHomeWidgets}
          onWidgetOrderChange={changeHomeWidgetOrder}
          onHiddenWidgetsChange={changeHiddenHomeWidgets}
          onResetLayout={resetHomeLayout}
          onSessionChange={(user) => {
            if (!user) setSessionSnapshot((current) => current ? { ...current, authenticated: false, expiresAt: null, provider: undefined, user: undefined } : current);
            synchronizePrincipal(user);
          }}
          controlledSession={sessionSnapshot}
          controlledSessionLoading={sessionState === "checking"}
          controlledSessionUnavailable={sessionUnavailable}
          onSessionRetry={refreshHomeSession}
          controlledSessionUser={currentUser}
          accountDialogRequest={accountDialogRequest}
          accountDialogTriggerRef={accountDialogTriggerRef}
          layoutDialogRequest={layoutDialogRequest}
          launchersHidden
        />

      <section className="workspace">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="icon-button mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label={a11yT.openMenu}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
          >
            <Menu size={22} />
          </button>
          <div className="topbar-spacer" />
          <Link className="challenge-top-link" href="/challenge" aria-label={shellT.challenge} title={shellT.challenge}>
            <CircleHelp size={17} aria-hidden="true" />
            <span>{shellT.challenge}</span>
          </Link>
          <div className="recent-features" aria-label={shellT.recent}>
            <span>{shellT.recent}</span>
            {recentViews.length ? (
              <div>
                {recentViews.map((view) => {
                  const item = nav.find((candidate) => candidate.id === view);
                  if (!item) return null;
                  const Icon = item.icon;
                  return <Link key={view} href={VIEW_PATHS[view]} onClick={() => rememberRecentView(view)} aria-current={activeView === view ? "page" : undefined}><Icon size={14}/>{item.label}</Link>;
                })}
              </div>
            ) : <small>{shellT.recentEmpty}</small>}
          </div>
          <label className="language-picker">
            <Globe2 size={17} />
            <span className="sr-only">{a11yT.language}</span>
            <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>
              <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">简体中文</option>
            </select>
          </label>
          <button
            className={`easy-toggle ${easyMode ? "on" : ""}`}
            onClick={toggleEasyMode}
            aria-pressed={easyMode}
            aria-label={`${t.easyMode} ${easyMode ? a11yT.stateOn : a11yT.stateOff}. ${easyMode ? a11yT.disableEasyMode : a11yT.enableEasyMode}`}
            aria-describedby="easy-mode-status"
          >
            <Accessibility size={18} aria-hidden="true" /><span>{t.easyMode}</span><span className="easy-state" id="easy-mode-status">{easyMode ? "ON" : "OFF"}</span><span className="toggle-track" aria-hidden="true"><span /></span>
          </button>
          <details className="account-quick-menu">
            <summary className="top-avatar" aria-label={shellT.accountMenu}>
              <span>{currentUser?.displayName.trim().charAt(0).toUpperCase() || "B"}</span>
              <ChevronDown size={12} aria-hidden="true"/>
            </summary>
            <div className="account-quick-popover">
              <div className="account-quick-identity">
                <span>{currentUser?.displayName ?? "BORA Member"}</span>
                <small>{currentUser?.email || shellT.signIn}</small>
              </div>
              <a href="/mypage"><UserRound size={16}/>{currentUser ? shellT.myPage : shellT.signIn}</a>
              {currentUser?.isDeveloper && <a href="/developer"><Settings2 size={16}/>{shellT.developer}</a>}
              {currentUser && <button type="button" onClick={quickSignOut} aria-busy={quickLogoutPending} disabled={quickLogoutPending}><LogOut size={16}/>{quickLogoutPending ? shellT.signingOut : shellT.signOut}</button>}
              {quickLogoutError && <p role="alert">{shellT.signOutFailed}</p>}
            </div>
          </details>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {authNotice && (
            <div className={`auth-notice ${authNotice}`} role="status">
              <span>{authNotice === "success" ? shellT.authSuccess : authNotice === "cancelled" ? shellT.authCancelled : shellT.authFailed}</span>
              <button type="button" onClick={() => setAuthNotice(null)} aria-label={interactionT.dismissNotice}><X size={17} /></button>
            </div>
          )}
          {activeView === "home" && (
            <>
              <section className="home-hero">
                <div className="home-hero-copy">
                  <span className="eyebrow"><Sparkles size={14} />{homeT.eyebrow}</span>
                  <small>{personalizedGreeting}</small>
                  <h1>{homeT.title}</h1>
                  <p>{currentUser ? homeT.signedInLead : homeT.signedOutLead}</p>
                  <ul>
                    {homeT.trustItems.map((item) => <li key={item}><CheckCircle2 size={15} />{item}</li>)}
                  </ul>
                </div>
                <div className="home-hero-control">
                  <HomeControlCenterActions locale={locale} easyMode={easyMode} user={currentUser}
                    onPanelOpen={(tab, trigger) => {
                      accountDialogTriggerRef.current = trigger;
                      if (tab === "layout") setLayoutDialogRequest((request) => request + 1);
                      else setAccountDialogRequest((request) => request + 1);
                    }} />
                </div>
              </section>

              <div className="home-widgets">
                <div className="home-widget" hidden={hiddenHomeWidgets.includes("today")} style={{ order: widgetOrder("today") }}>
                  <BoraDailyGuide
                    locale={locale}
                    userId={currentUser?.id}
                    easyMode={easyMode}
                    onOpenAssets={() => changeView("assets")}
                  />
                </div>

                <div className="home-widget" hidden={hiddenHomeWidgets.includes("summary")} style={{ order: widgetOrder("summary") }}>
                  <HomeFinanceStatus
                    key={`home-finance-${currentUser?.id ?? "signed-out"}`}
                    locale={locale}
                    userId={currentUser?.id}
                    sessionState={sessionState}
                    easyMode={easyMode}
                  />
                </div>

                <div className="home-widget" hidden={hiddenHomeWidgets.includes("exchange")} style={{ order: widgetOrder("exchange") }}>
                  <PublicDataOverview locale={locale} userId={currentUser?.id} compact />
                </div>

                <div className="home-widget" hidden={hiddenHomeWidgets.includes("insights")} style={{ order: widgetOrder("insights") }}>
                  <InformationShortcuts locale={locale} compact />
                </div>
              </div>
            </>
          )}

          {activeView === "assets" && (
            <>
              <section className="page-heading"><div><span className="eyebrow"><WalletCards size={14} /> SMART MONEY</span><h1>{t.assets}</h1><p>{t.goalSub}</p></div><button className="primary-button" type="button" onClick={() => document.getElementById("goal-planner")?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" })}><CircleDollarSign size={18}/>{t.makePlan}</button></section>
              <PersonalAssetWorkbook
                key={`personal-assets-${currentUser?.id ?? "signed-out"}`}
                locale={locale}
                easyMode={easyMode}
                principalUserId={currentUser?.id ?? null}
                sessionState={sessionState}
                sessionExpiresAt={sessionSnapshot?.expiresAt ?? null}
                onSessionRetry={refreshHomeSession}
              />
              <section className="assets-grid assets-grid-single">
                <article className="panel goal-panel" id="goal-planner"><div className="panel-heading"><div><h2>{t.goalTitle}</h2><p>{t.goalSub}</p></div><div className="goal-icon"><Target size={21}/></div></div><div className="goal-result"><label className="goal-amount"><span>{t.goalAmount}</span><select value={goalAmountUnit} onChange={(event) => changeGoalAmountUnit(event.target.value as ManualMoneyUnit)} aria-label={`${t.goalAmount} ${interactionT.goalInputUnit}`}><option value="won">{t.wonUnit}</option><option value="manwon">{t.manwonUnit}</option></select><input type="text" inputMode={goalAmountUnit === "manwon" ? "decimal" : "numeric"} pattern="[0-9,.]*" autoComplete="off" value={goalAmountDraft} onChange={(event) => changeGoalAmountInput(event.target.value)} aria-label={`${t.goalAmount} · ${goalAmountUnit === "won" ? t.wonUnit : t.manwonUnit}`}/></label><div><span>{t.monthlySave}</span><strong>{formatMoney(monthlySave, locale)}</strong></div><div><span>{t.arrive}</span><strong>{goalDate}</strong><small>{goalMonths} {t.months}</small></div></div><input className="goal-slider" type="range" min="0" max="800000" step="50000" value={monthlySave} onChange={(event) => setMonthlySave(Number(event.target.value))} aria-label={t.monthlySave}/><div className="slider-labels"><span>{formatMoney(0, locale)}</span><span>{formatMoney(800_000, locale)}</span></div><div className="milestone-line"><span><Check size={13}/></span><i/><span><PiggyBank size={15}/></span><i/><span><Target size={15}/></span></div><button className="primary-button full" type="button" disabled={goalMonths === 0} onClick={() => { setAiQuestion(interactionT.goalPrompt(formatMoney(goalAmount, locale), formatMoney(monthlySave, locale))); changeView("ai"); }}><CheckCircle2 size={18}/>{t.makePlan}</button></article>
              </section>
            </>
          )}

          {activeView === "safety" && (
            <>
              <section className="page-heading safety-heading"><div><span className="eyebrow"><ShieldCheck size={14}/> BORA SHIELD</span><h1>{t.safetyTitle}</h1><p>{t.safetyLead}</p></div><div className="shield-badge"><ShieldCheck size={22}/><div><strong>{securityT.onDemand}</strong><span>{securityT.ruleBased}</span></div></div></section>
              <section className="safety-grid">
                <article className="panel scan-panel">
                  <div className="scan-label"><MessageCircleQuestion size={18}/><strong>SMS · URL · RESPONSE</strong><span>ON-DEMAND</span></div>
                  <p className="scan-privacy-note" id="phishing-privacy-note"><LockKeyhole size={15}/>{securityT.privacyWarning}</p>
                  <div className="scan-intake-guide">
                    <div><ClipboardPaste size={18}/><span><strong>{securityT.inboxBoundary}</strong><small>{securityT.clipboardHelp}</small></span></div>
                    <div className="scan-intake-controls">
                      <label className="clipboard-consent"><input type="checkbox" checked={phishingClipboardConsent} disabled={phishingClipboardReading} aria-describedby="clipboard-consent-help" onChange={(event) => { setPhishingClipboardConsent(event.target.checked); setPhishingError(""); }}/><span><strong>{securityT.clipboardConsent}</strong><small id="clipboard-consent-help">{securityT.clipboardConsentHelp}</small></span></label>
                      <div className="scan-intake-actions">
                        <button type="button" disabled={!phishingClipboardConsent || phishingClipboardReading} aria-describedby="clipboard-consent-help" aria-busy={phishingClipboardReading} onClick={() => void pastePhishingFromClipboard()}><ClipboardPaste size={17}/>{phishingClipboardReading ? securityT.clipboardReading : securityT.clipboardPaste}</button>
                        {phishingText && <button type="button" className="scan-clear-input" onClick={clearPhishingInput}><X size={17}/>{securityT.clearInput}</button>}
                      </div>
                    </div>
                  </div>
                  {phishingInputNotice && <p className="scan-intake-status" role="status" aria-live="polite"><CheckCircle2 size={15}/>{phishingInputNotice}</p>}
                  <label className="scan-input-label" htmlFor="phishing-message-input"><strong>{securityT.previewLabel}</strong><small id="phishing-inert-note">{securityT.inertPreview}</small></label>
                  <textarea id="phishing-message-input" ref={phishingTextareaRef} maxLength={20_000} value={phishingText} onChange={(event) => { invalidatePhishingAnalysis(); phishingClipboardRequestRef.current += 1; setPhishingClipboardReading(false); setPhishingText(event.target.value); setPhishingResult(null); setPhishingError(""); setPhishingInputNotice(""); setPhishingExposures([]); setPhishingReputationConsent(false); setPhishingClipboardConsent(false); }} aria-label={securityT.previewLabel} aria-describedby="phishing-privacy-note phishing-inert-note" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} translate="no"/>
                  <div className="scan-character-count">{phishingText.length.toLocaleString(localeTag[locale])} / 20,000 {securityT.characters}</div>
                  <fieldset className="exposure-checks">
                    <legend>{securityT.exposureTitle}</legend>
                    <p>{securityT.exposureLead}</p>
                    <div>{(Object.keys(securityT.exposureOptions) as PhishingExposure[]).map((exposure) => <label key={exposure}><input type="checkbox" checked={phishingExposures.includes(exposure)} onChange={() => togglePhishingExposure(exposure)}/><span>{securityT.exposureOptions[exposure]}</span></label>)}</div>
                  </fieldset>
                  <div className="reputation-consent"><label><input type="checkbox" checked={phishingReputationConsent} onChange={(event) => { invalidatePhishingAnalysis(); setPhishingReputationConsent(event.target.checked); setPhishingResult(null); setPhishingError(""); }}/><span><strong>{securityT.reputationConsent}</strong><small>{securityT.reputationConsentHelp}</small></span></label><a href="https://developers.google.com/safe-browsing/terms" target="_blank" rel="noreferrer">{securityT.reputationTerms}<ExternalLink size={12}/></a></div>
                  {phishingError && <p className="scan-error" role="alert"><AlertTriangle size={16}/>{phishingError}</p>}
                  <div className="scan-footer"><span><LockKeyhole size={15}/>{securityT.deleteNotice}</span><button className="primary-button" type="button" onClick={analyzePhishing} aria-busy={phishingLoading} disabled={phishingLoading || phishingClipboardReading || !phishingText.trim()}><ScanSearch size={18}/>{phishingLoading ? t.analyzing : t.analyze}</button></div>
                </article>
                <aside className="panel protection-panel"><div className="protection-art"><ShieldCheck size={42}/><span className="pulse p1"/><span className="pulse p2"/></div><h2>{t.protectionSteps}</h2><ol><li><span>1</span>{t.step1}</li><li><span>2</span>{t.step2}</li><li><span>3</span>{t.step3}</li></ol><a className="ghost-button full" href="tel:1394"><Bell size={17}/>{t.call1332}</a></aside>
              </section>
              {phishingResult && <section className="risk-result" data-risk={phishingResult.riskLevel}>
                <div className="risk-header">
                  <div className="risk-icon">{phishingResult.riskLevel === "low" ? <ShieldCheck size={25}/> : <AlertTriangle size={25}/>}</div>
                  <div role="status" aria-live="polite"><span>REVIEW · {phishingResult.riskLevel.toUpperCase()}</span><h2>{securityT.result[phishingResult.riskLevel]}</h2><p>{phishingResult.summary}</p><small className="assessment-status">{securityT.assessment[phishingResult.assessmentStatus]}</small></div>
                  <strong aria-label={`${securityT.scoreLabel}: ${phishingResult.score}/100`}>{phishingResult.score}<small>/100</small></strong>
                </div>
                <div className="risk-meter" role="meter" aria-label={securityT.scoreLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={phishingResult.score}><span style={{ width: `${phishingResult.score}%` }}/></div>
                <div className="score-breakdown" aria-label={securityT.scoreLabel}>
                  <span>{securityT.scoreParts.rules} <strong>{phishingResult.scoreBreakdown.ruleScore}</strong></span>
                  <span>{securityT.scoreParts.url} <strong>{phishingResult.scoreBreakdown.urlHeuristicScore}</strong></span>
                  <span>{securityT.scoreParts.interaction} <strong>{phishingResult.scoreBreakdown.interactionBonus}</strong></span>
                  {(phishingResult.scoreBreakdown.criticalFloor > 0 || phishingResult.scoreBreakdown.reputationFloor > 0) && <span>{securityT.scoreParts.floor} <strong>{Math.max(phishingResult.scoreBreakdown.criticalFloor, phishingResult.scoreBreakdown.reputationFloor)}</strong></span>}
                </div>
                <article className="incident-response" data-level={phishingResult.incidentResponse.level}><AlertTriangle size={19}/><div><strong>{phishingResult.incidentResponse.title}</strong><p>{phishingResult.incidentResponse.summary}</p></div></article>
                <div className="risk-detail-grid">
                  <article><h3>{securityT.evidence}</h3>{phishingResult.signals.length ? <ul>{phishingResult.signals.map((signal, index) => <li key={signal.id}>{index === 0 ? <ExternalLink size={18}/> : index === 1 ? <Clock3 size={18}/> : <CircleDollarSign size={18}/>} {signal.label}</li>)}</ul> : <p>{securityT.noSignals}</p>}</article>
                  <article><h3>{securityT.nextActions}</h3><ol>{phishingResult.recommendedActions.map((action, index) => <li key={`${index}-${action}`}><span>{index + 1}</span>{action}</li>)}</ol></article>
                </div>
                {phishingResult.urlReputation && <p className="reputation-status"><Globe2 size={14}/><span>{securityT.reputation[phishingResult.urlReputation.status]}{phishingResult.urlReputation.advisory && phishingResult.urlReputation.providerUrl && <> · <a href={phishingResult.urlReputation.providerUrl} target="_blank" rel="noreferrer">Advisory provided by Google<ExternalLink size={12}/></a></>}</span></p>}
                {phishingResult.detectedUrls.length > 0 && <section className="url-findings"><h3>{securityT.urlFindings}</h3>{phishingResult.detectedUrls.map((item) => <article key={item.url}><div><Globe2 size={14}/><strong>{item.host || item.url}</strong></div>{item.signalLabels.length > 0 ? <ul>{item.signalLabels.map((label) => <li key={label}>{label}</li>)}</ul> : <p>{securityT.noSignals}</p>}</article>)}</section>}
                <section className="official-response-links"><h3>{securityT.officialHelp}</h3><div>{phishingResult.officialResources.map((resource) => <a key={resource.id} href={resource.href} target={resource.href.startsWith("http") ? "_blank" : undefined} rel={resource.href.startsWith("http") ? "noreferrer" : undefined}><strong>{resource.label}</strong><span>{resource.purpose}</span>{resource.href.startsWith("http") && <ExternalLink size={13}/>}</a>)}</div></section>
                <p className="risk-disclaimer"><LockKeyhole size={14}/>{phishingResult.disclaimer}</p>
              </section>}
              <SecurityTriageLab locale={locale} />
              <FinancialLawSafety locale={locale} />
            </>
          )}

          {activeView === "opportunity" && (
            <>
              <section className="page-heading"><div><span className="eyebrow"><Sparkles size={14}/> OPPORTUNITY FINDER</span><h1>{t.opportunityTitle}</h1><p>{t.opportunityLead}</p></div><button className="primary-button" type="button" onClick={() => changeView("ai")}><FileSearch size={18}/>{t.opportunitySearch}</button></section>
              <FinancialMissionCenter locale={locale} easyMode={easyMode} onNavigate={navigateMission} />
              <details className="opportunity-shortcuts-disclosure">
                <summary><span><strong>{shellT.moreData}</strong><small>{shellT.moreDataLead}</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
                <div className="opportunity-shortcuts-content"><InformationShortcuts locale={locale} /></div>
              </details>
            </>
          )}

          {activeView === "ai" && (
            <>
              <section className="page-heading ai-page-heading"><div><span className="eyebrow"><Bot size={14}/> SOURCE-FIRST AI</span><h1>{t.aiTitle}</h1><p>{t.aiLead}</p></div><div className="model-status"><ShieldCheck size={19}/><div><strong>{aiT.protectedEngine}</strong><small>{aiT.protectedEngineSub}</small></div></div></section>
              <section className="ai-layout">
                <article className="panel chat-panel">
                  {aiSessionTurns.length === 0 && <div className="chat-welcome"><div className="ai-orb large"><Sparkles size={27}/></div><span>BORA</span><h2>{t.greetingSub}</h2>{(sessionState === "signed-out" || sessionState === "unavailable") && <div className="ai-sign-in-prompt"><strong>{sessionT.signInTitle}</strong><p>{sessionT.signInBody}</p><Link className="assistant-consent-link" href="/mypage"><LogIn size={16}/>{sessionT.signInAction}<ChevronRight size={16}/></Link></div>}<div className="suggestion-row"><button type="button" onClick={() => setAiQuestion(t.assetAction)}><PiggyBank size={17}/>{t.assetAction}</button><button type="button" onClick={() => setAiQuestion(t.startupAction)}><Store size={17}/>{t.startupAction}</button></div></div>}
                  {aiSessionTurns.length > 0 && <div ref={aiTranscriptRef} className="chat-transcript" aria-label={sessionT.transcriptLabel} aria-live="polite" aria-relevant="additions text">
                    {aiSessionTurns.map((turn) => {
                      const presentation = aiTurnPresentation(turn.meta);
                      const showEvidence = Boolean(presentation.contextLabel || turn.sources.length);
                      return <article className={`ai-turn ${turn.status}`} key={turn.id}>
                        <div className="user-message"><span>{aiT.userMessage}</span><p>{turn.question}</p></div>
                        <div className="assistant-message" role={turn.status === "error" ? "alert" : undefined} aria-busy={turn.status === "pending"}>
                          <div className="message-avatar"><Bot size={18}/></div>
                          <div>
                            <span>{turn.status === "pending" ? aiT.checkingSources : `${presentation.answerLabel}${presentation.providerLabel ? ` · ${presentation.providerLabel}` : ""}`}</span>
                            {turn.status === "pending" ? <p className="ai-pending"><Clock3 size={15}/>{sessionT.pending}</p> : <SafeMarkdown content={turn.answer} sources={turn.sources} citationPrefix={`ai-turn-${turn.id}-source`} citationLabel={sessionT.sources} />}
                            {turn.status !== "pending" && presentation.trustNotice && <p className="metadata-note">{turn.meta?.mode === "product-guide" ? <CircleHelp size={14}/> : <AlertTriangle size={14}/>} {presentation.trustNotice}</p>}
                            {turn.status !== "pending" && turn.meta?.providerError && <p className="metadata-note" role="status"><Clock3 size={14}/>{aiRuntimeNotice[locale][turn.meta.providerError]}</p>}
                            {turn.status !== "pending" && turn.meta?.retrieval?.contextualized && <p className="metadata-note"><MessageCircleQuestion size={14}/>{evidenceT.contextualized}</p>}
                            {turn.status !== "pending" && turn.meta && ((turn.meta.conversationContextApplied ?? 0) > 0 || (turn.meta.recentActivityApplied ?? 0) > 0) && <p className="metadata-note"><Database size={14}/>{contextConsentCopy[locale].usedCount(turn.meta.conversationContextApplied ?? 0, turn.meta.recentActivityApplied ?? 0)}</p>}
                            {turn.status === "sign-in" && <Link className="assistant-consent-link" href="/mypage"><LogIn size={16}/>{sessionT.signInAction}<ChevronRight size={16}/></Link>}
                            {turn.meta?.mode === "consent-required" && <Link className="assistant-consent-link" href="/mypage?onboarding=required">{consentActionLabel}<ChevronRight size={16}/></Link>}
                            {(turn.status === "error" || turn.meta?.providerError) && lastFailedAiTurn?.id === turn.id && <button type="button" className="ai-retry-button" onClick={() => retryAiTurn(turn)} disabled={aiLoading}><Clock3 size={16}/>{sessionT.retry}</button>}
                            {turn.status !== "pending" && showEvidence && <details className="answer-source ai-turn-evidence">
                              <summary><FileSearch size={16}/><span><strong>{presentation.contextLabel ?? t.evidence}</strong><small>{turn.sources.length} {sessionT.sources}</small></span><ChevronDown size={17}/></summary>
                              <div className="ai-turn-evidence-body">
                                <p>{evidenceT.usedOnly}</p>
                                {(turn.meta?.contextMode === "stored-public-data" || turn.meta?.contextMode === "live-public-data") && <p>{evidenceT.storedLead}</p>}
                                {aiSourceDetails(turn.sources, `ai-turn-${turn.id}-source`)}
                              </div>
                            </details>}
                          </div>
                        </div>
                      </article>;
                    })}
                  </div>}
                  <p className="ai-session-note"><LockKeyhole size={14}/>{sessionT.sessionOnly}</p>
                  <form className="chat-input" onSubmit={askAi}><input value={aiQuestion} maxLength={AI_QUESTION_MAX_LENGTH} onChange={(event) => setAiQuestion(event.target.value)} placeholder={t.askPlaceholder} aria-label={t.askPlaceholder} aria-describedby="ai-question-remaining"/><small id="ai-question-remaining" aria-live="polite">{interactionT.aiRemaining(AI_QUESTION_MAX_LENGTH - aiQuestion.length)}</small><button type="submit" className="send-button" aria-label={t.send} aria-busy={aiLoading} disabled={aiLoading || !aiQuestion.trim()}><Send size={19}/></button></form>
                </article>
                <aside className="ai-insight-stack">
                  <article className="panel topic-panel">
                    <div className="panel-heading"><div><h2>{aiT.topicTitle}</h2><p>{aiT.topicLead}</p></div><span className="period-pill">{aiAnalytics?.demo !== false ? aiT.demoBadge : aiT.historyBadge}</span></div>
                    <div className="topic-summary"><div className="topic-donut" role="img" aria-label={aiT.topicTitle}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={topicChartData} dataKey="count" innerRadius={43} outerRadius={62} paddingAngle={3} stroke="none">{topicChartData.map((entry) => <Cell key={entry.topic} fill={entry.color}/>)}</Pie><Tooltip formatter={(value, _name, item) => [`${value} · ${Number(item.payload.sharePercent).toFixed(1)}%`, item.payload.name]}/></PieChart></ResponsiveContainer><div><strong>{aiAnalytics?.totalChats ?? 0}</strong><span>{aiT.chats}</span></div></div><dl><div><dt>{aiT.thisWeek}</dt><dd>{aiAnalytics?.last7Days ?? 0}</dd></div><div><dt>{aiT.chats}</dt><dd>{aiAnalytics?.totalChats ?? 0}</dd></div></dl></div>
                    <div className="topic-legend">{topicChartData.slice(0, 4).map((item) => <span key={item.topic}><i style={{background:item.color}}/>{item.name}<strong>{item.count} · {item.sharePercent.toFixed(1)}%</strong></span>)}</div>
                    <p className="metadata-note"><LockKeyhole size={14}/>{aiMemoryConsent ? aiT.metadataOnly : memoryCopy[locale].consentOffLead}</p>
                    {currentUser && <details className="ai-memory" aria-busy={aiContextPreferenceSaving}>
                      <summary><strong>{contextConsentCopy[locale].privacySettings}</strong><small>{contextConsentCopy[locale].privacySettingsLead}</small></summary>
                      <div className="ai-memory-heading"><div><strong>{memoryCopy[locale].title}</strong><small id="ai-memory-consent-description">{aiMemoryConsent ? memoryCopy[locale].lead : memoryCopy[locale].consentOffLead}</small></div>{(aiAnalytics?.memories.length ?? 0) > 0 && <button type="button" onClick={() => deleteAiMemory()} disabled={memoryDeleting}>{memoryCopy[locale].clear}</button>}</div>
                      <button type="button" className={`easy-toggle ai-context-toggle ${aiMemoryConsent ? "on" : ""}`} role="switch" aria-checked={aiMemoryConsent} aria-label={memoryCopy[locale].consentLabel} aria-describedby="ai-memory-consent-description" onClick={toggleAiMemoryConsent} disabled={aiContextPreferenceSaving}><span className="toggle-track" aria-hidden="true"><span /></span><span>{aiMemoryConsent ? memoryCopy[locale].consentOn : memoryCopy[locale].consentOff}</span></button>
                      {(aiAnalytics?.memories.length ?? 0) > 0 ? <ul>{aiAnalytics?.memories.map((memory) => <li key={memory.id}><span>{memory.summary}</span><button type="button" aria-label={memoryCopy[locale].forget} title={memoryCopy[locale].forget} onClick={() => deleteAiMemory(memory.id)} disabled={memoryDeleting}><X size={14}/></button></li>)}</ul> : <p>{memoryCopy[locale].empty}</p>}
                      <div className="ai-memory-heading"><div><strong>{contextConsentCopy[locale].conversationTitle}</strong><small id="ai-conversation-context-description">{contextConsentCopy[locale].conversationLead} · {contextConsentCopy[locale].savedCount(aiConversationContextCount)}</small></div>{aiConversationContextCount > 0 && <button type="button" onClick={clearAiConversationContext} disabled={aiContextPreferenceSaving}>{contextConsentCopy[locale].clear}</button>}</div>
                      <button type="button" className={`easy-toggle ai-context-toggle ${aiConversationContextConsent ? "on" : ""}`} role="switch" aria-checked={aiConversationContextConsent} aria-label={contextConsentCopy[locale].conversationTitle} aria-describedby="ai-conversation-context-description" onClick={toggleAiConversationContextConsent} disabled={aiContextPreferenceSaving}><span className="toggle-track" aria-hidden="true"><span /></span><span>{aiConversationContextConsent ? contextConsentCopy[locale].conversationOn : contextConsentCopy[locale].conversationOff}</span></button>
                      <div className="ai-memory-heading"><div><strong>{contextConsentCopy[locale].activityTitle}</strong><small id="ai-recent-activity-description">{contextConsentCopy[locale].activityLead} · {contextConsentCopy[locale].savedCount(aiRecentActivityCount)}</small></div>{aiRecentActivityCount > 0 && <button type="button" onClick={clearAiRecentActivity} disabled={aiContextPreferenceSaving}>{contextConsentCopy[locale].clear}</button>}</div>
                      <button type="button" className={`easy-toggle ai-context-toggle ${aiRecentActivityConsent ? "on" : ""}`} role="switch" aria-checked={aiRecentActivityConsent} aria-label={contextConsentCopy[locale].activityTitle} aria-describedby="ai-recent-activity-description" onClick={toggleAiRecentActivityConsent} disabled={aiContextPreferenceSaving}><span className="toggle-track" aria-hidden="true"><span /></span><span>{aiRecentActivityConsent ? contextConsentCopy[locale].activityOn : contextConsentCopy[locale].activityOff}</span></button>
                      <p className="ai-context-status" role="status" aria-live="polite">{aiContextPreferenceNotice}</p>
                    </details>}
                  </article>
                  {hasAiFinanceInsights && aiFinanceSummary && <article className="panel today-pattern-card"><div className="today-pattern-icon"><TrendingUp size={21}/></div><span>{sessionT.monthlyOutflow}</span><h2>{formatMoney(aiFinanceSummary.monthlyOutflow, locale)}</h2><p>{sessionT.monthlyBalance} · {formatMoney(aiFinanceSummary.monthlyBalance, locale)}</p><small>{sessionT.manualBasis}</small></article>}
                </aside>
              </section>
              <section className="ai-evidence-grid">
                <details className="panel evidence-panel ai-evidence-disclosure">
                  <summary><div><h2>{aiT.evidenceTitle}</h2><p>{aiT.evidenceLead}</p></div><span><FileSearch size={20}/><ChevronDown size={18}/></span></summary>
                  {latestEvidenceTurn?.sources.length ? <div className="evidence-list ai-source-list">
                    <p>{evidenceT.usedOnly}</p>
                    {(latestEvidenceTurn.meta?.contextMode === "stored-public-data" || latestEvidenceTurn.meta?.contextMode === "live-public-data") && <p>{evidenceT.storedLead}</p>}
                    {aiSourceDetails(latestEvidenceTurn.sources, "ai-latest-source")}
                  </div> : <div className="evidence-empty"><FileSearch size={24}/><p>{aiT.evidenceEmpty}</p></div>}
                </details>
                {hasAiFinanceInsights && aiFinanceSummary ? <>
                  <article className="panel weekly-pattern-panel"><div className="panel-heading"><div><h2>{sessionT.monthlyBalance}</h2><p>{sessionT.manualBasis}</p></div><BarChart3 size={20}/></div><div className={`cashflow-balance ${aiFinanceSummary.monthlyBalance < 0 ? "negative" : ""}`}><strong>{formatMoney(aiFinanceSummary.monthlyBalance, locale)}</strong><span>{aiFinanceSummary.amounts.monthlyIncome > 0 ? `${formatMoney(aiFinanceSummary.monthlyOutflow, locale)} / ${formatMoney(aiFinanceSummary.amounts.monthlyIncome, locale)}` : formatMoney(aiFinanceSummary.monthlyOutflow, locale)}</span></div></article>
                  <article className="panel saving-methods-panel"><div className="panel-heading"><div><h2>{sessionT.cashflowMix}</h2><p>{sessionT.manualBasis}</p></div><Lightbulb size={20}/></div><ol>{aiFinanceSummary.cashflow.filter((item) => item.id !== "available").map((item, index) => <li key={item.id}><span>{index + 1}</span><div><strong>{cashflowLabels[item.id]}</strong><small>{item.sharePercent.toFixed(1)}%</small></div><em>{formatMoney(item.value, locale)}</em></li>)}</ol></article>
                </> : <article className="panel ai-insights-empty"><div className="today-pattern-icon"><WalletCards size={21}/></div><div><h2>{aiFinanceInsightState.status === "loading" ? sessionT.insightsLoading : aiFinanceInsightState.status === "unavailable" ? sessionT.insightsUnavailableTitle : sessionT.insightsEmptyTitle}</h2><p>{aiFinanceInsightState.status === "unavailable" ? sessionT.insightsUnavailableBody : sessionT.insightsEmptyBody}</p></div><Link className="primary-button" href="/assets"><WalletCards size={17}/>{sessionT.insightsAction}</Link></article>}
              </section>
            </>
          )}
        </main>

        <footer>
          <span>BORA Bridge · Inclusive finance copilot</span>
          <p>{t.footer}</p>
          <div className="footer-meta"><span>{shellT.footerOperations}</span><nav className="footer-legal-nav" aria-label={shellT.footerLegalNav}><Link href="/privacy">{shellT.footerPrivacy}</Link><Link href="/terms">{shellT.footerTerms}</Link></nav></div>
        </footer>
        <nav className="mobile-bottom-nav" aria-label={a11yT.mobileNav}>{nav.map(({id,label,icon:Icon}) => <Link key={id} href={VIEW_PATHS[id]} onClick={() => rememberRecentView(id)} className={activeView===id?"active":""} aria-current={activeView === id ? "page" : undefined}><Icon size={20}/><span>{label}</span></Link>)}</nav>
      </section>
    </div>
  );
}
