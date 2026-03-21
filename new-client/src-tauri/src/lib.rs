use tauri::Emitter;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Commande personnalisée pour changer les pistes de façon robuste
#[tauri::command]
fn set_mpv_track(app_handle: tauri::AppHandle, track_type: String, track_id: String) -> Result<(), String> {
    use tauri_plugin_libmpv::MpvExt;
    let mpv = app_handle.mpv();
    
    // Si aucun label n'est fourni, on prend le premier dispo
    let label = match mpv.instances.lock() {
        Ok(guard) => {
            if let Some(first) = guard.keys().next() {
                first.clone()
            } else {
                return Err("No MPV instance".into());
            }
        }
        Err(_) => return Err("Lock failed".into()),
    };

    println!("Sending command ['set', '{}', '{}'] to instance {}", track_type, track_id, label);
    
    // Au lieu d'utiliser set_property qui est capricieux sur le typage JSON,
    // on utilise la méthode `command` de MPV.
    // La méthode command du plugin prend (name: &str, args: &Vec<serde_json::Value>, label: &str)
    let command_args = vec![
        serde_json::json!(track_type),
        serde_json::json!(track_id)
    ];
    
    match mpv.command("set", &command_args, &label) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Erreur MPV Command: {:?}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_libmpv::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_libmpv::MpvExt;
                
                // Clone handles for the thread
                let handle = app.handle().clone();
                
                // Spawn a polling thread to emit time/duration events
                // Since we cannot easily modify the plugin's internal event loop,
                // polling is a robust alternative for time tracking.
                std::thread::spawn(move || {
                    let mut tick_counter = 0;
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(200));
                        tick_counter += 1;

                        // Retrieve the MPV instance via the extension trait
                        // This returns a reference &Mpv which is valid as long as handle exists
                        let mpv = handle.mpv();

                        // Get active windows to poll
                        let labels = {
                            match mpv.instances.lock() {
                                Ok(guard) => guard.keys().cloned().collect::<Vec<String>>(),
                                Err(_) => Vec::new(),
                            }
                        };
                        
                        // We will store the last track-list string to avoid spamming the frontend
                        // But since we are in a loop, we can just declare a static or use a simple var
                        // Actually, doing it per loop is fine for now, but let's avoid spam
                        // To keep it simple, we'll just emit it. It's a small array.

                        for label in labels {
                            // For track-list, doing it from Rust via 'node' format causes STATUS_ACCESS_VIOLATION
                            // on Windows because of FFI memory issues in the wrapper.
                            // We will instead expose a command so the frontend can query it explicitly.
                            
                            // Poll time-pos (f64)
                            // We use "double" format to get a number
                            match mpv.get_property("time-pos".to_string(), "double".to_string(), &label) {
                                Ok(value) => {
                                    if let Some(time) = value.as_f64() {
                                        let _ = handle.emit("mpv-time-update", time);
                                    }
                                }
                                Err(_) => {
                                    // Ignore errors (e.g. player not ready)
                                }
                            }
                            
                            // Poll duration (f64)
                            match mpv.get_property("duration".to_string(), "double".to_string(), &label) {
                                Ok(value) => {
                                    if let Some(duration) = value.as_f64() {
                                        let _ = handle.emit("mpv-duration", duration);
                                    }
                                }
                                Err(_) => {
                                    // Ignore errors
                                }
                            }
                            
                            // Poll track-list (node)
                            // We will fetch it ONCE every 2 seconds to be extremely safe against memory issues.
                            // The JSON object can be quite large for complex MKV files.
                            if tick_counter % 10 == 0 {
                                // Important: We MUST NOT use "node" format if it crashes.
                                // Some libmpv versions crash on Windows when returning complex node properties.
                                // Instead of node, we'll try to use a simpler format or avoid polling track-list in a tight loop.
                                // Actually, if "node" is causing access violation, it means the C memory allocated by mpv
                                // is being improperly freed or accessed.
                                // Let's try getting it as a string first to see if it's safer.
                                // mpv track-list as string is often useless, but let's test if it's the node format crashing it.
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, set_mpv_track])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
