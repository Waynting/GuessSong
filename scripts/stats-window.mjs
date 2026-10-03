/**
 * The command line of `npm run stats`, turned into a window of UTC days.
 *
 * Its own module so `tests/stats-window.test.ts` can reach it: the report
 * itself runs top-level against production KV the moment it is imported, and a
 * test that did that would read (and could inflate) the numbers decisions are
 * made from.
 *
 * Every window ends today, and today is a partial UTC day. A window can be no
 * longer than `MAX_DAYS`, because that is how long the counters are held
 * (`LOOP_STATS_TTL_SECONDS` in lib/loop-stats.ts) — asking for more would print
 * days that have expired as days on which nothing happened.
 */

export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 7;

export const USAGE = `Usage: npm run stats -- [window]

  (nothing)            last ${DEFAULT_DAYS} UTC days, today included
  <n>, --days <n>      last n days (1-${MAX_DAYS})
  --today              today only, so far
  --week               last 7 days
  --month, --all       last ${MAX_DAYS} days — everything KV still holds
  --since YYYY-MM-DD   from that UTC day through today; use it to read only the
                       days after a release, so older days do not dilute it

Every window ends today, which is a partial UTC day.`;

const FLAG_DAYS = { "--today": 1, "--week": 7, "--month": MAX_DAYS, "--all": MAX_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of `date`, in UTC. */
export function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * `argv` is what follows the script name. Returns `{ help: true }`,
 * `{ error }`, or `{ days, since }` — `since` being the window's first UTC
 * day, so the header can name the range rather than only its length.
 */
export function parseWindow(argv, now = new Date()) {
  const args = [...argv];
  let days;

  const setDays = (n, what) => {
    if (days !== undefined) return `Give one window, not two (${what} came after another).`;
    days = n;
    return null;
  };

  while (args.length > 0) {
    const raw = args.shift();
    const eq = raw.indexOf("=");
    const flag = raw.startsWith("--") && eq !== -1 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith("--") && eq !== -1 ? raw.slice(eq + 1) : undefined;
    let error = null;

    if (flag === "--help" || flag === "-h") return { help: true };

    if (flag in FLAG_DAYS) {
      error = setDays(FLAG_DAYS[flag], flag);
    } else if (flag === "--days") {
      const value = inline ?? args.shift();
      const n = parseCount(value);
      error = n === null ? `--days needs a whole number 1-${MAX_DAYS}, got ${show(value)}.` : setDays(n, flag);
    } else if (flag === "--since") {
      const value = inline ?? args.shift();
      const start = parseDay(value);
      if (start === null) {
        error = `--since needs a date as YYYY-MM-DD, got ${show(value)}.`;
      } else {
        const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
        const n = Math.round((today - start) / DAY_MS) + 1;
        if (n < 1) error = `--since ${value} is after today (${utcDay(now)}, UTC).`;
        else if (n > MAX_DAYS) error = `--since ${value} is ${n} days back; counters are held ${MAX_DAYS} days. Use --all.`;
        else error = setDays(n, flag);
      }
    } else if (/^\d+$/.test(raw)) {
      const n = parseCount(raw);
      error = n === null ? `Day count must be 1-${MAX_DAYS} (counters are held ${MAX_DAYS} days).` : setDays(n, raw);
    } else {
      error = `Unknown argument ${show(raw)}.`;
    }

    if (error) return { error };
  }

  const count = days ?? DEFAULT_DAYS;
  const first = new Date(Date.parse(`${utcDay(now)}T00:00:00Z`) - (count - 1) * DAY_MS);
  return { days: count, since: utcDay(first) };
}

function parseCount(value) {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  return n >= 1 && n <= MAX_DAYS ? n : null;
}

/** Epoch ms of a real `YYYY-MM-DD` day, or null — 2026-02-30 is not one. */
function parseDay(value) {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || utcDay(new Date(ms)) !== value) return null;
  return ms;
}

function show(value) {
  return value === undefined ? "nothing" : JSON.stringify(value);
}
