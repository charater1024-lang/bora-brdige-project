import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
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
const { snapshotPayloadWithYouthPreview } = await server.ssrLoadModule("/lib/public-data/service.ts");
const { serializePublicDataPayload } = await server.ssrLoadModule("/lib/public-data/cache.ts");
const { emptyPublicDataPayload } = await server.ssrLoadModule("/lib/public-data/types.ts");
test.after(() => server.close());

test("oversized public catalogues are reduced to a serializable shared preview", () => {
  const payload = emptyPublicDataPayload();
  const startup = payload.categories.find((group) => group.id === "startup");
  startup.items = Array.from({ length: 2_000 }, (_, index) => ({
    id: `kstartup-${index}`,
    category: "startup",
    title: `창업 지원 ${index}`,
    summary: `상세 조건 ${index} `.repeat(180),
    source: "공식 출처",
    sourceUrl: "https://example.go.kr/notice",
    publishedAt: "2026-07-29",
    discoveredAt: "2026-07-29T00:00:00.000Z",
    lastVerifiedAt: "2026-07-29T00:00:00.000Z",
    tags: [],
  }));
  startup.totalCount = startup.items.length;

  const preview = snapshotPayloadWithYouthPreview(payload);
  const previewStartup = preview.categories.find((group) => group.id === "startup");
  assert.ok(previewStartup.items.length < startup.items.length);
  assert.doesNotThrow(() => serializePublicDataPayload(preview));
});

test("one oversized record cannot block source completion after its full catalogue is stored", () => {
  const payload = emptyPublicDataPayload();
  const startup = payload.categories.find((group) => group.id === "startup");
  startup.items = [{
    id: "kstartup-oversized",
    category: "startup",
    title: "대형 원문",
    summary: "가".repeat(2_000_000),
    source: "공식 제공기관",
    sourceUrl: "https://example.go.kr/item",
    publishedAt: "2026-07-29",
    discoveredAt: "2026-07-29T00:00:00.000Z",
    tags: ["창업"],
  }];
  startup.totalCount = 1;

  const preview = snapshotPayloadWithYouthPreview(payload);
  assert.equal(preview.categories.find((group) => group.id === "startup").items.length, 0);
  assert.doesNotThrow(() => serializePublicDataPayload(preview));
});
