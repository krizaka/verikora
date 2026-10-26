# Yomizaka for iOS and Android

Expo (SDK 58, Expo Router) on the Krizaka native kit (`@krizaka/ui/native`) in Yomizaka's indigo, light and dark, French first.
The same account and the same API as the web; the logic every Krizaka Expo app shares (session, discovery, API client, the auth context `createAuth`) is
[`@krizaka/app-client`](https://ui.krizaka.com/packages/app-client) (ADR-004).

| Screen | URL (the web's path, under the language) |
| :-- | :-- |
| Check a document: camera scan, photo or PDF, the pre-flight, the Orazaka run | `/fr/app/check` |
| A document and its checks, the result with its plain-language closing note, the signed PDF | `/fr/app/documents/<id>/infos` · `/verifications?analysis=<id>` |
| The library: collections, tags | `/fr/app/library` · `/<library>/<collection>?tags=a,b` |
| Settings | `/fr/app/settings` |

**Documents stay on the device** (ADR-0007): the picked file is kept in the app's sandbox (`src/data/device-store.ts`, the
`DocumentStore` port); only what a check needs goes to the server, which purges it.

```bash
pnpm install            # at the repository root
cd apps/mobile
pnpm test               # jest-expo: the pure rules (pre-flight, checks, stages, links, the device store) and screens (jest.resolver.js loads the ESM-only @krizaka packages)
pnpm exec expo start    # a development build; EXPO_PUBLIC_APP_URL points it at another backend
```

**Universal links** (yomizaka#155): `https://www.yomizaka.com/fr/app/…` opens the app when it is installed. iOS lists the hosts in
`associatedDomains`, Android has a verified (`autoVerify`) intent filter; the web serves the two files the phones check —
`/.well-known/apple-app-site-association` (set `APP_IOS_TEAM_ID`) and `/.well-known/assetlinks.json` (set
`APP_ANDROID_CERT_SHA256`, the signing certificate's fingerprint) — and answers 404 until what signs the app is known. `pnpm check:app-links`
(at the root) checks that `app.json` and those files say the same thing.

**The store** is a `DocumentStore` like the web's and the Mac's (`src/data/device-store.ts`): it passes the shared contract
(`@yomizaka/core/document-store/contract-kit`, run here by Jest).

Not in this app yet, tracked in krizaka/yomizaka#155: the update and maintenance gates, push, the Android build in CI.

The tabs are the section map of `@yomizaka/core` (Bibliothèque, Vérifications with its « Lots » tab), the same as the web's rail and the Mac's sidebar. Every tab's header carries « Vérifier un document » as its « + » and the signed-in account (`GET /api/me`); its avatar opens the account and settings.
