// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// slaide-view — a native, double-clickable viewer/launcher for .slaide decks.
//
// It is a thin shell over the bundled `slaide-engine` (the canonical renderer):
// spawn the engine to get a self-contained HTML document, show it in the OS webview,
// and offer Open / Reload / Export HTML / Export PDF / Present via an injected
// toolbar that talks back over wry's IPC channel.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, bail, Result};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Fullscreen, Icon, WindowBuilder};
use wry::http::Response;
use wry::{PageLoadEvent, WebViewBuilder};

#[cfg(windows)]
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_7,
    },
    PrintToPdfCompletedHandler,
};
#[cfg(windows)]
use windows::core::{Interface, PCWSTR};
#[cfg(windows)]
use wry::WebViewExtWindows;

mod register;

#[derive(Debug, Clone)]
enum UserEvent {
    OpenDialog,
    OpenPath(PathBuf),
    Reload,
    ExportHtmlDialog,
    ExportHtmlTo(PathBuf),
    ExportPdf,
    ExportPdfTo(PathBuf),
    ExportSlaidecDialog,
    ExportSlaidecTo(PathBuf),
    // PowerPoint / Keynote run through Node + slaide (they need a headless browser the
    // lean engine does not bundle), on a worker thread since the export takes a while.
    ExportPptx,
    ExportPptxTo(PathBuf),
    ExportKeynote,
    ExportKeynoteTo(PathBuf),
    ExportDone(String, String),
    RunPdf,
    TogglePresent,
    PresentOn(usize), // present fullscreen on a specific display index (opens a second "audience" window)
    // The deck runtime reports a slide move (cur.step) so it can be mirrored onto the audience window.
    Nav(String),
    // Blank the audience (projector) screen black/white ("b"/"w") or restore ("") — driven from the main.
    Blank(String),
    // Editing (functional only with the licensed Pro engine, which honors `--editable`
    // and the `edit` command; with the OSS engine these never fire — no Edit button).
    SaveEdits(String),
    InsertImageDialog,
    InsertImageFile(PathBuf),
    // Persist a viewer-chrome preference change (toolbar pinned / slides panel shown).
    SavePrefs(String),
    // Pro sign-in: AuthLogin runs the engine's Keycloak browser flow on a worker thread,
    // AuthLogout clears local tokens; AuthDone(ok, message) restores the title, surfaces any
    // error, and re-renders so the new entitlement (__SLV_EDITABLE__ / __SLV_LICENSE__) applies.
    AuthLogin,
    AuthLogout,
    AuthDone(bool, String),
}

/// Viewer-chrome colour theme. Defaults to `Light` (mirrors the Slaide Pro web look);
/// the ribbon flips to dark when this is `Dark`. Serialises as `"light"` / `"dark"` and
/// rides the same `viewer-prefs.json` / `__SLV_PREFS__` pipe as the other prefs.
#[derive(Clone, Copy, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum Theme {
    #[default]
    Light,
    Dark,
}

