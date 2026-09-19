import crypto from 'node:crypto';
import PQueue from 'p-queue';
import { settings } from './config.js';
import type { Store } from './db.js';
import { buildQueries, matchTrack } from './matcher.js';
import { artistStr, matchUsable, type Candidate, type Collection, type MatchResult, type TrackMeta } from './model.js';
import { fromForm, type YandexTarget } from './url.js';
import { fetchCollections as fetchCollectionsReal, YandexClient } from './yandex/client.js';
import { searchSongs as searchSongsReal } from './ytmusic/search.js';

export interface PipelineDeps {
  fetchCollections: (target: YandexTarget) => Promise<Collection[]>;
  searchSongs: (query: string) => Promise<Candidate[]>;
}

const defaultClient = new YandexClient();

export const defaultDeps: PipelineDeps = {
  fetchCollections: (target) => fetchCollectionsReal(target, defaultClient),
  searchSongs: searchSongsReal,
};

export function cacheKey(track: TrackMeta): string {
  return crypto.createHash('sha1').update(`${track.title}|${artistStr(track)}|${track.duration}`).digest('hex');
}

export async function matchWithSearch(
  store: Store,
  track: TrackMeta,
  deps: PipelineDeps,
  queue: PQueue,
): Promise<MatchResult> {
  const key = cacheKey(track);
  const cached = store.cacheGet(key);
  if (cached?.video_id) {
    return {
      status: cached.score >= settings.matchAccept ? 'matched' : 'uncertain',
      score: cached.score ?? 0,
      videoId: cached.video_id,
      ytTitle: cached.yt_title,
      ytArtist: cached.yt_artist,
      ytDuration: cached.yt_duration,
    };
  }

  let best: MatchResult | null = null;
  for (const query of buildQueries(track)) {
    let candidates: Candidate[] = [];
    try {
      candidates = await queue.add(() => deps.searchSongs(query)) as Candidate[];
    } catch (err) {
      console.error(`search failed for "${query}":`, err instanceof Error ? err.message : err);
    }
    const result = matchTrack(track, candidates);
    if (best === null || result.score > best.score) {
      best = result;
      best.query = query;
    }
    if (result.status === 'matched') {
      best = result;
      best.query = query;
      break;
    }
  }

  if (!best) best = { status: 'not_found', score: 0 };
  if (best.videoId) {
    store.cachePut(key, best.videoId, best.ytTitle ?? '', best.ytArtist ?? '', best.ytDuration ?? null, best.score);
  }
  return best;
}

interface ResultRow {
  position: number;
  track: TrackMeta;
  res: MatchResult;
}

export async function runCollection(
  store: Store,
  jobId: string,
  idx: number,
  coll: Collection,
  deps: PipelineDeps,
  queue: PQueue,
): Promise<Record<string, unknown>> {
  const tracks = coll.tracks;
  store.addTotal(jobId, tracks.length);

  const seen = new Set<string>();
  const results: ResultRow[] = [];
  for (let position = 0; position < tracks.length; position++) {
    const track = tracks[position];
    const key = `${track.title}|${artistStr(track)}|${track.duration}`;
    if (seen.has(key)) {
      results.push({ position, track, res: { status: 'skipped_dup', score: 0 } });
      continue;
    }
    seen.add(key);
    const res = await matchWithSearch(store, track, deps, queue);
    results.push({ position, track, res });
    store.incProcessed(jobId);
  }

  const rows = results.map(({ position, track, res }) => ({
    job_id: jobId,
    collection_idx: idx,
    position,
    src_title: track.title,
    src_artist: artistStr(track),
    src_duration: track.duration,
    status: res.status,
    score: res.score,
    yt_video_id: res.videoId ?? null,
    yt_title: res.ytTitle ?? null,
    yt_artist: res.ytArtist ?? null,
    yt_duration: res.ytDuration ?? null,
    collection_title: coll.title,
  }));
  store.addItems(rows);

  const usable = new Set(
    results
      .filter((r) => matchUsable(r.res))
      .map((r) => `${r.track.title}|${artistStr(r.track)}|${r.track.duration}`),
  );

  return {
    title: coll.title,
    matched: results.filter((r) => r.res.status === 'matched').length,
    uncertain: results.filter((r) => r.res.status === 'uncertain').length,
    not_found: results.filter((r) => r.res.status === 'not_found').length,
    skipped_dup: results.filter((r) => r.res.status === 'skipped_dup').length,
    links: usable.size,
  };
}

export async function runJob(store: Store, jobId: string, mode: string, source: string, deps: PipelineDeps = defaultDeps): Promise<void> {
  try {
    store.setJob(jobId, { status: 'running' });
    const target = fromForm(mode, source);
    const collections = await deps.fetchCollections(target);
    const queue = new PQueue({ concurrency: settings.searchConcurrency });
    const summaries: Record<string, unknown>[] = [];
    let idx = 0;
    for (const coll of collections) {
      if (!coll.tracks.length) continue;
      summaries.push(await runCollection(store, jobId, idx++, coll, deps, queue));
    }
    store.setJob(jobId, { status: 'done', summary_json: JSON.stringify(summaries) });
  } catch (err) {
    console.error(`job ${jobId} failed:`, err);
    store.setJob(jobId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
}

export function startJob(store: Store, mode: string, source: string, deps: PipelineDeps = defaultDeps): string {
  const id = store.createJob(mode, source);
  void runJob(store, id, mode, source, deps);
  return id;
}
