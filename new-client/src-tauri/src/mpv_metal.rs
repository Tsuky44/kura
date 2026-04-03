// mpv_metal.rs — macOS-only: true MPV embedding via WID + vo=gpu (macos-cocoa-cb).
// Clean-room implementation. Uses raw libmpv FFI + objc2.
//
// Architecture:
//  1. Create plain NSView below WKWebView (main thread).
//  2. Pass NSView pointer as `wid` option to MPV before mpv_initialize.
//  3. MPV uses vo=gpu (macos-cocoa-cb / Metal) and creates its own Metal renderer
//     as a child of our NSView. No external render context needed.
//  4. Event loop thread: mpv_wait_event → emit Tauri events for time, duration, pause.
//  5. Tauri commands: mpv_metal_init, mpv_metal_load, mpv_metal_cmd,
//                     mpv_metal_set_prop, mpv_metal_get_prop, mpv_metal_resize

#![allow(non_camel_case_types, dead_code, deprecated)]

use std::{
    ffi::{CStr, CString, c_char, c_int, c_void},
    ptr::null_mut,
    sync::{Mutex, OnceLock},
    time::Duration,
};

// ── 1. libmpv raw FFI ────────────────────────────────────────────────────────

// mpv_handle is opaque
#[repr(C)] pub struct mpv_handle { _p: [u8; 0] }

const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG:   c_int = 3;
const MPV_FORMAT_INT64:  c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_FORMAT_NODE:   c_int = 6;

// Link against libmpv (already in target dir via build.rs copy)
#[link(name = "mpv")]
unsafe extern "C" {
    fn mpv_create() -> *mut mpv_handle;
    fn mpv_initialize(ctx: *mut mpv_handle) -> c_int;
    fn mpv_terminate_destroy(ctx: *mut mpv_handle);
    fn mpv_set_option_string(ctx: *mut mpv_handle, name: *const c_char, data: *const c_char) -> c_int;
    fn mpv_command_string(ctx: *mut mpv_handle, args: *const c_char) -> c_int;
    fn mpv_set_property(ctx: *mut mpv_handle, name: *const c_char, fmt: c_int, data: *mut c_void) -> c_int;
    fn mpv_get_property(ctx: *mut mpv_handle, name: *const c_char, fmt: c_int, data: *mut c_void) -> c_int;
    fn mpv_get_property_string(ctx: *mut mpv_handle, name: *const c_char) -> *mut c_char;
    fn mpv_free(data: *mut c_void);
    fn mpv_observe_property(ctx: *mut mpv_handle, reply: u64, name: *const c_char, fmt: c_int) -> c_int;
    fn mpv_wait_event(ctx: *mut mpv_handle, timeout: f64) -> *mut MpvEvent;
}

// ── 2. MPV event structs (minimal) ─────────────────────────────────────────

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_usrdata: u64,
    data: *mut c_void,
}

const MPV_EVENT_SHUTDOWN:        c_int = 1;
const MPV_EVENT_FILE_LOADED:     c_int = 8;
const MPV_EVENT_END_FILE:        c_int = 7;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

// ── 3. Global state ─────────────────────────────────────────────────────────

struct MpvState {
    mpv: *mut mpv_handle,
    // mpv_view: raw NSView* that MPV renders into (via WID + vo=gpu / macos-cocoa-cb)
    mpv_view: *mut c_void,
}

unsafe impl Send for MpvState {}
unsafe impl Sync for MpvState {}

impl MpvState {
    fn null() -> Self { Self { mpv: null_mut(), mpv_view: null_mut() } }
}

static STATE: OnceLock<Mutex<MpvState>> = OnceLock::new();
fn state() -> &'static Mutex<MpvState> {
    STATE.get_or_init(|| Mutex::new(MpvState::null()))
}

// ── 4. ObjC helpers ──────────────────────────────────────────────────────────

use objc2::runtime::{AnyClass, AnyObject};
use objc2::msg_send;

#[repr(C)] #[derive(Copy, Clone, Default)]
struct CGPoint { x: f64, y: f64 }
#[repr(C)] #[derive(Copy, Clone, Default)]
struct CGSize  { width: f64, height: f64 }
#[repr(C)] #[derive(Copy, Clone, Default)]
struct CGRect  { origin: CGPoint, size: CGSize }

