import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_MANUAL_MONEY_WON,
  canonicalWonFromMoneyInput,
  convertExchangeAmount,
  formatCanonicalWonInput,
  normalizeGroupedDecimalInput,
  normalizeManualMoneyInput,
  parseGroupedNumber,
} from "../lib/money-input.ts";

test("won inputs keep a canonical integer while showing three-digit groups", () => {
  assert.equal(normalizeManualMoneyInput("1234567", "won"), "1,234,567");
  assert.equal(normalizeManualMoneyInput("₩ 1,234,567원", "won"), "1,234,567");
  assert.equal(canonicalWonFromMoneyInput("1,234,567", "won"), "1234567");
  assert.equal(formatCanonicalWonInput("1234567", "won"), "1,234,567");
  assert.equal(canonicalWonFromMoneyInput("", "won"), "");
});

test("manwon inputs preserve exact won values through four decimal places", () => {
  assert.equal(normalizeManualMoneyInput("1234.5678", "manwon"), "1,234.5678");
  assert.equal(canonicalWonFromMoneyInput("1,234.5678", "manwon"), "12345678");
  assert.equal(formatCanonicalWonInput("12345678", "manwon"), "1,234.5678");
  assert.equal(canonicalWonFromMoneyInput("1,234", "manwon"), "12340000");
  assert.equal(
    formatCanonicalWonInput(MAX_MANUAL_MONEY_WON, "manwon"),
    "100,000,000,000",
  );
});

test("editable decimal grouping keeps one decimal point and a bounded fraction", () => {
  assert.equal(normalizeGroupedDecimalInput("001234.5.6789", 4), "1,234.5678");
  assert.equal(normalizeGroupedDecimalInput("1.", 4), "1.");
  assert.equal(normalizeGroupedDecimalInput("1.23", 0), "1");
  assert.equal(parseGroupedNumber("1,234.5"), 1234.5);
  assert.equal(parseGroupedNumber(""), null);
});

test("exchange conversion uses the normalized one-unit base rate in both directions", () => {
  assert.equal(convertExchangeAmount(100, 1_375, "foreign-to-krw"), 137_500);
  assert.ok(Math.abs(
    convertExchangeAmount(1_000_000, 1_375, "krw-to-foreign") - 727.2727272727,
  ) < 0.000_001);
  assert.ok(Math.abs(
    convertExchangeAmount(920, 9.2, "krw-to-foreign") - 100,
  ) < 0.000_001);
  assert.equal(convertExchangeAmount(100, 0, "foreign-to-krw"), null);
  assert.equal(convertExchangeAmount(0, 1_375, "foreign-to-krw"), null);
  assert.equal(convertExchangeAmount(Number.NaN, 1_375, "foreign-to-krw"), null);
});

test("the workbook stores canonical won only and the exchange UI is shared", () => {
  const workbook = readFileSync(
    new URL("../app/components/personal-asset-workbook.tsx", import.meta.url),
    "utf8",
  );
  const overview = readFileSync(
    new URL("../app/components/public-data-overview.tsx", import.meta.url),
    "utf8",
  );
  const history = readFileSync(
    new URL("../app/components/exchange-history-chart.tsx", import.meta.url),
    "utf8",
  );
  const converter = readFileSync(
    new URL("../app/components/exchange-converter.tsx", import.meta.url),
    "utf8",
  );
  const converterCss = readFileSync(
    new URL("../app/components/exchange-converter.module.css", import.meta.url),
    "utf8",
  );

  assert.match(workbook, /type="radio"[\s\S]*value="won"[\s\S]*value="manwon"/u);
  assert.match(workbook, /canonicalWonFromMoneyInput/u);
  assert.match(workbook, /value=\{drafts\[field\]\}/u);
  assert.match(workbook, /id=\{unitHelpId\} aria-live="polite"/u);
  const unitChange = workbook.match(
    /function changeInputUnit[\s\S]*?\n  \}/u,
  )?.[0] ?? "";
  assert.ok(unitChange);
  assert.doesNotMatch(unitChange, /setDirty|saveSnapshot/u);
  assert.match(workbook, /body: JSON\.stringify\(\{\s*version: 1,\s*amounts,\s*useForAi:/u);
  const savePayload = workbook.match(
    /body: JSON\.stringify\(\{\s*version: 1,\s*amounts,\s*useForAi: useForAiRef\.current,\s*\}\)/u,
  )?.[0] ?? "";
  assert.ok(savePayload);
  assert.doesNotMatch(savePayload, /inputUnit/u);
  assert.match(overview, /<ExchangeConverter[\s\S]*baseRate=\{rate\?\.baseRate \?\? null\}/u);
  assert.match(
    history,
    /hasData && !loading && history\.currency === currency[\s\S]*\? history\.summary\.latest[\s\S]*: null/u,
  );
  assert.match(converter, /aria-pressed=\{direction === "foreign-to-krw"\}/u);
  assert.match(converter, /role="status" aria-live="polite"/u);
  assert.match(converter, /target === "KRW" && Math\.abs\(value\) < 100 \? 2/u);
  assert.match(history, /function formatAxisRate/u);
  assert.match(history, /direction === "krw-to-foreign"[\s\S]*\? 4[\s\S]*Math\.abs\(value\) < 100 \? 2 : 0/u);
  assert.match(
    converterCss,
    /\.direction button, \.compact \.direction button \{ min-height: 44px/u,
  );
});
