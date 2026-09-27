"use client";

import {
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  ExternalLink,
  GraduationCap,
  MapPinned,
  Newspaper,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  YOUTH_POLICY_REGIONS,
  type YouthPolicyRegion,
} from "@/lib/auth/youth-policy-profile";
import {
  allYouthPolicySections,
  personalizedYouthPolicySections,
  type YouthOfficialResourceAccess,
  type YouthOfficialResourceDetail,
  type YouthPolicyRegionSelection,
  type YouthPolicySectionId,
} from "@/lib/public-data/youth-policy-sections";
import { safePublicHttpUrl } from "@/lib/public-data/urls";
import type { PublicDataDashboard, PublicInformationItem } from "@/lib/public-data/types";
import {
  KOREA_REGION_MAP_POSITIONS,
  MOBILE_REGION_ORDER,
} from "./korea-region-map-positions";
import type { PublicInformationLocale } from "./public-information-layout";
import { YouthPolicyMatchEvidence } from "./youth-policy-personalization";
import styles from "./youth-policy-four-sections.module.css";

const sectionIcons = {
  scholarship: GraduationCap,
  financial_support: Banknote,
  employment: BriefcaseBusiness,
  policy_news: Newspaper,
} satisfies Record<YouthPolicySectionId, typeof GraduationCap>;

const SECTION_IDS: YouthPolicySectionId[] = [
  "scholarship",
  "financial_support",
  "employment",
  "policy_news",
];

const sectionSourceIds: Record<YouthPolicySectionId, string[]> = {
  scholarship: ["kosaf-high", "kosaf-university", "youth-center"],
  financial_support: ["loan-product", "youth-center"],
  employment: ["work24", "youth-center", "kosis-employment", "moel-policy-news", "moel-press-releases"],
  policy_news: ["youth-center", "moel-policy-news", "moel-press-releases"],
};

type RegionFilterMode = "all" | "nationwide" | "region";

const KOREA_MAP_URL =
  "https://raw.githubusercontent.com/statgarten/maps/main/svg/simple/%EC%A0%84%EA%B5%AD_%EC%8B%9C%EB%8F%84_%EA%B2%BD%EA%B3%84.svg";
const KOREA_MAP_SOURCE = "https://github.com/statgarten/maps";

const regionLabels: Record<
  PublicInformationLocale,
  Record<YouthPolicyRegion, string>
> = {
  ko: {
    seoul: "서울특별시", busan: "부산광역시", daegu: "대구광역시",
    incheon: "인천광역시", gwangju: "광주광역시", daejeon: "대전광역시",
    ulsan: "울산광역시", sejong: "세종특별자치시", gyeonggi: "경기도",
    gangwon: "강원특별자치도", chungbuk: "충청북도", chungnam: "충청남도",
    jeonbuk: "전북특별자치도", jeonnam: "전라남도", gyeongbuk: "경상북도",
    gyeongnam: "경상남도", jeju: "제주특별자치도",
  },
  en: {
    seoul: "Seoul", busan: "Busan", daegu: "Daegu", incheon: "Incheon",
    gwangju: "Gwangju", daejeon: "Daejeon", ulsan: "Ulsan", sejong: "Sejong",
    gyeonggi: "Gyeonggi", gangwon: "Gangwon", chungbuk: "North Chungcheong",
    chungnam: "South Chungcheong", jeonbuk: "North Jeolla", jeonnam: "South Jeolla",
    gyeongbuk: "North Gyeongsang", gyeongnam: "South Gyeongsang", jeju: "Jeju",
  },
  ja: {
    seoul: "ソウル", busan: "釜山", daegu: "大邱", incheon: "仁川",
    gwangju: "光州", daejeon: "大田", ulsan: "蔚山", sejong: "世宗",
    gyeonggi: "京畿道", gangwon: "江原道", chungbuk: "忠清北道",
    chungnam: "忠清南道", jeonbuk: "全北特別自治道", jeonnam: "全羅南道",
    gyeongbuk: "慶尚北道", gyeongnam: "慶尚南道", jeju: "済州特別自治道",
  },
  zh: {
    seoul: "首尔", busan: "釜山", daegu: "大邱", incheon: "仁川",
    gwangju: "光州", daejeon: "大田", ulsan: "蔚山", sejong: "世宗",
    gyeonggi: "京畿道", gangwon: "江原道", chungbuk: "忠清北道",
    chungnam: "忠清南道", jeonbuk: "全北特别自治道", jeonnam: "全罗南道",
    gyeongbuk: "庆尚北道", gyeongnam: "庆尚南道", jeju: "济州特别自治道",
  },
};

const regionShortLabels: Record<YouthPolicyRegion, string> = {
  seoul: "서울", busan: "부산", daegu: "대구", incheon: "인천", gwangju: "광주",
  daejeon: "대전", ulsan: "울산", sejong: "세종", gyeonggi: "경기", gangwon: "강원",
  chungbuk: "충북", chungnam: "충남", jeonbuk: "전북", jeonnam: "전남",
  gyeongbuk: "경북", gyeongnam: "경남", jeju: "제주",
};

function mapRegionLabel(locale: PublicInformationLocale, region: YouthPolicyRegion) {
  if (locale === "ko") return regionShortLabels[region];
  return regionLabels[locale][region]
    .replace("North Chungcheong", "N.Chung")
    .replace("South Chungcheong", "S.Chung")
    .replace("North Gyeongsang", "N.Gyeong")
    .replace("South Gyeongsang", "S.Gyeong")
    .replace("North Jeolla", "N.Jeolla")
    .replace("South Jeolla", "S.Jeolla")
    .replace("特別自治道", "")
    .replace("特别自治道", "");
}

