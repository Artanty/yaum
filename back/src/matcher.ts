import { WRatio } from 'fuzzball';
import { settings } from './config.js';
import { artistStr } from './model.js';
import type { Candidate, MatchResult, MatchStatus, TrackMeta } from './model.js';

const BRACKET_RE = /[\(\[\{][^\)\]\}]*[\)\]\}]/g;
const NOISE_RE =
  /\b(official\s*(audio|video|mv|m\/v)?\s*(music)?(video)?|official|audio|video|lyrics?|visualizer|official\s*lyrics|explicit|clean|hd|hq|4k)\b/gi;

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya', і: 'i', џ: 'dz', ґ: 'g', є: 'ye', ї: 'yi',
};

const TRANSLIT_CLASS = new RegExp(`[${Object.keys(TRANSLIT).join('')}]`, 'g');

export function transliterate(text: string): string {
  if (![...text].some((ch) => TRANSLIT[ch.toLowerCase()] !== undefined)) return text;
  return [...text].map((ch) => TRANSLIT[ch.toLowerCase()] ?? ch).join('');
}

export function normalize(text: string): string {
  let t = text.normalize('NFKC').toLowerCase();
  t = t.replace(BRACKET_RE, ' ');
  t = t.replace(NOISE_RE, ' ');
  t = t.replace(TRANSLIT_CLASS, (m) => TRANSLIT[m] ?? m);
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function feature(text: string): string {
  return normalize(text).split(' ').sort().join(' ');
}

export function durationOk(a: number | null | undefined, b: number | null | undefined, tol: number): boolean | null {
  if (!a || !b) return null;
  const diff = Math.abs(a - b);
  if (diff <= tol) return true;
  return diff <= Math.max(0.1 * Math.min(a, b), tol);
}

function wratio(a: string, b: string): number {
  return WRatio(a, b) / 100;
}

export function scoreCandidate(track: TrackMeta, cand: Candidate): [number, boolean | null] {
  const tSim = Math.max(
    wratio(normalize(track.title), normalize(cand.title)),
    wratio(feature(track.title), feature(cand.title)),
  );
  const srcArtists = track.artists.map((a) => normalize(a)).join(' ');
  const candArtists = normalize(cand.artists);
  const aSim = Math.max(
    wratio(srcArtists, candArtists),
    ...track.artists.map((a) => wratio(normalize(a), candArtists)),
  );
  let combined = 0.6 * tSim + 0.4 * aSim;
  const dur = durationOk(track.duration, cand.duration, settings.durationTolerance);
  if (dur === false) combined *= 0.3;
  return [combined, dur];
}

export function buildQueries(track: TrackMeta): string[] {
  const main = track.artists[0] ?? '';
  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    q = q.trim();
    if (q && !seen.has(q.toLowerCase())) {
      seen.add(q.toLowerCase());
      variants.push(q);
    }
  };
  add(`${main} ${track.title}`);
  add(`${track.title} ${main}`);
  const trTitle = transliterate(track.title);
  const trMain = transliterate(main);
  if (trTitle !== track.title || trMain !== main) {
    add(`${trMain} ${trTitle}`);
  }
  if (track.artists.length > 1) {
    add(`${track.artists[1]} ${track.title}`);
  }
  return variants;
}

export function matchTrack(track: TrackMeta, candidates: Candidate[]): MatchResult {
  let best: MatchResult | null = null;
  for (const cand of candidates) {
    const [score, _dur] = scoreCandidate(track, cand);
    if (best === null || score > best.score) {
      best = {
        status: 'not_found' as MatchStatus,
        score,
        videoId: cand.videoId,
        ytTitle: cand.title,
        ytArtist: cand.artists,
        ytDuration: cand.duration,
      };
    }
  }
  if (best === null) {
    return { status: 'not_found', score: 0 };
  }
  if (best.score >= settings.matchAccept) best.status = 'matched';
  else if (best.score >= settings.matchUncertain) best.status = 'uncertain';
  else best.status = 'not_found';
  return best;
}

export { artistStr };