/// Persistent viewer-chrome preferences. The toolbar/slides default ON: the toolbar stays
/// "docked" (pinned open) and the slides navigator is shown, until the user turns them off;
/// the colour theme defaults to light. Stored as JSON at `config_dir()/Slaide/viewer-prefs.json`.
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
struct ViewerPrefs {
    #[serde(default = "yes")]
    toolbar_pinned: bool,
    #[serde(default = "yes")]
    slides_visible: bool,
    #[serde(default)]
    theme: Theme,
}
fn yes() -> bool {
    true
}
impl Default for ViewerPrefs {
    fn default() -> Self {
        ViewerPrefs { toolbar_pinned: true, slides_visible: true, theme: Theme::Light }
    }
}
fn prefs_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("Slaide").join("viewer-prefs.json"))
}
/// Load saved prefs; any missing file / parse error falls back to the all-ON default.
fn load_prefs() -> ViewerPrefs {
    prefs_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
/// Persist prefs from the ribbon's JSON message (best-effort; failures are silent —
/// a non-writable config dir must never break the viewer).
fn save_prefs(json: &str) {
    let prefs: ViewerPrefs = match serde_json::from_str(json) {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Some(path) = prefs_path() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string_pretty(&prefs) {
            let _ = std::fs::write(path, s);
        }
    }
}

#[derive(Default, Clone, serde::Deserialize)]
struct Meta {
    title: Option<String>,
    #[serde(default)]
    canvas: Option<Canvas>,
    // The Pro engine reports `editable: true` for `render --editable` under a valid license;
    // the OSS engine omits it (→ false), so the viewer shows no Edit button.
    #[serde(default)]
    editable: bool,
}

#[derive(Default, Clone, Copy, serde::Deserialize)]
struct Canvas {
    width: f64,
    height: f64,
}

fn main() {
    // Never die silently: log panics and show the reason (release has no console).
    std::panic::set_hook(Box::new(|info| {
        let dir = std::env::temp_dir().join("slaide-view");
        let _ = std::fs::create_dir_all(&dir);
        let body = format!("{info}");
        let _ = std::fs::write(dir.join("panic.log"), &body);
        rfd::MessageDialog::new()
            .set_title("slaide-view error")
            .set_description(&format!("{body}\n\n(logged to {})", dir.join("panic.log").display()))
            .show();
    }));

    let args: Vec<String> = std::env::args().collect();

    // Self-install / uninstall the .slaide file association (Windows).
    if args.iter().any(|a| a == "--register") {
        match register::register() {
            Ok(_) => println!("Registered .slaide + .slaidec → {}", std::env::current_exe().unwrap().display()),
            Err(e) => eprintln!("register failed: {e}"),
        }
        return;
    }
    if args.iter().any(|a| a == "--unregister") {
        let _ = register::unregister();
        println!("Unregistered .slaide + .slaidec");
        return;
    }

    if let Err(e) = run(args) {
        let msg = format!("slaide-view could not start:\n{e}");
        eprintln!("{msg}");
        rfd::MessageDialog::new().set_title("slaide-view").set_description(&msg).show();
    }
}

fn run(args: Vec<String>) -> Result<()> {
    let engine = find_engine().ok_or_else(|| {
        anyhow!("Could not find slaide-engine. Place it next to this exe, in ./vendor, or set SLAIDE_ENGINE.")
    })?;

    // Deck path from argv (file association passes it as %1), else an Open dialog.
    let mut deck: Option<PathBuf> = args.iter().skip(1).find(|a| !a.starts_with("--")).map(PathBuf::from);
    if deck.is_none() {
        deck = rfd::FileDialog::new().add_filter("slaide", &["slaide", "slaidec"]).pick_file();
    }
    let mut deck = match deck {
        Some(d) => d,
        None => return Ok(()), // user cancelled the open dialog
    };

    // `--present` launches a chrome-free kiosk (no ribbon). Otherwise the viewer
    // injects the navigation ribbon (open/reload/navigate/zoom/notes/export/present).
    let present = args.iter().any(|a| a == "--present");

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let (html, meta) = render(&engine, &deck, false, true).unwrap_or_else(|e| (error_page(&e.to_string()), Meta::default()));
    let title = window_title(&meta, &deck);

    let window = WindowBuilder::new()
        .with_title(&title)
        .with_window_icon(app_icon())
        .with_inner_size(LogicalSize::new(1280.0, 760.0))
        .build(&event_loop)?;

    // Display names for the Present button's per-monitor picker (shown only when >1).
    let monitor_names = display_names(&window);

    // Serve the deck over a custom protocol (→ http://slaide.localhost/ on Windows),
    // NOT file://. wry's WebView2 IPC handler builds an http::Uri from the document URL
    // and unwraps it — a file:// URL fails that parse and panics on every IPC message.
    // A custom protocol also sidesteps the ~2 MB NavigateToString limit.
    let state = Arc::new(Mutex::new(if present { html } else { inject_toolbar(&html, meta.editable, &monitor_names) }));
    // When set, the protocol serves this (toolbar-free, print-mode) HTML instead of
    // `state` — used transiently while exporting a PDF, then cleared.
    let serve_override: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    // (path, canvas-w, canvas-h) of an in-flight PDF export; consumed once the print
    // HTML finishes loading so PrintToPdf captures a fully-rendered document.
    let pending_pdf: Arc<Mutex<Option<(PathBuf, f64, f64)>>> = Arc::new(Mutex::new(None));

    let proto_state = state.clone();
    let proto_override = serve_override.clone();
    let ipc_proxy = proxy.clone();
    let load_proxy = proxy.clone();
    let load_pending = pending_pdf.clone();
    let webview = WebViewBuilder::new()
        .with_custom_protocol("slaide".to_string(), move |_id, _req| {
            let body = proto_override
                .lock()
                .ok()
                .and_then(|o| o.clone())
                .or_else(|| proto_state.lock().ok().map(|s| s.clone()))
                .unwrap_or_default()
                .into_bytes();
            Response::builder()
                .header("Content-Type", "text/html")
                .header("Cache-Control", "no-store")
                .body(Cow::Owned(body))
                .unwrap()
        })
        .with_url("slaide://localhost/")
        // Enable DevTools (right-click → Inspect / F12) so editor issues can be diagnosed
        // in the real WebView2 — the deck JS behaves subtly differently than a plain browser.
        .with_devtools(true)
        .with_on_page_load_handler(move |event, _url| {
            // Once the swapped-in print document has loaded, kick off PrintToPdf.
            if matches!(event, PageLoadEvent::Finished)
                && load_pending.lock().map(|p| p.is_some()).unwrap_or(false)
            {
                let _ = load_proxy.send_event(UserEvent::RunPdf);
            }
        })
        .with_ipc_handler(move |req| {
            let body = req.body().as_str();
            let ev = match body {
                "open" => Some(UserEvent::OpenDialog),
                "reload" => Some(UserEvent::Reload),
                "export-html" => Some(UserEvent::ExportHtmlDialog),
                "export-pdf" => Some(UserEvent::ExportPdf),
                "export-slaidec" => Some(UserEvent::ExportSlaidecDialog),
                "export-pptx" => Some(UserEvent::ExportPptx),
                "export-key" => Some(UserEvent::ExportKeynote),
                "present" => Some(UserEvent::TogglePresent),
                b if b.starts_with("present:") => b["present:".len()..].parse::<usize>().ok().map(UserEvent::PresentOn),
                b if b.starts_with("nav:") => Some(UserEvent::Nav(b["nav:".len()..].to_string())),
                b if b.starts_with("blank:") => Some(UserEvent::Blank(b["blank:".len()..].to_string())),
                "insert-image" => Some(UserEvent::InsertImageDialog),
                "auth:login" => Some(UserEvent::AuthLogin),
                "auth:logout" => Some(UserEvent::AuthLogout),
                b if b.starts_with("save:") => Some(UserEvent::SaveEdits(b["save:".len()..].to_string())),
                b if b.starts_with("prefs:") => Some(UserEvent::SavePrefs(b["prefs:".len()..].to_string())),
                _ => None,
            };
            if let Some(ev) = ev {
                let _ = ipc_proxy.send_event(ev);
            }
        })
        .build(&window)?;

    let mut presenting = false;
    let dialog_proxy = proxy.clone();
    // When presenting on a SECOND display we open a separate "audience" window there (so the main
    // screen keeps the deck instead of going blank). It mirrors the main window's slide moves.
    let mut audience: Option<(tao::window::Window, wry::WebView)> = None;
    let mut cur_slide: usize = 0;
    let aud_proto = state.clone();
    let aud_proxy = proxy.clone();

    event_loop.run(move |event, target, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            // Closing the MAIN window quits; closing the audience window just ends the second screen.
            Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => {
                if window_id == window.id() {
                    *control_flow = ControlFlow::Exit;
                } else {
                    audience = None;
                    presenting = false;
                    let _ = webview.evaluate_script("window.__slvHasAudience=false;window.__slvAudienceOn&&window.__slvAudienceOn(false);");
                }
            }
            Event::UserEvent(ev) => match ev {
                // Run blocking native dialogs on a worker thread; never inside the
                // event-loop callback (nested modal loops crash/hang the webview).
                UserEvent::OpenDialog => {
                    let px = dialog_proxy.clone();
                    std::thread::spawn(move || {
                        if let Some(p) = rfd::FileDialog::new().add_filter("slaide", &["slaide", "slaidec"]).pick_file() {
                            let _ = px.send_event(UserEvent::OpenPath(p));
                        }
                    });
                }
                UserEvent::OpenPath(p) => {
                    deck = p;
                    reload(&engine, &deck, &webview, &window, &state, present);
                }
                UserEvent::Reload => reload(&engine, &deck, &webview, &window, &state, present),
                UserEvent::ExportHtmlDialog => {
                    let px = dialog_proxy.clone();
                    let default = deck.with_extension("html").file_name().and_then(|s| s.to_str()).unwrap_or("deck.html").to_string();
                    std::thread::spawn(move || {
                        if let Some(save) = rfd::FileDialog::new().add_filter("HTML", &["html"]).set_file_name(&default).save_file() {
                            let _ = px.send_event(UserEvent::ExportHtmlTo(save));
                        }
                    });
                }
                UserEvent::ExportHtmlTo(save) => match render(&engine, &deck, false, false) {
                    Ok((h, _)) => match std::fs::write(&save, h) {
                        Ok(_) => msg("Exported", &format!("Saved {}", save.display())),
                        Err(e) => msg("Export failed", &e.to_string()),
                    },
                    Err(e) => msg("Export failed", &e.to_string()),
                },
                UserEvent::ExportPdf => {
                    let px = dialog_proxy.clone();
                    let default = deck.with_extension("pdf").file_name().and_then(|s| s.to_str()).unwrap_or("deck.pdf").to_string();
                    std::thread::spawn(move || {
                        if let Some(save) = rfd::FileDialog::new().add_filter("PDF", &["pdf"]).set_file_name(&default).save_file() {
                            let _ = px.send_event(UserEvent::ExportPdfTo(save));
                        }
                    });
                }
                UserEvent::ExportSlaidecDialog => {
                    let px = dialog_proxy.clone();
                    let default = deck.with_extension("slaidec").file_name().and_then(|s| s.to_str()).unwrap_or("deck.slaidec").to_string();
                    std::thread::spawn(move || {
                        if let Some(save) = rfd::FileDialog::new().add_filter("slaidec", &["slaidec"]).set_file_name(&default).save_file() {
                            let _ = px.send_event(UserEvent::ExportSlaidecTo(save));
                        }
                    });
                }
                UserEvent::ExportSlaidecTo(save) => match pack(&engine, &deck, &save) {
                    Ok(_) => msg("Exported", &format!("Saved {}", save.display())),
                    Err(e) => msg("Export failed", &e.to_string()),
                },
                UserEvent::ExportPptx => {
                    let px = dialog_proxy.clone();
                    let default = deck.with_extension("pptx").file_name().and_then(|s| s.to_str()).unwrap_or("deck.pptx").to_string();
                    std::thread::spawn(move || {
                        if let Some(save) = rfd::FileDialog::new().add_filter("PowerPoint", &["pptx"]).set_file_name(&default).save_file() {
                            let _ = px.send_event(UserEvent::ExportPptxTo(save));
                        }
                    });
                }
                UserEvent::ExportKeynote => {
                    let px = dialog_proxy.clone();
                    let default = deck.with_extension("key").file_name().and_then(|s| s.to_str()).unwrap_or("deck.key").to_string();
                    std::thread::spawn(move || {
                        if let Some(save) = rfd::FileDialog::new().add_filter("Keynote", &["key"]).set_file_name(&default).save_file() {
                            let _ = px.send_event(UserEvent::ExportKeynoteTo(save));
                        }
                    });
                }
                UserEvent::ExportPptxTo(save) => {
                    // Long-running headless export: run on a worker thread, show progress in the title.
                    window.set_title("Exporting PowerPoint…");
                    let px = dialog_proxy.clone();
                    let eng = engine.clone();
                    let dk = deck.clone();
                    std::thread::spawn(move || {
                        let (t, b) = match export_via_cli(&eng, &dk, &save, "--pptx") {
                            Ok(_) => ("Exported".to_string(), format!("Saved {}", save.display())),
                            Err(e) => ("Export failed".to_string(), e.to_string()),
                        };
                        let _ = px.send_event(UserEvent::ExportDone(t, b));
                    });
                }
                UserEvent::ExportKeynoteTo(save) => {
                    window.set_title("Exporting Keynote…");
                    let px = dialog_proxy.clone();
                    let eng = engine.clone();
                    let dk = deck.clone();
                    std::thread::spawn(move || {
                        let (t, b) = match export_via_cli(&eng, &dk, &save, "--key") {
                            Ok(_) => ("Exported".to_string(), format!("Saved {}", save.display())),
                            Err(e) => ("Export failed".to_string(), e.to_string()),
                        };
                        let _ = px.send_event(UserEvent::ExportDone(t, b));
                    });
                }
                UserEvent::ExportDone(title, body) => {
                    let restore = deck.file_name().and_then(|s| s.to_str()).unwrap_or("slaide").to_string();
                    window.set_title(&restore);
                    msg(&title, &body);
                }
                UserEvent::ExportPdfTo(path) => {
                    // Render the deck in print mode (paginated, @page-sized), swap it in
                    // toolbar-free, and let the page-load handler trigger PrintToPdf.
                    match render(&engine, &deck, true, false) {
                        Ok((print_html, meta)) => {
                            let c = meta.canvas.unwrap_or(Canvas { width: 1280.0, height: 720.0 });
                            if let Ok(mut o) = serve_override.lock() {
                                *o = Some(print_html);
                            }
                            if let Ok(mut p) = pending_pdf.lock() {
                                *p = Some((path, c.width, c.height));
                            }
                            let _ = webview.reload();
                        }
                        Err(e) => msg("Export failed", &e.to_string()),
                    }
                }
                UserEvent::RunPdf => {
                    let job = pending_pdf.lock().ok().and_then(|mut p| p.take());
                    if let Some((path, w, h)) = job {
                        let result = export_pdf(&webview, &path, w, h);
                        // Restore the interactive view regardless of outcome.
                        if let Ok(mut o) = serve_override.lock() {
                            *o = None;
                        }
                        let _ = webview.reload();
                        match result {
                            Ok(true) => msg("Exported", &format!("Saved {}", path.display())),
                            Ok(false) => msg("Export failed", "PrintToPdf reported failure."),
                            Err(e) => msg("Export failed", &e.to_string()),
                        }
                    }
                }
                UserEvent::TogglePresent => {
                    if audience.take().is_some() {
                        // Stop the second-screen presentation: close the audience window; the main
                        // window keeps the deck. (Flip its Present⇄Stop button back.)
                        presenting = false;
                        let _ = webview.evaluate_script("window.__slvHasAudience=false;window.__slvAudienceOn&&window.__slvAudienceOn(false);");
                    } else {
                        // Same-screen present: fullscreen the main window (single-display behaviour).
                        presenting = !presenting;
                        window.set_fullscreen(if presenting { Some(Fullscreen::Borderless(None)) } else { None });
                        let _ = webview.evaluate_script(&format!(
                            "window.__slvSetPresenting&&window.__slvSetPresenting({presenting});"
                        ));
                    }
                }
                UserEvent::PresentOn(i) => {
                    // Present on a CHOSEN display: open a borderless-fullscreen "audience" window there
                    // (a clean, host-driven mirror) and leave the main window showing the deck — so the
                    // main screen is no longer blank. The audience starts at the current slide (URL hash)
                    // and follows the main thereafter (Nav relay).
                    audience = None;
                    let mon = window.available_monitors().nth(i);
                    match WindowBuilder::new()
                        .with_title("Slaide — presenting")
                        .with_decorations(false)
                        .with_fullscreen(Some(Fullscreen::Borderless(mon)))
                        .build(target)
                    {
                        Ok(aud_win) => {
                            let proto = aud_proto.clone();
                            let ipc = aud_proxy.clone();
                            let url = format!("slaide://localhost/?slvview=present#{}", cur_slide + 1);
                            match WebViewBuilder::new()
                                .with_custom_protocol("slaide".to_string(), move |_id, _req| {
                                    let body = proto.lock().ok().map(|s| s.clone()).unwrap_or_default().into_bytes();
                                    Response::builder()
                                        .header("Content-Type", "text/html")
                                        .header("Cache-Control", "no-store")
                                        .body(Cow::Owned(body))
                                        .unwrap()
                                })
                                .with_url(&url)
                                .with_ipc_handler(move |req| {
                                    // Esc on the projector → stop (close the audience window).
                                    if req.body().as_str() == "present" {
                                        let _ = ipc.send_event(UserEvent::TogglePresent);
                                    }
                                })
                                .build(&aud_win)
                            {
                                Ok(wv) => {
                                    audience = Some((aud_win, wv));
                                    presenting = true;
                                    let _ = webview.evaluate_script("window.__slvHasAudience=true;window.__slvAudienceOn&&window.__slvAudienceOn(true);");
                                }
                                Err(e) => msg("Presenter view failed", &e.to_string()),
                            }
                        }
                        Err(e) => msg("Presenter view failed", &e.to_string()),
                    }
                }
                // Mirror the driving window's slide move onto the audience window (second screen).
                UserEvent::Nav(s) => {
                    let mut it = s.splitn(2, '.');
                    let c: usize = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                    let st: usize = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                    cur_slide = c;
                    if let Some((_, av)) = &audience {
                        let _ = av.evaluate_script(&format!(
                            "window.slaide&&window.slaide.__applyRemote&&window.slaide.__applyRemote({c},{st});"
                        ));
                    }
                }
                // Blank/restore the audience (projector) screen — 'b' | 'w' | '' (only b/w/empty reach here).
                UserEvent::Blank(kind) => {
                    let k = if kind == "b" || kind == "w" { kind.as_str() } else { "" };
                    if let Some((_, av)) = &audience {
                        let _ = av.evaluate_script(&format!("window.slaide&&window.slaide.blank&&window.slaide.blank('{k}');"));
                    }
                }
                // Persist in-place edits to the .slaide source, then reload from disk.
                UserEvent::SaveEdits(json) => match save_edits(&engine, &deck, &json) {
                    Ok(_) => reload(&engine, &deck, &webview, &window, &state, present),
                    Err(e) => msg("Save failed", &e.to_string()),
                },
                // Editor asked to insert a picture: pick a file, copy into assets/, hand the
                // deck-relative path back to the editor to place it.
                UserEvent::InsertImageDialog => {
                    let px = dialog_proxy.clone();
                    std::thread::spawn(move || {
                        if let Some(p) = rfd::FileDialog::new()
                            .add_filter("image", &["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"])
                            .pick_file()
                        {
                            let _ = px.send_event(UserEvent::InsertImageFile(p));
                        }
                    });
                }
                UserEvent::InsertImageFile(path) => match copy_into_assets(&deck, &path) {
                    Ok(rel) => {
                        let arg = serde_json::to_string(&rel).unwrap_or_else(|_| "\"\"".to_string());
                        let js = format!(
                            "window.slaide&&window.slaide.__editor&&window.slaide.__editor.insertImage&&window.slaide.__editor.insertImage({arg});"
                        );
                        let _ = webview.evaluate_script(&js);
                    }
                    Err(e) => msg("Insert image failed", &e.to_string()),
                },
                // Remember the ribbon's docked/slides-panel state across launches.
                UserEvent::SavePrefs(json) => save_prefs(&json),
                // Pro sign-in: run the engine's interactive Keycloak flow on a worker thread so
                // the UI stays responsive while the browser is open.
                UserEvent::AuthLogin => {
                    window.set_title("Signing in…");
                    let px = dialog_proxy.clone();
                    let eng = engine.clone();
                    std::thread::spawn(move || {
                        let (ok, m) = match run_engine_auth(&eng, "login") {
                            Ok(_) => (true, String::new()),
                            Err(e) => (false, e.to_string()),
                        };
                        let _ = px.send_event(UserEvent::AuthDone(ok, m));
                    });
                }
                UserEvent::AuthLogout => {
                    let px = dialog_proxy.clone();
                    let eng = engine.clone();
                    std::thread::spawn(move || {
                        let _ = run_engine_auth(&eng, "logout");
                        let _ = px.send_event(UserEvent::AuthDone(true, String::new()));
                    });
                }
                UserEvent::AuthDone(ok, m) => {
                    if !ok && !m.is_empty() {
                        let restore = deck.file_name().and_then(|s| s.to_str()).unwrap_or("slaide").to_string();
                        window.set_title(&restore);
                        msg("Sign-in failed", &m);
                    }
                    // Re-render: the new entitlement flips __SLV_EDITABLE__ / __SLV_LICENSE__.
                    reload(&engine, &deck, &webview, &window, &state, present);
                }
            },
            _ => {}
        }
    });
}

