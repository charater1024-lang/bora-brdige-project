"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  ExternalLink,
  FileCheck2,
  FileSearch,
  Fingerprint,
  Globe2,
  Landmark,
  LockKeyhole,
  MessageSquareWarning,
  MousePointerClick,
  PiggyBank,
  Radar,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  TimerReset,
  TrendingUp,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { CHALLENGE_PAGE_MARKER } from "@/lib/challenge-contract";
import styles from "./challenge.module.css";

type PersonaId = "settlement" | "starter" | "founder";

type JourneyStep = {
  kicker: string;
  title: string;
  body: string;
  points: string[];
  trust: string;
};

type JourneyLink = {
  href: string;
  label: string;
  note: string;
};

type Persona = {
  id: PersonaId;
  index: string;
  tabLabel: string;
  title: string;
  summary: string;
  caseLabel: string;
  icon: LucideIcon;
  steps: JourneyStep[];
  links: JourneyLink[];
};

const personas: Persona[] = [
  {
    id: "settlement",
    index: "01",
    tabLabel: "외국인 청년",
    title: "피싱을 멈추고, 한국 금융 정착까지",
    summary:
      "낯선 언어의 환전·등록금 문자를 받은 외국인 청년이 송금 전에 위험을 확인하고 공식 정착 절차로 이동합니다.",
    caseLabel: "등록금 환전 우대 링크와 당일 송금 요청을 받음",
    icon: Globe2,
    steps: [
      {
        kicker: "상황",
        title: "급한 송금 요청, 정보는 흩어져 있습니다",
        body:
          "문자에는 단축 URL, 환전 혜택, 오늘 안에 보내라는 문구가 함께 있습니다. 사용자는 한국의 신고·은행·체류 안내를 한 번에 찾기 어렵습니다.",
        points: [
          "문자·URL을 사용자가 직접 붙여넣어 요청 시점에만 점검",
          "지원 언어마다 같은 응답 구조와 대응 순서를 제공하되, 표현에 따라 탐지 신호는 달라질 수 있음",
          "검사 전에는 안전·위험을 미리 단정하지 않음",
        ],
        trust: "입력 원문은 요청 중 일시 처리하며 서비스 데이터베이스나 영구 캐시에 저장하지 않습니다.",
      },
      {
        kicker: "판단 로직",
        title: "설명 가능한 신호를 먼저 보여줍니다",
        body:
          "AI 모델을 호출하지 않는 규칙 엔진과 로컬 URL 휴리스틱이 재촉, 비공식 링크, 송금 유도 같은 신호를 분리해 보여줍니다. 점수는 확률이 아니라 발견된 경고 신호의 가중치입니다.",
        points: [
          "위험 등급·신호·URL별 근거·점수 구성·권장 행동을 분리 표시",
          "외부 URL 평판 조회는 기본 OFF이며, 사용자가 동의한 경우에만 쿼리를 제거해 조회",
          "낮은 등급도 ‘안전 보장’으로 표현하지 않음",
        ],
        trust: "규칙 기반 사전 점검은 피해 여부를 확정하지 않고 사람의 재확인 순서를 제안합니다.",
      },
      {
        kicker: "오늘 행동",
        title: "송금 중지에서 정착 체크리스트로 연결합니다",
        body:
          "첫 행동은 송금을 멈추는 것입니다. 이미 송금했다면 금융회사와 112에 즉시 지급정지를 요청하고, 피싱 신고·상담은 1394로 연결합니다. 위기 대응 후에는 5단계 금융 정착 가이드로 이동합니다.",
        points: [
          "송금 여부와 링크·앱·인증정보 노출 상태에 따라 대응 순서를 조정",
          "송금 피해는 금융회사·112 지급정지, 피싱 신고·상담은 1394",
          "본인확인·계좌·통신·세금·송금안전의 5단계 안내",
        ],
        trust: "체류자격·계좌 개설 가능 여부는 BORA가 판정하지 않습니다.",
      },
      {
        kicker: "근거 · 보안",
        title: "공식 확인처와 MVP 경계를 함께 제시합니다",
        body:
          "외국인종합안내센터 1345, 금융감독원 FINE, 국세청, 공식 환율 페이지로 이어집니다. 실시간 계좌 감시나 자동 지급정지는 현재 MVP 범위가 아닙니다.",
        points: [
          "공식 기관의 최신 원문을 최종 확인 경로로 제공",
          "이름·외국인등록번호·계좌번호 입력란을 만들지 않음",
          "실시간 FDS·은행 거래 연결은 제휴 이후 단계로 명시",
        ],
        trust: "공식 원문, 개인정보 최소화, 기능 한계를 한 화면에서 확인합니다.",
      },
    ],
    links: [
      { href: "/safety", label: "BORA Shield 열기", note: "문자·URL 위험 점검" },
      { href: "/information/settlement", label: "정착 가이드 열기", note: "5단계 공식 안내" },
    ],
  },
  {
    id: "starter",
    index: "02",
    tabLabel: "사회초년생",
    title: "내가 입력한 숫자로, 오늘 행동 하나까지",
    summary:
      "계좌를 연결하지 않아도 자산·부채·월 현금흐름을 직접 입력하고, 가장 필요한 다음 행동을 확인합니다.",
    caseLabel: "월급은 받지만 얼마를 남길 수 있는지 모름",
    icon: PiggyBank,
    steps: [
      {
        kicker: "상황",
        title: "연결 전 금융 앱은 빈 화면이 되기 쉽습니다",
        body:
          "오픈뱅킹·마이데이터 제휴 전에는 실제 잔액을 가져올 수 없습니다. BORA는 이를 숨기지 않고 모든 미입력 값을 0으로 시작합니다.",
        points: [
          "현금·예금, 투자자산, 기타자산, 부채를 직접 입력",
          "월 소득, 고정·변동 지출, 부채 상환을 분리",
          "예시 잔액이나 합성 소비 데이터를 표시하지 않음",
        ],
        trust: "계좌번호·카드번호·주민번호를 요청하지 않습니다.",
      },
      {
        kicker: "판단 로직",
        title: "계산과 조언의 출처를 분리합니다",
        body:
          "순자산·월 잔액·소득 대비 상환 비율은 사용자가 입력한 합계로 계산합니다. AI 상담에서 장부를 쓰는 기능은 별도 동의가 있어야만 활성화됩니다.",
        points: [
          "수식 기반 계산은 모델 호출 없이 즉시 처리",
          "AI 장부 활용 동의 기본값 OFF",
          "공식 근거가 필요한 질문은 출처 우선 RAG로 분리",
        ],
        trust: "계산값은 금융기관 확인 잔액이나 신용평가가 아닙니다.",
      },
      {
        kicker: "오늘 행동",
        title: "전체 계획보다 지금 할 한 가지를 먼저",
        body:
          "데일리 가이드는 장부 확인, 맞춤 조건 보완, 새 공식 정보 중 가장 먼저 볼 항목을 제시합니다. 완료 상태는 로그인 계정에서 이어집니다.",
        points: [
          "2분 금융 프로필 → 순자산·월 잔액 확인",
          "오늘의 우선 행동 한 개와 다음 대기열을 분리",
          "목표 금액·월 저축액으로 예상 도달 시점 비교",
        ],
        trust: "가입·대출·투자를 자동 실행하지 않고 확인 단계에서 멈춥니다.",
      },
      {
        kicker: "근거 · 보안",
        title: "최소 금액만 계정 장부에 보관합니다",
        body:
          "D1에는 항목별 합계와 동의 상태만 계정별로 저장합니다. 모두 지우기와 계정 삭제를 제공하며, 금융상품 조건은 날짜가 표시된 공식 공시에서 다시 확인합니다.",
        points: [
          "OAuth 공급자 고유 ID 기준으로 계정 장부 분리",
          "필수 동의 버전·시각 기록과 사용자 데이터 삭제",
          "금융상품 한눈에·서민금융진흥원 원문 연결",
        ],
        trust: "실제 계좌 연결은 인가 사업자 제휴와 별도 본인인증 이후 과제입니다.",
      },
    ],
    links: [
      { href: "/assets", label: "자산 장부 열기", note: "직접 입력·목표 계산" },
      { href: "/ai-guide", label: "근거형 AI 열기", note: "동의 기반 상담" },
    ],
  },
  {
    id: "founder",
    index: "03",
    tabLabel: "예비창업자",
    title: "지원 공고에서 실제 상권 확인까지",
    summary:
      "수많은 창업 지원사업을 공식 조건으로 좁히고, 지역이 있는 공고를 실제 상권·점포 탐색으로 연결합니다.",
    caseLabel: "내 지역과 업종에 맞는 공고·상권을 함께 보고 싶음",
    icon: BriefcaseBusiness,
    steps: [
      {
        kicker: "상황",
        title: "공고와 상권 데이터가 서로 다른 곳에 있습니다",
        body:
          "예비창업자는 지원 대상·접수 기간을 확인한 뒤 다시 지역과 상권을 조사해야 합니다. 원천마다 형식과 갱신 주기도 다릅니다.",
        points: [
          "온통청년·K-Startup·기업마당 공고를 공통 형식으로 정규화",
          "지역·상태·관심 분야를 사용자가 직접 설정",
          "전국 17개 시·도의 공식 상권·점포를 서버 경유 검색",
        ],
        trust: "API 키와 원천 요청 URL은 브라우저에 노출하지 않습니다.",
      },
      {
        kicker: "판단 로직",
        title: "일치 근거와 불확실성을 함께 보여줍니다",
        body:
          "공식 조건과 개인화 신호를 분리해 우선 검토 근거를 붙입니다. 확인할 수 없는 조건은 확인 필요로 남기며 전체 공고를 유지하고, AI 설명은 항목 내용 해시·언어·공급자·모델별로 캐시합니다.",
        points: [
          "개인화 신호와 공식 조건 일치 근거를 분리",
          "저장된 설명이나 규칙 설명을 우선 사용하고, 무료·로컬 모델은 로그인 사용자의 상세 열람 때 생성 가능",
          "과금 가능 모델의 새 설명만 개발자 확인 후 해당 항목에 한 번 생성",
        ],
        trust: "AI 설명은 공식 항목의 해설일 뿐 최종 자격이나 사업 성공 가능성을 판정하지 않습니다.",
      },
      {
        kicker: "오늘 행동",
        title: "공고 원문 확인 후 지역 탐색으로 이동합니다",
        body:
          "마감일과 신청자격을 공식 공고에서 확인하고, 지역이 명시된 경우 같은 지역의 상권 탐색으로 이어집니다. 서울은 공식 추정매출·유동인구를 기준 분기와 함께 표시합니다.",
        points: [
          "후보 선택 → 원문 조건 확인 → 준비 항목 체크",
          "지역 상권·점포명·업종·주소·좌표 검색",
          "서울 상권의 업종 비중과 시간대 지표 확인",
        ],
        trust: "공식 임대료가 없으면 ‘미제공’으로 두며 임의 추정하지 않습니다.",
      },
      {
        kicker: "근거 · 보안",
        title: "기준일·출처·수집 상태를 데이터와 함께",
        body:
          "공식 API의 기준일, 마지막 갱신, 완전성, 원문 링크를 표시합니다. 키가 없거나 OFF이면 외부 호출 없이 미설정·0건 상태를 유지합니다.",
        points: [
          "원천별 호출 예산·쿨다운·실패 백오프 적용",
          "마지막 정상 스냅샷을 보존하고 오래됨을 표시",
          "상권 경계는 법적 행정경계·측량 자료가 아님을 고지",
        ],
        trust: "대출·투자·지원 자격을 자동 확정하지 않고 공식 신청 원문으로 끝냅니다.",
      },
    ],
    links: [
      { href: "/opportunities", label: "금융 미션 열기", note: "7개 미션·자가점검" },
      { href: "/information/startup", label: "창업·상권 열기", note: "공고·지역 탐색" },
    ],
  },
];

