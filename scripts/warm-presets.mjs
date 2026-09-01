/**
 * Pre-generate the starter journeys so they open instantly.
 *
 * A starter is the same world every time somebody picks it, so it only ever
 * needs building once per language. This drives the app's own HTTP endpoints
 * rather than importing the generator directly, which means it exercises the
 * exact code path a real player takes: plan, paint the opening screen, draw the
 * character, paint all three rooms, then hand the finished bundle to the cache.
 *
 *   npm run warm                    # every starter, in every language
 *   npm run warm -- mr-IN ta-IN     # specific languages
 *   npm run warm -- --force         # rebuild even what is already cached
 *   VAARTA_URL=http://localhost:3000 npm run warm
 *
 * Sign-in is compulsory, so VAARTA_WARM_TOKEN must match the server's; without
 * it every call comes back 401. `npm run warm` reads it out of .env.local or
 * .env, so setting it there once is enough.
 *
 * Safe to re-run: anything already warm is skipped, so a failed run can simply
 * be repeated and will only redo what is missing. Pass --force after changing
 * the planner prompt or a language's teaching notes, since worlds cached before
 * that change were built to the old brief.
 *
 * Each starter gets three attempts with a growing pause between them. A run
 * takes the better part of an hour, and over that long a window an overloaded
 * model or a dropped connection is normal weather rather than an error worth
 * abandoning a world for.
 */

const BASE = process.env.VAARTA_URL || "http://localhost:3000";
const ARGS = process.argv.slice(2).filter(Boolean);
const FORCE = ARGS.includes("--force");
const LANGUAGES = ARGS.filter((arg) => !arg.startsWith("--"));
/** Every language Vaarta offers, so `npm run warm` covers the whole product. */
const DEFAULT_LANGUAGES = ["hi-IN", "mr-IN", "bn-IN", "ta-IN", "gu-IN", "ml-IN"];

/** Kept in step with lib/vaarta/starters.ts. */
const STARTERS = [
  {
    id: "last-bus",
    idea: "A crowded bus stop in {region} at dusk. I have the name of a place written on a scrap of paper, no working phone, and about twenty minutes before the last service leaves.",
  },
  {
    id: "wrong-address",
    idea: "A neighbourhood of narrow lanes in {region}, gathered around one big old gate. The address I was given does not exist, and the people who live here keep sending me somewhere slightly different.",
  },
  {
    id: "first-day",
    idea: "My first morning living in {region}. I have just been dropped at the station with two bags, keys to an empty flat, a short list of errands, and I have decided not to switch to English today no matter what.",
  },
];

/** Home regions, mirroring lib/vaarta/languages.ts. */
const REGIONS = {
  "hi-IN": "North India — Old Delhi bazaars, Varanasi ghats, Himalayan foothills",
  "mr-IN": "Maharashtra — Mumbai's streets, Pune's lanes, the Konkan coast",
  "bn-IN": "Bengal — Kolkata's para lanes, the Sundarbans, Shantiniketan",
  "ta-IN": "Tamil Nadu — Madurai temples, Chennai marina, Chettinad villages",
  "gu-IN": "Gujarat — Ahmedabad's pols, Kutch salt flats, Saurashtra ports",
  "ml-IN": "Kerala — Kochi harbours, Alappuzha backwaters, Wayanad plantations",
};

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (message) => console.log(`  ${stamp()}  ${message}`);

/**
 * Signed-in users are the only people who can reach these endpoints, and this
 * script is not a person. `VAARTA_WARM_TOKEN` must match the server's.
 */
const WARM_HEADERS = {
  "Content-Type": "application/json",
  ...(process.env.VAARTA_WARM_TOKEN ? { "x-vaarta-warm": process.env.VAARTA_WARM_TOKEN } : {}),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: WARM_HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  return data;
}

/**
 * Ask the cache what it already holds.
 *
 * Throws rather than reporting an empty cache when it cannot get an answer. A
 * failed lookup is not a miss, and guessing that it is costs eleven model calls
 * for a world that was already there — which is exactly what happened when the
 * network dropped for two minutes mid-run.
 */
