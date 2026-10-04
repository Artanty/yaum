import PQueue from 'p-queue';
import { settings } from '../config.js';
import { buildQueries, matchTrack } from '../matcher.js';
import { matchUsable, type Candidate, type MatchResult, type TrackMeta } from '../model.js';
import { searchSongs as searchSongsReal } from '../ytmusic/search.js';
import { logger } from '../lib/logger.js';

/**
 * Matches LIBRARY songs to YouTube Music. The matcher itself is not new — `matcher.ts` already did
 * this for the /migrate converter, and it is deliberately reused rather than reimplemented, because
 * a second scoring implementation would drift and quietly disagree with the first.
 *
 * What was missing is that nothing ever filled `songs.yt_video_id`: the converter wrote a video id
 * into its OWN job tables, so a library song could never get a YouTube link and any "export links"
 * feature would have rendered an empty list forever.
 *
 * searchSongs is injectable so tests can run without YouTube. This dev box cannot reach YouTube at
 * all (connections silently drop — see back/AGENTS.md), so live matching has to be verified behind
 * YTM_PROXY or on another host; everything here is tested with mocked candidates.
 */
export interface MatchDeps {
  searchSongs: (query: string) => Promise<Candidate[]>;
}

export const defaultMatchDeps: MatchDeps = { searchSongs: searchSongsReal };

/** One library song, shaped as the matcher wants it. */
export interface MatchableSong {
  id: number;
  title: string;
  artists: string[];
  album: string | null;
  duration: number;
  yt_video_id: string | null;
  /** Why a stored video id can still be a bad answer: see isConfident. */
  match_score: number | null;
}

/**
 * A stored video id is only as good as the score behind it, and the score decides whether it is
 * usable. `uncertain` means the matcher found a plausible video that it does not trust — verified
 * live: a Yandex "Roxanne" with a wrong duration was matched to "Message In A Bottle — The Police"
 * at 0.57. Pasting that into a playlist as if it were Roxanne is worse than exporting nothing, so
 * the export lists these separately instead of as a plain link.
 *
 * Derived from the score rather than stored, which is what pipeline.matchWithSearch already does
 * when it reads a cache hit.
 */
export function isConfident(score: number | null): boolean {
  return score !== null && score >= settings.matchAccept;
}

export interface SongMatchOutcome extends MatchResult {
  songId: number;
  title: string;
  /** True when the stored match was kept, including a cache hit that avoided searching at all. */
  cached: boolean;
  error: string | null;
}

function toTrackMeta(song: MatchableSong): TrackMeta {
  return {
    title: song.title,
    artists: song.artists.length ? song.artists : [''],
    album: song.album,
    duration: song.duration,
    // The library is keyed by its own dedup hash, not a Yandex track id, and the matcher only uses
    // sourceId for reporting.
    sourceId: null,
  };
}

/**
 * Match one song. Tries each query variant in turn and keeps the first usable result, which mirrors
 * how pipeline.matchWithSearch behaves — the variants go from most to least specific, so a hit on
 * the first one is the one to trust.
 */
export async function matchSong(song: MatchableSong, deps: MatchDeps = defaultMatchDeps): Promise<MatchResult> {
  if (song.yt_video_id) {
    logger.log('library: match skipped, already matched', { songId: song.id, title: song.title, videoId: song.yt_video_id });
    return { status: 'matched', score: 0, videoId: song.yt_video_id };
  }

  const track = toTrackMeta(song);
  let best: MatchResult | null = null;
  for (const query of buildQueries(track)) {
    let candidates: Candidate[] = [];
    try {
      candidates = await deps.searchSongs(query);
    } catch (err) {
      // Name the cause: on a blocked machine every query fails this way, and "match failed" with no
      // reason sends you looking for a scoring bug instead of a network one.
      logger.error(`youtube search failed for "${query}"`, err, 'libraryMatch');
      return { status: 'not_found', score: 0, videoId: null };
    }
    const res = matchTrack(track, candidates);
    if (matchUsable(res) && (!best || res.score > best.score)) best = res;
    if (matchUsable(res) && res.score >= settings.matchAccept) break;
  }
  return best ?? { status: 'not_found', score: 0, videoId: null };
}

/**
 * Match a batch, searching through one bounded queue so a 50-song playlist cannot open 50
 * simultaneous connections to a host that may well be blocked.
 */
export async function matchSongs(
  songs: MatchableSong[],
  deps: MatchDeps = defaultMatchDeps,
  concurrency = settings.searchConcurrency,
): Promise<SongMatchOutcome[]> {
  const queue = new PQueue({ concurrency });
  return Promise.all(
    songs.map((song) =>
      queue.add(async (): Promise<SongMatchOutcome> => {
        try {
          const res = await matchSong(song, deps);
          return { ...res, songId: song.id, title: song.title, cached: false, error: null };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          return {
            status: 'not_found' as const,
            score: 0,
            videoId: null,
            songId: song.id,
            title: song.title,
            cached: false,
            error,
          };
        }
      }) as Promise<SongMatchOutcome>,
    ),
  );
}
