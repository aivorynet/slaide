// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// @slaide/mcp — MCP server over slaide. Thin: every tool calls core.
// Exposes the language spec + theme catalog as Resources so agents pull grammar
// on demand, and enforces validate-before-render in the tool descriptions.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  validateSource,
  renderDeckHtml,
  renderPdfFromHtmlPublic,
  listThemes,
  getSpec,
  getThemeSchema,
} from '../index.js';
import { scaffoldDeck } from '../scaffold.js';
import { ENTRANCE_NAMES, SLIDE_TRANSITION_NAMES } from '../render/anim.js';

function animSpec(): string {
  return (
    '# slaide animations\n\n' +
    'Pick effects **by name** — the runtime/CSS handles them, no code needed.\n\n' +
    '## Slide transitions\n' +
    'Set in slide frontmatter: `transition: <name>` (or `~transition:` to cascade).\n' +
    'Per-slide timing: `transition-ms: 600`, `transition-ease: ease-out`.\n\n' +
    SLIDE_TRANSITION_NAMES.map((n) => `- ${n}`).join('\n') +
    '\n\n## Element entrances (builds)\n' +
    'Append to a build step: `- point >>> <name>` with optional `delay=`, `dur=`, `ease=`\n' +
    '(e.g. `- point >>> zoom-in delay=150`). A bare `>>>` uses `fade-up`.\n\n' +
    ENTRANCE_NAMES.map((n) => `- ${n}`).join('\n') +
    '\n\nThemes may define more via the master `animations:` map (see slaide://themes).\n'
  );
}

function resolveSource(args: { source?: string; path?: string }): { source: string; dir: string } {
  if (args.source != null) return { source: args.source, dir: process.cwd() };
  if (args.path) return { source: readFileSync(args.path, 'utf8'), dir: dirname(resolve(args.path)) };
  throw new Error('Provide either `source` (deck text) or `path` (file path).');
}

function text(obj: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }], isError };
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'slaide', version: '1.0.0' },
    { instructions: 'Author and render slaide decks (HTML + PDF). Always slaide_validate before rendering; read the slaide://spec resource for grammar.' },
  );

  server.registerTool(
    'slaide_scaffold',
    {
      title: 'Scaffold a slaide deck',
      description: 'Create starter slaide source from a title and optional outline. Returns the deck text (write it to a .slaide file).',
      inputSchema: {
        title: z.string(),
        subtitle: z.string().optional(),
        outline: z.array(z.string()).optional(),
        master: z.string().optional().describe('Master path; omit for the bundled theme.'),
      },
    },
    async (a) => text(scaffoldDeck(a)),
  );

  server.registerTool(
    'slaide_validate',
    {
      title: 'Validate a slaide deck',
      description: 'Validate deck source against the language + theme. Returns {ok, diagnostics:[{severity,code,message,line}]}. ALWAYS call this before rendering and fix any errors.',
      inputSchema: { source: z.string().optional(), path: z.string().optional() },
    },
    async (a) => {
      const { source, dir } = resolveSource(a);
      const res = validateSource(source, dir);
      return text(res, !res.ok);
    },
  );

  server.registerTool(
    'slaide_render_html',
    {
      title: 'Render a slaide deck to HTML',
      description: 'Render to a self-contained, navigable HTML presentation (assets inlined). Writes to outPath and returns {outPath, slides, warnings}.',
      inputSchema: {
        source: z.string().optional(),
        path: z.string().optional(),
        outPath: z.string().describe('Output .html path.'),
      },
    },
    async (a) => {
      const { source, dir } = resolveSource(a);
      const { html, ir } = renderDeckHtml(source, dir, { mode: 'web', inline: true });
      mkdirSync(dirname(resolve(a.outPath)), { recursive: true });
      writeFileSync(a.outPath, html, 'utf8');
      return text({ outPath: a.outPath, slides: ir.slides.length, warnings: ir.warnings });
    },
  );

  server.registerTool(
    'slaide_render_pdf',
    {
      title: 'Render a slaide deck to PDF',
      description: 'Render to a paginated, high-fidelity PDF (one page per slide, builds settled). Needs Playwright. Writes to outPath and returns {outPath, slides}.',
      inputSchema: {
        source: z.string().optional(),
        path: z.string().optional(),
        outPath: z.string().describe('Output .pdf path.'),
      },
    },
    async (a) => {
      const { source, dir } = resolveSource(a);
      const { html, ir } = renderDeckHtml(source, dir, { mode: 'print', inline: true });
      mkdirSync(dirname(resolve(a.outPath)), { recursive: true });
      await renderPdfFromHtmlPublic(html, a.outPath);
      return text({ outPath: a.outPath, slides: ir.slides.length });
    },
  );

  server.registerTool(
    'slaide_list_themes',
    {
      title: 'List bundled themes',
      description: 'List available master themes and their layouts.',
      inputSchema: {},
    },
    async () => text(listThemes().map((t) => ({ name: t.name, layouts: t.layouts, description: t.description }))),
  );

  // Resources: the language spec + theme/layout catalog (pull grammar on demand).
  server.registerResource(
    'spec',
    'slaide://spec',
    { title: 'slaide language spec', description: 'The slaide authoring grammar.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, text: getSpec() }] }),
  );
  server.registerResource(
    'themes',
    'slaide://themes',
    { title: 'slaide theme/master guide', description: 'How to author a master + the layout catalog.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, text: getThemeSchema() }] }),
  );
  server.registerResource(
    'anim',
    'slaide://anim',
    { title: 'slaide animations', description: 'Named slide transitions + element entrances, reusable by name.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, text: animSpec() }] }),
  );

  server.registerPrompt(
    'new_deck',
    { title: 'Start a new deck', description: 'Template for authoring a new slaide deck.', argsSchema: { topic: z.string() } },
    ({ topic }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Read the slaide://spec resource, then write a slaide deck about "${topic}". Use the cover, section, title-content, two-cols and image-right layouts. Call slaide_validate, fix any errors, then slaide_render_html.`,
          },
        },
      ],
    }),
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
