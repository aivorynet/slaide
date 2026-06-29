// Embed the brand icon into slaide-view.exe so Explorer (and the .slaide/.slaidec file
// association, which points at "{exe},0") shows it. No-op on non-Windows.
fn main() {
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=assets/slaide.ico");
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/slaide.ico");
        if let Err(e) = res.compile() {
            // Don't fail the whole build if the resource compiler is unavailable —
            // the app still runs (window/taskbar icon is set at runtime from icon.rgba).
            println!("cargo:warning=could not embed exe icon: {e}");
        }
    }
}
