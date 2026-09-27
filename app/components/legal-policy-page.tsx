import type { ComponentType } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Database,
  FileCheck2,
  Languages,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/auth/account-lifecycle";

import styles from "./legal-policy-page.module.css";
import { legalContactMailto, normalizeLegalContactEmail } from "@/lib/legal/contact";
import { environmentValue } from "@/lib/runtime-settings";

export type LegalPolicyKind = "privacy" | "terms";
export type LegalPolicyLocale = "ko" | "en" | "ja" | "zh";

type PolicyItem = {
  title: string;
  body: string;
};

type PolicySection = {
  id: string;
  title: string;
  lead?: string;
  items: readonly PolicyItem[];
};

type PolicyCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  notice: string;
  updated: string;
  version: string;
  summaryTitle: string;
  summaries: readonly PolicyItem[];
  quickNav: string;
  sections: readonly PolicySection[];
};

type SharedCopy = {
  skip: string;
  home: string;
  account: string;
  language: string;
  current: string;
  contact: string;
  contactLead: string;
  privacy: string;
  terms: string;
  footer: string;
};

const LOCALE_LABELS: Record<LegalPolicyLocale, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "简体中文",
};

const CONTACT_PLACEHOLDER = "{{CONTACT_EMAIL}}";
const CONTACT_UNAVAILABLE: Record<LegalPolicyLocale, string> = {
  ko: "운영자 문의 이메일 준비 중",
  en: "Operator contact email is being prepared",
  ja: "運営者の連絡先メールは準備中です",
  zh: "运营方联系邮箱准备中",
};

const SHARED: Record<LegalPolicyLocale, SharedCopy> = {
  ko: {
    skip: "본문으로 바로가기",
    home: "BORA 홈",
    account: "로그인 · 마이페이지",
    language: "언어 선택",
    current: "현재 언어",
    contact: "문의하기",
    contactLead: "개인정보, 계정 삭제 또는 약관 관련 문의",
    privacy: "개인정보 처리방침",
    terms: "이용약관",
    footer: "BORA Bridge는 금융 계약이나 투자 판단을 대신하지 않는 개인 개발 정보 서비스입니다.",
  },
  en: {
    skip: "Skip to main content",
    home: "BORA home",
    account: "Sign in · My page",
    language: "Choose language",
    current: "Current language",
    contact: "Contact",
    contactLead: "Questions about privacy, account deletion, or these terms",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    footer: "BORA Bridge is an independently developed information service and does not replace a financial contract or investment decision.",
  },
  ja: {
    skip: "本文へ移動",
    home: "BORAホーム",
    account: "ログイン・マイページ",
    language: "言語を選択",
    current: "現在の言語",
    contact: "お問い合わせ",
    contactLead: "個人情報、アカウント削除、利用規約に関するお問い合わせ",
    privacy: "プライバシーポリシー",
    terms: "利用規約",
    footer: "BORA Bridgeは個人開発の情報サービスであり、金融契約や投資判断を代行するものではありません。",
  },
  zh: {
    skip: "跳至正文",
    home: "BORA首页",
    account: "登录 · 我的页面",
    language: "选择语言",
    current: "当前语言",
    contact: "联系我们",
    contactLead: "有关隐私、账户删除或条款的问题",
    privacy: "隐私政策",
    terms: "使用条款",
    footer: "BORA Bridge是个人开发的信息服务，不代替金融合同或投资决策。",
  },
};

