// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Integrity + authenticity checks for downloaded release assets. SHA-256 is always enforced;
// minisign (Ed25519) is enforced once a real signing key is configured below. This mirrors the
// native viewer's verifier (core/viewer/src/upgrade.rs) byte-for-byte so the CLI and the viewer
// trust the same key and reject the same tampering. No third-party deps — node:crypto only.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * minisign public key — the base64 key line of `release/keys/slaide-binary-public.txt`, baked in
 * at publish time. The caller (bootstrap.ts) enforces a *present* signature and falls back to
 * checksum-only when none is published (the unsigned→signed rollout; the release pipeline starts
 * attaching `.minisig` once SLAIDE_MINISIGN_KEY is set — see release/SIGNING.md). If reset to a
 * `REPLACE_ME` placeholder, signature checks are skipped entirely.
 *
 * MUST equal SLAIDE_BINARY_PUBKEY in core/viewer/src/upgrade.rs.
 */
export const BINARY_PUBKEY = 'RWSnmndaVYXz9nNyikYjyk9RBl88ftUjABjzVCiIS8chvRgUWoolBv/l';

/** True once a real minisign key has replaced the placeholder. */
export function isPubkeyConfigured(): boolean {
  return !BINARY_PUBKEY.includes('REPLACE_ME');
}

/** Verify `data` against a `.sha256` file body (`"<hex>  <name>"`). Throws on mismatch. */
export function verifySha256(data: Buffer, shaFile: string): void {
  const expected = shaFile.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (expected.length !== 64) throw new Error('malformed .sha256 file');
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expected) throw new Error('checksum mismatch — refusing to install');
}

/** Wrap a raw 32-byte Ed25519 public key in a DER SPKI so node:crypto can consume it. */
function ed25519PublicKey(raw: Buffer): ReturnType<typeof createPublicKey> {
  // SPKI prefix for id-Ed25519 (RFC 8410), followed by the 32-byte key.
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

/**
 * Verify a minisign `.minisig` signature over `data` using the embedded trusted key.
 * Supports both the legacy (`Ed`, signs the raw data) and prehashed (`ED`, signs BLAKE2b-512 of
 * the data) algorithms, matching minisign / minisign-verify. Throws if the signature does not
 * verify, the key id disagrees, or the key/sig is malformed.
 */
export function verifyMinisign(data: Buffer, sigFile: string, pubkeyB64: string = BINARY_PUBKEY): void {
  const pub = Buffer.from(pubkeyB64, 'base64');
  if (pub.length !== 42) throw new Error('bad trusted pubkey');
  const pubAlg = pub.subarray(0, 2);
  const pubKeyId = pub.subarray(2, 10);
  const pubKey = pub.subarray(10, 42);
  if (pubAlg.toString('latin1') !== 'Ed') throw new Error('unexpected trusted pubkey algorithm');

  // The signature line is the first base64 line that is not an `untrusted/trusted comment:` header.
  const sigB64 = sigFile
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^untrusted comment:/i.test(l) && !/^trusted comment:/i.test(l));
  if (!sigB64) throw new Error('bad signature file: no signature line');
  const sig = Buffer.from(sigB64, 'base64');
  if (sig.length !== 74) throw new Error('bad signature file: wrong length');
  const sigAlg = sig.subarray(0, 2).toString('latin1');
  const sigKeyId = sig.subarray(2, 10);
  const signature = sig.subarray(10, 74);
  if (!sigKeyId.equals(pubKeyId)) throw new Error('signature key id does not match the trusted key');

  let message: Buffer;
  if (sigAlg === 'ED') message = createHash('blake2b512').update(data).digest(); // prehashed
  else if (sigAlg === 'Ed') message = data; // legacy
  else throw new Error(`unsupported signature algorithm "${sigAlg}"`);

  if (!cryptoVerify(null, message, ed25519PublicKey(pubKey), signature)) {
    throw new Error('signature does not verify — refusing to install');
  }
}
