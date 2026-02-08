# Passkeys/WebAuthn Feasibility (Post-MVP)

Status as of 2026-02-08:
- Supabase Auth does not document a first-party, end-to-end passkeys/WebAuthn authentication flow.
- Upstream GoTrue/Supabase feature requests for WebAuthn/passkeys exist, but this repo should treat passkeys as "not natively supported" until Supabase publishes supported guidance or ships the feature.

## Goal
Decide whether to implement passkeys as an authentication method (account sign-in) or defer.

## Definitions
- "Passkeys as sign-in": WebAuthn is used to authenticate a user and mint a Supabase session.
- "Passkeys as local unlock": WebAuthn/biometrics are used only to unlock the app locally while still relying on an existing Supabase session.

## Options

### Option A (Recommended): Defer passkeys as sign-in; consider "local unlock" later
Why:
- Lowest risk to MVP.
- Keeps auth surface area limited to Apple OAuth + magic link, which Supabase supports today.
- Avoids building custom token-minting and recovery flows prematurely.

What we can still do:
- Add app-level "lock screen" UX (web and iOS) that requires device auth to re-open the app, without changing server-side auth.

### Option B: Implement passkeys via an external identity provider
Approach:
- Use a provider that supports passkeys and OIDC.
- Configure Supabase to trust that provider (OIDC) or integrate via supported OAuth/OIDC routes.

Tradeoffs:
- Adds vendor complexity and operating cost.
- Still requires careful redirect/callback handling and account linking rules.

### Option C: Implement passkeys with a custom auth service
Approach:
- Build a service that verifies WebAuthn assertions and then exchanges that authentication for a Supabase session.

Risks:
- Requires deep alignment with Supabase/GoTrue internals and secure key management.
- Recovery/account-linking flows (lost device, stolen device, revoked credentials) become our responsibility.

## Web UX implications
- Registration: prompt to create a passkey and name the credential.
- Sign-in: "Use passkey" flow plus fallback (magic link or Apple) for recovery.
- Account linking: prevent accidental creation of multiple accounts for the same person (email collisions, provider mismatch).

## iOS UX implications
- Similar flows using platform passkeys (ASAuthorizationPlatformPublicKeyCredentialProvider).
- Device-to-account recovery remains the hard part: "what happens when the phone is lost?"

## Security and Recovery Edge Cases
- Lost device: mandatory fallback method (email link, Apple, or support-assisted recovery).
- Credential revocation: ability to remove passkeys from the account.
- Shared devices: ensure credential creation is user-intentional and auditable.
- Phishing resistance: passkeys are strong, but only if relying party IDs and origins are correct.

## Rollout Plan (if we decide to implement)
1. Ship "local unlock" first (no server changes).
2. Introduce passkeys sign-in behind a feature flag on staging only.
3. Add explicit account linking and recovery flows.
4. Expand to production after monitoring sign-in failures and support burden.

## Recommendation
Defer passkeys as an authentication method until Supabase ships documented support or we choose an external OIDC provider with passkey support.

