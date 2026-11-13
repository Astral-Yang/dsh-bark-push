import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { buildChannelRequest, channelReady, channelTypeSummaries, ChannelSender } from '../lib/channels.js';
import { normalizeConfig, normalizeChannels, publicConfig, publicChannels } from '../lib/config.js';
import { apply } from '../lib/index.js';
import { nextConfigOverlay, ROUTES } from '../lib/http.js';
import { createBarkServer, createFakeCtx, tempDir, waitFor } from './helpers.js';

const NOTE = { title: '标题', body: '正文', kind: 'reply', url: 'https://dsh.example/?barkSession=s1' };

test('the registry offers only non-IM channels plus a generic webhook', () => {
  const types = channelTypeSummaries().map((entry) => entry.type).sort();
  assert.deepEqual(types, ['bark', 'gotify', 'ntfy', 'pushdeer', 'pushplus', 'serverchan', 'webhook']);
  for (const removed of ['telegram', 'dingtalk', 'feishu', 'wecom', 'slack', 'discord']) {
    assert.equal(types.includes(removed), false);
  }
  for (const summary of channelTypeSummaries()) {
    assert.equal(typeof summary.name, 'string');
    assert.ok(Array.isArray(summary.fields) && summary.fields.length > 0);
  }
});

test('gotify builds a tokenized message request', () => {
  const request = buildChannelRequest(
    { type: 'gotify', config: { server: 'https://gotify.example.com', token: 'tok', priority: '7' } },
    NOTE,
  );
  assert.equal(request.url, 'https://gotify.example.com/message?token=tok');
  assert.equal(request.method, 'POST');
  assert.equal(JSON.parse(request.body).priority, 7);
  assert.equal(JSON.parse(request.body).title, '标题');
});

test('ntfy publishes JSON with an optional bearer token', () => {
  const withToken = buildChannelRequest({ type: 'ntfy', config: { server: 'https://ntfy.sh', topic: 'alerts', token: 'tk_1' } }, NOTE);
  assert.equal(withToken.url, 'https://ntfy.sh');
  assert.equal(withToken.headers.authorization, 'Bearer tk_1');
  assert.equal(JSON.parse(withToken.body).topic, 'alerts');
  const noToken = buildChannelRequest({ type: 'ntfy', config: { server: 'https://ntfy.sh', topic: 'alerts', token: '' } }, NOTE);
  assert.equal('authorization' in noToken.headers, false);
});

test('pushdeer, serverchan, pushplus, and extra bark build their canonical payloads', () => {
  const pushdeer = buildChannelRequest({ type: 'pushdeer', config: { server: 'https://api2.pushdeer.com', pushKey: 'PDU1' } }, NOTE);
  assert.equal(pushdeer.url, 'https://api2.pushdeer.com/message/push');
  assert.equal(JSON.parse(pushdeer.body).pushkey, 'PDU1');

  const serverchan = buildChannelRequest({ type: 'serverchan', config: { sendKey: 'SCT1' } }, NOTE);
  assert.equal(serverchan.url, 'https://sctapi.ftqq.com/SCT1.send');
  assert.equal(serverchan.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(serverchan.body).get('title'), '标题');

  const pushplus = buildChannelRequest({ type: 'pushplus', config: { token: 'pp' } }, NOTE);
  assert.equal(pushplus.url, 'https://www.pushplus.plus/send');
  assert.equal(JSON.parse(pushplus.body).token, 'pp');

  const bark = buildChannelRequest({ type: 'bark', config: { server: 'https://bark.example.com/', deviceKey: 'k', group: 'G' } }, NOTE);
  assert.equal(bark.url, 'https://bark.example.com/push');
  assert.equal(JSON.parse(bark.body).device_key, 'k');
  assert.equal(JSON.parse(bark.body).url, NOTE.url);
});

test('the generic webhook substitutes placeholders, headers, and supports GET', () => {
  const post = buildChannelRequest(
    {
      type: 'webhook',
      config: {
        url: 'https://hook.example.com/push',
        method: 'POST',
        contentType: 'application/json',
        headers: '{"Authorization":"Bearer abc"}',
        bodyTemplate: '{"t":"{{title}}","b":"{{body}}","k":"{{kind}}"}',
      },
    },
    NOTE,
  );
  assert.equal(post.method, 'POST');
  assert.equal(post.headers['Authorization'], 'Bearer abc');
  const parsed = JSON.parse(post.body);
  assert.equal(parsed.t, '标题');
  assert.equal(parsed.b, '正文');
  assert.equal(parsed.k, 'reply');

  const get = buildChannelRequest(
    { type: 'webhook', config: { url: 'https://hook.example.com/push', method: 'GET', contentType: 'text/plain', bodyTemplate: 'title={{title}}' } },
    NOTE,
  );
  assert.equal(get.method, 'GET');
  assert.equal(get.body, undefined);
  assert.equal(get.url.includes('title='), true);
});

test('channelReady reports the first missing required field', () => {
  assert.deepEqual(channelReady({ type: 'gotify', config: { server: 'https://g', token: 't' } }), { ok: true });
  const missing = channelReady({ type: 'gotify', config: { server: 'https://g', token: '' } });
  assert.equal(missing.ok, false);
  assert.equal(typeof missing.missing, 'string');
});

test('normalizeChannels drops unknown types and keeps stored secrets when blank', () => {
  const base = [{ id: 'ch_a', type: 'gotify', label: '', enabled: true, config: { server: 'https://g', token: 'stored', priority: '5' } }];
  const warnings = [];
  const list = normalizeChannels(
    [
      { id: 'ch_a', type: 'gotify', config: { server: 'https://g2', token: '' } },
      { id: 'ch_b', type: 'mystery', config: {} },
    ],
    base,
    warnings,
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].config.token, 'stored');
  assert.equal(list[0].config.server, 'https://g2');
  assert.equal(warnings.some((line) => line.includes('mystery')), true);
});