const promises = [
  {
    icon: MousePointerClick,
    number: "01",
    title: "오늘의 행동 1개",
    body: "복잡한 금융 정보를 한 번에 쌓지 않고, 지금 확인할 우선 행동과 다음 대기열을 분리합니다.",
  },
  {
    icon: FileCheck2,
    number: "02",
    title: "공식 근거 우선",
    body: "답변보다 먼저 출처·기준일·데이터 상태를 드러내고, 최종 판단은 공식 원문으로 연결합니다.",
  },
  {
    icon: Fingerprint,
    number: "03",
    title: "개인정보 최소화",
    body: "필요한 합계·구조화 조건만 받고, 식별정보 입력란과 동의 없는 AI 활용을 기본적으로 차단합니다.",
  },
];

const liveRoutes: Array<{
  href: string;
  title: string;
  body: string;
  icon: LucideIcon;
  state: string;
}> = [
  { href: "/safety", title: "안심", body: "규칙 기반 피싱·URL 점검과 1394 대응", icon: ShieldCheck, state: "구현" },
  { href: "/assets", title: "자산", body: "직접 입력 계정 장부와 목표", icon: CircleDollarSign, state: "구현" },
  { href: "/opportunities", title: "기회", body: "7개 금융 미션과 공식 경로", icon: Target, state: "구현" },
  { href: "/information/settlement", title: "정착", body: "외국인 금융생활 5단계", icon: Route, state: "구현" },
  { href: "/ai-guide", title: "AI 상담", body: "출처 우선 RAG와 동의 설정", icon: Sparkles, state: "조건부" },
];