const regionFilterCopy = {
  ko: {
    title: "지역으로 정책 찾기",
    lead: "전국 공통 정책만 보거나, 지도에서 광역지역을 선택해 해당 지역 정책을 확인하세요.",
    all: "지역 조건 전체",
    nationwide: "전국 공통만",
    region: "지역별 보기",
    choose: "지도 또는 목록에서 지역 선택",
    includeNationwide: "선택 지역과 함께 전국 공통 정책도 보기",
    selected: (region: string, regionalCount: number, nationwideCount: number, includesNationwide: boolean) =>
      includesNationwide
        ? `${region} 지역 정책 ${regionalCount}건 · 전국 공통 ${nationwideCount}건 함께 표시`
        : `${region} 지역 정책 ${regionalCount}건`,
    allSelected: (count: number) => `지역 조건과 관계없이 ${count}건 표시`,
    nationwideSelected: (count: number) => `전국 공통 정책 ${count}건 표시`,
    unknown: "지역 조건을 공식 데이터에서 확인할 수 없는 자료는 ‘지역 조건 전체’에서만 표시됩니다.",
    mapUnavailable: "지도 이미지를 불러오지 못했습니다. 지역 버튼이나 목록을 이용해 주세요.",
    source: "지도 경계: 통계청 SGIS 기반 statgarten/maps · 행정·측량용 아님",
  },
  en: {
    title: "Find policies by region",
    lead: "Show nationwide programs or choose a province on the map.",
    all: "All geographic scopes",
    nationwide: "Nationwide only",
    region: "Choose a region",
    choose: "Choose on the map or list",
    includeNationwide: "Include nationwide programs with this region",
    selected: (region: string, regionalCount: number, nationwideCount: number, includesNationwide: boolean) =>
      includesNationwide
        ? `${regionalCount} regional programs for ${region} · ${nationwideCount} nationwide programs also shown`
        : `${regionalCount} regional programs for ${region}`,
    allSelected: (count: number) => `${count} programs across all geographic scopes`,
    nationwideSelected: (count: number) => `${count} nationwide programs`,
    unknown: "Records without an official geographic condition appear only under All geographic scopes.",
    mapUnavailable: "The map image is unavailable. Use the region buttons or list instead.",
    source: "Boundary map: statgarten/maps based on KOSTAT SGIS · not for surveying",
  },
  ja: {
    title: "地域から政策を探す",
    lead: "全国共通の政策だけを見るか、地図から広域地域を選択してください。",
    all: "地域条件すべて",
    nationwide: "全国共通のみ",
    region: "地域別に見る",
    choose: "地図または一覧から地域を選択",
    includeNationwide: "選択地域と全国共通の政策を一緒に表示",
    selected: (region: string, regionalCount: number, nationwideCount: number, includesNationwide: boolean) =>
      includesNationwide
        ? `${region}の地域政策 ${regionalCount}件・全国共通 ${nationwideCount}件を併せて表示`
        : `${region}の地域政策 ${regionalCount}件`,
    allSelected: (count: number) => `地域条件に関係なく ${count}件表示`,
    nationwideSelected: (count: number) => `全国共通政策 ${count}件表示`,
    unknown: "公式データで地域条件を確認できない資料は「地域条件すべて」にのみ表示されます。",
    mapUnavailable: "地図画像を読み込めません。地域ボタンまたは一覧をご利用ください。",
    source: "境界地図：統計庁SGISに基づくstatgarten/maps・測量用ではありません",
  },
  zh: {
    title: "按地区查找政策",
    lead: "可仅查看全国通用政策，或在地图上选择广域地区。",
    all: "所有地区条件",
    nationwide: "仅全国通用",
    region: "按地区查看",
    choose: "从地图或列表选择地区",
    includeNationwide: "同时显示该地区及全国通用政策",
    selected: (region: string, regionalCount: number, nationwideCount: number, includesNationwide: boolean) =>
      includesNationwide
        ? `${region}地区政策 ${regionalCount} 项・同时显示全国通用政策 ${nationwideCount} 项`
        : `${region}地区政策 ${regionalCount} 项`,
    allSelected: (count: number) => `不限制地区，共显示 ${count} 项`,
    nationwideSelected: (count: number) => `显示 ${count} 项全国通用政策`,
    unknown: "官方数据未注明地区条件的资料仅在“所有地区条件”中显示。",
    mapUnavailable: "地图图片无法加载，请使用地区按钮或列表。",
    source: "边界地图：基于韩国统计厅SGIS的statgarten/maps · 非测绘用途",
  },
} satisfies Record<PublicInformationLocale, {
  title: string;
  lead: string;
  all: string;
  nationwide: string;
  region: string;
  choose: string;
  includeNationwide: string;
  selected: (
    region: string,
    regionalCount: number,
    nationwideCount: number,
    includesNationwide: boolean,
  ) => string;
  allSelected: (count: number) => string;
  nationwideSelected: (count: number) => string;
  unknown: string;
  mapUnavailable: string;
  source: string;
}>;

const sourceStatusCopy = {
  ko: { live: "최신 정보 확인", partial: "일부 정보 제공", truncated: "현재 제공 범위", "not-configured": "현재 제공되지 않음", "authorization-pending": "제공기관 이용 제한", unavailable: "일시적으로 확인 불가" },
  en: { live: "Latest data available", partial: "Some data available", truncated: "Current coverage", "not-configured": "Not currently available", "authorization-pending": "Provider access limited", unavailable: "Temporarily unavailable" },
  ja: { live: "最新情報を確認", partial: "一部情報を提供", truncated: "現在の提供範囲", "not-configured": "現在利用不可", "authorization-pending": "提供機関の利用制限", unavailable: "一時的に確認不可" },
  zh: { live: "已获取最新信息", partial: "提供部分信息", truncated: "当前提供范围", "not-configured": "当前暂不提供", "authorization-pending": "提供机构访问受限", unavailable: "暂时无法确认" },
} satisfies Record<PublicInformationLocale, Record<PublicDataDashboard["sources"][number]["status"], string>>;

const sectionEyebrowCopy: Record<PublicInformationLocale, { personalized: string; directory: string }> = {
  ko: { personalized: "PERSONALIZED YOUTH GUIDE", directory: "YOUTH POLICY DIRECTORY" },
  en: { personalized: "PERSONALIZED YOUTH GUIDE", directory: "YOUTH POLICY DIRECTORY" },
  ja: { personalized: "PERSONALIZED YOUTH GUIDE", directory: "YOUTH POLICY DIRECTORY" },
  zh: { personalized: "PERSONALIZED YOUTH GUIDE", directory: "YOUTH POLICY DIRECTORY" },
};

