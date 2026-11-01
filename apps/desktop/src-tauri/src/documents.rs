//! What the app does with a document on the Mac: reads it for a check, writes the signed report beside it.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The files a check reads, by extension: the library lists nothing else. The same types as `ACCEPTED_TYPES` of
/// `@yomizaka/core` (PDF, text, Word since yomizaka#229, OpenDocument since #236); the server's pre-flight decides last.
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

/// Reads a document already resolved through the scope. Refuses what a check cannot read and what is too large.
pub fn read_checkable(path: &Path, max_bytes: u64) -> Result<DocumentBytes, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let mime = mime_of(&name).ok_or("unsupported")?;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    if meta.len() > max_bytes {
        return Err("too large".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(DocumentBytes {
        name,
        mime: mime.into(),
        size: meta.len(),
        data: STANDARD.encode(bytes),
    })
}

/// A report file name the app may write: one name, no separators, `.pdf`.
fn clean_report_name(name: &str) -> Result<String, String> {
    let base = Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if base.is_empty() || base.starts_with('.') || extension(&base) != "pdf" {
        return Err("a report is a .pdf with a plain name".into());
    }
    Ok(base)
}

/// Where the signed report goes: next to the document, never over an existing file (`name (2).pdf`).
pub fn report_destination(document: &Path, name: &str) -> Result<PathBuf, String> {
    let name = clean_report_name(name)?;
    let dir = document.parent().ok_or("the document has no folder")?;
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
pub fn save_report(document: &Path, name: &str, base64_pdf: &str) -> Result<PathBuf, String> {
    let bytes = STANDARD
        .decode(base64_pdf)
        .map_err(|_| "the report is not valid base64".to_string())?;
    if !bytes.starts_with(b"%PDF") {
        return Err("the report is not a PDF".into());
    }
    let destination = report_destination(document, name)?;
    // `create_new`: a file that appeared since the name was chosen is never overwritten.
    let mut out = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|e| e.to_string())?;
    out.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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
    fn reads_a_document_as_base64_with_its_type() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("bail.pdf"), "%PDF-1.4").unwrap();
        let doc = read_checkable(&d.path().join("bail.pdf"), 1024).unwrap();
        assert_eq!(
            (doc.name.as_str(), doc.mime.as_str(), doc.size),
            ("bail.pdf", "application/pdf", 8)
        );
        assert_eq!(STANDARD.decode(doc.data).unwrap(), b"%PDF-1.4");
    }

    #[test]
    fn refuses_a_file_a_check_cannot_read_a_folder_and_a_file_too_large() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("photo.heic"), "x").unwrap();
        fs::write(d.path().join("big.pdf"), vec![0u8; 100]).unwrap();
        assert_eq!(
            read_checkable(&d.path().join("photo.heic"), 1024),
            Err("unsupported".into())
        );
        assert_eq!(
            read_checkable(&d.path().join("big.pdf"), 10),
            Err("too large".into())
        );
        fs::create_dir(d.path().join("dir.pdf")).unwrap();
        assert_eq!(
            read_checkable(&d.path().join("dir.pdf"), 10),
            Err("not a file".into())
        );
    }

    #[test]
    fn the_report_lands_next_to_the_document_and_never_over_a_file() {
        let d = tempdir().unwrap();
        let doc = d.path().join("bail.pdf");
        fs::write(&doc, "%PDF").unwrap();
        let first = save_report(
            &doc,
            "yomizaka-audit-1.pdf",
            &STANDARD.encode(b"%PDF-1.7 report"),
        )
        .unwrap();
        let second = save_report(
            &doc,
            "yomizaka-audit-1.pdf",
            &STANDARD.encode(b"%PDF-1.7 report"),
        )
        .unwrap();
        assert_eq!(first, d.path().join("yomizaka-audit-1.pdf"));
        assert_eq!(second, d.path().join("yomizaka-audit-1 (2).pdf"));
    }

    #[test]
    fn refuses_a_report_that_is_not_a_pdf_or_names_a_path() {
        let d = tempdir().unwrap();
        let doc = d.path().join("bail.pdf");
        assert!(save_report(&doc, "r.pdf", &STANDARD.encode(b"hello")).is_err());
        assert!(save_report(&doc, "r.pdf", "not base64!!").is_err());
        assert!(save_report(&doc, "r.txt", &STANDARD.encode(b"%PDF")).is_err());
        assert!(save_report(&doc, ".hidden.pdf", &STANDARD.encode(b"%PDF")).is_err());
        // A path in the name is reduced to its last part: it can never leave the document's folder.
        let out = save_report(&doc, "../../etc/evil.pdf", &STANDARD.encode(b"%PDF")).unwrap();
        assert_eq!(out, d.path().join("evil.pdf"));
    }
}
