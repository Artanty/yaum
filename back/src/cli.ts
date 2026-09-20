#!/usr/bin/env tsx
import process from 'node:process';
import { buildQueries, matchTrack } from './matcher.js';
import type { Candidate } from './model.js';
import { artistStr } from './model.js';
import { parseUrl } from './url.js';
import { fetchCollections, YandexClient } from './yandex/client.js';
import { searchSongs } from './ytmusic/search.js';


async function cmdMatch(url: string): Promise<void> {
  const target = parseUrl(url);
  const client = new YandexClient();
  const collections = await fetchCollections(target, client);
  for (const coll of collections) {
    console.log(`\n=== ${coll.title} (${coll.tracks.length} tracks) ===`);
    for (const track of coll.tracks) {
      let best = null as null | ReturnType<typeof matchTrack>;
      for (const query of buildQueries(track)) {
        let candidates: Candidate[] = [];
        try {
          candidates = await searchSongs(query);
        } catch (err) {
          console.error(`  search error: ${err instanceof Error ? err.message : err}`);
        }
        const res = matchTrack(track, candidates);
        if (best === null || res.score > best.score) best = res;
        if (best.status === 'matched') break;
      }
      best = best ?? matchTrack(track, []);
      console.log(
        `[${best.status.padEnd(9)}] ${best.score.toFixed(2)}  ${artistStr(track)} — ${track.title} ` +
          `(${track.duration}s)  ->  ${best.ytArtist ?? ''} — ${best.ytTitle ?? ''}` +
          (best.videoId ? `  https://music.youtube.com/watch?v=${best.videoId}` : ''),
      );
    }
  }
}

async function main(): Promise<void> {
  const [, , cmd, url] = process.argv;
  if (cmd !== 'match' || !url) {
    console.error('usage: tsx src/cli.ts match <yandex-url>');
    process.exit(2);
  }
  await cmdMatch(url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