const work24ResourceCopy = {
  ko: {
    "work24-recruitment": {
      purpose: "지역·직종·임금·학력·경력·고용형태를 직접 설정해 최신 채용공고를 찾을 수 있습니다.",
      when: "실제 지원 전 마감일, 근무조건과 채용기업 정보를 확인할 때 여세요.",
    },
    "work24-job-events": {
      purpose: "고용센터 채용행사·채용박람회와 취업지원 프로그램을 공식 검색에서 확인할 수 있습니다.",
      when: "온라인 공고 외에 현장 면접, 설명회나 지역 채용행사를 찾을 때 여세요.",
    },
    "work24-training": {
      purpose: "국민내일배움카드 지원대상, 훈련비 지원과 발급·수강 절차를 확인할 수 있습니다.",
      when: "내 자격과 자비부담액을 확인하고 공식 카드 발급·훈련 신청을 진행할 때 여세요.",
    },
    "work24-career-support": {
      purpose: "직업심리검사, 직업·학과정보, 취업가이드와 국민취업지원제도 등 개인 취업지원 메뉴를 찾을 수 있습니다.",
      when: "진로를 탐색하거나 로그인 후 개인별 일자리·교육훈련·자격증 추천을 확인할 때 여세요.",
    },
    "work24-government-jobs": {
      purpose: "정부지원 일자리의 모집공고·사업·기관·참여자 통계가 Open API로 제공되는 범위를 확인할 수 있습니다.",
      when: "기업회원으로 해당 API 이용 승인을 신청하기 전 명세를 검토할 때만 여세요. 현재 BORA는 호출하지 않습니다.",
    },
    "work24-wage-arrears": {
      purpose: "사업자등록번호와 사업장관리번호로 임금체불 명단공개 사업주 여부를 확인하는 API 명세입니다.",
      when: "기업회원 API 승인을 받은 뒤 채용기업 안전 확인 기능을 연계할 때만 사용하세요. 현재 자동 조회하지 않습니다.",
    },
  },
  en: {
    "work24-recruitment": {
      purpose: "Search current vacancies by region, occupation, pay, education, experience and employment type.",
      when: "Open it before applying to verify the deadline, working conditions and employer details.",
    },
    "work24-job-events": {
      purpose: "Use the official search to find employment-centre events, job fairs and employment-support programs.",
      when: "Open it when looking for local interviews, briefings or job fairs beyond online vacancies.",
    },
    "work24-training": {
      purpose: "Review training-card eligibility, tuition support, issuance and course-enrolment steps.",
      when: "Open it to verify eligibility and co-payment, then apply through the official service.",
    },
    "work24-career-support": {
      purpose: "Find career tests, occupation and major information, job-search guides and employment-support programs.",
      when: "Open it for career exploration or signed-in recommendations for jobs, training and certificates.",
    },
    "work24-government-jobs": {
      purpose: "Review the Open API scope for government-supported recruitment, programs, agencies and participant statistics.",
      when: "Use this specification only before an enterprise member requests API approval. BORA does not call it now.",
    },
    "work24-wage-arrears": {
      purpose: "Review the API that checks whether an employer appears on the public wage-arrears list using business identifiers.",
      when: "Use it only after enterprise API approval for an employer-safety integration. No automatic check runs now.",
    },
  },
  ja: {
    "work24-recruitment": {
      purpose: "地域・職種・賃金・学歴・経歴・雇用形態を指定して最新求人を検索できます。",
      when: "応募前に締切、勤務条件、採用企業の情報を確認するときに開いてください。",
    },
    "work24-job-events": {
      purpose: "雇用センターの採用行事・就職博覧会・就職支援プログラムを公式検索で確認できます。",
      when: "オンライン求人以外に、地域の面接会・説明会・採用行事を探すときに開いてください。",
    },
    "work24-training": {
      purpose: "国民明日学習カードの対象、訓練費支援、発行・受講手続きを確認できます。",
      when: "資格と自己負担額を確認し、公式のカード発行・訓練申請を行うときに開いてください。",
    },
    "work24-career-support": {
      purpose: "職業心理検査、職業・学科情報、就職ガイド、国民就職支援制度などを確認できます。",
      when: "進路探索やログイン後の求人・訓練・資格推薦を確認するときに開いてください。",
    },
    "work24-government-jobs": {
      purpose: "政府支援雇用の募集・事業・機関・参加者統計に関するOpen API提供範囲を確認できます。",
      when: "企業会員として利用承認を申請する前の仕様確認にのみ使用してください。現在BORAは呼び出しません。",
    },
    "work24-wage-arrears": {
      purpose: "事業者番号等で賃金未払い公表事業主かを確認するAPI仕様です。",
      when: "企業会員API承認後に採用企業の安全確認を連携するときだけ使用します。現在は自動照会しません。",
    },
  },
  zh: {
    "work24-recruitment": {
      purpose: "可按地区、职业、薪资、学历、经历和用工类型搜索最新职位。",
      when: "正式应聘前，请打开并核实截止日期、工作条件及招聘企业信息。",
    },
    "work24-job-events": {
      purpose: "可通过官方搜索查看就业中心招聘活动、招聘会及就业支持项目。",
      when: "需要查找线上职位以外的地区面试、说明会或招聘活动时打开。",
    },
    "work24-training": {
      purpose: "可查看国民明日学习卡的资格、培训费支持及发卡、选课流程。",
      when: "需要确认资格和自付金额并在官网申请卡片或培训时打开。",
    },
    "work24-career-support": {
      purpose: "可查找职业心理测试、职业与专业信息、求职指南及国民就业支持制度。",
      when: "探索职业方向，或登录后查看职位、培训与资格证推荐时打开。",
    },
    "work24-government-jobs": {
      purpose: "可查看政府支持岗位的招募、项目、机构和参与者统计等Open API范围。",
      when: "仅用于企业会员申请API授权前核对规范；BORA当前不会调用。",
    },
    "work24-wage-arrears": {
      purpose: "这是用企业标识检查雇主是否列入欠薪公开名单的API规范。",
      when: "仅在获得企业会员API授权后用于招聘企业安全核验；当前不会自动查询。",
    },
  },
} satisfies Record<PublicInformationLocale, Record<YouthOfficialResourceDetail, {
  purpose: string;
  when: string;
}>>;