const PRIVACY_COPY: Record<LegalPolicyLocale, PolicyCopy> = {
  ko: {
    eyebrow: "PRIVACY · PLAIN LANGUAGE",
    title: "개인정보 처리방침",
    lead: "BORA Bridge가 어떤 정보를 왜 저장하는지, 사용자가 어떻게 통제하고 삭제할 수 있는지 쉬운 말로 설명합니다.",
    notice: "BORA Bridge는 계좌·카드 거래내역을 자동으로 가져오는 마이데이터 서비스를 사용하지 않습니다. 자산 정보는 사용자가 직접 입력한 항목별 합계만 저장합니다.",
    updated: "시행일",
    version: CURRENT_PRIVACY_VERSION,
    summaryTitle: "한눈에 보는 처리 원칙",
    summaries: [
      { title: "로그인에 필요한 정보", body: "네이버·카카오가 제공한 고유 식별자와 사용자가 동의한 프로필, 보안용 세션 정보를 처리합니다." },
      { title: "사용자가 직접 저장한 정보", body: "표시 이름, 정책·창업 맞춤 조건, 자산·부채·월 현금흐름의 항목별 합계만 계정에 저장합니다." },
      { title: "AI 맥락은 기본 OFF", body: "기억, 최근 대화 발췌, 최근 활동은 각각 사용자가 켠 경우에만 저장·조회·활용합니다." },
    ],
    quickNav: "내용 바로가기",
    sections: [
      {
        id: "data",
        title: "1. 수집·저장하는 항목",
        lead: "서비스 이용 방식에 따라 아래 항목 중 필요한 범위만 처리합니다.",
        items: [
          { title: "OAuth 계정 및 세션", body: "로그인 제공사, 제공사 고유 사용자 ID, 표시 이름, 이름·별명, 이메일과 확인 상태, 프로필 이미지, 성별, 생일·출생연도·연령대(제공 및 동의된 경우), 세션 토큰의 해시와 생성·만료·최근 사용 시각을 처리합니다. 제공사 access token은 저장하지 않습니다." },
          { title: "직접 입력 및 맞춤 설정", body: "BORA 별명과 표시 방식, 청년정책·창업 맞춤 여부와 출생연도·광역지역·현재 상태·관심분야, 자산·투자·기타자산·부채·월소득·고정비·변동비·부채상환액의 합계와 금액 단위·AI 활용 동의를 저장할 수 있습니다." },
          { title: "이용 기록과 보안 기록", body: "공공정보 읽음 표시, AI 상담의 주제·언어·근거 수, API 남용 방지를 위한 제한 구간과 호출 수, 검색 제한 기록을 저장합니다. 원문 질문·답변 전문을 AI 통계 목적으로 저장하지 않습니다." },
          { title: "선택한 피싱 문자 점검", body: "클립보드 가져오기는 화면에서 이번 한 번의 읽기에 동의하고 버튼을 누른 경우에만 브라우저 안에서 시도하며, 이 체크 상태를 저장하지 않고 브라우저의 사이트 권한과도 별개입니다. 가져온 텍스트는 ‘위험 분석하기’를 누르기 전까지 서버로 보내지 않습니다. 분석을 누른 경우에만 입력한 문자 텍스트를 동일 출처 서버에서 일회성 규칙 분석에 사용하며 원문을 저장하지 않습니다. 입력 전에 발신자 번호 등 식별정보를 삭제해 주세요. 메시지 속 URL의 Google 평판 조회는 별도 동의가 있을 때만 동작합니다." },
          { title: "브라우저에만 남는 설정", body: "언어, 쉬움 모드, 홈 배치, 선택 통화, 최근 메뉴와 임시 입력 초안은 브라우저 저장소에 남을 수 있습니다. 브라우저 설정에서 직접 지울 수 있습니다." },
        ],
      },
      {
        id: "purpose",
        title: "2. 이용 목적",
        items: [
          { title: "계정과 동기화", body: "사용자를 식별하고 로그인 상태를 유지하며, 같은 OAuth 계정으로 다른 기기에서도 직접 입력한 장부와 맞춤 설정을 불러오기 위해 사용합니다." },
          { title: "맞춤 정보와 AI 상담", body: "사용자가 입력한 조건으로 정책·창업 후보를 좁히고, 명시적으로 동의한 경우 로컬 AI 답변을 개인화하기 위해 사용합니다." },
          { title: "안전한 운영", body: "비정상 요청과 과도한 호출을 제한하고, 필수 동의 이력을 확인하며, 오류 대응과 서비스 안정성을 유지하기 위해 사용합니다." },
        ],
      },
      {
        id: "oauth",
        title: "3. OAuth 제공사와 외부 처리",
        items: [
          { title: "네이버·카카오 로그인", body: "현재 사용자 화면에서는 네이버와 카카오 로그인을 제공합니다. 로그인 시 해당 제공사의 인증 화면으로 이동하며, 제공사가 표시한 동의 항목을 사용자가 선택합니다. BORA Bridge는 비밀번호를 받거나 저장하지 않습니다." },
          { title: "AI 제공사", body: "운영자가 외부 AI를 명시적으로 활성화한 경우 현재 질문과 선택된 공개 근거가 해당 제공사로 전송될 수 있습니다. 저장된 개인 기억·최근 대화·최근 활동과 직접 입력 금융 스냅샷은 로컬 AI에서만 사용하며 외부 유료 AI에는 전달하지 않습니다." },
          { title: "악성 URL 평판 조회(선택)", body: "피싱 점검에서 사용자가 별도 체크한 경우에만 쿼리·프래그먼트를 뺀 URL의 스킴·호스트·경로를 Google Safe Browsing에 전송할 수 있습니다. BORA Bridge는 조회 원문을 영구 저장하지 않고 URL의 SHA-256 키를 최대 30분 동안만 재사용하며 만료 키는 다음 조회 때 메모리에서 정리합니다. 외부 조회 남용 방지를 위해 원본 네트워크 주소 대신 제공자 비밀키로 만든 일 단위 HMAC-SHA-256 쿼터 키를 사용하고, 48시간이 지난 키는 다음 외부 조회 때 삭제 대상으로 정리합니다. Google은 제출된 URL과 관련 데이터를 자체 정책 및 Safe Browsing 약관에 따라 사용하거나 공유할 수 있습니다. Google의 처리에는 해당 제공사의 정책이 적용되며 오탐·미탐 가능성이 있습니다." },
          { title: "공식 출처와 인프라", body: "공공 API와 공식 사이트의 정보를 가져오며, 공식 원문 링크를 제공합니다. Cloudflare는 도메인 연결·보안 전송 과정에서 통신 정보를 처리할 수 있습니다. 각 외부 사이트에는 해당 사업자의 정책이 적용됩니다." },
        ],
      },
      {
        id: "ai",
        title: "4. AI 기억·대화·최근 활동 선택 기능",
        lead: "세 기능은 서로 독립적이며 모두 기본값이 OFF입니다.",
        items: [
          { title: "핵심 기억", body: "사용자가 켠 경우 개인정보를 줄인 짧은 목표·선호 요약을 저장합니다. 끄거나 삭제하면 이후 답변에 사용하지 않습니다." },
          { title: "최근 대화 맥락", body: "사용자가 켠 경우 일부 직접 식별자를 자동 제거한 질문·답변 발췌를 최대 6건, 최대 30일 보관하고 로컬 AI에 과거 대화로 전달합니다. 자동 제거가 완벽하지 않을 수 있으므로 민감정보를 입력하지 마세요." },
          { title: "최근 활동", body: "사용자가 켠 경우 검색어·자유 입력 URL 없이 메뉴, 공식 정책·고용 항목 ID, 선택 통화를 최대 40건, 최대 30일 보관합니다." },
          { title: "사용자 통제", body: "AI 상담 화면에서 각 기능을 켜거나 끄고 저장 내용을 따로 삭제할 수 있습니다. 필수 약관 동의가 없거나 외부 AI가 선택되면 저장된 개인 맥락을 적용하지 않습니다." },
        ],
      },
      {
        id: "retention",
        title: "5. 보유 기간과 삭제",
        items: [
          { title: "짧은 보안 기록", body: "OAuth 시작 거래는 약 10분 동안 유효하며, 사용되거나 만료된 기록은 보안 확인을 위해 제한된 기간 뒤 정리합니다. 로그인 세션은 로그아웃하거나 설정된 만료 시각이 지나면 사용할 수 없습니다." },
          { title: "계정 데이터", body: "프로필, 직접 입력 장부, 맞춤 설정과 필수 동의 이력은 계정 삭제 또는 해당 기능의 삭제 요청 전까지 보관합니다. 법령상 별도 보존 의무가 생기면 해당 기간만 분리 보관할 수 있습니다." },
          { title: "삭제 방법", body: "마이페이지에서 AI 맥락·맞춤 정보·직접 입력 장부를 개별 삭제하거나 계정 전체 삭제를 요청할 수 있습니다. 계정 삭제 시 사용자 소유 데이터와 로그인 세션을 함께 삭제합니다." },
          { title: "운영 소유 계정", body: "API 키나 서비스 설정의 마지막 운영 소유 계정은 안전한 권한 이전 전 계정 삭제가 제한될 수 있습니다. 권한을 이전한 뒤 다시 삭제할 수 있습니다." },
        ],
      },
      {
        id: "mydata",
        title: "6. 마이데이터와 민감정보",
        items: [
          { title: "마이데이터 미사용", body: "현재 BORA Bridge는 금융기관 마이데이터 API, 오픈뱅킹 또는 카드사 계정과 연결하지 않습니다. 실제 잔액·거래내역·신용정보를 자동 조회하지 않습니다." },
          { title: "입력하지 말아야 할 정보", body: "계좌번호, 카드번호, 비밀번호, OTP, 주민등록번호, 외국인등록번호, 보험 원문 문서와 같은 민감정보를 입력하지 마세요. 서비스는 이러한 정보를 요구하지 않습니다." },
        ],
      },
      {
        id: "rights",
        title: "7. 이용자의 권리와 보호조치",
        items: [
          { title: "열람·정정·삭제", body: "마이페이지에서 저장 항목 수와 프로필을 확인하고 표시 이름을 정정할 수 있습니다. 개별 기능의 삭제 또는 계정 전체 삭제를 요청할 수 있습니다." },
          { title: "보호조치", body: "세션 쿠키는 HttpOnly·SameSite 속성을 사용하고 HTTPS에서는 Secure로 전송합니다. 서버에는 세션 원문 대신 해시를 저장하며, 개발자 기능은 로그인 후 서버에서 권한을 다시 확인합니다." },
        ],
      },
      {
        id: "contact",
        title: "8. 문의와 변경 안내",
        items: [
          { title: "운영 주체", body: "BORA Bridge 개인 개발 프로젝트" },
          { title: "문의처", body: "{{CONTACT_EMAIL}} · 개인정보 열람, 정정, 삭제 또는 처리방침 관련 문의를 받습니다." },
          { title: "변경 안내", body: "처리 항목이나 목적이 중요하게 바뀌면 시행 전에 서비스 화면에서 알리고, 필요한 경우 새 버전에 대한 동의를 다시 받습니다." },
        ],
      },
    ],
  },
  en: {
    eyebrow: "PRIVACY · PLAIN LANGUAGE",
    title: "Privacy Policy",
    lead: "This policy explains in plain language what BORA Bridge stores, why it is used, and how you can control or delete it.",
    notice: "BORA Bridge does not use a MyData connection to import bank or card transactions. It stores only the category totals that you enter yourself.",
    updated: "Effective date",
    version: CURRENT_PRIVACY_VERSION,
    summaryTitle: "Privacy at a glance",
    summaries: [
      { title: "Data needed for sign-in", body: "We process a Naver or Kakao identifier, profile fields you permit, and security session data." },
      { title: "Information you save", body: "Your display choice, opportunity profile, and category totals for assets, debt, and monthly cash flow can be saved to your account." },
      { title: "AI context starts OFF", body: "Memory, recent chat excerpts, and recent activity are stored and used only when you turn on each separate option." },
    ],
    quickNav: "On this page",
    sections: [
      {
        id: "data", title: "1. Information we process", lead: "We process only the fields needed for the features you choose.", items: [
          { title: "OAuth account and session", body: "Provider, provider user ID, display name, name and nickname, email and verification status, profile image, gender, birthday, birth year, and age range when supplied and permitted; plus a session-token hash and creation, expiry, and last-use times. Provider access tokens are not stored." },
          { title: "Manual entries and preferences", body: "BORA alias and display mode; whether personalization is enabled and its birth year, broad region, current status, and interests; totals for cash, investments, other assets, liabilities, monthly income, fixed and variable expenses, and debt payments; input unit and AI-use choice." },
          { title: "Usage and security records", body: "Public-item read markers, AI topic, locale and evidence count, and bounded rate-limit counters used to prevent abuse. Full questions and answers are not retained for topic statistics." },
          { title: "Selected phishing-message check", body: "Clipboard import is attempted in the browser only after you consent to this one read and press the button. The checkbox state is not stored and is separate from the browser's site permission. Imported text is not sent to the server until you choose Analyze risk. Only then is it used for a one-time, same-origin rule check; the original text is not stored. Remove identifiers such as the sender number before analysis. Google URL reputation is used only with a separate opt-in." },
          { title: "Device-only preferences", body: "Language, easy mode, home layout, currency, recent menus, and a temporary finance draft may remain in browser storage and can be cleared in your browser." },
        ],
      },
      {
        id: "purpose", title: "2. Why we use it", items: [
          { title: "Account and sync", body: "To identify you, keep a secure session, and load your manual workbook and settings on another device using the same OAuth account." },
          { title: "Personalized information and AI", body: "To narrow policy and startup notices using your chosen conditions and, only with explicit opt-in, personalize Local AI responses." },
          { title: "Safe operation", body: "To enforce required consent, limit unusual or excessive requests, investigate errors, and keep the service reliable." },
        ],
      },
      {
        id: "oauth", title: "3. OAuth providers and external processing", items: [
          { title: "Naver and Kakao", body: "The current user interface offers Naver and Kakao sign-in. You complete authentication and choose permissions on the provider's screen. BORA Bridge never receives or stores your provider password." },
          { title: "AI providers", body: "If the operator explicitly enables an external AI, your current question and selected public evidence may be sent to that provider. Saved personal memory, recent chats, recent activity, and the manual finance snapshot are used only with Local AI and are not sent to a paid external AI." },
          { title: "Optional malicious-URL reputation", body: "Only when you separately opt in during a phishing check, the URL scheme, host, and path—without query parameters or fragments—may be sent to Google Safe Browsing. BORA Bridge does not retain the submitted URL text; its SHA-256 cache key is reused for no more than 30 minutes and expired keys are cleared from memory on the next lookup. A provider-keyed daily HMAC-SHA-256 quota key is used instead of the raw network address, and keys older than 48 hours are removed during the next external lookup cleanup. Google may use the submitted URL and associated data, and may share data as permitted by its policies and Safe Browsing terms. Google's policy applies, and false positives or false negatives remain possible." },
          { title: "Official sources and infrastructure", body: "We retrieve information from public APIs and official sites and provide original links. Cloudflare may process connection metadata while providing domain and secure transport services. External sites apply their own policies." },
        ],
      },
      {
        id: "ai", title: "4. Optional AI memory, chats, and activity", lead: "The three controls are independent and default to OFF.", items: [
          { title: "Core memory", body: "When enabled, a short summary of goals or preferences with reduced personal detail is stored. Turning it off or deleting it stops future use." },
          { title: "Recent conversation context", body: "When enabled, up to 6 question-and-answer excerpts with selected direct identifiers removed are retained for up to 30 days and supplied to Local AI as prior chat. Automated removal is not perfect, so do not enter sensitive data." },
          { title: "Recent activity", body: "When enabled, up to 40 menu codes, official policy or employment item IDs, and selected currencies are retained for up to 30 days. Search terms and free-form URLs are not stored in this feature." },
          { title: "Your control", body: "You can toggle or delete each context type in AI consultation. Stored personal context is not applied without current required consent or when an external AI is selected." },
        ],
      },
      {
        id: "retention", title: "5. Retention and deletion", items: [
          { title: "Short security records", body: "An OAuth start transaction is valid for about 10 minutes. Used or expired records are cleaned after a limited security period. A session stops working after sign-out or its configured expiry." },
          { title: "Account data", body: "Profile, manual workbook, preferences, and required-consent history remain until you delete the account or the relevant feature, unless a legal retention duty applies." },
          { title: "How to delete", body: "My Page lets you separately clear AI context, personalization, and the manual workbook, or request full account deletion. Full deletion removes user-owned records and active sessions." },
          { title: "Service-owner account", body: "Deletion of the final account that owns API keys or service settings may be blocked until operational ownership is safely transferred." },
        ],
      },
      {
        id: "mydata", title: "6. MyData and sensitive information", items: [
          { title: "No MyData connection", body: "BORA Bridge currently does not connect to financial-institution MyData, open-banking, or card accounts and does not automatically retrieve balances, transactions, or credit data." },
          { title: "Do not enter", body: "Never enter an account or card number, password, OTP, national or foreign-resident ID number, or an original insurance document. The service does not ask for them." },
        ],
      },
      {
        id: "rights", title: "7. Your choices and safeguards", items: [
          { title: "Access, correction, deletion", body: "My Page shows stored-record counts and profile fields, lets you change the displayed name, and provides feature-level and full-account deletion." },
          { title: "Safeguards", body: "Session cookies use HttpOnly and SameSite and use Secure on HTTPS. Only a token hash is stored server-side, and developer access is rechecked on the server." },
        ],
      },
      {
        id: "contact", title: "8. Contact and changes", items: [
          { title: "Operator", body: "BORA Bridge independent development project" },
          { title: "Contact", body: "{{CONTACT_EMAIL}} · Contact us about access, correction, deletion, or this policy." },
          { title: "Policy changes", body: "Material changes to data or purpose will be announced before they take effect, and renewed consent will be requested when required." },
        ],
      },
    ],
  },
  ja: {
    eyebrow: "PRIVACY · PLAIN LANGUAGE",
    title: "プライバシーポリシー",
    lead: "BORA Bridgeがどの情報を、なぜ保存し、利用者がどのように管理・削除できるかを分かりやすく説明します。",
    notice: "BORA Bridgeは銀行・カードの取引明細を自動取得するマイデータ連携を利用していません。保存する資産情報は、利用者が手入力した項目別合計のみです。",
    updated: "施行日",
    version: CURRENT_PRIVACY_VERSION,
    summaryTitle: "処理方針の概要",
    summaries: [
      { title: "ログインに必要な情報", body: "Naver・Kakaoの識別子、許可されたプロフィール、セキュリティ用セッション情報を処理します。" },
      { title: "利用者が保存する情報", body: "表示名、機会マッチング条件、資産・負債・月次キャッシュフローの項目別合計を保存できます。" },
      { title: "AI文脈は初期設定オフ", body: "記憶、最近の会話抜粋、最近の操作は、それぞれ有効にした場合だけ保存・利用します。" },
    ],
    quickNav: "目次",
    sections: [
      { id: "data", title: "1. 取り扱う情報", lead: "選択した機能に必要な範囲だけを取り扱います。", items: [
        { title: "OAuthアカウント・セッション", body: "提供元、提供元ユーザーID、表示名、氏名・ニックネーム、メールと確認状態、画像、性別、生年月日・出生年・年齢層（提供・許可された場合）、セッショントークンのハッシュと作成・期限・最終利用時刻。提供元のアクセストークンは保存しません。" },
        { title: "手入力・設定", body: "BORA別名と表示方式、政策・創業マッチングの有効状態、出生年、広域地域、現在の状態、関心分野、資産・投資・その他資産・負債・月収・固定費・変動費・返済額の合計、入力単位、AI利用同意を保存できます。" },
        { title: "利用・セキュリティ記録", body: "公的情報の既読、AI相談のテーマ・言語・根拠数、不正利用を防ぐための制限区間と回数を保存します。テーマ統計のために質問・回答全文は保存しません。" },
        { title: "選択したフィッシング文面の確認", body: "クリップボードからの取り込みは、画面で今回1回の読み取りに同意してボタンを押した場合に限りブラウザ内で試行します。チェック状態は保存せず、ブラウザのサイト権限とも別です。取り込んだ本文は「危険を分析」を選ぶまでサーバーへ送信しません。分析を選んだ場合に限り、同一オリジンのサーバーで1回限りのルール確認に使い、原文は保存しません。分析前に送信者番号などの識別情報を削除してください。GoogleのURL評価は別途同意した場合だけ利用します。" },
        { title: "端末内の設定", body: "言語、かんたんモード、ホーム配置、通貨、最近のメニュー、一時的な入力下書きはブラウザに残る場合があり、ブラウザ設定から削除できます。" },
      ] },
      { id: "purpose", title: "2. 利用目的", items: [
        { title: "アカウント・同期", body: "本人を識別し、安全なログイン状態を維持し、同じOAuthアカウントで別端末から手入力台帳と設定を読み込むためです。" },
        { title: "情報の絞り込み・AI", body: "選択条件に合う政策・創業情報を絞り、明示的に同意した場合に限りLocal AIの回答を個別化するためです。" },
        { title: "安全な運営", body: "必須同意の確認、異常・過剰リクエストの制限、エラー対応、サービスの安定維持に利用します。" },
      ] },
      { id: "oauth", title: "3. OAuth提供元・外部処理", items: [
        { title: "Naver・Kakao", body: "現在はNaverとKakaoログインを提供します。認証と権限選択は提供元画面で行います。BORA Bridgeは提供元パスワードを受け取りません。" },
        { title: "AI提供元", body: "運営者が外部AIを明示的に有効化した場合、現在の質問と選択された公開根拠が送信されることがあります。保存済みの個人記憶、最近の会話・操作、手入力金融スナップショットはLocal AIだけで使い、外部有料AIには送りません。" },
        { title: "不正URL評価（任意）", body: "フィッシング確認で利用者が別途同意した場合のみ、クエリとフラグメントを除いたURLの方式・ホスト・パスをGoogle Safe Browsingへ送ることがあります。BORA BridgeはURL原文を恒久保存せず、SHA-256キャッシュキーは最大30分だけ再利用し、期限切れキーは次回照会時にメモリから整理します。元のネットワークアドレスの代わりに提供元の秘密鍵で作成した日次HMAC-SHA-256クォータキーを使用し、48時間を過ぎたキーは次回の外部照会時の整理処理で削除対象になります。Googleは、提出されたURLと関連データを自社の方針およびSafe Browsing利用規約に従って使用し、またはデータを共有することがあります。Googleの方針が適用され、誤検知・見逃しの可能性があります。" },
        { title: "公式情報・インフラ", body: "公的APIと公式サイトを利用し原文リンクを示します。Cloudflareはドメイン接続と安全な通信のため接続情報を処理する場合があります。外部サイトには各社の方針が適用されます。" },
      ] },
      { id: "ai", title: "4. AI記憶・会話・最近の操作", lead: "3項目は独立しており、すべて初期設定オフです。", items: [
        { title: "要点記憶", body: "有効時、個人情報を減らした短い目標・希望の要約を保存します。オフまたは削除後は利用しません。" },
        { title: "最近の会話", body: "有効時、一部の直接識別子を除いた問答抜粋を最大6件・30日保存し、過去会話としてLocal AIに渡します。自動除去は完全ではないため機微情報を入力しないでください。" },
        { title: "最近の操作", body: "有効時、検索語や自由入力URLを除き、メニュー、公式政策・雇用項目ID、選択通貨を最大40件・30日保存します。" },
        { title: "利用者による管理", body: "AI相談画面で個別にオン・オフ・削除できます。必須同意がない場合や外部AI選択時は保存した個人文脈を適用しません。" },
      ] },
      { id: "retention", title: "5. 保存期間・削除", items: [
        { title: "短期セキュリティ記録", body: "OAuth開始情報は約10分有効です。使用済み・期限切れ記録は限定的な安全確認期間後に整理します。セッションはログアウトまたは設定期限後に利用できません。" },
        { title: "アカウント情報", body: "プロフィール、手入力台帳、設定、必須同意履歴は、該当機能またはアカウント削除まで保存します。法令上の義務がある場合のみ必要期間を分離保存します。" },
        { title: "削除方法", body: "マイページでAI文脈、マッチング情報、手入力台帳を個別削除し、またはアカウント全体を削除できます。" },
        { title: "運営所有アカウント", body: "APIキーやサービス設定を最後に所有するアカウントは、安全な権限移管が終わるまで削除を制限する場合があります。" },
      ] },
      { id: "mydata", title: "6. マイデータ・機微情報", items: [
        { title: "マイデータ未連携", body: "現在、金融機関のマイデータ、オープンバンキング、カード口座に接続せず、残高・取引・信用情報を自動取得しません。" },
        { title: "入力しない情報", body: "口座・カード番号、パスワード、OTP、住民・外国人登録番号、保険原本などを入力しないでください。本サービスは要求しません。" },
      ] },
      { id: "rights", title: "7. 利用者の権利・保護", items: [
        { title: "確認・訂正・削除", body: "マイページで保存件数とプロフィールを確認し、表示名の訂正、機能別削除、アカウント削除ができます。" },
        { title: "保護措置", body: "セッションクッキーはHttpOnly・SameSiteを使い、HTTPSではSecureで送信します。サーバーにはトークン原文ではなくハッシュを保存し、開発者権限はサーバーで再確認します。" },
      ] },
      { id: "contact", title: "8. お問い合わせ・変更", items: [
        { title: "運営主体", body: "BORA Bridge 個人開発プロジェクト" },
        { title: "連絡先", body: "{{CONTACT_EMAIL}} · 確認、訂正、削除、本方針に関するお問い合わせを受け付けます。" },
        { title: "変更のお知らせ", body: "重要な変更は施行前にサービス内で案内し、必要な場合は改めて同意を求めます。" },
      ] },
    ],
  },
  zh: {
    eyebrow: "PRIVACY · PLAIN LANGUAGE",
    title: "隐私政策",
    lead: "本政策以易懂的方式说明BORA Bridge保存哪些信息、使用目的，以及用户如何控制或删除这些信息。",
    notice: "BORA Bridge不使用MyData连接自动导入银行或银行卡交易记录，只保存用户自行输入的分类汇总金额。",
    updated: "生效日期",
    version: CURRENT_PRIVACY_VERSION,
    summaryTitle: "处理原则概览",
    summaries: [
      { title: "登录所需信息", body: "处理Naver或Kakao标识符、您授权的资料字段及安全会话信息。" },
      { title: "您主动保存的信息", body: "可保存显示名称、机会匹配条件，以及资产、负债和月度现金流的分类合计。" },
      { title: "AI上下文默认关闭", body: "记忆、近期对话摘录和近期活动仅在您分别开启后保存和使用。" },
    ],
    quickNav: "页面目录",
    sections: [
      { id: "data", title: "1. 我们处理的信息", lead: "仅在您选择的功能所需范围内处理。", items: [
        { title: "OAuth账户与会话", body: "登录提供商、提供商用户ID、显示名称、姓名和昵称、邮箱及验证状态、头像、性别、生日、出生年份和年龄段（提供并授权时），以及会话令牌哈希、创建、到期和最近使用时间。不保存提供商访问令牌。" },
        { title: "手动输入与设置", body: "BORA别名和显示方式；政策与创业匹配开关、出生年份、大区、当前状态和兴趣；现金、投资、其他资产、负债、月收入、固定与浮动支出、还债金额的合计、输入单位及AI使用同意。" },
        { title: "使用与安全记录", body: "公共信息已读标记、AI咨询主题、语言和依据数量，以及防止滥用的限流周期与次数。主题统计不保存完整问答正文。" },
        { title: "检查所选钓鱼短信", body: "只有您在页面上同意本次读取并点击按钮后，浏览器才会尝试从剪贴板导入文字。勾选状态不会保存，且与浏览器的网站权限相互独立。导入的文字在您点击“分析风险”前不会发送到服务器。点击分析后，文字仅在同源服务器进行一次性规则检查，且不保存原文。分析前请删除发件号码等识别信息。只有另行同意后才会使用Google网址信誉查询。" },
        { title: "仅保存在设备上的设置", body: "语言、简易模式、首页布局、货币、最近菜单和临时财务草稿可能保存在浏览器中，可在浏览器设置中清除。" },
      ] },
      { id: "purpose", title: "2. 使用目的", items: [
        { title: "账户与同步", body: "用于识别用户、维持安全会话，并在另一设备上通过同一OAuth账户载入手动账本和设置。" },
        { title: "个性化信息与AI", body: "按您选择的条件筛选政策和创业公告，并仅在明确同意后个性化本地AI回答。" },
        { title: "安全运营", body: "用于确认必要同意、限制异常或过量请求、排查错误并维持服务稳定。" },
      ] },
      { id: "oauth", title: "3. OAuth提供商与外部处理", items: [
        { title: "Naver与Kakao", body: "当前界面提供Naver和Kakao登录。认证和权限选择在提供商页面完成。BORA Bridge不会接收或保存您的提供商密码。" },
        { title: "AI提供商", body: "运营者明确启用外部AI时，当前问题和选定的公开依据可能发送给该提供商。已保存的个人记忆、近期对话、近期活动和手动财务快照仅用于本地AI，不发送给外部付费AI。" },
        { title: "可选恶意网址信誉查询", body: "仅当您在钓鱼检查中另行同意时，去除查询参数和片段的网址协议、主机与路径才可能发送给Google Safe Browsing。BORA Bridge不会长期保存网址原文；SHA-256缓存键仅在最长30分钟内复用，过期键会在下一次查询时从内存清理。系统以使用提供商密钥生成的每日HMAC-SHA-256配额键替代原始网络地址，超过48小时的键会在下一次外部查询清理时列入删除。Google可能依照其政策及Safe Browsing条款使用所提交的网址和相关数据，也可能在条款允许的范围内共享数据。Google的政策适用，并仍可能出现误报或漏报。" },
        { title: "官方来源与基础设施", body: "服务从公共API和官方网站获取信息并提供原文链接。Cloudflare在提供域名连接和安全传输时可能处理连接元数据。外部网站适用其自身政策。" },
      ] },
      { id: "ai", title: "4. 可选AI记忆、对话与活动", lead: "三个开关相互独立，默认全部关闭。", items: [
        { title: "核心记忆", body: "开启后保存减少个人信息的简短目标或偏好摘要；关闭或删除后不再用于后续回答。" },
        { title: "近期对话", body: "开启后，最多保存6条已移除部分直接标识信息的问答摘录，最长30天，并作为历史对话提供给本地AI。自动移除并非绝对完整，请勿输入敏感信息。" },
        { title: "近期活动", body: "开启后，最多保存40条菜单代码、官方政策或就业项目ID和所选货币，最长30天；本功能不保存搜索词或自由输入网址。" },
        { title: "用户控制", body: "可在AI咨询页面分别开关或删除。未接受当前必要条款或选择外部AI时，不使用已保存的个人上下文。" },
      ] },
      { id: "retention", title: "5. 保存期限与删除", items: [
        { title: "短期安全记录", body: "OAuth启动记录约10分钟内有效；已使用或过期记录在有限安全确认期后清理。会话在退出或设定到期后失效。" },
        { title: "账户数据", body: "资料、手动账本、设置和必要同意记录保留至删除相关功能或账户；仅在法律要求时另行保留必要期限。" },
        { title: "删除方式", body: "可在“我的页面”分别删除AI上下文、匹配资料和手动账本，或申请删除整个账户。完整删除同时移除用户数据和活动会话。" },
        { title: "运营所有者账户", body: "若账户是API密钥或服务设置的最后所有者，在安全转移运营权限前可能限制删除。" },
      ] },
      { id: "mydata", title: "6. MyData与敏感信息", items: [
        { title: "未连接MyData", body: "目前不连接金融机构MyData、开放银行或银行卡账户，也不会自动读取余额、交易或信用信息。" },
        { title: "请勿输入", body: "请勿输入账号、卡号、密码、OTP、居民或外国人登记号码、保险原始文件等敏感信息。服务不会要求这些内容。" },
      ] },
      { id: "rights", title: "7. 您的权利与保护措施", items: [
        { title: "访问、更正、删除", body: "可在“我的页面”查看保存记录数量和资料、更正显示名称，并使用功能级删除或完整账户删除。" },
        { title: "保护措施", body: "会话Cookie使用HttpOnly与SameSite，HTTPS下使用Secure。服务器仅保存令牌哈希，开发者权限会在服务器端再次验证。" },
      ] },
      { id: "contact", title: "8. 联系与变更", items: [
        { title: "运营主体", body: "BORA Bridge个人开发项目" },
        { title: "联系方式", body: "{{CONTACT_EMAIL}} · 可咨询访问、更正、删除或本政策相关事项。" },
        { title: "变更通知", body: "数据或目的发生重要变更时，将在生效前通过服务告知，并在必要时重新征得同意。" },
      ] },
    ],
  },
};

