import type { SupportedLocale } from "@/lib/rag/knowledge";
import { runtimeSecret } from "@/lib/runtime-settings";
import { decodeSafeBrowsingV5Response } from "@/lib/safe-browsing-v5";
import { requireSameOrigin } from "@/lib/auth/http";
import { runPhishingReputationLookupWithQuota } from "@/lib/phishing-reputation-quota";

type RiskLevel = "low" | "medium" | "high";
type PhishingExposure = "opened-link" | "installed-app" | "shared-credentials" | "sent-money";
type IncidentResponseLevel = "prevention" | "urgent" | "emergency";

interface Rule {
  id: string;
  weight: number;
  patterns: RegExp[];
  labels: Record<SupportedLocale, string>;
}

interface PhishingRequestBody {
  text?: unknown;
  message?: unknown;
  content?: unknown;
  url?: unknown;
  sender?: unknown;
  locale?: unknown;
  exposures?: unknown;
  reputationConsent?: unknown;
}

const MAX_BODY_CHARS = 60_000;
const MAX_INPUT_CHARS = 20_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const SAFE_BROWSING_CACHE_FALLBACK_MS = 5 * 60_000;
const SAFE_BROWSING_CACHE_MAX_MS = 30 * 60_000;
const URL_REPUTATION_CACHE_MAX_ENTRIES = 5_000;
const SAFE_BROWSING_PROVIDER_URL = "https://developers.google.com/safe-browsing/v4/advisory";
const COUNTER_SCAM_URL = "https://www.counterscam112.go.kr/";
const KISA_SMISHING_URL = "https://www.boho.or.kr/kr/subPage.do?menuNo=205116";
const OFFICIAL_SOURCE_REVIEWED_AT = "2026-08-11";
const LOCALES = new Set<SupportedLocale>(["ko", "en", "ja", "zh"]);
const EXPOSURES = new Set<PhishingExposure>([
  "opened-link",
  "installed-app",
  "shared-credentials",
  "sent-money",
]);
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const urlReputationCache = new Map<string, { unsafe: boolean; expiresAt: number }>();
let requestWindowSalt: Uint8Array | null = null;
let lastRequestWindowCleanupAt = 0;

const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/gu;
const DEFANGED_URL_MARKER = /\bhxxps?(?::\/\/|\s*\[\s*:\s*\]\s*\/\/)|\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}|\b[a-z0-9-]+\s+dot\s+[a-z]{2,}\b/iu;
const URL_LIKE_MARKER = /(?:https?:\/\/|hxxps?(?::\/\/|\s*\[\s*:\s*\]\s*\/\/)|www\.|[a-z0-9][a-z0-9-]{0,62}(?:(?:[\[({]\s*(?:\.|dot)\s*[\])}]|\.)|\s+dot\s+)[a-z]{2,})/iu;

