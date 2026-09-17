# Worker contract — Persistent browser profiles

This document defines the control-plane commands emitted by Nexo Mobile for a future Android/Chromium worker.

## Goal

Each Nexo profile gets its own persistent Chromium data directory. A user signs in normally inside that browser profile. Later starts reuse the same profile directory, so browser state created inside that environment survives restarts.

The control plane does not copy authentication databases from third-party Android apps and does not export authentication cookies or session tokens.

## Queue

The current front-end stores pending commands in:

`localStorage['nexo-worker-command-queue']`

A production backend should replace this browser-local queue with an authenticated API + durable queue. Workers should acknowledge commands by `id` and the backend should remove/mark them completed.

## Commands

### ensure_browser_profile

Creates or verifies a persistent isolated Chromium profile.

```json
{
  "id": "CMD-...",
  "type": "ensure_browser_profile",
  "profileId": "NX-1048",
  "createdAt": "2026-09-17T00:00:00.000Z",
  "payload": {
    "engine": "chromium",
    "persistent": true,
    "isolateStorage": true,
    "userDataDir": "/var/lib/nexo/profiles/NX-1048/chromium"
  }
}
```

Worker requirements:

- one filesystem directory per Nexo profile;
- never reuse one profile directory for two Nexo profiles;
- apply the profile proxy before launching Chromium;
- keep the directory on persistent storage;
- lock the directory while Chromium is running;
- use an allowlisted root such as `/var/lib/nexo/profiles/` and reject path traversal.

### open_login_assist

Opens a normal web URL inside the selected persistent Chromium profile.

```json
{
  "id": "CMD-...",
  "type": "open_login_assist",
  "profileId": "NX-1048",
  "createdAt": "2026-09-17T00:00:00.000Z",
  "payload": {
    "url": "https://www.tiktok.com/"
  }
}
```

The worker should reuse the directory prepared by `ensure_browser_profile`. Authentication is performed by the user through the normal website flow.

### apply_portable_browser_state

Applies only the portable state approved by the front-end sanitizer, such as language, theme, consent, locale and similar preferences.

```json
{
  "id": "CMD-...",
  "type": "apply_portable_browser_state",
  "profileId": "NX-1048",
  "createdAt": "2026-09-17T00:00:00.000Z",
  "payload": {
    "url": "https://example.com/",
    "state": {
      "cookies": [],
      "localStorage": {
        "theme": "dark",
        "locale": "pt-BR"
      }
    }
  }
}
```

The worker must re-validate the payload server-side before applying it. Never trust the browser client as the only sanitizer.

## Profile Restore file

The front-end can export a `.nexo.json` envelope encrypted with AES-GCM-256. The key is derived from the user-provided passphrase with PBKDF2-SHA256. The restore file contains profile configuration plus portable filtered browser state.

It intentionally does not contain the worker's full Chromium data directory or third-party app private storage.

## Production backend

Before connecting a real worker, replace the local queue with endpoints similar to:

- `POST /api/profiles/:id/commands`
- `GET /api/workers/:workerId/commands`
- `POST /api/commands/:id/ack`

Recommended controls:

- authenticated worker identity;
- command ownership validation;
- per-profile authorization;
- replay protection using command IDs;
- audit log for command creation/completion;
- encrypted proxy credentials;
- HTTPS/WSS only;
- server-side validation of URLs and portable state.
