import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { logger } from '../lib/logger.js';
import { settings } from '../config.js';
import type { Collection, TrackMeta } from '../model.js';
import type { YandexTarget } from '../url.js';

const BASE = 'https://api.music.yandex.ru';
const DEVICE_ID = '7eaa39f9-c5b1-4181-a712-7c3e36670319';

interface YandexResponse {
  result?: any;
  error?: { name?: string; message?: string };
}

export class YandexClient {
  private token: string | null;
  private dispatcher: ProxyAgent | undefined;

  constructor(token: string | null = settings.yandexToken, proxy: string | null = settings.yandexProxy) {
    this.token = token;
    if (proxy) this.dispatcher = new ProxyAgent(proxy);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': 'Yandex-Music-API',
      'Accept-Language': 'ru',
      'X-Yandex-Music-Device-Id': DEVICE_ID,
      'X-Yandex-Music-Device-UUID': DEVICE_ID,
    };
    if (this.token) h['Authorization'] = `OAuth ${this.token}`;
    return h;
  }

  private async request(path: string, params?: Record<string, string>): Promise<any> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const res = await undiciFetch(url.toString(), {
      headers: this.headers(),
      dispatcher: this.dispatcher,
    } as any);
    const body = (await res.json().catch(() => null)) as YandexResponse | null;
    if (body?.error) {
      const err = new Error(`Yandex API error [${body.error.name}]: ${body.error.message}`);
      logger.error('yandex: API error', err, 'yandexClient.request');
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Yandex API HTTP ${res.status} for ${path}`);
      logger.error('yandex: HTTP error', err, 'yandexClient.request');
      throw err;
    }
    logger.log('yandex: ok', { path, status: res.status });
    return body?.result ?? null;
  }

  playlist(kind: string, user: string): Promise<any> {
    return this.request(`/users/${encodeURIComponent(user)}/playlists/${encodeURIComponent(kind)}`);
  }

  // share links: https://music.yandex.ru/playlists/lk.<token> resolve anonymously to the
  // underlying playlist (full track list included) via /playlist/<token>
  playlistShare(token: string): Promise<any> {
    return this.request(`/playlist/${encodeURIComponent(token)}`);
  }

  playlistsList(user: string): Promise<any[]> {
    return this.request(`/users/${encodeURIComponent(user)}/playlists/list`);
  }

  likesTracks(user?: string | null): Promise<any> {
    return this.request(`/users/${encodeURIComponent(user || 'me')}/likes/tracks`);
  }

  likesAlbums(user?: string | null): Promise<any[]> {
    return this.request(`/users/${encodeURIComponent(user || 'me')}/likes/albums`, { rich: 'true' });
  }

  async tracks(ids: string[]): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const result = await this.request('/tracks', { trackIds: batch.join(','), with: 'pos' });
      out.push(...(result ?? []));
    }
    return out;
  }

  albumWithTracks(albumId: string): Promise<any> {
    return this.request(`/albums/${encodeURIComponent(albumId)}/with-tracks`);
  }
}

export function trackMeta(raw: any): TrackMeta | null {
  if (!raw || raw.error) return null;
  const title = raw.title ?? raw.track?.title;
  if (!title) return null;
  const durationMs = raw.durationMs ?? raw.track?.durationMs ?? raw.length ?? 0;
  const artists = (raw.artists ?? raw.track?.artists ?? [])
    .map((a: any) => a.name)
    .filter((n: any): n is string => Boolean(n));
  const album = raw.albums?.[0]?.title ?? raw.albums?.[0]?.name ?? raw.albums?.[0]?.version ?? null;
  return {
    title,
    artists: artists.length ? artists : ['Unknown'],
    album,
    duration: Math.round(durationMs / 1000),
    sourceId: String(raw.realId ?? raw.id ?? ''),
  };
}

export function trackMetaFromId(rawId: any): string | null {
  const id = rawId?.trackId ?? rawId?.id ?? rawId;
  if (id === undefined || id === null) return null;
  return String(id);
}

function expandTracks(rawTracks: any[], client: YandexClient): Promise<TrackMeta[]> {
  const metas: (TrackMeta | null)[] = rawTracks.map(trackMeta);
  const missingIds = rawTracks
    .map((t, i) => (metas[i] ? null : trackMetaFromId(t)))
    .filter((x): x is string => Boolean(x));
  if (!missingIds.length) {
    return Promise.resolve(metas.filter((m): m is TrackMeta => Boolean(m)));
  }
  return client.tracks(missingIds).then((full) => {
    for (const t of full) {
      const m = trackMeta(t);
      if (m) metas[rawTracks.findIndex((raw) => trackMetaFromId(raw) === m.sourceId)] = m;
    }
    return metas.filter((m): m is TrackMeta => Boolean(m));
  });
}

export async function fetchCollections(target: YandexTarget, client: YandexClient): Promise<Collection[]> {
  if (target.mode === 'playlist') {
    const pl = target.shareToken
      ? await client.playlistShare(target.shareToken)
      : await client.playlist(target.kind!, target.user!);
    if (!pl) throw new Error('playlist not found or not accessible');
    const metas = await expandTracks(pl.tracks ?? [], client);
    return [{ title: pl.title ?? 'Playlist', sourceUrl: target.url ?? null, tracks: metas }];
  }

  if (target.mode === 'liked') {
    const data = await client.likesTracks(target.user);
    const ids = (data?.tracks ?? []).map(trackMetaFromId).filter((x: any): x is string => Boolean(x));
    const full = await client.tracks(ids);
    const metas = full.map(trackMeta).filter((m): m is TrackMeta => Boolean(m));
    return [{ title: 'Liked from Yandex Music', sourceUrl: target.url ?? null, tracks: metas }];
  }

  if (target.mode === 'album') {
    const album = await client.albumWithTracks(target.albumId!);
    if (!album) throw new Error('album not found');
    return [{ title: album.title ?? "Album", sourceUrl: target.url ?? null, tracks: albumTracks(album) }];
  }

  if (target.mode === 'saved-albums') {
    const likes = await client.likesAlbums(target.user);
    const collections: Collection[] = [];
    for (const like of likes ?? []) {
      const album = like?.album;
      if (!album) continue;
      let tracks = albumTracks(album);
      if (!tracks.length) {
        try {
          const full = await client.albumWithTracks(String(album.id));
          tracks = full ? albumTracks(full) : [];
        } catch {
          tracks = [];
        }
      }
      const artistNames = (album.artists ?? []).map((a: any) => a.name).filter(Boolean).join(', ');
      collections.push({
        title: artistNames ? `${artistNames} — ${album.title ?? 'Album'}` : album.title ?? 'Album',
        sourceUrl: null,
        tracks,
      });
    }
    return collections;
  }

  if (target.mode === 'all-playlists') {
    const playlists = await client.playlistsList(target.user!);
    const collections: Collection[] = [];
    for (const pl of playlists ?? []) {
      try {
        const full = await client.playlist(String(pl.kind), target.user!);
        const metas = await expandTracks(full.tracks ?? [], client);
        collections.push({
          title: full.title ?? `Playlist ${pl.kind}`,
          sourceUrl: `https://music.yandex.ru/users/${target.user}/playlists/${pl.kind}`,
          tracks: metas,
        });
      } catch {
        // skip inaccessible playlist
      }
    }
    return collections;
  }

  throw new Error(`unknown mode: ${target.mode}`);
}

function albumTracks(album: any): TrackMeta[] {
  const metas: TrackMeta[] = [];
  for (const volume of album.volumes ?? []) {
    for (const t of volume) {
      const m = trackMeta(t);
      if (m) metas.push(m);
    }
  }
  return metas;
}
