# GoatMedia for Android

A thin native shell around the live site. There is no second codebase to keep in
sync: the app opens https://toastedbread02.github.io/GoatMedia/ in a WebView, so
every deploy of the site is immediately what the app shows.

- **Package:** `app.goatmedia`
- **Min Android:** 7.0 (API 24), target 35
- **Icon:** `art/icon.svg` → `art/icon-512.png` → `res/mipmap-*/ic_launcher.png`
- **Signing:** self-signed local key in `art/goatmedia.keystore` (password
  `goatmedia`). Keep it: updates signed with a different key are rejected.

## Build

```bash
bash android/build.sh
```

It writes `android/GoatMedia-2.0.0.apk` and copies it to the repository root. No
Gradle, no downloads: it uses `aapt2`, `javac`, `d8`, `zipalign` and `apksigner`
from the installed SDK.

## Install

1. Copy `GoatMedia-2.0.0.apk` to the phone.
2. Open it; Android asks to allow installs from that source.
3. Accept the "unknown developer" warning (the key is self-signed, not Play).

## What the shell handles

- Back button walks the site's history, then exits.
- Links to other hosts open in the phone's browser.
- Media plays without an extra tap; the reel's gesture is the site's own.
- The window background is the site's paper colour, so there is no white flash.

## Limits

- No offline mode and no push: the app is the website.
- A video field always offers "Record a video" (the camera app) and "Choose a
  file". If the phone has no camera app, recording quietly opens the file
  browser instead. Recording returns the clip straight to the page; nothing is
  saved to the gallery first unless the camera app does that itself. Photo and
  audio fields skip the dialog and open the system picker directly.
- Updates must be signed with `art/goatmedia.keystore`. It is a local,
  self-signed key committed so the app can be rebuilt; generate your own before
  ever publishing anywhere.
