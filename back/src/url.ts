export const MODES = ['playlist', 'liked', 'album', 'saved-albums', 'all-playlists'] as const;
export type Mode = (typeof MODES)[number];

export interface YandexTarget {
  mode: Mode;
  user?: string | null;
  kind?: string | null;
  albumId?: string | null;
  url?: string | null;
}

const PLAYLIST_RE =
  /(?:music\.yandex\.(?:ru|by|kz|am|az|ge|com|md|tm|kg|uz)\/)users\/(?<user>[^/]+)\/playlists\/(?<kind>[^/?#&]+)/i;
const ALBUM_RE = /(?:music\.yandex\.(?:ru|by|kz|am|az|ge|com|md|tm|kg|uz)\/)album\/(?<album>\d+)/i;

export function parseUrl(url: string): YandexTarget {
  url = url.trim();
  const album = ALBUM_RE.exec(url);
  if (album?.groups) {
    return { mode: 'album', albumId: album.groups.album, url };
  }
  const m = PLAYLIST_RE.exec(url);
  if (m?.groups) {
    const user = m.groups.user;
    const kind = m.groups.kind;
    if (kind.toLowerCase() === 'liked') {
      return { mode: 'liked', user, url };
    }
    return { mode: 'playlist', user, kind, url };
  }
  throw new Error(`unsupported Yandex Music URL: ${JSON.stringify(url)}`);
}

export function fromForm(mode: string, source: string): YandexTarget {
  source = source.trim();
  if (mode === 'playlist') {
    const t = parseUrl(source);
    if (t.mode !== 'playlist') {
      throw new Error('expected a playlist URL like music.yandex.ru/users/<user>/playlists/<kind>');
    }
    return t;
  }
  if (mode === 'album') {
    const t = parseUrl(source);
    if (t.mode !== 'album') {
      throw new Error('expected an album URL like music.yandex.ru/album/<id>');
    }
    return t;
  }
  if (mode === 'liked' || mode === 'saved-albums' || mode === 'all-playlists') {
    let user = source;
    if (user.includes('/')) {
      const m = /\/users\/([^/?#&]+)/.exec(user);
      user = m ? m[1] : user.replace(/\/+$/, '').split('/').pop() ?? '';
    }
    if (!user) {
      throw new Error('Yandex user name is required');
    }
    return { mode, user };
  }
  throw new Error(`unknown mode: ${mode}`);
}