const truthRows = [
  {
    capability: "행동 우선 홈",
    state: "구현",
    data: "계정 장부 · 맞춤 프로필 · 공식정보 열람 상태",
    ai: "규칙 기반으로 우선 행동과 대기열 구성",
    guardrail: "미입력 금융값 0 · 합성 데이터 금지",
    limit: "실제 거래 실행·자동 자산 조회 없음",
  },
  {
    capability: "자산 워크북",
    state: "구현",
    data: "사용자가 직접 입력한 항목별 합계",
    ai: "별도 동의 시에만 상담 문맥으로 활용",
    guardrail: "AI 활용 기본 OFF · 식별번호 미수집 · 삭제 제공",
    limit: "마이데이터·오픈뱅킹 연결 전 단계",
  },
  {
    capability: "피싱 · 보안 점검",
    state: "구현 · 설명형 사전점검",
    data: "피싱 규칙 · URL 휴리스틱 · 동의형 Safe Browsing · 3영역 체크리스트",
    ai: "AI 호출 없음 · 규칙 엔진이 신호·즉시 중단·대응 순서 구성",
    guardrail: "원문 영구 미저장 · 외부 URL 조회 기본 OFF · 낮음도 안전 보장 아님",
    limit: "실시간 FDS·수취계좌 평판·자동 차단·보험 판정 없음",
  },
  {
    capability: "정책 · 창업 · 상권",
    state: "구현 · 데이터 조건부",
    data: "온통청년 · K-Startup · 기업마당 · KOSIS · 공공 상권",
    ai: "원문 기반 설명과 후보 탐색 보조",
    guardrail: "기준일·출처·완전성·마지막 정상본 표시",
    limit: "최종 자격·매출 성과·임대료 추정 없음",
  },
  {
    capability: "Source-first AI",
    state: "공급자 활성 시 구현",
    data: "공식 법령 캐시 · 공용 스냅샷 · 검토된 지식",
    ai: "단일 활성 모델로 설명·요약·질의응답",
    guardrail: "로그인·동의·분당 제한 · 답변 모드와 출처 표시",
    limit: "법률·투자·대출 자문과 자동 의사결정 아님",
  },
  {
    capability: "외국인 금융 정착",
    state: "구현",
    data: "1345 · FINE · 국세청 · 건강보험 · 공식 환율",
    ai: "절차 탐색과 확인 질문을 구조화",
    guardrail: "식별정보 미입력 · 예산은 탭 메모리에서만 계산",
    limit: "체류·세무·계좌 개설 가능 여부 판정 없음",
  },
];

