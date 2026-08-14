// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Embed the deck's web fonts into the .pptx so it renders correctly on a machine that does not
// have them installed. PowerPoint embeds raw TTF/OTF (it rejects woff2 — what the browser
// actually downloads), so we re-fetch the Google Fonts CSS with a LEGACY User-Agent (which makes
// Google serve `.ttf` URLs), download each face, and splice the OOXML embedded-font parts into
// the generated zip in one pass (mirroring inject-anim.ts).
//
// Two rules decide what may be embedded; break either and PowerPoint reports an error on open
// and silently drops the font:
//
//  1. ONLY FONTS THE DECK USES. A family declared in the master but referenced by no run must not
//     reach <p:embeddedFontLst>. We read the used typefaces back out of the generated zip
//     (<a:latin typeface="…"> in slides/layouts/masters/theme) and intersect with the Google
//     families, so a `mono:` role no slot ever uses is never embedded.
//  2. ONLY RIBBI-NAMED FACES, IN THE SLOT THEIR OWN NAME TABLE DECLARES. PowerPoint holds exactly
//     four faces per typeface — regular/bold/italic/boldItalic — and matches each one by the
//     font's INTERNAL family name plus its head.macStyle bits. Google's static TTF for weight 600
//     is named "JetBrains Mono SemiBold" / Regular, so parking it in the <p:bold> slot of
//     "JetBrains Mono" is the exact mismatch PowerPoint rejects. We therefore re-request the
//     canonical 400/700 (+ italics, only when the deck has italic runs), then verify every
//     download's name table before it is written.
//
// Weights with no slot (300/500/600/800 …) collapse: runs are emitted bold at weight >= 600 (see
// pptx.ts), so every upright run lands on either the 400 or the 700 face. A deck set in Inter 300
// therefore exports as Inter 400 — a deliberate, documented substitution, because a font renamed
// to occupy a slot it does not belong in is what makes PowerPoint throw.
//
// Best-effort throughout: any network failure logs a warning and returns the deck unchanged
// rather than failing the export. Hosted exports still default embedding OFF
// (SLAIDE_PPTX_EMBED_FONTS, see engine-server/exports.ts) — that switch guards a separate
// PowerPoint 2410 wrap-repeat regression, not this code.
import JSZip from 'jszip';

interface Face {
  family: string;
  weight: number;
  italic: boolean;
  url: string;
  data?: Buffer;
}

type SlotName = 'regular' | 'bold' | 'italic' | 'boldItalic';
const SLOTS: SlotName[] = ['regular', 'bold', 'italic', 'boldItalic'];
/** The only four faces PowerPoint can hold, as Google Fonts `ital,wght` axis values. */
const RIBBI: { slot: SlotName; ital: 0 | 1; wght: 400 | 700 }[] = [
  { slot: 'regular', ital: 0, wght: 400 },
  { slot: 'bold', ital: 0, wght: 700 },
  { slot: 'italic', ital: 1, wght: 400 },
  { slot: 'boldItalic', ital: 1, wght: 700 },
];

// A pre-woff2 UA so Google Fonts serves direct TrueType (.ttf) URLs — for every requested
// weight — instead of woff2 (which PowerPoint rejects). An old-Android UA is the sweet spot:
// MSIE-era UAs get the obfuscated /l/font loader and only weight 400; modern UAs get woff2.
const LEGACY_UA = 'Mozilla/5.0 (Linux; U; Android 4.4; en-us) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0';
const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';