const copy = {
  ko: {
    title: "나에게 필요한 청년정보 4가지",
    lead: "공식 조건과 내가 입력한 정보를 먼저 비교한 뒤, 학자금·금융지원·취업·정책뉴스로 나누어 보여드립니다.",
    sections: {
      scholarship: ["학자금", "장학금·학비·교육금융"],
      financial_support: ["금융지원", "자산형성·서민금융"],
      employment: ["취업", "공공·민간 채용정보 연계"],
      policy_news: ["정책뉴스", "정부 청년정책 공식 소식"],
    },
    featured: "먼저 보기",
    count: "선별 후보",
    allCount: "전체 정보",
    personalizedView: "내 조건에 맞는 정책",
    allView: "전체 정책 보기",
    allNotice: "로그인 없이 공식 청년정책 전체 목록과 분야·지역 필터, 공식 원문 링크를 이용할 수 있습니다. 개인 맞춤과 AI 설명만 로그인 후 제공됩니다. 전체 보기는 자격 보장이 아니므로 신청 전 공식 원문을 확인해 주세요.",
    officialResources: "공식 정보 연결",
    resourceLead: "외부로 이동하기 전에 각 사이트에서 찾을 수 있는 내용과 열어야 할 시점을 먼저 확인하세요.",
    resourcePurposeLabel: "여기서 찾을 수 있어요",
    resourceWhenLabel: "이럴 때 공식 페이지를 여세요",
    resourcePurposes: {
      scholarship: "장학금·학자금대출·학비 지원의 제도 설명과 신청 정보를 찾을 수 있습니다.",
      financial_support: "청년 자산형성·서민금융 지원의 대상과 상품 안내를 찾을 수 있습니다.",
      employment: "채용공고를 조건별로 검색하거나, 청년 고용통계의 공식 표와 기준을 확인할 수 있습니다.",
      policy_news: "정부 청년정책 소식, 고용노동부 정책자료와 보도자료의 최신 목록을 확인할 수 있습니다.",
    },
    resourceWhen: {
      "configured-public-api": "사이트 요약보다 더 자세한 기준표·공고·신청 절차를 확인할 때",
      "api-ready": "현재 화면에 수집되지 않은 세부 항목이나 최신 제공 범위를 확인할 때",
      "enterprise-api-only": "기업회원으로 해당 Open API 이용 승인을 신청하기 전 제공 범위와 입력 조건을 검토할 때",
      "external-directory": "검색 조건을 직접 설정하거나, 최신 목록을 조회하고 실제 신청·지원을 진행할 때",
    },
    openLatest: "공식 원문에서 최신 정보 확인",
    open: "공식 페이지",
    accesses: {
      "configured-public-api": "연동된 무료 공개 API",
      "api-ready": "공식 API 연계 가능",
      "enterprise-api-only": "기업회원 승인 필요 · 현재 미호출",
      "external-directory": "공식 사이트에서 확인",
    },
    employmentNotice: "현재 고용24 채용공고 자동 연동은 제공기관 이용 조건으로 제한되어 있습니다. 아래 공식 채용·훈련·진로 메뉴와 고용노동부·KOSIS 자료는 계속 이용할 수 있습니다.",
    newsNotice: "고용노동부 공식 보도자료와 정책자료에서 청년 관련 소식만 선별해 핵심 내용을 간략히 보여드립니다. 상세보기에서 게시일과 공식 원문을 확인해 주세요.",
    noItems: "현재 내 조건으로 선별된 항목이 0건입니다.",
    noItemsHelp: "관련 없는 정보를 채우지 않고, 공식 데이터 갱신 후 조건이 확인된 항목만 표시합니다.",
    noItemsAll: "현재 수집된 전체 청년정책이 0건입니다.",
    noItemsAllHelp: "공식 데이터가 갱신된 뒤 다시 확인해 주세요.",
    noItemsFiltered: "선택한 검색 조건에 맞는 청년정책이 0건입니다.",
    noItemsFilteredHelp: "검색어·기간·분야·지역 조건을 완화하거나 ‘지역 조건 전체’를 선택하면 수집된 정책을 계속 확인할 수 있습니다.",
    loadingTitle: "선택한 청년정책을 확인하고 있어요.",
    loadingHelp: "새 분야·지역 결과가 도착할 때까지 이전 정책과 집계는 표시하지 않습니다.",
    officialNotice: "최종 자격·마감·제출서류는 반드시 공식 원문에서 확인하세요.",
    published: "공고·기준일",
  },
  en: {
    title: "Four types of youth information for you",
    lead: "We first compare official structured conditions with your profile, then group screened results into student funding, financial support, jobs and policy news.",
    sections: {
      scholarship: ["Student funding", "Scholarships, tuition and education finance"],
      financial_support: ["Financial support", "Asset building and inclusive finance"],
      employment: ["Employment", "Public and private job directories"],
      policy_news: ["Policy news", "Official government youth-policy updates"],
    },
    featured: "Start here",
    count: "screened",
    allCount: "all",
    personalizedView: "Policies matching my profile",
    allView: "View all policies",
    allNotice: "You can browse the full official youth-policy list, filters, and source links without signing in. Profile matching and AI explanations require sign-in. The full list does not guarantee eligibility, so confirm the official notice before applying.",
    officialResources: "Official information links",
    resourceLead: "Before leaving this site, review what each destination contains and when it is useful.",
    resourcePurposeLabel: "What you can find",
    resourceWhenLabel: "When to open the official page",
    resourcePurposes: {
      scholarship: "Find program details and application information for scholarships, student loans and tuition support.",
      financial_support: "Find eligibility and product guidance for youth asset-building and inclusive-finance support.",
      employment: "Search job listings by your own filters or inspect official youth-employment tables and definitions.",
      policy_news: "Review current government youth-policy updates, MOEL policy materials and press releases.",
    },
    resourceWhen: {
      "configured-public-api": "When you need the full table, notice or application procedure beyond the summary shown here",
      "api-ready": "When you need details not currently collected here or want to verify the provider's current coverage",
      "enterprise-api-only": "When an enterprise member needs to review coverage and inputs before requesting API approval",
      "external-directory": "When you want to set search filters, review the latest list or proceed with an application",
    },
    openLatest: "Verify the latest details in the official source",
    open: "Official page",
    accesses: {
      "configured-public-api": "Connected free public API",
      "api-ready": "Official API integration available",
      "enterprise-api-only": "Enterprise approval required · not called",
      "external-directory": "Check on official site",
    },
    employmentNotice: "Automatic Work24 vacancy updates are currently limited by the provider's access terms. You can still use the official jobs, training and career links below together with MOEL and KOSIS information.",
    newsNotice: "We screen official MOEL press releases and policy materials for youth-related updates and show a short summary. Use Details to confirm the publication date and official original.",
    noItems: "There are 0 items screened for your current profile.",
    noItemsHelp: "We do not fill the page with unrelated records. Only items confirmed after an official-data update are shown.",
    noItemsAll: "There are 0 collected youth-policy records.",
    noItemsAllHelp: "Check again after the official data is refreshed.",
    noItemsFiltered: "No youth-policy records match the selected search filters.",
    noItemsFilteredHelp: "Relax the keyword, date, section or region filters, or choose All geographic scopes to continue browsing collected policies.",
    loadingTitle: "Checking the selected youth policies.",
    loadingHelp: "Previous policies and counts stay hidden until the new category and region results arrive.",
    officialNotice: "Confirm final eligibility, deadlines and documents in the official notice.",
    published: "Published / as of",
  },
  ja: {
    title: "自分に必要な若者情報の4分野",
    lead: "公式の構造化条件と入力プロフィールを先に照合し、学費支援・金融支援・就職・政策ニュースに分けて表示します。",
    sections: {
      scholarship: ["学費支援", "奨学金・学費・教育金融"],
      financial_support: ["金融支援", "資産形成・包摂金融"],
      employment: ["就職", "公的・民間求人情報への連携"],
      policy_news: ["政策ニュース", "政府の若者政策に関する公式情報"],
    },
    featured: "先に見る",
    count: "候補",
    allCount: "全情報",
    personalizedView: "自分の条件に合う政策",
    allView: "すべての政策を見る",
    allNotice: "ログインせずに公式の青少年政策一覧、分野・地域フィルター、公式原文リンクを利用できます。個別マッチングとAI説明のみログインが必要です。資格を保証するものではないため、申請前に公式原文を確認してください。",
    officialResources: "公式情報へのリンク",
    resourceLead: "外部へ移動する前に、各サイトで確認できる内容と開くタイミングを先に確認してください。",
    resourcePurposeLabel: "ここで確認できること",
    resourceWhenLabel: "公式ページを開くタイミング",
    resourcePurposes: {
      scholarship: "奨学金・学費ローン・学費支援の制度説明と申請情報を確認できます。",
      financial_support: "若者の資産形成・包摂金融支援の対象と商品案内を確認できます。",
      employment: "求人を条件別に検索したり、若者雇用統計の公式表と基準を確認できます。",
      policy_news: "政府の若者政策情報、雇用労働部の政策資料・報道資料の最新一覧を確認できます。",
    },
    resourceWhen: {
      "configured-public-api": "この画面の要約より詳しい基準表・公募・申請手続きを確認するとき",
      "api-ready": "現在未収集の詳細項目や提供元の最新範囲を確認するとき",
      "enterprise-api-only": "企業会員としてOpen API利用承認を申請する前に提供範囲と入力条件を確認するとき",
      "external-directory": "検索条件を直接設定し、最新一覧を確認して実際の応募・申請へ進むとき",
    },
    openLatest: "公式原文で最新情報を確認",
    open: "公式ページ",
    accesses: {
      "configured-public-api": "連携済み無料公開API",
      "api-ready": "公式API連携が可能",
      "enterprise-api-only": "企業会員承認が必要・現在未呼出",
      "external-directory": "公式サイトで確認",
    },
    employmentNotice: "雇用24の求人自動連携は、現在提供機関の利用条件により制限されています。以下の公式求人・訓練・進路メニューと雇用労働部・KOSIS資料は引き続き利用できます。",
    newsNotice: "雇用労働部の公式報道資料と政策資料から若者関連情報だけを選び、要点を短く表示します。詳細表示から掲載日と公式原文を確認してください。",
    noItems: "現在のプロフィールで確認できた候補は0件です。",
    noItemsHelp: "無関係な情報で埋めず、公式データ更新後に条件を確認できた項目だけを表示します。",
    noItemsAll: "現在収集済みの若者政策は0件です。",
    noItemsAllHelp: "公式データ更新後にもう一度確認してください。",
    noItemsFiltered: "選択した検索条件に一致する若者政策は0件です。",
    noItemsFilteredHelp: "キーワード・期間・分野・地域条件を緩めるか「地域条件すべて」を選ぶと、収集済みの政策を引き続き確認できます。",
    loadingTitle: "選択した若者政策を確認しています。",
    loadingHelp: "新しい分野・地域の結果が届くまで、以前の政策と集計は表示しません。",
    officialNotice: "最終資格・締切・提出書類は公式原文で確認してください。",
    published: "公表・基準日",
  },
  zh: {
    title: "与你相关的四类青年信息",
    lead: "先用官方结构化条件核对你填写的资料，再按助学、金融支持、就业和政策新闻分类展示。",
    sections: {
      scholarship: ["助学", "奖学金、学费与教育金融"],
      financial_support: ["金融支持", "资产积累与普惠金融"],
      employment: ["就业", "公共及民营招聘信息链接"],
      policy_news: ["政策新闻", "政府青年政策官方动态"],
    },
    featured: "优先查看",
    count: "候选",
    allCount: "全部信息",
    personalizedView: "符合我的条件",
    allView: "查看全部政策",
    allNotice: "无需登录即可查看官方青年政策完整列表、分类与地区筛选及官方原文链接。个性化匹配和AI说明仅在登录后提供。完整列表不代表资格保证，申请前请核对官方原文。",
    officialResources: "官方信息链接",
    resourceLead: "跳转外部网站前，请先了解各网站可提供的内容以及适合打开的时机。",
    resourcePurposeLabel: "可以查找的内容",
    resourceWhenLabel: "何时打开官方页面",
    resourcePurposes: {
      scholarship: "可查看奖学金、助学贷款和学费支持的制度说明及申请信息。",
      financial_support: "可查看青年资产积累和普惠金融支持的对象条件及产品说明。",
      employment: "可按条件搜索职位，或查看青年就业统计的官方表格和口径。",
      policy_news: "可查看政府青年政策动态、韩国雇佣劳动部政策资料和新闻稿的最新列表。",
    },
    resourceWhen: {
      "configured-public-api": "需要查看比本页摘要更完整的表格、公告或申请流程时",
      "api-ready": "需要查看当前未采集的详细项目或核实提供方最新覆盖范围时",
      "enterprise-api-only": "企业会员申请Open API授权前需要核对提供范围与输入条件时",
      "external-directory": "需要自行设置搜索条件、查看最新列表或实际申请、应聘时",
    },
    openLatest: "在官方原文中核实最新信息",
    open: "官方页面",
    accesses: {
      "configured-public-api": "已接入免费公共API",
      "api-ready": "可接入官方API",
      "enterprise-api-only": "需要企业会员授权・当前不调用",
      "external-directory": "前往官方网站确认",
    },
    employmentNotice: "就业24职位自动更新目前受提供机构访问条件限制。仍可使用下方官方招聘、培训、职业菜单以及雇佣劳动部和KOSIS资料。",
    newsNotice: "系统从韩国雇佣劳动部官方新闻稿和政策资料中筛选青年相关内容并显示简要摘要。请通过“查看详情”确认发布日期及官方原文。",
    noItems: "按当前资料筛选出的项目为0条。",
    noItemsHelp: "不会用无关内容填充页面，只显示官方数据更新后可确认条件的项目。",
    noItemsAll: "目前收集到的青年政策为0条。",
    noItemsAllHelp: "请在官方数据更新后重试。",
    noItemsFiltered: "没有符合所选搜索条件的青年政策。",
    noItemsFilteredHelp: "请放宽关键词、时间、分类或地区条件，或选择“全部地区范围”继续查看已收集的政策。",
    loadingTitle: "正在核对所选青年政策。",
    loadingHelp: "新的分类与地区结果返回前，不显示上一批政策及统计。",
    officialNotice: "最终资格、截止日期和材料请以官方原文为准。",
    published: "发布／基准日期",
  },
} satisfies Record<PublicInformationLocale, {
  title: string;
  lead: string;
  sections: Record<YouthPolicySectionId, [string, string]>;
  featured: string;
  count: string;
  allCount: string;
  personalizedView: string;
  allView: string;
  allNotice: string;
  officialResources: string;
  resourceLead: string;
  resourcePurposeLabel: string;
  resourceWhenLabel: string;
  resourcePurposes: Record<YouthPolicySectionId, string>;
  resourceWhen: Record<YouthOfficialResourceAccess, string>;
  openLatest: string;
  open: string;
  accesses: Record<YouthOfficialResourceAccess, string>;
  employmentNotice: string;
  newsNotice: string;
  noItems: string;
  noItemsHelp: string;
  noItemsAll: string;
  noItemsAllHelp: string;
  noItemsFiltered: string;
  noItemsFilteredHelp: string;
  loadingTitle: string;
  loadingHelp: string;
  officialNotice: string;
  published: string;
}>;

