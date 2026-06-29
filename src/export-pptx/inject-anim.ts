// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Post-process a pptxgenjs-generated .pptx (a zip) to add what pptxgenjs cannot emit:
// slide transitions and per-paragraph build (entrance) animations. We splice small XML
// fragments into each slide part rather than reparse it, because a full parse/serialize
// round-trip of the DrawingML pptxgenjs writes risks reordering or re-encoding nodes and
// corrupting an otherwise-valid deck.
//
// OOXML slide child order is fixed: cSld, clrMapOvr, transition, timing, extLst. So a
// <p:transition> is injected right after </p:clrMapOvr>, and <p:timing> right before
// </p:sld>; pptxgenjs emits no extLst on slides, so this keeps every slide schema-valid.
import JSZip from 'jszip';
import { transitionXml } from './transitions.js';

export interface TransitionSpec {
  name: string;
  durationMs?: number;
}

/** A text box that builds: one entry per paragraph, true if that paragraph reveals on click. */
export interface ShapeBuildSpec {
  pBuilds: boolean[];
}

/** Resolve slide part paths in presentation (deck) order, mirroring the importer. */
async function orderedSlidePaths(zip: JSZip): Promise<string[]> {
  const read = async (p: string): Promise<string> => {
    const f = zip.file(p);
    return f ? f.async('string') : '';
  };
  const pres = await read('ppt/presentation.xml');
  const rels = await read('ppt/_rels/presentation.xml.rels');
  const relMap: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
    relMap[m[1]] = m[2];
  }
  const paths: string[] = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const target = relMap[m[1]];
    if (target) paths.push('ppt/' + target.replace(/^\.\.\//, '').replace(/^\//, ''));
  }
  if (paths.length) return paths;
  // fallback: numeric slideN.xml order
  return Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10));
}

/** Per-slide animation to inject: a transition and/or the slide's build shapes. */
export interface SlideAnim {
  transition?: TransitionSpec;
  builds?: ShapeBuildSpec[]; // text boxes in text-region order; each with a per-paragraph reveal flag
}

/**
 * Inject transitions and per-paragraph builds into a pptx in a single zip pass (one
 * loadAsync/generateAsync), in deck-slide order. Transitions go after <p:clrMapOvr>, build
 * <p:timing> before </p:sld>, so the slide stays schema-valid. Build failures are swallowed
 * per slide so a build never corrupts an otherwise-valid slide.
 */
export async function injectAnim(pptxBuf: Buffer, anims: SlideAnim[], opts: { safe?: boolean } = {}): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptxBuf);
  const paths = await orderedSlidePaths(zip);
  for (let i = 0; i < paths.length; i++) {
    const a = anims[i];
    if (!a) continue;
    let xml = await zip.file(paths[i])!.async('string');
    let changed = false;

    if (a.transition && !xml.includes('<p:transition') && !xml.includes('mc:AlternateContent')) {
      const frag = transitionXml(a.transition.name, { durationMs: a.transition.durationMs, safe: opts.safe });
      if (frag) {
        xml = xml.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + frag);
        changed = true;
      }
    }

    if (a.builds && a.builds.length && !xml.includes('<p:timing')) {
      try {
        const spids = textSpids(xml);
        const shapes = a.builds
          .map((s, j) => ({
            spid: spids[j],
            paras: s.pBuilds.map((b, p) => (b ? p : -1)).filter((p) => p >= 0),
          }))
          .filter((s) => s.spid !== undefined && s.paras.length);
        const timing = timingXml(shapes);
        if (timing) {
          xml = xml.replace('</p:sld>', timing + '</p:sld>');
          changed = true;
        }
      } catch {
        // leave this slide's builds out rather than risk invalid XML
      }
    }

    if (changed) zip.file(paths[i], xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Transitions-only convenience wrapper (one zip pass). specs[i] applies to deck slide i. */
export function injectTransitions(pptxBuf: Buffer, specs: TransitionSpec[], opts: { safe?: boolean } = {}): Promise<Buffer> {
  return injectAnim(pptxBuf, specs.map((s) => ({ transition: s })), opts);
}

/** Builds-only convenience wrapper (one zip pass). buildSpecs[i] lists deck slide i's text boxes. */
export function injectBuilds(pptxBuf: Buffer, buildSpecs: ShapeBuildSpec[][]): Promise<Buffer> {
  return injectAnim(pptxBuf, buildSpecs.map((b) => ({ builds: b })));
}

/** Collect the shape ids of text-bearing <p:sp> shapes, in document (= add) order. */
function textSpids(slideXml: string): number[] {
  const ids: number[] = [];
  for (const m of slideXml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)) {
    const block = m[1];
    if (!block.includes('<a:t>')) continue; // a fill/border rect has no <a:t>
    const id = block.match(/<p:cNvPr\b[^>]*\bid="(\d+)"/);
    if (id) ids.push(parseInt(id[1], 10));
  }
  return ids;
}

let _idSeq = 0;
const nextId = (): number => ++_idSeq;

/** One click-reveal of a single paragraph (pRg st=end=para) of a shape, as a mainSeq <p:par>. */
function clickPar(spid: number, para: number): string {
  const a = nextId();
  const b = nextId();
  const c = nextId();
  const d = nextId();
  return (
    `<p:par><p:cTn id="${a}" fill="hold">` +
    `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="${b}" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="${c}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    `<p:set><p:cBhvr>` +
    `<p:cTn id="${d}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
    `<p:tgtEl><p:spTgt spid="${spid}"><p:txEl><p:pRg st="${para}" end="${para}"/></p:txEl></p:spTgt></p:tgtEl>` +
    `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>` +
    `</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>` +
    `</p:childTnLst></p:cTn></p:par>` +
    `</p:childTnLst></p:cTn></p:par>` +
    `</p:childTnLst></p:cTn></p:par>`
  );
}

/** Build the full <p:timing> for a slide given which paragraphs of which shapes reveal. */
function timingXml(shapes: { spid: number; paras: number[] }[]): string {
  const active = shapes.filter((s) => s.paras.length);
  if (!active.length) return '';
  _idSeq = 1; // tmRoot=1, mainSeq=2, then click effects
  const root = nextId(); // 1
  const main = nextId(); // 2
  const clicks = active.flatMap((s) => s.paras.map((p) => clickPar(s.spid, p))).join('');
  const bldp = active.map((s) => `<p:bldP spid="${s.spid}" grpId="0" build="p"/>`).join('');
  return (
    `<p:timing><p:tnLst>` +
    `<p:par><p:cTn id="${root}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${main}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
    clicks +
    `</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq>` +
    `</p:childTnLst></p:cTn></p:par>` +
    `</p:tnLst><p:bldLst>${bldp}</p:bldLst></p:timing>`
  );
}