const hypotheses = [
  {
    icon: TimerReset,
    label: "가설 01",
    value: "≤ 3분",
    title: "첫 유효 행동까지",
    body: "첫 방문자가 도움 설명 없이 한 가지 금융 행동을 완료하는 시간의 중앙값 목표",
    measure: "과업 시작–완료 이벤트로 검증 예정",
  },
  {
    icon: BookOpenCheck,
    label: "가설 02",
    value: "≥ 60%",
    title: "근거 확인 전환",
    body: "행동을 완료한 세션 중 공식 근거 또는 원문까지 확인하는 비율 목표",
    measure: "원문 열기·근거 펼치기 이벤트로 검증 예정",
  },
  {
    icon: LockKeyhole,
    label: "가설 03",
    value: "0건",
    title: "불필요 식별정보 입력",
    body: "핵심 여정에서 계좌·카드·주민·외국인등록 번호를 요청하는 필드 수 목표",
    measure: "화면·API 스키마 정적 감사로 검증 예정",
  },
  {
    icon: Globe2,
    label: "가설 04",
    value: "≤ 15%p",
    title: "언어별 완료 격차",
    body: "한국어와 지원 언어 간 핵심 과업 완료율 차이를 줄이기 위한 목표",
    measure: "동의한 익명 과업 이벤트로 검증 예정",
  },
];

