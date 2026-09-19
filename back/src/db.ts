import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at REAL,
    updated_at REAL,
    total INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    summary_json TEXT
);
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    collection_idx INTEGER,
    position INTEGER,
    src_title TEXT,
    src_artist TEXT,
    src_duration INTEGER,
    status TEXT,
    score REAL,
    yt_video_id TEXT,
    yt_title TEXT,
    yt_artist TEXT,
    yt_duration INTEGER,
    collection_title TEXT
);
CREATE TABLE IF NOT EXISTS match_cache (
    key TEXT PRIMARY KEY,
    video_id TEXT,
    yt_title TEXT,
    yt_artist TEXT,
    yt_duration INTEGER,
    score REAL,
    created_at REAL
);
`;

export interface JobRow {
  id: string;
  mode: string;
  source: string | null;
  status: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  total: number;
  processed: number;
  summary_json: string | null;
}

export interface ItemRow {
  job_id: string;
  collection_idx: number;
  position: number;
  src_title: string;
  src_artist: string;
  src_duration: number;
  status: string;
  score: number | null;
  yt_video_id: string | null;
  yt_title: string | null;
  yt_artist: string | null;
  yt_duration: number | null;
  collection_title: string | null;
}

export class Store {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  createJob(mode: string, source: string): string {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const now = Date.now() / 1000;
    this.db
      .prepare('INSERT INTO jobs (id, mode, source, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(id, mode, source, now, now);
    return id;
  }

  setJob(id: string, fields: Partial<Record<'status' | 'error' | 'total' | 'processed' | 'summary_json', string | number | null>>): void {
    const cols = [...Object.keys(fields), 'updated_at'];
    const values = [...Object.values(fields), Date.now() / 1000];
    this.db.prepare(`UPDATE jobs SET ${cols.map((c) => `${c}=?`).join(', ')} WHERE id=?`).run(...values, id);
  }

  addTotal(id: string, delta: number): void {
    this.db.prepare('UPDATE jobs SET total = total + ?, updated_at = ? WHERE id=?').run(delta, Date.now() / 1000, id);
  }

  incProcessed(id: string): void {
    this.db.prepare('UPDATE jobs SET processed = processed + 1, updated_at = ? WHERE id=?').run(Date.now() / 1000, id);
  }

  addItems(rows: ItemRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO items (job_id, collection_idx, position, src_title, src_artist, src_duration,
       status, score, yt_video_id, yt_title, yt_artist, yt_duration, collection_title)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const tx = this.db.transaction((list: ItemRow[]) => {
      for (const r of list) {
        stmt.run(
          r.job_id, r.collection_idx, r.position, r.src_title, r.src_artist, r.src_duration,
          r.status, r.score, r.yt_video_id, r.yt_title, r.yt_artist, r.yt_duration, r.collection_title,
        );
      }
    });
    tx(rows);
  }

  getJob(id: string): JobRow | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow | undefined) ?? null;
  }

  listJobs(limit = 50): JobRow[] {
    return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as JobRow[];
  }

  jobItems(id: string): ItemRow[] {
    return this.db
      .prepare('SELECT * FROM items WHERE job_id=? ORDER BY collection_idx, position')
      .all(id) as ItemRow[];
  }

  cacheGet(key: string): { key: string; video_id: string; yt_title: string; yt_artist: string; yt_duration: number | null; score: number } | null {
    const row = this.db.prepare('SELECT * FROM match_cache WHERE key=?').get(key) as
      | { key: string; video_id: string; yt_title: string; yt_artist: string; yt_duration: number | null; score: number }
      | undefined;
    return row ?? null;
  }

  cachePut(key: string, videoId: string, ytTitle: string, ytArtist: string, ytDuration: number | null, score: number): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO match_cache (key, video_id, yt_title, yt_artist, yt_duration, score, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(key, videoId, ytTitle, ytArtist, ytDuration, score, Date.now() / 1000);
  }
}
