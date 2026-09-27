import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});

const triageModule = await server.ssrLoadModule("/lib/security-triage.ts");
const componentModule = await server.ssrLoadModule("/app/components/security-triage-lab.tsx");
test.after(() => server.close());

const {
  SECURITY_REVIEW_PRIORITIES,
  SECURITY_TRIAGE_DOMAINS,
  SECURITY_TRIAGE_LOCALES,
  SECURITY_TRIAGE_SIGNALS,
  evaluateSecurityTriage,
  securityTriageSignalsFor,
} = triageModule;
const { SecurityTriageLab } = componentModule;

const immediatePauseIdsByDomain = {
  transaction: [
    "transaction-recipient-details-changed",
    "transaction-remote-control-or-code",
  ],
  insurance_document: [
    "insurance-duplicate-reference",
    "insurance-party-field-mismatch",
  ],
  ai_agent: [
    "agent-instruction-override",
    "agent-secret-request",
    "agent-untrusted-external-instruction",
    "agent-unbounded-tool-loop",
    "agent-unexpected-destination",
    "agent-permission-escalation",
  ],
};

test("triage definitions are a finite localized allowlist", () => {
  assert.deepEqual(SECURITY_TRIAGE_LOCALES, ["ko", "en", "ja", "zh"]);
  assert.deepEqual(SECURITY_TRIAGE_DOMAINS, [
    "transaction",
    "insurance_document",
    "ai_agent",
  ]);
  assert.deepEqual(SECURITY_REVIEW_PRIORITIES, ["low", "medium", "high"]);

  assert.equal(SECURITY_TRIAGE_SIGNALS.length, 18);
  assert.equal(
    new Set(SECURITY_TRIAGE_SIGNALS.map((signal) => signal.id)).size,
    SECURITY_TRIAGE_SIGNALS.length,
  );

  for (const domain of SECURITY_TRIAGE_DOMAINS) {
    const signals = securityTriageSignalsFor(domain);
    assert.equal(signals.length, 6);
    assert.equal(signals.every((signal) => signal.domain === domain), true);
    assert.deepEqual(
      signals.filter((signal) => signal.immediatePause === true).map((signal) => signal.id),
      immediatePauseIdsByDomain[domain],
    );

    for (const signal of signals) {
      assert.match(signal.id, /^(?:transaction|insurance|agent)-[a-z0-9-]+$/u);
      assert.equal(Number.isFinite(signal.weight) && signal.weight > 0, true);
      assert.equal(signal.immediatePause === undefined || signal.immediatePause === true, true);
      for (const locale of SECURITY_TRIAGE_LOCALES) {
        assert.equal(typeof signal.label[locale], "string");
        assert.equal(signal.label[locale].trim().length > 0, true);
        assert.equal(typeof signal.description[locale], "string");
        assert.equal(signal.description[locale].trim().length > 0, true);
      }
    }
  }
});

test("empty selection stays at truthful zero and does not invent signals", () => {
  for (const domain of SECURITY_TRIAGE_DOMAINS) {
    const result = evaluateSecurityTriage(domain, []);
    assert.equal(result.score, 0);
    assert.equal(result.priority, "low");
    assert.equal(result.selectedCount, 0);
    assert.equal(result.allowedCount, 6);
    assert.deepEqual(result.selectedSignalIds, []);
    assert.deepEqual(result.selectedSignals, []);
    assert.equal(result.immediatePause, false);
    assert.deepEqual(result.immediatePauseSignalIds, []);
  }

  assert.deepEqual(evaluateSecurityTriage("transaction", null).selectedSignalIds, []);
  assert.deepEqual(evaluateSecurityTriage("transaction", "transaction-unusual-amount").selectedSignalIds, []);
});

test("unknown, duplicate, cross-domain, and non-string signals are ignored", () => {
  const result = evaluateSecurityTriage("transaction", [
    "unknown-signal",
    "transaction-unusual-amount",
    "insurance-amount-mismatch",
    "transaction-unusual-amount",
    42,
    null,
  ]);

  assert.deepEqual(result.selectedSignalIds, ["transaction-unusual-amount"]);
  assert.equal(result.selectedCount, 1);
  assert.equal(result.score, 16);
  assert.equal(result.priority, "low");
  assert.equal(result.immediatePause, false);
  assert.deepEqual(result.immediatePauseSignalIds, []);
});

test("immediate-pause safety rules do not rewrite numeric score or review priority", () => {
  const cases = [
    {
      domain: "transaction",
      signalId: "transaction-remote-control-or-code",
      score: 30,
      priority: "medium",
    },
    {
      domain: "insurance_document",
      signalId: "insurance-duplicate-reference",
      score: 22,
      priority: "low",
    },
    {
      domain: "ai_agent",
      signalId: "agent-instruction-override",
      score: 22,
      priority: "low",
    },
  ];

  for (const expected of cases) {
    const result = evaluateSecurityTriage(expected.domain, [
      expected.signalId,
      expected.signalId,
      "unknown-signal",
    ]);
    assert.equal(result.score, expected.score);
    assert.equal(result.priority, expected.priority);
    assert.equal(result.immediatePause, true);
    assert.deepEqual(result.immediatePauseSignalIds, [expected.signalId]);
  }

  const highWithoutImmediatePause = evaluateSecurityTriage("transaction", [
    "transaction-unfamiliar-recipient",
    "transaction-unusual-amount",
    "transaction-rapid-repeat",
    "transaction-new-device-or-location",
  ]);
  assert.equal(highWithoutImmediatePause.score, 66);
  assert.equal(highWithoutImmediatePause.priority, "high");
  assert.equal(highWithoutImmediatePause.immediatePause, false);
  assert.deepEqual(highWithoutImmediatePause.immediatePauseSignalIds, []);
});

