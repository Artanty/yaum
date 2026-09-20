import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import view from '@fastify/view';
import ejs from 'ejs';
import { settings } from './config.js';
import { openStore, type Store } from './db.js';
import { startJob } from './pipeline.js';
import { fromForm } from './url.js';
import { logger } from './lib/logger.js';



const viewsRoot = fileURLToPath(new URL('../views/', import.meta.url));

const apiPrefix = process.env.API_PREFIX ?? '/api';

export function buildApp(store: Store) {
  const app = Fastify({ logger: false });
  const healthEnvs = {
    YANDEX_TOKEN: Boolean(settings.yandexToken),
    YTM_PROXY: Boolean(settings.ytmProxy),
    LOG_DISABLED: Boolean(process.env.LOG_DISABLED),
  };
  const requestLogSkipPrefixes = [`${apiPrefix}/get-updates`];

  app.addHook('preHandler', async (request) => {
    try {
      if (requestLogSkipPrefixes.some((prefix) => request.url.startsWith(prefix))) return;
      logger.log(`HTTP ${request.method} ${request.url}`, {
        method: request.method,
        url: request.url,
        ip: request.ip,
        params: request.params,
        query: request.query,
      });
    } catch (err) {
      logger.error('request-logging hook failed', err instanceof Error ? err : new Error(String(err)), 'preHandler');
    }
  });

  app.addHook('onError', async (request, _reply, error) => {
    logger.error(`HTTP ${request.method} ${request.url} failed`, error, 'onError');
  });

  app.setNotFoundHandler((request, reply) => {
    logger.warn(`HTTP ${request.method} ${request.url} -> 404`, undefined, 'notFound');
    return reply.code(404).type('text/plain').send('not found');
  });
  app.register(formbody);
  app.register(view, {
    engine: { ejs },
    root: viewsRoot,
  });

  app.get('/', async (_req, reply) => {
    return reply.view('index.ejs', { settings, modes: ['playlist', 'album', 'liked', 'saved-albums', 'all-playlists'] });
  });

  app.get(`${apiPrefix}/get-updates`, async (_req, reply) => {
    const [appEntries, errorEntries, startupEntries] = await Promise.all([
      logger.getLogs({ type: 'app' }).catch(() => []),
      logger.getLogs({ type: 'error' }).catch(() => []),
      logger.readLogFile('app.start.json').catch(() => []),
    ]);
    return reply.send({
      version: process.env.TAG_VERSION ?? null,
      commit_message: process.env.COMMIT_MESSAGE ?? null,
      project_id: process.env.PROJECT_ID ?? null,
      namespace: process.env.NAMESPACE ?? null,
      slave_repo: process.env.SLAVE_REPO ?? null,
      envs: healthEnvs,
      logs: {
        app: appEntries.slice(-50),
        error: errorEntries.slice(-50),
        start: startupEntries.slice(-50),
      },
      urls: {
        home: `${apiPrefix}/`,
        migrate: `${apiPrefix}/migrate`,
        getUpdates: `${apiPrefix}/get-updates`,
        jobs: `${apiPrefix}/jobs`,
      },
    });
  });

  app.post('/migrate', async (req, reply) => {
    const body = req.body as Record<string, string> | undefined;
    const mode = body?.mode ?? '';
    const source = (body?.source ?? '').trim();
    try {
      fromForm(mode, source);
    } catch (err) {
      return reply.code(400).type('text/plain').send(err instanceof Error ? err.message : String(err));
    }
    const id = await startJob(store, mode, source);
    return reply.code(303).header('location', `/job/${id}`).send();
  });

  app.get('/jobs', async (_req, reply) => {
    return reply.view('jobs.ejs', { jobs: await store.listJobs() });
  });

  app.get('/job/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await store.getJob(id);
    if (!job) return reply.code(404).type('text/plain').send('job not found');
    const items = await store.jobItems(id);
    const query = req.query as Record<string, string>;

    if (query.format === 'json') {
      let summary: unknown = null;
      if (job.summary_json) {
        try {
          summary = JSON.parse(job.summary_json);
        } catch {
          summary = [];
        }
      }
      return reply.send({ job, items, summary });
    }

    if (query.format === 'links') {
      const links = items
        .filter((i) => i.yt_video_id && (i.status === 'matched' || i.status === 'uncertain'))
        .map((i) => `https://music.youtube.com/watch?v=${i.yt_video_id}`);
      return reply.type('text/plain').send(links.join('\n'));
    }

    let summary: Record<string, unknown>[] | null = null;
    if (job.summary_json) {
      try {
        summary = JSON.parse(job.summary_json);
      } catch {
        summary = [];
      }
    }
    return reply.view('job.ejs', { job, items, summary });
  });

  app.get('/healthz', async () => ({
    ok: true,
    yandex_configured: Boolean(settings.yandexToken),
    ytm_reachable_note: 'search is anonymous; set YTM_PROXY if YouTube is blocked here',
  }));

  return app;
}

const store = await openStore();
const app = buildApp(store);

const host = settings.host;
const port = Number(process.env.PORT ?? 8000);

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js') || process.env.MUSH_RUN === '1') {
  app.listen({ host, port }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { app, store };
