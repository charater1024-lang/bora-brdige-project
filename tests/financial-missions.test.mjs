import assert from "node:assert/strict";
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
const missionModule = await server.ssrLoadModule("/lib/financial-missions.ts");
const componentModule = await server.ssrLoadModule("/app/components/financial-mission-center.tsx");
test.after(() => server.close());

const {
  FINANCIAL_MISSION_LOCALES,
  FINANCIAL_MISSION_STATUSES,
  financialMissions,
  financialMissionSelfCheckProgress,
} = missionModule;
const { FinancialMissionCenter } = componentModule;

test("seven missions expose truthful implementation states in all four languages", () => {
  assert.deepEqual(FINANCIAL_MISSION_LOCALES, ["ko", "en", "ja", "zh"]);
  assert.deepEqual(FINANCIAL_MISSION_STATUSES, [
    "official-data",
    "direct-input",
    "prototype",
    "partnership-required",
  ]);

  for (const locale of FINANCIAL_MISSION_LOCALES) {
    const missions = financialMissions(locale);
    assert.equal(missions.length, 7);
    assert.equal(new Set(missions.map((mission) => mission.id)).size, 7);
    assert.equal(missions.every((mission) => mission.title && mission.summary && mission.evidence), true);
    assert.equal(missions.every((mission) => FINANCIAL_MISSION_STATUSES.includes(mission.status)), true);
    assert.equal(missions.every((mission) => mission.readiness.length > 0), true);
  }

  assert.deepEqual(
    financialMissions("ko").map(({ id, status }) => [id, status]),
    [
      ["inclusive-asset-accessibility", "direct-input"],
      ["transaction-insurance-triage", "prototype"],
      ["phishing-protection", "direct-input"],
      ["startup-small-business", "official-data"],
      ["venture-growth-evidence", "prototype"],
      ["foreign-resident-settlement", "official-data"],
      ["frontier-ai-security", "prototype"],
    ],
  );
});

test("mission links are credential-free HTTPS official destinations", () => {
  for (const locale of FINANCIAL_MISSION_LOCALES) {
    for (const mission of financialMissions(locale)) {
      assert.ok(mission.officialLinks.length > 0);
      for (const link of mission.officialLinks) {
        const url = new URL(link.url);
        assert.equal(url.protocol, "https:");
        assert.equal(url.username, "");
        assert.equal(url.password, "");
        assert.ok(url.hostname);
        assert.ok(link.label);
        assert.ok(link.summary);
        assert.ok(link.whenToUse);
        assert.notEqual(link.summary, link.whenToUse);
      }
    }
  }
});

test("official source previews expose localized guidance before the external action", () => {
  const actionCopy = {
    ko: "공식 원문에서 최신 조건 확인",
    en: "Check current terms in the official source",
    ja: "公式原文で最新条件を確認",
    zh: "前往官方原文核对最新条件",
  };

  for (const locale of FINANCIAL_MISSION_LOCALES) {
    const missions = financialMissions(locale);
    const linkCount = missions.reduce(
      (count, mission) => count + mission.officialLinks.length,
      0,
    );
    const html = renderToStaticMarkup(createElement(FinancialMissionCenter, {
      locale,
      onNavigate() {},
    }));

    assert.equal((html.match(/data-official-preview="true"/gu) ?? []).length, linkCount);
    assert.equal((html.match(/data-official-current-terms="true"/gu) ?? []).length, linkCount);
    assert.equal((html.match(/target="_blank"/gu) ?? []).length, linkCount);
    assert.equal((html.match(/rel="noopener noreferrer"/gu) ?? []).length, linkCount);
    assert.ok(html.includes(actionCopy[locale]));
    assert.doesNotMatch(html, /<footer\b/iu);
  }
});

test("self-check progress counts only unique readiness items selected by the user", () => {
  const readinessIds = ["one", "two", "three"];
  assert.deepEqual(
    financialMissionSelfCheckProgress([], readinessIds),
    { completed: 0, total: 3, fraction: 0 },
  );
  assert.deepEqual(
    financialMissionSelfCheckProgress(["one", "one", "unknown"], readinessIds),
    { completed: 1, total: 3, fraction: 1 / 3 },
  );
  assert.deepEqual(
    financialMissionSelfCheckProgress(["three", "two", "one"], readinessIds),
    { completed: 3, total: 3, fraction: 1 },
  );
});

test("initial mission center renders zero self-check progress without scores or sample values", () => {
  for (const locale of FINANCIAL_MISSION_LOCALES) {
    const html = renderToStaticMarkup(createElement(FinancialMissionCenter, {
      locale,
      easyMode: locale === "ko",
      onNavigate() {},
    }));
    assert.equal((html.match(/role="progressbar"/gu) ?? []).length, 7);
    assert.equal((html.match(/aria-valuenow="0"/gu) ?? []).length, 7);
    assert.equal((html.match(/data-progress-basis="user-self-check"/gu) ?? []).length, 7);
    assert.equal((html.match(/type="checkbox"/gu) ?? []).length, 21);
    assert.equal((html.match(/role="tab"/gu) ?? []).length, 7);
    assert.equal((html.match(/aria-selected="true"/gu) ?? []).length, 1);
    assert.equal((html.match(/tabindex="0"/gu) ?? []).length, 1);
    assert.equal((html.match(/tabindex="-1"/gu) ?? []).length, 6);
    assert.equal((html.match(/role="tabpanel"/gu) ?? []).length, 7);
    assert.equal((html.match(/hidden=""/gu) ?? []).length, 6);
    assert.doesNotMatch(html, /\b(?:approval probability|growth probability)\s*[:：]?\s*\d/iu);
    assert.doesNotMatch(html, /승인\s*확률\s*[:：]?\s*\d|성장\s*가능성\s*[:：]?\s*\d|투자\s*등급\s*[:：]?\s*[A-F1-9]|샘플\s*(?:값|데이터)|예시\s*(?:값|데이터)/u);
    assert.doesNotMatch(html, /aria-valuenow="[1-9]/u);
    assert.doesNotMatch(html, /<input[^>]*checked/u);
  }
});

test("mission tabs follow the APG roving-tabindex keyboard pattern", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../app/components/financial-mission-center.tsx", import.meta.url),
    "utf8",
  ));
  assert.match(source, /tabIndex=\{selected \? 0 : -1\}/u);
  assert.match(source, /event\.key === "ArrowRight"/u);
  assert.match(source, /event\.key === "ArrowLeft"/u);
  assert.match(source, /event\.key === "Home"/u);
  assert.match(source, /event\.key === "End"/u);
  assert.match(source, /missionTabRefs\.current\[nextIndex\]\?\.focus\(\)/u);
});
