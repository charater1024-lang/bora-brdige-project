import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const challengePage = read("../app/challenge/page.tsx");
const challengeStyles = read("../app/challenge/challenge.module.css");
const commercialInsights = read("../app/components/commercial-area-insights.tsx");
const commercialStyles = read("../app/components/commercial-area-insights.module.css");

test("challenge walkthrough offers distinct quick and full paths with a continuous persona journey", () => {
  assert.match(challengePage, /90초 핵심 둘러보기/u);
  assert.match(challengePage, /3분 서비스 둘러보기/u);
  assert.match(challengePage, /selectNextPersona/u);
  assert.match(challengePage, /다음 페르소나:/u);
  assert.match(challengePage, /한국어·영어·일본어·중국어를 지원/u);
  assert.match(challengePage, /출품용 서비스 소개는 한국어/u);
});

test("challenge evidence and legal routes remain directly accessible", () => {
  assert.match(challengePage, /https:\/\/fine\.fss\.or\.kr/u);
  assert.match(challengePage, /https:\/\/www\.hikorea\.go\.kr/u);
  assert.match(challengePage, /href="\/privacy"/u);
  assert.match(challengePage, /href="\/terms"/u);
  assert.match(challengePage, /운영 데이터의 실제 갱신 시각과 연결 상태는 각 기능 화면/u);
});

test("challenge navigation and truth table become readable mobile controls and cards", () => {
  assert.match(challengeStyles, /@media \(max-width: 820px\)[\s\S]*?\.topNav \{[\s\S]*?display: flex/u);
  assert.match(challengeStyles, /\.truthTable tbody tr \{[\s\S]*?border-radius: 17px/u);
  assert.match(challengeStyles, /content: attr\(data-label\)/u);
  assert.doesNotMatch(challengeStyles, /@media \(max-width: 820px\)[\s\S]*?\.topNav \{ display: none; \}/u);
});

test("commercial time charts provide a text summary and an expandable data table", () => {
  assert.match(commercialInsights, /className=\{styles\.chartSummary\}/u);
  assert.match(commercialInsights, /<details className=\{styles\.chartDataDetails\}>/u);
  assert.match(commercialInsights, /<caption className=\{styles\.srOnly\}>/u);
  assert.match(commercialInsights, /aria-hidden="true"/u);
  assert.match(commercialStyles, /\.chartDataDetails summary \{[\s\S]*?min-height: 44px/u);
});
