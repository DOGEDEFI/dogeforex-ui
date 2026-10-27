import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw new Error('Usage: node --env-file=.env scripts/sync-infomaniak-dns.mjs [--apply]');
const apply = args.includes('--apply');
const token = process.env.INFOMANIAK_API_TOKEN;
if (!token) throw new Error('INFOMANIAK_API_TOKEN is required in the local .env file');
const config = JSON.parse(await readFile(path.join(root, 'config/vercel-dns.json'), 'utf8'));
assert.equal(config.schema, 'imf.infomaniak-dns.v1');
assert(Array.isArray(config.records) && config.records.length > 0);
const allowedZones = new Set(['imf.li', 'doge.forex']);
const groups = new Map();
const desiredKeys = new Set();
const normalizedTarget = (value) => value.toLowerCase().replace(/\.$/, '');
for (const record of config.records) {
  assert(allowedZones.has(record.zone), `Unapproved DNS zone: ${record.zone}`);
  assert(['A', 'CNAME'].includes(record.type), `Unsupported DNS type: ${record.type}`);
  if (record.type === 'A') {
    assert(/^(\d{1,3}\.){3}\d{1,3}$/.test(record.target), `Invalid IPv4 target for ${record.zone} ${record.source}`);
    assert(record.target.split('.').every((part) => Number(part) <= 255));
  } else {
    assert(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/.test(record.target), `Invalid CNAME target for ${record.zone} ${record.source}`);
  }
  assert(/^\.$|^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(record.source), `Invalid DNS source: ${record.source}`);
  assert(Number.isInteger(record.ttl) && record.ttl >= 60 && record.ttl <= 86400);
  const key = `${record.zone}|${record.source}|${record.type}|${normalizedTarget(record.target)}`;
  assert(!desiredKeys.has(key), `Duplicate desired record: ${key}`);
  desiredKeys.add(key);
  const groupKey = `${record.zone}|${record.source}`;
  if (!groups.has(groupKey)) groups.set(groupKey, { zone: record.zone, source: record.source, desired: [] });
  groups.get(groupKey).desired.push(record);
}
for (const group of groups.values()) {
  assert(new Set(group.desired.map((record) => record.type)).size === 1, `Mixed address types requested for ${group.source}.${group.zone}`);
}

async function request(method, pathname, body) {
  const response = await fetch(`https://api.infomaniak.com${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : { result: response.ok ? 'success' : 'error' };
  if (!response.ok || !['success', 'asynchronous'].includes(result.result)) {
    throw new Error(`${method} ${pathname}: HTTP ${response.status}; ${JSON.stringify(result.error || result.result)}`);
  }
  return result.data;
}

const zones = new Map();
for (const zone of allowedZones) {
  const records = await request('GET', `/2/zones/${zone}/records`);
  assert(Array.isArray(records), `Expected a record array for ${zone}`);
  zones.set(zone, records);
}

const actions = [];
for (const group of groups.values()) {
  const sameName = zones.get(group.zone).filter((record) => record.source.toLowerCase() === group.source.toLowerCase());
  const remaining = sameName.filter((record) => ['A', 'AAAA', 'CNAME'].includes(record.type));
  const unmatchedDesired = [];
  for (const desired of group.desired) {
    const index = remaining.findIndex((existing) => existing.type === desired.type && normalizedTarget(existing.target) === normalizedTarget(desired.target));
    if (index < 0) {
      unmatchedDesired.push(desired);
      continue;
    }
    const [existing] = remaining.splice(index, 1);
    actions.push({ action: existing.ttl === desired.ttl ? 'keep' : 'update', ...desired, id: existing.id });
  }
  if (remaining.length > unmatchedDesired.length) {
    actions.push({
      action: 'review-extra',
      zone: group.zone,
      source: group.source,
      existing: remaining.map(({ id, type, target }) => ({ id, type, target })),
      desired: group.desired.map(({ type, target }) => ({ type, target })),
    });
    continue;
  }
  for (const existing of remaining) {
    const desired = unmatchedDesired.shift();
    if (existing.type === desired.type) {
      actions.push({ action: 'update', ...desired, id: existing.id });
    } else if (config.replaceAddressRecords === true) {
      actions.push({ action: 'delete', zone: group.zone, source: group.source, type: existing.type, target: existing.target, ttl: existing.ttl, id: existing.id });
      actions.push({ action: 'create', ...desired });
    } else {
      actions.push({ action: 'review-type-change', zone: group.zone, source: group.source, existing: { type: existing.type, target: existing.target }, desired });
    }
  }
  for (const desired of unmatchedDesired) actions.push({ action: 'create', ...desired });
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', actions }, null, 2));
const blocked = actions.filter((entry) => entry.action.startsWith('review-'));
if (blocked.length) throw new Error('DNS conflicts require explicit review; no records were changed');
if (!apply) {
  console.log('Dry run only. Re-run with --apply after reviewing this exact change set.');
} else {
  for (const action of actions) {
    if (action.action === 'keep') continue;
    if (action.action === 'create') {
      await request('POST', `/2/zones/${action.zone}/records`, { source: action.source, type: action.type, target: action.target, ttl: action.ttl });
    } else if (action.action === 'update') {
      await request('PUT', `/2/zones/${action.zone}/records/${action.id}`, { target: action.target, ttl: action.ttl });
    } else if (action.action === 'delete') {
      await request('DELETE', `/2/zones/${action.zone}/records/${action.id}`);
    }
    console.log(JSON.stringify({ applied: action.action, zone: action.zone, source: action.source, type: action.type, target: action.target, ttl: action.ttl }));
  }
  for (const group of groups.values()) {
    const records = await request('GET', `/2/zones/${group.zone}/records`);
    const actual = records.filter((record) => record.source.toLowerCase() === group.source.toLowerCase() && ['A', 'AAAA', 'CNAME'].includes(record.type));
    assert.equal(actual.length, group.desired.length, `Unexpected address-record count for ${group.source}.${group.zone}`);
    for (const desired of group.desired) {
      const matching = actual.filter((record) => record.type === desired.type && normalizedTarget(record.target) === normalizedTarget(desired.target));
      assert.equal(matching.length, 1, `Expected one ${desired.type} target for ${desired.source}.${desired.zone}`);
      assert.equal(matching[0].ttl, desired.ttl);
    }
  }
  console.log(JSON.stringify({ ok: true, verifiedRecords: config.records.length, unrelatedRecordsChanged: false }));
}
