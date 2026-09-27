import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeSettingsUrl = new URL("../lib/runtime-settings.ts", import.meta.url);
const settingsRouteUrl = new URL("../app/api/developer/settings/route.ts", import.meta.url);
const developerPageUrl = new URL("../app/developer/page.tsx", import.meta.url);

test("stored credentials are distinguished from credentials usable by the runtime", async () => {
  const source = await readFile(runtimeSettingsUrl, "utf8");
  assert.match(source, /async function credentialRuntimeState/);
  assert.match(source, /storedConfigured:/);
  assert.match(source, /environmentConfigured,/);
  assert.match(source, /runtimeUsable:/);
  assert.match(source, /runtimeSource,/);
  assert.match(source, /runtimeIssue:/);
  assert.match(source, /stored_credential_unreadable/);
  assert.match(source, /enabled: activationManaged && credential\.runtimeUsable && requestedEnabled/);
  assert.match(source, /enabled: !globallyDisabled && requestedEnabled && runtimeUsable/);
});

test("ON mutations reject encrypted rows that cannot be used at runtime", async () => {
  const source = await readFile(runtimeSettingsUrl, "utf8");
  assert.match(source, /if \(!credential\.configured\) throw new Error\("service_key_required"\)/);
  assert.match(source, /if \(!credential\.runtimeUsable\) throw new Error\("service_key_unreadable"\)/);
  assert.match(source, /if \(!credential\.configured\) throw new Error\("provider_key_required"\)/);
  assert.match(source, /if \(!credential\.runtimeUsable\) throw new Error\("provider_key_unreadable"\)/);
});

test("Seoul official HTTPS files use a keyless activation-only runtime switch", async () => {
  const source = await readFile(runtimeSettingsUrl, "utf8");
  const integratedKeys = source.match(
    /const RUNTIME_INTEGRATED_SERVICE_KEYS[\s\S]*?\n\]\);/,
  )?.[0] ?? "";
  assert.match(integratedKeys, /SEOUL_OPEN_DATA_API_KEY/);
  assert.match(source, /const ACTIVATION_ONLY_SERVICE_KEYS[\s\S]*SEOUL_OPEN_DATA_API_KEY/);
  assert.match(source, /서울 상권 공식 파일[^\n]*API 키 없이 서울시 공식 HTTPS 전체 CSV/);
  assert.match(source, /SEOUL_OPEN_DATA_API_KEY:[^\n]*서울시 공식 HTTPS 전체 CSV 수집/);
  assert.match(source, /if \(isActivationOnlyServiceKey\(keyName\)\) return ACTIVATION_ONLY_RUNTIME_SENTINEL/);
  assert.match(source, /WHERE s\.enabled = 1[\s\S]*if \(isActivationOnlyServiceKey\(keyName\)\) \{[\s\S]*resolved\[keyName\] = ACTIVATION_ONLY_RUNTIME_SENTINEL/);
  assert.match(source, /if \(input\.enabled && !isActivationOnlyServiceKey\(input\.keyName\)\)/);
  assert.match(source, /isActivationOnlyServiceKey\(definition\.key\)\s*\?\s*true/);
  assert.match(source, /Never decrypt, mask, expose, or otherwise depend on a legacy Seoul key/);
  assert.match(source, /if \(isActivationOnlyServiceKey\(input\.keyName\)\) return/);
  assert.match(source, /if \(isActivationOnlyServiceKey\(keyName\)\) return/);
});

test("the developer registry presents Seoul as a toggle without secret controls", async () => {
  const source = await readFile(developerPageUrl, "utf8");
  assert.match(source, /credentialRequired: boolean/);
  assert.match(source, /const credentialRequired = service\.credentialRequired !== false/);
  assert.match(source, /!credentialRequired[\s\S]*"수집 ON"[\s\S]*"수집 OFF"/);
  assert.match(source, /credentialRequired && <>[\s\S]*type="password"[\s\S]*<\/>/);
  assert.match(source, /credentialRequired && service\.source === "developer"[\s\S]*삭제/);
  assert.match(source, /OFF 상태에서는 새 파일을 수집하지 않으며, 이미 저장된 서울 상권 데이터는 유지됩니다/);
  assert.match(source, /서울 공식 파일처럼 키가 필요 없는 출처도 함께 켜집니다/);
});

test("developer activation creates source rows and reports delayed synchronization explicitly", async () => {
  const source = await readFile(settingsRouteUrl, "utf8");
  assert.match(source, /ensurePublicSourceStates\(PUBLIC_SOURCE_POLICIES, kstQuotaDay\(now\), now\)/);
  assert.doesNotMatch(source, /synchronizePublicSourceSwitch\([^;]*\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(source, /synchronizeAllPublicSourceSwitches\(\)\.catch\(\(\) => undefined\)/);
  assert.match(source, /async function publicSourceSynchronization/);
  assert.match(source, /return "pending" as const/);
  assert.match(source, /sourceSynchronization/);
  assert.match(source, /provider_key_unreadable/);
  assert.match(source, /service_key_unreadable/);
});
