// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Front-matter / config-block parsing helpers.
import yaml from 'js-yaml';

const FENCE = /^---\s*$/;

/** Is a text block "config-like" (a simple YAML mapping of key: value lines)? */
export function isConfigLike(text: string): boolean {
  const lines = text.split('\n');
  let sawKey = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    // key:  or  ~key:  (cascade prefix) optionally indented; also list/scalar
    // continuations of a previous key are allowed (start with - or whitespace).
    if (/^[~]?[A-Za-z_][\w-]*\s*:/.test(line)) {
      sawKey = true;
      continue;
    }
    if (/^-\s/.test(line)) continue; // yaml list item
    return false;
  }
  return sawKey;
}

/** Parse a YAML mapping, tolerating the `~key` cascade prefix (kept verbatim).
 *  On malformed YAML, `onError` is invoked with the parser message (the config is no
 *  longer silently swallowed) and an empty mapping is returned. */
export function parseConfig(text: string, onError?: (message: string) => void): Record<string, unknown> {
  if (text.trim() === '') return {};
  try {
    const obj = yaml.load(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return {};
  } catch (e) {
    onError?.((e as Error).message.split('\n')[0]);
    return {};
  }
}

export { FENCE };
