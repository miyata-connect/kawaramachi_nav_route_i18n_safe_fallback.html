// e2e/tests/weather.v1.spec.ts
import { test, expect } from "@playwright/test";

const BASE = "https://ors-proxy.miyata-connect-jp.workers.dev";

test("GET /v1/weather returns compact forecast (now,+3h,+6h)", async ({ request }) => {
  const url = `${BASE}/v1/weather?lat=34.067&lng=134.553&lang=ja&units=metric`;
  const res = await request.get(url);
  expect(res.status()).toBe(200);

  const j = await res.json();

  // 主要フィールドの存在
  expect(j).toHaveProperty("coord.lat");
  expect(j).toHaveProperty("coord.lng");
  expect(j).toHaveProperty("now.time");
  expect(j).toHaveProperty("now.tempC");
  expect(j).toHaveProperty("t+3h.time");
  expect(j).toHaveProperty("t+6h.time");
  expect(j.provider).toBe("open-meteo");

  // TTL はだいたい5分
  expect(j.ttlSec).toBeGreaterThanOrEqual(240);
  expect(j.ttlSec).toBeLessThanOrEqual(600);
});
