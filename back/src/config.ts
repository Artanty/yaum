import 'dotenv/config';

export interface Settings {
  yandexToken: string | null;
  yandexProxy: string | null;
  ytmProxy: string | null;
  ytmTimeout: number;
  dbPath: string;
  searchConcurrency: number;
  matchAccept: number;
  matchUncertain: number;
  durationTolerance: number;
}

export const settings: Settings = {
  yandexToken: process.env.YANDEX_TOKEN || null,
  yandexProxy: process.env.YANDEX_PROXY || null,
  ytmProxy: process.env.YTM_PROXY || null,
  ytmTimeout: Number(process.env.YTM_TIMEOUT ?? 20000),
  dbPath: process.env.DB_PATH ?? 'mush.db',
  searchConcurrency: Number(process.env.SEARCH_CONCURRENCY ?? 4),
  matchAccept: Number(process.env.MATCH_ACCEPT ?? 0.75),
  matchUncertain: Number(process.env.MATCH_UNCERTAIN ?? 0.55),
  durationTolerance: Number(process.env.DURATION_TOLERANCE ?? 5),
};

export function applyYtmProxy(): void {
  if (settings.ytmProxy) {
    process.env.HTTP_PROXY = settings.ytmProxy;
    process.env.HTTPS_PROXY = settings.ytmProxy;
    process.env.http_proxy = settings.ytmProxy;
    process.env.https_proxy = settings.ytmProxy;
  }
}