const TERMS_COPY: Record<LegalPolicyLocale, PolicyCopy> = {
  ko: {
    eyebrow: "TERMS · FAIR USE",
    title: "BORA Bridge 이용약관",
    lead: "서비스가 제공하는 범위와 이용자의 책임을 분명히 하여, 금융 정보를 안전하게 참고할 수 있도록 정한 기본 약속입니다.",
    notice: "BORA Bridge의 계산·요약·추천은 정보 탐색을 돕는 참고 자료입니다. 금융상품 가입, 투자, 대출, 법률·세무 판단 전에는 반드시 최신 공식 원문과 전문가의 설명을 확인하세요.",
    updated: "시행일",
    version: CURRENT_TERMS_VERSION,
    summaryTitle: "중요한 이용 원칙",
    summaries: [
      { title: "정보 제공 서비스", body: "BORA Bridge는 금융기관, 투자자문사, 보험사 또는 금융 계약의 당사자가 아닙니다." },
      { title: "공식 원문 재확인", body: "금리, 자격, 지원금, 마감일과 법령은 신청·계약 전에 제공기관 원문에서 다시 확인해야 합니다." },
      { title: "사용자가 최종 결정", body: "AI와 규칙 기반 결과는 결정을 보조하며, 송금·가입·신고·투자 같은 행동을 자동 실행하지 않습니다." },
    ],
    quickNav: "내용 바로가기",
    sections: [
      { id: "scope", title: "1. 목적과 적용", items: [
        { title: "약관의 목적", body: "이 약관은 BORA Bridge 개인 개발 프로젝트와 이용자 사이의 서비스 이용 조건, 권리와 책임을 정합니다." },
        { title: "동의", body: "로그인 후 계정 저장·개인화 기능을 이용하려면 현재 이용약관과 개인정보 처리방침에 모두 동의해야 합니다. 중요한 변경이 있으면 새 버전에 대한 동의를 다시 요청할 수 있습니다." },
        { title: "이용 가능 대상", body: "이용자는 자신의 행위에 법적 책임을 질 수 있는 범위에서 서비스를 사용해야 합니다. 미성년자 또는 도움이 필요한 이용자는 보호자나 신뢰할 수 있는 사람과 함께 중요한 금융 결정을 확인하세요." },
      ] },
      { id: "service", title: "2. 제공하는 서비스", items: [
        { title: "공공 금융·정책 정보", body: "환율, 금융지표, 청년정책, 취업·창업 공고와 상권 등 공식·공개 정보를 수집해 출처와 기준일을 표시합니다. 원천기관 사정에 따라 지연·누락될 수 있습니다." },
        { title: "직접 입력 장부와 시각화", body: "마이데이터 연결 없이 사용자가 입력한 자산·부채·월 현금흐름 합계를 저장하고 그래프로 보여줍니다. 입력값의 정확성은 사용자가 확인해야 합니다." },
        { title: "AI·규칙 기반 안내", body: "공개 근거와 사용자가 선택적으로 저장한 맥락으로 설명·요약·후보 비교·보안 행동요령을 제공합니다. 결과는 확정 자격 판정이나 전문 자문이 아닙니다." },
      ] },
      { id: "account", title: "3. 로그인과 계정", items: [
        { title: "OAuth 로그인", body: "현재 네이버·카카오 계정으로 로그인할 수 있습니다. 제공사 계정과 인증수단을 안전하게 관리하고, 타인의 계정을 사용하지 않아야 합니다." },
        { title: "정확한 정보", body: "맞춤 결과는 사용자가 입력하거나 제공을 허용한 정보에 의존합니다. 오래되거나 잘못된 값은 결과의 적합성을 낮출 수 있습니다." },
        { title: "계정 삭제", body: "마이페이지에서 계정 삭제를 요청할 수 있습니다. 운영 키와 설정을 소유한 마지막 개발자 계정은 안전한 권한 이전 후 삭제할 수 있습니다." },
      ] },
      { id: "financial", title: "4. 금융·AI 결과의 한계", items: [
        { title: "전문 자문 아님", body: "서비스는 맞춤형 투자자문, 신용평가, 보험심사, 세무·법률 자문 또는 수익 보장을 제공하지 않습니다. 표시 순위와 점수는 확률이나 가입 권유가 아닙니다." },
        { title: "최신성·정확성", body: "공공 API와 공식 사이트의 내용을 가능한 범위에서 갱신하지만, 제공사 변경·장애·호출 한도 때문에 최신성과 완전성을 항상 보장할 수 없습니다." },
        { title: "AI의 불확실성", body: "AI는 잘못 해석하거나 중요한 조건을 빠뜨릴 수 있습니다. 근거 링크, 기준일, 적용 조건을 확인하고 의심스러운 송금·피싱 상황에서는 금융기관과 112 등 공식 창구에 즉시 문의하세요." },
        { title: "AI 선택 맥락", body: "AI 기억·최근 대화·최근 활동은 기본 OFF입니다. 사용자가 켜더라도 답변 보조에만 사용하며 자동 거래나 자동 신청에는 사용하지 않습니다." },
      ] },
      { id: "duties", title: "5. 이용자의 준수사항", items: [
        { title: "금지되는 이용", body: "불법 행위, 타인 사칭, 서비스·계정 침해, 악성 코드, 자동화된 대량 요청, 호출 제한 회피, 역공학을 통한 비밀·개인정보 탈취, 타인의 권리 침해에 서비스를 사용해서는 안 됩니다." },
        { title: "민감정보 입력 금지", body: "계좌·카드번호, 비밀번호, OTP, 주민·외국인등록번호, 실제 보험서류 또는 피싱 메시지 원문처럼 개인을 식별할 수 있는 민감정보를 입력하지 마세요." },
        { title: "공식 절차 준수", body: "지원사업 신청, 금융계약, 신고, 투자, 송금은 해당 기관의 공식 채널과 조건에 따라 이용자가 직접 최종 확인하고 진행해야 합니다." },
      ] },
      { id: "sources", title: "6. 공개자료·외부 링크와 권리", items: [
        { title: "공식 출처", body: "공공데이터와 원문은 각 제공기관의 저작권·이용조건이 적용됩니다. 출처 링크를 제거하거나 원문과 다른 확정 사실로 재배포해서는 안 됩니다." },
        { title: "외부 링크", body: "외부 사이트의 내용, 운영, 접근성, 거래 조건은 해당 운영자가 책임집니다. BORA Bridge의 링크 제공이 보증이나 제휴를 뜻하지 않습니다." },
        { title: "서비스 구성물", body: "BORA Bridge의 자체 코드, 화면 구성, 브랜드와 설명 문구에 관한 권리는 프로젝트 또는 정당한 권리자에게 있습니다. 법이 허용하는 범위를 넘는 무단 복제·상업적 이용을 금합니다." },
      ] },
      { id: "availability", title: "7. 변경·중단과 책임", items: [
        { title: "서비스 변경", body: "보안, 법령, 제공사 API, 대회 운영 또는 기술적 필요에 따라 기능을 변경·중단할 수 있습니다. 중요한 변경은 가능한 범위에서 미리 알립니다." },
        { title: "책임 범위", body: "고의 또는 중대한 과실, 강행 법규가 정한 책임은 제한하지 않습니다. 그 밖에는 무료 정보 서비스의 성격과 이용자가 공식 확인을 해야 한다는 점을 고려해 법이 허용하는 범위에서 책임을 부담합니다." },
        { title: "약관 위반", body: "안전 또는 다른 이용자를 보호하기 위해 위반 요청을 제한하고, 심각하거나 반복적인 침해가 있으면 이용을 중단할 수 있습니다." },
      ] },
      { id: "contact", title: "8. 문의와 준거", items: [
        { title: "운영 주체", body: "BORA Bridge 개인 개발 프로젝트" },
        { title: "문의처", body: "{{CONTACT_EMAIL}}" },
        { title: "준거", body: "대한민국 법령을 기준으로 하며, 분쟁이 생기면 먼저 성실하게 협의하고 해결되지 않으면 관련 법령이 정한 절차를 따릅니다." },
      ] },
    ],
  },
  en: {
    eyebrow: "TERMS · FAIR USE",
    title: "BORA Bridge Terms of Use",
    lead: "These terms define the service boundary and each user's responsibilities so financial information can be used with appropriate care.",
    notice: "Calculations, summaries, and matches are informational aids. Before applying, investing, borrowing, or making a legal or tax decision, verify the latest official text and seek qualified advice where appropriate.",
    updated: "Effective date",
    version: CURRENT_TERMS_VERSION,
    summaryTitle: "Key terms at a glance",
    summaries: [
      { title: "Information service", body: "BORA Bridge is not a bank, adviser, insurer, or party to a financial contract." },
      { title: "Recheck official sources", body: "Rates, eligibility, benefits, deadlines, and laws must be verified with the provider before action." },
      { title: "You make the final decision", body: "AI and rule-based results support review and never automatically transfer, enroll, report, or invest." },
    ],
    quickNav: "On this page",
    sections: [
      { id: "scope", title: "1. Purpose and acceptance", items: [
        { title: "Purpose", body: "These terms govern use of the independently developed BORA Bridge service and the responsibilities of its operator and users." },
        { title: "Acceptance", body: "You must accept the current Terms and Privacy Policy to use account storage and personalization after sign-in. Material updates may require renewed consent." },
        { title: "Who may use it", body: "Use the service only where you can take legal responsibility for your actions. Minors and users who need support should review important financial decisions with a guardian or trusted person." },
      ] },
      { id: "service", title: "2. What the service provides", items: [
        { title: "Public finance and opportunity information", body: "We present sourced exchange rates, indicators, youth policy, employment, startup notices, and district information. Provider outages or delays can cause gaps." },
        { title: "Manual workbook and charts", body: "Without MyData, you may store category totals for assets, debt, and cash flow and view charts. You are responsible for checking your entries." },
        { title: "AI and rule-based guidance", body: "We explain, summarize, compare candidates, and offer security steps using public evidence and optional context. Results are not final eligibility decisions or professional advice." },
      ] },
      { id: "account", title: "3. Sign-in and accounts", items: [
        { title: "OAuth sign-in", body: "Current sign-in uses Naver or Kakao. Keep your provider account secure and do not use another person's identity." },
        { title: "Accurate information", body: "Personalized output depends on information you enter or permit. Stale or inaccurate values can reduce relevance." },
        { title: "Account deletion", body: "You may request deletion from My Page. The final developer account that owns operational keys or settings must transfer ownership first." },
      ] },
      { id: "financial", title: "4. Limits of financial and AI output", items: [
        { title: "Not professional advice", body: "The service does not provide personalized investment advice, credit or insurance decisions, legal or tax advice, or guaranteed returns. Ranks and scores are not probabilities or enrollment recommendations." },
        { title: "Freshness and accuracy", body: "We refresh official data where practical but cannot guarantee it is always current or complete because providers change data, fail, or impose quotas." },
        { title: "AI uncertainty", body: "AI can misinterpret or omit conditions. Check evidence links, dates, and requirements. For suspected phishing or a transfer in Korea, contact the financial institution and 112 immediately." },
        { title: "Optional AI context", body: "AI memory, recent chats, and recent activity default to OFF. Even when enabled, they support an answer only and never trigger an application or transaction." },
      ] },
      { id: "duties", title: "5. User responsibilities", items: [
        { title: "Prohibited use", body: "Do not use the service for unlawful activity, impersonation, account or system intrusion, malware, automated bulk requests, quota evasion, extraction of secrets or personal data, or infringement of others' rights." },
        { title: "Do not enter sensitive data", body: "Do not enter account or card numbers, passwords, OTPs, national or foreign-resident IDs, original insurance records, or identifiable phishing-message text." },
        { title: "Use official procedures", body: "You must personally verify and complete applications, contracts, reports, investments, and transfers through each institution's official channel." },
      ] },
      { id: "sources", title: "6. Public sources, external links, and rights", items: [
        { title: "Official sources", body: "Public data and original materials remain subject to each provider's copyright and terms. Do not remove attribution or republish them as a different confirmed fact." },
        { title: "External links", body: "The external operator is responsible for its content, accessibility, and transaction terms. A link is not a warranty or partnership." },
        { title: "BORA materials", body: "Rights in BORA Bridge's own code, interface, brand, and copy belong to the project or the lawful rightsholder. Unauthorized copying or commercial use beyond applicable law is prohibited." },
      ] },
      { id: "availability", title: "7. Changes, suspension, and responsibility", items: [
        { title: "Service changes", body: "Features may change or stop for security, law, upstream APIs, competition requirements, or technical needs. Material changes will be announced where practical." },
        { title: "Responsibility", body: "Nothing excludes responsibility for intent, gross negligence, or mandatory law. Otherwise, responsibility is determined within applicable law considering the free informational nature of the service and the requirement to verify official sources." },
        { title: "Violations", body: "Requests may be limited to protect the service or others, and serious or repeated abuse may result in suspension." },
      ] },
      { id: "contact", title: "8. Contact and governing rules", items: [
        { title: "Operator", body: "BORA Bridge independent development project" },
        { title: "Contact", body: "{{CONTACT_EMAIL}}" },
        { title: "Governing rules", body: "The laws of the Republic of Korea apply. We will first seek a good-faith resolution, then follow the procedure provided by applicable law." },
      ] },
    ],
  },
  ja: {
    eyebrow: "TERMS · FAIR USE", title: "BORA Bridge 利用規約", lead: "サービスの範囲と利用者の責任を明確にし、金融情報を安全に参照するための基本的な約束です。", notice: "計算・要約・候補表示は情報探索の参考です。申込、投資、借入、法務・税務判断の前に、最新の公式原文と必要に応じて専門家の説明を確認してください。", updated: "施行日", version: CURRENT_TERMS_VERSION, summaryTitle: "重要な利用原則", summaries: [
      { title: "情報提供サービス", body: "BORA Bridgeは銀行、投資助言業者、保険会社、金融契約の当事者ではありません。" },
      { title: "公式原文を再確認", body: "金利、資格、支援、期限、法令は行動前に提供機関で再確認してください。" },
      { title: "最終判断は利用者", body: "AI・ルール結果は確認を補助し、送金・申込・申告・投資を自動実行しません。" },
    ], quickNav: "目次", sections: [
      { id: "scope", title: "1. 目的・適用", items: [
        { title: "目的", body: "本規約はBORA Bridge個人開発プロジェクトと利用者の利用条件、権利、責任を定めます。" },
        { title: "同意", body: "ログイン後の保存・個別化には現行の利用規約とプライバシーポリシーへの同意が必要です。重要な更新時は再同意を求める場合があります。" },
        { title: "利用対象", body: "自身の行為に法的責任を負える範囲で利用してください。未成年者や支援が必要な方は、重要な金融判断を保護者・信頼できる人と確認してください。" },
      ] },
      { id: "service", title: "2. 提供サービス", items: [
        { title: "公的金融・機会情報", body: "為替、指標、若者政策、雇用・創業公募、商圏などの公開情報を出典・基準日とともに表示します。提供元の事情で遅延・欠落する場合があります。" },
        { title: "手入力台帳・グラフ", body: "マイデータ連携をせず、手入力した資産・負債・月次キャッシュフローの合計を保存・可視化します。入力値は利用者が確認します。" },
        { title: "AI・ルール案内", body: "公開根拠と任意の保存文脈により説明、要約、候補比較、セキュリティ手順を示します。確定資格判定や専門助言ではありません。" },
      ] },
      { id: "account", title: "3. ログイン・アカウント", items: [
        { title: "OAuthログイン", body: "現在はNaver・Kakaoログインを利用できます。提供元アカウントを安全に管理し、他人のアカウントを使用しないでください。" },
        { title: "正確な情報", body: "個別化は入力・許可した情報に依存します。古い・誤った値は結果の関連性を下げます。" },
        { title: "削除", body: "マイページから削除できます。運営キー・設定を最後に所有する開発者は先に安全な権限移管が必要です。" },
      ] },
      { id: "financial", title: "4. 金融・AI結果の限界", items: [
        { title: "専門助言ではありません", body: "個別投資助言、信用・保険判断、法務・税務助言、収益保証は行いません。順位・点数は確率や加入勧誘ではありません。" },
        { title: "最新性・正確性", body: "公式情報を可能な範囲で更新しますが、提供元の変更・障害・上限により常に最新・完全とは限りません。" },
        { title: "AIの不確実性", body: "AIは誤解や条件漏れがあり得ます。根拠、日付、条件を確認し、詐欺・送金が疑われる場合は金融機関や112など公式窓口へ直ちに連絡してください。" },
        { title: "任意AI文脈", body: "記憶、最近の会話・操作は初期設定オフで、有効時も回答補助だけに使い、自動取引・申込は行いません。" },
      ] },
      { id: "duties", title: "5. 利用者の責任", items: [
        { title: "禁止行為", body: "違法行為、なりすまし、侵入、マルウェア、大量自動要求、上限回避、秘密・個人情報の抽出、他者の権利侵害に利用してはいけません。" },
        { title: "機微情報を入力しない", body: "口座・カード番号、パスワード、OTP、住民・外国人登録番号、保険原本、個人を識別できる詐欺文面を入力しないでください。" },
        { title: "公式手続", body: "申請、契約、申告、投資、送金は各機関の公式経路で本人が最終確認・実行します。" },
      ] },
      { id: "sources", title: "6. 公開資料・外部リンク・権利", items: [
        { title: "公式資料", body: "公開データ・原文には各提供元の著作権・条件が適用されます。出典を削除したり別の確定事実として再配布しないでください。" },
        { title: "外部リンク", body: "外部内容・アクセシビリティ・取引条件は各運営者が責任を負い、リンクは保証・提携を意味しません。" },
        { title: "BORAの構成物", body: "独自コード、画面、ブランド、文章の権利はプロジェクトまたは正当な権利者に属し、法の範囲を超える無断複製・商用利用を禁止します。" },
      ] },
      { id: "availability", title: "7. 変更・停止・責任", items: [
        { title: "変更", body: "安全、法令、外部API、大会運営、技術上の必要により変更・停止し、重要な変更は可能な範囲で事前案内します。" },
        { title: "責任範囲", body: "故意・重大な過失・強行法規上の責任は制限しません。その他は無料情報サービスと公式確認義務を考慮し、法の範囲で判断します。" },
        { title: "違反", body: "安全保護のためリクエストを制限し、重大・反復する濫用時は利用を停止できます。" },
      ] },
      { id: "contact", title: "8. 問い合わせ・準拠", items: [
        { title: "運営主体", body: "BORA Bridge 個人開発プロジェクト" }, { title: "連絡先", body: "{{CONTACT_EMAIL}}" }, { title: "準拠", body: "大韓民国法を基準とし、まず誠実に協議し、解決しない場合は関係法令の手続に従います。" },
      ] },
    ],
  },
  zh: {
    eyebrow: "TERMS · FAIR USE", title: "BORA Bridge 使用条款", lead: "本条款明确服务范围和用户责任，帮助用户谨慎参考金融信息。", notice: "计算、摘要和匹配结果仅用于辅助查找信息。在申请、投资、借款或作出法律、税务决定前，请核对最新官方原文并在需要时咨询专业人士。", updated: "生效日期", version: CURRENT_TERMS_VERSION, summaryTitle: "重要使用原则", summaries: [
      { title: "信息服务", body: "BORA Bridge不是银行、投资顾问、保险公司或金融合同当事方。" },
      { title: "再次核对官方来源", body: "利率、资格、补贴、截止日期和法律须在行动前向提供机构核实。" },
      { title: "由用户最终决定", body: "AI和规则结果仅辅助审核，不会自动转账、报名、申报或投资。" },
    ], quickNav: "页面目录", sections: [
      { id: "scope", title: "1. 目的与适用", items: [
        { title: "目的", body: "本条款规定BORA Bridge个人开发项目与用户之间的使用条件、权利和责任。" },
        { title: "同意", body: "登录后使用账户保存和个性化功能，须同时同意当前使用条款和隐私政策。重要更新可能要求重新同意。" },
        { title: "适用用户", body: "请仅在能够对自身行为承担法律责任的范围内使用。未成年人或需要协助的用户应与监护人或可信人士共同确认重要金融决定。" },
      ] },
      { id: "service", title: "2. 服务内容", items: [
        { title: "公共金融与机会信息", body: "展示带来源和基准日期的汇率、指标、青年政策、就业与创业公告、商圈等公开信息。上游机构可能导致延迟或缺失。" },
        { title: "手动账本与图表", body: "不连接MyData，保存并可视化用户手动输入的资产、负债和月度现金流合计。用户应确认输入准确性。" },
        { title: "AI与规则指引", body: "基于公开依据和可选保存上下文提供解释、摘要、候选比较和安全步骤，不构成最终资格判断或专业建议。" },
      ] },
      { id: "account", title: "3. 登录与账户", items: [
        { title: "OAuth登录", body: "当前可使用Naver或Kakao登录。请妥善管理提供商账户，不得使用他人身份。" },
        { title: "准确信息", body: "个性化结果依赖您输入或授权的信息；过期或错误数值会降低相关性。" },
        { title: "账户删除", body: "可从“我的页面”申请删除。拥有运营密钥或设置的最后开发者账户须先安全转移所有权。" },
      ] },
      { id: "financial", title: "4. 金融与AI结果的限制", items: [
        { title: "非专业建议", body: "不提供个性化投资建议、信用或保险决定、法律或税务建议或收益保证。排名和分数不代表概率或办理建议。" },
        { title: "时效与准确性", body: "我们尽可能更新官方数据，但提供商变更、故障或调用上限可能影响时效与完整性。" },
        { title: "AI不确定性", body: "AI可能误解或遗漏条件。请核对依据链接、日期和要求；如怀疑诈骗或在韩国发生转账，请立即联系金融机构和112。" },
        { title: "可选AI上下文", body: "记忆、近期对话和近期活动默认关闭；即使开启也只辅助回答，不会触发自动申请或交易。" },
      ] },
      { id: "duties", title: "5. 用户责任", items: [
        { title: "禁止用途", body: "不得用于违法行为、冒用身份、入侵账户或系统、恶意软件、自动批量请求、规避限额、提取秘密或个人信息、侵害他人权利。" },
        { title: "请勿输入敏感信息", body: "请勿输入账号、卡号、密码、OTP、居民或外国人登记号码、保险原件或可识别个人的诈骗文本。" },
        { title: "使用官方流程", body: "申请、合同、申报、投资和转账须由用户通过各机构官方渠道最终确认并完成。" },
      ] },
      { id: "sources", title: "6. 公开资料、外部链接与权利", items: [
        { title: "官方资料", body: "公共数据和原文适用各提供商的版权与条件，不得删除来源或作为不同的确定事实重新发布。" },
        { title: "外部链接", body: "外部内容、可访问性和交易条件由其运营者负责，提供链接不代表保证或合作关系。" },
        { title: "BORA资料", body: "自有代码、界面、品牌和文字权利属于项目或合法权利人，禁止超出法律许可的擅自复制或商业使用。" },
      ] },
      { id: "availability", title: "7. 变更、中止与责任", items: [
        { title: "服务变更", body: "可能因安全、法律、上游API、赛事或技术需要而变更或中止功能，重要变更会尽可能提前通知。" },
        { title: "责任范围", body: "不排除故意、重大过失或强制性法律规定的责任；其他责任在适用法律范围内结合免费信息服务性质和官方核对要求确定。" },
        { title: "违规", body: "为保护服务或他人可能限制请求，严重或重复滥用可导致暂停使用。" },
      ] },
      { id: "contact", title: "8. 联系与适用规则", items: [
        { title: "运营主体", body: "BORA Bridge个人开发项目" }, { title: "联系方式", body: "{{CONTACT_EMAIL}}" }, { title: "适用规则", body: "以大韩民国法律为准；争议发生时先诚信协商，未解决则依相关法律程序处理。" },
      ] },
    ],
  },
};

