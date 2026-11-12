import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULTS,
  barkEndpoint,
  maskDeviceKey,
  mergeConfig,
  normalizeConfig,
  normalizeServer,
  publicConfig,
} from '../lib/config.js';

test('normalizes a Bark server root and builds one /push endpoint', () => {
  assert.equal(normalizeServer('https://api.day.app/'), 'https://api.day.app');
  assert.equal(normalizeServer('https://bark.example.com/bark/'), 'https://bark.example.com/bark');
  assert.equal(normalizeServer('https://bark.example.com/push'), 'https://bark.example.com');
  assert.equal(normalizeServer('https://bark.example.com/push/'), 'https://bark.example.com');
  assert.equal(barkEndpoint('https://bark.example.com/bark/'), 'https://bark.example.com/bark/push');
});

test('rejects credentials, query strings, and non-http server URLs', () => {
  assert.equal(normalizeServer('https://user:pass@example.com', 'fallback'), 'fallback');
  assert.equal(normalizeServer('https://example.com/?token=1', 'fallback'), 'fallback');
  assert.equal(normalizeServer('file:///tmp/bark', 'fallback'), 'fallback');
  assert.equal(normalizeServer('not a url', 'fallback'), 'fallback');
});

test('accepts a singular deviceKey and deduplicates deviceKeys', () => {
  const { config } = normalizeConfig({ deviceKey: ' abc ', deviceKeys: ['abc', 'def', 'def', ' '] });
  // An explicit deviceKeys array wins over the compatibility singular field.
  assert.deepEqual(config.deviceKeys, ['abc', 'def']);
  const single = normalizeConfig({ deviceKey: 'abc' }).config;
  assert.deepEqual(single.deviceKeys, ['abc']);
});

test('normalizes the reply title mode', () => {
  assert.equal(normalizeConfig({ titleMode: 'session-summary' }).config.titleMode, 'session-summary');
  assert.equal(normalizeConfig({ titleMode: 'summary' }).config.titleMode, 'summary');
  assert.equal(normalizeConfig({ titleMode: 'nonsense' }).config.titleMode, DEFAULTS.titleMode);
  assert.equal(DEFAULTS.titleMode, 'session');
});

test('clamps numeric fields and falls back for invalid levels', () => {
  const { config } = normalizeConfig({
    maxTitleLength: 999,
    maxBodyLength: -1,
    timeoutMs: 1,
    maxRetries: 99,
    retryDelayMs: 1,
    levelNormal: 'shout',
    levelImportant: 'critical',
  });
  assert.equal(config.maxTitleLength, 200);
  assert.equal(config.maxBodyLength, 32);
  assert.equal(config.timeoutMs, 1000);
  assert.equal(config.maxRetries, 5);
  assert.equal(config.retryDelayMs, 50);
  assert.equal(config.levelNormal, DEFAULTS.levelNormal);
  assert.equal(config.levelImportant, 'critical');
});

test('an explicit empty publicBaseUrl clears the previous value', () => {
  const base = normalizeConfig({ publicBaseUrl: 'https://old.example/' }).config;
  const { config } = mergeConfig(base, { publicBaseUrl: '' });
  assert.equal(config.publicBaseUrl, '');
});

test('merges state overlays without accepting unknown keys', () => {
  const base = normalizeConfig({ group: 'Base', maxBodyLength: 900 }).config;
  const { config } = mergeConfig(base, { group: 'Overlay', unknown: 'ignored' });
  assert.equal(config.group, 'Overlay');
  assert.equal(config.maxBodyLength, 900);
  assert.equal('unknown' in config, false);
});

test('masking never returns the full key and publicConfig never carries keys', () => {
  const key = 'TEST_DEVICE_KEY_1234567890';
  const masked = maskDeviceKey(key);
  assert.notEqual(masked, key);
  assert.equal(masked.includes(key), false);
  const config = normalizeConfig({ deviceKeys: [key] }).config;
  const view = publicConfig(config);
  assert.equal('deviceKeys' in view, false);
  assert.equal(view.deviceKeyCount, 1);
  assert.deepEqual(view.deviceKeysMasked, [masked]);
  assert.equal(JSON.stringify(view).includes(key), false);
});