test("combined allowlisted weights can produce a high review priority", () => {
  const result = evaluateSecurityTriage("transaction", [
    "transaction-remote-control-or-code",
    "transaction-recipient-details-changed",
    "transaction-rapid-repeat",
  ]);

  assert.equal(result.score, 72);
  assert.equal(result.priority, "high");
  assert.equal(result.selectedCount, 3);
  assert.equal(result.immediatePause, true);
  assert.deepEqual(result.immediatePauseSignalIds, [
    "transaction-remote-control-or-code",
    "transaction-recipient-details-changed",
  ]);
  assert.equal(
    result.selectedSignals.every((signal) => signal.domain === "transaction"),
    true,
  );
});

test("initial lab renders zero state, three accessible tabs, and no signal graph", () => {
  const localeMarkers = {
    ko: "선택 전",
    en: "Not started",
    ja: "未選択",
    zh: "尚未选择",
  };

  for (const locale of SECURITY_TRIAGE_LOCALES) {
    const html = renderToStaticMarkup(createElement(SecurityTriageLab, { locale }));
    assert.equal((html.match(/role="tab"/gu) ?? []).length, 3);
    assert.equal((html.match(/role="note"/gu) ?? []).length, 1);
    assert.equal((html.match(/aria-selected="true"/gu) ?? []).length, 1);
    assert.equal((html.match(/tabindex="0"/gu) ?? []).length, 1);
    assert.equal((html.match(/role="tabpanel"/gu) ?? []).length, 1);
    assert.equal((html.match(/type="checkbox"/gu) ?? []).length, 6);
    assert.match(html, />0<small>\/100<\/small>/u);
    assert.match(html, new RegExp(localeMarkers[locale], "u"));
    assert.doesNotMatch(html, /role="img"/u);
    assert.doesNotMatch(html, /role="alert"/u);
    assert.doesNotMatch(html, /<input[^>]*checked/u);
  }
});

test("the lab contains localized domain-specific pause and independent-verification actions", async () => {
  const [componentSource, styles] = await Promise.all([
    readFile(new URL("../app/components/security-triage-lab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/security-triage-lab.module.css", import.meta.url), "utf8"),
  ]);

  assert.equal((componentSource.match(/\bstopAction:\s*"/gu) ?? []).length, 12);
  assert.equal((componentSource.match(/\bverifyAction:\s*"/gu) ?? []).length, 12);
  assert.match(componentSource, /result\.immediatePause/u);
  assert.match(componentSource, /result\.immediatePauseSignalIds/u);
  assert.match(componentSource, /role="alert"/u);
  for (const marker of [
    "즉시 멈춤·독립 확인",
    "Pause now · verify independently",
    "今すぐ停止・独立確認",
    "立即暂停·独立核实",
  ]) {
    assert.match(componentSource, new RegExp(marker, "u"));
  }
  assert.match(styles, /\.immediatePause\s*\{/u);
  assert.match(styles, /\.pauseActions\s*\{/u);
});

test("copy never presents the result as a fraud determination", async () => {
  const sourcePaths = [
    new URL("../lib/security-triage.ts", import.meta.url),
    new URL("../app/components/security-triage-lab.tsx", import.meta.url),
  ];
  const source = (await Promise.all(
    sourcePaths.map((path) => readFile(path, "utf8")),
  )).join("\n");

  const prohibitedDetermination = [
    /사기\s*(?:확정|판정|탐지됨)/iu,
    /fraud\s+(?:confirmed|determined|detected)/iu,
    /詐欺.{0,4}(?:確定|判定|検出済み)/iu,
    /诈骗.{0,4}(?:确认|判定|已检测)/iu,
  ];
  for (const pattern of prohibitedDetermination) {
    assert.doesNotMatch(source, pattern);
  }
  assert.match(source, /검토 순서를 정하는 보조 지표/u);
  assert.match(source, /does not establish a false claim or fraud/u);
  assert.match(source, /does not establish a compromise or successful attack/u);
});

test("lab contains no network, persistence, free-text, file, or PII collection path", async () => {
  const componentSource = await readFile(
    new URL("../app/components/security-triage-lab.tsx", import.meta.url),
    "utf8",
  );

  const prohibitedMechanisms = [
    /\bfetch\s*\(/u,
    /\bXMLHttpRequest\b/u,
    /\bWebSocket\b/u,
    /\bEventSource\b/u,
    /\bsendBeacon\b/u,
    /\blocalStorage\b/u,
    /\bsessionStorage\b/u,
    /<textarea\b/iu,
    /<form\b/iu,
    /type=["'](?:text|email|tel|number|file)["']/iu,
  ];
  for (const pattern of prohibitedMechanisms) {
    assert.doesNotMatch(componentSource, pattern);
  }
});
