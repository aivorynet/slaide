// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// `slaide install`: detect the AI coding CLIs on this machine, let the user pick, copy the
// slaide authoring skill into each, and (opt-out) register the slaide MCP server. Interactive
// when run in a terminal; fully flag-driven (--cli/--scope/--skills/--mcp/--yes/--list/--json)
// for scripts and CI. No third-party deps: prompts use node:readline/promises.
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { detectClis, type DetectedCli } from './detect.js';
import { ADAPTERS, allSpecs, getAdapter, type CliAdapter, type InstallContext, type Scope } from './registry.js';
import { skillSourceDir, readSkillName, coreRoot } from './skills.js';

export interface InstallOptions {
  cli?: string[]; // explicit CLI ids; undefined -> interactive select / all detected
  scope: Scope;
  projectDir: string;
  skills: boolean | undefined; // undefined -> ask (interactive) / default true (--yes)
  mcp: boolean | undefined; // undefined -> ask / default true; false via --no-mcp
  yes: boolean;
  list: boolean;
  dryRun: boolean;
  json: boolean;
}

/** Map --scope (project|global|<dir>) onto a scope + install root. */
export function parseScopeArg(value: string | undefined, cwd: string): { scope: Scope; projectDir: string } {
  if (!value || value === 'project') return { scope: 'project', projectDir: cwd };
  if (value === 'global') return { scope: 'global', projectDir: cwd };
  return { scope: 'project', projectDir: resolve(value) }; // a path -> project install into it
}

export function listDetected(): DetectedCli[] {
  return detectClis(allSpecs());
}

function isInteractive(opts: InstallOptions): boolean {
  return !!process.stdin.isTTY && !opts.yes;
}

async function ask(question: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptSelect(detected: DetectedCli[]): Promise<DetectedCli[]> {
  console.log('Detected AI coding CLIs:');
  detected.forEach((d, i) => console.log(`  ${i + 1}) ${d.displayName}  (${d.version.split(/\s/)[0]})`));
  const ans = await ask('Install for which? (comma-separated numbers, or "all"): ');
  if (!ans || /^all$/i.test(ans)) return detected;
  const picks = ans
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n >= 1 && n <= detected.length)
    .map((n) => detected[n - 1]);
  return picks.length ? picks : detected;
}

async function promptYesNo(question: string, def: boolean): Promise<boolean> {
  const ans = await ask(`${question} ${def ? '[Y/n]' : '[y/N]'} `);
  if (!ans) return def;
  return /^y/i.test(ans);
}

/** Is a Playwright Chromium build present? slaide uses it for export and the shoot/montage see-it loop. */
async function chromiumPresent(): Promise<boolean> {
  try {
    const pw: any = await import('playwright');
    const p: string = pw.chromium.executablePath();
    return !!p && existsSync(p);
  } catch {
    return false;
  }
}

/** Chromium powers PDF/PPTX/image export and `shoot --montage` (the image an agent reads to SEE
 *  the deck). If it is missing, say why and offer to install it. */
async function maybeOfferChromium(opts: InstallOptions): Promise<void> {
  if (await chromiumPresent()) return;
  const cmd = 'npx playwright install chromium';
  console.log('');
  console.log('Chromium is not installed. slaide needs it to export PDF / PPTX / images and to run');
  console.log('`slaide shoot --montage` — the contact sheet an agent reads to SEE the rendered deck.');
  const run = opts.yes || (isInteractive(opts) && (await promptYesNo('Install Chromium now?', true)));
  if (!run) {
    console.log(`Install it later with: ${cmd}`);
    return;
  }
  console.log(`Running: ${cmd}`);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (r.status !== 0) console.log(`Chromium install did not finish. Run it manually: ${cmd}`);
}

interface Chosen {
  adapter: CliAdapter;
  detected: DetectedCli | null;
}

/** Resolve which adapters to act on, from --cli or an interactive pick. */
async function chooseClis(opts: InstallOptions, detected: DetectedCli[]): Promise<Chosen[]> {
  if (opts.cli && opts.cli.length) {
    return opts.cli.map((id) => {
      const adapter = getAdapter(id);
      if (!adapter) throw new Error(`unknown CLI "${id}". Known: ${ADAPTERS.map((a) => a.id).join(', ')}`);
      return { adapter, detected: detected.find((d) => d.id === id) ?? null };
    });
  }
  if (!detected.length) throw new Error('no supported AI coding CLIs detected. Pass --cli <id> to install anyway.');
  const picks = isInteractive(opts) ? await promptSelect(detected) : detected;
  return picks.map((d) => ({ adapter: getAdapter(d.id)!, detected: d }));
}

export async function runInstall(opts: InstallOptions): Promise<number> {
  // Detection probes every CLI with `--version` (slow). Skip it when the CLIs are named
  // explicitly and MCP registration is off, since a skill copy needs no detection.
  const needDetect = opts.list || !(opts.cli && opts.cli.length) || opts.mcp !== false;
  const detected = needDetect ? listDetected() : [];

  if (opts.list) {
    console.log(JSON.stringify(detected, null, 2));
    return 0;
  }

  let chosen: Chosen[];
  try {
    chosen = await chooseClis(opts, detected);
  } catch (e) {
    console.error('error: ' + (e as Error).message);
    return 1;
  }

  // Decide skill + MCP once for the whole run.
  let doSkills = opts.skills;
  if (doSkills === undefined) doSkills = isInteractive(opts) ? await promptYesNo('Install the slaide authoring skill?', true) : true;
  let doMcp = opts.mcp;
  if (doMcp === undefined) doMcp = isInteractive(opts) ? await promptYesNo('Register the slaide MCP server?', true) : true;

  const skillSrcDir = skillSourceDir();
  const skillName = readSkillName(skillSrcDir);
  const homeDir = homedir();

  const summary: any[] = [];
  for (const { adapter, detected: det } of chosen) {
    let packageVersion = '0.0.0';
    try {
      packageVersion = JSON.parse(readFileSync(join(coreRoot(), 'package.json'), 'utf8')).version ?? '0.0.0';
    } catch { /* marker just gets a placeholder; refresh adopts it on the next real version */ }
    const ctx: InstallContext = { scope: opts.scope, projectDir: opts.projectDir, homeDir, skillName, skillSrcDir, packageVersion, dryRun: opts.dryRun };
    const row: any = { cli: adapter.id, displayName: adapter.displayName, detected: needDetect ? !!det : null };
    if (doSkills) {
      const r = adapter.installSkill(ctx);
      row.skill = { dest: r.dest, files: r.files, notes: r.notes };
    }
    if (doMcp) {
      const r = adapter.registerMcp(ctx, det);
      row.mcp = { registered: r.registered, method: r.method, detail: r.detail };
    }
    summary.push(row);
  }

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const row of summary) {
      const tag = opts.dryRun ? '[dry-run] ' : '';
      console.log(`${tag}${row.displayName}${row.detected === false ? ' (not detected)' : ''}`);
      if (row.skill) console.log(`  skill -> ${row.skill.dest} (${row.skill.files} files)${row.skill.notes.length ? '; ' + row.skill.notes.join('; ') : ''}`);
      if (row.mcp) console.log(`  mcp   -> ${row.mcp.registered ? 'registered (' + row.mcp.method + ')' : 'skipped: ' + row.mcp.detail}`);
    }
  }
  if (!opts.json && !opts.dryRun) await maybeOfferChromium(opts);
  return 0;
}