function DefaultPolicyCard({
  item,
  locale,
}: {
  item: PublicInformationItem;
  locale: PublicInformationLocale;
}) {
  const t = copy[locale];
  const sourceUrl = safePublicHttpUrl(item.sourceUrl);
  return <article className={styles.policyCard}>
    <header><span>{item.source}</span>{item.publishedAt && <time dateTime={item.publishedAt}>{t.published} {item.publishedAt}</time>}</header>
    <h3>{item.title}</h3>
    <p>{item.summary}</p>
    <YouthPolicyMatchEvidence match={item.youthPolicyMatch} locale={locale} />
    <footer>
      <small>{t.officialNotice}</small>
      {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer noopener">{t.open}<ExternalLink size={13} /></a>}
    </footer>
  </article>;
}

export function YouthPolicyFourSections({
  dashboard,
  locale,
  loading = false,
  viewMode,
  selectedSection,
  onSectionChange,
  regionSelection,
  onRegionSelectionChange,
  onViewModeChange,
  renderItems,
}: {
  dashboard: Pick<PublicDataDashboard, "authenticated" | "categories" | "sources" | "youthPolicyPersonalization">;
  locale: PublicInformationLocale;
  loading?: boolean;
  viewMode: "personalized" | "all";
  selectedSection: YouthPolicySectionId;
  onSectionChange: (section: YouthPolicySectionId) => void;
  regionSelection: YouthPolicyRegionSelection;
  onRegionSelectionChange: (selection: YouthPolicyRegionSelection) => void;
  onViewModeChange: (mode: "personalized" | "all") => void;
  renderItems?: (items: PublicInformationItem[]) => ReactNode;
}) {
  const [mapImageAvailable, setMapImageAvailable] = useState(true);
  const selected = selectedSection;
  const regionMode: RegionFilterMode = regionSelection.mode;
  const selectedRegion = regionSelection.mode === "region" ? regionSelection.region : "seoul";
  const includeNationwide = regionSelection.mode === "region"
    ? regionSelection.includeNationwide
    : true;
  const youthGroup = dashboard.categories.find((group) => group.id === "youth");
  const youthFacets = youthGroup?.youthFacets;
  const hasCollectedPolicies = (youthGroup?.totalCount ?? 0) > 0;
  const {
    sections,
    unfilteredCount,
    nationwideCount,
    regionCounts,
  } = useMemo(() => {
    const build = (selection: YouthPolicyRegionSelection) => viewMode === "all"
      ? allYouthPolicySections(dashboard, selection)
      : personalizedYouthPolicySections(dashboard, selection);
    const count = (groups: ReturnType<typeof build>) =>
      groups.reduce((total, section) => total + section.count, 0);
    // The route already applies the selected section/geography to the full
    // viewer catalogue. Group the current page only for rendering, while the
    // server-computed facets keep tab and map counts stable across pages.
    const pageSections = build({ mode: "all" });
    const fallbackRegionCounts = Object.fromEntries(YOUTH_POLICY_REGIONS.map((region) => [
      region,
      count(build({ mode: "region", region, includeNationwide: false })),
    ])) as Record<YouthPolicyRegion, number>;
    return {
      sections: pageSections.map((section) => ({
        ...section,
        count: youthFacets?.sectionCounts[section.id] ?? section.count,
      })),
      unfilteredCount: youthFacets?.allRegionCount ?? count(pageSections),
      nationwideCount: youthFacets?.nationwideCount ?? count(build({ mode: "nationwide" })),
      regionCounts: Object.fromEntries(YOUTH_POLICY_REGIONS.map((region) => [
        region,
        youthFacets?.regionCounts[region] ?? fallbackRegionCounts[region],
      ])) as Record<YouthPolicyRegion, number>,
    };
  }, [dashboard, viewMode, youthFacets]);
  const active = sections.find((section) => section.id === selected) ?? sections[0];
  const t = copy[locale];
  const regionT = regionFilterCopy[locale];
  const countLabel = viewMode === "all" ? t.allCount : t.count;

  if (loading) {
    return <section
      className={styles.shell}
      aria-labelledby="youth-policy-sections-title"
      aria-busy="true"
    >
      <header className={styles.heading}>
        <div><span>{viewMode === "personalized" ? sectionEyebrowCopy[locale].personalized : sectionEyebrowCopy[locale].directory}</span><h2 id="youth-policy-sections-title">{t.title}</h2><p>{t.lead}</p></div>
        {dashboard.authenticated && <div className={styles.viewSwitch} role="group" aria-label={t.allView}>
          <button type="button" disabled aria-pressed={viewMode === "personalized"}>{t.personalizedView}</button>
          <button type="button" disabled aria-pressed={viewMode === "all"}>{t.allView}</button>
        </div>}
      </header>
      <div className={styles.empty} role="status" aria-live="polite">
        <strong>{t.loadingTitle}</strong>
        <p>{t.loadingHelp}</p>
      </div>
    </section>;
  }

  const activeSources = dashboard.sources.filter((source) => sectionSourceIds[selected].includes(source.id));
  const notice = selected === "employment"
    ? t.employmentNotice
    : selected === "policy_news"
      ? t.newsNotice
      : null;
  const displayedCount = dashboard.categories.find((group) => group.id === "youth")?.filteredTotalCount
    ?? active.count;
  const regionSummary = regionMode === "nationwide"
    ? regionT.nationwideSelected(displayedCount)
    : regionMode === "region"
      ? regionT.selected(
          regionLabels[locale][selectedRegion],
          regionCounts[selectedRegion],
          nationwideCount,
          includeNationwide,
        )
      : regionT.allSelected(unfilteredCount);

  function selectRegionMode(mode: RegionFilterMode) {
    if (mode === "nationwide") {
      onRegionSelectionChange({ mode: "nationwide" });
      return;
    }
    if (mode === "region") {
      onRegionSelectionChange({ mode: "region", region: selectedRegion, includeNationwide });
      return;
    }
    onRegionSelectionChange({ mode: "all" });
  }

  function selectRegion(region: YouthPolicyRegion) {
    onRegionSelectionChange({ mode: "region", region, includeNationwide });
  }

  return <section className={styles.shell} aria-labelledby="youth-policy-sections-title">
    <header className={styles.heading}>
      <div><span>{viewMode === "personalized" ? sectionEyebrowCopy[locale].personalized : sectionEyebrowCopy[locale].directory}</span><h2 id="youth-policy-sections-title">{t.title}</h2><p>{t.lead}</p></div>
      {dashboard.authenticated && <div className={styles.viewSwitch} role="group" aria-label={t.allView}>
        <button type="button" aria-pressed={viewMode === "personalized"} onClick={() => onViewModeChange("personalized")}>{t.personalizedView}</button>
        <button type="button" aria-pressed={viewMode === "all"} onClick={() => onViewModeChange("all")}>{t.allView}</button>
      </div>}
    </header>
    {viewMode === "all" && <p className={styles.allViewNotice} role="note">{t.allNotice}</p>}
    <section className={styles.regionExplorer} aria-labelledby="youth-region-filter-title">
      <header className={styles.regionExplorerHeader}>
        <span className={styles.regionExplorerIcon}><MapPinned size={21} /></span>
        <div>
          <h3 id="youth-region-filter-title">{regionT.title}</h3>
          <p>{regionT.lead}</p>
        </div>
        <div className={styles.scopeSwitch} role="group" aria-label={regionT.title}>
          <button
            type="button"
            aria-pressed={regionMode === "all"}
            onClick={() => selectRegionMode("all")}
          >{regionT.all}<small>{unfilteredCount}</small></button>
          <button
            type="button"
            aria-pressed={regionMode === "nationwide"}
            onClick={() => selectRegionMode("nationwide")}
          >{regionT.nationwide}<small>{nationwideCount}</small></button>
          <button
            type="button"
            aria-pressed={regionMode === "region"}
            onClick={() => selectRegionMode("region")}
          >{regionT.region}<small>{regionCounts[selectedRegion]}</small></button>
        </div>
      </header>
      <div className={styles.regionMapLayout}>
        <div className={styles.koreaMap} aria-label={regionT.choose}>
          {/* The map is an MIT-licensed SGIS-derived boundary asset, not a third-party logo. */}
          {mapImageAvailable
            ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={KOREA_MAP_URL} alt="" aria-hidden="true" loading="lazy" onError={() => setMapImageAvailable(false)} />
            </>
            : <p className={styles.mapFallback} role="status"><MapPinned size={22} aria-hidden="true" />{regionT.mapUnavailable}</p>}
          {MOBILE_REGION_ORDER.map((region) => {
            const position = KOREA_REGION_MAP_POSITIONS[region];
            return <button
              key={region}
              type="button"
              data-region={region}
              className={regionMode === "region" && selectedRegion === region
                ? styles.mapRegionSelected
                : undefined}
              style={{
                "--region-x": `${position.x}%`,
                "--region-y": `${position.y}%`,
              } as CSSProperties}
              aria-label={`${regionLabels[locale][region]} · ${regionCounts[region]}`}
              aria-pressed={regionMode === "region" && selectedRegion === region}
              onClick={() => selectRegion(region)}
            >
              <span>{mapRegionLabel(locale, region)}</span>
              <small>{regionCounts[region]}</small>
            </button>;
          })}
        </div>
        <div className={styles.regionChooser}>
          <label>
            <span>{regionT.choose}</span>
            <select
              value={regionMode === "region" ? selectedRegion : ""}
              onChange={(event) => selectRegion(event.target.value as YouthPolicyRegion)}
            >
              <option value="" disabled>{regionT.choose}</option>
              {YOUTH_POLICY_REGIONS.map((region) =>
                <option key={region} value={region}>
                  {regionLabels[locale][region]} · {regionCounts[region]}
                </option>)}
            </select>
          </label>
          <div className={styles.regionButtonGrid}>
            {YOUTH_POLICY_REGIONS.map((region) => <button
              key={region}
              type="button"
              aria-pressed={regionMode === "region" && selectedRegion === region}
              onClick={() => selectRegion(region)}
            >
              <span>{regionLabels[locale][region]}</span><small>{regionCounts[region]}</small>
            </button>)}
          </div>
          <label className={styles.includeNationwide}>
            <input
              type="checkbox"
              checked={includeNationwide}
              onChange={(event) => onRegionSelectionChange({
                mode: "region",
                region: selectedRegion,
                includeNationwide: event.target.checked,
              })}
            />
            <span>{regionT.includeNationwide}</span>
          </label>
        </div>
      </div>
      <footer className={styles.regionExplorerFooter}>
        <strong aria-live="polite">{regionSummary}</strong>
        <span>{regionT.unknown}</span>
        <a href={KOREA_MAP_SOURCE} target="_blank" rel="noreferrer noopener">{regionT.source}<ExternalLink size={12} /></a>
      </footer>
    </section>
    <div className={styles.sectionGrid} role="tablist" aria-label={t.title}>
      {sections.map((section) => {
        const Icon = sectionIcons[section.id];
        const [label, description] = t.sections[section.id];
        const featured = section.id === "employment" || section.id === "policy_news";
        return <button
          key={section.id}
          type="button"
          role="tab"
          id={`youth-tab-${section.id}`}
          aria-selected={selected === section.id}
          aria-controls="youth-section-panel"
          tabIndex={selected === section.id ? 0 : -1}
          className={selected === section.id ? styles.selected : undefined}
          data-featured={featured ? "true" : "false"}
          onClick={() => onSectionChange(section.id)}
          onKeyDown={(event) => {
            const currentIndex = SECTION_IDS.indexOf(section.id);
            let nextIndex: number | null = null;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = SECTION_IDS.length - 1;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              nextIndex = (currentIndex + 1) % SECTION_IDS.length;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              nextIndex = (currentIndex - 1 + SECTION_IDS.length) % SECTION_IDS.length;
            }
            if (nextIndex === null) return;
            event.preventDefault();
            const nextSection = SECTION_IDS[nextIndex];
            onSectionChange(nextSection);
            requestAnimationFrame(() => {
              document.getElementById(`youth-tab-${nextSection}`)?.focus();
            });
          }}
        >
          <span className={styles.sectionIcon}><Icon size={20} /></span>
          <span className={styles.sectionText}><strong>{label}</strong><small>{description}</small></span>
          <span className={styles.sectionCount}>{featured && <em>{t.featured}</em>}<b>{loading ? "–" : section.count}</b>{countLabel}</span>
        </button>;
      })}
    </div>
    <div
      id="youth-section-panel"
      role="tabpanel"
      aria-labelledby={`youth-tab-${selected}`}
      className={styles.panel}
    >
      <div className={styles.panelHeading}>
        <div><strong>{t.sections[selected][0]}</strong><p>{t.sections[selected][1]}</p></div>
        <span>{loading ? "–" : active.count} {countLabel}</span>
      </div>
      {notice && <p className={styles.integrationNotice}>{notice}</p>}
      {!!activeSources.length && <ul className={styles.sourceStatuses} aria-label={t.officialResources}>
        {activeSources.map((source) => <li key={source.id} data-status={source.status}>
          <span>{source.label}</span>
          <strong>{sourceStatusCopy[locale][source.status]}</strong>
          <small>{source.itemCount}</small>
        </li>)}
      </ul>}
      {!loading && active.items.length === 0
        ? <div className={styles.empty}><strong>{viewMode === "all" ? (hasCollectedPolicies ? t.noItemsFiltered : t.noItemsAll) : t.noItems}</strong><p>{viewMode === "all" ? (hasCollectedPolicies ? t.noItemsFilteredHelp : t.noItemsAllHelp) : t.noItemsHelp}</p></div>
        : renderItems
          ? renderItems(active.items)
          : <div className={styles.items}>{active.items.map((item) => <div key={item.id}><DefaultPolicyCard item={item} locale={locale} /></div>)}</div>}
      <aside className={styles.resources} aria-label={t.officialResources}>
        <div><strong>{t.officialResources}</strong><p>{t.resourceLead}</p></div>
        <ul>{active.resources.map((resource) => {
          const detail = resource.detail ? work24ResourceCopy[locale][resource.detail] : null;
          return <li key={resource.id}>
          <article className={styles.resourcePreviewCard}>
            <header>
              <span><strong>{resource.name}</strong><small>{resource.provider}</small></span>
              <em>{t.accesses[resource.access]}</em>
            </header>
            <dl>
              <div><dt>{t.resourcePurposeLabel}</dt><dd>{detail?.purpose ?? t.resourcePurposes[resource.section]}</dd></div>
              <div><dt>{t.resourceWhenLabel}</dt><dd>{detail?.when ?? t.resourceWhen[resource.access]}</dd></div>
            </dl>
            <a href={resource.url} target="_blank" rel="noreferrer noopener" aria-label={`${resource.name} · ${t.openLatest}`}>
              <span>{t.openLatest}</span><ArrowRight size={15} />
            </a>
          </article>
        </li>})}</ul>
      </aside>
    </div>
  </section>;
}
