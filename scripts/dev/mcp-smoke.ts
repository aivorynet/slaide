// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Smoke-test the MCP server over stdio: list tools/resources, scaffold + validate.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/cli.ts', 'mcp'] });
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));
const resources = await client.listResources();
console.log('resources:', resources.resources.map((r) => r.uri).join(', '));

const scaffold = await client.callTool({ name: 'slaide_scaffold', arguments: { title: 'Smoke Test', outline: ['A', 'B'] } });
const src = (scaffold.content as any)[0].text as string;
console.log('scaffold length:', src.length);

const valid = await client.callTool({ name: 'slaide_validate', arguments: { source: src } });
console.log('validate:', (valid.content as any)[0].text.slice(0, 120));

await client.close();
console.log('MCP smoke OK');
