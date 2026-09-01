"use client";

/**
 * The page behind a shared link.
 *
 * A published world is finished: its plan, ladder, painted screens and
 * character all exist already, so this opens straight into the run with no
 * generation at all. The only thing it needs from the browser is who is playing
 * and which language they read explanations in, both of which the dashboard
 * already stored.
 */

import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { VaartaWorld } from "@/components/VaartaWorld";
import { DEFAULT_LANGUAGE } from "@/lib/vaarta/languages";
import * as store from "@/lib/vaarta/local-progress";

export function SharedWorld({ worldId }: { worldId: string }) {
  const router = useRouter();
  // The same hydration-safe read the dashboard uses: the server has no
  // localStorage, so preferences arrive on the first client render.
  const revision = useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
  const prefs = useMemo(
    () =>
      store.loadPreferences({
        playerName: "",
        languageId: DEFAULT_LANGUAGE.id,
        supportLanguage: "English",
      }),
    // Re-read whenever the store changes; `revision` is the subscription's value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision]
  );

  return (
    <VaartaWorld
      // A published world carries its own idea; this is only the fallback shown
      // if it somehow cannot be loaded.
      idea=""
      worldId={worldId}
      languageId={prefs.languageId}
      supportLanguage={prefs.supportLanguage}
      playerName={prefs.playerName || "Traveller"}
      onLeave={() => router.push("/")}
    />
  );
}