test('publicConfig masks channel secrets and marks which are set', () => {
  const config = normalizeConfig({
    channels: [{ type: 'gotify', config: { server: 'https://g', token: 'super-secret', priority: '5' } }],
  }).config;
  const view = publicConfig(config);
  assert.equal(view.channels.length, 1);
  assert.equal(JSON.stringify(view).includes('super-secret'), false);
  assert.equal(view.channels[0].config.token, '');
  assert.equal(view.channels[0].secretsSet.token, true);
  assert.equal(view.channels[0].config.server, 'https://g');
  assert.deepEqual(publicChannels(config.channels)[0].secretsSet, { token: true });
});

/**
 * Fake fetch capturing calls and returning scripted HTTP responses.
 * @param {Array<{ status?: number, text?: string }>} responses - scripted replies.
 * @returns {{ calls: Array<object>, fetchImpl: typeof fetch }} capture + fetch.
 */
function fakeFetch(responses) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const scripted = responses[index] ?? responses.at(-1) ?? { status: 200, text: '' };
    index += 1;
    const status = scripted.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => scripted.text ?? '' };
  };
  return { calls, fetchImpl };
}

test('ChannelSender isolates per-channel failures and retries a 500', async () => {
  const config = normalizeConfig({
    maxRetries: 1,
    retryDelayMs: 50,
    timeoutMs: 2000,
    channels: [
      { id: 'ch_ok', type: 'gotify', config: { server: 'https://g', token: 't', priority: '5' } },
      { id: 'ch_bad', type: 'ntfy', config: { server: 'https://n', topic: 'x' } },
    ],
  }).config;
  const { calls, fetchImpl } = fakeFetch([
    { status: 200, text: '{"id":1}' }, // gotify ok
    { status: 500, text: 'boom' },     // ntfy attempt 1
    { status: 200, text: '{"id":2}' }, // ntfy attempt 2 (retry)
  ]);
  const sender = new ChannelSender({ getConfig: () => config, logger: { warn() {}, debug() {} }, fetchImpl, sleepImpl: async () => {}, random: () => 0 });
  const result = await sender.send(NOTE);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[1].ok, true);
  assert.equal(result.results[1].attempts, 2);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
});

test('ChannelSender skips an incomplete channel without calling fetch', async () => {
  const config = normalizeConfig({
    channels: [{ id: 'ch_x', type: 'gotify', config: { server: 'https://g', token: '' } }],
  }).config;
  const { calls, fetchImpl } = fakeFetch([]);
  const sender = new ChannelSender({ getConfig: () => config, logger: { warn() {}, debug() {} }, fetchImpl });
  assert.equal(sender.hasEnabled(), true);
  const result = await sender.send(NOTE);
  assert.equal(result.ok, false);
  assert.equal(result.results[0].skipped, true);
  assert.equal(calls.length, 0);
});

test('end-to-end: a webhook channel receives a reply notification', async () => {
  const server = await createBarkServer();
  const { dir, cleanup } = await tempDir();
  try {
    const ctx = createFakeCtx({ sessions: [{ id: 's1', header: { id: 's1', cwd: '/w', createdAt: Date.now() }, title: '会话一' }] });
    apply(ctx, {
      stateFile: join(dir, 'state.json'),
      channels: [{ id: 'ch_hook', type: 'webhook', enabled: true, config: { url: server.url, method: 'POST', contentType: 'application/json', bodyTemplate: '{"m":"{{body}}"}' } }],
    });
    const session = ctx.sessions.list()[0];
    ctx.emit('session/event', session, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '渠道投递测试' }] } } });
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
    await waitFor(() => server.requests.length === 1);
    assert.equal(String(server.requests[0].body.m).includes('渠道投递测试'), true);

    // The channel is exposed (masked) through the state endpoint and can be tested individually.
    const stateRoute = ctx.routes.find((entry) => entry.path === ROUTES.state);
    const state = await (await stateRoute.fetch(new Request(`http://localhost${ROUTES.state}`))).json();
    assert.equal(state.config.channels.length, 1);
    assert.equal(state.channelTypes.some((entry) => entry.type === 'webhook'), true);

    const testRoute = ctx.routes.find((entry) => entry.path === ROUTES.testChannel);
    const tested = await (await testRoute.fetch(new Request(`http://localhost${ROUTES.testChannel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-bark-action': '1' },
      body: JSON.stringify({ id: 'ch_hook' }),
    }))).json();
    assert.equal(tested.ok, true);
    assert.equal(server.requests.length, 2);
  } finally {
    await server.close();
    await cleanup();
  }
});

test('nextConfigOverlay preserves stored channel secrets and clears on an empty array', () => {
  const effective = {
    channels: [{ id: 'ch_a', type: 'gotify', label: '', enabled: true, config: { server: 'https://g', token: 'stored', priority: '5' } }],
  };
  const saved = nextConfigOverlay({}, {
    channels: [{ id: 'ch_a', type: 'gotify', enabled: true, config: { server: 'https://g2', token: '', priority: '5' } }],
  }, effective).overlay;
  assert.equal(saved.channels[0].config.token, 'stored');
  assert.equal(saved.channels[0].config.server, 'https://g2');
  const cleared = nextConfigOverlay({}, { channels: [] }, effective).overlay;
  assert.deepEqual(cleared.channels, []);
});