const RULES: readonly Rule[] = [
  {
    id: "urgency",
    weight: 12,
    patterns: [
      /즉시|긴급|지금\s*바로|오늘\s*안에|몇\s*분\s*내|시간이\s*없/i,
      /urgent|immediately|act\s+now|within\s+\d+\s*(?:minutes?|hours?)/i,
      /至急|今すぐ|本日中|\d+分以内/i,
      /紧急|立即|马上|限时|\d+分钟内/i,
    ],
    labels: { ko: "긴급한 행동을 재촉함", en: "Pressures urgent action", ja: "緊急の行動を迫る", zh: "催促立即行动" },
  },
  {
    id: "authority-impersonation",
    weight: 11,
    patterns: [
      /(?:검찰|경찰|금융감독원|국세청|법원|은행|카드사|정부기관)(?:입니다|이라고|에서|직원|수사|보안|통보|안내)/i,
      /(?:prosecutor|police|financial\s+authority|tax\s+office|court|bank)(?:\s+security|\s+officer|\s+notice|\s+calling|\s+here|\s+says)/i,
      /(?:検察|警察|金融庁|税務署|裁判所|銀行)(?:です|職員|から|通知|捜査)/i,
      /(?:检察院|公安|金融监管|税务局|法院|银行)(?:通知|工作人员|来电|安全|调查)/i,
    ],
    labels: { ko: "공공·금융기관을 사칭할 수 있음", en: "May impersonate an authority or bank", ja: "公的機関・金融機関を装う可能性", zh: "可能冒充政府或金融机构" },
  },
  {
    id: "credential-request",
    weight: 28,
    patterns: [
      /(?:인증번호|인증\s*코드|OTP|비밀번호|보안카드|공동인증서|신분증\s*사진).{0,20}(?:보내|알려|읽어|입력|공유|제출|찍어|회신|답장|응답)|(?:보내|알려|읽어|입력|공유|제출|회신|답장|응답).{0,20}(?:인증번호|인증\s*코드|OTP|비밀번호|보안카드|공동인증서)/i,
      /(?:(?:send|share|provide|enter|submit|forward|reply\s+with)|tell\s+(?:me\s+)?|give\s+(?:me\s+)?).{0,24}(?:verification\s*code|authentication\s*code|auth\s*code|passcode|one[- ]time\s*(?:password|code)|OTP|password|PIN|security\s*code)|(?:verification\s*code|authentication\s*code|auth\s*code|passcode|one[- ]time\s*(?:password|code)|OTP|password|PIN).{0,24}(?:send|share|provide|enter|submit|forward|reply\s+with|tell|give|read\s+(?:it\s+)?out)|read\s+(?:the\s+)?(?:verification|authentication|security|one[- ]time)\s+code\s+out|read\s+(?:the\s+)?(?:OTP|PIN|passcode)\s+out/i,
      /(?:tell|send|give|forward|reply(?:\s+with)?).{0,28}(?:six[- ]digit\s+(?:code|number)|login\s+code|(?:code|number).{0,12}(?:just\s+)?(?:received|texted|sent)|(?:code|number)\s+in\s+(?:the\s+)?(?:SMS|text\s+message))|what\s+is\s+(?:the\s+)?(?:code|number).{0,18}(?:texted|sent|received)/i,
      /what\s+is\s+(?:your\s+)?(?:passcode|PIN|password|OTP|verification\s*code)(?=\s*(?:[?.!]|$))|what\s+is\s+your\s+(?:card\s*number|CVV|CVC|bank\s+account\s*number|social\s+security\s*number|SSN)(?=\s*(?:[?.!]|$))|(?:(?:send|share|provide|enter|upload|submit)|tell\s+me).{0,30}(?:card\s*number|CVV|CVC|bank\s+account\s*number|social\s+security\s*number|SSN|passport\s*(?:photo|image)|(?:photo|image)\s+of\s+(?:your\s+)?ID|ID\s*(?:photo|image)|wallet\s+seed\s+phrase|recovery\s+phrase|crypto\s+private\s+key)|(?:card\s*number|CVV|CVC|bank\s+account\s*number|social\s+security\s*number|SSN|passport\s*(?:photo|image)|ID\s*(?:photo|image)|wallet\s+seed\s+phrase|recovery\s+phrase|crypto\s+private\s+key).{0,30}(?:send|share|provide|enter|upload|submit|tell)/i,
      /(?:approve|accept|tap\s+yes|confirm).{0,24}(?:sign[- ]in|login|MFA|authentication).{0,18}(?:notification|prompt|push|request)|(?:sign[- ]in|login|MFA|authentication).{0,18}(?:notification|prompt|push|request).{0,24}(?:approve|accept|tap\s+yes|confirm)/i,
      /(?:문자|메시지|SMS).{0,18}(?:받은|온|도착한)?\s*(?:6자리\s*)?(?:번호|코드).{0,18}(?:알려|보내|답장|입력|읽어)|(?:알려|보내|답장|입력|읽어).{0,18}(?:문자|메시지|SMS).{0,18}(?:번호|코드)/i,
      /(?:인증번호|비밀번호|PIN|카드번호|CVV|CVC|계좌번호|주민등록번호|외국인등록번호)(?:가|은|는)?\s*(?:뭐|무엇)|(?:카드번호|CVV|CVC|계좌번호|주민등록번호|외국인등록번호|여권\s*사진|신분증\s*사진|지갑\s*시드\s*문구|복구\s*문구|개인키).{0,24}(?:알려|보내|입력|업로드|공유|제출)|(?:알려|보내|입력|업로드|공유|제출).{0,24}(?:카드번호|CVV|CVC|계좌번호|주민등록번호|외국인등록번호|여권\s*사진|신분증\s*사진|지갑\s*시드\s*문구|복구\s*문구|개인키)/i,
      /(?:로그인|MFA|인증).{0,18}(?:알림|요청|푸시).{0,18}(?:승인|허용|예|확인)|(?:승인|허용|예를?\s*눌러|확인).{0,18}(?:로그인|MFA|인증).{0,18}(?:알림|요청|푸시)/i,
      /(?:認証番号|ワンタイムパスワード|暗証番号|パスワード|本人確認書類).{0,18}(?:送って|教えて|読み上げ|返信|入力|共有|提出)|(?:送って|教えて|読み上げ|返信|入力|共有|提出).{0,18}(?:認証番号|ワンタイムパスワード|暗証番号|パスワード)/i,
      /(?:今|SMS|メッセージ).{0,18}(?:届いた|受け取った)?\s*(?:6桁の?)?(?:番号|コード).{0,18}(?:教えて|送って|返信|入力|読み上げ)/i,
      /(?:認証番号|暗証番号|パスワード|カード番号|CVV|CVC|口座番号|マイナンバー|在留カード番号)(?:は|って)?何(?:ですか)?|(?:カード番号|CVV|CVC|口座番号|マイナンバー|在留カード番号|パスポート(?:の)?写真|身分証(?:の)?写真|ウォレット(?:の)?シードフレーズ|復旧フレーズ|秘密鍵).{0,24}(?:送って|教えて|入力|アップロード|共有|提出)|(?:送って|教えて|入力|アップロード|共有|提出).{0,24}(?:カード番号|CVV|CVC|口座番号|マイナンバー|在留カード番号|パスポート(?:の)?写真|身分証(?:の)?写真|シードフレーズ|復旧フレーズ|秘密鍵)/i,
      /(?:サインイン|ログイン|MFA|認証).{0,18}(?:通知|要求|プッシュ).{0,18}(?:承認|許可|確認)/i,
      /(?:验证码|动态口令|密码|支付密码|身份证照片).{0,18}(?:发送|提供|告诉|回复|念出|输入|共享|提交)|(?:发送|提供|告诉|回复|念出|输入|共享|提交).{0,18}(?:验证码|动态口令|密码|支付密码)/i,
      /(?:短信|消息|SMS).{0,18}(?:收到|发来|里的)?\s*(?:6位)?(?:数字|号码|代码).{0,18}(?:告诉|发送|发给|回复|输入|念出)|(?:告诉|发送|发给|回复|输入|念出).{0,18}(?:短信|消息|SMS).{0,18}(?:数字|号码|代码)/i,
      /(?:验证码|密码|支付密码|银行卡号|CVV|CVC|银行账户|身份证号)是什么|(?:银行卡号|CVV|CVC|银行账户|身份证号|护照照片|身份证照片|钱包助记词|恢复短语|私钥).{0,24}(?:发送|告诉|输入|上传|共享|提交)|(?:发送|告诉|输入|上传|共享|提交).{0,24}(?:银行卡号|CVV|CVC|银行账户|身份证号|护照照片|身份证照片|钱包助记词|恢复短语|私钥)/i,
      /(?:登录|登陆|MFA|身份验证).{0,18}(?:通知|请求|推送).{0,18}(?:批准|允许|确认)|(?:批准|允许|确认).{0,24}(?:登录|登陆|MFA|身份验证).{0,18}(?:通知|请求|推送)/i,
    ],
    labels: { ko: "인증·개인정보를 요구함", en: "Requests credentials or identity data", ja: "認証・本人情報を要求", zh: "索取验证码或身份信息" },
  },
  {
    id: "payment-request",
    weight: 23,
    patterns: [
      /(?:안전계좌|보호계좌|가상자산|코인|상품권|기프트\s*카드).{0,18}(?:송금|이체|입금|구매|보내)|(?:송금|이체|입금|구매|보내).{0,18}(?:안전계좌|보호계좌|가상자산|코인|상품권|기프트\s*카드)|(?:송금|이체|입금)(?:해|하|하세요|하십시오|바랍니다)|(?:이|해당|지정|아래)?\s*계좌(?:로|에)\s*(?:돈을?\s*|\d[\d,.]*\s*(?:원|만원))?.{0,10}(?:보내|넣어|입금|송금|이체)/i,
      /(?:wire|transfer|send|pay|buy|deposit|move).{0,24}(?:money|funds?|safe\s+account|crypto|bitcoin|gift\s*card|voucher|(?:this|the|my|our)\s+(?:bank\s+)?account|account\s+below)|(?:safe\s+account|crypto|bitcoin|gift\s*card|voucher|account\s+below).{0,24}(?:wire|transfer|send|pay|buy|deposit|move)|\b(?:wire|transfer|send|pay|deposit|move)\b\s+(?:(?:the\s+)?(?:funds?|money)\s+(?:to|into)\s+(?:(?:this|the|my|our)\s+(?:bank\s+)?account|the\s+account\s+below)|(?:[$€£¥]\s*)?\d[\d,.]*(?:\s*(?:usd|dollars?|euros?|pounds?|won|yen|yuan))?(?:\s+(?:to|into)\s+(?:(?:this|the|my|our)\s+(?:bank\s+)?account|the\s+account\s+below))?)/i,
      /(?:送金|振込|購入).{0,18}(?:安全口座|暗号資産|ビットコイン|ギフトカード)|(?:安全口座|暗号資産|ビットコイン|ギフトカード).{0,18}(?:送金|振込|購入)|(?:この|指定|以下の)?口座(?:に|へ)(?:\d[\d,.]*\s*(?:円|万円)(?:を)?)?.{0,8}(?:送って|送金|振り込|振込)/i,
      /(?:转账|汇款|购买).{0,18}(?:安全账户|虚拟货币|比特币|礼品卡)|(?:安全账户|虚拟货币|比特币|礼品卡).{0,18}(?:转账|汇款|购买)|(?:向|往|给)(?:这个|该|以下)?账户(?:转账|汇款|打款?|打)(?:\d[\d,.]*\s*元)?/i,
    ],
    labels: { ko: "송금·가상자산·상품권을 요구함", en: "Requests money, crypto, or gift cards", ja: "送金・暗号資産・ギフトカードを要求", zh: "要求转账、虚拟货币或礼品卡" },
  },
  {
    id: "remote-control-or-app",
    weight: 30,
    patterns: [
      /(?:원격\s*(?:제어|지원)|화면\s*공유|APK|팀뷰어|애니데스크|(?:이|해당|첨부된)(?:\s*(?:보안|지원|인증))?\s*앱).{0,18}(?:설치|다운로드|실행|연결|공유|열어)|(?:설치|다운로드|실행|연결).{0,18}(?:원격\s*(?:제어|지원)|APK|팀뷰어|애니데스크|(?:이|해당|첨부된)(?:\s*(?:보안|지원|인증))?\s*앱)/i,
      /(?:install|download|run|open|enable).{0,32}(?:remote\s*(?:access|control|support)|screen\s*share|(?:this|that|attached)(?:\s+(?:security|support|verification|remote\s+support))?\s+app|APK|TeamViewer|AnyDesk|RustDesk|QuickSupport)|(?:security|support|verification)\s+app.{0,32}(?:from\s+(?:this|the)\s+link|so\s+(?:i|we)\s+can|follow\s+the\s+instructions)|(?:remote\s*(?:access|control|support)|screen\s*share|APK|TeamViewer|AnyDesk|RustDesk|QuickSupport).{0,24}(?:install|download|run|open|enable)|(?:give|grant)\s+(?:me|us|support).{0,12}(?:remote\s+)?(?:access|control)|(?:so|and)\s+(?:i|we|support)\s+can\s+(?:access|control)\s+(?:your\s+)?(?:device|screen)/i,
      /(?:遠隔操作|画面共有|(?:この|添付の)(?:セキュリティ|サポート|認証)?\s*アプリ|APK).{0,18}(?:インストール|実行|接続|共有)|(?:インストール|実行|接続).{0,18}(?:遠隔操作|(?:この|添付の)(?:セキュリティ|サポート|認証)?\s*アプリ|APK)/i,
      /(?:远程控制|屏幕共享|(?:这个|该|附件中的)(?:安全|客服|验证)?\s*应用|APK).{0,18}(?:安装|下载|运行|连接)|(?:安装|下载|运行|连接).{0,18}(?:远程控制|(?:这个|该|附件中的)(?:安全|客服|验证)?\s*应用|APK)/i,
    ],
    labels: { ko: "원격제어·앱 설치를 유도함", en: "Pushes remote access or app installation", ja: "遠隔操作・アプリ導入を誘導", zh: "诱导远程控制或安装应用" },
  },
  {
    id: "guaranteed-return",
    weight: 22,
    patterns: [
      /원금\s*보장|수익\s*보장|확정\s*수익|무조건\s*수익|고수익\s*보장/i,
      /guaranteed\s+(?:return|profit)|risk[- ]free|double\s+your\s+money/i,
      /元本保証|利益保証|必ず儲かる|高収益保証/i,
      /保本|保证收益|稳赚不赔|高额回报/i,
    ],
    labels: { ko: "수익·원금 보장을 약속함", en: "Promises guaranteed returns", ja: "元本・利益の保証を約束", zh: "承诺保本或保证收益" },
  },
  {
    id: "job-task-scam",
    weight: 18,
    patterns: [
      /알바.*(?:선입금|수수료)|부업.*(?:입금|구매)|구매\s*대행.*입금|리뷰.*수익/i,
      /job.*(?:deposit|fee)|task.*commission|pay\s+first.*work|review.*income/i,
      /副業.*(?:入金|手数料)|アルバイト.*先払い|レビュー.*報酬/i,
      /兼职.*(?:垫付|手续费)|刷单|任务.*佣金/i,
    ],
    labels: { ko: "부업·과제형 사기 패턴", en: "Matches a job or task scam pattern", ja: "副業・タスク詐欺の特徴", zh: "符合兼职或任务诈骗模式" },
  },
  {
    id: "family-emergency",
    weight: 22,
    patterns: [
      /휴대폰.*(?:고장|잃어버)|엄마|아빠|자녀.*(?:사고|납치)|합의금.*급/i,
      /new\s+phone|phone\s+(?:broke|lost)|your\s+(?:child|son|daughter).*(?:accident|kidnap)/i,
      /携帯.*(?:壊れ|紛失)|息子|娘.*(?:事故|誘拐)/i,
      /手机.*(?:坏了|丢了)|儿子|女儿.*(?:事故|绑架)/i,
    ],
    labels: { ko: "가족 긴급상황을 가장할 수 있음", en: "May fake a family emergency", ja: "家族の緊急事態を装う可能性", zh: "可能伪造家人紧急情况" },
  },
  {
    id: "secrecy-isolation",
    weight: 15,
    patterns: [
      /아무에게도\s*말|비밀로|은행\s*직원에게.*말하지|전화\s*끊지\s*마/i,
      /do\s+not\s+tell|keep\s+this\s+secret|stay\s+on\s+the\s+line/i,
      /誰にも言わない|秘密に|電話を切らない/i,
      /不要告诉任何人|保密|不要挂电话/i,
    ],
    labels: { ko: "주변과의 확인을 막음", en: "Discourages independent verification", ja: "第三者への確認を妨げる", zh: "阻止向他人核实" },
  },
  {
    id: "threat-or-freeze",
    weight: 17,
    patterns: [
      /체포|구속|압류|수사\s*대상|계좌\s*(?:정지|동결)|벌금|법적\s*조치/i,
      /arrest|seizure|account\s+(?:freeze|suspend)|legal\s+action|fine/i,
      /逮捕|差押え|口座.*(?:凍結|停止)|法的措置/i,
      /逮捕|查封|账户.*(?:冻结|停用)|法律行动/i,
    ],
    labels: { ko: "체포·압류·계좌정지를 위협함", en: "Threatens arrest, seizure, or account closure", ja: "逮捕・差押え・口座停止を脅す", zh: "以逮捕、查封或冻结账户相威胁" },
  },
  {
    id: "daily-life-notice-lure",
    weight: 10,
    patterns: [
      /택배|배송|청첩장|부고|교통\s*범칙금|과태료|건강검진|모바일\s*고지|정부\s*지원금/i,
      /parcel|delivery|wedding\s+invitation|funeral\s+notice|traffic\s+(?:fine|ticket)|health\s+check|government\s+benefit/i,
      /宅配|配送|結婚式|訃報|交通違反|健康診断|給付金/i,
      /快递|配送|婚礼邀请|讣告|交通罚款|体检|政府补贴/i,
    ],
    labels: { ko: "택배·부고·공공알림 등 일상 안내를 사칭할 수 있음", en: "May imitate an everyday or public-service notice", ja: "配送・訃報・公的通知などを装う可能性", zh: "可能冒充快递、讣告或公共通知" },
  },
  {
    id: "loan-advance-fee",
    weight: 25,
    patterns: [
      /대출.{0,18}(?:보증료|수수료|인지세|선입금|작업비).{0,12}(?:입금|송금|납부)|(?:보증료|수수료|인지세).{0,12}(?:먼저|선입금).{0,12}(?:입금|송금|납부)/i,
      /loan.{0,24}(?:fee|deposit|insurance|tax).{0,18}(?:pay|send|transfer)|pay.{0,18}(?:fee|deposit).{0,18}(?:before|first).{0,18}loan/i,
      /融資.{0,18}(?:保証料|手数料|前払い).{0,18}(?:振込|支払)/i,
      /贷款.{0,18}(?:保证金|手续费|前期费用).{0,18}(?:转账|支付)/i,
    ],
    labels: { ko: "대출 실행 전 비용·선입금을 요구함", en: "Requests an advance fee before a loan", ja: "融資前の手数料・前払いを要求", zh: "要求在放款前支付费用" },
  },
  {
    id: "investment-room-lure",
    weight: 18,
    patterns: [
      /투자\s*리딩|리딩방|공모주\s*배정|내부\s*정보|급등\s*종목|손실\s*복구/i,
      /investment\s+(?:signal|room|group)|stock\s+tip|pre[- ]ipo\s+allocation|inside\s+information|recover\s+your\s+loss/i,
      /投資助言グループ|銘柄情報|未公開株|損失回復/i,
      /投资群|荐股群|内幕消息|原始股|挽回损失/i,
    ],
    labels: { ko: "투자리딩방·손실복구형 접근과 유사함", en: "Matches an investment-group or loss-recovery lure", ja: "投資助言グループ・損失回復型の勧誘に類似", zh: "类似荐股群或挽回损失诱导" },
  },
] as const;

