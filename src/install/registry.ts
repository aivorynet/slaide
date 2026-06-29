// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// One adapter per supported AI coding CLI: where its skill files live, how to drop them, and
// how to register the slaide MCP server. New CLI = one entry here. MCP registration shells out
// to the CLI's own `mcp add` so the CLI merges its own config (we never hand-edit and clobber).
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { CliSpec, DetectedCli } from './detect.js';
import { copyDir, mergePointerFile } from './skills.js';

export type Scope = 'project' | 'global';

export interface InstallContext {
  scope: Scope;
  projectDir: string; // resolved; the install root for scope 'project' and the MCP cwd
  homeDir: string;
  skillName: string;
  skillSrcDir: string;
  dryRun: boolean;
}

export interface SkillInstallResult {
  installed: boolean;
  dest: string;
  files: number;
  notes: string[];
}

export interface McpRegisterResult {
  registered: boolean;
  method: 'cli' | 'file' | 'skipped';
  detail: string;
}

export interface CliAdapter {
  id: string;
  displayName: string;
  spec: CliSpec;
  /** Where SKILL.md lands for this scope (a folder, or a file for rule-based CLIs). */
  skillTarget(ctx: InstallContext): string;
  installSkill(ctx: InstallContext): SkillInstallResult;
  registerMcp(ctx: InstallContext, detected: DetectedCli | null): McpRegisterResult;
}

const isWin = process.platform === 'win32';
const SENTINEL = '<!-- slaide-skill -->';
const MCP_ARGS = ['npx', '-y', '@aivorynet/slaide', 'mcp']; // the stdio MCP launcher, shared by all CLIs

/** Run a CLI subcommand (e.g. `claude mcp add ...`), routing .cmd shims through cmd on Windows. */
function runCli(bin: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = isWin
    ? spawnSync('cmd', ['/c', bin, ...args], { encoding: 'utf8', cwd, windowsHide: true, timeout: 20000 })
    : spawnSync(bin, args, { encoding: 'utf8', cwd, timeout: 20000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, out };
}

/** Copy the skill folder; the common case for skills-folder CLIs. */
function copySkill(ctx: InstallContext, dest: string, notes: string[] = []): SkillInstallResult {
  const r = copyDir(ctx.skillSrcDir, dest, ctx.dryRun);
  return { installed: true, dest, files: r.files, notes };
}

/** Register via the CLI's own `mcp add`. cmdArgs is everything after the binary. */
function mcpViaCli(detected: DetectedCli | null, cmdArgs: string[], ctx: InstallContext): McpRegisterResult {
  if (!detected) return { registered: false, method: 'skipped', detail: 'CLI not detected' };
  if (ctx.dryRun) return { registered: true, method: 'cli', detail: `${detected.bin} ${cmdArgs.join(' ')}` };
  const cwd = ctx.scope === 'project' ? ctx.projectDir : undefined;
  const r = runCli(detected.bin, cmdArgs, cwd);
  return r.ok
    ? { registered: true, method: 'cli', detail: 'mcp add' }
    : { registered: false, method: 'cli', detail: r.out.split(/\r?\n/)[0] || 'mcp add failed' };
}

const claude: CliAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  spec: { id: 'claude', displayName: 'Claude Code', binaries: ['claude', 'claude.cmd', 'claude.exe'], versionFlag: '--version', installHint: 'npm i -g @anthropic-ai/claude-code' },
  skillTarget(ctx) {
    const base = ctx.scope === 'project' ? ctx.projectDir : ctx.homeDir;
    return join(base, '.claude', 'skills', ctx.skillName);
  },
  installSkill(ctx) {
    return copySkill(ctx, this.skillTarget(ctx));
  },
  registerMcp(ctx, detected) {
    const scope = ctx.scope === 'project' ? 'project' : 'user';
    return mcpViaCli(detected, ['mcp', 'add', ctx.skillName, '-s', scope, '--', ...MCP_ARGS], ctx);
  },
};

const codex: CliAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  spec: { id: 'codex', displayName: 'Codex CLI', binaries: ['codex', 'codex.cmd', 'codex.exe'], versionFlag: '--version', installHint: 'npm i -g @openai/codex' },
  skillTarget(ctx) {
    const base = ctx.scope === 'project' ? ctx.projectDir : ctx.homeDir;
    return join(base, '.codex', 'skills', ctx.skillName);
  },
  installSkill(ctx) {
    const dest = this.skillTarget(ctx);
    const notes: string[] = [];
    if (ctx.scope === 'project') {
      const block = `slaide deck authoring. See .codex/skills/${ctx.skillName}/SKILL.md`;
      if (mergePointerFile(join(ctx.projectDir, 'AGENTS.md'), block, SENTINEL, ctx.dryRun)) notes.push('AGENTS.md pointer added');
    }
    return copySkill(ctx, dest, notes);
  },
  registerMcp(ctx, detected) {
    // codex stores MCP servers globally (~/.codex/config.toml); there is no per-project scope.
    const r = mcpViaCli(detected, ['mcp', 'add', ctx.skillName, '--', ...MCP_ARGS], ctx);
    if (r.registered && ctx.scope === 'project') r.detail = 'mcp add (codex registers globally)';
    return r;
  },
};