fn reload(engine: &Path, deck: &Path, webview: &wry::WebView, window: &tao::window::Window, state: &Arc<Mutex<String>>, present: bool) {
    let next = match render(engine, deck, false, true) {
        Ok((h, meta)) => {
            window.set_title(&window_title(&meta, deck));
            if present { h } else { inject_toolbar(&h, meta.editable, &display_names(window)) }
        }
        Err(e) => error_page(&e.to_string()),
    };
    if let Ok(mut s) = state.lock() {
        *s = next;
    }
    let _ = webview.reload();
}

fn window_title(meta: &Meta, deck: &Path) -> String {
    meta.title
        .clone()
        .unwrap_or_else(|| deck.file_name().and_then(|s| s.to_str()).unwrap_or("slaide").to_string())
}

/// Window/taskbar icon, baked in as raw 256×256 RGBA (generated by scripts/dev/gen-icons.ts).
fn app_icon() -> Option<Icon> {
    const RGBA: &[u8] = include_bytes!("../assets/icon.rgba");
    Icon::from_rgba(RGBA.to_vec(), 256, 256).ok()
}

/// Locate the bundled engine: $SLAIDE_ENGINE, next to the exe, ./vendor, or PATH.
fn find_engine() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SLAIDE_ENGINE") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) { "slaide-engine.exe" } else { "slaide-engine" };
    for cand in [
        dir.join(name),
        dir.join("vendor").join(name),
        dir.join("../vendor").join(name),
        dir.join("../../vendor").join(name),
    ] {
        if cand.exists() {
            return Some(cand);
        }
    }
    which::which("slaide-engine").ok()
}

