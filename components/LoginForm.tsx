"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { motion } from "framer-motion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const AUTH_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

/**
 * Use the canonical public URL for OAuth when it is supplied at build time.
 * This keeps a production login on the production callback even when a user
 * reaches the app through a preview, custom-domain alias, or redirect.
 */
function oauthCallbackUrl(next: string) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredSiteUrl) {
    try {
      const siteUrl = new URL(configuredSiteUrl);
      if (siteUrl.protocol === "https:" || siteUrl.protocol === "http:") {
        return `${siteUrl.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      }
    } catch {
      // Fall back to the active origin below; the deployment config should
      // still be corrected to its canonical, valid absolute URL.
    }
  }

  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * Sign-in, which is Google and only Google.
 *
 * Magic links and a dev-only password form used to sit under this too. Both
 * are gone: three routes to the same session is three things to keep working,
 * and the magic-link path in particular depended on outbound email that this
 * project does not configure — a button that silently never delivers is worse
 * than no button.
 *
 * Signing in is required: `proxy.ts` gates the dashboard, every world, and
 * every generation endpoint. The gate lives there rather than here because the
 * API routes are what actually cost money to call, and a hidden button is not
 * a gate.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const authError = searchParams.get("error") === "auth";
  const setupError = searchParams.get("error") === "setup";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    authError
      ? "That sign-in attempt expired or was invalid. Try again."
      : setupError
        ? "Google sign-in is not configured for this deployment yet."
        : null
  );

  const signInWithGoogle = async () => {
    if (!AUTH_CONFIGURED) {
      setError("Google sign-in is not configured for this deployment yet.");
      return;
    }
    setError(null);
    setLoading(true);
    posthog.capture("sign_in_with_google_clicked");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthCallbackUrl(safeNext),
      },
    });
    // A success never returns here: the browser has already left for Google.
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="mx-auto w-full max-w-md"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight text-foreground sm:text-7xl">
        Vaarta
      </h1>
      <p className="mt-5 max-w-sm text-base font-medium leading-relaxed text-inksoft">
        A generated world that speaks the language you are learning, every scene painted as you
        play. Sign in to begin.
      </p>

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        variant="neutral"
        className="mt-8 w-full"
        size="lg"
        onClick={signInWithGoogle}
        disabled={loading || !AUTH_CONFIGURED}
      >
        <GoogleMark />
        {loading
          ? "Redirecting…"
          : AUTH_CONFIGURED
            ? "Continue with Google"
            : "Google sign-in unavailable"}
      </Button>

      <p className="mt-4 text-sm font-medium text-inksoft">
        Your streak, the words you bank and every can-do you clear are kept to your
        account, so they follow you to any device.
      </p>
    </motion.div>
  );
}

/** Official multicolor Google "G" mark for OAuth buttons. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
