// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Embed the deck's web fonts into the .pptx so it renders correctly on a machine that does not
// have them installed. PowerPoint embeds raw TTF/OTF (it rejects woff2 — what the browser
// actually downloads), so we re-fetch the Google Fonts CSS with a LEGACY User-Agent (which makes
// Google serve `.ttf` URLs), download each face, and splice the OOXML embedded-font parts into
// the generated zip in one pass (mirroring inject-anim.ts).
//
// PowerPoint holds at most four faces per typeface (regular/bold/italic/boldItalic). A deck that
// uses several weights of one family (e.g. Inter 400/500/600/700/800) collapses to two upright
// slots: runs are emitted bold when weight ≥ 600 (see pptx.ts), so 400/500 use `regular` and
// 600/700/800 use `bold`. Best-effort throughout: any network failure logs a warning and returns
// the deck unchanged rather than failing the export.
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

/** Reduce all fetched faces of a family to the four slots PowerPoint can embed. */
function pickSlots(faces: Face[]): Map<string, Partial<Record<SlotName, Face>>> {
  const byFamily = new Map<string, Face[]>();
  for (const f of faces) (byFamily.get(f.family) ?? byFamily.set(f.family, []).get(f.family)!).push(f);

  const nearest = (list: Face[], target: number): Face | undefined =>
    list.length ? list.reduce((a, b) => (Math.abs(b.weight - target) < Math.abs(a.weight - target) ? b : a)) : undefined;

  const out = new Map<string, Partial<Record<SlotName, Face>>>();
  for (const [family, fs] of byFamily) {
    const upright = fs.filter((f) => !f.italic);
    const ital = fs.filter((f) => f.italic);
    const regular = nearest(upright, 400);
    const bold = nearest(upright.filter((f) => f.weight >= 600).length ? upright.filter((f) => f.weight >= 600) : upright, 700);
    const italic = nearest(ital, 400);
    const boldItalic = nearest(ital.filter((f) => f.weight >= 600).length ? ital.filter((f) => f.weight >= 600) : ital, 700);
    out.set(family, {
      regular,
      bold: bold && bold !== regular ? bold : undefined,
      italic,
      boldItalic: boldItalic && boldItalic !== italic ? boldItalic : undefined,
    });
  }
  return out;
}

/** Family names requested in the Google Fonts CSS URLs (for the export summary log). */
function requestedFamilies(cssUrls: string[]): string[] {
  const fams = new Set<string>();
  for (const u of cssUrls) {
    for (const m of u.matchAll(/[?&]family=([^&:@]+)/g)) {
      try { fams.add(decodeURIComponent(m[1]).replace(/\+/g, ' ')); } catch { fams.add(m[1]); }
    }
  }
  return [...fams];
}

/**
 * Embed the fonts referenced by `fontImports` (Google Fonts CSS URLs) into a pptx buffer.
 * Returns the buffer unchanged when there's nothing to embed or any fetch fails.
 * Emits one '[pptx-fonts]' summary line per export so silent degradation is visible in logs.
 */
export async function embedFonts(pptxBuf: Buffer, fontImports: string[]): Promise<Buffer> {
  const cssUrls = fontImports.filter((u) => /fonts\.googleapis\.com/.test(u));
  if (!cssUrls.length) return pptxBuf;
  const families = requestedFamilies(cssUrls);
  const fam = families.join(',') || '(none)';

  let faces: Face[] = [];
  try {
    for (const url of cssUrls) faces.push(...parseFaces(await fetchText(url)));
    if (!faces.length) {
      // The legacy-Android UA usually coaxes .ttf URLs out of Google Fonts, but some
      // proxies/CDNs special-case it. One retry with a plain non-browser UA before giving up.
      for (const url of cssUrls) faces.push(...parseFaces(await fetchText(url, 'slaide-export/1.0')));
      if (faces.length) console.warn(`[pptx-fonts] legacy-UA CSS fetch parsed 0 ttf faces; plain-UA retry parsed ${faces.length}`);
    }
  } catch (e) {
    console.warn(`[pptx-fonts] embed skipped (could not fetch font CSS): ${(e as Error).message} | families=${fam}`);
    return pptxBuf;
  }
  const slots = pickSlots(faces);

  // flatten to the faces we will download, deduped by url
  const chosen: { family: string; slot: SlotName; face: Face }[] = [];
  for (const [family, s] of slots) for (const slot of SLOTS) if (s[slot]) chosen.push({ family, slot, face: s[slot]! });
  if (!chosen.length) {
    console.warn(`[pptx-fonts] embed skipped (no embeddable ttf faces) | families=${fam} facesParsed=${faces.length} downloaded=0 bytesEmbedded=0`);
    return pptxBuf;
  }

  try {
    const cache = new Map<string, Promise<Buffer>>();
    await Promise.all(
      chosen.map(async (c) => {
        let p = cache.get(c.face.url);
        if (!p) cache.set(c.face.url, (p = fetchBin(c.face.url)));
        c.face.data = await p;
      }),
    );
  } catch (e) {
    console.warn(`[pptx-fonts] embed skipped (could not download fonts): ${(e as Error).message} | families=${fam} facesParsed=${faces.length}`);
    return pptxBuf;
  }
  const dl = chosen.filter((c) => c.face.data && c.face.data.length > 0);
  if (!dl.length) {
    console.warn(`[pptx-fonts] embed skipped (all font downloads empty) | families=${fam} facesParsed=${faces.length} downloaded=0 bytesEmbedded=0`);
    return pptxBuf;
  }
  const bytes = dl.reduce((n, c) => n + c.face.data!.length, 0);
  console.warn(`[pptx-fonts] embedding | families=${fam} facesParsed=${faces.length} downloaded=${dl.length} bytesEmbedded=${bytes}`);

  const zip = await JSZip.loadAsync(pptxBuf);

  // 1. write font parts and assign relationship ids (above pptxgenjs's existing rIds)
  const relsPath = 'ppt/_rels/presentation.xml.rels';
  let rels = await zip.file(relsPath)!.async('string');
  let maxId = 0;
  for (const m of rels.matchAll(/Id="rId(\d+)"/g)) maxId = Math.max(maxId, parseInt(m[1], 10));

  const relAdds: string[] = [];
  const byFamilyRids = new Map<string, Partial<Record<SlotName, string>>>();
  let n = 0;
  for (const c of dl) {
    const file = `font${++n}.fntdata`;
    zip.file(`ppt/fonts/${file}`, c.face.data!);
    const rid = `rId${++maxId}`;
    relAdds.push(`<Relationship Id="${rid}" Type="${FONT_REL}" Target="fonts/${file}"/>`);
    const m = byFamilyRids.get(c.family) ?? byFamilyRids.set(c.family, {}).get(c.family)!;
    m[c.slot] = rid;
  }
  zip.file(relsPath, rels.replace('</Relationships>', relAdds.join('') + '</Relationships>'));

  // 2. content-type default for .fntdata
  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath)!.async('string');
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
        return `<p:embeddedFont><p:font typeface="${family}"/>${inner}</p:embeddedFont>`;
      })
      .join('') +
    '</p:embeddedFontLst>';
  pres = pres.includes('<p:defaultTextStyle')
    ? pres.replace('<p:defaultTextStyle', efl + '<p:defaultTextStyle')
    : pres.replace('</p:presentation>', efl + '</p:presentation>');
  zip.file(presPath, pres);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}
