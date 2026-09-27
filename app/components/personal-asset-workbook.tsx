"use client";

import {
  CircleAlert,
  Cloud,
  CloudOff,
  Database,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  EMPTY_MANUAL_FINANCE_AMOUNTS,
  MANUAL_FINANCE_FIELDS,
  manualFinanceSummary,
  normalizeManualFinanceAmounts,
  parseStoredManualFinance,
  type ManualFinanceField,
} from "@/lib/manual-finance";
import {
  canonicalWonFromMoneyInput,
  formatCanonicalWonInput,
  normalizeManualMoneyInput,
  type ManualMoneyUnit,
} from "@/lib/money-input";
import styles from "./personal-asset-workbook.module.css";

type Locale = "ko" | "en" | "ja" | "zh";
type InputState = Record<ManualFinanceField, string>;
type AuthState = "loading" | "signed-in" | "anonymous" | "unavailable";
type ParentSessionState = "checking" | "signed-in" | "signed-out" | "unavailable";

const STORAGE_KEY = "bora-device-finance-v1";
const ANONYMOUS_DRAFT_KEY = "bora-anonymous-finance-draft-v1";
const AUTOSAVE_DELAY_MS = 1_800;
const FINANCE_SNAPSHOT_REQUEST_TIMEOUT_MS = 12_000;
const emptyInputs = Object.fromEntries(
  MANUAL_FINANCE_FIELDS.map((field) => [field, ""]),
) as InputState;
const colors = {
  cashAndDeposits: "#6d5bd0",
  investments: "#9a87e2",
  otherAssets: "#c3b6f0",
  fixedExpenses: "#d79b53",
  variableExpenses: "#d05b67",
  debtPayment: "#9b5c9e",
  available: "#6d5bd0",
} as const;
const localeTags: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const copy = {
  ko: {
    eyebrow: "SIGNED-IN FINANCE WORKBOOK",
    title: "직접 입력하고 계정에 저장하는 내 자산 장부",
    lead: "계좌를 연결하지 않고 자산·부채·월 현금흐름을 직접 입력해 순자산을 확인하고, 로그인 계정에서 이어서 관리합니다.",
    privacy: "서버에는 항목별 합계 금액과 AI 활용 동의만 저장하며, ‘모두 지우기’ 전까지 로그인 계정에 남습니다. 계좌번호·카드번호·주민번호는 입력하지 마세요.",
    save: "지금 저장",
    saving: "저장 중…",
    retry: "다시 시도",
    clear: "모두 지우기",
    clearConfirm: "계정에 저장된 자산·현금흐름 정보를 모두 삭제할까요? 삭제 후에는 복구할 수 없습니다.",
    loadingTitle: "저장된 장부를 불러오는 중",
    loadingBody: "불러오기가 끝난 뒤 입력과 저장을 시작할 수 있어요.",
    signedOutTitle: "저장하려면 로그인을 진행해 주세요",
    signedOutBody: "로그인하지 않아도 지금 계산할 수 있어요. 로그인 이동 중에는 이 탭에만 초안을 보관하며, 탭을 닫으면 삭제됩니다.",
    signIn: "로그인 진행하기",
    unavailableTitle: "저장 상태를 확인하지 못했어요",
    unavailableBody: "입력 전 연결을 다시 확인해 주세요. 확인되지 않은 상태에서는 서버로 전송하지 않습니다.",
    dirtyTitle: "저장되지 않은 변경사항이 있어요",
    dirtyBody: "잠시 후 자동 저장됩니다. 지금 저장을 눌러 바로 저장할 수도 있어요.",
    savingTitle: "계정에 안전하게 저장하는 중",
    savingBody: "숫자로 된 항목별 합계만 전송하고 있어요.",
    savedTitle: "계정에 저장됨",
    savedAt: "마지막 저장",
    readyTitle: "아직 한 번도 저장한 금융 정보가 없네요",
    readyBody: "금액을 입력해 처음 저장하고 내 금융 상태 계산에 활용해 보세요.",
    saveErrorTitle: "변경사항을 저장하지 못했어요",
    saveErrorBody: "입력은 이 화면에 그대로 남아 있습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
    deleteErrorTitle: "저장된 장부를 삭제하지 못했어요",
    deleteErrorBody: "화면과 계정의 기존 정보는 그대로 유지했습니다. 다시 시도해 주세요.",
    deleting: "삭제 중…",
    legacyTitle: "이 기기에 저장했던 이전 입력을 찾았어요",
    legacyBody: "계정에는 아직 장부가 없습니다. 내용을 자동 전송하지 않으며, 아래 버튼을 눌러야 가져옵니다.",
    legacyImport: "이전 입력 가져오기",
    draftTitle: "로그인 전에 입력한 초안이 있어요",
    draftBody: "이 탭에만 임시 보관한 금액입니다. 계정 장부를 자동으로 바꾸지 않으며, 가져오기를 선택한 뒤에만 저장합니다.",
    draftImport: "로그인 전 초안 가져오기",
    aiUseTitle: "AI 상담에서 이 장부 활용",
    aiUseBody: "켜면 저장된 항목별 합계 금액이 현재 활성화된 AI 제공사 요청에 포함될 수 있습니다. 기본값은 꺼짐이며 계좌 식별정보는 저장하거나 전송하지 않습니다.",
    assetInputs: "자산·부채",
    cashAndDeposits: "현금·예금",
    investments: "투자자산",
    otherAssets: "기타 자산",
    liabilities: "총 부채",
    cashflowInputs: "월 현금흐름",
    monthlyIncome: "월 실수령 소득",
    fixedExpenses: "고정 지출",
    variableExpenses: "변동 지출",
    debtPayment: "월 부채 상환",
    won: "원",
    manwon: "만원",
    unitLegend: "입력 금액 단위",
    unitHelpWon: "원 단위로 입력합니다. 숫자는 세 자리마다 쉼표로 구분됩니다.",
    unitHelpManwon: "만원 단위로 입력합니다. 소수 넷째 자리까지 원 단위로 정확하게 저장됩니다.",
    totalAssets: "입력 총자산",
    netAssets: "순자산",
    monthlyBalance: "월 잔액",
    debtRatio: "소득 대비 상환",
    needsIncome: "소득 입력 필요",
    assetChart: "자산 구성",
    cashflowChart: "월 지출·잔액 구성",
    emptyChart: "금액을 입력하면 그래프가 나타납니다. 예시 값은 사용하지 않습니다.",
    monthlyOutflow: "월 지출·상환",
    available: "남는 금액",
    shortfall: "부족액",
    disclaimer: "직접 입력한 금액의 단순 계산이며 금융기관 조회, 신용평가, 투자·대출 권유가 아닙니다.",
  },
  en: {
    eyebrow: "SIGNED-IN FINANCE WORKBOOK",
    title: "Your account-saved money workbook",
    lead: "Enter assets, debt and monthly cash flow without linking an account, then continue from the same signed-in account.",
    privacy: "Only category totals and your AI-use preference are stored on the server and remain on your signed-in account until you choose Clear all. Never enter account, card or identity numbers.",
    save: "Save now",
    saving: "Saving…",
    retry: "Try again",
    clear: "Clear all",
    clearConfirm: "Delete all asset and cash-flow information saved to your account? This cannot be undone.",
    loadingTitle: "Loading your saved workbook",
    loadingBody: "You can start entering and saving after the load completes.",
    signedOutTitle: "Please sign in to save",
    signedOutBody: "You can calculate without signing in. This tab keeps a draft while you move through sign-in, and closing the tab removes it.",
    signIn: "Continue to sign in",
    unavailableTitle: "Could not check storage status",
    unavailableBody: "Check the connection before entering data. Nothing is sent while your account status is unknown.",
    dirtyTitle: "You have unsaved changes",
    dirtyBody: "They will autosave shortly, or choose Save now.",
    savingTitle: "Saving to your account",
    savingBody: "Only numeric category totals are being sent.",
    savedTitle: "Saved to your account",
    savedAt: "Last saved",
    readyTitle: "You have not saved money information yet",
    readyBody: "Enter an amount to save for the first time and use it in your money-status calculations.",
    saveErrorTitle: "Could not save your changes",
    saveErrorBody: "Your entries remain on this screen. Check the connection and try again.",
    deleteErrorTitle: "Could not delete the saved workbook",
    deleteErrorBody: "The existing on-screen and account data was kept. Please try again.",
    deleting: "Deleting…",
    legacyTitle: "Previous entries were found on this device",
    legacyBody: "Your account has no workbook yet. Nothing is uploaded unless you choose the import button.",
    legacyImport: "Import previous entries",
    draftTitle: "You have a draft from before sign-in",
    draftBody: "These amounts are held only in this tab. They never replace your account workbook unless you choose Import and then save.",
    draftImport: "Import pre-sign-in draft",
    aiUseTitle: "Use this workbook in AI guidance",
    aiUseBody: "When on, saved category totals may be included in requests to the currently active AI provider. It is off by default; account identifiers are never stored or sent.",
    assetInputs: "Assets and debt",
    cashAndDeposits: "Cash and deposits",
    investments: "Investments",
    otherAssets: "Other assets",
    liabilities: "Total liabilities",
    cashflowInputs: "Monthly cash flow",
    monthlyIncome: "Take-home income",
    fixedExpenses: "Fixed expenses",
    variableExpenses: "Variable expenses",
    debtPayment: "Debt payments",
    won: "KRW",
    manwon: "₩10K",
    unitLegend: "Amount input unit",
    unitHelpWon: "Enter amounts in KRW. Digits are grouped every three places.",
    unitHelpManwon: "Enter amounts in units of ₩10,000. Up to four decimals are preserved as exact KRW.",
    totalAssets: "Entered assets",
    netAssets: "Net worth",
    monthlyBalance: "Monthly balance",
    debtRatio: "Debt payment / income",
    needsIncome: "Income needed",
    assetChart: "Asset mix",
    cashflowChart: "Monthly outflow and balance mix",
    emptyChart: "Enter an amount to see a chart. No example values are used.",
    monthlyOutflow: "Outflows",
    available: "Available",
    shortfall: "Shortfall",
    disclaimer: "This is a simple calculation from your entries, not an account lookup, credit assessment, or investment or loan recommendation.",
  },
  ja: {
    eyebrow: "SIGNED-IN FINANCE WORKBOOK",
    title: "直接入力してアカウントに保存する資産台帳",
    lead: "口座を連携せず、資産・負債・毎月の収支を入力し、同じログインアカウントで管理を続けられます。",
    privacy: "サーバーには項目別の合計金額とAI利用設定だけを保存し、「すべて消去」を選ぶまでログインアカウントに残ります。口座・カード・身分証番号は入力しないでください。",
    save: "今すぐ保存",
    saving: "保存中…",
    retry: "再試行",
    clear: "すべて消去",
    clearConfirm: "アカウントに保存された資産・収支情報をすべて削除しますか？削除後は復元できません。",
    loadingTitle: "保存済み台帳を読み込み中",
    loadingBody: "読み込み後に入力と保存を開始できます。",
    signedOutTitle: "保存するにはログインしてください",
    signedOutBody: "ログインなしでも計算できます。ログイン画面へ移動する間はこのタブだけに下書きを保持し、タブを閉じると削除されます。",
    signIn: "ログインへ進む",
    unavailableTitle: "保存状態を確認できません",
    unavailableBody: "入力前に接続を再確認してください。アカウント状態が不明な間は送信しません。",
    dirtyTitle: "未保存の変更があります",
    dirtyBody: "まもなく自動保存されます。今すぐ保存することもできます。",
    savingTitle: "アカウントに保存中",
    savingBody: "数値の項目別合計だけを送信しています。",
    savedTitle: "アカウントに保存済み",
    savedAt: "最終保存",
    readyTitle: "まだ一度も金融情報を保存していません",
    readyBody: "金額を初めて保存し、金融状態の計算に活用してみましょう。",
    saveErrorTitle: "変更を保存できませんでした",
    saveErrorBody: "入力はこの画面に残っています。接続を確認して再試行してください。",
    deleteErrorTitle: "保存済み台帳を削除できませんでした",
    deleteErrorBody: "画面とアカウントの既存情報は維持されています。再試行してください。",
    deleting: "削除中…",
    legacyTitle: "この端末の以前の入力が見つかりました",
    legacyBody: "アカウントには台帳がありません。ボタンを押すまでアップロードされません。",
    legacyImport: "以前の入力を取り込む",
    draftTitle: "ログイン前に入力した下書きがあります",
    draftBody: "このタブだけに一時保存した金額です。自動でアカウント台帳を変更せず、取り込みを選んだ後にのみ保存します。",
    draftImport: "ログイン前の下書きを取り込む",
    aiUseTitle: "AI相談でこの台帳を利用",
    aiUseBody: "オンにすると、保存済みの項目別合計が現在有効なAI提供元へのリクエストに含まれる場合があります。初期値はオフで、口座識別情報は保存・送信しません。",
    assetInputs: "資産・負債",
    cashAndDeposits: "現金・預金",
    investments: "投資資産",
    otherAssets: "その他の資産",
    liabilities: "負債総額",
    cashflowInputs: "毎月の収支",
    monthlyIncome: "手取り収入",
    fixedExpenses: "固定支出",
    variableExpenses: "変動支出",
    debtPayment: "毎月の返済",
    won: "ウォン",
    manwon: "万ウォン",
    unitLegend: "入力金額の単位",
    unitHelpWon: "ウォン単位で入力します。数字は3桁ごとに区切られます。",
    unitHelpManwon: "万ウォン単位で入力します。小数第4位までウォン単位で正確に保存されます。",
    totalAssets: "入力資産総額",
    netAssets: "純資産",
    monthlyBalance: "月間残高",
    debtRatio: "収入に対する返済",
    needsIncome: "収入入力が必要",
    assetChart: "資産構成",
    cashflowChart: "毎月の支出・残額構成",
    emptyChart: "金額を入力するとグラフが表示されます。例示値は使いません。",
    monthlyOutflow: "支出・返済",
    available: "残額",
    shortfall: "不足額",
    disclaimer: "入力額の単純計算であり、口座照会・信用評価・投資や融資の勧誘ではありません。",
  },
  zh: {
    eyebrow: "SIGNED-IN FINANCE WORKBOOK",
    title: "手动输入并保存到账户的个人资产账本",
    lead: "无需连接账户，手动输入资产、负债和每月现金流，并可通过同一登录账户继续管理。",
    privacy: "服务器仅保存各类别合计金额和AI使用设置，并会保留在登录账户中，直至选择“全部清除”。请勿输入账号、卡号或身份证件号码。",
    save: "立即保存",
    saving: "保存中…",
    retry: "重试",
    clear: "全部清除",
    clearConfirm: "要删除账户中保存的全部资产与现金流信息吗？删除后无法恢复。",
    loadingTitle: "正在加载已保存的账本",
    loadingBody: "加载完成后即可开始输入和保存。",
    signedOutTitle: "如需保存，请先登录",
    signedOutBody: "未登录也可计算。跳转登录期间，草稿仅保存在当前标签页中；关闭标签页后会被删除。",
    signIn: "前往登录",
    unavailableTitle: "无法确认保存状态",
    unavailableBody: "请输入前重新检查连接。账户状态未知时不会向服务器发送数据。",
    dirtyTitle: "有尚未保存的更改",
    dirtyBody: "稍后将自动保存，也可点击立即保存。",
    savingTitle: "正在保存到账户",
    savingBody: "仅发送各类别的数字合计。",
    savedTitle: "已保存到账户",
    savedAt: "最后保存",
    readyTitle: "您还没有保存过金融信息",
    readyBody: "首次输入并保存金额，用于计算您的金融状态。",
    saveErrorTitle: "无法保存更改",
    saveErrorBody: "输入仍保留在当前页面，请检查连接后重试。",
    deleteErrorTitle: "无法删除已保存账本",
    deleteErrorBody: "屏幕和账户中的现有信息均已保留，请重试。",
    deleting: "删除中…",
    legacyTitle: "发现此设备上以前保存的输入",
    legacyBody: "账户中尚无账本。只有点击下方按钮后才会上传。",
    legacyImport: "导入以前的输入",
    draftTitle: "发现登录前填写的草稿",
    draftBody: "这些金额仅临时保存在当前标签页，不会自动替换账户账本；只有选择导入后才会保存。",
    draftImport: "导入登录前草稿",
    aiUseTitle: "在AI咨询中使用此账本",
    aiUseBody: "开启后，已保存的类别合计可能包含在发往当前启用AI提供商的请求中。默认关闭，且不会保存或发送账户识别信息。",
    assetInputs: "资产与负债",
    cashAndDeposits: "现金与存款",
    investments: "投资资产",
    otherAssets: "其他资产",
    liabilities: "总负债",
    cashflowInputs: "每月现金流",
    monthlyIncome: "每月到手收入",
    fixedExpenses: "固定支出",
    variableExpenses: "浮动支出",
    debtPayment: "每月还款",
    won: "韩元",
    manwon: "万韩元",
    unitLegend: "输入金额单位",
    unitHelpWon: "以韩元为单位输入，数字每三位自动分隔。",
    unitHelpManwon: "以万韩元为单位输入，最多保留四位小数并准确保存为韩元。",
    totalAssets: "已输入总资产",
    netAssets: "净资产",
    monthlyBalance: "每月结余",
    debtRatio: "还款占收入",
    needsIncome: "需要输入收入",
    assetChart: "资产构成",
    cashflowChart: "每月支出与结余构成",
    emptyChart: "输入金额后显示图表，不使用示例数据。",
    monthlyOutflow: "支出与还款",
    available: "可用余额",
    shortfall: "资金缺口",
    disclaimer: "仅根据手动输入做简单计算，不是账户查询、信用评估或投资、贷款建议。",
  },
} satisfies Record<Locale, Record<string, string>>;

