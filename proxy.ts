import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * The sign-in gate.
 *
 * Vaarta requires an account: the dashboard, every world, and every generation
 * endpoint are behind it. That is enforced here rather than in the UI, because
 * a hidden button is not a gate — the API routes are what actually cost money
 * to call, and they are reachable directly.
 *
 * Two deliberate carve-outs:
 *
 *  - **If no Supabase project is configured, nothing is gated.** A checkout with
 *    only a Gemini key still runs the whole game; refusing to start because an
 *    optional dependency is absent would be a worse failure than being open.
 *  - `/login` and `/auth/callback` stay reachable, or signing in could never
 *    complete.
 *  - A warm run (`npm run warm`) is a machine, not a person, and has no session
 *    to offer. It presents `VAARTA_WARM_TOKEN` instead. The bypass exists only
 *    when that variable is set, and an unset or empty value can never match.
 *
 * This also refreshes the session cookie on every request, which is why it runs
 * on API routes too even though they check auth themselves.
 */

/** Paths that must work while signed out, or sign-in cannot happen. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

/** Header the preset warmer presents in place of a session. */
const WARM_HEADER = "x-vaarta-warm";
const WARM_TOKEN = process.env.VAARTA_WARM_TOKEN;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function proxy(request: NextRequest) {
  // No project attached: the game runs open, exactly as it does offline.
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.next({ request });
  }

  // A warm run holds a shared secret rather than a session. Compared only when
  // a token is actually configured, so the default build has no bypass at all.
  if (WARM_TOKEN && request.headers.get(WARM_HEADER) === WARM_TOKEN) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: this revalidates the token with the auth server
  // rather than trusting a cookie the browser could have been handed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

  if (!user && !isPublic) {
    // An API caller wants a status code, not a login page it cannot render.
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    }
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    // Come back to whatever they were reaching for once they are in.
    if (path !== "/") target.searchParams.set("next", path);
    return NextResponse.redirect(target);
  }

  // Nobody signed in needs the sign-in page.
  if (user && path === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and image optimization.
     * API routes are included so the session cookie is refreshed.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
