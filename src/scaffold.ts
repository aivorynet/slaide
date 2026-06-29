// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Deck scaffolding — shared by the CLI (`slaide new`) and the MCP server.
export interface ScaffoldOptions {
  title: string;
  subtitle?: string;
  /** Section/slide titles to stub out. */
  outline?: string[];
  /** Master reference; omit to use the bundled default theme. */
  master?: string;
}

export function scaffoldDeck(opts: ScaffoldOptions): string {
  const lines: string[] = [];
  lines.push('---');
  if (opts.master) lines.push(`master: ${opts.master}`);
  lines.push(`title: ${opts.title}`);
  lines.push('~transition: slide-left');
  lines.push('---');
  lines.push('layout: cover');
  lines.push('---');
  lines.push(':: title ::');
  lines.push(opts.title);
  lines.push(':: subtitle ::');
  lines.push(opts.subtitle ?? 'A presentation written in slaide');
  lines.push('');
  lines.push('??? Speaker notes for the opening slide.');

  for (const item of opts.outline ?? ['Overview', 'Details', 'Summary']) {
    lines.push('');
    lines.push('---');
    lines.push('layout: title-content');
    lines.push('---');
    lines.push(`## ${item}`);
    lines.push('');
    lines.push('- First point   >>>');
    lines.push('- Second point  >>>');
    lines.push('- Third point   >>>');
  }

  lines.push('');
  lines.push('---');
  lines.push('layout: section');
  lines.push('---');
  lines.push('# Thank you');
  lines.push('');
  return lines.join('\n') + '\n';
}
