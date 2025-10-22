import { test, expect } from '@playwright/test';

const BASE = 'https://ors-proxy.miyata-connect-jp.workers.dev';

test('cold-aware routing - incidents endpoint returns TTL', async ({ request }) => {
  const response = await request.get(`${BASE}/v1/incidents?lat=34.3853&lng=132.4553&radius=1000`);
  expect(response.ok()).toBeTruthy();
  const json = await response.json();
  expect(json).toHaveProperty('ttl');
  expect(json.ttl).toBeGreaterThan(0);
  expect(Array.isArray(json.items)).toBeTruthy();
});

// Skip weather stage classification test until implemented
test.skip('cold-aware routing - weather stage classification', async ({ request }) => {
  const response = await request.get(`${BASE}/v1/weather?lat=34.3853&lng=132.4553`);
  expect(response.ok()).toBeTruthy();
  const json = await response.json();
  expect(json.now).toHaveProperty('tempC');
  expect(json.now).toHaveProperty('stage');
  expect(['none', 'prefer', 'strong']).toContain(json.now.stage);
});