function displayStateFromCanonical(
  amounts: Record<ManualFinanceField, string | number>,
  unit: ManualMoneyUnit,
): InputState {
  return Object.fromEntries(MANUAL_FINANCE_FIELDS.map((field) => [
    field,
    Number(amounts[field]) > 0 ? formatCanonicalWonInput(amounts[field], unit) : "",
  ])) as InputState;
}

function canonicalStateFromAmounts(
  amounts: typeof EMPTY_MANUAL_FINANCE_AMOUNTS,
): InputState {
  return Object.fromEntries(MANUAL_FINANCE_FIELDS.map((field) => [
    field,
    amounts[field] > 0 ? String(amounts[field]) : "",
  ])) as InputState;
}

function caretFromLogicalRight(value: string, logicalRight: number) {
  let position = value.length;
  let remaining = Math.max(0, logicalRight);
  while (position > 0 && remaining > 0) {
    position -= 1;
    if (value[position] !== ",") remaining -= 1;
  }
  return position;
}

type ParsedSnapshot = {
  authenticated: boolean;
  principalKey: string | null;
  hasSnapshot: boolean;
  amounts: typeof EMPTY_MANUAL_FINANCE_AMOUNTS;
  useForAi: boolean;
  updatedAt: number | null;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseSnapshotPayload(value: unknown): ParsedSnapshot | null {
  const response = recordValue(value);
  if (!response || typeof response.authenticated !== "boolean") return null;
  if (!response.authenticated) {
    return {
      authenticated: false,
      principalKey: null,
      hasSnapshot: false,
      amounts: EMPTY_MANUAL_FINANCE_AMOUNTS,
      useForAi: false,
      updatedAt: null,
    };
  }

  const principalKey = typeof response.principalKey === "string"
    && /^[A-Za-z0-9:_-]{1,160}$/u.test(response.principalKey)
    ? response.principalKey
    : null;
  if (!principalKey) return null;
  const nested = recordValue(response.snapshot);
  const snapshot = nested ?? (response.version === 1 ? response : null);
  if (!snapshot) {
    if (response.snapshot !== null && response.snapshot !== undefined) return null;
    return {
      authenticated: true,
      principalKey,
      hasSnapshot: false,
      amounts: EMPTY_MANUAL_FINANCE_AMOUNTS,
      useForAi: false,
      updatedAt: null,
    };
  }
  if (snapshot.version !== 1 || !recordValue(snapshot.amounts)) return null;
  const nestedUpdatedAt = snapshot.updatedAt;
  const responseUpdatedAt = response.updatedAt;
  const updatedAt = typeof nestedUpdatedAt === "number"
    && Number.isSafeInteger(nestedUpdatedAt)
    && nestedUpdatedAt >= 0
    ? nestedUpdatedAt
    : typeof responseUpdatedAt === "number"
      && Number.isSafeInteger(responseUpdatedAt)
      && responseUpdatedAt >= 0
      ? responseUpdatedAt
      : null;
  return {
    authenticated: true,
    principalKey,
    hasSnapshot: true,
    amounts: normalizeManualFinanceAmounts(snapshot.amounts),
    useForAi: snapshot.useForAi === true,
    updatedAt,
  };
}

type AnonymousDraft = {
  amounts: typeof EMPTY_MANUAL_FINANCE_AMOUNTS;
  principalKey: string | null;
};

function parseAnonymousDraft(): AnonymousDraft | null {
  try {
    const raw = window.sessionStorage.getItem(ANONYMOUS_DRAFT_KEY);
    const amounts = parseStoredManualFinance(raw);
    if (!raw || !amounts) return null;
    const parsed = JSON.parse(raw) as unknown;
    const record = recordValue(parsed);
    if (!record) return null;
    const principalKey = record.principalKey === undefined || record.principalKey === null
      ? null
      : typeof record.principalKey === "string"
        && /^[A-Za-z0-9:_-]{1,160}$/u.test(record.principalKey)
        ? record.principalKey
        : undefined;
    return principalKey === undefined ? null : { amounts, principalKey };
  } catch {
    return null;
  }
}

function readAnonymousDraft() {
  const draft = parseAnonymousDraft();
  return draft?.principalKey === null ? draft.amounts : null;
}

function claimAnonymousDraft(principalKey: string) {
  const draft = parseAnonymousDraft();
  if (!draft) return null;
  if (draft.principalKey && draft.principalKey !== principalKey) {
    clearAnonymousDraft();
    return null;
  }
  if (!draft.principalKey) {
    try {
      window.sessionStorage.setItem(ANONYMOUS_DRAFT_KEY, JSON.stringify({
        version: 1,
        remember: true,
        principalKey,
        amounts: draft.amounts,
      }));
    } catch {
      // Do not expose an unbound draft if it cannot be tied to this account.
      clearAnonymousDraft();
      return null;
    }
  }
  return draft.amounts;
}

function writeAnonymousDraft(inputs: InputState) {
  try {
    const amounts = manualFinanceSummary(inputs).amounts;
    const hasInput = Object.values(amounts).some((amount) => amount > 0);
    if (!hasInput) {
      window.sessionStorage.removeItem(ANONYMOUS_DRAFT_KEY);
      return;
    }
    window.sessionStorage.setItem(ANONYMOUS_DRAFT_KEY, JSON.stringify({
      version: 1,
      remember: true,
      principalKey: null,
      amounts,
    }));
  } catch {
    // Browser storage can be unavailable; local calculations should still work.
  }
}

function clearAnonymousDraft() {
  try {
    window.sessionStorage.removeItem(ANONYMOUS_DRAFT_KEY);
  } catch {
    // Keep the visible workbook usable when browser storage is unavailable.
  }
}

function discardUnboundLegacyFinance() {
  try {
    // This old localStorage record has no account identifier. It must never be
    // offered to whichever member happens to sign in next on a shared device.
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage cleanup is best-effort and must not block the workbook.
  }
}

function sessionExpiryTime(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function PersonalAssetWorkbook({
  locale,
  easyMode,
  principalUserId,
  sessionState,
  sessionExpiresAt,
  onSessionRetry,
}: {
  locale: Locale;
  easyMode: boolean;
  principalUserId: string | null;
  sessionState: ParentSessionState;
  sessionExpiresAt: number | string | null;
  onSessionRetry: () => void;
}) {
  const [inputs, setInputs] = useState<InputState>(emptyInputs);
  const [drafts, setDrafts] = useState<InputState>(emptyInputs);
  const [inputUnit, setInputUnit] = useState<ManualMoneyUnit>("won");
  const [useForAi, setUseForAi] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [initialLoadResolved, setInitialLoadResolved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [hasServerSnapshot, setHasServerSnapshot] = useState(false);
  const [legacyAmounts, setLegacyAmounts] = useState<typeof EMPTY_MANUAL_FINANCE_AMOUNTS | null>(null);
  const [legacyImported, setLegacyImported] = useState(false);
  const titleId = useId();
  const unitHelpId = useId();
  const t = copy[locale];
  const inputsRef = useRef(inputs);
  const inputUnitRef = useRef(inputUnit);
  const inputRefs = useRef<Partial<Record<ManualFinanceField, HTMLInputElement | null>>>({});
  const useForAiRef = useRef(useForAi);
  const editRevisionRef = useRef(0);
  const loadRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const activePrincipalRef = useRef<string | null>(null);
  const legacyImportedRef = useRef(false);
  const allowDraftNavigationRef = useRef(false);
  const summary = useMemo(() => manualFinanceSummary(inputs), [inputs]);
  const money = (value: number) => new Intl.NumberFormat(localeTags[locale], {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);

  const enterAnonymousMode = useCallback(() => {
    // Never carry a server-loaded workbook across an expired session. Only a
    // genuinely anonymous, unbound draft may be restored in signed-out mode.
    const draftAmounts = readAnonymousDraft();
    const nextInputs = draftAmounts
      ? canonicalStateFromAmounts(draftAmounts)
      : emptyInputs;
    inputsRef.current = nextInputs;
    useForAiRef.current = false;
    setInputs(nextInputs);
    setDrafts(displayStateFromCanonical(nextInputs, inputUnitRef.current));
    setUseForAi(false);
    setUpdatedAt(null);
    setHasServerSnapshot(false);
    setLegacyAmounts(null);
    setLegacyImported(false);
    legacyImportedRef.current = false;
    setDirty(Boolean(draftAmounts));
    setAuthState("anonymous");
    setInitialLoadResolved(true);
  }, []);

  const loadSnapshot = useCallback(async (
    expectedPrincipal: string,
    mode: "replace" | "validate" = "replace",
  ) => {
    if (activePrincipalRef.current !== expectedPrincipal) return;
    const requestId = ++loadRequestRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FINANCE_SNAPSHOT_REQUEST_TIMEOUT_MS);
    if (mode === "replace") {
      setAuthState("loading");
      setSaveError(false);
      setDeleteError(false);
    }

    try {
      const response = await fetch("/api/finance/snapshot", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as unknown;
      if (
        (controller.signal.aborted && !timedOut)
        || requestId !== loadRequestRef.current
        || activePrincipalRef.current !== expectedPrincipal
      ) return;
      if (timedOut) throw new Error("snapshot_load_timeout");
      if (response.status === 401) {
        enterAnonymousMode();
        return;
      }
      const parsed = parseSnapshotPayload(body);
      if (!response.ok || !parsed) throw new Error("snapshot_load_failed");
      if (!parsed.authenticated) {
        enterAnonymousMode();
        return;
      }
      if (parsed.principalKey !== expectedPrincipal) {
        enterAnonymousMode();
        setAuthState("unavailable");
        return;
      }
      // A focus/visibility probe exists only to detect a revoked session. It
      // must not replace unsaved edits with an older server snapshot.
      if (mode === "validate") return;

      const nextInputs = canonicalStateFromAmounts(parsed.amounts);
      setInputs(nextInputs);
      setDrafts(displayStateFromCanonical(nextInputs, inputUnitRef.current));
      inputsRef.current = nextInputs;
      setUseForAi(parsed.useForAi);
      useForAiRef.current = parsed.useForAi;
      setUpdatedAt(parsed.updatedAt);
      setHasServerSnapshot(parsed.hasSnapshot);
      setDirty(false);
      setAuthState("signed-in");
      setInitialLoadResolved(true);

      discardUnboundLegacyFinance();
      const anonymousDraft = claimAnonymousDraft(expectedPrincipal);
      if (anonymousDraft) {
        setLegacyAmounts(anonymousDraft);
      } else {
        setLegacyAmounts(null);
      }
    } catch {
      if (
        (controller.signal.aborted && !timedOut)
        || requestId !== loadRequestRef.current
        || activePrincipalRef.current !== expectedPrincipal
      ) return;
      if (mode === "validate") return;
      setAuthState("unavailable");
      setInitialLoadResolved(true);
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === loadRequestRef.current) loadAbortRef.current = null;
    }
  }, [enterAnonymousMode]);

  useEffect(() => {
    discardUnboundLegacyFinance();
  }, []);

  useEffect(() => {
    loadRequestRef.current += 1;
    saveRequestRef.current += 1;
    loadAbortRef.current?.abort();
    saveAbortRef.current?.abort();
    loadAbortRef.current = null;
    saveAbortRef.current = null;

    const expiresAt = sessionExpiryTime(sessionExpiresAt);
    const nextPrincipal = sessionState === "signed-in"
      && principalUserId
      && (!expiresAt || expiresAt > Date.now())
      ? principalUserId
      : null;
    const principalChanged = activePrincipalRef.current !== nextPrincipal;
    activePrincipalRef.current = nextPrincipal;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setSaving(false);
      setDeleting(false);

      if (!nextPrincipal) {
        enterAnonymousMode();
        if (sessionState === "unavailable") setAuthState("unavailable");
        return;
      }

      if (principalChanged) {
        inputsRef.current = emptyInputs;
        useForAiRef.current = false;
        setInputs(emptyInputs);
        setDrafts(emptyInputs);
        setUseForAi(false);
        setUpdatedAt(null);
        setHasServerSnapshot(false);
        setLegacyAmounts(null);
        setLegacyImported(false);
        legacyImportedRef.current = false;
        setDirty(false);
        setInitialLoadResolved(false);
        setAuthState("loading");
      }
      void loadSnapshot(nextPrincipal);
    });
    return () => { cancelled = true; };
  }, [enterAnonymousMode, loadSnapshot, principalUserId, sessionExpiresAt, sessionState]);

  useEffect(() => {
    const expiresAt = sessionExpiryTime(sessionExpiresAt);
    if (sessionState !== "signed-in" || !principalUserId || !expiresAt) return;
    let timeoutId = 0;
    const expireAtDeadline = () => {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        timeoutId = window.setTimeout(expireAtDeadline, Math.min(remaining, 2_147_483_647));
        return;
      }
      loadRequestRef.current += 1;
      saveRequestRef.current += 1;
      loadAbortRef.current?.abort();
      saveAbortRef.current?.abort();
      activePrincipalRef.current = null;
      setSaving(false);
      setDeleting(false);
      enterAnonymousMode();
    };
    expireAtDeadline();
    return () => window.clearTimeout(timeoutId);
  }, [enterAnonymousMode, principalUserId, sessionExpiresAt, sessionState]);

  useEffect(() => {
    const revalidate = () => {
      const expiresAt = sessionExpiryTime(sessionExpiresAt);
      if (
        authState === "signed-in"
        && initialLoadResolved
        && sessionState === "signed-in"
        && principalUserId
        && (!expiresAt || expiresAt > Date.now())
        && activePrincipalRef.current === principalUserId
      ) {
        void loadSnapshot(principalUserId, "validate");
      }
    };
    const revalidateWhenVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidateWhenVisible);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidateWhenVisible);
    };
  }, [authState, initialLoadResolved, loadSnapshot, principalUserId, sessionExpiresAt, sessionState]);

  useEffect(() => () => {
    loadRequestRef.current += 1;
    saveRequestRef.current += 1;
    loadAbortRef.current?.abort();
    saveAbortRef.current?.abort();
  }, []);

  const saveSnapshot = useCallback(async () => {
    if (authState !== "signed-in" || !initialLoadResolved || saving || deleting) return;
    const expectedPrincipal = activePrincipalRef.current;
    if (!expectedPrincipal) {
      enterAnonymousMode();
      return;
    }
    const requestId = ++saveRequestRef.current;
    const revision = editRevisionRef.current;
    const amounts = manualFinanceSummary(inputsRef.current).amounts;
    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FINANCE_SNAPSHOT_REQUEST_TIMEOUT_MS);
    setSaving(true);
    setSaveError(false);
    setDeleteError(false);

    try {
      const response = await fetch("/api/finance/snapshot", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          amounts,
          useForAi: useForAiRef.current,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as unknown;
      if (
        (controller.signal.aborted && !timedOut)
        || requestId !== saveRequestRef.current
        || activePrincipalRef.current !== expectedPrincipal
      ) return;
      if (timedOut) throw new Error("snapshot_save_timeout");
      if (response.status === 401) {
        enterAnonymousMode();
        return;
      }
      const parsed = parseSnapshotPayload(body);
      if (
        !response.ok
        || !parsed?.authenticated
        || parsed.principalKey !== expectedPrincipal
        || !parsed.hasSnapshot
      ) {
        throw new Error("snapshot_save_failed");
      }
      setUpdatedAt(parsed.updatedAt);
        setHasServerSnapshot(true);
      if (revision === editRevisionRef.current) setDirty(false);
      if (legacyImportedRef.current) {
        discardUnboundLegacyFinance();
        clearAnonymousDraft();
        legacyImportedRef.current = false;
        setLegacyImported(false);
        setLegacyAmounts(null);
      }
    } catch {
      if (
        (controller.signal.aborted && !timedOut)
        || requestId !== saveRequestRef.current
        || activePrincipalRef.current !== expectedPrincipal
      ) return;
      setDirty(true);
      setSaveError(true);
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === saveRequestRef.current) saveAbortRef.current = null;
      if (requestId === saveRequestRef.current) setSaving(false);
    }
  }, [authState, deleting, enterAnonymousMode, initialLoadResolved, saving]);

  useEffect(() => {
    if (
      authState !== "signed-in"
      || !initialLoadResolved
      || !dirty
      || saving
      || deleting
      || saveError
    ) return;
    const timer = window.setTimeout(() => void saveSnapshot(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [authState, deleting, dirty, initialLoadResolved, saveError, saveSnapshot, saving]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if (allowDraftNavigationRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  function update(field: ManualFinanceField, value: string, selectionStart: number | null) {
    const normalizedDraft = normalizeManualMoneyInput(value, inputUnitRef.current);
    const canonicalWon = canonicalWonFromMoneyInput(normalizedDraft, inputUnitRef.current);
    const nextInputs = { ...inputsRef.current, [field]: canonicalWon };
    const logicalRight = value.slice(selectionStart ?? value.length).replaceAll(",", "").length;
    inputsRef.current = nextInputs;
    allowDraftNavigationRef.current = false;
    setInputs(nextInputs);
    setDrafts((current) => ({ ...current, [field]: normalizedDraft }));
    if (authState === "anonymous") writeAnonymousDraft(nextInputs);
    editRevisionRef.current += 1;
    setDirty(true);
    setSaveError(false);
    setDeleteError(false);
    window.requestAnimationFrame(() => {
      const input = inputRefs.current[field];
      if (!input || document.activeElement !== input) return;
      const nextCaret = caretFromLogicalRight(normalizedDraft, logicalRight);
      input.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function finishEditing(field: ManualFinanceField) {
    setDrafts((current) => ({
      ...current,
      [field]: inputsRef.current[field]
        ? formatCanonicalWonInput(inputsRef.current[field], inputUnitRef.current)
        : "",
    }));
  }

  function changeInputUnit(nextUnit: ManualMoneyUnit) {
    if (nextUnit === inputUnitRef.current) return;
    inputUnitRef.current = nextUnit;
    setInputUnit(nextUnit);
    setDrafts(displayStateFromCanonical(inputsRef.current, nextUnit));
  }

  function updateAiConsent(next: boolean) {
    useForAiRef.current = next;
    setUseForAi(next);
    editRevisionRef.current += 1;
    setDirty(true);
    setSaveError(false);
    setDeleteError(false);
  }

  function importLegacy() {
    if (!legacyAmounts || authState !== "signed-in") return;
    const next = canonicalStateFromAmounts(legacyAmounts);
    inputsRef.current = next;
    setInputs(next);
    setDrafts(displayStateFromCanonical(next, inputUnitRef.current));
    legacyImportedRef.current = true;
    setLegacyImported(true);
    editRevisionRef.current += 1;
    setDirty(true);
    setSaveError(false);
    setDeleteError(false);
  }

  async function clear() {
    if (saving || deleting) return;
    allowDraftNavigationRef.current = false;
    if (authState === "signed-in" && hasServerSnapshot) {
      if (!window.confirm(t.clearConfirm)) return;
      const requestId = ++saveRequestRef.current;
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, FINANCE_SNAPSHOT_REQUEST_TIMEOUT_MS);
      setDeleting(true);
      setSaveError(false);
      setDeleteError(false);
      try {
        const response = await fetch("/api/finance/snapshot", {
          method: "DELETE",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if ((controller.signal.aborted && !timedOut) || requestId !== saveRequestRef.current) return;
        if (timedOut) throw new Error("snapshot_delete_timeout");
        if (response.status === 401) {
          enterAnonymousMode();
          return;
        }
        if (!response.ok) throw new Error("snapshot_delete_failed");
        inputsRef.current = emptyInputs;
        useForAiRef.current = false;
        setInputs(emptyInputs);
        setDrafts(emptyInputs);
        setUseForAi(false);
        setDirty(false);
        setUpdatedAt(null);
        setHasServerSnapshot(false);
        setLegacyAmounts(null);
        setLegacyImported(false);
        legacyImportedRef.current = false;
        discardUnboundLegacyFinance();
        clearAnonymousDraft();
      } catch {
        if ((controller.signal.aborted && !timedOut) || requestId !== saveRequestRef.current) return;
        setDeleteError(true);
      } finally {
        window.clearTimeout(timeoutId);
        if (requestId === saveRequestRef.current) saveAbortRef.current = null;
        if (requestId === saveRequestRef.current) setDeleting(false);
      }
      return;
    }

    inputsRef.current = emptyInputs;
    useForAiRef.current = false;
    setInputs(emptyInputs);
    setDrafts(emptyInputs);
    setUseForAi(false);
    setDirty(false);
    setSaveError(false);
    setDeleteError(false);
    setLegacyImported(false);
    legacyImportedRef.current = false;
    setLegacyAmounts(null);
    discardUnboundLegacyFinance();
    clearAnonymousDraft();
  }

  function preserveDraftBeforeSignIn() {
    if (authState === "anonymous") {
      writeAnonymousDraft(inputsRef.current);
      allowDraftNavigationRef.current = true;
    }
  }

  const fieldGroups: Array<{ title: string; fields: ManualFinanceField[] }> = [
    { title: t.assetInputs, fields: ["cashAndDeposits", "investments", "otherAssets", "liabilities"] },
    { title: t.cashflowInputs, fields: ["monthlyIncome", "fixedExpenses", "variableExpenses", "debtPayment"] },
  ];
  const assetData = summary.assetComposition
    .filter((item) => item.value > 0)
    .map((item) => ({ ...item, name: t[item.id], fill: colors[item.id] }));
  const cashflowData = summary.cashflow
    .filter((item) => item.value > 0)
    .map((item) => ({
      ...item,
      name: t[item.id],
      fill: colors[item.id],
    }));
  const savedTime = updatedAt !== null && !Number.isNaN(new Date(updatedAt).getTime())
    ? new Intl.DateTimeFormat(localeTags[locale], {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(updatedAt))
    : null;
  const canEdit = authState === "signed-in" || authState === "anonymous";
  const status = authState === "loading"
    ? { state: "loading", title: t.loadingTitle, body: t.loadingBody, icon: <LoaderCircle size={18} /> }
    : authState === "unavailable"
      ? { state: "error", title: t.unavailableTitle, body: t.unavailableBody, icon: <CloudOff size={18} /> }
      : authState === "anonymous"
        ? { state: "anonymous", title: t.signedOutTitle, body: t.signedOutBody, icon: <CloudOff size={18} /> }
        : deleteError
          ? { state: "error", title: t.deleteErrorTitle, body: t.deleteErrorBody, icon: <CircleAlert size={18} /> }
          : saveError
          ? { state: "error", title: t.saveErrorTitle, body: t.saveErrorBody, icon: <CircleAlert size={18} /> }
          : saving || deleting
            ? { state: "saving", title: t.savingTitle, body: t.savingBody, icon: <LoaderCircle size={18} /> }
            : dirty
              ? { state: "dirty", title: t.dirtyTitle, body: t.dirtyBody, icon: <Cloud size={18} /> }
              : updatedAt !== null
                ? { state: "saved", title: t.savedTitle, body: `${t.savedAt}: ${savedTime ?? updatedAt}`, icon: <Cloud size={18} /> }
                : { state: "ready", title: t.readyTitle, body: t.readyBody, icon: <Cloud size={18} /> };

  return <section className={`${styles.workbook} ${easyMode ? styles.easy : ""}`} aria-labelledby={titleId}>
    <header className={styles.heading}>
      <div className={styles.headingIcon}><WalletCards size={23} /></div>
      <div><span>{t.eyebrow}</span><h2 id={titleId}>{t.title}</h2><p>{t.lead}</p></div>
      <div className={styles.controls}>
        {authState === "signed-in" && <button type="button" className={styles.primaryAction} disabled={!dirty || saving || deleting} onClick={() => void saveSnapshot()}><Save size={16} />{saving ? t.saving : t.save}</button>}
        <button type="button" disabled={authState === "loading" || saving || deleting} onClick={() => void clear()}><RotateCcw size={16} />{deleting ? t.deleting : t.clear}</button>
      </div>
    </header>

    <div className={styles.syncNotice} data-state={status.state} role="status" aria-live="polite">
      <span className={styles.syncIcon}>{status.icon}</span>
      <span><strong>{status.title}</strong><small>{status.body}</small></span>
      {authState === "anonymous" && <a href="/mypage" onClick={preserveDraftBeforeSignIn}>{t.signIn}</a>}
      {authState === "unavailable" && <button type="button" onClick={() => {
        const principal = activePrincipalRef.current;
        if (principal) void loadSnapshot(principal);
        else onSessionRetry();
      }}><RefreshCw size={15} />{t.retry}</button>}
      {authState === "signed-in" && deleteError && <button type="button" onClick={() => void clear()}><RefreshCw size={15} />{t.retry}</button>}
      {authState === "signed-in" && saveError && <button type="button" onClick={() => void saveSnapshot()}><RefreshCw size={15} />{t.retry}</button>}
    </div>

    {authState === "signed-in" && legacyAmounts && !legacyImported && <aside className={styles.legacyNotice}>
      <Database size={19} />
      <span>
        <strong>{t.draftTitle}</strong>
        <small>{t.draftBody}</small>
      </span>
      <button type="button" onClick={importLegacy}>
        {t.draftImport}
      </button>
    </aside>}

    <p className={styles.privacy}><LockKeyhole size={16} /><span>{t.privacy}</span></p>

    <fieldset className={styles.unitChooser}>
      <legend>{t.unitLegend}</legend>
      <div>
        <label>
          <input
            type="radio"
            name={`${titleId}-money-unit`}
            value="won"
            checked={inputUnit === "won"}
            onChange={() => changeInputUnit("won")}
          />
          <span>{t.won}</span>
        </label>
        <label>
          <input
            type="radio"
            name={`${titleId}-money-unit`}
            value="manwon"
            checked={inputUnit === "manwon"}
            onChange={() => changeInputUnit("manwon")}
          />
          <span>{t.manwon}</span>
        </label>
      </div>
      <p id={unitHelpId} aria-live="polite">
        {inputUnit === "won" ? t.unitHelpWon : t.unitHelpManwon}
      </p>
    </fieldset>

    <div className={styles.inputGrid}>
      {fieldGroups.map((group) => <fieldset key={group.title}>
        <legend>{group.title}</legend>
        <div>{group.fields.map((field) => <label key={field}>
          <span>{t[field]}</span>
          <span className={styles.amountInput}>
            <input
              ref={(node) => { inputRefs.current[field] = node; }}
              type="text"
              inputMode={inputUnit === "won" ? "numeric" : "decimal"}
              autoComplete="off"
              disabled={!canEdit}
              value={drafts[field]}
              onChange={(event) => update(field, event.target.value, event.target.selectionStart)}
              onBlur={() => finishEditing(field)}
              aria-describedby={unitHelpId}
              aria-label={`${t[field]} (${inputUnit === "won" ? t.won : t.manwon})`}
            />
            <em>{inputUnit === "won" ? t.won : t.manwon}</em>
          </span>
        </label>)}</div>
      </fieldset>)}
    </div>

    <label className={styles.aiConsent}>
      <input type="checkbox" checked={useForAi} disabled={authState !== "signed-in"} onChange={(event) => updateAiConsent(event.target.checked)} />
      <span><strong>{t.aiUseTitle}</strong><small>{t.aiUseBody}</small></span>
    </label>

    <div className={styles.metrics} aria-live="polite">
      <article><span>{t.totalAssets}</span><strong>{money(summary.totalAssets)}</strong></article>
      <article data-negative={summary.netAssets < 0}><span>{t.netAssets}</span><strong>{money(summary.netAssets)}</strong></article>
      <article data-negative={summary.monthlyBalance < 0}><span>{t.monthlyBalance}</span><strong>{money(summary.monthlyBalance)}</strong></article>
      <article><span>{t.debtRatio}</span><strong>{summary.debtPaymentRatio === null ? t.needsIncome : `${summary.debtPaymentRatio.toFixed(1)}%`}</strong></article>
    </div>

    <div className={styles.charts}>
      <article>
        <h3>{t.assetChart}</h3>
        {assetData.length ? <div className={styles.chart} role="img" aria-label={t.assetChart}>
          <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={assetData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3} stroke="none">{assetData.map((item) => <Cell key={item.id} fill={item.fill} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${money(Number(value))} · ${Number(item.payload.sharePercent).toFixed(1)}%`, item.payload.name]} /></PieChart></ResponsiveContainer>
        </div> : <div className={styles.emptyChart}><Database size={24} /><p>{t.emptyChart}</p></div>}
        <ul>{assetData.map((item) => <li key={item.id}><i style={{ background: item.fill }} /><span>{item.name}</span><strong>{money(item.value)} · {item.sharePercent.toFixed(1)}%</strong></li>)}</ul>
      </article>
      <article>
        <h3>{t.cashflowChart}</h3>
        {cashflowData.length ? <div className={styles.chart} role="img" aria-label={t.cashflowChart}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={cashflowData} layout="vertical" margin={{ left: 8, right: 16 }}><CartesianGrid horizontal={false} stroke="#eeeaf7" /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={easyMode ? 115 : 88} tickLine={false} axisLine={false} tick={{ fill: "#6f687b", fontSize: easyMode ? 13 : 11 }} /><Tooltip formatter={(value, _name, item) => [`${money(Number(value))} · ${Number(item.payload.sharePercent).toFixed(1)}%`, item.payload.name]} /><Bar dataKey="value" radius={[0, 7, 7, 0]}>{cashflowData.map((item) => <Cell key={item.id} fill={item.fill} />)}</Bar></BarChart></ResponsiveContainer>
        </div> : <div className={styles.emptyChart}><Database size={24} /><p>{t.emptyChart}</p></div>}
        <ul>{cashflowData.map((item) => <li key={item.id}><i style={{ background: item.fill }} /><span>{item.name}</span><strong>{money(item.value)} · {item.sharePercent.toFixed(1)}%</strong></li>)}</ul>
      </article>
    </div>

    <p className={styles.disclaimer}><ShieldCheck size={17} /><span>{t.disclaimer}</span></p>
  </section>;
}
