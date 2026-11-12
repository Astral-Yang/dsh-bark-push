/**
 * Fast smoke check: the package exports a loadable host entry and the client
 * half is a ModuleLoader bundle with the expected id. Run with `npm run
 * test:smoke`; the full suite lives under test/.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const host = await import(join(root, 'lib', 'index.js'));
assert.equal(host.name, 'dsh-bark-push');
assert.equal(typeof host.apply, 'function');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(host.VERSION, pkg.version);

const client = await readFile(join(root, 'lib', 'client.js'), 'utf8');
assert.equal(client.includes('window.__ModuleLoader__.load'), true);
assert.equal(client.includes('id: "dsh-bark-push"'), true);

console.log('smoke ok: host entry and client bundle are present');
