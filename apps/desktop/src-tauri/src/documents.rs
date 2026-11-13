//! What the app does with a document on the Mac: reads it for a check, writes the signed report beside it.

use crate::error::DocumentError;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri_plugin_krizaka::kit::scope::ScopedPath;

/// The files a check reads, by extension: the library lists nothing else. The same types as `ACCEPTED_TYPES` of
/// `@verikora/core` (PDF, text, Word since verikora#229, OpenDocument since #236); the server's pre-flight decides last.
const CHECKABLE: &[(&str, &str)] = &[
    ("pdf", "application/pdf"),
    ("txt", "text/plain"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ("odt", "application/vnd.oasis.opendocument.text"),
];

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn mime_of(name: &str) -> Option<&'static str> {
    let ext = extension(name);
    CHECKABLE
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, mime)| *mime)
}

pub fn is_checkable(name: &str) -> bool {
    mime_of(name).is_some()
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBytes {
    pub name: String,
    pub mime: String,
    pub size: u64,
    /// base64 of the file: it crosses to the page once, for the one check that needs it.
    pub data: String,
}

/// Reads a document resolved through the scope, from one descriptor (the kit confirmed it is still inside the grant).
/// Refuses what a check cannot read and what is too large.
pub fn read_checkable(path: &ScopedPath, max_bytes: u64) -> Result<DocumentBytes, DocumentError> {
    let name = path
        .as_path()
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let mime = mime_of(&name).ok_or(DocumentError::Unsupported)?;
    let file = path.open()?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(DocumentError::NotAFile);
    }
    if meta.len() > max_bytes {
        return Err(DocumentError::TooLarge);
    }
    // One byte more than the limit: a file that grew since the metadata is caught, never read whole.
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(DocumentError::TooLarge);
    }
    Ok(DocumentBytes {
        name,
        mime: mime.into(),
        size: bytes.len() as u64,
        data: STANDARD.encode(bytes),
    })
}

/// A report file name the app may write: one name, no separators, `.pdf`.
fn clean_report_name(name: &str) -> Result<String, DocumentError> {
    let base = Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if base.is_empty() || base.starts_with('.') || extension(&base) != "pdf" {
        return Err(DocumentError::BadReportName);
    }
    Ok(base)
}

/// Where the signed report goes: next to the document, never over an existing file (`name (2).pdf`).
pub fn report_destination(document: &Path, name: &str) -> Result<PathBuf, DocumentError> {
    let name = clean_report_name(name)?;
    let dir = document.parent().ok_or(DocumentError::NoFolder)?;
    let stem = Path::new(&name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut candidate = dir.join(&name);
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}).pdf"));
        n += 1;
    }
    Ok(candidate)
}

