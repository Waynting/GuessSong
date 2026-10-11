/**
 * Fisher-Yates, returning a copy.
 *
 * The one shuffle on the site. `Array#sort` with a random comparator is not a
 * uniform shuffle — under V8 it leaves elements near where they started — and
 * the setup page used it: a 300-track playlist cut to 20 songs drew its first
 * fifty tracks about 1.5× as often as it should and its last fifty about half
 * as often, so a host replaying one playlist kept hearing its opening songs.
 * Two correct copies of this function existed beside it at the time, which is
 * why there is now one, here, and `tests/shuffle.test.ts` reads the app for a
 * random comparator.
 *
 * Pure, so the browser bundle can import it.
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** What `spreadByAlbum` and `pickSpread` need to know about a track. */
export interface AlbumTagged {
  id: string;
  artists: readonly string[];
  albumName?: string;
  albumImageUrl?: string;
}

/**
 * Which album a track is on, as a key. Spotify sends no album id to this app,
 * so the cover is the identity when there is one — every track on an album
 * shares its image URL, and two different albums never do. Without a cover,
 * the album's name with the primary artist (two artists' "Greatest Hits" are
 * different records). With neither, the track is an album of its own: there
 * is nothing to spread it from.
 */
export function albumKey(track: AlbumTagged): string {
  if (track.albumImageUrl) return `img:${track.albumImageUrl}`;
  const fold = (s: string) => s.normalize("NFKC").toLowerCase().trim();
  if (track.albumName?.trim()) return `name:${fold(track.albumName)}::${fold(track.artists[0] ?? "")}`;
  return `id:${track.id}`;
}

/**
 * A random order with each album's tracks spread out across it.
 *
 * Every album gets one random offset and its n tracks land at
 * (i + offset) / n, plus a little jitter, so a three-track album sits near a
 * third, two thirds and the end in some rotation rather than back to back. A
 * single is a uniform draw on [0, 1). Then one repair pass swaps away any
 * same-album neighbours the spacing left, when another track can take the
 * place without creating a new pair. It cannot always succeed — a game that
 * is half one album has to repeat it somewhere — and it does not try to.
 *
 * Which of an album's tracks comes first is random and nothing else: the
 * order inside an album, or inside a year, carries no meaning for the game.
 */
export function spreadByAlbum<T extends AlbumTagged>(
  items: readonly T[],
  random: () => number = Math.random
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of shuffle(items, random)) {
    const key = albumKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const keyed: { item: T; at: number }[] = [];
  for (const group of groups.values()) {
    const n = group.length;
    const offset = random();
    group.forEach((item, i) => {
      const jitter = n > 1 ? (random() - 0.5) * 0.3 : 0;
      keyed.push({ item, at: (i + offset + jitter) / n });
    });
  }
  keyed.sort((a, b) => a.at - b.at);
  const out = keyed.map((k) => k.item);

  const album = out.map(albumKey);
  const clashes = (pos: number, key: string) =>
    (pos > 0 && album[pos - 1] === key) || (pos < out.length - 1 && album[pos + 1] === key);
  for (let i = 1; i < out.length; i++) {
    if (album[i] !== album[i - 1]) continue;
    for (let j = i + 1; j < out.length; j++) {
      const moving = album[i];
      const incoming = album[j];
      if (incoming === album[i - 1]) continue;
      // Swap tentatively and keep it only if neither spot gains a neighbour.
      [album[i], album[j]] = [incoming, moving];
      if (!clashes(i, incoming) && !clashes(j, moving)) {
        [out[i], out[j]] = [out[j], out[i]];
        break;
      }
      [album[i], album[j]] = [moving, incoming];
    }
  }
  return out;
}

/**
 * `count` tracks for a game, as few from any one album as the list allows,
 * then spread.
 *
 * Fair per album rather than per track: every album gets one track in before
 * any album gets a second, and which albums make a short game is a uniform
 * draw. So a song on a twelve-track album the playlist took whole is less
 * likely to be picked than a single — that is the trade asked for, since the
 * alternative is a twenty-song game with four from the same record. Inside an
 * album, which track is picked is uniform.
 */
export function pickSpread<T extends AlbumTagged>(
  items: readonly T[],
  count: number,
  random: () => number = Math.random
): T[] {
  const n = Math.max(0, Math.min(Math.trunc(count), items.length));
  const seen = new Map<string, number>();
  const ranked = shuffle(items, random).map((item) => {
    const key = albumKey(item);
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    // A fresh draw breaks ties inside a tier. Using the shuffled position
    // instead would favour big albums, whose first track tends to come early.
    return { item, rank, tie: random() };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.tie - b.tie);
  return spreadByAlbum(
    ranked.slice(0, n).map((r) => r.item),
    random
  );
}
