#!/usr/bin/env bash
# Paywall + brand leak scan. Fails (non-zero exit) if any forbidden editing-feature or
# brand/IP token appears in the open-source tree. Runs as the FIRST CI job and as the
# final gate of the mirror-export before anything is published.
#
# Two passes:
#   * EDITOR-IMPLEMENTATION / IP tokens — case-insensitive. These name the *Pro editor
#     engine* (its JS/CSS, the patch types + apply logic, its in-deck DOM classes) and must
#     never appear in the open tree. The open viewer's own chrome (the Edit/Save buttons,
#     the `slv-*` viewer classes, and the `render --editable` / `edit --patch` IPC it sends
#     to whatever engine is configured) is intentionally OSS and is NOT listed here — it
#     no-ops without the licensed Pro engine, which is the only thing that implements editing.
#   * BRAND / provenance tokens — case-sensitive. We block AI-authorship provenance
#     (`Claude-Session` commit trailers, the `claude.ai` URL), NOT product names: the open
#     install registry legitimately names Claude Code / Codex / Gemini as install targets.
set -euo pipefail

ROOT="${1:-.}"

EDIT_PATTERN='__SLAIDE_EDITOR__|__slaideInsertImage|EDITOR_JS|EDIT_CSS|loadEditor|\bRegionPatch\b|applyPatches|patchDeckFile|\bdata-dirty\b|\bsl-editing\b|\bsl-placing\b|\bsl-cf-|insert-region|\bcontenteditable="|aivory-guard|jenni brehm'
BRAND_PATTERN='claude\.ai|Claude-Session'

EXC_RG=( -g '!node_modules' -g '!dist' -g '!out' -g '!**/target/**' -g '!viewer/vendor'
         -g '!pro/**' -g '!release/**' -g '!.git' -g '!.claude/**'
         -g '!*.png' -g '!*.jpg' -g '!*.jpeg' -g '!*.ico' -g '!*.rgba' -g '!*.pdf'
         -g '!scripts/ci/leak-scan.sh' -g '!**/mirror-export.ts' -g '!test/render.test.ts'
         -g '!src/render/runtime.ts' )

fail=0
if command -v rg >/dev/null 2>&1; then
  rg -n --hidden -i "${EXC_RG[@]}" -e "$EDIT_PATTERN" "$ROOT" && fail=1 || true
  rg -n --hidden    "${EXC_RG[@]}" -e "$BRAND_PATTERN" "$ROOT" && fail=1 || true
else
  EXC_GREP=( --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=out
             --exclude-dir=target --exclude-dir=vendor --exclude-dir=pro --exclude-dir=release --exclude-dir=.git --exclude-dir=.claude
             --exclude='*.png' --exclude='*.jpg' --exclude='*.jpeg' --exclude='*.ico' --exclude='*.rgba' --exclude='*.pdf'
             --exclude='leak-scan.sh' --exclude='mirror-export.ts' --exclude='render.test.ts'
             --exclude='runtime.ts' )
  grep -rnI  "${EXC_GREP[@]}" -iE -e "$EDIT_PATTERN" "$ROOT" && fail=1 || true
  grep -rnI  "${EXC_GREP[@]}"  -E -e "$BRAND_PATTERN" "$ROOT" && fail=1 || true
fi

if [ "$fail" -ne 0 ]; then
  echo "LEAK: forbidden editing/brand token found in the open-source tree." >&2
  exit 1
fi
echo "leak-scan: clean ✓"
