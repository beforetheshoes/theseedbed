# Auth Phase A Checklist (Apple + Magic Link)

Use this checklist before marking Issues #4, #5, and #6 complete.

## 1) Apply Supabase auth config to staging

```bash
supabase link --project-ref kypwcksvicrbrrwscdze
supabase config push
```

Required staging secrets/config:
- `SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID`
- `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`

Notes:
- Hosted staging/prod use Supabase Dashboard values as the source of truth for Apple provider secrets.
- Set these in local `.env` only if you need to run Apple auth flows via local Supabase CLI stack.

## 2) Verify redirect/callback URLs

In Supabase Auth URL configuration:
- `site_url` is `https://staging.theseedbed.app`
- Redirect URL allow-list includes:
- `https://staging.theseedbed.app/**`
- `http://localhost:3000/**`
- `http://127.0.0.1:3000/**`

## 3) Apple OAuth validation

- From `/login`, click **Continue with Apple**.
- Complete provider flow and return to `/auth/callback`.
- Confirm redirect lands on expected `returnTo` path.
- Confirm user is created in `auth.users`.

## 4) Magic link validation

- Request magic link from `/login`.
- Confirm success message appears.
- Open emailed link and verify session is established.
- Confirm resend throttling is enforced at 60s.
- Confirm OTP expiration is 3600s.
- Confirm email template branding is correct in staging.

## 5) Passwordless-only validation

- Confirm no password fields are exposed in web auth UX.
- Verify password sign-in attempts are blocked/rejected per Supabase provider configuration.
- Verify email auth remains enabled for magic link.

## 6) Regression and quality gate

```bash
supabase start
make supabase-env
make quality
```

If `make quality` fails because local Supabase is unavailable, resolve Docker/Supabase runtime before closing auth issues.