unsafe impl objc2::encode::Encode for CGPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl objc2::encode::Encode for CGSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl objc2::encode::Encode for CGRect {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

// ── 5. NSView underlayer (WID target for MPV's macos-cocoa-cb renderer) ──────

/// Create a plain NSView below the WKWebView.
/// This view is passed as `wid` to MPV. MPV's macos-cocoa-cb renderer
/// (used by vo=gpu on macOS) creates its own Metal view as a child of this view.
/// MUST be called from the main thread.
unsafe fn create_underlayer(wk_view_ptr: usize) -> Result<*mut c_void, String> {
    let wk_view = &*(wk_view_ptr as *const AnyObject);

    let ns_window: *mut AnyObject = msg_send![wk_view, window];
    if ns_window.is_null() { return Err("NSWindow is null".into()); }

    let content_view: *mut AnyObject = msg_send![ns_window, contentView];
    let bounds: CGRect = msg_send![content_view, bounds];

    let ns_view_cls = AnyClass::get(c"NSView").ok_or("NSView class not found")?;
    let alloc: *mut AnyObject = msg_send![ns_view_cls, alloc];
    let mpv_view: *mut AnyObject = msg_send![alloc, initWithFrame: bounds];
    if mpv_view.is_null() { return Err("NSView alloc/init failed".into()); }

    // Auto-resize with the window
    let _: () = msg_send![mpv_view, setAutoresizingMask: 18usize]; // NSViewWidthSizable|HeightSizable
    // Layer-backed so it composites correctly with WKWebView above it
    let _: () = msg_send![mpv_view, setWantsLayer: true];

    // Insert at the bottom of the window's content view (below WKWebView)
    let below: isize = -1;
    let nil_view: *mut AnyObject = null_mut();
    let _: () = msg_send![content_view, addSubview: mpv_view, positioned: below, relativeTo: nil_view];

    println!("[MPV-WID] NSView={:p} created below WKWebView", mpv_view);
    Ok(mpv_view as *mut c_void)
}

// ── 6. Public init function ───────────────────────────────────────────────────────

/// Called from `mpv_metal_init` Tauri command (main thread via run_on_main_thread).
/// Creates a plain NSView below WKWebView, creates MPV context with `wid` pointing
/// to that NSView, and starts the event loop.
/// MPV uses vo=gpu (macos-cocoa-cb / Metal) which creates its own Metal renderer
/// inside our NSView. No external render context needed.
pub fn init_mpv_metal(
    wk_view_ptr: usize,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Shutdown any previous instance before re-initializing
    {
        let s = state().lock().unwrap();
        if !s.mpv.is_null() {
            drop(s);
            shutdown_mpv_metal();
        }
    }

    // --- Create plain NSView below WKWebView (must be main thread)
    let mpv_view = unsafe { create_underlayer(wk_view_ptr)? };

    // --- Create MPV context
    let ctx = unsafe { mpv_create() };
    if ctx.is_null() { return Err("mpv_create() failed".into()); }

    unsafe {
        libc::setlocale(libc::LC_NUMERIC, b"C\0".as_ptr().cast());

        // wid: embed MPV into our NSView (vo=gpu uses macos-cocoa-cb / Metal).
        // Must be set BEFORE mpv_initialize.
        let wid_str = CString::new(format!("{}", mpv_view as usize)).unwrap();
        mpv_set_option_string(ctx, c"wid".as_ptr(), wid_str.as_ptr());

        mpv_set_option_string(ctx, c"hwdec".as_ptr(),      c"videotoolbox".as_ptr());
        mpv_set_option_string(ctx, c"hwdec-codecs".as_ptr(), c"all".as_ptr());
        mpv_set_option_string(ctx, c"idle".as_ptr(),       c"yes".as_ptr());
        mpv_set_option_string(ctx, c"keep-open".as_ptr(),  c"yes".as_ptr());
        mpv_set_option_string(ctx, c"ytdl".as_ptr(),       c"no".as_ptr());
        mpv_set_option_string(ctx, c"cache".as_ptr(),      c"yes".as_ptr());
        mpv_set_option_string(ctx, c"input-default-bindings".as_ptr(), c"yes".as_ptr());
        mpv_set_option_string(ctx, c"log-file".as_ptr(),   c"/tmp/mpv-kuma.log".as_ptr());
        mpv_set_option_string(ctx, c"msg-level".as_ptr(),  c"all=v".as_ptr());

        let rc = mpv_initialize(ctx);
        if rc < 0 {
            mpv_terminate_destroy(ctx);
            return Err(format!("mpv_initialize failed: {rc}"));
        }
    }
    println!("[MPV-WID] mpv_initialize OK, wid={}", mpv_view as usize);

    // --- Store state
    {
        let mut s = state().lock().unwrap();
        s.mpv      = ctx;
        s.mpv_view = mpv_view;
    }

    // --- Start event loop thread (property observations → Tauri events)
    let ctx_usize = ctx as usize;
    std::thread::spawn(move || {
        event_loop(ctx_usize as *mut mpv_handle, app_handle);
    });

    Ok(())
}

// ── 7. Event loop (property observations → Tauri events) ───────────────────

fn event_loop(ctx: *mut mpv_handle, app_handle: tauri::AppHandle) {
    use tauri::Emitter;
    unsafe {
        // Observe properties
        mpv_observe_property(ctx, 1, c"time-pos".as_ptr(), MPV_FORMAT_DOUBLE);
        mpv_observe_property(ctx, 2, c"duration".as_ptr(), MPV_FORMAT_DOUBLE);
        mpv_observe_property(ctx, 3, c"pause".as_ptr(), MPV_FORMAT_FLAG);
        mpv_observe_property(ctx, 4, c"volume".as_ptr(), MPV_FORMAT_DOUBLE);
        mpv_observe_property(ctx, 5, c"buffering-active".as_ptr(), MPV_FORMAT_FLAG);
        mpv_observe_property(ctx, 6, c"track-list".as_ptr(), MPV_FORMAT_NODE);

        loop {
            let event = &*mpv_wait_event(ctx, 5.0);
            println!("[MPV-EVT] id={}", event.event_id);
            match event.event_id {
                MPV_EVENT_SHUTDOWN => break,
                MPV_EVENT_FILE_LOADED => {
                    println!("[MPV-EVT] FILE_LOADED");
                    let _ = app_handle.emit("mpv-file-loaded", ());
                }
                MPV_EVENT_END_FILE => {
                    let _ = app_handle.emit("mpv-end-file", ());
                }
                MPV_EVENT_PROPERTY_CHANGE => {
                    if event.data.is_null() { continue; }
                    let prop = &*(event.data as *const MpvEventProperty);
                    let name = CStr::from_ptr(prop.name).to_str().unwrap_or("");
                    match name {
                        "time-pos" if prop.format == MPV_FORMAT_DOUBLE => {
                            let val = *(prop.data as *const f64);
                            let _ = app_handle.emit("mpv-time-update", val);
                        }
                        "duration" if prop.format == MPV_FORMAT_DOUBLE => {
                            let val = *(prop.data as *const f64);
                            let _ = app_handle.emit("mpv-duration", val);
                        }
                        "pause" if prop.format == MPV_FORMAT_FLAG => {
                            let val = *(prop.data as *const c_int) != 0;
                            let _ = app_handle.emit("mpv-pause-state", val);
                        }
                        "volume" if prop.format == MPV_FORMAT_DOUBLE => {
                            let val = *(prop.data as *const f64);
                            let _ = app_handle.emit("mpv-volume-change", val);
                        }
                        "buffering-active" if prop.format == MPV_FORMAT_FLAG => {
                            let val = *(prop.data as *const c_int) != 0;
                            let _ = app_handle.emit("mpv-buffering", val);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
    println!("[MPV-METAL] event loop exited");
}

// ── 9. Tauri command helpers ────────────────────────────────────────────────

fn with_ctx<T, F: FnOnce(*mut mpv_handle) -> T>(f: F) -> Result<T, String> {
    let s = state().lock().unwrap();
    if s.mpv.is_null() { return Err("MPV not initialized".into()); }
    Ok(f(s.mpv))
}

// ── 9. Resize helper ──────────────────────────────────────────────────────────

/// Called from on_window_event Resized handler.
/// With vo=gpu + wid, MPV's CocoaCB renderer auto-resizes because the NSView has
/// setAutoresizingMask:18. A video-reconfig command nudges MPV to update its viewport.
pub fn resize_metal_layer(_physical_w: f64, _physical_h: f64) {
    let mpv = {
        let s = state().lock().unwrap();
        if s.mpv.is_null() { return; }
        s.mpv
    };
    unsafe {
        mpv_command_string(mpv, c"video-reconfig".as_ptr());
    }
}

// ── 10. Cleanup ───────────────────────────────────────────────────────────────

pub fn shutdown_mpv_metal() {
    let mpv = {
        let mut s = state().lock().unwrap();
        let m = s.mpv;
        s.mpv      = null_mut();
        s.mpv_view = null_mut();
        m
    };
    if !mpv.is_null() {
        unsafe { mpv_terminate_destroy(mpv) };
    }
    println!("[MPV-WID] shutdown complete");
}

// ── 12. Tauri commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn mpv_metal_init(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let win = app_handle
        .get_webview_window("main")
        .ok_or("main window not found")?;

    let wk_view_ptr = match win.window_handle() {
        Ok(h) => match h.as_raw() {
            RawWindowHandle::AppKit(a) => a.ns_view.as_ptr() as usize,
            _ => return Err("Not AppKit".into()),
        },
        Err(e) => return Err(e.to_string()),
    };

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let ah = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        let res = unsafe { init_mpv_metal(wk_view_ptr, ah) };
        let _ = tx.send(res);
    });

    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "mpv_metal_init timeout".to_string())?
}

#[tauri::command]
pub fn mpv_metal_load(url: String, start_time: Option<f64>) -> Result<(), String> {
    let start = start_time.unwrap_or(0.0);
    with_ctx(|ctx| {
        unsafe {
            // Use MPV's `start` option for seeking — do NOT append to URL
            // (appending &start= causes some servers to return non-standard data)
            let start_str = CString::new(format!("{}", start as i64)).unwrap();
            mpv_set_option_string(ctx, c"start".as_ptr(), start_str.as_ptr());

            let cmd = CString::new(format!("loadfile \"{}\" replace", url.replace('"', "%22"))).unwrap();
            println!("[MPV-WID] loadfile: {url} (start={}s)", start as i64);
            mpv_command_string(ctx, cmd.as_ptr());
        }
    })
}

#[tauri::command]
pub fn mpv_metal_cmd(name: String, args: Vec<serde_json::Value>) -> Result<(), String> {
    with_ctx(|ctx| {
        unsafe {
            // Build "name arg0 arg1 ..." as a single command string (simple)
            let mut parts = vec![name.clone()];
            for a in &args {
                parts.push(a.as_str().unwrap_or(&a.to_string().replace('"', "")).to_string());
            }
            let cmd = CString::new(parts.join(" ")).unwrap();
            mpv_command_string(ctx, cmd.as_ptr());
        }
    })
}

#[tauri::command]
pub fn mpv_metal_set_prop(name: String, value: serde_json::Value) -> Result<(), String> {
    with_ctx(|ctx| {
        let c_name = CString::new(name.as_str()).unwrap();
        unsafe {
            if let Some(b) = value.as_bool() {
                let mut v: c_int = if b { 1 } else { 0 };
                mpv_set_property(ctx, c_name.as_ptr(), MPV_FORMAT_FLAG, &mut v as *mut _ as *mut _);
            } else if let Some(n) = value.as_f64() {
                // Could be int or double — try int first for common props
                if value.is_i64() || value.is_u64() {
                    let mut v: i64 = n as i64;
                    mpv_set_property(ctx, c_name.as_ptr(), MPV_FORMAT_INT64, &mut v as *mut _ as *mut _);
                } else {
                    let mut v: f64 = n;
                    mpv_set_property(ctx, c_name.as_ptr(), MPV_FORMAT_DOUBLE, &mut v as *mut _ as *mut _);
                }
            } else {
                let owned = value.to_string();
                let s = value.as_str().unwrap_or(&owned);
                let c_val = CString::new(s).unwrap();
                mpv_set_property(ctx, c_name.as_ptr(), MPV_FORMAT_STRING, c_val.as_ptr() as *mut _);
            }
        }
    })
}

#[tauri::command]
pub fn mpv_metal_get_prop(name: String) -> Result<serde_json::Value, String> {
    with_ctx(|ctx| {
        let c_name = CString::new(name.as_str()).unwrap();
        unsafe {
            let ptr = mpv_get_property_string(ctx, c_name.as_ptr());
            if ptr.is_null() { return serde_json::Value::Null; }
            let s = CStr::from_ptr(ptr).to_str().unwrap_or("").to_owned();
            mpv_free(ptr as *mut _);
            // Try to parse as number or bool
            if let Ok(v) = s.parse::<f64>() { return serde_json::json!(v); }
            if s == "yes" || s == "true" { return serde_json::json!(true); }
            if s == "no" || s == "false" { return serde_json::json!(false); }
            serde_json::json!(s)
        }
    })
}

#[tauri::command]
pub fn mpv_metal_resize(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let win = app_handle.get_webview_window("main").ok_or("no window")?;
    let size = win.inner_size().map_err(|e| e.to_string())?;
    resize_metal_layer(size.width as f64, size.height as f64);
    Ok(())
}
