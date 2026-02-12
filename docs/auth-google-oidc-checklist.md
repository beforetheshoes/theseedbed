# Auth Phase B Checklist (Google OIDC)

Use this checklist before marking Issue #59 complete.

## 1) Configure Google provider in Supabase (staging)

In Supabase Dashboard:
1. Go to **Authentication** -> **Sign In / Providers** -> **Google**
2. Create a Google OAuth client (Google Cloud Console) and set:
   - Authorized JavaScript origins: `https://staging.theseedbed.app`
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` (copy from the Supabase Google provider page)
3. Paste the Google **Client ID** and **Client secret** into Supabase.

Notes:
- Do not commit provider secrets into this repo.
- Supabase URL allow-listing is controlled under Auth URL configuration; ensure `https://staging.theseedbed.app/**` remains allowed.

## 2) Validate redirect/callback behavior in staging

1. Visit `https://staging.theseedbed.app/login`
2. Click **Continue with Google**
3. Complete the Google consent flow
4. Confirm you land on `/auth/callback`, then are redirected to your intended `returnTo` (or `/`)

## 3) Validate failure handling

- Deny consent in Google:
  - Confirm `/auth/callback` shows a clear error message and does not spin indefinitely.
- Temporarily misconfigure the Google client secret in Supabase:
  - Confirm you see a user-facing error (expected: provider/callback failure).

## 4) Validate user creation

- Confirm the user record is created in `auth.users` after first successful Google sign-in.

## 5) Quality gate

```bash
supabase start
make supabase-env
make quality
```
