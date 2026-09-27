import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createServer } from "vite";

const route = readFileSync(new URL("../app/api/phishing/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../lib/runtime-settings.ts", import.meta.url), "utf8");
const decoderSource = readFileSync(new URL("../lib/safe-browsing-v5.ts", import.meta.url), "utf8");
const decoderJavaScript = ts.transpileModule(decoderSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decodeSafeBrowsingV5Response } = await import(
  `data:text/javascript;base64,${Buffer.from(decoderJavaScript).toString("base64")}`
);

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const phishing = await server.ssrLoadModule("/app/api/phishing/route.ts");
test.after(() => server.close());

function diagnosticRequest(body, options = {}) {
  const origin = options.origin ?? "https://borabridge.example";
  const contentType = options.contentType ?? "application/json";
  return phishing.runPhishingDiagnosticRequest(new Request("https://borabridge.example/api/phishing", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Origin: origin,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

function varint(value) {
  const bytes = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return bytes;
}

function field(number, wireType, bytes) {
  return [...varint((number << 3) | wireType), ...bytes];
}

function lengthDelimited(number, bytes) {
  return field(number, 2, [...varint(bytes.length), ...bytes]);
}

test("phishing URL reputation uses Safe Browsing v5 with provider cache duration", () => {
  assert.match(route, /https:\/\/safebrowsing\.googleapis\.com\/v5\/urls:search/u);
  assert.match(route, /searchParams\.append\("urls", url\)/u);
  assert.match(route, /Accept: "application\/x-protobuf"/u);
  assert.match(route, /decodeSafeBrowsingV5Response/u);
  assert.match(route, /method: "GET"/u);
  assert.match(route, /cacheDurationMs/u);
  assert.match(route, /safeBrowsingCacheMs/u);
  assert.match(route, /runPhishingReputationLookupWithQuota\(request/u);
  assert.match(route, /\{ pepper: apiKey \}/u);
  assert.match(route, /status: lookup\.status/u);
  assert.match(route, /URL_REPUTATION_CACHE_MAX_ENTRIES = 5_000/u);
  assert.match(route, /pruneUrlReputationCache\(now\)/u);
  assert.match(route, /while \(urlReputationCache\.size >= URL_REPUTATION_CACHE_MAX_ENTRIES\)/u);
  assert.match(route, /requestWindowSalt/u);
  assert.match(route, /pruneRequestWindows\(now\)/u);
  assert.match(route, /const reputationFloor = googleKnownUnsafe \? 75 : 0/u);
  assert.doesNotMatch(route, /\$alt/u);
  assert.doesNotMatch(route, /\/v4\/threatMatches:find/u);
});

test("the endpoint creates its ephemeral rate-limit salt only inside a request", () => {
  assert.match(route, /let requestWindowSalt: Uint8Array \| null = null/u);
  assert.match(route, /async function requestWindowKey\(request: Request\)[\s\S]*crypto\.getRandomValues/u);
  assert.doesNotMatch(route, /^const requestWindowSalt\s*=\s*crypto\.getRandomValues/mu);
});

test("phishing rules distinguish direct OTP requests from prevention guidance", () => {
  const directRequest = phishing.evaluatePhishingRuleText(
    "Send your OTP verification code to me now.",
    "en",
  );
  assert.equal(directRequest.riskLevel, "high");
  assert.ok(directRequest.score >= 65);
  assert.ok(directRequest.signals.some((signal) => signal.id === "credential-request"));

  const koreanReplyRequest = phishing.evaluatePhishingRuleText(
    "보안 점검을 위해 오늘 안에 계좌 비밀번호와 OTP를 회신하세요. 미응답 시 계정이 정지됩니다.",
    "ko",
  );
  assert.equal(koreanReplyRequest.riskLevel, "high");
  assert.ok(koreanReplyRequest.score >= 65);
  assert.ok(koreanReplyRequest.signals.some((signal) => signal.id === "credential-request"));

  const prevention = phishing.evaluatePhishingRuleText(
    "Never share your OTP or password. Verify through the official bank app you found yourself.",
    "en",
  );
  assert.equal(prevention.riskLevel, "low");
  assert.equal(prevention.score, 0);
  assert.deepEqual(prevention.signals, []);
});

test("protective wording cannot hide a later OTP request after contrast or punctuation", () => {
  for (const text of [
    "Never share an OTP with anyone, but send your OTP to me now.",
    "Never share an OTP with anyone; send your OTP to me now.",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.score >= 65, text);
    assert.ok(result.signals.some((signal) => signal.id === "credential-request"), text);
  }
});

test("negation-scope tricks and cross-clause pronouns cannot hide credential or remote-access requests", () => {
  const cases = [
    ["Do not forget to send your OTP to me now.", "credential-request"],
    ["Never hesitate to install AnyDesk for verification.", "remote-control-or-app"],
    ["不要忘记立即发送验证码。", "credential-request"],
    ["Your OTP is 123456. Send it to me now.", "credential-request"],
    ["Verification code\nSend it to me now.", "credential-request"],
    ["Do not share this message with anyone and send your OTP to me now.", "credential-request"],
    ["Do not install random apps and install AnyDesk now.", "remote-control-or-app"],
    ["Never share your OTP with anyone. Send it to me now.", "credential-request"],
    ["Your OTP is 123456. For security purposes, send it to me now.", "credential-request"],
    ["Your OTP is 123456. Verification is pending. Send it to me now.", "credential-request"],
    ["Your OTP is 123456. Read carefully. For security purposes, please send it to me now.", "credential-request"],
    ["Your OTP is 123456. This confirms your identity. Keep this confidential. Please send it to me now.", "credential-request"],
    ["Your OTP is 123456. This security review is required to keep your account active. Our monitoring team detected an unusual login from another device and must compare the current session record before the temporary protection window closes in a few minutes. Please send it to me now.", "credential-request"],
    ["Your OTP is 123456. We need it to complete the fraud report. Please send it to me now.", "credential-request"],
    ["Your OTP is 123456. We need to complete the fraud report using it. Please send it to me now.", "credential-request"],
    ["Your verification code just arrived. Complete the incident report with it, then reply with it now.", "credential-request"],
    ["Your password is Summer2026!. Complete the security report. Then send it to me now.", "credential-request"],
    ["Your password: Tr0ub4dor&3. Complete the incident form. Please send it to me now.", "credential-request"],
    ["Your verification code is AB12CD. Complete the support report. Reply with it now.", "credential-request"],
    ["Tell me your OTP now.", "credential-request"],
    ["Give me the verification code.", "credential-request"],
    ["Forward the verification code to me.", "credential-request"],
    ["Your OTP is 123456. Reply with it now.", "credential-request"],
    ["Read the verification code out to me.", "credential-request"],
    ["把验证码告诉我。", "credential-request"],
    ["验证码是123456，请回复给我。", "credential-request"],
    ["認証番号を読み上げてください。", "credential-request"],
    ["인증번호를 읽어 주세요.", "credential-request"],
    ["Do not share this message with anyone and please send your OTP to me now.", "credential-request"],
    ["Do not share this message with anyone and now send your OTP to me now.", "credential-request"],
    ["Do not share this message with anyone then send your OTP to me.", "credential-request"],
    ["Do not share this message: send your OTP to me now.", "credential-request"],
    ["Do not share this message (send your OTP to me now).", "credential-request"],
    ["Do not install random apps / install AnyDesk now.", "remote-control-or-app"],
    ["Do not install random apps and please install AnyDesk.", "remote-control-or-app"],
    ["認証番号を共有しないと口座が停止されますが、それを送ってください。", "credential-request"],
    ["認証番号を共有しない場合は停止されるので、それを送ってください。", "credential-request"],
  ];

  for (const [text, signalId] of cases) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.score >= 65, text);
    assert.ok(result.signals.some((signal) => signal.id === signalId), text);
  }
});

test("direct multilingual payment instructions receive a high-risk safety floor", () => {
  for (const [text, locale] of [
    ["Transfer $500 to this account now.", "en"],
    ["Transfer the funds to this account.", "en"],
    ["この口座に10万円振り込んでください。", "ja"],
    ["この口座へ10万円を送ってください。", "ja"],
    ["向这个账户转账5000元。", "zh"],
    ["给这个账户打5000元。", "zh"],
    ["이 계좌로 500만원 보내줘.", "ko"],
    ["Transfer the money into this account.", "en"],
    ["Deposit 500 dollars into this account.", "en"],
    ["Move the money to the account below.", "en"],
    ["아래 계좌로 돈을 넣어주세요.", "ko"],
    ["Do not transfer money to strangers and transfer $500 to this account.", "en"],
    ["Do not transfer money to strangers and then transfer $500 to this account.", "en"],
    ["Do not transfer money to strangers & transfer $500 to this account.", "en"],
    ["Do not transfer money to strangers -> transfer $500 to this account.", "en"],
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, locale);
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.score >= 65, text);
    assert.ok(result.signals.some((signal) => signal.id === "payment-request"), text);
  }
});

test("legitimate official-store app guidance is not treated as remote-control coercion", () => {
  for (const [text, locale] of [
    ["Install the official bank app from the official app store.", "en"],
    ["Install the official security app from the official App Store.", "en"],
    ["공식 앱스토어에서 은행 보안 앱을 설치하세요.", "ko"],
    ["公式ストアから銀行のセキュリティアプリをインストールしてください。", "ja"],
    ["请从官方应用商店安装银行安全应用。", "zh"],
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, locale);
    assert.equal(result.riskLevel, "low", text);
    assert.ok(result.score < 30, text);
    assert.equal(
      result.signals.some((signal) => signal.id === "remote-control-or-app"),
      false,
      text,
    );
  }
});

test("an official-store phrase cannot suppress an attached remote-access purpose", () => {
  for (const text of [
    "Install the official security app from the official app store so I can control your screen.",
    "Install the official app from the official store at this link and give me remote access.",
    "Download the official bank app from this link so support can access your device.",
    "Install RustDesk so I can fix your bank account.",
    "Open QuickSupport and give me access.",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.signals.some((signal) => signal.id === "remote-control-or-app"), text);
  }
});

test("ordinary bank safety prohibitions remain low-risk guidance", () => {
  for (const text of [
    "Official bank guidance says you should not send your OTP to anyone.",
    "Banks do not request that you send your OTP to anyone.",
    "It is prohibited to send your OTP to another person.",
    "Official guidance: you should not wire funds to this account.",
    "Do not pay $500 to this account.",
    "Never buy a gift card for a stranger.",
    "이 계좌로 돈을 보내면 안 됩니다.",
    "この口座へ送ってはいけません。",
    "请勿向这个账户转账。",
    "認証番号は誰にも共有しないでください。",
    "验证码不得共享。",
    "请勿共享验证码。",
    "인증번호를 공유해서는 안 됩니다.",
    "인증번호 공유 금지.",
    "비밀번호를 알려주면 안 됩니다.",
    "What is your password policy?",
    "What is your PIN length requirement?",
    "What is your passcode format?",
    "Never approve an MFA push you did not initiate.",
    "Do not approve the sign-in notification.",
    "Never tap Yes on an unexpected login prompt.",
    "MFA 푸시를 승인하면 안 됩니다.",
    "로그인 알림에서 승인을 누르지 마세요.",
    "サインイン通知を承認しないでください。",
    "请勿批准登录请求。",
    "認証番号を共有しない場合は、銀行に連絡してください。",
    "認証番号を共有しない場合でも、サービスは利用できます。",
    "認証番号を共有しないと決めました。",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "low", text);
    assert.equal(result.score, 0, text);
    assert.deepEqual(result.signals, [], text);
  }
});

test("a later document instruction is not misbound to an earlier credential warning", () => {
  for (const text of [
    "Bank staff will never ask for your OTP. You can download the application form from the official website, complete it, and send it to our published support address.",
    "Do not share your verification code. For a refund, complete the dispute form in the official bank app, then send it to the address listed on the bank website.",
    "Your password must remain private. Download the public brochure from our official app and send it to a family member who needs the same information.",
    "Never share your OTP. Open the official bank app, download the error report, and reply with it in your existing support ticket.",
    "Do not disclose your verification code. If the bank asks for a transaction receipt, provide it here in the official dispute form.",
    "Your password must remain private. Download the public brochure from our official app and read it out to me during the accessibility review.",
    "Never share your PIN. Complete the official fraud report, then submit it here in the secure bank portal.",
    "Keep your OTP confidential. Complete the official fraud report, then submit it here in the secure bank portal.",
    "Your verification code is for your eyes only. Download the public brochure and read it out to me during the accessibility review.",
    "Your password should stay secret. Open the official support document and send it to the published support address.",
    "Never share your OTP. Download the invoice from the official portal and send it to accounting.",
    "Banks never ask for your password. Open the signed contract in the official app and send it to your lawyer.",
    "Keep your verification code confidential. Download the tax certificate and submit it through the official government portal.",
    "認証番号は誰にも共有しないでください。公式ポータルから請求書をダウンロードして会計担当者に送ってください。",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "low", text);
    assert.equal(result.signals.some((signal) => signal.id === "credential-request"), false, text);
  }
});

test("natural SMS and login-code requests are treated as credential requests", () => {
  for (const text of [
    "Send the passcode to me now.",
    "Tell me the six-digit code you just received.",
    "What is the code we just texted you?",
    "Reply with the number in the SMS.",
    "Send me the login code.",
    "문자로 받은 번호를 답장해.",
    "今届いた6桁の番号を教えて。",
    "把短信里的6位数字发给我。",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.signals.some((signal) => signal.id === "credential-request"), text);
  }
});

test("questions and direct requests for financial identity secrets are hard-stop signals", () => {
  for (const text of [
    "What is your passcode?",
    "What is your PIN?",
    "What is your password?",
    "What is your card number?",
    "What is your CVV?",
    "What is your Social Security number?",
    "인증번호가 뭐예요?",
    "카드번호가 뭐예요?",
    "주민등록번호가 무엇인가요?",
    "パスワードは何ですか？",
    "カード番号は何ですか？",
    "你的密码是什么？",
    "银行卡号是什么？",
    "Send me your card number and CVV.",
    "Tell me your bank account number.",
    "카드번호와 CVC를 알려주세요.",
    "계좌번호를 보내주세요.",
    "クレジットカード番号とCVVを教えてください。",
    "请发送银行卡号和CVV。",
    "Send a photo of your ID.",
    "Upload your passport photo here.",
    "Tell me your Social Security number.",
    "주민등록번호를 알려주세요.",
    "외국인등록번호를 보내주세요.",
    "パスポートの写真を送ってください。",
    "请发送身份证照片。",
    "Send me your wallet seed phrase.",
    "Enter your recovery phrase here.",
    "Share your crypto private key.",
    "지갑 시드 문구를 보내주세요.",
    "秘密鍵を送ってください。",
    "请发送钱包助记词。",
    "Approve the sign-in notification on your phone.",
    "Tap Yes on the login prompt.",
    "Accept the MFA push now.",
    "휴대폰 로그인 알림에서 승인을 눌러주세요.",
    "MFA 푸시를 승인하세요.",
    "サインイン通知を承認してください。",
    "请批准手机上的登录请求。",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.signals.some((signal) => signal.id === "credential-request"), text);
  }
});

test("ordinary source-code reading is not mistaken for a credential request", () => {
  for (const text of [
    "Please read the code out loud during the software review.",
    "The teacher asked me to read the code out in class.",
    "Read the code out to me so we can debug it.",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "low", text);
    assert.equal(
      result.signals.some((signal) => signal.id === "credential-request"),
      false,
      text,
    );
  }
});

test("demonstrative or linked support apps remain hard-stop signals", () => {
  for (const text of [
    "Please install this security app to protect your account.",
    "Download the support app so I can help you.",
    "Install this verification app from the link.",
    "Open the attached security app and follow the instructions.",
    "Install this remote support app so I can control the screen.",
  ]) {
    const result = phishing.evaluatePhishingRuleText(text, "en");
    assert.equal(result.riskLevel, "high", text);
    assert.ok(result.signals.some((signal) => signal.id === "remote-control-or-app"), text);
  }
});

test("analysis fields are rejected before truncation can hide a malicious tail", async () => {
  const oversized = `${"A".repeat(20_010)} Send your OTP verification code to me.`;
  const response = await diagnosticRequest({ locale: "en", text: oversized });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Analysis input is too large." });
});

test("defanged URLs are normalized, surfaced, and never reputation-queried without consent", async () => {
  const response = await diagnosticRequest({
    locale: "en",
    text: "Open hxxps://secure-bank[.]example/login now.",
  });
  assert.equal(response.status, 200);

  const result = await response.json();
  assert.ok(result.signals.some((signal) => signal.id === "defanged-url"));
  assert.equal(result.detectedUrls.length, 1);
  assert.equal(result.detectedUrls[0].host, "secure-bank.example");
  assert.match(result.detectedUrls[0].url, /^https:\/\/secure-bank\.example\/login/u);
  assert.ok(result.detectedUrls[0].signals.includes("credential-themed-path"));
  assert.equal(result.assessmentStatus, "partial");
  assert.deepEqual(result.urlReputation, {
    status: "not-consented",
    provider: null,
    providerUrl: null,
    advisory: false,
    queryParametersRemoved: true,
    consentApplied: false,
    submittedComponents: null,
  });
});

test("uncommon cloud and dev domains are either parsed or explicitly inconclusive", async () => {
  for (const host of ["account-check.cloud", "bank-support.dev"]) {
    const response = await diagnosticRequest({ locale: "en", text: `Open ${host}/login now.` });
    assert.equal(response.status, 200, host);
    const result = await response.json();
    const detected = result.detectedUrls.some((item) => item.host === host);
    assert.ok(detected || result.assessmentStatus === "inconclusive", `${host} must not silently appear complete`);
  }
});

test("deceptive nested domains and executable downloads cannot remain low-risk", async () => {
  for (const [url, requiredSignal] of [
    ["https://paypal.com.evil.cloud/login", "embedded-public-suffix"],
    ["https://accounts.google.com.evil.cloud/", "embedded-public-suffix"],
    ["https://bank.co.kr.evil.cloud/login", "embedded-public-suffix"],
    ["https://evil.cloud/download.apk", "executable-file"],
    ["https://evil.cloud/update%2eapk", "executable-file"],
    ["https://evil.cloud/update.%61%70%6b", "executable-file"],
    ["https://evil.cloud/%64%6f%77%6e%6c%6f%61%64%2e%65%78%65", "executable-file"],
  ]) {
    const response = await diagnosticRequest({ locale: "en", text: `Open ${url}` });
    assert.equal(response.status, 200, url);
    const result = await response.json();
    assert.notEqual(result.riskLevel, "low", url);
    assert.ok(result.detectedUrls[0].signals.includes(requiredSignal), url);
    assert.notEqual(result.detectedUrls[0].signalLabels[0], undefined, url);
  }
  for (const extension of [
    "lnk", "js", "jse", "vbs", "vbe", "bat", "cmd", "ps1", "hta", "jar", "com",
    "iso", "img", "docm", "xlsm", "dmg", "pkg", "mobileconfig",
  ]) {
    const url = `https://evil.cloud/invoice.${extension}`;
    const response = await diagnosticRequest({ locale: "en", text: `Open ${url}` });
    assert.equal(response.status, 200, url);
    const result = await response.json();
    assert.notEqual(result.riskLevel, "low", url);
    assert.ok(result.detectedUrls[0].signals.includes("downloadable-file"), url);
  }
});

test("a punycode credential URL cannot remain low-risk", async () => {
  const response = await diagnosticRequest({
    locale: "en",
    text: "Open https://аррӏе.com/account now",
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.notEqual(result.riskLevel, "low");
  assert.ok(result.detectedUrls[0].signals.includes("punycode-domain"));
  assert.ok(result.detectedUrls[0].signals.includes("credential-themed-path"));
  assert.ok(result.scoreBreakdown.criticalFloor >= 30);
});

test("valid compound public suffixes are not treated as deceptive nested domains", async () => {
  for (const host of ["example.co.kr", "example.co.jp", "example.com.cn"]) {
    const response = await diagnosticRequest({ locale: "en", text: `Open https://${host}/` });
    assert.equal(response.status, 200, host);
    const result = await response.json();
    assert.equal(
      result.detectedUrls[0].signals.includes("embedded-public-suffix"),
      false,
      host,
    );
  }
});

test("colon-bracket and dot-word defanging is surfaced instead of silently completed", async () => {
  for (const text of [
    "Open hxxps[:]//secure-login dot cloud/account now.",
    "Open hxxps://secure-login[dot]cloud/account now.",
    "Open secure-login(dot)cloud/account now.",
    "Open secure-login{dot}cloud/account now.",
  ]) {
    const response = await diagnosticRequest({ locale: "en", text });
    assert.equal(response.status, 200, text);
    const result = await response.json();
    assert.ok(result.signals.some((signal) => signal.id === "defanged-url"), text);
    assert.equal(result.detectedUrls[0].host, "secure-login.cloud", text);
    assert.notEqual(result.riskLevel, "low", text);
    assert.equal(result.assessmentStatus, "partial", text);
  }
});

test("phishing diagnostics reject cross-origin and non-JSON mutation requests", async () => {
  const crossOrigin = await diagnosticRequest(
    { locale: "en", text: "Send your OTP." },
    { origin: "https://attacker.example" },
  );
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), { error: "origin_mismatch" });

  const wrongContentType = await diagnosticRequest(
    JSON.stringify({ locale: "en", text: "Send your OTP." }),
    { contentType: "text/plain" },
  );
  assert.equal(wrongContentType.status, 415);
  assert.deepEqual(await wrongContentType.json(), { error: "application_json_required" });
});

test("reported money exposure returns an emergency plan and official contacts", async () => {
  const response = await diagnosticRequest({
    locale: "en",
    text: "I already transferred money after receiving this message.",
    exposures: ["sent-money"],
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.incidentResponse.level, "emergency");
  assert.deepEqual(result.incidentResponse.exposureIds, ["sent-money"]);
  assert.ok(result.recommendedActions.some((action) => action.includes("112")));
  assert.ok(result.recommendedActions.some((action) => action.includes("1394")));
  const officialResourceIds = result.officialResources.map((resource) => resource.id);
  assert.ok(officialResourceIds.includes("police-112"));
  assert.ok(officialResourceIds.includes("phishing-1394"));
  assert.ok(officialResourceIds.includes("kisa-118"));
  assert.equal(result.contacts.policeEmergency, "112");
  assert.equal(result.contacts.phishingHotline, "1394");
  assert.equal(result.contacts.kisaIncidentHelp, "118");
});

test("Safe Browsing v5 protobuf responses preserve threats and provider cache duration", () => {
  const encodedUrl = [...new TextEncoder().encode("https://bad.example/login")];
  const threat = [
    ...lengthDelimited(1, encodedUrl),
    ...lengthDelimited(2, [...varint(1), ...varint(2)]),
  ];
  const duration = [
    ...field(1, 0, varint(300)),
    ...field(2, 0, varint(500_000_000)),
  ];
  const response = new Uint8Array([
    ...lengthDelimited(1, threat),
    ...lengthDelimited(2, duration),
  ]);

  assert.deepEqual(decodeSafeBrowsingV5Response(response), {
    threats: [{ url: "https://bad.example/login", threatTypes: [1, 2] }],
    cacheDurationMs: 300_500,
  });
});

test("Safe Browsing v5 protobuf decoder rejects oversized and malformed responses", () => {
  assert.throws(
    () => decodeSafeBrowsingV5Response(new Uint8Array(256 * 1024 + 1)),
    /safe_browsing_response_too_large/u,
  );
  assert.throws(() => decodeSafeBrowsingV5Response(new Uint8Array([0x0a, 0x05, 0x01])), /protobuf/u);
});

test("Safe Browsing use is attributed and its non-commercial boundary is visible", () => {
  assert.match(route, /https:\/\/developers\.google\.com\/safe-browsing\/v4\/advisory/u);
  assert.match(route, /provider: googleKnownUnsafe \? "Google Safe Browsing" : null/u);
  assert.match(route, /providerUrl: googleKnownUnsafe \? SAFE_BROWSING_PROVIDER_URL : null/u);
  assert.match(route, /advisory: googleKnownUnsafe/u);
  assert.match(page, /urlReputation\.providerUrl/u);
  assert.match(page, /urlReputation\.advisory && phishingResult\.urlReputation\.providerUrl/u);
  assert.match(page, /Advisory provided by Google/u);
  assert.match(settings, /비상업적 용도 한정/u);
});
