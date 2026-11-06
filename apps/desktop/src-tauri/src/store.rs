//! The Mac's `DocumentStore` (ADR-0007): the documents Verikora keeps for the person on this Mac — « keep my history » when
//! the workspace allows it — in a folder of the app's own (`~/Library/Application Support/<bundle id>/documents`), never
//! anywhere else. The page reaches it through `apps/desktop/src/lib/mac-store.ts`, which passes the same contract test as
//! every other adapter. A key is the port's (lowercase letters, digits, `/_.-`), checked again here: no `..`, no empty or `.`
//! segment, no absolute path. A key is a name, not a path: the whole key becomes one file name (its `/` marked `~`, a sign
//! no key holds), so `a` and `a/b.pdf` are two documents, no folder is ever made from a key, and a link someone planted in
//! the store is never walked — a link in a file's own place is refused, and a write lands under an exclusive temporary name.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The longest key the port accepts (`assertKey` of `@verikora/core`).
// @fixed: the port's key rule, not a setting
const MAX_KEY: usize = 255;
const META_DIR: &str = ".meta";
/// Stands for the key's `/` in a file name: not in the key's alphabet, so two keys never share a name.
const FOLDER_MARK: char = '~';
/// How many temporary names a write tries when one is taken (a stale file, a planted link).
// @fixed: a bound on a retry, not a setting
const TEMPORARY_TRIES: u64 = 8;

#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    /// Not a key of the port, or a path that would leave the store: the page's `StorageError(400)`.
    BadKey,
    Io(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::BadKey => write!(f, "400: not a valid object key"),
            StoreError::Io(e) => write!(f, "500: {e}"),
        }
    }
}

fn io(e: std::io::Error) -> StoreError {
    StoreError::Io(e.to_string())
}

/// The port's key rule: `^[a-z0-9][a-z0-9/_.-]{0,254}$`, without `..`, `//`, a `.` segment or a trailing `/`.
pub fn check_key(key: &str) -> Result<(), StoreError> {
    let first_ok = key
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let chars_ok = key.chars().all(|c| {
        c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '/' | '_' | '.' | '-')
    });
    let dot_segment = key.split('/').any(|segment| segment == ".");
    if !first_ok
        || !chars_ok
        || key.len() > MAX_KEY
        || key.contains("..")
        || key.contains("//")
        || key.ends_with('/')
        || dot_segment
    {
        return Err(StoreError::BadKey);
    }
    Ok(())
}

