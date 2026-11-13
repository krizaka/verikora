//! What a Verikora command answers when it fails: a stable `code` the page reads, and one fixed sentence. The kit's own
//! failures (a path outside the granted folders, a listing that fails) keep the kit's code.

use serde::{Serialize, Serializer};
use std::fmt;
use tauri_plugin_krizaka::kit::files::FilesError;
use tauri_plugin_krizaka::kit::scope::ScopeError;
use tauri_plugin_krizaka::CommandError;

#[derive(Debug)]
pub enum DocumentError {
    /// The kit refused or failed: its code and sentence are the wire's.
    Kit(CommandError),
    /// The file's type is not one a check reads.
    Unsupported,
    NotAFile,
    TooLarge,
    /// The document has no folder to write the report into.
    NoFolder,
    /// A report is a `.pdf` with a plain name.
    BadReportName,
    ReportNotBase64,
    ReportNotPdf,
    /// The system failed to read or write; the text is the system's and never crosses to the page.
    Io(std::io::Error),
}

impl DocumentError {
    pub fn code(&self) -> &'static str {
        match self {
            DocumentError::Kit(e) => e.code(),
            DocumentError::Unsupported => "unsupported",
            DocumentError::NotAFile => "not_a_file",
            DocumentError::TooLarge => "too_large",
            DocumentError::NoFolder => "no_folder",
            DocumentError::BadReportName => "bad_report_name",
            DocumentError::ReportNotBase64 => "report_not_base64",
            DocumentError::ReportNotPdf => "report_not_pdf",
            DocumentError::Io(_) => "io_failed",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            DocumentError::Kit(e) => e.message(),
            DocumentError::Unsupported => "a check cannot read this type of file",
            DocumentError::NotAFile => "the path is not a file",
            DocumentError::TooLarge => "the file is too large",
            DocumentError::NoFolder => "the document has no folder",
            DocumentError::BadReportName => "a report is a .pdf with a plain name",
            DocumentError::ReportNotBase64 => "the report is not valid base64",
            DocumentError::ReportNotPdf => "the report is not a PDF",
            DocumentError::Io(_) => "the file could not be read or written",
        }
    }
}

impl fmt::Display for DocumentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for DocumentError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DocumentError::Kit(e) => Some(e),
            DocumentError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl Serialize for DocumentError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut wire = serializer.serialize_struct("DocumentError", 2)?;
        wire.serialize_field("code", self.code())?;
        wire.serialize_field("message", self.message())?;
        wire.end()
    }
}

impl From<std::io::Error> for DocumentError {
    fn from(error: std::io::Error) -> Self {
        DocumentError::Io(error)
    }
}

impl From<CommandError> for DocumentError {
    fn from(error: CommandError) -> Self {
        DocumentError::Kit(error)
    }
}

impl From<ScopeError> for DocumentError {
    fn from(error: ScopeError) -> Self {
        DocumentError::Kit(error.into())
    }
}

impl From<FilesError> for DocumentError {
    fn from(error: FilesError) -> Self {
        DocumentError::Kit(error.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failure_answers_a_code_and_a_fixed_sentence_never_the_systems_text() {
        let io = DocumentError::Io(std::io::Error::other("/Users/someone/secret.pdf"));
        let wire = serde_json::to_value(&io).unwrap();
        assert_eq!(wire["code"], "io_failed");
        assert!(!wire["message"].as_str().unwrap().contains("secret"));
    }

    #[test]
    fn the_kits_code_is_kept() {
        let outside = DocumentError::from(ScopeError::OutsideScope("/etc".into()));
        assert_eq!(outside.code(), "scope_outside");
    }
}
