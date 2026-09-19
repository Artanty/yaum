export interface TrackMeta {
  title: string;
  artists: string[];
  album: string | null;
  duration: number; // seconds
  sourceId: string | null;
}


export type MatchStatus = 'matched' | 'uncertain' | 'not_found' | 'skipped_dup' | 'error';

export interface MatchResult {
  status: MatchStatus;
  score: number;
  videoId?: string | null;
  ytTitle?: string | null;
  ytArtist?: string | null;
  ytDuration?: number | null;
  query?: string | null;
}

export interface Candidate {
  videoId: string;
  title: string;
  artists: string;
  duration: number | null;
}

export interface Collection {
  title: string;
  sourceUrl: string | null;
  tracks: TrackMeta[];
}

export function artistStr(track: TrackMeta): string {
  return track.artists.join(', ');
}

export function trackKey(track: TrackMeta): string {
  return `${track.title}|${artistStr(track)}|${track.duration}`;
}

export function matchUsable(res: MatchResult): boolean {
  return (res.status === 'matched' || res.status === 'uncertain') && !!res.videoId;
}
