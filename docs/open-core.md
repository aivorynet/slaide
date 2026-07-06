# Open core

Slaide is open core, in the spirit of GitLab CE/EE. The engine and tooling are genuinely open
source. A small commercial layer funds the work. This page draws the line so nothing is a
surprise.

## What's free (this repository, Apache-2.0)

Everything you need to write, present, and move decks:

- the `.slaide` language, parser, compiler, and renderer;
- the navigable web deck and high-fidelity PDF;
- export to HTML, PDF, and editable PPTX;
- import from PowerPoint and Keynote in cross-platform `reconstruct` mode;
- the native read-only viewer (open, present, export);
- the MCP server and the agent skill;
- `.slaidec` packing and unpacking, and the `compare` fidelity tool.

Build all of it from source and use it forever, for anything, under Apache-2.0.

## What's Pro (commercial)

Two capabilities, unlocked by a license:

1. **In-app WYSIWYG editing.** Edit text and regions directly in the viewer and save back to
   the `.slaide` source. Insert elements from the editing bar. The Properties pane formats the
   selected element (fill, border, shadow, effects, custom CSS, master style classes, entrance
   animation), or with nothing selected edits the slide itself (type, layout, background,
   transition, variant) from the master.
2. **High-fidelity import.** The `hybrid` and `exact-raster` fidelities, which drive PowerPoint
   over COM to reproduce charts, SmartArt, and custom geometry pixel-perfectly. The free
   `reconstruct` import covers the common case cross-platform.

## How it fits together (and why your clone has no paid code)

There are two runtimes behind one experience. The **render runtime** — the open engine plus the
native viewer chrome — renders a present-only deck and is what ships publicly (npm and the GitHub
Release). The **editor runtime** — the Pro engine on the desktop, and the hosted engine-server in
the cloud product — is the same render runtime plus the licensed editor, and is never published
here. The open engine exposes two inert seams, a render extension point (`src/render/inject.ts`)
and an import rasterizer (`src/import/raster-extension.ts`). They do nothing until a host registers
something. The open build registers nothing.

The official prebuilt binary (the GitHub Release on this repo, which `slaide app`/`slaide
upgrade` from the npm CLI, the standalone installers, and the viewer's own Sign-in all fetch)
is compiled from a private superset that registers the editor and the COM rasterizer, but only
when a valid license is present. With no license it behaves identically to
the open viewer built from this repo. One binary serves everyone. The license is the only
difference.

The open viewer reaches that same superset on demand: clicking **Sign in** downloads the
prebuilt Pro engine and swaps it in (verified by checksum + signature), then signs in against
it. So the app you download becomes editing-capable once you sign in with a license — you do
not need a different download. The Pro engine is fetched as a prebuilt binary, never built from
this repo.

The Pro source (the editor, the COM importer, the license check) lives in a private repository
and is never published here. That is the structural guarantee: a clone of this repo cannot
build an editing-capable Slaide, because the code is simply not present. There is nothing to
patch out.

## License and the editing feature

The open core is Apache-2.0. You can run it, change it, and ship it freely.

Editing is different. The editor engine is proprietary and is not in this repository. The open
viewer only carries the Edit and Save controls and the wiring that talks to the engine. It
cannot edit on its own. In-app editing works only with the official Slaide Pro binary and a
valid license. Enabling or using the Pro editing capability without a valid license, including
bypassing the license check, is not permitted under the Pro commercial terms.

## Pricing

Pro and Hosted are paid. Plans and prices live at [getslaide.com](https://getslaide.com). The
open core stays free.

## Our commitment

`core/` stays Apache-2.0, permanently. We will not relicense the open core or move free
features behind the paywall. New Pro features are additive.
