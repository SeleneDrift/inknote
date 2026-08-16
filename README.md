# InkNote

**English** | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="docs/screenshots/banner.png" alt="InkNote" width="880">
</p>

<p align="center">
  <a href="https://github.com/SeleneDrift/inknote/releases"><img src="https://img.shields.io/github/v/release/SeleneDrift/inknote" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/SeleneDrift/inknote" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/Electron-43-47848F" alt="Electron 43">
  <a href="https://github.com/SeleneDrift/inknote/stargazers"><img src="https://img.shields.io/github/stars/SeleneDrift/inknote" alt="Stars"></a>
</p>

> **Your notes. Your passwords. Yours alone.**
>
> A local-first notes & password manager for Windows. Every byte you type is encrypted on your device with **AES-256-GCM** — no account, no cloud, no tracking.

## Why InkNote?

- 🔒 **Encrypted by design** — AES-256-GCM keys exist only in memory. Even your backup file is unreadable without your master password.
- 💾 **100% local & offline** — everything lives on your disk. No account, no server, no telemetry, nothing ever leaves your machine.
- 📝 **Notes that feel natural** — Markdown editing with live preview, tags, full-text search, and 400ms-debounced auto-save.
- 🔑 **A password manager in the same app** — groups, one-click copy, show/hide, and a strong random password generator.
- 🛡 **Never locked out** — set security questions and recover a forgotten master password without losing data.
- ♻️ **Backup & migrate freely** — one encrypted file exports everything; import it on any device, master password carries over.
- 🌏 **English & 中文 built-in** — switch anytime from the title bar, preference is remembered.

## Screenshots

| Notes | Vault | First-run setup |
|---|---|---|
| ![Notes](docs/screenshots/main-en.png) | ![Vault](docs/screenshots/vault-en.png) | ![Setup](docs/screenshots/setup-en.png) |

## Quick Start

**Download** from [Releases](https://github.com/SeleneDrift/inknote/releases):

- `InkNote-<version>-setup.exe` — full installer (multi-language)
- `InkNote-<version>-portable.exe` — portable single file, run from a USB stick
- `InkNote-<version>.appx` — Windows package (unsigned, sideload only)

**Or build from source:**

```bash
npm install
npm start        # run the app
npm run dist     # build Windows installers → release/
```

> ⚠️ Release binaries are unsigned — SmartScreen may warn on first run (More info → Run anyway).

## How it protects you

- Your master password never leaves your device — the keys that decrypt your data are derived and kept in memory only
- Security-question answers use an independent salted derivation (don't pick answers that are easy to guess)
- Every write goes through temp-file + fsync + atomic rename — a crash or power loss can't truncate your data
- Copied passwords are wiped from the clipboard after 30 seconds
- The Markdown preview never loads remote images (CSP), so notes can't phone home

**Forget your master password?** Answer a security question to reset it — data stays intact. Without security questions set, the only way out is a full vault reset, which deletes all data.

## Backup & migration

Unlock → sidebar **Export backup** writes a single encrypted `.ink` file containing all notes and entries. On a new device, import it during first-time setup — master password and security questions carry over. On an existing device, import merges entries (newer wins per id).

## Feedback & support

Found a bug or want a feature? [Open an issue](https://github.com/SeleneDrift/inknote/issues).

## License

[ISC](LICENSE) © 2026 SeleneDrift
