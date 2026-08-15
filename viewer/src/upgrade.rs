// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Pro-engine self-upgrade. The OSS GitHub build ships the lean `slaide-engine` (render-only).
// When the user clicks Sign in, the viewer asks the engine its edition; if it's OSS, it fetches
// the Pro-superset engine from the dist server, verifies it (SHA-256, plus minisign once a
// signing key is configured), and atomically swaps it in. The existing `auth login` + reload
// path then unlocks Pro. The license still gates Pro features at runtime — the download is public
// (the same binary serves everyone), so no credentials are needed to fetch it.
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{anyhow, bail, Context, Result};
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};

/// minisign public key — the base64 key line of `release/keys/slaide-binary-public.txt`, trusted
/// at compile time. A *published* `.minisig` is verified (invalid → refuse the swap); a *missing*
/// one falls back to checksum-only (the unsigned→signed rollout — releases gain signatures once
/// SLAIDE_MINISIGN_KEY is set in CI, see release/SIGNING.md). MUST equal BINARY_PUBKEY in
/// core/src/desktop/verify.ts. If reset to a `REPLACE_ME` placeholder, signatures are skipped.
const SLAIDE_BINARY_PUBKEY: &str = "RWSnmndaVYXz9nNyikYjyk9RBl88ftUjABjzVCiIS8chvRgUWoolBv/l";

/// Only one self-upgrade at a time (guards against a double-clicked Sign-in button).
static UPGRADING: AtomicBool = AtomicBool::new(false);

struct UpgradeGuard;
impl Drop for UpgradeGuard {
    fn drop(&mut self) {
        UPGRADING.store(false, Ordering::SeqCst);
    }
}

fn dist_base() -> String {
    std::env::var("SLAIDE_DIST_BASE_URL")
        .unwrap_or_else(|_| "https://github.com/aivorynet/slaide/releases/latest/download".to_string())
}

/// `slaide-engine-<os>-<arch>[.exe].gz` for the running platform — matches release/package-dist.ts.
/// Returns the asset filename plus the bare `<os>-<arch>` tag (for error messages).
fn engine_asset() -> Result<(String, String)> {
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => bail!("unsupported OS for Pro upgrade: {other}"),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => bail!("unsupported architecture for Pro upgrade: {other}"),
    };
    let exe = if os == "windows" { ".exe" } else { "" };
    let os_arch = format!("{os}-{arch}");
    Ok((format!("slaide-engine-{os_arch}{exe}.gz"), os_arch))
}

/// Ask the engine its edition. True only if it explicitly reports `oss` (a Pro engine prints
/// `pro`; any error / unknown command → treat as not-OSS and don't attempt a swap).
fn engine_is_oss(engine: &Path) -> bool {
    let mut cmd = Command::new(engine);
    cmd.arg("edition").stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    match cmd.output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim() == "oss",
        _ => false,
    }
}

/// If the resolved engine is the OSS build, download + verify + swap in the Pro engine.
/// Returns Ok(true) if an upgrade happened, Ok(false) if the engine was already Pro (or unknown).
/// `progress` reports human-readable status to the UI.
pub fn ensure_pro_engine(engine: &Path, progress: &dyn Fn(&str)) -> Result<bool> {
    if !engine_is_oss(engine) {
        return Ok(false); // already the Pro superset (or not probeable) — nothing to do
    }
    if UPGRADING.swap(true, Ordering::SeqCst) {
        bail!("a Pro engine download is already in progress");
    }
    let _guard = UpgradeGuard;

    let (asset, os_arch) = engine_asset()?;
    let base = dist_base();

    progress("Downloading Pro engine…");
    let asset_url = format!("{base}/{asset}");
    let gz = match ureq::get(&asset_url).call() {
        Ok(resp) => {
            let mut buf = Vec::new();
            resp.into_reader()
                .read_to_end(&mut buf)
                .with_context(|| format!("reading {asset_url}"))?;
            buf
        }
        // A missing asset is an expected, nameable situation (this release hasn't published a
        // Pro build for the running platform yet) — surface that instead of ureq's raw status
        // text, which reads as an opaque network fault in the Sign-in-failed dialog.
        Err(ureq::Error::Status(404, _)) => {
            bail!("this Slaide release does not carry a Pro engine build for {os_arch} yet");
        }
        Err(e) => return Err(anyhow!("GET {asset_url}: {e}")).context("download Pro engine"),
    };
    let sha = http_get(&format!("{base}/{asset}.sha256")).context("download checksum")?;
    verify_sha256(&gz, &sha).context("checksum verification")?;

    if SLAIDE_BINARY_PUBKEY.contains("REPLACE_ME") {
        progress("Warning: Pro engine signature not verified (no signing key configured)");
    } else {
        // Enforce a published signature; tolerate a missing one during the unsigned→signed rollout.
        match http_get(&format!("{base}/{asset}.minisig")) {
            Ok(sig) => verify_minisign(&gz, &sig).context("signature verification")?,
            Err(_) => progress("Warning: no signature published for this release (checksum verified)"),
        }
    }

    progress("Installing Pro engine…");
    let bin = gunzip(&gz).context("decompress Pro engine")?;
    atomic_replace(engine, &bin).context("swap in Pro engine")?;
    Ok(true)
}

fn http_get(url: &str) -> Result<Vec<u8>> {
    let resp = ureq::get(url).call().map_err(|e| anyhow!("GET {url}: {e}"))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| anyhow!("reading {url}: {e}"))?;
    Ok(buf)
}

fn verify_sha256(data: &[u8], sha_file: &[u8]) -> Result<()> {
    // Format is "<hex>  <filename>"; take the first whitespace-delimited field (matches install.sh).
    let text = String::from_utf8_lossy(sha_file);
    let expected = text.split_whitespace().next().unwrap_or("").to_lowercase();
    if expected.len() != 64 {
        bail!("malformed .sha256 file");
    }
    let mut h = Sha256::new();
    h.update(data);
    let actual: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected {
        bail!("checksum mismatch — refusing to install");
    }
    Ok(())
}

fn verify_minisign(data: &[u8], sig_file: &[u8]) -> Result<()> {
    let pk = PublicKey::from_base64(SLAIDE_BINARY_PUBKEY).map_err(|e| anyhow!("bad trusted pubkey: {e}"))?;
    let sig_str = String::from_utf8_lossy(sig_file);
    let sig = Signature::decode(&sig_str).map_err(|e| anyhow!("bad signature file: {e}"))?;
    pk.verify(data, &sig, false)
        .map_err(|e| anyhow!("signature does not verify: {e}"))?;
    Ok(())
}

fn gunzip(gz: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(gz)
        .read_to_end(&mut out)
        .context("gunzip")?;
    Ok(out)
}

/// Write `bytes` next to the engine then rename over it. The temp file shares the engine's
/// directory so the rename is atomic (same volume). `std::fs::rename` replaces an existing file on
/// both Unix and Windows; on Windows it fails if the engine is mid-render (locked) — Sign-in is
/// serialised against renders by the user flow, and a failure here is surfaced and retryable.
fn atomic_replace(target: &Path, bytes: &[u8]) -> Result<()> {
    let dir = target.parent().ok_or_else(|| anyhow!("engine path has no parent directory"))?;
    let tmp = dir.join(format!(".slaide-engine.upgrade-{}", std::process::id()));
    std::fs::write(&tmp, bytes).with_context(|| format!("writing {}", tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(anyhow!("replacing {}: {e}", target.display()));
    }
    Ok(())
}
