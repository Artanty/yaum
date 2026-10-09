import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryApi } from '../../core/library-api';
import { useSession } from '../../core/session';
import { useResource } from '../../core/useResource';
import { durationText, plural, timeAgo } from '../../core/format';
import { errorText } from '../../core/http';
import type { Song } from '../../core/models';
import './imports.scss';

interface ImportDetailResponse {
  import: {
    id: number;
    source_label: string | null;
    page_url: string | null;
    track_count: number;
    new_song_count: number;
    created_at: number;
  };
  tracks: (Song & { isNew: boolean })[];
}

export default function ImportsPage() {
  const api = useLibraryApi();
  const session = useSession();
  const navigate = useNavigate();

  const [openId, setOpenId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Excludes songs already chosen — the default is "every NEW song", but it is editable.
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());

  // Both the tick and the open id are inputs: the tick makes a created playlist refresh this view.
  const detail = useResource<ImportDetailResponse>(
    openId === null ? undefined : `/api/library/imports/${openId}`,
    api.reloadTick,
    session.userId,
  );

  const imports = api.pendingImports;
  const tracks = detail.data?.tracks ?? [];
  const selectedCount = tracks.filter((t) => !excluded.has(t.id)).length;
  const suggestedName = detail.data
    ? `${detail.data.import.source_label ?? 'Scanned playlist'} (${selectedCount} tracks)`
    : '';

  const toggle = (id: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = (id: number, label: string | null, count: number) => {
    setOpenId(id);
    setExcluded(new Set());
    setName(label ? `${label} (${count} tracks)` : '');
    setMessage(null);
  };

  /**
   * The step that clears the banner. songIds is sent only when the user deselected something —
   * otherwise the backend uses its own "all new songs" default, so an untouched form cannot be
   * wrong because of a stale client-side list.
   */
  const build = async () => {
    if (openId === null || busy) return;
    const excludedNow = excluded;
    const songIds = excludedNow.size
      ? tracks.filter((t) => !excludedNow.has(t.id)).map((t) => t.id)
      : undefined;
    const chosen = songIds ?? tracks.filter((t) => t.isNew).map((t) => t.id);
    if (!chosen.length) {
      setMessage('Nothing selected — deselect nothing, or pick at least one track.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await api.createPlaylistFromImport(openId, name.trim() || suggestedName, songIds);
      api.refresh();
      navigate(`/playlists/${res.playlistId}`);
    } catch (err) {
      setBusy(false);
      setMessage(errorText(err));
    }
  };

  return (
    <div className="page-imports">
      <section className="head">
        <h1>Imports</h1>
        <p className="muted">
          Every scan the extension sends lands here first. Nothing is in a playlist until you say so
          — that is the whole point of the queue.
        </p>
      </section>

      {imports.loading ? (
        <p className="muted">loading…</p>
      ) : (imports.data?.imports ?? []).length === 0 ? (
        <p className="muted">
          Nothing pending for <strong>{session.userId}</strong>. Scan a playlist in the extension
          and press “Import to my library”, and it will show up here.
        </p>
      ) : (
        <ul className="cards">
          {(imports.data?.imports ?? []).map((imp) => (
            <li key={imp.id} className="card">
              <div className="row">
                <div>
                  <h2>{imp.source_label ?? 'Scanned playlist'}</h2>
                  <p className="meta">
                    {plural(imp.item_count, 'track')} · {imp.new_song_count} new to the library ·
                    scanned {timeAgo(imp.created_at)}
                    {imp.page_url && (
                      <>
                        {' · '}
                        <a href={imp.page_url} target="_blank" rel="noopener">
                          source
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => open(imp.id, imp.source_label, imp.item_count)}
                >
                  Build playlist
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openId !== null && (
        <>
          <div className="overlay" onClick={() => setOpenId(null)} />
          <section className="drawer" role="dialog" aria-label="Build a playlist from this import">
            <header>
              <h2>Build a playlist</h2>
              <button className="ghost" onClick={() => setOpenId(null)}>
                close
              </button>
            </header>

            {detail.loading ? (
              <p className="muted">loading tracks…</p>
            ) : detail.error ? (
              <p className="err">could not load this import: {detail.error}</p>
            ) : (
              <>
                <label className="field">
                  <span>Playlist name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={suggestedName}
                  />
                </label>

                <p className="meta">
                  {selectedCount} of {tracks.length} selected · untick anything you do not want
                </p>

                <ul className="tracks">
                  {tracks.map((t) => (
                    <li key={t.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!excluded.has(t.id)}
                          onChange={() => toggle(t.id)}
                        />
                        <span className="t">{t.title}</span>
                        <span className="a">
                          {t.artists.map((ar) => (
                            <span key={ar.id} className={ar.role !== 'main' ? 'feat' : undefined}>
                              {ar.name}
                            </span>
                          ))}
                        </span>
                        <span className="d">{durationText(t.duration_s)}</span>
                        {t.isNew && <span className="new">new</span>}
                      </label>
                    </li>
                  ))}
                </ul>

                {message && <p className="err">{message}</p>}

                <footer>
                  <button
                    className="primary"
                    disabled={busy || selectedCount === 0}
                    onClick={build}
                  >
                    {busy ? 'creating…' : 'Create playlist'}
                  </button>
                </footer>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
