import { readFileSync } from 'node:fs';
import { YandexClient, fetchCollections } from './src/yandex/client.js';

const tokPath = process.env.TOK_FILE!;
const token = readFileSync(tokPath, 'utf8').trim();
console.log('smoke token bytes:', JSON.stringify(token.slice(1, 14)), `(len ${token.length})`);

const c = new YandexClient(null, null);
const cols = await fetchCollections(
  { mode: 'playlist', user: null, kind: null, shareToken: token, url: 'https://music.yandex.ru/playlists/<tok>' },
  c,
);
const c0 = cols[0];
console.log('RESULT OK | title:', JSON.stringify(c0.title), '| tracks:', c0.tracks.length);
console.log('first track:', JSON.stringify(c0.tracks[0]).slice(0, 160));
