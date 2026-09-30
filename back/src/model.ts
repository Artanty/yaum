export interface TrackMeta {
  title: string;
  artists: string[];
  album: string | null;
  duration: number; // seconds
  sourceId: string | null;
}


export type MatchStatus = 'matched' | 'uncertain' | 'not_found' | 'skipped_dup';

export interface MatchResult {
  status: MatchStatus;
  score: number;
  videoId?: string | null;
  ytTitle?: string | null;
  ytArtist?: string | null;
  ytDuration?: number | null;
}

export interface Candidate {
  videoId: string;
  title: string;
  artists: string;
  duration: number | null;
}

export interface Collection {
  title: string;
  tracks: TrackMeta[];
}

export function artistStr(track: TrackMeta): string {
  return track.artists.join(', ');
}

export function matchUsable(res: MatchResult): boolean {
  return (res.status === 'matched' || res.status === 'uncertain') && !!res.videoId;
}
