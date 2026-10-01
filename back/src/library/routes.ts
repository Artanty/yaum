import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../lib/logger.js';
import {
  MAX_ENTRIES_PER_REQUEST,
  ingestExtLogs,
  normalizeExtEntries,
  readExtLogs,
} from '../lib/ext-log.js';
import { NULL_GENRE_PROVIDER } from './genre.js';
import type { LibraryStore } from './store.js';
import type { PlaylistRow, SongRow, SongView } from './types.js';

export const LIBRARY_PREFIX = '/api/library';

const MAX_PAGE = 500;

/**
 * Decorated onto the app by buildApp. Declared here as well so the library routes can read the
 * live request-logging counters without importing server.ts (which would be a cycle).
 */
export interface RequestLogStats {
  skipPoll: boolean;
  skippedPolls: number;
  loggedRequests: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Log the suppressed-vs-logged request counters, if anything was suppressed. */
    reportSkipCounters: (why: string) => Promise<void>;
    /** Live counters, so "the log is quiet" can be explained rather than guessed at. */
    skipPollStats: () => RequestLogStats;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Viewer {
  id: number;
  username: string;
  display_name: string;
}

/**
 * There is no auth yet, so "who is calling" is one header. x-user-id rather than a cookie on
 * purpose: no CSRF surface to reason about, and the extension sends the exact same header, so the
 * browser and the scanner take one code path.
 */
function requireViewer(store: LibraryStore) {
  return async (request: FastifyRequest): Promise<Viewer> => {
    const raw = request.headers['x-user-id'];
    const id = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'x-user-id header must be a positive integer (there is no login yet)');
    }
    const user = await store.getUser(id);
    if (!user) throw new HttpError(404, `no user with id ${id}`);
    return { id: user.id, username: user.username, display_name: user.display_name };
  };
}

/**
 * The ONLY permission rule in the app: owner, or a collaborator flagged can_edit. Every mutating
 * playlist route goes through this, so "who may edit" is answered in one file instead of being
 * re-derived (and subtly re-implemented) per route.
 */
async function assertCanEdit(store: LibraryStore, playlist: PlaylistRow, userId: number): Promise<void> {
  if (playlist.owner_id === userId) return;
  const collabs = await store.listCollaborators(playlist.id);
  const me = collabs.find((c) => c.user_id === userId);
  if (!me) {
    logger.warn('library: edit denied, not a collaborator', { playlistId: playlist.id, userId });
    throw new HttpError(404, 'playlist not found');
  }
  if (!me.can_edit) {
    logger.warn('library: edit denied, view-only', { playlistId: playlist.id, userId });
    throw new HttpError(403, 'you have view-only access to this playlist');
  }
}

async function assertCanView(store: LibraryStore, playlist: PlaylistRow, userId: number): Promise<void> {
  if (playlist.owner_id === userId) return;
  const collabs = await store.listCollaborators(playlist.id);
  if (!collabs.some((c) => c.user_id === userId)) throw new HttpError(404, 'playlist not found');
}

async function mustGetPlaylist(store: LibraryStore, id: number): Promise<PlaylistRow> {
  const playlist = await store.getPlaylist(id);
  if (!playlist) throw new HttpError(404, 'playlist not found');
  return playlist;
}

