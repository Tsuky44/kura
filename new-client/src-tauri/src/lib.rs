use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// Global flag to control whether the polling thread is active
static POLLING_ACTIVE: once_cell::sync::Lazy<Arc<AtomicBool>> =
    once_cell::sync::Lazy::new(|| Arc::new(AtomicBool::new(false)));

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

// ── CGRect types for ObjC frame passing ─────────────────────────────────────
#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Copy, Clone, Default)]
struct CGPoint { x: f64, y: f64 }

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Copy, Clone, Default)]
struct CGSize { width: f64, height: f64 }

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Copy, Clone, Default)]
struct CGRect { origin: CGPoint, size: CGSize }

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

/// Find the MPV NSWindow (any non-WKWebView window) and attach it as a child
/// window below the Kuma window so it moves/hides with Kuma and shows through
/// the transparent WebView area.
#[cfg(target_os = "macos")]
unsafe fn do_attach_mpv_window(kuma_ns_view: *mut std::ffi::c_void, x: f64, y: f64, w: f64, h: f64) {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    let ns_view = &*(kuma_ns_view as *const AnyObject);

    let kuma_window: *mut AnyObject = msg_send![ns_view, window];
    if kuma_window.is_null() {
        println!("[RUST] attach_mpv_window: kuma_window is null");
        return;
    }

    let ns_app_cls = match AnyClass::get(c"NSApplication") {
        Some(cls) => cls,
        None => { println!("[RUST] attach_mpv_window: NSApplication class not found"); return; }
    };
    let shared_app: *mut AnyObject = msg_send![ns_app_cls, sharedApplication];
    let windows: *mut AnyObject = msg_send![shared_app, windows];
    let count: usize = msg_send![windows, count];

    println!("[RUST] attach_mpv_window: scanning {} windows", count);

    let wkwebview_cls = AnyClass::get(c"WKWebView");

    for i in 0..count {
        let window: *mut AnyObject = msg_send![windows, objectAtIndex: i];
        if std::ptr::eq(window as *const _, kuma_window as *const _) { continue; }

        // Skip any WKWebView-based window (DevTools, other Tauri windows)
        let content_view: *mut AnyObject = msg_send![window, contentView];
        if let Some(wk_cls) = wkwebview_cls {
            let is_webview: bool = msg_send![content_view, isKindOfClass: wk_cls];
            if is_webview { continue; }
        }

        println!("[RUST] attach_mpv_window: found MPV window at index {}", i);

        // Borderless window (NSWindowStyleMaskBorderless = 0)
        let _: () = msg_send![window, setStyleMask: 0usize];

        // Normal window level (NSNormalWindowLevel = 0) – MPV sometimes creates at
        // NSFloatingWindowLevel which would keep it above the IDE when Kuma is unfocused.
        let _: () = msg_send![window, setLevel: 0isize];

        // Hide from Mission Control / Exposé / window cycling so it is invisible as
        // a separate window to the user (NSWindowCollectionBehaviorTransient=8 |
        // NSWindowCollectionBehaviorIgnoresCycle=64 = 72).
        let _: () = msg_send![window, setCollectionBehavior: 72usize];

        // Opaque black background so letterbox areas don't bleed through Kuma's
        // transparent WebView (without this, the desktop/IDE shows around the video).
        if let Some(ns_color_cls) = AnyClass::get(c"NSColor") {
            let black: *mut AnyObject = msg_send![ns_color_cls, blackColor];
            if !black.is_null() {
                let _: () = msg_send![window, setBackgroundColor: black];
            }
        }
        let _: () = msg_send![window, setOpaque: true];

        // Position MPV window to exactly match Kuma's frame
        let frame = CGRect {
            origin: CGPoint { x, y },
            size: CGSize { width: w, height: h },
        };
        let _: () = msg_send![window, setFrame: frame, display: false];

        // Attach as child window ordered BELOW Kuma (NSWindowBelow = -1)
        let below: isize = -1;
        let _: () = msg_send![kuma_window, addChildWindow: window, ordered: below];

        println!("[RUST] attach_mpv_window: SUCCESS attached MPV at ({},{}) {}x{}", x, y, w, h);
        break;
    }
}

/// Tauri command: called from the frontend when MPV renders its first frame.
/// Finds the floating MPV window and reparents it as a borderless child window
/// positioned exactly behind the Kuma window.
#[tauri::command]
fn attach_mpv_window(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        if let Some(win) = app_handle.get_webview_window("main") {
            // Use Tauri API to get window geometry (no ObjC struct returns needed)
            let pos = match win.outer_position() {
                Ok(p) => p,
                Err(e) => { println!("[RUST] attach_mpv_window: outer_position failed: {}", e); return; }
            };
            let size = match win.outer_size() {
                Ok(s) => s,
                Err(e) => { println!("[RUST] attach_mpv_window: outer_size failed: {}", e); return; }
            };
            let monitor = match win.current_monitor() {
                Ok(Some(m)) => m,
                _ => { println!("[RUST] attach_mpv_window: no monitor found"); return; }
            };

            let scale = monitor.scale_factor();
            let screen_h_px = monitor.size().height as f64;

            // Convert Tauri physical pixels (top-left origin) → macOS logical points (bottom-left origin)
            let x_pts = pos.x as f64 / scale;
            let w_pts = size.width as f64 / scale;
            let h_pts = size.height as f64 / scale;
            let mac_y_pts = (screen_h_px - pos.y as f64 - size.height as f64) / scale;

            if let Ok(handle) = win.window_handle() {
                if let RawWindowHandle::AppKit(h) = handle.as_raw() {
                    let ptr_usize = h.ns_view.as_ptr() as usize;
                    let _ = app_handle.run_on_main_thread(move || unsafe {
                        do_attach_mpv_window(ptr_usize as *mut std::ffi::c_void, x_pts, mac_y_pts, w_pts, h_pts);
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
            // On macOS: pre-create CAMetalLayer on the NSView from the main thread
            // so MoltenVK finds it ready and skips its own thread-unsafe surface creation.
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use raw_window_handle::{HasWindowHandle, RawWindowHandle};
                if let Some(win) = app.get_webview_window("main") {
                    let win_ref: &dyn HasWindowHandle = &win;
                    if let Ok(handle) = win_ref.window_handle() {
                        if let RawWindowHandle::AppKit(h) = handle.as_raw() {
                            let ns_view_ptr = h.ns_view.as_ptr() as *mut std::ffi::c_void;
                            pre_setup_metal_layer(ns_view_ptr);
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
        .invoke_handler(tauri::generate_handler![
            greet,
            set_mpv_track,
            start_mpv_polling,
            stop_mpv_polling,
            mpv_add_subtitle,
            mpv_load_file,
            attach_mpv_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