const reviewedOn = "2026년 8월 21일";

function tabId(persona: Persona) {
  return `persona-tab-${persona.id}`;
}

export default function ChallengePage() {
  const [activePersonaIndex, setActivePersonaIndex] = useState(0);
  const [activeSteps, setActiveSteps] = useState<Record<PersonaId, number>>({
    settlement: 0,
    starter: 0,
    founder: 0,
  });
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activePersona = personas[activePersonaIndex];
  const activeStepIndex = activeSteps[activePersona.id];
  const activeStep = activePersona.steps[activeStepIndex];
  const ActivePersonaIcon = activePersona.icon;

  function selectPersona(index: number) {
    setActivePersonaIndex(index);
  }

  function selectNextPersona() {
    const nextIndex = (activePersonaIndex + 1) % personas.length;
    setActivePersonaIndex(nextIndex);
    setActiveSteps((current) => ({
      ...current,
      [personas[nextIndex].id]: 0,
    }));
  }

  function selectStep(index: number) {
    setActiveSteps((current) => ({
      ...current,
      [activePersona.id]: Math.max(0, Math.min(activePersona.steps.length - 1, index)),
    }));
  }

  function handleTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % personas.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + personas.length) % personas.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = personas.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectPersona(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={styles.page} data-evaluation-marker={CHALLENGE_PAGE_MARKER}>
      <a className={styles.skipLink} href="#challenge-main">본문으로 바로가기</a>

      <header className={styles.masthead}>
        <Link className={styles.brand} href="/" aria-label="BORA Bridge 홈으로 이동">
          <span className={styles.brandMark} aria-hidden="true">B</span>
          <span>
            <strong>BORA Bridge</strong>
            <small>Inclusive Finance · Service overview</small>
          </span>
        </Link>
        <nav className={styles.topNav} aria-label="BORA Bridge 소개 바로가기">
          <a href="#promise">문제와 약속</a>
          <a href="#demo">기능 둘러보기</a>
          <a href="#truth">구현 현황</a>
        </nav>
        <Link className={styles.headerCta} href="/safety">
          서비스 체험 <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>

      <main id="challenge-main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="challenge-title">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}><BadgeCheck size={15} />INCLUSIVE FINANCE AI · SERVICE OVERVIEW</span>
            <h1 id="challenge-title">
              금융의 다음 행동을,
              <span>근거와 함께 한 번에.</span>
            </h1>
            <p>
              BORA Bridge는 청년·외국인·예비창업자가 금융 정보를 이해하는 데서 멈추지 않고,
              위험을 확인한 뒤 <strong>오늘 실행할 한 가지</strong>로 이어지게 하는 포용금융 코파일럿입니다.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryCta} href="#demo">
                90초 핵심 둘러보기 <MousePointerClick size={18} />
              </a>
              <a className={styles.secondaryCta} href="#truth">
                3분 서비스 둘러보기 <ArrowRight size={16} />
              </a>
            </div>
            <dl className={styles.heroFacts}>
              <div><dt>3</dt><dd>핵심 페르소나</dd></div>
              <div><dt>4</dt><dd>단계 데모</dd></div>
              <div><dt>0</dt><dd>합성 금융값</dd></div>
              <div><dt>4</dt><dd>서비스 지원 언어</dd></div>
            </dl>
            <p className={styles.languageNotice}>
              실제 서비스 기능은 한국어·영어·일본어·중국어를 지원하며, 이 출품용 서비스 소개는 한국어로 제공합니다.
            </p>
          </div>

          <div className={styles.heroVisual} aria-label="BORA Bridge가 상황에서 근거 있는 행동까지 연결하는 모습">
            <div className={styles.heroSignal}>
              <span><Radar size={17} />INPUT</span>
              <strong>흩어진 금융 상황</strong>
              <small>문자 · 숫자 · 정책 조건</small>
            </div>
            <div className={styles.heroRoute} aria-hidden="true">
              <span /><span /><span />
            </div>
            <div className={styles.heroDecision}>
              <span><ShieldCheck size={17} />BORA</span>
              <strong>행동 + 근거 + 경계</strong>
              <small>설명 가능한 다음 단계</small>
            </div>
            <Image
              src="/bora-mascot.webp"
              alt=""
              width={512}
              height={512}
              priority
              unoptimized
              sizes="(max-width: 560px) 295px, (max-width: 1060px) 390px, 32vw"
              className={styles.mascot}
            />
            <div className={styles.heroProof}>
              <CheckCircle2 size={18} />
              <span><strong>Official source first</strong><small>최종 확인은 공식 원문에서</small></span>
            </div>
          </div>
        </section>

        <section className={styles.problemSection} id="promise" aria-labelledby="problem-title">
          <div className={styles.sectionIntro}>
            <span className={styles.sectionNumber}>01 · PROBLEM / PROMISE</span>
            <h2 id="problem-title">정보는 많지만, 금융 행동까지 이어지는 다리가 없습니다</h2>
            <p>
              취약한 순간일수록 사용자는 더 많은 정보가 아니라, 내 상황에 맞고 출처를 확인할 수 있는
              다음 행동 하나가 필요합니다.
            </p>
          </div>
          <div className={styles.problemGrid}>
            <article className={styles.problemCard}>
              <span>문제 정의</span>
              <blockquote>
                “금융 정보의 <strong>분절</strong>, 실행 직전의 <strong>위험</strong>,
                근거 없는 개인화가 포용금융의 마지막 1km를 막습니다.”
              </blockquote>
              <ul>
                <li><Route size={17} />정책·자산·보안·정착 절차가 서로 분리</li>
                <li><MessageSquareWarning size={17} />피싱은 판단보다 송금 행동이 먼저 일어나기 쉬움</li>
                <li><LockKeyhole size={17} />개인화가 과도한 정보 수집과 불투명한 추천으로 이어짐</li>
              </ul>
            </article>
            <div className={styles.promiseList}>
              {promises.map(({ icon: Icon, number, title, body }) => (
                <article key={number}>
                  <span className={styles.promiseIcon}><Icon size={20} /></span>
                  <div><small>{number} · CORE PROMISE</small><h3>{title}</h3><p>{body}</p></div>
                  <Check size={18} aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.demoSection} id="demo" aria-labelledby="demo-title">
          <div className={styles.sectionIntro}>
            <span className={styles.sectionNumber}>02 · GUIDED WALKTHROUGH</span>
            <h2 id="demo-title">세 사람의 금융 여정을 단계별로 살펴보세요</h2>
            <p>페르소나를 고르고 상황 → 판단 로직 → 오늘 행동 → 근거·보안의 네 단계를 살펴본 뒤 실제 기능으로 이동하세요.</p>
            <div className={styles.tourPaths} aria-label="서비스 소개 탐색 시간 안내">
              <span><strong>90초 핵심 경로</strong> 관심 페르소나 1명의 네 단계</span>
              <span><strong>3분 전체 경로</strong> 세 페르소나와 구현 진실표</span>
            </div>
          </div>

          <div className={styles.personaTabs} role="tablist" aria-label="데모 페르소나 선택">
            {personas.map((persona, index) => {
              const Icon = persona.icon;
              const selected = index === activePersonaIndex;
              return (
                <button
                  key={persona.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={tabId(persona)}
                  aria-controls="persona-demo-panel"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectPersona(index)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <span>{persona.index}</span>
                  <Icon size={20} aria-hidden="true" />
                  <strong>{persona.tabLabel}</strong>
                  <small>{persona.title}</small>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <article
            className={styles.demoShell}
            data-persona={activePersona.id}
            role="tabpanel"
            id="persona-demo-panel"
            aria-labelledby={tabId(activePersona)}
          >
            <header className={styles.demoHeader}>
              <div className={styles.personaIdentity}>
                <span><ActivePersonaIcon size={23} /></span>
                <div><small>PERSONA {activePersona.index}</small><h3>{activePersona.title}</h3><p>{activePersona.summary}</p></div>
              </div>
              <div className={styles.caseChip}><ScanSearch size={16} /><span><small>현재 상황</small>{activePersona.caseLabel}</span></div>
            </header>

            <div className={styles.demoBody}>
              <ol className={styles.stepRail} aria-label={`${activePersona.tabLabel} 데모 단계`}>
                {activePersona.steps.map((step, index) => {
                  const active = index === activeStepIndex;
                  const visited = index <= activeStepIndex;
                  return (
                    <li key={step.kicker}>
                      <button
                        type="button"
                        onClick={() => selectStep(index)}
                        aria-current={active ? "step" : undefined}
                        data-active={active || undefined}
                        data-visited={visited || undefined}
                      >
                        <span>{visited && !active ? <Check size={14} /> : index + 1}</span>
                        <div><small>STEP 0{index + 1}</small><strong>{step.kicker}</strong></div>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <section className={styles.stepDetail} aria-live="polite" aria-atomic="true">
                <div className={styles.stepProgress}>
                  <span>
                    페르소나 {activePersonaIndex + 1} / {personas.length} · STEP {String(activeStepIndex + 1).padStart(2, "0")} / 04
                  </span>
                  <div role="progressbar" aria-label="현재 데모 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={(activeStepIndex + 1) * 25}>
                    <span style={{ width: `${(activeStepIndex + 1) * 25}%` }} />
                  </div>
                </div>
                <span className={styles.stepKicker}>{activeStep.kicker}</span>
                <h4>{activeStep.title}</h4>
                <p>{activeStep.body}</p>
                <ul className={styles.stepPoints}>
                  {activeStep.points.map((point) => <li key={point}><CheckCircle2 size={17} />{point}</li>)}
                </ul>
                <div className={styles.trustNote}><ShieldCheck size={19} /><span><small>TRUST LAYER</small>{activeStep.trust}</span></div>

                {activeStepIndex === activePersona.steps.length - 1 && (
                  <div className={styles.journeyLinks}>
                    <span>실제 구현 화면</span>
                    <div>
                      {activePersona.links.map((link) => (
                        <Link key={link.href} href={link.href}>
                          <span><strong>{link.label}</strong><small>{link.note}</small></span><ArrowRight size={17} />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.stepActions}>
                  <button type="button" onClick={() => selectStep(activeStepIndex - 1)} disabled={activeStepIndex === 0}>
                    <ArrowLeft size={17} />이전
                  </button>
                  {activeStepIndex < activePersona.steps.length - 1 ? (
                    <button className={styles.nextButton} type="button" onClick={() => selectStep(activeStepIndex + 1)}>
                      다음 단계<ArrowRight size={17} />
                    </button>
                  ) : (
                    <button className={styles.nextButton} type="button" onClick={selectNextPersona}>
                      {activePersonaIndex < personas.length - 1
                        ? `다음 페르소나: ${personas[activePersonaIndex + 1].tabLabel}`
                        : "첫 페르소나로 이동"}
                      <ArrowRight size={17} />
                    </button>
                  )}
                </div>
              </section>
            </div>
          </article>
        </section>

        <section className={styles.liveSection} aria-labelledby="live-title">
          <div className={styles.liveIntro}>
            <span><Database size={16} />LIVE PRODUCT SURFACES</span>
            <h2 id="live-title">시연이 아닌 실제 구현 화면으로 이동</h2>
            <p>각 링크는 현재 서비스의 독립 경로이며, 데이터가 없을 때도 합성값 대신 0·미설정 상태를 보여줍니다.</p>
          </div>
          <div className={styles.liveRoutes}>
            {liveRoutes.map(({ href, title, body, icon: Icon, state }) => (
              <Link key={href} href={href}>
                <span className={styles.routeIcon}><Icon size={21} /></span>
                <span><small>{state}</small><strong>{title}</strong><p>{body}</p><code>{href}</code></span>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.truthSection} id="truth" aria-labelledby="truth-title">
          <div className={styles.sectionIntro}>
            <span className={styles.sectionNumber}>03 · IMPLEMENTATION TRUTH</span>
            <h2 id="truth-title">구현·AI·데이터·한계를 같은 행에서 봅니다</h2>
            <p>방문자가 “무엇이 실제 구현이고 무엇이 다음 단계인지” 즉시 구분할 수 있도록 정리한 MVP 진실표입니다.</p>
          </div>
          <div className={styles.truthTableWrap} role="region" aria-label="BORA Bridge 구현 진실표" tabIndex={0}>
            <table className={styles.truthTable}>
              <thead>
                <tr>
                  <th scope="col">기능 / 상태</th>
                  <th scope="col">공식·사용자 데이터</th>
                  <th scope="col">AI 역할</th>
                  <th scope="col">가드레일</th>
                  <th scope="col">MVP 한계</th>
                </tr>
              </thead>
              <tbody>
                {truthRows.map((row) => (
                  <tr key={row.capability}>
                    <th scope="row"><strong>{row.capability}</strong><span>{row.state}</span></th>
                    <td data-label="공식·사용자 데이터">{row.data}</td>
                    <td data-label="AI 역할">{row.ai}</td>
                    <td data-label="가드레일">{row.guardrail}</td>
                    <td data-label="MVP 한계">{row.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.truthFootnotes}>
            <div><Building2 size={19} /><span><strong>운영 전 제휴</strong>마이데이터·오픈뱅킹·실시간 FDS는 인가 사업자, 사용자별 동의, 보안성 검토가 필요합니다.</span></div>
            <div><Landmark size={19} /><span><strong>공식 데이터 조건</strong>키 또는 제공기관 응답이 없으면 마지막 정상본 또는 0건·미설정 상태를 보여줍니다.</span></div>
            <div><UserRoundCheck size={19} /><span><strong>사람의 최종 확인</strong>AI·규칙 엔진은 자격·사기·투자·법률 결과를 확정하지 않으며 공식 기관과 사용자 검토로 끝납니다.</span></div>
          </div>
          <aside className={styles.evidenceStrip} aria-label="공식 확인 경로와 검토 기준일">
            <div>
              <strong>서비스 소개 검토 기준</strong>
              <span>{reviewedOn} · 운영 데이터의 실제 갱신 시각과 연결 상태는 각 기능 화면에서 별도로 확인합니다.</span>
            </div>
            <nav aria-label="대표 공식 확인처">
              <a href="https://fine.fss.or.kr" target="_blank" rel="noreferrer">
                금융감독원 FINE <ExternalLink size={14} aria-hidden="true" />
              </a>
              <a href="https://www.hikorea.go.kr" target="_blank" rel="noreferrer">
                외국인종합안내 Hi Korea <ExternalLink size={14} aria-hidden="true" />
              </a>
            </nav>
          </aside>
        </section>

        <section className={styles.hypothesisSection} aria-labelledby="hypothesis-title">
          <div className={styles.hypothesisHeader}>
            <div>
              <span><TrendingUp size={16} />04 · VALIDATION HYPOTHESES</span>
              <h2 id="hypothesis-title">예상효과는 숫자가 아니라 검증할 약속입니다</h2>
              <p>아래 수치는 모두 <strong>목표·가설</strong>이며 현재 실측 성과가 아닙니다. 출시 후 동의된 최소 이벤트로 검증합니다.</p>
            </div>
            <strong className={styles.notMeasured}>NOT MEASURED YET</strong>
          </div>
          <div className={styles.hypothesisGrid}>
            {hypotheses.map(({ icon: Icon, label, value, title, body, measure }) => (
              <article key={label}>
                <div><span><Icon size={20} /></span><small>{label} · 목표치</small></div>
                <strong>{value}</strong>
                <h3>{title}</h3>
                <p>{body}</p>
                <footer><FileSearch size={15} />{measure}</footer>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="final-title">
          <div>
            <span><Sparkles size={16} />THE BORA STANDARD</span>
            <h2 id="final-title">더 많이 예측하는 AI보다,<br />더 안전하게 행동하게 하는 AI.</h2>
            <p>세 페르소나 중 하나를 실제 화면에서 이어서 확인해 보세요.</p>
          </div>
          <div>
            <Link className={styles.primaryCta} href="/safety">피싱 데모 시작 <ArrowRight size={18} /></Link>
            <Link className={styles.secondaryCtaDark} href="/assets">자산 장부 보기 <Banknote size={18} /></Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark} aria-hidden="true">B</span>
          <span><strong>BORA Bridge</strong><small>Inclusive finance copilot</small></span>
        </Link>
        <p>BORA는 금융 결정을 돕는 정보 서비스이며 투자·대출·법률 계약 또는 전문 자문을 대신하지 않습니다.</p>
        <nav className={styles.footerLinks} aria-label="법적 고지">
          <Link href="/privacy">개인정보 처리방침</Link>
          <Link href="/terms">이용약관</Link>
        </nav>
      </footer>
    </div>
  );
}
