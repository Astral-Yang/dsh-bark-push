import assert from 'node:assert/strict';
import test from 'node:test';

import { BarkClient } from '../lib/bark.js';
import { normalizeConfig } from '../lib/config.js';
import { createBarkServer, createLogger } from './helpers.js';

const KEY = 'TEST_DEVICE_KEY_1234567890';

function clientFor(server, overrides = {}) {
  const logger = createLogger();
  let config = normalizeConfig({
    server,
    deviceKeys: [KEY],
    group: 'DSH',
    maxRetries: 2,
    retryDelayMs: 50,
    timeoutMs: 2000,
    ...overrides,
  }).config;
  const client = new BarkClient({
    getConfig: () => config,
    logger,
    sleepImpl: async () => {},
    random: () => 0,
  });
  return { client, logger, setConfig: (next) => (config = normalizeConfig({ ...config, ...next }).config) };
}

test('POSTs the expected Bark payload and never logs the device key', async () => {
  const bark = await createBarkServer();
  try {
    const { client, logger } = clientFor(bark.url);
    const result = await client.send({ title: '标题', body: '正文', kind: 'reply' });
    assert.equal(result.ok, true);
    assert.equal(bark.requests.length, 1);
    const request = bark.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/push');
    assert.equal(request.body.device_key, KEY);
    assert.equal(request.body.title, '标题');
    assert.equal(request.body.body, '正文');
    assert.equal(request.body.group, 'DSH');
    assert.equal(request.body.level, 'active');
    assert.equal(logger.lines.join('\n').includes(KEY), false);
  } finally {
    await bark.close();
  }
});

test('uses the important level and sound for approvals', async () => {
  const bark = await createBarkServer();
  try {
    const { client } = clientFor(bark.url, { soundImportant: 'alarm' });
    await client.send({ title: '需要批准', body: 'Bash', kind: 'approval' });
    assert.equal(bark.requests[0].body.level, 'timeSensitive');
    assert.equal(bark.requests[0].body.sound, 'alarm');
  } finally {
    await bark.close();
  }
});

test('retries a 500 response and succeeds on the second attempt', async () => {
  const bark = await createBarkServer({
    responses: [
      { status: 500, body: { code: 500, message: 'busy' } },
      { status: 200, body: { code: 200, message: 'success' } },
    ],
  });
  try {
    const { client } = clientFor(bark.url);
    const result = await client.send({ title: 't', body: 'b', kind: 'reply' });
    assert.equal(result.ok, true);
    assert.equal(result.results[0].attempts, 2);
    assert.equal(bark.requests.length, 2);
  } finally {
    await bark.close();
  }
});

test('does not retry a 400 response', async () => {
  const bark = await createBarkServer({ responses: [{ status: 400, body: { code: 400, message: 'bad key' } }] });
  try {
    const { client } = clientFor(bark.url);
    const result = await client.send({ title: 't', body: 'b', kind: 'reply' });
    assert.equal(result.ok, false);
    assert.equal(result.results[0].attempts, 1);
    assert.equal(bark.requests.length, 1);
  } finally {
    await bark.close();
  }
});

test('treats a JSON error code on HTTP 200 as a failure', async () => {
  const bark = await createBarkServer({ responses: [{ status: 200, body: { code: 400, message: 'invalid device key' } }] });
  try {
    const { client } = clientFor(bark.url);
    const result = await client.send({ title: 't', body: 'b', kind: 'reply' });
    assert.equal(result.ok, false);
    assert.equal(result.results[0].code, 400);
  } finally {
    await bark.close();
  }
});

test('fans out to every configured device key', async () => {
  const bark = await createBarkServer();
  try {
    const { client } = clientFor(bark.url, { deviceKeys: [KEY, 'second-key'] });
    const result = await client.send({ title: 't', body: 'b', kind: 'reply' });
    assert.equal(result.ok, true);
    assert.equal(bark.requests.length, 2);
    assert.deepEqual(
      bark.requests.map((request) => request.body.device_key),
      [KEY, 'second-key'],
    );
  } finally {
    await bark.close();
  }
});

test('returns a skip when the plugin is disabled or no key is configured', async () => {
  const bark = await createBarkServer();
  try {
    const { client, setConfig } = clientFor(bark.url);
    setConfig({ enabled: false });
    const disabled = await client.send({ title: 't', body: 'b', kind: 'reply' });
    assert.equal(disabled.skipped, true);
    assert.equal(disabled.reason, 'disabled');
    setConfig({ enabled: true, deviceKeys: [] });
    const empty = await client.send({ title: 't', body: 'b', kind: 'reply' });
    assert.equal(empty.skipped, true);
    assert.equal(empty.reason, 'no-device-key');
    assert.equal(bark.requests.length, 0);
  } finally {
    await bark.close();
  }
});
