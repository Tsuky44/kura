use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(target_os = "macos")]
mod mpv_metal;
#[cfg(target_os = "macos")]
use mpv_metal::{mpv_metal_init, mpv_metal_load, mpv_metal_cmd, mpv_metal_set_prop, mpv_metal_get_prop, mpv_metal_resize};

// Stubs for non-macOS so generate_handler! compiles on all platforms
#[cfg(not(target_os = "macos"))]
#[tauri::command] fn mpv_metal_init(_: tauri::AppHandle) -> Result<(), String> { Err("macOS only".into()) }
#[cfg(not(target_os = "macos"))]
#[tauri::command] fn mpv_metal_load(_url: String, _start_time: Option<f64>) -> Result<(), String> { Err("macOS only".into()) }
#[cfg(not(target_os = "macos"))]
#[tauri::command] fn mpv_metal_cmd(_name: String, _args: Vec<serde_json::Value>) -> Result<(), String> { Err("macOS only".into()) }
#[cfg(not(target_os = "macos"))]
#[tauri::command] fn mpv_metal_set_prop(_name: String, _value: serde_json::Value) -> Result<(), String> { Err("macOS only".into()) }
#[cfg(not(target_os = "macos"))]
#[tauri::command] fn mpv_metal_get_prop(_name: String) -> Result<serde_json::Value, String> { Err("macOS only".into()) }
#[cfg(not(target_os = "macos"))]
#[tauri::command] fn mpv_metal_resize(_: tauri::AppHandle) -> Result<(), String> { Err("macOS only".into()) }

// Global flag to control whether the polling thread is active
static POLLING_ACTIVE: once_cell::sync::Lazy<Arc<AtomicBool>> =
    once_cell::sync::Lazy::new(|| Arc::new(AtomicBool::new(false)));

/// Pre-warm Network.framework's Swift runtime by calling getaddrinfo on the main thread.
/// On macOS 12+, getaddrinfo calls into Network.framework's Swift code which crashes
/// (swift_getTypeByMangledNodeImpl, far=0) if called for the first time from a
/// background thread (as MPV's ffmpeg demuxer does). Calling it once on the main thread
/// triggers the Swift metadata initialization safely before MPV touches it.
#[cfg(target_os = "macos")]
fn prewarm_network_framework() {
    unsafe {
        let mut hints: libc::addrinfo = std::mem::zeroed();
        hints.ai_socktype = libc::SOCK_STREAM;
        let mut res: *mut libc::addrinfo = std::ptr::null_mut();
        let rc = libc::getaddrinfo(
            b"localhost\0".as_ptr().cast(),
            std::ptr::null(),
            &hints,
            &mut res,
        );
        if rc == 0 && !res.is_null() {
            libc::freeaddrinfo(res);
        }
        println!("[RUST] Network.framework pre-warmed (getaddrinfo rc={})", rc);
    }
}

#[cfg(target_os = "macos")]
fn setup_mpv_library_path() {
    use std::env;
    
    let mut extra_paths: Vec<String> = Vec::new();

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Bundled app: <App>.app/Contents/MacOS/../Resources
            if let Some(resources) = exe_dir.parent().map(|p| p.join("Resources")) {
                if resources.exists() {
                    extra_paths.push(resources.to_string_lossy().into_owned());
                }
            }
            // Dev mode: dylibs are next to the binary in target/debug or target/release
            extra_paths.push(exe_dir.to_string_lossy().into_owned());
        }
    }

    // Homebrew fallback paths (Apple Silicon and Intel)
    for homebrew in &[
        "/opt/homebrew/lib",
        "/opt/homebrew/opt/mpv/lib",
        "/usr/local/lib",
        "/usr/local/opt/mpv/lib",
    ] {
        extra_paths.push(homebrew.to_string());
    }

    let current = env::var("DYLD_FALLBACK_LIBRARY_PATH").unwrap_or_default();
    let mut parts: Vec<String> = extra_paths;
    if !current.is_empty() {
        parts.push(current);
    }
    let new_path = parts.join(":");
    env::set_var("DYLD_FALLBACK_LIBRARY_PATH", &new_path);
    println!("[RUST] DYLD_FALLBACK_LIBRARY_PATH={}", new_path);
}

