/**
 * Wire types for the /api/library endpoints. These mirror back/src/library/types.ts — the backend
 * is the source of truth and nothing here is validated at runtime, because the backend is ours and
 * an admin tool behind a proxy. If the shapes ever come from an untrusted source, validate then.
 */

export interface User {
  id: number;
  username: string;
  display_name: string;
}

export interface SongArtist {
  id: number;
  name: string;
  role: string;
}

export interface SongGenre {
  id: number;
  name: string;
  weight: number;
}

export interface Song {
  id: number;
  title: string;
  duration_s: number;
  album_id: number | null;
  album_title: string | null;
  yt_video_id: string | null;
  match_score: number | null;
  first_seen_at: number;
  last_seen_at: number;
  seen_count: number;
  play_count: number;
  artists: SongArtist[];
  genres: SongGenre[];
}

export type ImportRow = {
  id: number;
  source: string;
  source_label: string | null;
  page_url: string | null;
  track_count: number;
  new_song_count: number;
  raw_count: number;
  skipped_count: number;
  is_processed: number;
  playlist_id: number | null;
  created_at: number;
  processed_at: number | null;
  item_count: number;
};

export type ImportDetail = ImportRow & { tracks: (Song & { isNew: boolean })[] };

export interface PlaylistItem {
  id: number;
  position: number;
  added_by: number;
  added_by_username: string;
  added_at: number;
  song: Song;
}

export interface Playlist {
  id: number;
  owner_id: number;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
  owner_username: string;
  item_count: number;
  can_edit: boolean;
  shared_with_me: boolean;
}

export interface PlaylistDetail extends Omit<Playlist, 'item_count' | 'shared_with_me'> {
  items: PlaylistItem[];
  collaborators: Collaborator[];
}

export interface Collaborator {
  user_id: number;
  username: string;
  display_name: string;
  can_edit: boolean;
  shared_at: number;
}

export type NotificationType = 'import_ready' | 'playlist_shared' | 'playlist_edited' | 'collab_removed' | 'playlist_renamed';

export interface AppNotification {
  id: number;
  type: NotificationType;
  actor_id: number | null;
  actor_username: string | null;
  playlist_id: number | null;
  playlist_name: string | null;
  import_id: number | null;
  created_at: number;
  is_read: boolean;
  payload: unknown;
}

export interface Genre {
  id: number;
  name: string;
  song_count: number;
}

export interface Artist {
  id: number;
  name: string;
}

export interface Album {
  id: number;
  title: string;
  artist_id: number | null;
  year: number | null;
  song_count: number;
}

export interface Me {
  user: User;
  pendingImports: number;
  unreadNotifications: number;
  myPlaylists: number;
  sharedWithMe: number;
  librarySongs: number;
}

export interface SongsPage {
  total: number;
  limit: number;
  offset: number;
  songs: Song[];
}
