use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// Global flag to control whether the polling thread is active
static POLLING_ACTIVE: once_cell::sync::Lazy<Arc<AtomicBool>> =
    once_cell::sync::Lazy::new(|| Arc::new(AtomicBool::new(false)));

#[cfg(target_os = "macos")]
fn setup_mpv_library_path() {
    use std::env;
    use std::path::PathBuf;
    
    // Get the executable directory (inside the .app bundle)
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // In a macOS app bundle: MyApp.app/Contents/MacOS/
            // Resources are in: MyApp.app/Contents/Resources/
            let resources_dir = exe_dir.parent().map(|p| p.join("Resources"));
            
            if let Some(resources) = resources_dir {
                let libmpv_path = resources.join("libmpv.dylib");
                let libmpv2_path = resources.join("libmpv.2.dylib");
                
                if libmpv_path.exists() || libmpv2_path.exists() {
                    // Set DYLD_LIBRARY_PATH to include the Resources directory
                    let current_dyld = env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
                    let new_path = format!("{}:{}", resources.display(), current_dyld);
                    env::set_var("DYLD_LIBRARY_PATH", new_path);
                    
                    println!("[RUST] Set DYLD_LIBRARY_PATH to: {}", resources.display());
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
    // Setup MPV library path on macOS before anything else
    setup_mpv_library_path();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_libmpv::init())
        .setup(|app| {
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
            mpv_load_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