/// Spawn the engine to render the deck to a self-contained, presentation-only HTML
/// document + meta. `print` selects the paginated print build used for PDF export.
fn render(engine: &Path, deck: &Path, print: bool, editable: bool) -> Result<(String, Meta)> {
    let mut cmd = Command::new(engine);
    cmd.arg("render").arg(deck).arg("--meta");
    if print {
        cmd.arg("--print");
    }
    // The Pro engine injects the (dormant) editor and reports editable; the OSS engine
    // ignores this flag. Never request it for the print build (PDF export).
    if editable && !print {
        cmd.arg("--editable");
    }
    if let Some(parent) = deck.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out = cmd.output()?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let html = String::from_utf8_lossy(&out.stdout).to_string();
    let meta: Meta = serde_json::from_slice(&out.stderr).unwrap_or_default();
    Ok((html, meta))
}

/// Bundle the current deck (+ master + assets) into one shareable .slaidec (engine `pack`).
fn pack(engine: &Path, deck: &Path, out: &Path) -> Result<()> {
    let mut cmd = Command::new(engine);
    cmd.arg("pack").arg(deck).arg("--out").arg(out);
    if let Some(parent) = deck.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out_res = cmd.output()?;
    if !out_res.status.success() {
        bail!("{}", String::from_utf8_lossy(&out_res.stderr).trim().to_string());
    }
    Ok(())
}

