# Contributing

Issues and PRs welcome.

```bash
npm install
npm test            # vitest
npx tsc --noEmit    # typecheck
```

- Source in `src/` (parser → compiler → render). The language's token sets (transitions, entrances, frontmatter keys, span/slot classes, fences, placeholders, diagnostic codes) are centralized in `src/vocab.ts`; the human docs live in `docs/` (`spec.md`, `themes.md`, `grammar.md`). After any syntax change, update `src/vocab.ts` + the docs, then run `npx tsx scripts/dev/sync-skill.ts` to regenerate the bundled skill. `test/docs-sync.test.ts` fails if a token is undocumented, a doc is missing, or the skill bundle is stale — so drift can't ship.
- Add a test for new syntax in `test/`.

By contributing you agree your contributions are licensed under Apache-2.0.
