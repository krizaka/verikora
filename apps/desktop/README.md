# Verikora for the Mac

Tauri 2: a Vite page built from `@krizaka/ui` (`AppShell desktop`, Verikora's indigo, light and dark, French first) and a
thin Rust side on [`tauri-plugin-krizaka`](https://github.com/krizaka/krizaka-tauri-kit) (ADR-005). A library in the folders
of your Mac: documents stay where they are, only what a check needs is sent, then erased. Same account, same checks, same
signed PDF as the web and the phone.

| | |
| :-- | :-- |
| Folders | The native picker grants a folder (the kit's scope: canonical paths, `..` and symlinks that leave a folder refused, the home, `/`, `~/.ssh`… never grantable); the folder on screen is watched and listed again when it changes |
| Check | Pre-flight (the server's limits), upload for this one check, the Sovkora run with its stages, the plain-language note, the signed PDF saved next to the document |
| Drag and drop | Files dropped from Finder are allowed for this session only (one file, never its neighbours): one file is a check, several are a batch |
| Batches | « Check the whole folder », several files dropped, or a **watched folder** (« Vérifier automatiquement les nouveaux documents », per folder, off by default: what is already there is never sent, only what arrives after); each row followed, its report next to its file |
| Vérifications | The documents checked and their checks, then the batches as its « Lots » tab; the files stayed on the Mac |
| Store | The Mac's `DocumentStore` (ADR-0007): what Verikora keeps for the person on this Mac lives in the app's own folder (`Application Support/…/documents`); keys checked twice (the port's rule, then Rust: no `..`, no absolute path, no link planted in the folder); it passes the same contract test as the web's adapters (`@verikora/core/document-store/contract`) |
| Account | The header's account menu at every width: name, e-mail, settings, theme, language, sign out. The bearer session is in the Keychain (`@krizaka/app-client`'s session store over `keychainStorage`) |
| Menu bar | File · Go (⌘O, then the section map of `@verikora/core` numbered ⌘1 to ⌘4: Library, Vérifications; ⌘, Settings), in the app's language |
| Links | `verikora://app/…` and `https://www.verikora.com/app/…` open the same place (`/app/documents/<id>`, `/app/check/batches/<id>`, `/app/settings`) |
| URLs | The window's hash: `#/library/<folder>`, `#/check/<document>/<run>`, `#/documents/<document>`, `#/batches/<batch>`, `#/reports`, `#/settings` |

The page has no `fs`, no shell, no opener: its capability is `core:default`, `krizaka:default`, the title bar's drag and
HTTP to Verikora's own addresses.

```bash
pnpm install
cd apps/desktop
pnpm check          # types, UI tests, Rust tests
pnpm tauri dev      # VITE_APP_URL=http://localhost:3000 points it at another backend
```

## Release

A `desktop-v<version>` tag builds the arm64 `.dmg` (workflow `desktop.yml`) and attaches it to the GitHub release. Until a
Developer ID Application certificate and notarisation credentials are secrets of the repository, the app is not signed:
right-click it, then Open. To sign, add the repository secrets `APPLE_CERTIFICATE` (the certificate exported as a base64
`.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY` and
`APPLE_API_KEY_P8` (the App Store Connect key for notarisation); nothing in the code changes.

An unsigned debug build asks for the Keychain password at every launch: that is the missing signature, not the app.