const gemini: CliAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  spec: { id: 'gemini', displayName: 'Gemini CLI', binaries: ['gemini', 'gemini.cmd', 'gemini.exe'], versionFlag: '--version', installHint: 'npm i -g @google/gemini-cli' },
  skillTarget(ctx) {
    const base = ctx.scope === 'project' ? ctx.projectDir : ctx.homeDir;
    return join(base, '.gemini', 'skills', ctx.skillName);
  },
  installSkill(ctx) {
    const dest = this.skillTarget(ctx);
    const res = copySkill(ctx, dest);
    // GEMINI.md imports context with @path; point it at the freshly copied SKILL.md.
    const mdFile = ctx.scope === 'project' ? join(ctx.projectDir, 'GEMINI.md') : join(ctx.homeDir, '.gemini', 'GEMINI.md');
    const importPath = './' + relative(join(mdFile, '..'), join(dest, 'SKILL.md')).split('\\').join('/');
    const block = `slaide deck authoring. See @${importPath}`;
    if (mergePointerFile(mdFile, block, SENTINEL, ctx.dryRun)) res.notes.push('GEMINI.md pointer added');
    return res;
  },
  registerMcp(ctx, detected) {
    const scope = ctx.scope === 'project' ? 'project' : 'user';
    return mcpViaCli(detected, ['mcp', 'add', ctx.skillName, '-s', scope, '-t', 'stdio', ...MCP_ARGS], ctx);
  },
};

// Cursor uses project rule files (.cursor/rules/*.mdc) and a JSON MCP config; no `mcp add` CLI.
const cursor: CliAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  spec: { id: 'cursor', displayName: 'Cursor', binaries: ['cursor-agent', 'cursor-agent.cmd', 'agent', 'agent.exe'], versionFlag: '--version', installHint: 'https://cursor.com' },
  skillTarget(ctx) {
    return join(ctx.projectDir, '.cursor', 'rules', `${ctx.skillName}.mdc`);
  },
  installSkill(ctx) {
    const dest = this.skillTarget(ctx);
    const body = readFileSync(join(ctx.skillSrcDir, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
    const mdc = `---\ndescription: Author and render slaide presentations\nglobs: ["**/*.slaide", "**/*.slaide.yaml", "**/*.slaidec"]\nalwaysApply: false\n---\n${body}`;
    if (!ctx.dryRun) {
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, mdc, 'utf8');
    }
    return { installed: true, dest, files: 1, notes: [] };
  },
  registerMcp(ctx, detected) {
    return mcpFileJson(join(ctx.scope === 'project' ? ctx.projectDir : ctx.homeDir, '.cursor', 'mcp.json'), ctx);
  },
};

// Aider has no skills/MCP concept; it reads CONVENTIONS.md. Drop the skill and point at it.
const aider: CliAdapter = {
  id: 'aider',
  displayName: 'Aider',
  spec: { id: 'aider', displayName: 'Aider', binaries: ['aider', 'aider.exe'], versionFlag: '--version', installHint: 'pip install aider-chat' },
  skillTarget(ctx) {
    return join(ctx.projectDir, '.aider', 'skills', ctx.skillName);
  },
  installSkill(ctx) {
    const dest = this.skillTarget(ctx);
    const res = copySkill(ctx, dest);
    const block = `slaide deck authoring. See .aider/skills/${ctx.skillName}/SKILL.md`;
    if (mergePointerFile(join(ctx.projectDir, 'CONVENTIONS.md'), block, SENTINEL, ctx.dryRun)) res.notes.push('CONVENTIONS.md pointer added');
    return res;
  },
  registerMcp() {
    return { registered: false, method: 'skipped', detail: 'aider has no MCP support' };
  },
};

/** Merge an mcpServers entry into a JSON config (read-modify-write, preserving other keys). */
function mcpFileJson(file: string, ctx: InstallContext): McpRegisterResult {
  if (ctx.dryRun) return { registered: true, method: 'file', detail: file };
  try {
    const obj = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8') || '{}') : {};
    obj.mcpServers = obj.mcpServers || {};
    obj.mcpServers[ctx.skillName] = { command: 'npx', args: ['-y', '@aivorynet/slaide', 'mcp'] };
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    return { registered: true, method: 'file', detail: file };
  } catch (e) {
    return { registered: false, method: 'file', detail: (e as Error).message };
  }
}

export const ADAPTERS: CliAdapter[] = [claude, codex, gemini, cursor, aider];

export function allSpecs(): CliSpec[] {
  return ADAPTERS.map((a) => a.spec);
}

export function getAdapter(id: string): CliAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
