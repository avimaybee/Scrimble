# Scrimble Environment Manifest

This document tracks every environment variable and secret required to run the Scrimble application.

## 1. Backend Secrets (Infrastructure)
These must be set using `wrangler pages secret put <NAME>` or in the Cloudflare Dashboard. **NEVER** commit these.

| Variable | Description | Command to Generate/Source |
|----------|-------------|----------------------------|
| `ENCRYPTION_KEY` | 32-byte hex for AES-256 | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | 32-byte hex for AES-256 | `openssl rand -hex 32` |

## 2. Backend Variables (wrangler.toml)
Non-sensitive configuration. Safe to commit if no PII/Secrets are included.

| Variable | Value | Description |
|----------|-------|-------------|
| `ENVIRONMENT` | `production` | Deployment environment |
| `FIREBASE_PROJECT_ID` | `scrimble-auth` | Required for JWT issuer verification |

## 3. Frontend Variables (.env.local)
Required for local development and build. Values sourced from `src/lib/firebase.ts`.

| Variable | Value | Safe to Commit? |
|----------|-------|-----------------|
| `VITE_FIREBASE_API_KEY` | `AIzaSyBjaSbuwgaFSBDmhAEX5TcLuOPokBMNyp0` | Yes (Public Key) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `scrimble-auth.firebaseapp.com` | Yes |
| `VITE_FIREBASE_PROJECT_ID` | `scrimble-auth` | Yes |
| `VITE_FIREBASE_STORAGE_BUCKET` | `scrimble-auth.firebasestorage.app` | Yes |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `714624747391` | Yes |
| `VITE_FIREBASE_APP_ID` | `1:714624747391:web:214613547d5e8ace2ebc4a` | Yes |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-EBBT2RYJQD` | Yes |

## 4. Infrastructure Bindings
Managed via `wrangler.toml` and Cloudflare Dashboard.

## 5. Security Configuration (Manual Actions)
The following settings must be configured manually in the respective consoles for production security.

### Firebase Console (scrimble-auth)
- **Authorized Domains**: Remove `localhost`. Add `scrimble.pages.dev` and any custom production domains.
- **Sign-in Providers**: Enable only **Google** and **Email/Password**. Disable all other providers.

### Google Cloud Console (APIs & Services > Credentials)
- **OAuth 2.0 Client IDs**: Update the client used by Firebase Auth.
- **Authorized redirect URIs**:
    - `https://scrimble-auth.firebaseapp.com/__/auth/handler`
    - `https://scrimble.pages.dev/__/auth/handler` (or your custom domain equivalent)
## 6. Custom AI Provider URLs
For OpenAI-compatible providers (Ollama, Together, etc.), use one of these formats in Settings:

| Format | Example | Note |
|--------|---------|------|
| **Host only** | `https://api.example.com` | Scrimble appends `/v1/chat/completions` |
| **V1 base** | `https://api.example.com/v1` | Scrimble appends `/chat/completions` |
| **Full endpoint** | `https://api.example.com/v1/chat/completions` | Accepted as is |
| **Local (Ollama)** | `http://localhost:11434/v1` | Most common for local work |