/// Writes the report. The document's folder was resolved through the scope by the caller.
pub fn save_report(
    document: &Path,
    name: &str,
    base64_pdf: &str,
) -> Result<PathBuf, DocumentError> {
    let bytes = STANDARD
        .decode(base64_pdf)
        .map_err(|_| DocumentError::ReportNotBase64)?;
    if !bytes.starts_with(b"%PDF") {
        return Err(DocumentError::ReportNotPdf);
    }
    let destination = report_destination(document, name)?;
    // `create_new`: a file that appeared since the name was chosen is never overwritten.
    let mut out = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)?;
    out.write_all(&bytes)?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_krizaka::kit::scope::{ScopeError, ScopeStore};
    use tempfile::tempdir;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// A fake home with a granted `Documents` folder: the files of a test are resolved through the real gate.
    struct Granted {
        _home: tempfile::TempDir,
        folder: PathBuf,
        scope: ScopeStore,
        home: PathBuf,
    }

    fn granted() -> Result<Granted, Box<dyn std::error::Error>> {
        let tmp = tempdir()?;
        let home = tmp.path().canonicalize()?;
        fs::create_dir(home.join("Documents"))?;
        let mut scope = ScopeStore::default();
        let folder = scope.grant_with_home(&home.join("Documents"), Some(&home))?;
        Ok(Granted {
            _home: tmp,
            folder,
            scope,
            home,
        })
    }

    impl Granted {
        fn resolve(&mut self, name: &str) -> Result<ScopedPath, ScopeError> {
            self.scope
                .resolve_with_home(&self.folder.join(name), Some(&self.home))
        }
    }

    #[test]
    fn lists_only_what_a_check_reads() {
        for (name, ok) in [
            ("bail.pdf", true),
            ("BAIL.PDF", true),
            ("notes.txt", true),
            ("bail.docx", true),
            ("bail.odt", true),
            ("photo.heic", false),
            ("sheet.xlsx", false),
            ("noext", false),
        ] {
            assert_eq!(is_checkable(name), ok, "{name}");
        }
        assert_eq!(mime_of("a.PDF"), Some("application/pdf"));
    }

    #[test]
    fn reads_a_document_as_base64_with_its_type() -> TestResult {
        let mut g = granted()?;
        fs::write(g.folder.join("bail.pdf"), "%PDF-1.4")?;
        let doc = read_checkable(&g.resolve("bail.pdf")?, 1024)?;
        assert_eq!(
            (doc.name.as_str(), doc.mime.as_str(), doc.size),
            ("bail.pdf", "application/pdf", 8)
        );
        assert_eq!(STANDARD.decode(doc.data)?, b"%PDF-1.4");
        Ok(())
    }

    #[test]
    fn refuses_a_file_a_check_cannot_read_a_folder_and_a_file_too_large() -> TestResult {
        let mut g = granted()?;
        fs::write(g.folder.join("photo.heic"), "x")?;
        fs::write(g.folder.join("big.pdf"), vec![0u8; 100])?;
        fs::create_dir(g.folder.join("dir.pdf"))?;
        for (name, max, code) in [
            ("photo.heic", 1024, "unsupported"),
            ("big.pdf", 10, "too_large"),
            ("dir.pdf", 10, "not_a_file"),
        ] {
            let refused = read_checkable(&g.resolve(name)?, max).err();
            assert_eq!(refused.map(|e| e.code()), Some(code), "{name}");
        }
        Ok(())
    }

    #[test]
    fn the_report_lands_next_to_the_document_and_never_over_a_file() -> TestResult {
        let d = tempdir()?;
        let doc = d.path().join("bail.pdf");
        fs::write(&doc, "%PDF")?;
        let pdf = STANDARD.encode(b"%PDF-1.7 report");
        let first = save_report(&doc, "verikora-audit-1.pdf", &pdf)?;
        let second = save_report(&doc, "verikora-audit-1.pdf", &pdf)?;
        assert_eq!(first, d.path().join("verikora-audit-1.pdf"));
        assert_eq!(second, d.path().join("verikora-audit-1 (2).pdf"));
        Ok(())
    }

    #[test]
    fn refuses_a_report_that_is_not_a_pdf_or_names_a_path() -> TestResult {
        let d = tempdir()?;
        let doc = d.path().join("bail.pdf");
        let pdf = STANDARD.encode(b"%PDF");
        for (name, data, code) in [
            ("r.pdf", STANDARD.encode(b"hello"), "report_not_pdf"),
            ("r.pdf", "not base64!!".to_string(), "report_not_base64"),
            ("r.txt", pdf.clone(), "bad_report_name"),
            (".hidden.pdf", pdf.clone(), "bad_report_name"),
        ] {
            let refused = save_report(&doc, name, &data).err();
            assert_eq!(refused.map(|e| e.code()), Some(code), "{name}");
        }
        // A path in the name is reduced to its last part: it can never leave the document's folder.
        let out = save_report(&doc, "../../etc/evil.pdf", &pdf)?;
        assert_eq!(out, d.path().join("evil.pdf"));
        Ok(())
    }
}