const OBFUSCATION_RULE: Rule = {
  id: "text-obfuscation",
  weight: 8,
  patterns: [],
  labels: {
    ko: "보이지 않는 문자로 표현을 숨김",
    en: "Uses invisible characters to hide wording",
    ja: "不可視文字で表現を隠している",
    zh: "使用不可见字符隐藏文字",
  },
};

const DEFANGED_URL_RULE: Rule = {
  id: "defanged-url",
  weight: 16,
  patterns: [],
  labels: {
    ko: "hxxps·[.] 형태로 변형된 URL이 있음",
    en: "Contains a URL disguised with hxxps or [.]",
    ja: "hxxps・[.] 形式に変形されたURLがある",
    zh: "包含使用 hxxps 或 [.] 变形的网址",
  },
};

const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "ow.ly",
  "cutt.ly",
  "han.gl",
]);

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, max = MAX_INPUT_CHARS) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function rawString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeAnalysisText(value: string) {
  return value.normalize("NFKC").replace(INVISIBLE_CHARACTERS, "");
}

function normalizeDefangedUrls(value: string) {
  return value
    .replace(/\bhxxps\s*\[\s*:\s*\]\s*\/\//giu, "https://")
    .replace(/\bhxxp\s*\[\s*:\s*\]\s*\/\//giu, "http://")
    .replace(/\bhxxps:\/\//giu, "https://")
    .replace(/\bhxxp:\/\//giu, "http://")
    .replace(/\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}/giu, ".")
    .replace(/(?<=[a-z0-9-])\s+dot\s+(?=[a-z0-9-])/giu, ".");
}

function localeFrom(value: unknown): SupportedLocale {
  return typeof value === "string" && LOCALES.has(value as SupportedLocale)
    ? (value as SupportedLocale)
    : "ko";
}

function exposuresFrom(value: unknown): PhishingExposure[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is PhishingExposure => (
    typeof item === "string" && EXPOSURES.has(item as PhishingExposure)
  )))].slice(0, EXPOSURES.size);
}

function extractUrls(text: string) {
  const normalized = normalizeDefangedUrls(normalizeAnalysisText(text));
  const explicit = Array.from(
    normalized.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'\]\[{}]+/giu),
    (match) => match[0],
  );
  const bare = Array.from(
    normalized.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?::\d{2,5})?(?:\/[^\s<>"'\]\[{}]*)?/giu),
    (match) => match[0],
  );
  return [...new Set([...explicit, ...bare].map((item) => (
    item
      .replace(/[),.;!?。、，；！？]+$/u, "")
      .replace(/^www\./iu, "https://www.")
      .replace(/^(?!https?:\/\/)/iu, "https://")
  )))].slice(0, 20);
}

function inspectUrl(raw: string) {
  const signals: string[] = [];
  let parsed: URL;

  try {
    parsed = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
  } catch {
    return { url: raw.slice(0, 200), host: "", signals: ["malformed-url"], score: 8, partial: true };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      url: parsed.protocol.slice(0, 20),
      host: "",
      signals: ["unsupported-url-scheme"],
      score: 18,
      partial: true,
    };
  }

  const host = parsed.hostname.toLocaleLowerCase();
  if (parsed.protocol === "http:") signals.push("unencrypted-http");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host) || /^\[[0-9a-f:]+\]$/iu.test(host)) {
    signals.push("ip-address-host");
  }
  if (parsed.username || parsed.password || raw.includes("@")) signals.push("embedded-credentials-or-at-sign");
  if (host.includes("xn--")) signals.push("punycode-domain");
  if (SHORTENERS.has(host.replace(/^www\./u, ""))) signals.push("shortened-url");
  if (parsed.port && !(
    (parsed.protocol === "http:" && parsed.port === "80")
    || (parsed.protocol === "https:" && parsed.port === "443")
  )) signals.push("nonstandard-port");
  let classificationPath = parsed.pathname;
  let pathDecodingIncomplete = false;
  try {
    const decodedOnce = decodeURIComponent(classificationPath);
    if (decodedOnce !== classificationPath) signals.push("encoded-path-content");
    classificationPath = decodedOnce;
    if (/%[0-9a-f]{2}/iu.test(classificationPath)) {
      classificationPath = decodeURIComponent(classificationPath);
      signals.push("double-encoded-path");
    }
  } catch {
    signals.push("malformed-path-encoding");
    pathDecodingIncomplete = true;
  }
  if (/\.(?:apk|exe|msi|scr|lnk|js|jse|vbs|vbe|bat|cmd|ps1|hta|jar|com|zip|rar|iso|img|docm|xlsm|dmg|pkg|mobileconfig)(?:$|[?#])/iu.test(classificationPath)) {
    signals.push("downloadable-file");
  }
  const labels = host.split(".").filter(Boolean);
  if (labels.length > 4) signals.push("many-subdomains");
  if (labels.some((label, index) => ["com", "net", "org", "co", "ac", "go"].includes(label) && index < labels.length - 2)) {
    signals.push("embedded-public-suffix");
  }
  if (host.length > 50) signals.push("long-hostname");
  if (/(?:^|\/)(?:login|verify|verification|secure|account|wallet|otp|password|bank|payment)(?:\/|$|[-_.])/iu.test(parsed.pathname)) {
    signals.push("credential-themed-path");
  }
  if (/(?:^|[?&])(?:url|redirect|redirect_uri|continue|target|next)=/iu.test(parsed.search)) {
    signals.push("redirect-parameter");
  }
  if (/%(?:2e|2f|5c)/iu.test(parsed.pathname)) signals.push("encoded-path-separator");
  if (/\.(?:apk|exe|msi|scr|lnk|js|jse|vbs|vbe|bat|cmd|ps1|hta|jar|com)(?:$|[?#])/iu.test(classificationPath)) {
    signals.push("executable-file");
  }

  const weight: Record<string, number> = {
    "unencrypted-http": 7,
    "ip-address-host": 18,
    "embedded-credentials-or-at-sign": 16,
    "punycode-domain": 14,
    "shortened-url": 10,
    "nonstandard-port": 8,
    "downloadable-file": 26,
    "many-subdomains": 7,
    "embedded-public-suffix": 22,
    "long-hostname": 7,
    "credential-themed-path": 10,
    "redirect-parameter": 10,
    "encoded-path-separator": 8,
    "encoded-path-content": 8,
    "double-encoded-path": 12,
    "malformed-path-encoding": 12,
    "executable-file": 10,
  };
  const score = signals.reduce((sum, signal) => sum + (weight[signal] ?? 0), 0);
  const safePath = parsed.pathname.slice(0, 1_000).replace(/[\p{Cc}]/gu, "");
  const hostWithPort = parsed.host.toLocaleLowerCase();

  return {
    url: `${parsed.protocol}//${hostWithPort}${safePath}`.slice(0, 1_500),
    host,
    signals,
    score,
    partial: parsed.pathname.length > 1_000 || Boolean(parsed.search) || pathDecodingIncomplete,
  };
}

async function readLimitedText(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_CHARS) throw new Error("body_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_CHARS) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    raw += decoder.decode(value, { stream: true });
  }
  return raw + decoder.decode();
}

function requestIdentity(request: Request) {
  const candidate = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "anonymous";
  const bounded = candidate.trim().slice(0, 64);
  return /^[0-9a-f:.]+$/iu.test(bounded) ? bounded : "anonymous";
}

async function requestWindowKey(request: Request) {
  const salt = requestWindowSalt ?? crypto.getRandomValues(new Uint8Array(32));
  requestWindowSalt = salt;
  const identity = new TextEncoder().encode(requestIdentity(request));
  const material = new Uint8Array(salt.length + identity.length);
  material.set(salt);
  material.set(identity, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pruneRequestWindows(now: number) {
  if (
    now - lastRequestWindowCleanupAt < RATE_LIMIT_WINDOW_MS
    && requestWindows.size < 5_000
  ) return;
  for (const [storedKey, window] of requestWindows) {
    if (now - window.startedAt >= RATE_LIMIT_WINDOW_MS) requestWindows.delete(storedKey);
  }
  lastRequestWindowCleanupAt = now;
}

async function claimRequest(request: Request) {
  const now = Date.now();
  pruneRequestWindows(now);
  const requestedKey = await requestWindowKey(request);
  const key = requestWindows.has(requestedKey) || requestWindows.size < 5_000
    ? requestedKey
    : "overflow";
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - current.startedAt)) / 1_000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function safeBrowsingCacheMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1_000, Math.min(SAFE_BROWSING_CACHE_MAX_MS, value));
  }
  if (typeof value !== "string") return SAFE_BROWSING_CACHE_FALLBACK_MS;
  const match = /^(\d+(?:\.\d+)?)s$/u.exec(value.trim());
  if (!match) return SAFE_BROWSING_CACHE_FALLBACK_MS;
  const milliseconds = Number(match[1]) * 1_000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return SAFE_BROWSING_CACHE_FALLBACK_MS;
  }
  return Math.max(1_000, Math.min(SAFE_BROWSING_CACHE_MAX_MS, milliseconds));
}