/** Parse @font-face blocks from a Google Fonts CSS payload into ttf face descriptors. */
function parseFaces(css: string): Face[] {
  const faces: Face[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const block = m[1];
    const family = block.match(/font-family:\s*['"]?([^;'"]+)['"]?/)?.[1];
    const weight = parseInt(block.match(/font-weight:\s*(\d+)/)?.[1] ?? '400', 10);
    const italic = /font-style:\s*italic/.test(block);
    // A .ttf extension is the common Google-Fonts shape, but some responses carry
    // extensionless URLs marked format('truetype') — accept those too.
    const url =
      block.match(/src:\s*url\(([^)]+\.ttf)\)/)?.[1] ??
      block.match(/src:\s*url\(([^)]+)\)\s*format\(\s*['"]?truetype['"]?\s*\)/)?.[1];
    if (family && url) faces.push({ family: family.trim(), weight, italic, url: url.replace(/['"]/g, '') });
  }
  return faces;
}

async function fetchText(url: string, ua: string = LEGACY_UA): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': ua } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}
async function fetchBin(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------------------------------------------------------------------------------------------
// sfnt inspection — what a downloaded face says about ITSELF (PowerPoint believes this, not us)
// ---------------------------------------------------------------------------------------------

interface Identity {
  family: string; // name ID 1, the family PowerPoint matches a run's <a:latin typeface> against
  slot: SlotName; // derived from head.macStyle, i.e. the slot the face belongs in
  restricted: boolean; // OS/2 fsType says "no embedding"
  postscriptOutlines: boolean; // 'OTTO' — PowerPoint refuses to embed PostScript-flavoured fonts
}

/** Read a TrueType/OpenType face's identity, or null when it isn't an sfnt we can embed. */
function identify(buf: Buffer): Identity | null {
  if (buf.length < 12) return null;
  const tag = buf.readUInt32BE(0);
  const OTTO = 0x4f54544f;
  // 0x00010000 = TrueType outlines, 'true' = legacy Mac TrueType, 'OTTO' = CFF outlines.
  if (tag !== 0x00010000 && tag !== 0x74727565 && tag !== OTTO) return null;
  const numTables = buf.readUInt16BE(4);
  if (12 + numTables * 16 > buf.length) return null;
  const tables = new Map<string, { off: number; len: number }>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.set(buf.toString('latin1', o, o + 4), { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) });
  }

  const name = tables.get('name');
  const head = tables.get('head');
  if (!name || !head || name.off + 6 > buf.length || head.off + 46 > buf.length) return null;

  // name ID 1, preferring the Windows (platform 3) record PowerPoint reads.
  let family = '';
  let familyPlatform = -1;
  const count = buf.readUInt16BE(name.off + 2);
  const strBase = name.off + buf.readUInt16BE(name.off + 4);
  for (let i = 0; i < count; i++) {
    const r = name.off + 6 + i * 12;
    if (r + 12 > buf.length) break;
    const platform = buf.readUInt16BE(r);
    const nameId = buf.readUInt16BE(r + 6);
    const len = buf.readUInt16BE(r + 8);
    const off = strBase + buf.readUInt16BE(r + 10);
    if (nameId !== 1 || off + len > buf.length) continue;
    if (family && platform !== 3) continue; // a Windows record already won
    let s = '';
    if (platform === 3 || platform === 0) {
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(buf.readUInt16BE(off + k)); // UTF-16BE
    } else {
      s = buf.toString('latin1', off, off + len);
    }
    if (s.trim() && (platform === 3 || familyPlatform < 0)) {
      family = s.trim();
      familyPlatform = platform;
    }
  }
  if (!family) return null;

  const macStyle = buf.readUInt16BE(head.off + 44);
  const bold = (macStyle & 1) !== 0;
  const italic = (macStyle & 2) !== 0;
  const os2 = tables.get('OS/2');
  const fsType = os2 && os2.off + 10 <= buf.length ? buf.readUInt16BE(os2.off + 8) : 0;

  return {
    family,
    slot: bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular',
    restricted: (fsType & 0x0002) !== 0,
    postscriptOutlines: tag === OTTO,
  };
}

// ---------------------------------------------------------------------------------------------
// what the generated deck actually references
// ---------------------------------------------------------------------------------------------

/** Family names requested in the Google Fonts CSS URLs (i.e. the embeddable candidates). */
function requestedFamilies(cssUrls: string[]): string[] {
  const fams = new Set<string>();
  for (const u of cssUrls) {
    for (const m of u.matchAll(/[?&]family=([^&:@]+)/g)) {
      try { fams.add(decodeURIComponent(m[1]).replace(/\+/g, ' ')); } catch { fams.add(m[1]); }
    }
  }
  return [...fams];
}

/** Typefaces referenced by the generated parts, plus whether any run is italic. */
async function usedInDeck(zip: JSZip): Promise<{ typefaces: Set<string>; italic: boolean }> {
  const typefaces = new Set<string>();
  let italic = false;
  const parts = Object.keys(zip.files).filter((p) =>
    /^ppt\/(slides|slideLayouts|slideMasters|notesSlides|theme)\/[^/]+\.xml$/.test(p),
  );
  for (const p of parts) {
    const xml = await zip.file(p)!.async('string');
    // Only <a:latin> — <a:font script="…"> is the theme's per-script fallback table (Ebrima,
    // Nirmala UI, …), which pptxgenjs emits wholesale and the deck never uses.
    for (const m of xml.matchAll(/<a:latin[^>]*\stypeface="([^"]*)"/g)) {
      const t = m[1].trim();
      if (t && !t.startsWith('+')) typefaces.add(t);
    }
    if (!italic && /^ppt\/slides\//.test(p) && /<a:rPr[^>]*\si="1"/.test(xml)) italic = true;
  }
  return { typefaces, italic };
}

// ---------------------------------------------------------------------------------------------
// face resolution
// ---------------------------------------------------------------------------------------------

const cssUrlFor = (family: string, specs: { ital: 0 | 1; wght: number }[]) =>
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}` +
  `:ital,wght@${specs.map((s) => `${s.ital},${s.wght}`).join(';')}`;

/**
 * Ask Google Fonts for a family's canonical RIBBI faces. One combined request, then a per-face
 * retry for anything missing — Google answers 400 for a weight a family does not have, which
 * would otherwise take the whole family down with it.
 */
async function ribbiFaces(family: string, wantItalic: boolean): Promise<Face[]> {
  const wanted = RIBBI.filter((r) => wantItalic || r.ital === 0);
  const found = new Map<string, Face>(); // `${ital},${wght}` -> face
  const key = (f: Face) => `${f.italic ? 1 : 0},${f.weight}`;
  try {
    for (const f of parseFaces(await fetchText(cssUrlFor(family, wanted)))) found.set(key(f), f);
  } catch { /* fall through to the per-face retries */ }
  for (const w of wanted) {
    if (found.has(`${w.ital},${w.wght}`)) continue;
    try {
      for (const f of parseFaces(await fetchText(cssUrlFor(family, [w])))) found.set(key(f), f);
    } catch { /* this family has no such face — leave the slot empty */ }
  }
  return [...found.values()];
}

/**
 * Embed the fonts referenced by `fontImports` (Google Fonts CSS URLs) into a pptx buffer.
 * Returns the buffer unchanged when there's nothing to embed or any fetch fails.
 * Emits one '[pptx-fonts]' summary line per export so silent degradation is visible in logs.
 */
export async function embedFonts(pptxBuf: Buffer, fontImports: string[]): Promise<Buffer> {
  const cssUrls = fontImports.filter((u) => /fonts\.googleapis\.com/.test(u));
  if (!cssUrls.length) return pptxBuf;
  const declared = requestedFamilies(cssUrls);
  const fam = declared.join(',') || '(none)';

  const zip = await JSZip.loadAsync(pptxBuf);
  const { typefaces, italic } = await usedInDeck(zip);
  // Match case-insensitively, but embed under the name the runs actually carry.
  const lower = new Map([...typefaces].map((t) => [t.toLowerCase(), t]));
  const families = declared.map((d) => lower.get(d.trim().toLowerCase())).filter((x): x is string => !!x);
  const unused = declared.filter((d) => !lower.has(d.trim().toLowerCase()));
  if (!families.length) {
    console.warn(`[pptx-fonts] embed skipped (no declared family is used by any run) | declared=${fam}`);
    return pptxBuf;
  }

  // Resolve, download and verify the four slots per used family.
  const picked = new Map<string, Partial<Record<SlotName, Buffer>>>();
  const rejected: string[] = [];
  for (const family of families) {
    let faces: Face[];
    try {
      faces = await ribbiFaces(family, italic);
    } catch (e) {
      console.warn(`[pptx-fonts] embed skipped (could not fetch font CSS): ${(e as Error).message} | families=${fam}`);
      return pptxBuf;
    }
    const slots: Partial<Record<SlotName, Buffer>> = {};
    await Promise.all(
      faces.map(async (f) => {
        try { f.data = await fetchBin(f.url); } catch { /* verified below */ }
      }),
    );
    for (const f of faces) {
      const label = `${family} ${f.italic ? 'italic ' : ''}${f.weight}`;
      if (!f.data?.length) { rejected.push(`${label}: download failed`); continue; }
      const id = identify(f.data);
      if (!id) { rejected.push(`${label}: not an embeddable sfnt`); continue; }
      if (id.postscriptOutlines) { rejected.push(`${label}: PostScript outlines`); continue; }
      if (id.restricted) { rejected.push(`${label}: fsType forbids embedding`); continue; }
      // THE check: PowerPoint matches an embedded face by its own name table. "Inter SemiBold"
      // is a different typeface to PowerPoint, not a bold "Inter" — embedding it under Inter's
      // <p:bold> is what makes PowerPoint report an error and drop the family.
      if (id.family.toLowerCase() !== family.toLowerCase()) {
        rejected.push(`${label}: names itself "${id.family}"`);
        continue;
      }
      if (!slots[id.slot]) slots[id.slot] = f.data;
    }
    if (slots.regular || slots.bold || slots.italic || slots.boldItalic) picked.set(family, slots);
    else rejected.push(`${family}: no usable face`);
  }

  const chosen = [...picked.entries()].flatMap(([family, s]) =>
    SLOTS.filter((slot) => s[slot]).map((slot) => ({ family, slot, data: s[slot]! })),
  );
  if (!chosen.length) {
    console.warn(`[pptx-fonts] embed skipped (no embeddable ttf faces) | used=${families.join(',')} | ${rejected.join('; ')}`);
    return pptxBuf;
  }
  const bytes = chosen.reduce((n, c) => n + c.data.length, 0);
  console.warn(
    `[pptx-fonts] embedding | used=${families.join(',')} unused=${unused.join(',') || '-'} italic=${italic}` +
      ` faces=${chosen.map((c) => `${c.family}/${c.slot}`).join(',')} bytesEmbedded=${bytes}` +
      (rejected.length ? ` rejected=${rejected.join('; ')}` : ''),
  );

  // 1. write font parts and assign relationship ids (above pptxgenjs's existing rIds)
  const relsPath = 'ppt/_rels/presentation.xml.rels';
  const rels = await zip.file(relsPath)!.async('string');
  let maxId = 0;
  for (const m of rels.matchAll(/Id="rId(\d+)"/g)) maxId = Math.max(maxId, parseInt(m[1], 10));

  const relAdds: string[] = [];
  const byFamilyRids = new Map<string, Partial<Record<SlotName, string>>>();
  let n = 0;
  for (const c of chosen) {
    const file = `font${++n}.fntdata`;
    zip.file(`ppt/fonts/${file}`, c.data);
    const rid = `rId${++maxId}`;
    relAdds.push(`<Relationship Id="${rid}" Type="${FONT_REL}" Target="fonts/${file}"/>`);
    const m = byFamilyRids.get(c.family) ?? byFamilyRids.set(c.family, {}).get(c.family)!;
    m[c.slot] = rid;
  }
  zip.file(relsPath, rels.replace('</Relationships>', relAdds.join('') + '</Relationships>'));

  // 2. content-type default for .fntdata
  const ctPath = '[Content_Types].xml';
  const ct = await zip.file(ctPath)!.async('string');
  if (!/Extension="fntdata"/.test(ct)) {
    zip.file(ctPath, ct.replace('</Types>', '<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>'));
  }

  // 3. presentation.xml: enable embedding + add the embeddedFontLst (CT_Presentation requires it
  //    after sldSz/notesSz and before defaultTextStyle).
  const presPath = 'ppt/presentation.xml';
  let pres = await zip.file(presPath)!.async('string');
  pres = pres.replace(/saveSubsetFonts="1"/, 'saveSubsetFonts="0"');
  if (!/\bembedTrueTypeFonts=/.test(pres)) {
    pres = pres.replace(/<p:presentation\b([^>]*)>/, (_full, attrs) => `<p:presentation${attrs} embedTrueTypeFonts="1">`);
  }
  const efl =
    '<p:embeddedFontLst>' +
    [...byFamilyRids.entries()]
      .map(([family, m]) => {
        const inner = SLOTS.filter((s) => m[s]).map((s) => `<p:${s} r:id="${m[s]}"/>`).join('');
        return `<p:embeddedFont><p:font typeface="${family}" pitchFamily="2" charset="0"/>${inner}</p:embeddedFont>`;
      })
      .join('') +
    '</p:embeddedFontLst>';
  pres = pres.includes('<p:defaultTextStyle')
    ? pres.replace('<p:defaultTextStyle', efl + '<p:defaultTextStyle')
    : pres.replace('</p:presentation>', efl + '</p:presentation>');
  zip.file(presPath, pres);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}
