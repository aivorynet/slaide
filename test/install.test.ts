// Installer tests: skill source resolution, real CLI detection (gated on what is installed
// here), and skill landing in the right per-CLI location. MCP is left off so no test ever
// mutates real user config.
import { test, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClis } from '../src/install/detect.js';
import { runInstall, parseScopeArg } from '../src/install/index.js';
import { allSpecs, getAdapter } from '../src/install/registry.js';
import { skillSourceDir } from '../src/install/skills.js';

const tmps: string[] = [];
const mk = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'slaide-install-'));
  tmps.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

// Detect once; the suite stays green on a bare machine but verifies the real CLIs here.
const detected = detectClis(allSpecs());

test('skill source resolves and has SKILL.md', () => {
  expect(existsSync(join(skillSourceDir(), 'SKILL.md'))).toBe(true);
});

test('parseScopeArg maps project / global / path', () => {
  expect(parseScopeArg('global', '/cwd').scope).toBe('global');
  expect(parseScopeArg(undefined, '/cwd')).toEqual({ scope: 'project', projectDir: '/cwd' });
  expect(parseScopeArg('project', '/cwd').scope).toBe('project');
});

test('skillTarget maps project + global per CLI', () => {
  const a = getAdapter('claude')!;
  const base = { homeDir: 'HOME', projectDir: 'PROJ', skillName: 'slaide', skillSrcDir: 'S', dryRun: true } as const;
  expect(a.skillTarget({ ...base, scope: 'project' })).toContain('PROJ');
  expect(a.skillTarget({ ...base, scope: 'global' })).toContain('HOME');
});

test.skipIf(detected.length === 0)(
  'detects the AI coding CLIs installed on this machine',
  () => {
    const ids = detected.map((d) => d.id);
    // This machine has Claude Code, Codex, and Gemini installed.
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).toContain('gemini');
    for (const d of detected) expect(d.version.trim().length).toBeGreaterThan(0);
  },
  30000,
);

for (const [id, rel] of [
  ['claude', '.claude/skills/slaide'],
  ['codex', '.codex/skills/slaide'],
  ['gemini', '.gemini/skills/slaide'],
] as const) {
  test(
    `install --cli ${id} lands the skill files`,
    async () => {
      const dir = mk();
      const code = await runInstall({
        cli: [id],
        scope: 'project',
        projectDir: dir,
        skills: true,
        mcp: false,
        yes: true,
        list: false,
        dryRun: false,
        json: true,
      });
      expect(code).toBe(0);
      const dest = join(dir, rel);
      expect(existsSync(join(dest, 'SKILL.md'))).toBe(true);
      expect(existsSync(join(dest, 'reference.md'))).toBe(true);
      expect(existsSync(join(dest, 'examples'))).toBe(true);
      expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toMatch(/name:\s*slaide/);
    },
    30000,
  );
}

test('gemini install writes a merged GEMINI.md pointer', async () => {
  const dir = mk();
  await runInstall({ cli: ['gemini'], scope: 'project', projectDir: dir, skills: true, mcp: false, yes: true, list: false, dryRun: false, json: true });
  expect(readFileSync(join(dir, 'GEMINI.md'), 'utf8')).toContain('.gemini/skills/slaide/SKILL.md');
}, 30000);

test('second run is idempotent and keeps the files', async () => {
  const dir = mk();
  const opts = { cli: ['claude'], scope: 'project' as const, projectDir: dir, skills: true, mcp: false, yes: true, list: false, dryRun: false, json: true };
  await runInstall(opts);
  await runInstall(opts);
  expect(readdirSync(join(dir, '.claude/skills/slaide')).length).toBeGreaterThan(3);
}, 30000);

test('dry-run writes nothing', async () => {
  const dir = mk();
  await runInstall({ cli: ['claude'], scope: 'project', projectDir: dir, skills: true, mcp: false, yes: true, list: false, dryRun: true, json: true });
  expect(existsSync(join(dir, '.claude'))).toBe(false);
}, 30000);

test('--list prints a valid JSON array', async () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const code = await runInstall({ scope: 'project', projectDir: mk(), skills: undefined, mcp: undefined, yes: true, list: true, dryRun: false, json: true });
  const printed = spy.mock.calls.map((c) => String(c[0])).join('\n');
  spy.mockRestore();
  expect(code).toBe(0);
  expect(Array.isArray(JSON.parse(printed))).toBe(true);
}, 30000);
