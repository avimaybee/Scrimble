# Scrimble Infrastructure Manifest

## Cloudflare Pages Configuration (wrangler.toml)

```toml
#:schema node_modules/wrangler/config-schema.json
compatibility_date = "2024-04-01"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "scrimble-db"
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"

[vars]
# Production Variables (managed in Cloudflare Dashboard)
# FIREBASE_PROJECT_ID = "..."
# ENCRYPTION_KEY = "..."
```

## Environment Variables

### Frontend (.env)
| Variable | Description | Source |
|----------|-------------|--------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API Key | Firebase Console (Project Settings) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain | Firebase Console (Project Settings) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID | Firebase Console |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket | Firebase Console |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging ID | Firebase Console |
| `VITE_FIREBASE_APP_ID` | Firebase App ID | Firebase Console |

### Backend (Cloudflare Pages Vars)
| Variable | Description | Source |
|----------|-------------|--------|
| `DB` | D1 Database Binding | Cloudflare Dashboard (D1) |
| `SCRIMBLE_QUEUE` | Cloudflare Queue Producer | Cloudflare Dashboard (Queues) |
| `FIREBASE_PROJECT_ID` | Firebase Project ID | Firebase Console |
| `ENCRYPTION_KEY` | 32-character AES Key | `openssl rand -hex 16` |

## Security Note

### Cloudflare
- Never commit actual keys to the repository.
- Use `wrangler pages secret put <KEY>` to set production secrets.
- Content Security Policy (CSP) is managed in `functions/api/[[path]].ts`.

### Firebase
- Even though Firestore is not used, **Auth Domain Restrictions** should be set in the Firebase Console.
- Only allow the production domain (e.g., `scrimble.ai`) and `localhost` to perform authentication.
- Set **API Key Restrictions** to the Scrimble app's bundle ID/domain.