const SUMMARY_ICONS: readonly ComponentType<{ size?: number }>[] = [
  LockKeyhole,
  Database,
  Bot,
];

export function legalPolicyLocale(value: string | string[] | undefined): LegalPolicyLocale {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "en" || candidate === "ja" || candidate === "zh" ? candidate : "ko";
}

export default async function LegalPolicyPage({
  kind,
  locale,
}: {
  kind: LegalPolicyKind;
  locale: LegalPolicyLocale;
}) {
  const shared = SHARED[locale];
  const contactEmail = normalizeLegalContactEmail(await environmentValue("LEGAL_CONTACT_EMAIL"));
  const copy = kind === "privacy" ? PRIVACY_COPY[locale] : TERMS_COPY[locale];
  const basePath = `/${kind}`;
  const currentDate = copy.version.slice(0, 10);
  const HeroIcon = kind === "privacy" ? ShieldCheck : FileCheck2;

  return (
    <div className={styles.page} lang={locale}>
      <a className={styles.skipLink} href="#policy-content">{shared.skip}</a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label={shared.home}>
            <span aria-hidden="true">B</span>
            <strong>BORA Bridge</strong>
          </Link>
          <nav className={styles.languages} aria-label={shared.language}>
            <Languages size={16} aria-hidden="true" />
            {(Object.keys(LOCALE_LABELS) as LegalPolicyLocale[]).map((code) => (
              <Link
                key={code}
                href={`${basePath}?lang=${code}`}
                hrefLang={code}
                aria-current={locale === code ? "page" : undefined}
                aria-label={locale === code ? `${LOCALE_LABELS[code]}, ${shared.current}` : LOCALE_LABELS[code]}
              >
                {LOCALE_LABELS[code]}
              </Link>
            ))}
          </nav>
          <Link className={styles.accountLink} href="/mypage">
            <UserRound size={17} aria-hidden="true" />
            {shared.account}
          </Link>
        </div>
      </header>

      <main id="policy-content" className={styles.main} tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="policy-title">
          <div className={styles.heroCopy}>
            <Link className={styles.backLink} href="/">
              <ArrowLeft size={16} aria-hidden="true" />
              {shared.home}
            </Link>
            <span className={styles.eyebrow}>{copy.eyebrow}</span>
            <h1 id="policy-title">{copy.title}</h1>
            <p>{copy.lead}</p>
            <div className={styles.versionLine}>
              <span>{copy.updated} <time dateTime={currentDate}>{currentDate}</time></span>
              <span>{copy.version}</span>
            </div>
          </div>
          <aside className={styles.heroNotice}>
            <HeroIcon size={28} aria-hidden="true" />
            <p>{copy.notice}</p>
          </aside>
        </section>

        <section className={styles.summary} aria-labelledby="policy-summary-title">
          <div className={styles.sectionHeading}>
            <span>SUMMARY</span>
            <h2 id="policy-summary-title">{copy.summaryTitle}</h2>
          </div>
          <div className={styles.summaryGrid}>
            {copy.summaries.map((summary, index) => {
              const SummaryIcon = SUMMARY_ICONS[index] ?? ShieldCheck;
              return (
                <article key={summary.title}>
                  <span className={styles.summaryIcon}><SummaryIcon size={20} aria-hidden="true" /></span>
                  <h3>{summary.title}</h3>
                  <p>{summary.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <div className={styles.policyLayout}>
          <nav className={styles.quickNav} aria-label={copy.quickNav}>
            <strong>{copy.quickNav}</strong>
            <div>
              {copy.sections.map((section) => (
                <a key={section.id} href={`#${section.id}`}>
                  <span>{section.title}</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </a>
              ))}
            </div>
          </nav>

          <div className={styles.sections}>
            {copy.sections.map((section) => (
              <section key={section.id} id={section.id} className={styles.policySection}>
                <h2>{section.title}</h2>
                {section.lead ? <p className={styles.sectionLead}>{section.lead}</p> : null}
                <div className={styles.itemGrid}>
                  {section.items.map((item) => (
                    <article key={item.title}>
                      <h3>{item.title}</h3>
                      <p>{item.body.replaceAll(CONTACT_PLACEHOLDER, contactEmail ?? CONTACT_UNAVAILABLE[locale])}</p>
                    </article>
                  ))}
                </div>
                {section.id === "contact" && contactEmail ? (
                  <a className={styles.contactButton} href={legalContactMailto(contactEmail)}>
                    <Mail size={17} aria-hidden="true" />
                    <span><strong>{shared.contact}</strong><small>{shared.contactLead}</small></span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </a>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div>
          <strong>BORA Bridge</strong>
          <p>{shared.footer}</p>
        </div>
        <nav aria-label={`${shared.privacy} · ${shared.terms}`}>
          <Link href={`/privacy?lang=${locale}`} aria-current={kind === "privacy" ? "page" : undefined}>{shared.privacy}</Link>
          <Link href={`/terms?lang=${locale}`} aria-current={kind === "terms" ? "page" : undefined}>{shared.terms}</Link>
          <Link href="/mypage">{shared.account}</Link>
        </nav>
      </footer>
    </div>
  );
}
