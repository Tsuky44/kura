use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // Copy libmpv DLLs to the target directory
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let profile = env::var("PROFILE").unwrap(); // "debug" or "release"
    
    // Target directory: src-tauri/target/debug or src-tauri/target/release
    let target_dir = Path::new(&manifest_dir).join("target").join(&profile);
    
    // Create target dir if it doesn't exist
    let _ = fs::create_dir_all(&target_dir);

    let dlls = ["libmpv-2.dll", "libmpv-wrapper.dll"];
    for dll in dlls {
        let src = Path::new(&manifest_dir).join(dll);
        let dest = target_dir.join(dll);
        
        if src.exists() {
            println!("cargo:rerun-if-changed={}", src.display());
            if let Err(e) = fs::copy(&src, &dest) {
                println!("cargo:warning=Failed to copy {}: {}", dll, e);
            }
        } else {
             println!("cargo:warning=DLL not found at {}. MPV may fail to load.", src.display());
        }
    }

    tauri_build::build()
}
