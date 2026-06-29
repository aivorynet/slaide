# slaide-view

A native, double-clickable viewer/launcher for `.slaide` decks. It's a thin shell
over the bundled `slaide-engine` (the canonical renderer) shown in the OS webview —
so what you see is exactly what `slaide build`/`export` produce, with **no Node
required on the target machine**.

- View any `.slaide` deck in a native window (keyboard nav from the deck runtime:
  arrows / space / `Home` / `End` / `f` fullscreen / `n` notes / `?` help).
- Floating toolbar: **Open · Reload · Edit · Export HTML · Export PDF · Present**.
- **Edit** makes the deck's text regions directly editable in place (dashed outlines
  mark editable areas; orange = changed). **Save** writes the edits back to the
  `.slaide` source file (via the engine's `edit` command) and re-renders.
- **Export PDF** silently renders a real, multi-page PDF to a file you pick — via
  WebView2's `PrintToPdf` on the paginated print build (no print dialog, page size =
  the deck canvas). **Export HTML** writes the self-contained deck.
- Registers itself for the `.slaide` extension so double-click just works.

## Build

```bash
# from the repo root — builds the standalone engine (bun) + the Rust viewer (cargo)
npm run build:viewer
# → viewer/vendor/slaide-engine.exe   (self-contained renderer, no Node needed)
# → viewer/target/release/slaide-view.exe
```

Requirements: [Rust](https://rustup.rs) and [Bun](https://bun.sh) to build; on the
target machine only the **WebView2 runtime** (ships with Windows 11). Linux needs
`libwebkit2gtk-4.1`; macOS uses WKWebView (wrap the binary in a `.app` for
double-click + association).

## Distribute / run

Ship `slaide-view.exe` **next to** a `vendor/slaide-engine.exe` (or set the
`SLAIDE_ENGINE` env var to the engine path). The viewer looks for the engine next
to itself, in `./vendor`, and up to `../../vendor` (so it runs straight from the
build tree).

```bash
slaide-view.exe path\to\deck.slaide     # open a deck
slaide-view.exe                          # no arg → Open dialog
slaide-view.exe --register               # associate .slaide with this exe (per-user)
slaide-view.exe --unregister             # remove the association
```

After `--register`, double-clicking a `.slaide` file in Explorer opens it here.
A `.reg` fallback is in `assets/register-slaide.reg` (edit the paths first).

## Notes

- The exe is unsigned; on first run Windows SmartScreen may warn — choose
  *More info → Run anyway*.
- No-GUI fallback: `slaide view <deck>` (the Node CLI) opens the deck in your
  default browser, useful where no system webview is available.
