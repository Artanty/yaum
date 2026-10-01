import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  Album,
  AppNotification,
  Artist,
  Collaborator,
  Genre,
  ImportDetail,
  ImportRow,
  Me,
  Playlist,
  PlaylistDetail,
  SongsPage,
  User,
} from './models';
import { Session } from './session';

const BASE = '/api/library';

interface NotificationsResponse {
  notifications: AppNotification[];
  unread: number;
  pendingImports: number;
}

interface ScanResponse {
  importId: number;
  trackCount: number;
  newCount: number;
  dupCount: number;
  skippedCount: number;
  pendingImports: number;
}

/**
 * Reads go through httpResource (eager, cancellable, re-fetches when its inputs change); writes go
 * through HttpClient directly. That split is the rule, not a preference — a resource that is also
 * the mutation target would refetch mid-write.
 */
@Injectable({ providedIn: 'root' })
export class LibraryApi {
  private readonly http = inject(HttpClient);
  private readonly session = inject(Session);

  // The server wraps collections in an object ({users, songs, ...}) so it can add totals later
  // without breaking clients; the typed shape has to match that, not the bare array.
  readonly usersResource = httpResource<{ users: User[] }>(() => `${BASE}/users`);

  // Bumping this refreshes every resource below. Signals rather than a global event bus, so a
  // component that never reads it never refetches.
  // Declaration order matters: the readonly view must come AFTER the signal it wraps, because class
  // field initializers run in order and `this.reloadTickSignal` would still be undefined above it.
  private readonly reloadTickSignal = signal(0);
  readonly reloadTick = this.reloadTickSignal.asReadonly();

  readonly me = httpResource<Me>(() => {
    this.session.userId();
    this.reloadTickSignal();
    return `${BASE}/me`;
  });

  readonly notifications = httpResource<NotificationsResponse>(() => {
    this.session.userId();
    this.reloadTick();
    return `${BASE}/notifications`;
  });

  readonly pendingImports = httpResource<{ imports: ImportRow[] }>(() => {
    this.session.userId();
    this.reloadTick();
    return `${BASE}/imports/pending`;
  });

  readonly genres = httpResource<{ genres: Genre[] }>(() => `${BASE}/genres`);
  readonly artists = httpResource<{ artists: Artist[] }>(() => `${BASE}/artists`);
  readonly albums = httpResource<{ albums: Album[] }>(() => `${BASE}/albums`);

  readonly playlists = httpResource<{ mine: Playlist[]; shared: Playlist[] }>(() => {
    this.session.userId();
    this.reloadTick();
    return `${BASE}/playlists`;
  });

  /** Search inputs, owned by the library page. */
  readonly query = signal('');
  readonly albumFilter = signal<number | null>(null);
  readonly artistFilter = signal<number | null>(null);
  readonly genreFilter = signal<number | null>(null);
  readonly offset = signal(0);
  static readonly PAGE = 50;

  readonly songs = httpResource<SongsPage>(() => {
    const params = new URLSearchParams();
    const q = this.query().trim();
    if (q) params.set('q', q);
    if (this.albumFilter()) params.set('albumId', String(this.albumFilter()));
    if (this.artistFilter()) params.set('artistId', String(this.artistFilter()));
    if (this.genreFilter()) params.set('genreId', String(this.genreFilter()));
    params.set('limit', String(LibraryApi.PAGE));
    params.set('offset', String(this.offset()));
    return `${BASE}/songs?${params.toString()}`;
  });

  // A single refresh token for every resource above, so one write refreshes every view.
  refresh(): void {
    this.reloadTickSignal.update((n) => n + 1);
  }

  // -------------------------------------------------------------- mutations

  createPlaylistFromImport(importId: number, name: string, songIds?: number[]): Observable<{ playlistId: number; trackCount: number }> {
    return this.http.post<{ playlistId: number; trackCount: number }>(`${BASE}/imports/${importId}/playlist`, {
      name,
      ...(songIds?.length ? { songIds } : {}),
    });
  }

  createPlaylist(name: string, description: string | null): Observable<{ playlistId: number }> {
    return this.http.post<{ playlistId: number }>(`${BASE}/playlists`, { name, description });
  }

  renamePlaylist(playlistId: number, name: string): Observable<{ ok: true }> {
    return this.http.patch<{ ok: true }>(`${BASE}/playlists/${playlistId}`, { name });
  }

  deletePlaylist(playlistId: number): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${BASE}/playlists/${playlistId}`);
  }

  addTracks(playlistId: number, songIds: number[]): Observable<{ added: number; notifiedUsers: number }> {
    return this.http.post<{ added: number; notifiedUsers: number }>(`${BASE}/playlists/${playlistId}/items`, { songIds });
  }

  removeTrack(playlistId: number, itemId: number): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${BASE}/playlists/${playlistId}/items/${itemId}`);
  }

  share(playlistId: number, userId: number, canEdit: boolean): Observable<unknown> {
    return this.http.post(`${BASE}/playlists/${playlistId}/share`, { userId, canEdit });
  }

  unshare(playlistId: number, userId: number): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${BASE}/playlists/${playlistId}/share/${userId}`);
  }

  markRead(ids?: number[]): Observable<{ marked: number }> {
    return this.http.post<{ marked: number }>(`${BASE}/notifications/read`, ids?.length ? { ids } : {});
  }

  /** Used by the extension replay in tests; not called from the app itself. */
  scan(payload: { userId: number; tracks: unknown[]; pageUrl?: string }): Observable<ScanResponse> {
    return this.http.post<ScanResponse>(`${BASE}/scan`, payload);
  }

  readonly songCount = computed(() => this.songs.value()?.total ?? 0);
}