/// In a bundled .app, copy libmpv-wrapper.dylib from Contents/Resources into
/// Contents/MacOS so that tauri-plugin-libmpv's path-based search finds it.
/// This avoids relying on DYLD env vars being re-read by dlopen at runtime.
#[cfg(target_os = "macos")]
fn stage_wrapper_dylib_for_bundle() {
    use std::env;
    use std::fs;

    let Ok(exe_path) = env::current_exe() else { return };
    let Some(exe_dir) = exe_path.parent() else { return };

    let wrapper = "libmpv-wrapper.dylib";
    let dest = exe_dir.join(wrapper);

    // Already staged or in dev mode (build.rs already placed it here)
    if dest.exists() {
        return;
    }

    // Look for it in the bundle Resources directory
    if let Some(resources) = exe_dir.parent().map(|p| p.join("Resources")) {
        let src = resources.join(wrapper);
        if src.exists() {
            match fs::copy(&src, &dest) {
                Ok(_) => println!("[RUST] Staged {} to MacOS dir", wrapper),
                Err(e) => println!("[RUST] Failed to stage {}: {}", wrapper, e),
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn stage_wrapper_dylib_for_bundle() {}

/// Explicitly make the Kuma NSWindow transparent so MPV video shows through.
/// Even though tauri.conf.json has transparent:true, macOS can reset the opaque flag
/// when the CAMetalLayer is attached; this call re-asserts it.
#[cfg(target_os = "macos")]
fn setup_window_transparency(ns_view_ptr: *mut std::ffi::c_void) {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    unsafe {
        let ns_view = &*(ns_view_ptr as *const AnyObject);
        let ns_window: *mut AnyObject = msg_send![ns_view, window];
        if ns_window.is_null() { return; }

        let _: () = msg_send![ns_window, setOpaque: false];

        if let Some(ns_color_cls) = AnyClass::get(c"NSColor") {
            let clear: *mut AnyObject = msg_send![ns_color_cls, clearColor];
            if !clear.is_null() {
                let _: () = msg_send![ns_window, setBackgroundColor: clear];
            }
        }
        println!("[RUST] Kuma NSWindow set to transparent");
    }
}

#[cfg(not(target_os = "macos"))]
fn setup_window_transparency(_: *mut std::ffi::c_void) {}

/// Pre-create a transparent CAMetalLayer on the window's NSView from the main thread.
/// MoltenVK (vkCreateMacOSSurfaceMVK) checks whether the view already has a CAMetalLayer
/// and, if so, reuses it without calling CALayer APIs from MPV's background VO thread —
/// preventing the EXC_BAD_ACCESS thread-violation crash on first frame render.
/// MUST be called from the main thread (Tauri .setup() callback).
#[cfg(target_os = "macos")]
fn pre_setup_metal_layer(ns_view_ptr: *mut std::ffi::c_void) {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    let Some(cls) = AnyClass::get(c"CAMetalLayer") else {
        println!("[RUST] CAMetalLayer class not found – skipping pre-setup");
        return;
    };

    unsafe {
        // +new returns a retained instance (+1 retain count)
        let layer: *mut AnyObject = msg_send![cls, new];
        if layer.is_null() {
            println!("[RUST] CAMetalLayer new returned nil");
            return;
        }
        // Transparent so the WKWebView renders on top of MPV's video
        let _: () = msg_send![&*layer, setOpaque: false];

        let view: &AnyObject = &*(ns_view_ptr as *const AnyObject);
        // Enable layer-backed rendering and assign our CAMetalLayer
        let _: () = msg_send![view, setWantsLayer: true];
        let _: () = msg_send![view, setLayer: &*layer];
        // Release our +1 reference (NSView retains it via setLayer:)
        let _: () = msg_send![&*layer, release];

        println!("[RUST] CAMetalLayer pre-created on main thread for MPV WID");
    }
}

#[cfg(not(target_os = "macos"))]
fn pre_setup_metal_layer(_: *mut std::ffi::c_void) {}

// ── CGRect types needed for initWithFrame: ───────────────────────────────────
#[cfg(target_os = "macos")]
#[repr(C)] #[derive(Copy, Clone, Default)]
struct CGPoint { x: f64, y: f64 }

#[cfg(target_os = "macos")]
#[repr(C)] #[derive(Copy, Clone, Default)]
struct CGSize  { width: f64, height: f64 }

#[cfg(target_os = "macos")]
#[repr(C)] #[derive(Copy, Clone, Default)]
struct CGRect  { origin: CGPoint, size: CGSize }

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGPoint {
    const ENCODING: objc2::encode::Encoding =
        objc2::encode::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGSize {
    const ENCODING: objc2::encode::Encoding =
        objc2::encode::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGRect {
    const ENCODING: objc2::encode::Encoding =
        objc2::encode::Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

/// macOS only: create a dedicated NSView as a subview of the window's contentView,
/// positioned BELOW the WKWebView. Pre-creates its CAMetalLayer from the main thread
/// so MoltenVK finds it ready when the VO surface is initialised.
/// Returns the NSView pointer as i64 — pass it as `wid` in MPV's initialOptions
/// so the plugin uses this view instead of the WKWebView (which Apple blocks).
#[tauri::command]
fn create_mpv_view(app_handle: tauri::AppHandle) -> Result<i64, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let win = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;

        let wk_view_ptr = match win.window_handle() {
            Ok(h) => match h.as_raw() {
                RawWindowHandle::AppKit(a) => a.ns_view.as_ptr() as usize,
                _ => return Err("Not an AppKit handle".into()),
            },
            Err(e) => return Err(format!("window_handle(): {}", e)),
        };

        let (tx, rx) = std::sync::mpsc::channel::<Result<i64, String>>();

        let _ = app_handle.run_on_main_thread(move || unsafe {
            use objc2::runtime::{AnyClass, AnyObject};
            use objc2::msg_send;

            let wk_view = &*(wk_view_ptr as *const AnyObject);

            let ns_window: *mut AnyObject = msg_send![wk_view, window];
            if ns_window.is_null() {
                let _ = tx.send(Err("NSWindow is null".into()));
                return;
            }

            let content_view: *mut AnyObject = msg_send![ns_window, contentView];
            let bounds: CGRect = msg_send![content_view, bounds];

            let ns_view_cls = match AnyClass::get(c"NSView") {
                Some(c) => c,
                None => { let _ = tx.send(Err("NSView class missing".into())); return; }
            };
            let alloc: *mut AnyObject = msg_send![ns_view_cls, alloc];
            let mpv_view: *mut AnyObject = msg_send![alloc, initWithFrame: bounds];
            if mpv_view.is_null() {
                let _ = tx.send(Err("NSView alloc/init failed".into()));
                return;
            }

            // NSViewWidthSizable(2) | NSViewHeightSizable(16)
            let _: () = msg_send![mpv_view, setAutoresizingMask: 18usize];

            // Do NOT call pre_setup_metal_layer here: we are using gpu-api=opengl
            // (macos-cocoa-cb) which attaches an NSOpenGLContext to this view.
            // A pre-existing CAMetalLayer backing layer would prevent that.

            // Place below WKWebView — NSWindowBelow=-1, relativeTo:nil = bottom
            let below: isize = -1;
            let nil_view: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![content_view, addSubview: mpv_view, positioned: below, relativeTo: nil_view];

            let wid = mpv_view as isize as i64;
            println!("[RUST] create_mpv_view: NSView ready WID={}", wid);
            let _ = tx.send(Ok(wid));
        });

        return rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|e| format!("create_mpv_view timeout: {}", e))?;
    }

    #[cfg(not(target_os = "macos"))]
    Err("create_mpv_view: macOS only".into())
}

/// On Windows: binds MPV to the HWND via set_property("wid").
/// On macOS: no-op — WID is already set by the plugin at init() time; embedding
/// is handled by attach_mpv_window after the first frame.
#[tauri::command]
fn init_mpv_window(app_handle: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_libmpv::MpvExt;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let mpv = app_handle.mpv();
        let label = match mpv.instances.lock() {
            Ok(guard) => guard.keys().next().cloned().ok_or("No MPV instance")?,
            Err(_) => return Err("Lock failed".into()),
        };
        if let Ok(handle) = window.window_handle() {
            if let RawWindowHandle::Win32(h) = handle.as_raw() {
                let wid = h.hwnd.get() as isize as i64;
                let _ = mpv.set_property("wid", &serde_json::json!(wid), &label);
                println!("[RUST] MPV bound natively to HWND WID: {}", wid);
            }
        }
    }
    let _ = (app_handle, window);
    Ok(())
}

/// Find the floating MPV NSWindow and attach it as a borderless child window
/// positioned behind the Kuma window. Called after the first rendered frame.
#[cfg(target_os = "macos")]
unsafe fn do_attach_mpv_window(kuma_ns_view: *mut std::ffi::c_void, x: f64, y: f64, w: f64, h: f64) {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    let ns_view = &*(kuma_ns_view as *const AnyObject);
    let kuma_window: *mut AnyObject = msg_send![ns_view, window];
    if kuma_window.is_null() { println!("[RUST] attach_mpv_window: kuma_window is null"); return; }

    let ns_app_cls = match AnyClass::get(c"NSApplication") {
        Some(cls) => cls,
        None => { println!("[RUST] attach_mpv_window: NSApplication not found"); return; }
    };
    let shared_app: *mut AnyObject = msg_send![ns_app_cls, sharedApplication];
    let windows: *mut AnyObject = msg_send![shared_app, windows];
    let count: usize = msg_send![windows, count];
    println!("[RUST] attach_mpv_window: scanning {} windows", count);

    let wkwebview_cls = AnyClass::get(c"WKWebView");

    for i in 0..count {
        let window: *mut AnyObject = msg_send![windows, objectAtIndex: i];
        if std::ptr::eq(window as *const _, kuma_window as *const _) { continue; }

        let content_view: *mut AnyObject = msg_send![window, contentView];
        if let Some(wk_cls) = wkwebview_cls {
            let is_webview: bool = msg_send![content_view, isKindOfClass: wk_cls];
            if is_webview { continue; }
        }

        println!("[RUST] attach_mpv_window: found MPV window at index {}", i);

        // Borderless, normal level, hidden from Mission Control
        let _: () = msg_send![window, setStyleMask: 0usize];
        let _: () = msg_send![window, setLevel: 0isize];
        let _: () = msg_send![window, setCollectionBehavior: 72usize];

        // Opaque black background: letterbox areas stay black, not see-through
        if let Some(cls) = AnyClass::get(c"NSColor") {
            let black: *mut AnyObject = msg_send![cls, blackColor];
            if !black.is_null() { let _: () = msg_send![window, setBackgroundColor: black]; }
        }
        let _: () = msg_send![window, setOpaque: true];

        // Size and attach below Kuma (NSWindowBelow = -1)
        let frame = CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } };
        let _: () = msg_send![window, setFrame: frame, display: false];
        let below: isize = -1;
        let _: () = msg_send![kuma_window, addChildWindow: window, ordered: below];

        println!("[RUST] attach_mpv_window: SUCCESS ({},{}) {}x{}", x, y, w, h);
        break;
    }
}

#[tauri::command]
fn attach_mpv_window(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        if let Some(win) = app_handle.get_webview_window("main") {
            let pos   = match win.outer_position() { Ok(p) => p, Err(_) => return };
            let size  = match win.outer_size()     { Ok(s) => s, Err(_) => return };
            let scale = match win.current_monitor() {
                Ok(Some(m)) => m.scale_factor(),
                _ => return,
            };
            let screen_h = match win.current_monitor() {
                Ok(Some(m)) => m.size().height as f64,
                _ => return,
            };

            let x   = pos.x  as f64 / scale;
            let w   = size.width  as f64 / scale;
            let h   = size.height as f64 / scale;
            let mac_y = (screen_h - pos.y as f64 - size.height as f64) / scale;

            if let Ok(handle) = win.window_handle() {
                if let RawWindowHandle::AppKit(h_raw) = handle.as_raw() {
                    let ptr = h_raw.ns_view.as_ptr() as usize;
                    let _ = app_handle.run_on_main_thread(move || unsafe {
                        do_attach_mpv_window(ptr as *mut std::ffi::c_void, x, mac_y, w, h);
                    });
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn setup_mpv_library_path() {
    // No-op on non-macOS platforms
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Start polling MPV properties (called when player opens)
#[tauri::command]
fn start_mpv_polling() {
    POLLING_ACTIVE.store(true, Ordering::SeqCst);
    println!("[RUST] MPV polling started");
}

// Stop polling MPV properties (called when player closes)
#[tauri::command]
fn stop_mpv_polling() {
    POLLING_ACTIVE.store(false, Ordering::SeqCst);
    println!("[RUST] MPV polling stopped");
}

// Commande pour changer les pistes audio/sous-titres via set_property (plus rapide que command("set"))
#[tauri::command]
fn set_mpv_track(app_handle: tauri::AppHandle, track_type: String, track_id: String) -> Result<(), String> {
    use tauri_plugin_libmpv::MpvExt;
    let mpv = app_handle.mpv();
    
    let label = match mpv.instances.lock() {
        Ok(guard) => guard.keys().next().cloned().ok_or("No MPV instance")?,
        Err(_) => return Err("Lock failed".into()),
    };

    // MPV expects sid/aid as integer (e.g. 2) or special strings ("no", "auto")
    // serde_json::json!("2") would create a string which MPV silently ignores
    let value = match track_id.parse::<i64>() {
        Ok(n) => serde_json::json!(n),       // numeric → JSON number
        Err(_) => serde_json::json!(track_id) // "no"/"auto" → JSON string
    };
    
    println!("[RUST] Track switch: {} = {} (type: {})", track_type, value, if value.is_number() { "int" } else { "str" });
    
    match mpv.set_property(&track_type, &value, &label) {
        Ok(_) => Ok(()),
        Err(e) => {
            // Fallback to command("set") which handles string parsing internally
            println!("[RUST] set_property failed ({:?}), trying command fallback", e);
            let args = vec![serde_json::json!(track_type), serde_json::json!(track_id)];
            mpv.command("set", &args, &label)
                .map_err(|e2| format!("Both set_property and command failed: {:?}", e2))
        }
    }
}

/// Load a file into MPV with an optional start time.
/// Sets the 'start' option BEFORE calling loadfile, and appends ?start= to the URL
/// so the server can use MKV index to serve from the correct byte offset.
#[tauri::command]
fn mpv_load_file(app_handle: tauri::AppHandle, url: String, start_time: Option<f64>) -> Result<(), String> {
    use tauri_plugin_libmpv::MpvExt;
    let mpv = app_handle.mpv();

    let label = match mpv.instances.lock() {
        Ok(guard) => guard.keys().next().cloned().ok_or("No MPV instance")?,
        Err(_) => return Err("Lock failed".into()),
    };

    let start = start_time.unwrap_or(0.0);

    // Build URL with start parameter for server-side MKV index seek
    let url_with_start = if start > 0.0 {
        let separator = if url.contains('?') { "&" } else { "?" };
        format!("{}{}start={}", url, separator, start as i64)
    } else {
        url
    };

    // Always reset 'start' first — if a previous load had a start time, it must be cleared
    // for the next load that doesn't need resume.
    let start_str = if start > 0.0 {
        format!("{}", start as i64)
    } else {
        "0".to_string()
    };

    let set_args = vec![
        serde_json::json!("start"),
        serde_json::json!(start_str),
    ];
    if let Err(e) = mpv.command("set", &set_args, &label) {
        println!("[RUST] Warning: failed to set start={}: {:?}", start_str, e);
    }

    println!("[RUST] mpv_load_file: {} (start={})", url_with_start, start_str);

    // macOS: re-create CAMetalLayer on the main thread right before the first frame
    // is rendered. WebKit may have reset the view's layer since .setup() ran, so we
    // refresh it here — after JS is running (WebKit fully initialised) but before
    // MoltenVK's VO thread tries vkCreateMacOSSurfaceMVK.
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        if let Some(win) = app_handle.get_webview_window("main") {
            if let Ok(handle) = win.window_handle() {
                if let RawWindowHandle::AppKit(h) = handle.as_raw() {
                    // Cast to usize (which is Send) to move across the thread boundary.
                    let ptr_usize = h.ns_view.as_ptr() as usize;
                    let _ = app_handle.run_on_main_thread(move || {
                        pre_setup_metal_layer(ptr_usize as *mut std::ffi::c_void);
                    });
                }
            }
        }
    }

    let load_args = vec![serde_json::json!(url_with_start), serde_json::json!("replace")];
    mpv.command("loadfile", &load_args, &label)
        .map_err(|e| format!("loadfile failed: {:?}", e))
}

// Load an external subtitle file into MPV
#[tauri::command]
fn mpv_add_subtitle(app_handle: tauri::AppHandle, sub_url: String) -> Result<(), String> {
    use tauri_plugin_libmpv::MpvExt;
    let mpv = app_handle.mpv();
    
    let label = match mpv.instances.lock() {
        Ok(guard) => guard.keys().next().cloned().ok_or("No MPV instance")?,
        Err(_) => return Err("Lock failed".into()),
    };

    println!("[RUST] Adding external subtitle: {}", sub_url);
    
    let args = vec![
        serde_json::json!(sub_url),
        serde_json::json!("auto"),
    ];
    
    match mpv.command("sub-add", &args, &label) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("sub-add failed: {:?}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // On macOS: stage wrapper dylib then set up library search paths
    stage_wrapper_dylib_for_bundle();
    setup_mpv_library_path();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_libmpv::init())
        .setup(|app| {
            // Pre-warm Network.framework's Swift runtime FIRST, before any MPV/network code.
            // Prevents swift_getTypeByMangledNodeImpl crash when MPV's ffmpeg calls getaddrinfo
            // from a background thread on macOS 12+ (Network.framework uses Swift internally).
            #[cfg(target_os = "macos")]
            prewarm_network_framework();

            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                if let Some(win) = app.get_webview_window("main") {
                    let win_ref: &dyn HasWindowHandle = &win;
                    if let Ok(handle) = win_ref.window_handle() {
                        if let RawWindowHandle::AppKit(h) = handle.as_raw() {
                            let ns_view_ptr = h.ns_view.as_ptr() as *mut std::ffi::c_void;
                            // pre_setup_metal_layer removed: no longer using Metal/MoltenVK;
                            // NSOpenGLView approach doesn't need a pre-created CAMetalLayer.
                            setup_window_transparency(ns_view_ptr);
                        }
                    }
                }
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_libmpv::MpvExt;
                
                let handle = app.handle().clone();
                
                // Polling thread: only polls MPV when POLLING_ACTIVE is true.
                // Sleeps longer when inactive to save CPU.
                std::thread::spawn(move || {
                    let mut tick_counter: u64 = 0;
                    let mut last_was_buffering = false;
                    
                    loop {
                        if !POLLING_ACTIVE.load(Ordering::SeqCst) {
                            // Sleep longer when inactive (500ms instead of 200ms)
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            continue;
                        }
                        
                        std::thread::sleep(std::time::Duration::from_millis(200));
                        tick_counter = tick_counter.wrapping_add(1);

                        let mpv = handle.mpv();

                        let labels = {
                            match mpv.instances.lock() {
                                Ok(guard) => guard.keys().cloned().collect::<Vec<String>>(),
                                Err(_) => Vec::new(),
                            }
                        };

                        for label in labels {
                            // Poll time-pos
                            match mpv.get_property("time-pos".to_string(), "double".to_string(), &label) {
                                Ok(value) => {
                                    if let Some(time) = value.as_f64() {
                                        let _ = handle.emit("mpv-time-update", time);
                                    }
                                }
                                Err(_) => {}
                            }
                            
                            // Poll duration
                            match mpv.get_property("duration".to_string(), "double".to_string(), &label) {
                                Ok(value) => {
                                    if let Some(duration) = value.as_f64() {
                                        let _ = handle.emit("mpv-duration", duration);
                                    }
                                }
                                Err(_) => {}
                            }
                            
                            // Poll paused-for-cache (buffering detection)
                            match mpv.get_property("paused-for-cache".to_string(), "string".to_string(), &label) {
                                Ok(value) => {
                                    let is_buffering = value.as_str() == Some("yes");
                                    if is_buffering != last_was_buffering {
                                        last_was_buffering = is_buffering;
                                        let _ = handle.emit("mpv-buffering", is_buffering);
                                    }
                                }
                                Err(_) => {}
                            }
                            
                            // Poll demuxer-cache-time (how much is buffered ahead)
                            match mpv.get_property("demuxer-cache-time".to_string(), "double".to_string(), &label) {
                                Ok(value) => {
                                    if let Some(cache_time) = value.as_f64() {
                                        let _ = handle.emit("mpv-cache-time", cache_time);
                                    }
                                }
                                Err(_) => {}
                            }
                            
                            // Poll idle-active every second (detect end of file / errors)
                            if tick_counter % 5 == 0 {
                                match mpv.get_property("idle-active".to_string(), "string".to_string(), &label) {
                                    Ok(value) => {
                                        if value.as_str() == Some("yes") {
                                            let _ = handle.emit("mpv-idle", true);
                                        }
                                    }
                                    Err(_) => {}
                                }
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::Resized(size) = event {
                mpv_metal::resize_metal_layer(size.width as f64, size.height as f64);
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_mpv_track,
            start_mpv_polling,
            stop_mpv_polling,
            mpv_add_subtitle,
            mpv_load_file,
            init_mpv_window,
            attach_mpv_window,
            create_mpv_view,
            mpv_metal_init,
            mpv_metal_load,
            mpv_metal_cmd,
            mpv_metal_set_prop,
            mpv_metal_get_prop,
            mpv_metal_resize
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