function intParam(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive integer`);
  return n;
}

function optionalIntParam(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return intParam(value, name);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Tracks are whatever shape the scan produced — the extension sends {artists: string[]}. */
interface RawTrack {
  title?: unknown;
  artists?: unknown;
  album?: unknown;
  durationS?: unknown;
}

function readTracks(body: unknown): { title: string; artists: string[]; album: string | null; durationS: number }[] {
  const rows = Array.isArray(body) ? body : (body as { tracks?: unknown })?.tracks;
  if (!Array.isArray(rows)) throw new HttpError(400, 'expected {tracks: [...]}');
  if (rows.length > 5000) throw new HttpError(413, `refusing ${rows.length} tracks in one scan (max 5000)`);

  const out: { title: string; artists: string[]; album: string | null; durationS: number }[] = [];
  let skipped = 0;
  for (const row of rows as RawTrack[]) {
    const title = String(row?.title ?? '').trim();
    if (!title) {
      skipped += 1;
      continue;
    }
    const artists = Array.isArray(row.artists)
      ? row.artists.map((a) => String(a ?? '').trim()).filter(Boolean)
      : String(row.artists ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    out.push({
      title,
      artists,
      album: String(row.album ?? '').trim() || null,
      durationS: Math.max(0, Math.round(num(row.durationS, 0))),
    });
  }
  if (!out.length) throw new HttpError(400, `no usable rows: ${rows.length} in, all missing a title (${skipped} skipped)`);
  return out;
}

async function toSongViews(store: LibraryStore, songs: SongRow[]): Promise<SongView[]> {
  const extras = await store.songExtras(songs);
  return songs.map((s) => {
    const e = extras.get(s.id);
    return { ...s, artists: e?.artists ?? [], genres: e?.genres ?? [], album_title: e?.album_title ?? null };
  });
}

export function registerLibraryRoutes(app: FastifyInstance, store: LibraryStore): void {
  const viewer = requireViewer(store);
  const wrap =
    (fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, reply);
      } catch (err) {
        if (err instanceof HttpError) return reply.code(err.status).type('text/plain').send(err.message);
        throw err;
      }
    };

  app.get(`${LIBRARY_PREFIX}/healthz`, wrap(async () => ({
    ok: true,
    genreProvider: NULL_GENRE_PROVIDER.name,
    note: 'no login yet: send x-user-id',
  })));

  app.get(`${LIBRARY_PREFIX}/users`, wrap(async () => ({ users: await store.listUsers() })));

  // ------------------------------------------------------------------- logs

  /**
   * Read the server log over HTTP. This exists so a bug report can be answered from evidence
   * without shell access to the box: "it did nothing" is answerable by reading what the server saw.
   * `source=memory` is this process's ring (what just happened); the default reads the rotated
   * files (survives restarts). No auth, like every other route here — do not expose this publicly.
   */
  app.get(`${LIBRARY_PREFIX}/logs`, wrap(async (request) => {
    const q = request.query as Record<string, string>;
    const last = Math.min(Math.max(num(q.last, 100), 1), 1000);
    const type = q.type === 'error' || q.type === 'app' ? q.type : 'all';
    const entries = await logger.getLogs({
      last,
      type,
      memory: q.source === 'memory',
      hideSensitive: true,
    });
    return {
      source: q.source === 'memory' ? 'memory' : 'files',
      logDir: process.env.LOG_DIR ?? 'logs',
      fileWriting: process.env.LOG_DISABLED !== 'true',
      count: entries.length,
      // So "the log is quiet" is answerable: these say how much was deliberately not logged.
      requestLogging: typeof app.skipPollStats === 'function' ? app.skipPollStats() : null,
      entries,
    };
  }));

  // Extension logs, shipped here so a trace outlives the machine that produced it: chrome.storage
  // is not greppable, not reachable over HTTP, and gone entirely with the browser profile.
  // Body: { extensionId?, userId?, entries: [{ts, level, scope, msg, stack?, data?}] }
  //
  // No auth, like every other route here — fine for a localhost admin tool, not fine on a public
  // host, where the caps in normalizeExtEntries are all that stands between it and a filled disk.
  app.post(`${LIBRARY_PREFIX}/ext-logs`, wrap(async (request) => {
    const body = (request.body ?? {}) as { extensionId?: unknown; userId?: unknown; entries?: unknown };
    const extensionId = typeof body.extensionId === 'string' ? body.extensionId.slice(0, 64) : null;

    // Prefer the header (consistent with every other route); the body field is for the extension,
    // whose fetch calls have no header interceptor.
    const headerId = request.headers['x-user-id'];
    let userId: number | null = null;
    if (headerId !== undefined) userId = (await viewer(request)).id;
    else if (body.userId !== undefined && body.userId !== null) {
      userId = intParam(body.userId, 'userId');
      // A user id that does not exist is a stale extension setting, not a reason to drop logs: the
      // trace is exactly what is needed to work out why it is stale.
      const known = await store.getUser(userId);
      if (!known) userId = null;
    }

    if (body.entries === undefined) {
      throw new HttpError(400, 'entries is required (array of {ts, level, scope, msg})');
    }
    const normalized = normalizeExtEntries(body.entries);
    await ingestExtLogs(normalized, { extensionId, userId });

    // One line into app.log: this is how you tell "the extension logged nothing" apart from "the
    // extension's logs never reached this server".
    logger.log('ext logs ingested', {
      received: Array.isArray(body.entries) ? body.entries.length : 0,
      stored: normalized.entries.length,
      dropped: normalized.dropped,
      capped: normalized.capped || undefined,
      extensionId,
      userId,
    }, 'ext-logs');

    return {
      ok: true,
      received: Array.isArray(body.entries) ? body.entries.length : 0,
      stored: normalized.entries.length,
      dropped: normalized.dropped,
      capped: normalized.capped,
      ...(normalized.capped
        ? { note: `kept the newest ${MAX_ENTRIES_PER_REQUEST} of a larger batch` }
        : {}),
    };
  }));

  app.get(`${LIBRARY_PREFIX}/ext-logs`, wrap(async (request) => {
    const q = request.query as Record<string, string>;
    const last = Math.min(Math.max(num(q.last, 100), 1), 1000);
    const all = await readExtLogs();

    const level = q.level;
    const extensionId = q.extensionId || null;
    const userId = q.userId ? intParam(q.userId, 'userId') : null;
    const filtered = all.filter((e) => {
      if (level && e.level !== level) return false;
      if (extensionId || userId !== null) {
        // data is `unknown` by design; the ingest shape puts extensionId/userId there.
        const d = (e.data ?? {}) as { extensionId?: unknown; userId?: unknown };
        if (extensionId && String(d.extensionId ?? '') !== extensionId) return false;
        if (userId !== null && Number(d.userId) !== userId) return false;
      }
      return true;
    });

    return {
      source: 'ext.log',
      logDir: process.env.LOG_DIR ?? 'logs',
      fileWriting: process.env.LOG_DISABLED !== 'true',
      count: Math.min(filtered.length, last),
      totalInFile: all.length,
      matchedInFile: filtered.length,
      entries: filtered.slice(-last),
    };
  }));

  // ------------------------------------------------------------------- scan

  app.post(`${LIBRARY_PREFIX}/scan`, wrap(async (request) => {
    // The body names the scanning user too, because the extension has no header interceptor.
    const body = (request.body ?? {}) as { userId?: unknown; pageUrl?: unknown; label?: unknown };
    const headerId = request.headers['x-user-id'];
    const headerUser = headerId === undefined ? null : await viewer(request);
    const userId = intParam(headerUser?.id ?? body.userId, 'userId');
    const user = await store.getUser(userId);
    if (!user) throw new HttpError(404, `no user with id ${userId}`);

    let tracks: { title: string; artists: string[]; album: string | null; durationS: number }[];
    try {
      tracks = readTracks(request.body);
    } catch (err) {
      // A rejected scan is the single most useful line when the user says "it did nothing", so
      // record the reason rather than letting it live only in the HTTP status.
      logger.warn('library: scan rejected', {
        userId,
        rawCount: Array.isArray((request.body as { tracks?: unknown[] })?.tracks)
          ? (request.body as { tracks: unknown[] }).tracks.length
          : null,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    const label = String(body.label ?? '').trim() || null;
    const pageUrl = String(body.pageUrl ?? '').trim() || null;

    const res = await store.importScan({ userId, sourceLabel: label, pageUrl, tracks });
    // The answer to "why is my library empty", in one line: how many rows arrived, what happened
    // to them, and whose library they went into.
    logger.log('library: scan accepted', {
      importId: res.importId,
      user: user.username,
      tracksIn: tracks.length,
      newCount: res.newCount,
      dupCount: res.dupCount,
      skippedCount: res.skippedCount,
      label,
      pageUrl,
    });
    return {
      ...res,
      user: { id: user.id, username: user.username },
      pendingImports: await store.pendingImportCount(userId),
    };
  }));

  // ---------------------------------------------------------------- imports

  app.get(`${LIBRARY_PREFIX}/imports/pending`, wrap(async (request) => {
    const me = await viewer(request);
    return { imports: await store.pendingImports(me.id) };
  }));

  app.get(`${LIBRARY_PREFIX}/imports/:id`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const row = await store.getImport(id);
    // 404 (not 403) for someone else's import: the ids are sequential and guessable, and this is
    // an owner-only queue — there is no reason to confirm the row exists.
    if (!row || row.user_id !== me.id) throw new HttpError(404, 'import not found');

    const songIds = await store.importItemSongIds(id);
    const ordered = await store.songsByIds(songIds);
    const newIds = new Set(await store.importNewSongIds(id));
    return {
      import: row,
      tracks: (await toSongViews(store, ordered)).map((v) => ({ ...v, isNew: newIds.has(v.id) })),
    };
  }));

  /**
   * Turn a queued import into a real playlist. This is the step the user does on login, and it is
   * what clears the pending banner.
   */
  app.post(`${LIBRARY_PREFIX}/imports/:id/playlist`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const row = await store.getImport(id);
    if (!row || row.user_id !== me.id) throw new HttpError(404, 'import not found');

    const body = (request.body ?? {}) as { name?: unknown; description?: unknown; songIds?: unknown };
    const songIds = Array.isArray(body.songIds) && body.songIds.length
      ? (body.songIds as unknown[]).map((v) => intParam(v, 'songIds[]'))
      : await store.importNewSongIds(id);

    // Every requested song must actually exist — a bad id would otherwise trip the FK and surface
    // as a 500 deep inside MySQL.
    const exist = await store.existingSongIds(songIds);
    const missing = songIds.filter((s) => !exist.has(s));
    if (missing.length) throw new HttpError(400, `unknown song id(s): ${missing.join(', ')}`);
    // Also refuse songs that are not part of THIS import: otherwise this endpoint becomes a
    // "put any song id into any playlist" hole.
    const fromImport = new Set(await store.importItemSongIds(id));
    const foreign = songIds.filter((s) => !fromImport.has(s));
    if (foreign.length) throw new HttpError(400, `song id(s) not part of import ${id}: ${foreign.join(', ')}`);

    const name = String(body.name ?? '').trim() || `${row.source_label ?? 'Imported'} (${row.track_count} tracks)`;
    const playlistId = await store.createPlaylist(me.id, name, String(body.description ?? '').trim() || null);
    await store.addPlaylistItems(playlistId, songIds, me.id);
    await store.markImportProcessed(id, playlistId);
    logger.log('library: import turned into playlist', { importId: id, playlistId, user: me.username, songs: songIds.length, name });
    return { playlistId, importId: id, trackCount: songIds.length };
  }));

  // ------------------------------------------------------------------ songs

  app.get(`${LIBRARY_PREFIX}/songs`, wrap(async (request) => {
    await viewer(request);
    const q = request.query as Record<string, string>;
    const limit = Math.min(Math.max(num(q.limit, 50), 1), MAX_PAGE);
    const offset = Math.max(num(q.offset, 0), 0);
    const { total, rows } = await store.searchSongs({
      q: q.q,
      albumId: optionalIntParam(q.albumId, 'albumId'),
      artistId: optionalIntParam(q.artistId, 'artistId'),
      genreId: optionalIntParam(q.genreId, 'genreId'),
      limit,
      offset,
    });
    return { total, limit, offset, songs: await toSongViews(store, rows) };
  }));

  app.get(`${LIBRARY_PREFIX}/songs/:id`, wrap(async (request) => {
    await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const song = await store.getSong(id);
    if (!song) throw new HttpError(404, 'song not found');
    const [view] = await toSongViews(store, [song]);
    return { song: view };
  }));

  app.get(`${LIBRARY_PREFIX}/artists`, wrap(async (request) => {
    await viewer(request);
    return { artists: await store.listArtists() };
  }));

  app.get(`${LIBRARY_PREFIX}/albums`, wrap(async (request) => {
    await viewer(request);
    return { albums: await store.listAlbums() };
  }));

  app.get(`${LIBRARY_PREFIX}/genres`, wrap(async (request) => {
    await viewer(request);
    return { genres: await store.listGenres() };
  }));

  // -------------------------------------------------------------- playlists

  app.get(`${LIBRARY_PREFIX}/playlists`, wrap(async (request) => {
    const me = await viewer(request);
    const playlists = await store.listPlaylistsForUser(me.id);
    return {
      mine: playlists.filter((p) => p.owner_id === me.id),
      shared: playlists.filter((p) => p.owner_id !== me.id),
    };
  }));

  app.post(`${LIBRARY_PREFIX}/playlists`, wrap(async (request) => {
    const me = await viewer(request);
    const body = (request.body ?? {}) as { name?: unknown; description?: unknown };
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name is required');
    const id = await store.createPlaylist(me.id, name, String(body.description ?? '').trim() || null);
    logger.log('library: playlist created', { playlistId: id, user: me.username, name });
    return { playlistId: id };
  }));

  app.get(`${LIBRARY_PREFIX}/playlists/:id`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const playlist = await mustGetPlaylist(store, id);
    await assertCanView(store, playlist, me.id);

    const itemRows = await store.playlistItemRows(id);
    // One batched fetch: a 500-track playlist would otherwise be 500 sequential round-trips.
    const songs = await store.songsByIds(itemRows.map((it) => it.song_id));
    const views = await toSongViews(store, songs);
    const viewById = new Map(views.map((v) => [v.id, v]));

    return {
      playlist: {
        ...playlist,
        // The list query joins users for this; the detail row is bare, and the header needs the
        // owner's name to say who shared it with you.
        owner_username: (await store.getUser(playlist.owner_id))?.username ?? `user ${playlist.owner_id}`,
        can_edit: playlist.owner_id === me.id || (await store.listCollaborators(id)).find((c) => c.user_id === me.id)?.can_edit === true,
        items: itemRows
          .map((it) => {
            const song = viewById.get(it.song_id);
            if (!song) return null; // song deleted out from under the row
            return { id: it.id, position: it.position, added_by: it.added_by, added_by_username: it.added_by_username, added_at: it.added_at, song };
          })
          .filter(Boolean),
      },
      collaborators: await store.listCollaborators(id),
    };
  }));

  app.patch(`${LIBRARY_PREFIX}/playlists/:id`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const playlist = await mustGetPlaylist(store, id);
    await assertCanEdit(store, playlist, me.id);

    const body = (request.body ?? {}) as { name?: unknown; description?: unknown };
    const fields: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new HttpError(400, 'name cannot be empty');
      fields.name = name;
    }
    if (body.description !== undefined) fields.description = String(body.description);
    if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update (send name and/or description)');

    await store.updatePlaylist(id, fields);
    if (fields.name !== undefined) {
      await store.notifyParticipants({
        playlistId: id,
        actorId: me.id,
        ownerId: playlist.owner_id,
        type: 'playlist_renamed',
        payload: { name: fields.name },
      });
    }
    logger.log('library: playlist updated', { playlistId: id, user: me.username, fields: Object.keys(fields) });
    return { ok: true };
  }));

  app.delete(`${LIBRARY_PREFIX}/playlists/:id`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const playlist = await mustGetPlaylist(store, id);
    // Owner only: a collaborator who could delete would delete the owner's playlist.
    if (playlist.owner_id !== me.id) throw new HttpError(403, 'only the owner can delete this playlist');

    await store.deletePlaylist(id);
    // The songs themselves are untouched — deleting a playlist must never delete a song.
    logger.log('library: playlist deleted', { playlistId: id, user: me.username });
    return { ok: true, deletedPlaylist: id };
  }));

  // -------------------------------------------------------- playlist items

  app.post(`${LIBRARY_PREFIX}/playlists/:id/items`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const playlist = await mustGetPlaylist(store, id);
    await assertCanEdit(store, playlist, me.id);

    const body = (request.body ?? {}) as { songIds?: unknown };
    const songIds = Array.isArray(body.songIds) ? (body.songIds as unknown[]).map((v) => intParam(v, 'songIds[]')) : [];
    if (!songIds.length) throw new HttpError(400, 'songIds[] is required and must be non-empty');

    const exist = await store.existingSongIds(songIds);
    const missing = songIds.filter((s) => !exist.has(s));
    if (missing.length) throw new HttpError(400, `unknown song id(s): ${missing.join(', ')}`);

    const added = await store.addPlaylistItems(id, songIds, me.id);
    const notified = await store.notifyParticipants({
      playlistId: id,
      actorId: me.id,
      ownerId: playlist.owner_id,
      type: 'playlist_edited',
      payload: { action: 'add', count: added, songIds },
    });
    logger.log('library: playlist items added', { playlistId: id, user: me.username, added, notifiedUsers: notified });
    return { added, notifiedUsers: notified };
  }));

  app.delete(`${LIBRARY_PREFIX}/playlists/:id/items/:itemId`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const itemId = intParam((request.params as { itemId: string }).itemId, 'itemId');
    const playlist = await mustGetPlaylist(store, id);
    await assertCanEdit(store, playlist, me.id);

    if (!(await store.removePlaylistItem(itemId, id))) throw new HttpError(404, 'playlist item not found');
    const notified = await store.notifyParticipants({
      playlistId: id,
      actorId: me.id,
      ownerId: playlist.owner_id,
      type: 'playlist_edited',
      payload: { action: 'remove', itemId },
    });
    logger.log('library: playlist item removed', { playlistId: id, itemId, user: me.username, notifiedUsers: notified });
    return { ok: true, notifiedUsers: notified };
  }));

  // -------------------------------------------------------------- sharing

  app.post(`${LIBRARY_PREFIX}/playlists/:id/share`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const playlist = await mustGetPlaylist(store, id);
    if (playlist.owner_id !== me.id) throw new HttpError(403, 'only the owner can share this playlist');

    const body = (request.body ?? {}) as { userId?: unknown; canEdit?: unknown };
    const userId = intParam(body.userId, 'userId');
    if (userId === me.id) throw new HttpError(400, 'you already own this playlist');
    const target = await store.getUser(userId);
    if (!target) throw new HttpError(404, `no user with id ${userId}`);

    const canEdit = body.canEdit === true || body.canEdit === 'true';
    await store.sharePlaylist(id, userId, canEdit, me.id);
    // This is the notification the recipient sees on login ("X shared a playlist with you").
    await store.notify({
      userId,
      type: 'playlist_shared',
      actorId: me.id,
      playlistId: id,
      payload: { canEdit },
    });
    logger.log('library: playlist shared', { playlistId: id, owner: me.username, with: target.username, canEdit });
    return { playlistId: id, sharedWith: { id: target.id, username: target.username }, canEdit };
  }));

  app.delete(`${LIBRARY_PREFIX}/playlists/:id/share/:userId`, wrap(async (request) => {
    const me = await viewer(request);
    const id = intParam((request.params as { id: string }).id, 'id');
    const userId = intParam((request.params as { userId: string }).userId, 'userId');
    const playlist = await mustGetPlaylist(store, id);
    if (playlist.owner_id !== me.id) throw new HttpError(403, 'only the owner can unshare this playlist');

    await store.unsharePlaylist(id, userId);
    await store.notify({ userId, type: 'collab_removed', actorId: me.id, playlistId: id, payload: null });
    logger.log('library: playlist unshared', { playlistId: id, owner: me.username, userId });
    return { ok: true };
  }));

  // --------------------------------------------------------- notifications

  app.get(`${LIBRARY_PREFIX}/notifications`, wrap(async (request) => {
    const me = await viewer(request);
    const q = request.query as Record<string, string>;
    return {
      notifications: await store.listNotifications(me.id, Math.min(Math.max(num(q.limit, 50), 1), MAX_PAGE)),
      unread: await store.unreadNotificationCount(me.id),
      pendingImports: await store.pendingImportCount(me.id),
    };
  }));

  app.post(`${LIBRARY_PREFIX}/notifications/read`, wrap(async (request) => {
    const me = await viewer(request);
    const body = (request.body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids) && body.ids.length ? (body.ids as unknown[]).map((v) => intParam(v, 'ids[]')) : null;
    return { marked: await store.markNotificationsRead(me.id, ids) };
  }));

  /**
   * Session summary. The Angular header shows one badge number from this, so it does not have to
   * poll three separate collections on boot.
   */
  app.get(`${LIBRARY_PREFIX}/me`, wrap(async (request) => {
    const me = await viewer(request);
    const playlists = await store.listPlaylistsForUser(me.id);
    return {
      user: me,
      pendingImports: await store.pendingImportCount(me.id),
      unreadNotifications: await store.unreadNotificationCount(me.id),
      myPlaylists: playlists.filter((p) => p.owner_id === me.id).length,
      sharedWithMe: playlists.filter((p) => p.owner_id !== me.id).length,
      librarySongs: (await store.searchSongs({ limit: 1, offset: 0 })).total,
    };
  }));
}

export { HttpError };