/// The file name of a key: the whole key, its `/` marked, never a folder.
fn file_name_of(key: &str) -> String {
    key.replace('/', &FOLDER_MARK.to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    content_type: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredDocument {
    /// base64: the bytes cross to the page once.
    pub data: String,
    pub content_type: String,
}

pub struct FolderStore {
    root: PathBuf,
    /// Numbers this store's temporary files: with the process id, a name no other write uses.
    temporary: AtomicU64,
}

impl FolderStore {
    pub fn new(root: PathBuf) -> Self {
        FolderStore {
            root,
            temporary: AtomicU64::new(0),
        }
    }

    fn canonical_root(&self) -> Result<PathBuf, StoreError> {
        fs::create_dir_all(&self.root).map_err(io)?;
        self.root.canonicalize().map_err(io)
    }

    /// A folder of the store's own (`.meta`): made when missing, and never a link someone planted in its place.
    fn own_folder(root: &Path, name: &str) -> Result<PathBuf, StoreError> {
        let folder = root.join(name);
        match fs::symlink_metadata(&folder) {
            Ok(found) if found.file_type().is_dir() => Ok(folder),
            Ok(_) => Err(StoreError::BadKey),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&folder).map_err(io)?;
                Ok(folder)
            }
            Err(e) => Err(io(e)),
        }
    }

    /// The file of a key: one name in the store's folder (or its `.meta` folder). No folder is ever made from a key, so a link
    /// planted in the store is never walked; a link (or a folder) in the file's own place is refused.
    fn path_of(&self, base: &str, key: &str) -> Result<PathBuf, StoreError> {
        check_key(key)?;
        let root = self.canonical_root()?;
        let folder = if base.is_empty() {
            root
        } else {
            Self::own_folder(&root, base)?
        };
        let file = folder.join(file_name_of(key));
        if let Ok(found) = fs::symlink_metadata(&file) {
            if !found.file_type().is_file() {
                return Err(StoreError::BadKey);
            }
        }
        Ok(file)
    }

    fn temporary_name(&self, sequence: u64) -> String {
        format!(".tmp-{}-{sequence}", std::process::id())
    }

    /// The name the `n`-th next write of this store would use (tests plant a link there).
    #[cfg(test)]
    fn temporary_name_after(&self, n: u64) -> String {
        self.temporary_name(self.temporary.load(Ordering::Relaxed) + n)
    }

    /// A temporary file of the folder, opened exclusively: a name already taken — a stale file, a link someone planted — is
    /// left alone and the next one tried. Short, so the longest key still fits beside it.
    fn exclusive_temporary(&self, folder: &Path) -> Result<(PathBuf, fs::File), StoreError> {
        for _ in 0..TEMPORARY_TRIES {
            let path =
                folder.join(self.temporary_name(self.temporary.fetch_add(1, Ordering::Relaxed)));
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(file) => return Ok((path, file)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(io(e)),
            }
        }
        Err(StoreError::Io("no free temporary name in the store".into()))
    }

    /// The bytes land in an exclusive temporary file, then take the file's place in one move.
    fn write_atomically(&self, file: &Path, bytes: &[u8]) -> Result<(), StoreError> {
        let folder = file.parent().ok_or(StoreError::BadKey)?;
        let (temporary, mut out) = self.exclusive_temporary(folder)?;
        let written = out
            .write_all(bytes)
            .and_then(|()| out.sync_all())
            .map_err(io);
        drop(out);
        written
            .and_then(|()| fs::rename(&temporary, file).map_err(io))
            .inspect_err(|_| {
                let _ = fs::remove_file(&temporary);
            })
    }

    pub fn put(&self, key: &str, bytes: &[u8], content_type: &str) -> Result<(), StoreError> {
        let file = self.path_of("", key)?;
        let meta = self.path_of(META_DIR, key)?;
        self.write_atomically(&file, bytes)?;
        let json = serde_json::to_vec(&Meta {
            content_type: content_type.to_string(),
        })
        .map_err(|e| StoreError::Io(e.to_string()))?;
        self.write_atomically(&meta, &json)
    }

    pub fn get(&self, key: &str) -> Result<Option<StoredDocument>, StoreError> {
        let file = self.path_of("", key)?;
        let meta = self.path_of(META_DIR, key)?;
        if !file.is_file() {
            return Ok(None);
        }
        let bytes = fs::read(&file).map_err(io)?;
        let content_type = fs::read(&meta)
            .ok()
            .and_then(|raw| serde_json::from_slice::<Meta>(&raw).ok())
            .map(|m| m.content_type)
            .unwrap_or_else(|| "application/octet-stream".into());
        Ok(Some(StoredDocument {
            data: STANDARD.encode(bytes),
            content_type,
        }))
    }

    /// Idempotent: deleting what is not there succeeds.
    pub fn delete(&self, key: &str) -> Result<(), StoreError> {
        for base in ["", META_DIR] {
            let file = self.path_of(base, key)?;
            match fs::remove_file(&file) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(io(e)),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, FolderStore) {
        let d = tempdir().unwrap();
        let s = FolderStore::new(d.path().join("documents"));
        (d, s)
    }

    #[test]
    fn keeps_a_document_byte_for_byte_with_its_type_and_forgets_it_twice() {
        let (_d, s) = store();
        let bytes = [37u8, 80, 68, 70, 0, 255, 1, 2, 3];
        s.put("library/2026/bail.pdf", &bytes, "application/pdf")
            .unwrap();
        let got = s.get("library/2026/bail.pdf").unwrap().unwrap();
        assert_eq!(STANDARD.decode(got.data).unwrap(), bytes);
        assert_eq!(got.content_type, "application/pdf");
        s.delete("library/2026/bail.pdf").unwrap();
        s.delete("library/2026/bail.pdf").unwrap();
        assert_eq!(s.get("library/2026/bail.pdf").unwrap(), None);
    }

    #[test]
    fn refuses_a_key_that_could_leave_the_store() {
        let (_d, s) = store();
        for bad in [
            "../x",
            "a/../b",
            "/abs",
            "a//b",
            "UPPER/case",
            "a/b/",
            "",
            ".hidden/x",
            "a\\b",
        ] {
            assert_eq!(
                s.put(bad, b"x", "text/plain"),
                Err(StoreError::BadKey),
                "{bad:?}"
            );
            assert_eq!(s.get(bad).err(), Some(StoreError::BadKey), "{bad:?}");
        }
        assert!(s.put(&"a".repeat(MAX_KEY + 1), b"x", "text/plain").is_err());
    }

    #[test]
    fn refuses_a_dot_segment_the_shared_rule_refuses_too() {
        // `a/./b.pdf` would be `a/b.pdf` on a disk and another object in a Map: the port refuses it everywhere.
        let (_d, s) = store();
        for bad in ["a/./b.pdf", "a/.", "library/./2026/bail.pdf"] {
            assert_eq!(
                s.put(bad, b"x", "text/plain"),
                Err(StoreError::BadKey),
                "{bad:?}"
            );
            assert_eq!(s.get(bad).err(), Some(StoreError::BadKey), "{bad:?}");
        }
    }

    #[test]
    fn keeps_a_key_and_a_longer_key_under_it_apart() {
        // Keys are names, not folders: `a` and `a/b.pdf` are two documents, as in every other adapter.
        let (_d, s) = store();
        s.put("a", b"one", "text/plain").unwrap();
        s.put("a/b.pdf", b"two", "application/pdf").unwrap();
        assert_eq!(
            STANDARD.decode(s.get("a").unwrap().unwrap().data).unwrap(),
            b"one"
        );
        assert_eq!(
            STANDARD
                .decode(s.get("a/b.pdf").unwrap().unwrap().data)
                .unwrap(),
            b"two"
        );
        s.delete("a").unwrap();
        assert!(s.get("a/b.pdf").unwrap().is_some());
        assert_eq!(s.get("a").unwrap(), None);
    }

    #[test]
    fn keeps_a_key_of_the_longest_length_the_port_allows() {
        let (_d, s) = store();
        let longest = "a".repeat(MAX_KEY);
        s.put(&longest, b"x", "text/plain").unwrap();
        assert_eq!(s.get(&longest).unwrap().unwrap().content_type, "text/plain");
        s.delete(&longest).unwrap();
        assert_eq!(
            s.put(&"a".repeat(MAX_KEY + 1), b"x", "text/plain"),
            Err(StoreError::BadKey)
        );
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_a_link_planted_in_the_store() {
        let (d, s) = store();
        let outside = d.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.pdf"), "%PDF secret").unwrap();
        fs::create_dir_all(d.path().join("documents")).unwrap();
        // A folder link out of the store, and a file link to a file outside it.
        std::os::unix::fs::symlink(&outside, d.path().join("documents/escape")).unwrap();
        std::os::unix::fs::symlink(
            outside.join("secret.pdf"),
            d.path().join("documents/innocent.pdf"),
        )
        .unwrap();
        // The folder link is never looked at: the key is a name, and a nested key creates no folder, inside or out.
        assert_eq!(s.get("escape/secret.pdf").unwrap(), None);
        s.put("escape/new/sub/doc.pdf", b"x", "text/plain").unwrap();
        assert_eq!(
            STANDARD
                .decode(s.get("escape/new/sub/doc.pdf").unwrap().unwrap().data)
                .unwrap(),
            b"x"
        );
        assert!(!outside.join("new").exists());
        assert!(!outside.join("new.pdf").exists());
        // A link in the place of a document is refused, read or written, and its target is left alone.
        assert_eq!(s.get("innocent.pdf").err(), Some(StoreError::BadKey));
        assert_eq!(
            s.put("innocent.pdf", b"x", "text/plain"),
            Err(StoreError::BadKey)
        );
        assert_eq!(
            fs::read_to_string(outside.join("secret.pdf")).unwrap(),
            "%PDF secret"
        );
        assert!(
            fs::symlink_metadata(d.path().join("documents/innocent.pdf"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_planted_as_the_meta_folder_is_refused() {
        let (d, s) = store();
        let outside = d.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(d.path().join("documents")).unwrap();
        std::os::unix::fs::symlink(&outside, d.path().join("documents/.meta")).unwrap();
        assert_eq!(
            s.put("doc.pdf", b"x", "application/pdf"),
            Err(StoreError::BadKey)
        );
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        assert_eq!(s.get("doc.pdf").err(), Some(StoreError::BadKey));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_planted_where_a_temporary_file_would_go_is_never_written_through() {
        let (d, s) = store();
        let outside = d.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("target"), "untouched").unwrap();
        fs::create_dir_all(d.path().join("documents")).unwrap();
        // The next temporary name, planted as a link to a file outside the store.
        let planted = d.path().join("documents").join(s.temporary_name_after(0));
        std::os::unix::fs::symlink(outside.join("target"), &planted).unwrap();
        s.put("doc.pdf", b"%PDF", "application/pdf").unwrap();
        assert_eq!(
            STANDARD
                .decode(s.get("doc.pdf").unwrap().unwrap().data)
                .unwrap(),
            b"%PDF"
        );
        assert_eq!(
            fs::read_to_string(outside.join("target")).unwrap(),
            "untouched"
        );
        assert!(fs::symlink_metadata(&planted)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn errors_read_as_the_page_s_status() {
        assert!(StoreError::BadKey.to_string().starts_with("400"));
        assert!(StoreError::Io("disk".into()).to_string().starts_with("500"));
    }
}
