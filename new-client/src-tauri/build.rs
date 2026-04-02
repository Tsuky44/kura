use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // Copy libmpv libraries to the target directory
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let profile = env::var("PROFILE").unwrap(); // "debug" or "release"
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    
    // Target directory: src-tauri/target/debug or src-tauri/target/release
    let target_dir = Path::new(&manifest_dir).join("target").join(&profile);
    
    // Create target dir if it doesn't exist
    let _ = fs::create_dir_all(&target_dir);

    // Platform-specific libraries
    if target_os == "windows" {
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
    } else if target_os == "macos" {

        // Copy libmpv-wrapper.dylib and fix its install name so dladdr returns
        // the correct load path (needed by the wrapper's get_current_dir()).
        let wrapper = "libmpv-wrapper.dylib";
        let wrapper_src = Path::new(&manifest_dir).join(wrapper);
        let wrapper_dest = target_dir.join(wrapper);
        if wrapper_src.exists() {
            println!("cargo:rerun-if-changed={}", wrapper_src.display());
            if let Err(e) = fs::copy(&wrapper_src, &wrapper_dest) {
                println!("cargo:warning=Failed to copy {}: {}", wrapper, e);
            } else {
                // Fix install name so dladdr returns the actual load path
                let fix_id = std::process::Command::new("install_name_tool")
                    .args(["-id", "@loader_path/libmpv-wrapper.dylib", wrapper_dest.to_str().unwrap()])
                    .output();
                if let Ok(out) = &fix_id {
                    if !out.status.success() {
                        println!("cargo:warning=install_name_tool -id failed for {}: {}", wrapper, String::from_utf8_lossy(&out.stderr));
                    }
                }
                // Add @loader_path rpath so wrapper resolves @rpath deps from same dir
                let _ = std::process::Command::new("install_name_tool")
                    .args(["-add_rpath", "@loader_path", wrapper_dest.to_str().unwrap()])
                    .output();
                // Re-sign with ad-hoc signature after modifying
                let resign = std::process::Command::new("codesign")
                    .args(["--sign", "-", "--force", wrapper_dest.to_str().unwrap()])
                    .output();
                if let Ok(out) = &resign {
                    if !out.status.success() {
                        println!("cargo:warning=codesign failed for {}: {}", wrapper, String::from_utf8_lossy(&out.stderr));
                    }
                }
            }
        } else {
            println!("cargo:warning=Dylib not found at {}. MPV may fail to load.", wrapper_src.display());
        }

        // Copy libmpv libs from libs/ directory and fix their install names.
        // These libs depend on Homebrew paths which are preserved intentionally –
        // the system Homebrew install satisfies them at runtime.
        let mpv_libs = ["libmpv.dylib", "libmpv.2.dylib"];
        let libs_dir = Path::new(&manifest_dir).join("libs");
        for lib in mpv_libs {
            let src = libs_dir.join(lib);
            let dest = target_dir.join(lib);
            if src.exists() {
                println!("cargo:rerun-if-changed={}", src.display());
                if let Err(e) = fs::copy(&src, &dest) {
                    println!("cargo:warning=Failed to copy {}: {}", lib, e);
                } else {
                    // Re-sign so the ad-hoc signature is valid on this machine
                    let _ = std::process::Command::new("codesign")
                        .args(["--sign", "-", "--force", dest.to_str().unwrap()])
                        .output();
                }
            }
        }
    }

    tauri_build::build()
}
