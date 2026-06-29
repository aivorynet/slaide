// Copyright 2026 AIVory, Inc.
// SPDX-License-Identifier: Apache-2.0
// Windows file association: .slaide → this exe (per-user, no admin).
// `slaide-view --register` / `--unregister`.

#[cfg(windows)]
pub fn register() -> std::io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = std::env::current_exe()?;
    let exe = exe.to_string_lossy().to_string();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let classes = hkcu.open_subkey_with_flags("Software\\Classes", KEY_WRITE)?;

    // .slaide -> ProgId
    let (ext, _) = classes.create_subkey(".slaide")?;
    ext.set_value("", &"Slaide.Deck")?;

    // .slaidec (compressed, self-contained deck bundle) -> same ProgId
    let (extc, _) = classes.create_subkey(".slaidec")?;
    extc.set_value("", &"Slaide.Deck")?;

    // ProgId description
    let (prog, _) = classes.create_subkey("Slaide.Deck")?;
    prog.set_value("", &"Slaide Presentation")?;

    let (icon, _) = classes.create_subkey("Slaide.Deck\\DefaultIcon")?;
    icon.set_value("", &format!("{exe},0"))?;

    let (cmd, _) = classes.create_subkey("Slaide.Deck\\shell\\open\\command")?;
    cmd.set_value("", &format!("\"{exe}\" \"%1\""))?;

    notify_shell();
    Ok(())
}

#[cfg(windows)]
pub fn unregister() -> std::io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(classes) = hkcu.open_subkey_with_flags("Software\\Classes", KEY_WRITE) {
        let _ = classes.delete_subkey_all("Slaide.Deck");
        let _ = classes.delete_subkey_all(".slaide");
        let _ = classes.delete_subkey_all(".slaidec");
    }
    notify_shell();
    Ok(())
}

#[cfg(windows)]
fn notify_shell() {
    // SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0) so Explorer picks up the icon/assoc.
    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(wEventId: i32, uFlags: u32, dwItem1: *const std::ffi::c_void, dwItem2: *const std::ffi::c_void);
    }
    unsafe { SHChangeNotify(0x0800_0000, 0x0000, std::ptr::null(), std::ptr::null()) };
}

#[cfg(not(windows))]
pub fn register() -> std::io::Result<()> {
    eprintln!("File association registration is implemented for Windows only.");
    Ok(())
}

#[cfg(not(windows))]
pub fn unregister() -> std::io::Result<()> {
    Ok(())
}
