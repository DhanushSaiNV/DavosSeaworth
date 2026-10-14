That error page is served by Supabase's auth server (GoTrue) — it means the `/auth/v1/verify` step **failed before it could redirect back to your app**. So the problem is on the email-link/Supabase-config side, not your APK's deep linking (that part never even gets a chance to run).

## First: find the actual error

Open the magic link in a desktop browser and look at the address bar of the error page. The URL contains the real cause:

```
...error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
```

or

```
error_code=validation_failed ... (redirect_to not allowed)
```

That code tells you which of the two likely causes you have:
[I checked the link and there is no such error= or error_code= bu only code=3632-...]

## Cause 1: `redirect_to` not whitelisted (most likely)

Supabase rejects the verify request if `emailRedirectTo` isn't an **exact** match in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**. Add both:

```
davos://auth/callback
davos://**
```

Notes:

- Matching is strict — `davos://auth/callback/` (trailing slash) in code vs `davos://auth/callback` in the dashboard will fail.
- Also confirm your APK is actually sending `davos://auth/callback`. In your `getRedirectUrl()`, the `__DEV__` branch is skipped in a release build, so it falls through to `davos://auth/callback` — but double-check the log line `[Auth] Final magic link redirect URL being sent:` from a dev-client run to be sure.
- Your email template must use `{{ .ConfirmationURL }}` (the default). If you customized it to hand-build a link, the `redirect_to` param often gets dropped or mangled.

## Cause 2: `otp_expired` — mail scanner ate the token

Gmail/Outlook "safe link" scanners **pre-open links in emails**, which consumes the one-time token. You then tap the link and get `otp_expired`. This is extremely common on Android because people test with Gmail.

The robust fix — and the recommended pattern for mobile anyway — is to **skip links entirely and use the 6-digit code**. No browser, no redirect, no whitelisting, no scanner problems:

```typescript
// Send — user gets a 6-digit code instead of a link
await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true }, // no emailRedirectTo needed
});

// Verify — add a code input screen, then:
const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code, // 6 digits from the email
    type: "email",
});
if (!error) router.replace("/(app)/chat");
```

In the Supabase email template, the code is available as `{{ .Token }}` — edit **Authentication → Email Templates → Magic Link** to show it prominently (e.g., "Your sign-in code: {{ .Token }}"), and keep `{{ .ConfirmationURL }}` as a fallback for web users.

This works identically in Expo Go, dev builds, and release APKs, and eliminates the entire class of deep-link problems for email auth. Reserve the redirect flow for Google OAuth, where you don't have a choice.
