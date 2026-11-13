//! Verikora for the Mac. What every Krizaka Mac app does the same way — the folders the person grants (and watches), the
//! files dropped on the window, the session in the Keychain, the native menu, `verikora://` links, the navigation guard —
//! is `tauri-plugin-krizaka` (krizaka-tauri-kit). Here are only Verikora's own commands: list a folder's documents, read
//! one for the check that needs it, write the signed report next to it — each path through the kit's one gate.

mod documents;
mod error;
mod store;

use error::DocumentError;
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_krizaka::kit::files::{self, Limits, Listing};
use tauri_plugin_krizaka::KitExt;

/// The documents of a granted folder: what a check reads, and the folders, folders first.
#[tauri::command]
fn list_documents(app: AppHandle, path: String) -> Result<Listing, DocumentError> {
    let dir = app.kit().resolve(Path::new(&path))?;
    let mut listing = files::list_dir(&dir, &Limits::default())?;
    listing
        .entries
        .retain(|e| e.is_dir || documents::is_checkable(&e.name));
    Ok(listing)
}

/// One document's bytes, for the one check that needs them. The largest file read is the limit the page passes: the
/// server's own (`limits.maxFileMb`). The kit lowers it to its ceiling; with none, the kit's default stands.
#[tauri::command]
fn read_document(
    app: AppHandle,
    path: String,
    limits: Option<Limits>,
) -> Result<documents::DocumentBytes, DocumentError> {
    let file = app.kit().resolve(Path::new(&path))?;
    documents::read_checkable(&file, limits.unwrap_or_default().send())
}

/// Writes the signed report next to its document; the folder is the document's, resolved through the same gate.
#[tauri::command]
fn save_report(
    app: AppHandle,
    document: String,
    name: String,
    data: String,
) -> Result<String, DocumentError> {
    let file = app.kit().resolve(Path::new(&document))?;
    documents::save_report(file.as_path(), &name, &data).map(|p| p.display().to_string())
}

/// The Mac's DocumentStore (ADR-0007): documents kept on this Mac, in the app's own folder. Errors start with the status
/// the page's adapter maps (`400:` a key that is not the port's).
#[tauri::command]
fn store_put(
    store: State<'_, store::FolderStore>,
    key: String,
    data: String,
    content_type: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(data)
        .map_err(|_| "400: not base64".to_string())?;
    store
        .put(&key, &bytes, &content_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn store_get(
    store: State<'_, store::FolderStore>,
    key: String,
) -> Result<Option<store::StoredDocument>, String> {
    store.get(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_delete(store: State<'_, store::FolderStore>, key: String) -> Result<(), String> {
    store.delete(&key).map_err(|e| e.to_string())
}

pub fn run() {
    let builder = tauri::Builder::default();
    // The Mac journey's embedded WebDriver (verikora#636, 127.0.0.1:4445): a debug build with `--features webdriver`, never a release.
    #[cfg(all(debug_assertions, feature = "webdriver"))]
    let builder = builder.plugin(tauri_plugin_webdriver::init());
    builder
        // The API calls go through Rust's HTTP client (no CORS), to Verikora's own addresses (the capability).
        .plugin(tauri_plugin_http::init())
        // The folder picker the kit's commands open (re-exported by the kit).
        .plugin(tauri_plugin_krizaka::dialog::init())
        .plugin(
            tauri_plugin_krizaka::Builder::new("verikora")
                .link_hosts(["www.verikora.com", "dev.verikora.com"])
                .link_prefixes(["/app"])
                .build(),
        )
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("documents");
            app.manage(store::FolderStore::new(root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_documents,
            read_document,
            save_report,
            store_put,
            store_get,
            store_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Verikora");
}