/// Locate the slaide CLI (bin/slaide.js) to run a Playwright-backed export through Node:
/// $SLAIDE_CLI (set by the local installer), else relative to the dev-vendored engine.
fn find_cli(engine: &Path) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SLAIDE_CLI") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let dir = engine.parent()?;
    // dev: engine vendored at core/viewer/vendor/ -> ../../bin/slaide.js
    for cand in [dir.join("../../bin/slaide.js"), dir.join("slaide.js")] {
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

/// Export to PowerPoint (`--pptx`) or Keynote (`--key`) via `node <cli> export <deck> <flag> <out>`.
/// The lean engine cannot run Playwright, so the heavy export goes through Node + slaide.
fn export_via_cli(engine: &Path, deck: &Path, out: &Path, flag: &str) -> Result<()> {
    let cli = find_cli(engine).ok_or_else(|| {
        anyhow!("PowerPoint/Keynote export needs Node and slaide. Set SLAIDE_CLI to core/bin/slaide.js (the local installer does this).")
    })?;
    let mut cmd = Command::new("node");
    cmd.arg(&cli).arg("export").arg(deck).arg(flag).arg(out);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let res = cmd.output().map_err(|e| anyhow!("could not launch Node: {e}. Install Node to export PowerPoint/Keynote."))?;
    if !res.status.success() {
        bail!("{}", String::from_utf8_lossy(&res.stderr).trim().to_string());
    }
    Ok(())
}

/// Friendly names of all connected displays, for the Present per-monitor picker.
fn display_names(window: &tao::window::Window) -> Vec<String> {
    window
        .available_monitors()
        .enumerate()
        .map(|(i, m)| {
            let sz = m.size();
            match m.name() {
                Some(n) if !n.is_empty() => format!("{n} ({}x{})", sz.width, sz.height),
                _ => format!("Display {} ({}x{})", i + 1, sz.width, sz.height),
            }
        })
        .collect()
}

fn inject_toolbar(html: &str, editable: bool, monitors: &[String]) -> String {
    // The viewer chrome (auto-hiding ribbon + thumbnail navigator + zoom controls)
    // lives in its own file so the HTML/CSS/JS is editable as such.
    // include_str! bakes it in at compile time; cargo rebuilds when it changes.
    const BAR: &str = include_str!("ribbon.html");
    // Runtime config handed to the ribbon before its script runs:
    //  - __SLV_EDITABLE__: the Edit affordance is dormant unless the engine reported
    //    editing is available (Pro engine + license) — this flag is the single gate.
    //  - __SLV_PREFS__: persisted docked/slides-panel state, applied on load.
    //  - __SLV_MONITORS__: display names, so the Present button can offer a per-display picker.
    let prefs = serde_json::to_string(&load_prefs()).unwrap_or_else(|_| "{}".to_string());
    let mons = serde_json::to_string(monitors).unwrap_or_else(|_| "[]".to_string());
    let mut head = String::new();
    if editable {
        head.push_str("<script>window.__SLV_EDITABLE__=true;</script>\n");
    }
    // Native Keynote export only works on macOS; the ribbon grays it out elsewhere.
    if cfg!(target_os = "macos") {
        head.push_str("<script>window.__SLV_MAC__=true;</script>\n");
    }
    head.push_str(&format!("<script>window.__SLV_MONITORS__={mons};</script>\n"));
    head.push_str(&format!("<script>window.__SLV_PREFS__={prefs};</script>\n"));
    if let Some(idx) = html.rfind("</body>") {
        let mut out = String::with_capacity(html.len() + BAR.len() + head.len());
        out.push_str(&html[..idx]);
        out.push_str(&head);
        out.push_str(BAR);
        out.push_str(&html[idx..]);
        out
    } else {
        format!("{html}{head}{BAR}")
    }
}

/// Persist the viewer's in-place region edits back into the deck source via the engine's
/// `edit` command (functional only with the licensed Pro engine).
fn save_edits(engine: &Path, deck: &Path, patches_json: &str) -> Result<()> {
    let tmp = std::env::temp_dir().join(format!("slaide-edits-{}.json", std::process::id()));
    std::fs::write(&tmp, patches_json)?;
    let mut cmd = Command::new(engine);
    cmd.arg("edit").arg(deck).arg("--patch").arg(&tmp);
    if let Some(parent) = deck.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out = cmd.output();
    let _ = std::fs::remove_file(&tmp);
    let out = out?;
    if !out.status.success() {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Run the engine's interactive `auth <login|logout>`. `login` opens the system browser for the
/// Keycloak PKCE flow and blocks until the redirect (or timeout); `logout` clears local tokens.
/// Exit code 3 means signed-in-but-unlicensed; any non-zero surfaces the engine's stderr.
fn run_engine_auth(engine: &Path, sub: &str) -> Result<()> {
    let mut cmd = Command::new(engine);
    cmd.arg("auth").arg(sub);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out = cmd.output()?;
    if out.status.success() {
        return Ok(());
    }
    if out.status.code() == Some(3) {
        bail!("Signed in, but this account has no active Slaide Pro license.");
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    bail!("{}", if err.is_empty() { "sign-in failed".to_string() } else { err });
}

/// Copy a picked image into the deck's `assets/` dir; return the deck-relative,
/// forward-slashed path to embed in the inserted shape.
fn copy_into_assets(deck: &Path, src: &Path) -> Result<String> {
    let base = if deck.is_dir() {
        deck.to_path_buf()
    } else {
        deck.parent().map(|p| p.to_path_buf()).unwrap_or_default()
    };
    let assets = base.join("assets");
    std::fs::create_dir_all(&assets)?;
    let name = src.file_name().ok_or_else(|| anyhow!("image has no file name"))?;
    std::fs::copy(src, assets.join(name))?;
    Ok(format!("assets/{}", name.to_string_lossy()))
}

/// Silently render the loaded print-mode document to a real PDF file via WebView2's
/// PrintToPdf (no print dialog). Page size is the deck canvas in inches (px / 96),
/// margins zero, backgrounds on — so it matches the on-screen deck 1:1.
#[cfg(windows)]
fn export_pdf(webview: &wry::WebView, path: &Path, w: f64, h: f64) -> Result<bool> {
    use std::os::windows::ffi::OsStrExt;
    let core = webview.webview();
    let wv7: ICoreWebView2_7 = core.cast().map_err(|e| anyhow!("WebView2 PrintToPdf unavailable: {e}"))?;
    let env6: ICoreWebView2Environment6 =
        webview.environment().cast().map_err(|e| anyhow!("WebView2 environment too old: {e}"))?;
    let settings: ICoreWebView2PrintSettings =
        unsafe { env6.CreatePrintSettings() }.map_err(|e| anyhow!("CreatePrintSettings: {e}"))?;
    unsafe {
        let _ = settings.SetShouldPrintBackgrounds(true);
        let _ = settings.SetMarginTop(0.0);
        let _ = settings.SetMarginBottom(0.0);
        let _ = settings.SetMarginLeft(0.0);
        let _ = settings.SetMarginRight(0.0);
        let _ = settings.SetPageWidth(w / 96.0);
        let _ = settings.SetPageHeight(h / 96.0);
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let succeeded = Arc::new(Mutex::new(false));
    let s2 = succeeded.clone();
    PrintToPdfCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| {
            unsafe { wv7.PrintToPdf(PCWSTR(wide.as_ptr()), &settings, &handler) }?;
            Ok(())
        }),
        Box::new(move |_errcode, is_successful| {
            *s2.lock().unwrap() = is_successful;
            Ok(())
        }),
    )
    .map_err(|e| anyhow!("PrintToPdf failed: {e}"))?;
    let ok = *succeeded.lock().unwrap();
    Ok(ok)
}

#[cfg(not(windows))]
fn export_pdf(webview: &wry::WebView, _path: &Path, _w: f64, _h: f64) -> Result<bool> {
    webview.print().map_err(|e| anyhow!("{e}"))?;
    Ok(true)
}

fn error_page(err: &str) -> String {
    const LOGO: &str = include_str!("../assets/slaide-logo.svg");
    format!(
        "<!doctype html><meta charset=utf-8><body style=\"font:15px/1.6 system-ui;background:#11131c;color:#e6e9f2;padding:6vw\">\
         <div style=\"width:150px;height:42px;margin:0 0 26px\">{logo}</div>\
         <h2 style=\"color:#ff6b6b\">Could not render this deck</h2><pre style=\"white-space:pre-wrap;color:#c7ccda\">{msg}</pre>\
         <p style=\"opacity:.6\">Fix the .slaide file and press Reload.</p></body>",
        logo = LOGO,
        msg = html_escape(err)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn msg(title: &str, body: &str) {
    rfd::MessageDialog::new().set_title(title).set_description(body).show();
}