async function lookup(starter, languageId) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `${BASE}/api/vaarta/preset?starter=${starter.id}&language=${languageId}`,
        { headers: WARM_HEADERS }
      );
      if (!res.ok) throw new Error(`preset lookup failed (${res.status})`);
      const data = await res.json();
      if (data.lookupFailed) throw new Error("the preset cache could not be reached");
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 4000);
    }
  }
  throw lastError;
}

async function warm(starter, languageId) {
  const label = `${starter.id} / ${languageId}`;

  const existing = await lookup(starter, languageId);
  // A run counts as warm only once its rooms are in too, or the first door
  // would still make a player wait at it.
  if (
    !FORCE &&
    existing.bundle &&
    existing.bundle.scenes.filter((s) => s.kind === "interior").length >= 3
  ) {
    log(`${label}: already warm, skipping`);
    return "skipped";
  }

  const region = REGIONS[languageId] || "a place where this language is spoken every day";
  const idea = starter.idea.replace("{region}", region);

  log(`${label}: writing the world and its ladder`);
  const plan = await api("/api/vaarta/world", {
    idea,
    language: languageId,
    supportLanguage: "English",
  });

  log(`${label}: painting the opening screen`);
  const { scene: origin } = await api("/api/vaarta/screen", {
    bible: plan.bible,
    x: 0,
    y: 0,
    arriveFrom: null,
    prevImage: null,
    unplacedRooms: [0, 1, 2],
  });

  log(`${label}: drawing the character`);
  const comma = origin.image.indexOf(",");
  const { sprite } = await api("/api/vaarta/sprite", {
    bible: plan.bible,
    referenceFrame: comma >= 0 ? origin.image.slice(comma + 1) : origin.image,
  }).catch(() => ({ sprite: null }));

  // Rooms are where the language actually happens, so a warm world has all
  // three painted and not just the street outside them.
  const rooms = [];
  for (const roomIndex of [0, 1, 2]) {
    log(`${label}: painting room ${roomIndex + 1} of 3 (${plan.bible.rooms[roomIndex].name})`);
    try {
      const { scene } = await api("/api/vaarta/interior", {
        bible: plan.bible,
        roomIndex,
        parentId: origin.id,
      });
      rooms.push(scene);
    } catch (error) {
      log(`${label}: room ${roomIndex + 1} failed (${error.message}); continuing`);
    }
  }

  const { persisted } = await api("/api/vaarta/preset", {
    starterId: starter.id,
    language: languageId,
    bundle: { plan, scenes: [origin, ...rooms], sprite },
  }, "PUT");

  log(`${label}: cached with ${rooms.length}/3 rooms (persisted: ${persisted})`);
  return persisted ? "cached" : "memory-only";
}

const languages = LANGUAGES.length ? LANGUAGES : DEFAULT_LANGUAGES;
console.log(
  `\nWarming ${STARTERS.length} starters x ${languages.length} language(s) against ${BASE}` +
    `${FORCE ? " (forced rebuild)" : ""}\n`
);

/** How many times to attempt one starter before giving up on it. */
const ATTEMPTS = 3;

let failures = 0;
for (const languageId of languages) {
  for (const starter of STARTERS) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await warm(starter, languageId);
        break;
      } catch (error) {
        if (attempt < ATTEMPTS) {
          // Almost every failure here is weather: an overloaded model, or the
          // machine's connection going away for a minute. Waiting costs far
          // less than abandoning a world and rebuilding it on the next run.
          log(`${starter.id} / ${languageId}: ${error.message}; retrying in ${attempt * 20}s`);
          await sleep(attempt * 20_000);
          continue;
        }
        failures += 1;
        log(`${starter.id} / ${languageId}: FAILED after ${ATTEMPTS} attempts: ${error.message}`);
      }
    }
  }
}

console.log(
  failures === 0
    ? "\nAll starters are warm. They will open without generating anything.\n"
    : `\n${failures} starter(s) failed. Re-run to retry only those.\n`
);
process.exit(failures === 0 ? 0 : 1);
