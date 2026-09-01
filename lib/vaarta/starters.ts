/**
 * Starter journeys: world seeds that work in any of the catalogue languages.
 *
 * A blank prompt box is a bad first screen for a language learner — the person
 * who most needs Vaarta is the one with no idea what to type. These are ideas
 * concrete enough to produce a good world and vague enough that the planner
 * roots them in wherever the chosen language actually lives, using the
 * language profile's `homeRegion`.
 *
 * Each seed leans on a different kind of talk, so the ladder a learner gets is
 * shaped by the journey they picked rather than being the same rungs with new
 * scenery.
 *
 * Three seeds, three real map frames. A card with invented cover art promises a
 * world that will not look like that, and repeating one frame across two cards
 * reads as a bug. Keeping the set small also means all three can be
 * pre-generated per language and open instantly (see scripts/warm-presets.mjs).
 */

export type Starter = {
  id: string;
  title: string;
  /** What the learner will end up practising, in one line. */
  blurb: string;
  /** The idea handed to the planner; `{region}` is replaced at build time. */
  idea: string;
  /** A real frame from the engine, used as the card's cover. */
  cover: string;
};

export const STARTERS: Starter[] = [
  {
    id: "last-bus",
    title: "The Last Bus Out",
    blurb: "Destinations, platforms, and checking you understood the answer.",
    idea: "A crowded bus stop in {region} at dusk. I have the name of a place written on a scrap of paper, no working phone, and about twenty minutes before the last service leaves.",
    cover: "/vaarta/maps/dadar-bus-stop.jpg",
  },
  {
    id: "wrong-address",
    title: "The Wrong Address",
    blurb: "Directions, landmarks, and repairing a misunderstanding politely.",
    idea: "A neighbourhood of narrow lanes in {region}, gathered around one big old gate. The address I was given does not exist, and the people who live here keep sending me somewhere slightly different.",
    cover: "/vaarta/maps/kj-college-gate.jpg",
  },
  {
    id: "first-day",
    title: "First Day, New Town",
    blurb: "Introductions, small talk, and getting through a first errand alone.",
    idea: "My first morning living in {region}. I have just been dropped at the station with two bags, keys to an empty flat, a short list of errands, and I have decided not to switch to English today no matter what.",
    cover: "/vaarta/maps/bandra-station-pickup.jpg",
  },
];

/** Fill a starter's idea with the region the chosen language actually lives in. */
export function starterIdea(starter: Starter, homeRegion: string): string {
  return starter.idea.replace("{region}", homeRegion);
}
