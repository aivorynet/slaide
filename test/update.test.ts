// Update-notifier throttle tests: a FAILED registry check must not consume the daily slot
// (regression — it used to write lastCheck on failure, so one timeout/5xx silenced retries
// for 24h). A failed check gets a short cooldown instead; a successful check keeps the
// 24-hour throttle.
import { test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybeNotifyUpdate } from '../src/update.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const tmps: string[] = [];
let home: string;
const stateFile = (): string => join(home, 'update-check.json');
const readState = (): Record<string, unknown> => JSON.parse(readFileSync(stateFile(), 'utf8'));
const writeState = (s: Record<string, unknown>): void => {
  mkdirSync(home, { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(s));
};

// The notifier only runs on an interactive TTY outside CI — fake that for the suite.
const origIsTTY = process.stderr.isTTY;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'slaide-update-'));
  tmps.push(home);
  vi.stubEnv('SLAIDE_HOME', home);
  vi.stubEnv('SLAIDE_NO_UPDATE', '');
  vi.stubEnv('NO_UPDATE_NOTIFIER', '');
  vi.stubEnv('SLAIDE_AUTO_UPDATE', '');
  vi.stubEnv('CI', '');
  (process.stderr as unknown as { isTTY: boolean }).isTTY = true;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  (process.stderr as unknown as { isTTY: boolean | undefined }).isTTY = origIsTTY;
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const fetchOk = (version: string) =>
  vi.fn(async () => ({ ok: true, json: async () => ({ version }) }));

test('a network failure does not consume the daily slot', async () => {
  const f = vi.fn(async () => {
    throw new Error('timeout');
  });
  vi.stubGlobal('fetch', f);
  await maybeNotifyUpdate('1.0.0');
  expect(f).toHaveBeenCalledTimes(1);
  const st = readState();
  expect(st.lastCheck).toBeUndefined();
  expect(typeof st.lastFail).toBe('number');
});

test('a 5xx response does not consume the daily slot', async () => {
  const f = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  vi.stubGlobal('fetch', f);
  await maybeNotifyUpdate('1.0.0');
  expect(f).toHaveBeenCalledTimes(1);
  const st = readState();
  expect(st.lastCheck).toBeUndefined();
  expect(typeof st.lastFail).toBe('number');
});

test('a fresh failure cools down — the next command does not stall on a fetch', async () => {
  writeState({ lastFail: Date.now() });
  const f = fetchOk('9.9.9');
  vi.stubGlobal('fetch', f);
  await maybeNotifyUpdate('1.0.0');
  expect(f).not.toHaveBeenCalled();
});

test('after the failure cooldown the check retries, and a success restores the daily throttle', async () => {
  writeState({ lastFail: Date.now() - 2 * HOUR });
  const f = fetchOk('9.9.9');
  vi.stubGlobal('fetch', f);
  await maybeNotifyUpdate('1.0.0');
  expect(f).toHaveBeenCalledTimes(1);
  const st = readState();
  expect(typeof st.lastCheck).toBe('number');
  expect(st.lastFail).toBeUndefined();
  expect(st.latest).toBe('9.9.9');
  const printed = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
  expect(printed).toContain('9.9.9');
});

test('a successful check keeps the 24-hour throttle', async () => {
  writeState({ lastCheck: Date.now() - HOUR, latest: '1.0.0' });
  const f = fetchOk('9.9.9');
  vi.stubGlobal('fetch', f);
  await maybeNotifyUpdate('1.0.0');
  expect(f).not.toHaveBeenCalled();
});

test('a stale successful check re-fetches after 24 hours', async () => {
  writeState({ lastCheck: Date.now() - DAY - HOUR, latest: '1.0.0' });
  const f = fetchOk('9.9.9');
  vi.stubGlobal('fetch', f);
  await maybeNotifyUpdate('1.0.0');
  expect(f).toHaveBeenCalledTimes(1);
  expect(readState().latest).toBe('9.9.9');
});

test('a first-run failure writes no lastCheck at all', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
  await maybeNotifyUpdate('1.0.0');
  expect(existsSync(stateFile())).toBe(true);
  expect(readState().lastCheck).toBeUndefined();
});