const NEGATABLE_REQUEST_RULES = new Set([
  "credential-request",
  "payment-request",
  "remote-control-or-app",
]);

function isProtectiveNegation(sentence: string, ruleId: string) {
  if (!NEGATABLE_REQUEST_RULES.has(ruleId)) return false;
  if (
    /(?:送らない|教えない|共有しない|読み上げない|返信しない|入力しない|承認しない|許可しない)(?:と|場合|なら|ならば|限り|とき).{0,100}(?:それ|その(?:番号|コード))を?(?:送って|教えて|読み上げ|返信|入力|共有|提出)/u.test(sentence)
  ) return false;
  if (
    ruleId === "credential-request"
    && /(?:password|passcode|PIN|OTP|verification\s*code).{0,18}(?:must|should)\s+remain\s+private|keep.{0,18}(?:password|passcode|PIN|OTP|verification\s*code).{0,12}private/iu.test(sentence)
  ) return true;
  if (
    ruleId === "remote-control-or-app"
    && /직접\s*찾은\s*공식\s*앱|공식\s*앱스토어.{0,24}(?:공식|은행|보안)?\s*앱|official\s+app\s+(?:you\s+found\s+)?yourself|official\s+(?:bank\s+)?(?:security\s+)?app.{0,32}official\s+(?:app\s+)?store|自分で探した公式アプリ|公式(?:アプリ)?ストア.{0,24}(?:銀行|公式|セキュリティ)?アプリ|自行查找的官方应用|官方应用商店.{0,24}(?:银行|官方|安全)?应用/iu.test(sentence)
    && !/(?:this|the|attached)\s+link|원격\s*(?:제어|지원|접속)|화면\s*(?:공유|제어)|remote\s*(?:access|control|support)|control\s+(?:your\s+)?screen|access\s+(?:your\s+)?(?:device|screen)|give\s+(?:me|support)\s+(?:remote\s+)?(?:access|control)|遠隔操作|画面共有|远程控制|屏幕共享/iu.test(sentence)
  ) return true;
  return /(?:승인하|누르)(?:면\s*안|지\s*마|지\s*않)|(?:보내|공유|알리|알려주|읽|입력|승인|누르|송금|이체|입금|구매|설치|다운로드|요구)하지\s*마|(?:보내|공유|알리|알려주|읽|입력|승인|누르|송금|이체|입금|구매|설치|다운로드)(?:면\s*안\s*됩|해서는\s*안)|(?:공유|전달|제공)\s*금지|절대\s*(?:보내|공유|승인|누르|송금|설치|요구)(?:지\s*마|하지\s*않)|(?:(?:do\s+not|don't|never|must\s+not|will\s+not|does\s+not)|(?:should|must)\s+not)\s+(?!(?:forget|fail|hesitate|stop|refuse)\b)(?:(?:ever|please|under\s+any\s+circumstances)\s+){0,3}(?:send|share|provide|enter|tell|give|forward|reply|read|approve|accept|tap|confirm|transfer|wire|pay|buy|install|download|run|open|enable|ask)\b|(?:banks?|official\s+(?:bank|guidance)).{0,24}do(?:es)?\s+not\s+(?:ask|request|require).{0,32}(?:send|share|provide|enter|tell|give|forward|reply|transfer|wire|pay|install)|(?:prohibited|forbidden|not\s+allowed)\s+to\s+(?:send|share|provide|enter|tell|give|forward|reply|approve|accept|tap|confirm|transfer|wire|pay|buy|install)|(?:送らない|教えない|共有しない|読み上げない|返信しない|入力しない|承認しない|許可しない|送金しない|要求しない|インストールしない)|(?:送って|送金して|振り込んで|購入して|インストールして)はいけ|(?:不要|请勿|切勿|不得|绝不)\s*(?!(?:忘记|犹豫|停止|拒绝))(?:(?![。！？.!?]).){0,24}(?:发送|提供|分享|共享|告诉|回复|念出|输入|批准|允许|确认|转账|汇款|购买|安装|下载|运行|索取)/iu.test(sentence);
}

const CREDENTIAL_REFERENCE = /(?:인증번호|인증\s*코드|OTP|비밀번호|verification\s*code|authentication\s*code|auth\s*code|passcode|one[- ]time\s*(?:password|code)|password|PIN|security\s*code|認証番号|ワンタイムパスワード|暗証番号|パスワード|验证码|动态口令|密码|支付密码)/iu;
const CREDENTIAL_CONTEXT_REPLACEMENT = /(?:download|complete|open|prepare|attach|upload|obtain|fill\s+out|read|receive|asks?\s+for|requires?)\s+(?:the|an?|this|that|your|our)\s+(?!(?:OTP|PIN|password|passcode|verification\s*code)\b)(?:[\p{L}\p{N}-]+\s*){1,4}|(?:download|complete|open|prepare|attach|upload|obtain|fill\s+out|read|receive|asks?\s+for|requires?)\s+(?:[\p{L}\p{N}-]+\s+){0,3}(?:form|report|receipt|invoice|contract|certificate|brochure|document|file|statement|photo|attachment)|(?!(?:그것|이것|인증번호|인증\s*코드|비밀번호|OTP))\p{Script=Hangul}{2,24}(?:을|를)\s*(?:다운로드|작성|완성|열어|준비|첨부|업로드|받아)|(?!(?:それ|認証番号|暗証番号|パスワード))(?:(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|ー){2,24})を(?:ダウンロード|作成|完成|開いて|準備|添付|受領)|(?:下载|填写|完成|打开|准备|上传|收到|索要)(?!(?:它|这个验证码|密码|验证码))(?:(?:\p{Script=Han}|\p{Script=Hiragana}){2,24})/iu;
const CREDENTIAL_PRONOUN = /\b(?:it|this|that)\b|(?:그것|이것|해당\s*(?:번호|코드))|(?:それ|その(?:番号|コード))|(?:它|这个(?:号码|验证码|密码))/iu;
const CREDENTIAL_PRONOUN_LINKAGE = /\b(?:using|with|containing)\s+(?:it|this|that)\b|(?:그것|이것)(?:으로|을\s*사용해)|(?:それ|その(?:番号|コード))を使|(?:使用|用)(?:它|这个(?:号码|验证码|密码))/iu;
const HIGH_CONFIDENCE_CREDENTIAL_POSSESSION = /(?:OTP|verification\s*code|authentication\s*code|passcode|PIN|인증번호|인증\s*코드|認証番号|验证码).{0,18}(?:(?:is|was|:|=)\s*(?=[A-Z0-9-]{4,12}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,12}|(?:just\s+)?(?:arrived|received|generated|sent)|(?:도착|수신|생성|전송)|(?:届いた|受信|生成)|(?:收到|生成|发来))|password.{0,8}(?:is|was|:|=)\s*(?=[^\s]{4,32}(?:\s|$))(?=[^\s]*\d)[^\s]{4,32}|(?:just\s+)?(?:received|got|texted).{0,18}(?:OTP|verification\s*code|authentication\s*code|password\s*reset\s*code|passcode|PIN)/iu;
const FOLLOW_UP_CREDENTIAL_REQUESTS = [
  /(?:(?:for\s+(?:security|verification)\s+purposes?|to\s+continue|now|then)[,:]?\s*)?(?:please\s+)?(?:(?:send|share|provide|enter|submit|forward)\s+(?:it|this|that|the\s*(?:code|number|password|passcode))(?:\s+(?:to\s+me|here|to\s+this\s+(?:number|chat)))?|reply\s+with\s+(?:it|this|that|the\s*(?:code|number|password|passcode))|(?:tell|give)\s+me\s+(?:it|this|that)|read\s+(?:it|the\s+(?:code|passcode))\s+out(?:\s+to\s+me)?)\b/giu,
  /(?:그것|이것|해당\s*(?:번호|코드))을?\s*(?:보내|알려|읽어|입력|공유|제출)|(?:그것|이것|해당\s*(?:번호|코드))(?:으로|로)\s*답장|(?:이\s*번호로\s*)?답장(?:해|하)/gu,
  /(?:それ|その(?:番号|コード))を?(?:送って|教えて|読み上げ|返信|入力|共有|提出)|(?:それ|その(?:番号|コード))で返信|こちらへ返信/gu,
  /(?:把)?(?:它|这个(?:号码|验证码|密码))?(?:发给我|发送给我|告诉我|回复给我|念给我听|提交到这里)|(?:请)?回复给我/gu,
] as const;
const AFFIRMATIVE_CREDENTIAL_DIRECTIVE = /(?:^|[\p{P}\p{S}]\s*|\b(?:and|then|but|however)\s+)(?:(?:please|now|then)\s+){0,3}(?:(?:(?:send|share|provide|enter|submit|forward|reply\s+with)|tell\s+(?:me\s+)?|give\s+(?:me\s+)?).{0,24}(?:verification\s*code|authentication\s*code|auth\s*code|passcode|one[- ]time\s*(?:password|code)|OTP|password|PIN|security\s*code)|read\s+(?:the\s+)?(?:verification|authentication|security|one[- ]time)\s+code\s+out|read\s+(?:the\s+)?(?:OTP|PIN|passcode)\s+out|(?:보내|알려|입력|공유|제출).{0,18}(?:인증번호|인증\s*코드|OTP|비밀번호)|(?:送って|教えて|入力|共有|提出).{0,18}(?:認証番号|ワンタイムパスワード|暗証番号|パスワード)|(?:发送|提供|输入|共享|提交).{0,18}(?:验证码|动态口令|密码|支付密码))/iu;
const AFFIRMATIVE_REMOTE_DIRECTIVE = /(?:^|[\p{P}\p{S}]\s*|\b(?:and|then|but|however)\s+)(?:(?:please|now|then)\s+){0,3}(?:(?:install|download|run|open|enable).{0,36}(?:remote\s*(?:access|control|support)|screen\s*share|(?:this|that|attached)(?:\s+(?:security|support|verification|remote\s+support))?\s+app|APK|TeamViewer|AnyDesk|RustDesk|QuickSupport)|(?:give|grant)\s+(?:me|us|support).{0,12}(?:remote\s+)?(?:access|control)|(?:설치|다운로드|실행|연결).{0,24}(?:원격\s*(?:제어|지원)|화면\s*공유|APK|팀뷰어|애니데스크|(?:이|해당|첨부된)\s*앱)|(?:インストール|実行|接続).{0,24}(?:遠隔操作|画面共有|APK|このアプリ|添付のアプリ)|(?:安装|下载|运行|连接).{0,24}(?:远程控制|屏幕共享|APK|这个应用|附件中的应用))/iu;
const DIRECT_PAYMENT_DIRECTIVE = /(?:^|[\p{P}\p{S}]\s*|\b(?:and|then|but|however)\s+)(?:(?:(?:please|now|then)\s+){0,3}\b(?:wire|transfer|send|pay|deposit|move)\b\s+(?:(?:the\s+)?(?:funds?|money)\s+(?:to|into)\s+(?:(?:this|the|my|our)\s+(?:bank\s+)?account|the\s+account\s+below)|(?:[$€£¥]\s*)?\d[\d,.]*(?:\s*(?:usd|dollars?|euros?|pounds?|won|yen|yuan))?(?:\s+(?:to|into)\s+(?:(?:this|the|my|our)\s+(?:bank\s+)?account|the\s+account\s+below))?)|(?:この|指定|以下の)?口座(?:に|へ)(?:\d[\d,.]*\s*(?:円|万円)(?:を)?)?.{0,8}(?:送って|送金|振り込|振込)|(?:向|往|给)(?:这个|该|以下)?账户(?:转账|汇款|打款?|打)(?:\d[\d,.]*\s*元)?|(?:이|해당|지정|아래)?\s*계좌(?:로|에)\s*(?:돈을?\s*|\d[\d,.]*\s*(?:원|만원))?.{0,10}(?:보내|넣어|입금|송금|이체)|(?:송금|이체|입금)(?:해|하|하세요|하십시오|바랍니다))/iu;
const CONJUNCTION_BOUNDARY = /(?:\band\b|\bthen\b|&|->|→|⇒|그리고(?:\s*나서)?|그리고서|그런\s*다음|そして|その後|并且|然后)/iu;

function hasCrossClauseCredentialRequest(material: string) {
  const referencePattern = new RegExp(
    CREDENTIAL_REFERENCE.source,
    CREDENTIAL_REFERENCE.flags.replace("g", ""),
  );
  const reference = referencePattern.exec(material);
  if (!reference) return false;

  // Track the credential antecedent across the whole bounded request rather
  // than a bypassable character window. An explicitly introduced non-secret
  // document becomes the new antecedent, preventing "send the form" guidance
  // from being misclassified as "send the OTP".
  const referenceEnd = (reference.index ?? 0) + reference[0].length;
  const referenceStart = reference.index ?? 0;
  const clauseStart = Math.max(
    material.lastIndexOf(".", referenceStart),
    material.lastIndexOf("!", referenceStart),
    material.lastIndexOf("?", referenceStart),
    material.lastIndexOf("。", referenceStart),
    material.lastIndexOf("！", referenceStart),
    material.lastIndexOf("？", referenceStart),
    material.lastIndexOf("\n", referenceStart),
  ) + 1;
  const followingBoundary = material.slice(referenceEnd).search(/[\n.!?。！？]/u);
  const referenceClause = material.slice(
    clauseStart,
    followingBoundary < 0 ? material.length : referenceEnd + followingBoundary,
  );
  let credentialContextLocked = (
    HIGH_CONFIDENCE_CREDENTIAL_POSSESSION.test(referenceClause)
    && !isProtectiveNegation(referenceClause, "credential-request")
  );
  const tail = material.slice(referenceEnd);
  const discourseSegments = tail
    .split(/(?:[\n.!?。！？,，;；]+|\band\b|\bthen\b|그리고|그런\s*다음|そして|その後|并且|然后)/iu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  let credentialContextActive = true;
  for (const segment of discourseSegments) {
    if (CREDENTIAL_REFERENCE.test(segment)) {
      credentialContextActive = true;
      if (
        HIGH_CONFIDENCE_CREDENTIAL_POSSESSION.test(segment)
        && !isProtectiveNegation(segment, "credential-request")
      ) credentialContextLocked = true;
    }
    const replacement = CREDENTIAL_CONTEXT_REPLACEMENT.exec(segment);
    if (
      replacement
      && !credentialContextLocked
      && !CREDENTIAL_PRONOUN.test(segment.slice(0, replacement.index))
      && !CREDENTIAL_PRONOUN_LINKAGE.test(segment)
    ) credentialContextActive = false;
    if (!credentialContextActive) continue;
    for (const requestPattern of FOLLOW_UP_CREDENTIAL_REQUESTS) {
      requestPattern.lastIndex = 0;
      const request = requestPattern.exec(segment);
      if (request && !isProtectiveNegation(segment, "credential-request")) {
        requestPattern.lastIndex = 0;
        return true;
      }
      requestPattern.lastIndex = 0;
    }
  }
  return false;
}

function ruleAssessment(material: string) {
  const normalized = normalizeAnalysisText(material);
  const clauses = normalized
    .split(/(?:[\n.!?。！？,，;；]+|\bbut\b|\bhowever\b|\binstead\b|하지만|그러나|다만|대신|しかし|ただし|一方|但是|而是|反而|但)/iu)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const segments = [...new Set(clauses.flatMap((clause) => [
    clause,
    ...clause.split(CONJUNCTION_BOUNDARY).map((segment) => segment.trim()).filter(Boolean),
  ]))];
  const matched = RULES.filter((rule) => segments.some((sentence) => (
    rule.patterns.some((pattern) => pattern.test(sentence))
    && !isProtectiveNegation(sentence, rule.id)
  )));
  const addRule = (id: string) => {
    if (matched.some((rule) => rule.id === id)) return;
    const rule = RULES.find((candidate) => candidate.id === id);
    if (rule) matched.push(rule);
  };
  if (AFFIRMATIVE_CREDENTIAL_DIRECTIVE.test(normalized)) addRule("credential-request");
  if (AFFIRMATIVE_REMOTE_DIRECTIVE.test(normalized)) addRule("remote-control-or-app");
  const hasDirectPaymentRequest = segments.some((segment) => (
    DIRECT_PAYMENT_DIRECTIVE.test(segment)
    && !isProtectiveNegation(segment, "payment-request")
  ));
  if (hasDirectPaymentRequest) addRule("payment-request");
  if (
    !matched.some((rule) => rule.id === "credential-request")
    && hasCrossClauseCredentialRequest(normalized)
  ) {
    const credentialRule = RULES.find((rule) => rule.id === "credential-request");
    if (credentialRule) matched.push(credentialRule);
  }
  if (INVISIBLE_CHARACTERS.test(material)) matched.push(OBFUSCATION_RULE);
  INVISIBLE_CHARACTERS.lastIndex = 0;
  if (DEFANGED_URL_MARKER.test(material)) matched.push(DEFANGED_URL_RULE);
  const ids = new Set(matched.map((rule) => rule.id));
  const asksForValue = ids.has("payment-request")
    || ids.has("credential-request")
    || ids.has("remote-control-or-app");
  let interactionBonus = 0;
  if (ids.has("authority-impersonation") && asksForValue) interactionBonus += 14;
  if (ids.has("urgency") && asksForValue) interactionBonus += 10;
  if (ids.has("secrecy-isolation") && asksForValue) interactionBonus += 8;
  if (ids.has("daily-life-notice-lure") && URL_LIKE_MARKER.test(material)) interactionBonus += 20;

  let criticalFloor = 0;
  if (ids.has("credential-request") || ids.has("remote-control-or-app")) criticalFloor = 65;
  if (ids.has("payment-request")) criticalFloor = Math.max(criticalFloor, 30);
  if (
    ids.has("payment-request")
    && (/안전계좌|보호계좌|safe\s+account|安全口座|安全账户/iu.test(normalized)
      || hasDirectPaymentRequest)
  ) {
    criticalFloor = 65;
  }
  if (ids.has("loan-advance-fee")) criticalFloor = Math.max(criticalFloor, 30);
  return { matched, interactionBonus, criticalFloor };
}

function threatExpressionMatchesCandidate(expression: string, candidate: string) {
  try {
    const normalizedExpression = expression.includes("://") ? expression : `https://${expression}`;
    const threat = new URL(normalizedExpression);
    const inspected = new URL(candidate);
    const threatHost = threat.hostname.toLowerCase();
    const candidateHost = inspected.hostname.toLowerCase();
    const hostMatches = candidateHost === threatHost || candidateHost.endsWith(`.${threatHost}`);
    const threatPath = threat.pathname || "/";
    return hostMatches && inspected.pathname.startsWith(threatPath);
  } catch {
    return false;
  }
}

async function reputationCacheKey(url: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pruneUrlReputationCache(now: number) {
  for (const [storedKey, entry] of urlReputationCache) {
    if (entry.expiresAt <= now) urlReputationCache.delete(storedKey);
  }
}

function cacheUrlReputation(
  key: string,
  value: { unsafe: boolean; expiresAt: number },
) {
  if (urlReputationCache.has(key)) urlReputationCache.delete(key);
  while (urlReputationCache.size >= URL_REPUTATION_CACHE_MAX_ENTRIES) {
    const oldestKey = urlReputationCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    urlReputationCache.delete(oldestKey);
  }
  urlReputationCache.set(key, value);
}

async function unsafeUrlsFromGoogle(request: Request, urls: string[]) {
  if (!urls.length) {
    return { unsafe: new Set<string>(), status: "not-requested" as const, submitted: false };
  }
  const apiKey = await runtimeSecret("GOOGLE_SAFE_BROWSING_API_KEY");
  if (!apiKey) {
    return { unsafe: new Set<string>(), status: "disabled" as const, submitted: false };
  }

  const now = Date.now();
  pruneUrlReputationCache(now);
  const cacheKeys = new Map(await Promise.all(urls.map(async (url) => [url, await reputationCacheKey(url)] as const)));
  const cached = urls.filter((url) => (urlReputationCache.get(cacheKeys.get(url) ?? "")?.expiresAt ?? 0) > now);
  const uncached = urls.filter((url) => !cached.includes(url));
  const knownUnsafe = new Set(cached.filter((url) => urlReputationCache.get(cacheKeys.get(url) ?? "")?.unsafe));
  if (!uncached.length) {
    return { unsafe: knownUnsafe, status: "cached" as const, submitted: false };
  }

  const lookup = await runPhishingReputationLookupWithQuota(request, async () => {
    try {
      const endpoint = new URL("https://safebrowsing.googleapis.com/v5/urls:search");
      endpoint.searchParams.set("key", apiKey);
      for (const url of uncached.slice(0, 50)) endpoint.searchParams.append("urls", url);
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/x-protobuf" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        console.warn("[safe-browsing] v5 request failed", { status: response.status });
        return { unsafe: knownUnsafe, status: "unavailable" as const, submitted: true };
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
        throw new Error("safe_browsing_response_too_large");
      }
      const payload = decodeSafeBrowsingV5Response(new Uint8Array(await response.arrayBuffer()));
      const threatExpressions = payload.threats.map((threat) => threat.url);
      const cacheMs = safeBrowsingCacheMs(payload.cacheDurationMs);
      for (const url of uncached) {
        const unsafe = threatExpressions.some((expression) =>
          threatExpressionMatchesCandidate(expression, url),
        );
        cacheUrlReputation(
          cacheKeys.get(url) ?? await reputationCacheKey(url),
          { unsafe, expiresAt: now + cacheMs },
        );
        if (unsafe) knownUnsafe.add(url);
      }
      return { unsafe: knownUnsafe, status: "available" as const, submitted: true };
    } catch (error) {
      console.warn("[safe-browsing] v5 response unavailable", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return { unsafe: knownUnsafe, status: "unavailable" as const, submitted: true };
    }
  }, { pepper: apiKey });
  if (lookup.status !== "completed") {
    return {
      unsafe: knownUnsafe,
      status: lookup.status,
      submitted: false,
    };
  }
  return lookup.value;
}

function localizedCopy(locale: SupportedLocale, riskLevel: RiskLevel) {
  const summaries: Record<SupportedLocale, Record<RiskLevel, string>> = {
    ko: {
      high: "고위험 피싱 신호가 여러 개 발견되었습니다. 안전이 확인될 때까지 연락과 거래를 중단하세요.",
      medium: "주의가 필요한 피싱 신호가 발견되었습니다. 메시지 밖의 공식 채널로 사실을 확인하세요.",
      low: "뚜렷한 고위험 신호는 적지만, 이 결과만으로 안전하다고 판단할 수 없습니다.",
    },
    en: {
      high: "Multiple high-risk phishing signals were found. Stop contact and transactions until independently verified.",
      medium: "Potential phishing signals were found. Verify the claim through an official channel outside the message.",
      low: "Few strong warning signals were found, but this result cannot prove the message is safe.",
    },
    ja: {
      high: "複数の高リスクなフィッシング兆候が見つかりました。安全確認まで連絡と取引を中止してください。",
      medium: "注意が必要な兆候があります。メッセージ外の公式窓口で事実確認してください。",
      low: "強い警告兆候は少ないものの、この結果だけで安全とは判断できません。",
    },
    zh: {
      high: "发现多个高风险诈骗信号。在独立核实前，请停止联系和交易。",
      medium: "发现需要警惕的诈骗信号。请通过消息之外的官方渠道核实。",
      low: "未发现较多强烈风险信号，但本结果不能证明消息安全。",
    },
  };

  const actions: Record<SupportedLocale, string[]> = {
    ko: [
      "링크·첨부파일을 열지 말고 답장, 송금, 인증번호 공유를 중단하세요.",
      "메시지의 연락처가 아닌 직접 찾은 공식 홈페이지·앱·대표번호로 확인하세요.",
      "이미 송금했다면 즉시 금융회사와 112에 지급정지를 요청하세요.",
      "피싱 상담·신고는 1394를 이용하고, 기기가 감염됐을 수 있으면 다른 안전한 기기로 연락하세요.",
    ],
    en: [
      "Do not open links or attachments, reply, transfer money, or share passwords or one-time codes.",
      "Verify through an official website, app, or number you found independently.",
      "If money was sent in Korea, contact the bank and 112 immediately to request a payment freeze.",
      "Use 1394 for phishing reports and advice; use a clean device if this device may be compromised.",
    ],
    ja: [
      "リンクや添付を開かず、返信・送金・認証番号の共有を中止してください。",
      "メッセージ内ではなく、自分で調べた公式サイト・アプリ・代表番号で確認してください。",
      "韓国で送金済みなら、金融機関と112に直ちに支払停止を依頼してください。",
      "相談・通報は1394へ。端末感染の恐れがあれば別の安全な端末を使ってください。",
    ],
    zh: [
      "不要打开链接或附件，也不要回复、转账或提供密码和验证码。",
      "请通过自行查找的官方网站、应用或客服电话核实。",
      "如已在韩国转账，请立即联系金融机构和112申请止付。",
      "诈骗咨询与举报可拨打1394；若设备可能受感染，请改用安全设备。",
    ],
  };

  const disclaimers: Record<SupportedLocale, string> = {
    ko: "이 결과는 규칙 기반 사전 점검이며 수사기관의 판정이 아닙니다. 낮은 점수도 안전을 보장하지 않습니다.",
    en: "This is a rule-based screening result, not an official determination. A low score does not guarantee safety.",
    ja: "これはルールベースの予備判定で、捜査機関の判断ではありません。低スコアでも安全を保証しません。",
    zh: "这是基于规则的初步筛查，并非官方认定；低分也不能保证安全。",
  };

  return { summary: summaries[locale][riskLevel], actions: actions[locale], disclaimer: disclaimers[locale] };
}

const URL_SIGNAL_LABELS: Record<string, Record<SupportedLocale, string>> = {
  "malformed-url": { ko: "URL 형식을 해석할 수 없음", en: "URL format could not be parsed", ja: "URL形式を解析できない", zh: "无法解析网址格式" },
  "unsupported-url-scheme": { ko: "지원하지 않는 URL 방식", en: "Unsupported URL scheme", ja: "未対応のURL方式", zh: "不支持的网址协议" },
  "unencrypted-http": { ko: "암호화되지 않은 HTTP 연결", en: "Unencrypted HTTP connection", ja: "暗号化されていないHTTP接続", zh: "未加密的 HTTP 连接" },
  "ip-address-host": { ko: "도메인 대신 IP 주소 사용", en: "Uses an IP address instead of a domain", ja: "ドメインではなくIPアドレスを使用", zh: "使用 IP 地址而非域名" },
  "embedded-credentials-or-at-sign": { ko: "주소에 계정정보 또는 @ 기호 포함", en: "Contains credentials or an @ sign in the URL", ja: "URLに認証情報または@を含む", zh: "网址中含账号信息或 @ 符号" },
  "punycode-domain": { ko: "유사문자 도메인일 수 있는 Punycode", en: "Punycode domain may imitate another name", ja: "類似文字ドメインの可能性があるPunycode", zh: "可能用于仿冒的 Punycode 域名" },
  "shortened-url": { ko: "최종 목적지가 숨겨진 단축 URL", en: "Shortened URL hides the final destination", ja: "最終到達先を隠す短縮URL", zh: "短网址隐藏最终目标" },
  "nonstandard-port": { ko: "일반적이지 않은 포트 사용", en: "Uses a non-standard port", ja: "通常と異なるポートを使用", zh: "使用非标准端口" },
  "downloadable-file": { ko: "실행·압축 파일 다운로드 경로", en: "Links to an executable or archive", ja: "実行・圧縮ファイルへのリンク", zh: "指向可执行或压缩文件" },
  "executable-file": { ko: "직접 실행될 수 있는 파일 형식", en: "Links to a directly executable file", ja: "直接実行され得るファイル形式", zh: "指向可直接执行的文件" },
  "many-subdomains": { ko: "하위 도메인이 비정상적으로 많음", en: "Uses unusually many subdomains", ja: "サブドメインが異常に多い", zh: "子域名数量异常" },
  "embedded-public-suffix": { ko: "정상 도메인처럼 보이는 중간 도메인 표기", en: "Embeds a public suffix inside a longer hostname", ja: "公開サフィックスを長いホスト名の途中に含む", zh: "在更长域名中嵌入公共后缀" },
  "long-hostname": { ko: "도메인 이름이 비정상적으로 김", en: "Hostname is unusually long", ja: "ホスト名が異常に長い", zh: "域名异常长" },
  "credential-themed-path": { ko: "로그인·인증을 유도하는 경로", en: "Path is themed around login or verification", ja: "ログイン・認証を誘導するパス", zh: "路径包含登录或验证诱导" },
  "redirect-parameter": { ko: "다른 주소로 넘기는 리디렉션 매개변수", en: "Contains a redirect parameter", ja: "別URLへ移すリダイレクト指定", zh: "包含重定向参数" },
  "encoded-path-separator": { ko: "경로 구분자를 숨긴 인코딩", en: "Encodes path separators", ja: "パス区切りを隠すエンコード", zh: "使用编码隐藏路径分隔符" },
  "encoded-path-content": { ko: "파일·경로 문자를 퍼센트 인코딩으로 숨김", en: "Hides path or file characters with percent encoding", ja: "パスやファイル文字をパーセントエンコードで隠す", zh: "使用百分号编码隐藏路径或文件字符" },
  "double-encoded-path": { ko: "경로를 두 번 인코딩해 숨김", en: "Uses double encoding in the path", ja: "パスを二重エンコードして隠す", zh: "使用双重编码隐藏路径" },
  "malformed-path-encoding": { ko: "경로 인코딩을 완전히 해석할 수 없음", en: "Path encoding could not be fully decoded", ja: "パスのエンコードを完全に解析できない", zh: "无法完整解析路径编码" },
  "google-known-unsafe-url": { ko: "Google 위험 URL 목록과 일치 가능", en: "May match Google's unsafe-URL data", ja: "Googleの危険URL情報に一致する可能性", zh: "可能匹配 Google 的危险网址数据" },
};

function urlSignalLabel(signal: string, locale: SupportedLocale) {
  return URL_SIGNAL_LABELS[signal]?.[locale] ?? signal;
}

function incidentResponse(
  locale: SupportedLocale,
  exposures: PhishingExposure[],
  riskLevel: RiskLevel,
) {
  const exposureSet = new Set(exposures);
  const level: IncidentResponseLevel = exposureSet.has("sent-money")
    ? "emergency"
    : exposures.length > 0 || riskLevel === "high"
      ? "urgent"
      : "prevention";
  const heading: Record<SupportedLocale, Record<IncidentResponseLevel, [string, string]>> = {
    ko: {
      prevention: ["아직 행동하지 않았다면 여기서 멈추세요", "메시지 밖에서 찾은 공식 채널로 사실을 확인한 뒤 결정하세요."],
      urgent: ["노출 가능성이 있어 즉시 확인이 필요합니다", "의심 기기에서 금융 업무를 중단하고 다른 안전한 기기로 공식 기관에 연락하세요."],
      emergency: ["송금 피해 대응이 최우선입니다", "즉시 금융회사와 112에 지급정지를 요청하고 추가 송금·연락을 중단하세요."],
    },
    en: {
      prevention: ["Stop here if you have not acted", "Verify through an independently found official channel before deciding."],
      urgent: ["Possible exposure needs immediate review", "Stop financial activity on the affected device and use a clean device to contact official support."],
      emergency: ["Payment-freeze action comes first", "Contact the financial institution and 112 immediately and stop further contact or transfers."],
    },
    ja: {
      prevention: ["まだ行動していない場合はここで止めてください", "自分で調べた公式窓口で確認してから判断してください。"],
      urgent: ["情報露出の可能性があり、すぐ確認が必要です", "疑わしい端末で金融操作を止め、別の安全な端末から公式窓口へ連絡してください。"],
      emergency: ["支払停止の対応を最優先してください", "直ちに金融機関と112へ連絡し、追加の送金・連絡を中止してください。"],
    },
    zh: {
      prevention: ["如果尚未操作，请在这里停下", "通过自行查找的官方渠道核实后再决定。"],
      urgent: ["可能已经暴露，需要立即核实", "停止在可疑设备上进行金融操作，并使用安全设备联系官方机构。"],
      emergency: ["应优先申请止付", "立即联系金融机构和112，并停止进一步联系或转账。"],
    },
  };
  const exposureActions: Record<SupportedLocale, Record<PhishingExposure, string[]>> = {
    ko: {
      "opened-link": ["추가 입력·다운로드를 멈추고 열린 페이지를 닫으세요.", "118 또는 보호나라 스미싱 확인서비스로 URL을 확인하세요."],
      "installed-app": ["해당 기기에서 금융앱·인증수단 사용을 중단하고 다른 안전한 기기로 연락하세요.", "1394 또는 118에 악성앱 대응을 문의하고 금융회사에도 노출 가능성을 알리세요."],
      "shared-credentials": ["다른 안전한 기기에서 해당 금융회사에 즉시 연락해 인증수단을 정지·재발급하세요.", "같은 비밀번호를 쓴 다른 서비스도 공식 경로에서 변경하세요."],
      "sent-money": ["금융회사와 112에 즉시 지급정지를 요청하세요.", "1394에 신고·상담하고 메시지·계좌·송금시각 등 증거를 보존하세요."],
    },
    en: {
      "opened-link": ["Stop entering information or downloading files and close the page.", "Ask 118 or the KISA smishing-check service to review the URL."],
      "installed-app": ["Stop using financial apps or credentials on that device and contact support from a clean device.", "Ask 1394 or 118 about malicious-app response and notify the financial institution."],
      "shared-credentials": ["Use a clean device to contact the financial institution and suspend or reissue credentials.", "Change reused passwords through each service's official channel."],
      "sent-money": ["Ask the financial institution and 112 for an immediate payment freeze.", "Report to 1394 and preserve messages, account details, and transfer time as evidence."],
    },
    ja: {
      "opened-link": ["追加入力・ダウンロードを止め、ページを閉じてください。", "118またはKISAのスミッシング確認サービスでURLを確認してください。"],
      "installed-app": ["その端末で金融アプリ・認証手段を使わず、安全な端末から連絡してください。", "1394または118へ不正アプリ対応を相談し、金融機関にも知らせてください。"],
      "shared-credentials": ["安全な端末から金融機関へ連絡し、認証手段を停止・再発行してください。", "使い回したパスワードも各公式窓口で変更してください。"],
      "sent-money": ["金融機関と112に直ちに支払停止を依頼してください。", "1394へ通報・相談し、メッセージや送金時刻などの証拠を保存してください。"],
    },
    zh: {
      "opened-link": ["停止输入信息或下载文件，并关闭页面。", "通过118或KISA短信诈骗确认服务核查网址。"],
      "installed-app": ["停止在该设备上使用金融应用和验证工具，并改用安全设备联系机构。", "向1394或118咨询恶意应用处置，并告知金融机构。"],
      "shared-credentials": ["使用安全设备联系金融机构，立即停用或补发验证工具。", "通过各服务官方渠道修改重复使用的密码。"],
      "sent-money": ["立即联系金融机构和112申请止付。", "向1394举报咨询，并保留消息、账号和转账时间等证据。"],
    },
  };
  const base = localizedCopy(locale, riskLevel).actions;
  const ordered: PhishingExposure[] = ["sent-money", "shared-credentials", "installed-app", "opened-link"];
  const actions = [...new Set([
    ...ordered.flatMap((exposure) => exposureSet.has(exposure) ? exposureActions[locale][exposure] : []),
    ...base,
  ])].slice(0, 6);
  return { level, title: heading[locale][level][0], summary: heading[locale][level][1], actions };
}

function officialResources(locale: SupportedLocale) {
  const copy: Record<SupportedLocale, Array<{ id: string; label: string; purpose: string; href: string }>> = {
    ko: [
      { id: "police-112", label: "112 긴급 신고", purpose: "이미 송금했거나 즉시 피해가 우려될 때", href: "tel:112" },
      { id: "phishing-1394", label: "1394 피싱 통합신고", purpose: "24시간 피싱 신고·상담과 관계기관 연계", href: "tel:1394" },
      { id: "kisa-118", label: "KISA 118", purpose: "스미싱·악성앱·침해 상담", href: "tel:118" },
      { id: "counter-scam", label: "피싱안심SOS", purpose: "경찰청 통합대응단 공식 대응·제보 안내", href: COUNTER_SCAM_URL },
      { id: "kisa-smishing", label: "스미싱 확인서비스", purpose: "KISA 보호나라의 의심 메시지 확인 안내", href: KISA_SMISHING_URL },
    ],
    en: [
      { id: "police-112", label: "Call 112", purpose: "Urgent help after a transfer or immediate harm", href: "tel:112" },
      { id: "phishing-1394", label: "Call 1394", purpose: "24/7 phishing reports, advice, and agency coordination", href: "tel:1394" },
      { id: "kisa-118", label: "Call KISA 118", purpose: "Smishing, malicious-app, and incident advice", href: "tel:118" },
      { id: "counter-scam", label: "Phishing Safety SOS", purpose: "Official Korean police response and reporting guidance", href: COUNTER_SCAM_URL },
      { id: "kisa-smishing", label: "Smishing check service", purpose: "KISA guidance for checking suspicious messages", href: KISA_SMISHING_URL },
    ],
    ja: [
      { id: "police-112", label: "112 緊急通報", purpose: "送金済み、または直ちに被害が心配な場合", href: "tel:112" },
      { id: "phishing-1394", label: "1394 統合通報", purpose: "24時間の通報・相談と関係機関連携", href: "tel:1394" },
      { id: "kisa-118", label: "KISA 118", purpose: "スミッシング・不正アプリ・侵害相談", href: "tel:118" },
      { id: "counter-scam", label: "フィッシング安心SOS", purpose: "韓国警察の公式対応・通報案内", href: COUNTER_SCAM_URL },
      { id: "kisa-smishing", label: "スミッシング確認サービス", purpose: "KISAによる不審メッセージ確認案内", href: KISA_SMISHING_URL },
    ],
    zh: [
      { id: "police-112", label: "拨打112", purpose: "已转账或可能立即发生损失时", href: "tel:112" },
      { id: "phishing-1394", label: "拨打1394", purpose: "24小时诈骗举报、咨询与机构联动", href: "tel:1394" },
      { id: "kisa-118", label: "KISA 118", purpose: "短信诈骗、恶意应用与安全事件咨询", href: "tel:118" },
      { id: "counter-scam", label: "反诈骗安心SOS", purpose: "韩国警方官方处置与举报指南", href: COUNTER_SCAM_URL },
      { id: "kisa-smishing", label: "短信诈骗确认服务", purpose: "KISA可疑消息核查指南", href: KISA_SMISHING_URL },
    ],
  };
  return copy[locale];
}

/**
 * Shared text-only rule core for bounded synthetic evaluation. The public POST
 * keeps its own parsing and rate limit, while both paths use the exact same
 * weights, interaction bonuses, localized labels, and safety disclaimer.
 */
export function evaluatePhishingRuleText(text: string, requestedLocale: SupportedLocale = "ko") {
  const locale = localeFrom(requestedLocale);
  const material = clean(text);
  const { matched, interactionBonus, criticalFloor } = ruleAssessment(material);
  const ruleScore = matched.reduce((sum, rule) => sum + rule.weight, 0);
  const score = Math.min(100, Math.max(ruleScore + interactionBonus, criticalFloor));
  const riskLevel: RiskLevel = score >= 65 ? "high" : score >= 30 ? "medium" : "low";
  const copy = localizedCopy(locale, riskLevel);
  return {
    riskLevel,
    score,
    signals: matched.map((rule) => ({ id: rule.id, label: rule.labels[locale], weight: rule.weight })),
    scoreBreakdown: { ruleScore, urlHeuristicScore: 0, interactionBonus, criticalFloor, reputationFloor: 0, total: score },
    assessmentStatus: "complete" as const,
    disclaimer: copy.disclaimer,
  };
}

async function handlePhishingRequest(request: Request, applyRateLimit: boolean) {
  if (!(await requireSameOrigin(request))) {
    return json({ error: "origin_mismatch" }, 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "application_json_required" }, 415);
  }
  const rateLimit = applyRateLimit
    ? await claimRequest(request)
    : { allowed: true, retryAfterSeconds: 0 };
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: "rate_limit_exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    });
  }

  let body: PhishingRequestBody;
  try {
    const raw = await readLimitedText(request);
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return json({ error: "A JSON object is required." }, 400);
    body = parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") {
      return json({ error: "Request body is too large." }, 413);
    }
    return json({ error: "Invalid JSON body." }, 400);
  }

  const textFields = [body.text, body.message, body.content]
    .filter((value): value is string => typeof value === "string");
  const rawSuppliedUrl = rawString(body.url);
  const rawSender = rawString(body.sender);
  if (
    textFields.some((value) => value.length > MAX_INPUT_CHARS)
    || rawSuppliedUrl.length > 2_000
    || rawSender.length > 300
  ) {
    return json({ error: "Analysis input is too large." }, 413);
  }
  const text = textFields.map((value) => value.trim()).find(Boolean) ?? "";
  const suppliedUrl = rawSuppliedUrl.trim();
  const sender = rawSender.trim();
  if (!text && !suppliedUrl) {
    return json({ error: "Provide message text or a URL to analyze." }, 400);
  }
  if (text.length + suppliedUrl.length + sender.length > MAX_INPUT_CHARS) {
    return json({ error: "Analysis input is too large." }, 413);
  }

  const locale = localeFrom(body.locale);
  const exposures = exposuresFrom(body.exposures);
  const reputationConsent = body.reputationConsent === true;
  const material = [sender, text, suppliedUrl].filter(Boolean).join("\n");
  const { matched, interactionBonus, criticalFloor } = ruleAssessment(material);
  const extractedUrls = extractUrls(material);
  const suppliedFallback = suppliedUrl && extractedUrls.length === 0
    ? [normalizeDefangedUrls(normalizeAnalysisText(suppliedUrl))]
    : [];
  const rawUrls = [...new Set([...extractedUrls, ...suppliedFallback])].slice(0, 20);
  const inspectedUrls = rawUrls.map((rawUrl) => inspectUrl(rawUrl));
  const reputationCandidates = inspectedUrls
    .filter((item) => item.host && /^https?:\/\//u.test(item.url))
    .map((item) => item.url);
  const urlReputation = reputationCandidates.length === 0
    ? { unsafe: new Set<string>(), status: "not-requested" as const, submitted: false }
    : reputationConsent
      ? await unsafeUrlsFromGoogle(request, reputationCandidates)
      : { unsafe: new Set<string>(), status: "not-consented" as const, submitted: false };
  const urls = inspectedUrls.map((inspected) => {
    if (!urlReputation.unsafe.has(inspected.url)) return inspected;
    return {
      ...inspected,
      signals: [...inspected.signals, "google-known-unsafe-url"],
    };
  });
  const googleKnownUnsafe = urls.some((url) =>
    url.signals.includes("google-known-unsafe-url"),
  );

  const ruleScore = matched.reduce((sum, rule) => sum + rule.weight, 0);
  const urlHeuristicScore = Math.min(30, urls.reduce((sum, url) => sum + url.score, 0))
    + (urls.length ? 4 : 0);
  const urlSafetyFloor = urls.some((url) => (
    url.signals.includes("punycode-domain")
    && url.signals.includes("credential-themed-path")
  )) ? 30 : 0;
  const reputationFloor = googleKnownUnsafe ? 75 : 0;
  const score = Math.min(100, Math.max(
    ruleScore + urlHeuristicScore + interactionBonus,
    criticalFloor,
    urlSafetyFloor,
    reputationFloor,
  ));

  const riskLevel: RiskLevel = score >= 65 ? "high" : score >= 30 ? "medium" : "low";
  const copy = localizedCopy(locale, riskLevel);
  const responsePlan = incidentResponse(locale, exposures, riskLevel);
  const hasUnparsedUrl = urls.some((url) => !url.host || url.signals.includes("malformed-url") || url.signals.includes("unsupported-url-scheme"));
  const hasPartialUrl = urls.some((url) => (
    url.partial
    || url.signals.includes("shortened-url")
    || url.signals.includes("redirect-parameter")
  ));
  const hasUnresolvedUrlMarker = URL_LIKE_MARKER.test(material) && urls.length === 0;
  const reputationComplete = ["available", "cached", "not-requested"].includes(urlReputation.status);
  const assessmentStatus = (hasUnparsedUrl || hasUnresolvedUrlMarker) && matched.length === 0
    ? "inconclusive"
    : urls.length > 0 && (!reputationComplete || hasPartialUrl)
      ? "partial"
      : "complete";
  const unsafeUrlSignal = googleKnownUnsafe
    ? [{
        id: "known-unsafe-url",
        label: locale === "ko"
          ? "URL 평판 조회에서 위험 가능성이 보고됨"
          : locale === "ja"
            ? "URL評価サービスで危険の可能性が報告されました"
            : locale === "zh"
              ? "网址信誉查询报告了潜在风险"
              : "URL reputation lookup reported a possible threat",
        weight: 55,
      }]
    : [];

  return json({
    riskLevel,
    score,
    assessmentStatus,
    summary: copy.summary,
    signals: [
      ...matched.map((rule) => ({ id: rule.id, label: rule.labels[locale], weight: rule.weight })),
      ...unsafeUrlSignal,
    ],
    detectedUrls: urls.map(({ url, host, signals, partial }) => ({
      url,
      host,
      signals,
      signalLabels: signals.map((signal) => urlSignalLabel(signal, locale)),
      partial,
    })),
    scoreBreakdown: {
      ruleScore,
      urlHeuristicScore,
      interactionBonus,
      criticalFloor: Math.max(criticalFloor, urlSafetyFloor),
      reputationFloor,
      total: score,
    },
    urlReputation: {
      status: urlReputation.status,
      provider: googleKnownUnsafe ? "Google Safe Browsing" : null,
      providerUrl: googleKnownUnsafe ? SAFE_BROWSING_PROVIDER_URL : null,
      advisory: googleKnownUnsafe,
      queryParametersRemoved: true,
      consentApplied: reputationConsent,
      submittedComponents: urlReputation.submitted
        ? "scheme-host-path-without-query"
        : null,
    },
    incidentResponse: {
      level: responsePlan.level,
      title: responsePlan.title,
      summary: responsePlan.summary,
      exposureIds: exposures,
    },
    recommendedActions: responsePlan.actions,
    officialResources: officialResources(locale),
    contacts: {
      policeEmergency: "112",
      phishingHotline: "1394",
      financialSupervisoryService: "1332",
      kisaIncidentHelp: "118",
    },
    disclaimer: copy.disclaimer,
    ruleSetVersion: "bora-phishing-rules/2.0",
    officialSourceReviewedAt: OFFICIAL_SOURCE_REVIEWED_AT,
    analyzedAt: new Date().toISOString(),
  });
}

/**
 * Server-only diagnostic adapter. It exercises the same bounded parsing and
 * response assembly as the public endpoint without consuming a public user's
 * anonymous rate-limit bucket. This export is not an HTTP route.
 */
export async function runPhishingDiagnosticRequest(request: Request) {
  return handlePhishingRequest(request, false);
}

export async function POST(request: Request) {
  return handlePhishingRequest(request, true);
}
