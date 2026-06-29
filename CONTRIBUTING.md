# Contributing

Issues and PRs welcome.

```bash
npm install
npm test            # vitest
npx tsc --noEmit    # typecheck
```

- Source in `src/` (parser → compiler → render). Language is defined in `docs/` — keep `docs/spec.md`, `docs/themes.md`, and `docs/grammar.md` in sync with any syntax change, then run `npx tsx scripts/sync-skill.ts` to regenerate the bundled skill docs.
- Add a test for new syntax in `test/`.

By contributing you agree your contributions are licensed under Apache-2.0.
