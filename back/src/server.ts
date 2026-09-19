import path from 'node:path';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import view from '@fastify/view';
import ejs from 'ejs';
import { settings } from './config.js';
import { Store } from './db.js';
import { startJob } from './pipeline.js';
import { fromForm } from './url.js';

export function buildApp(store: Store) {
  const app = Fastify({ logger: false });
  app.register(formbody);
  app.register(view, {
    engine: { ejs },
    root: path.join(process.cwd(), 'views'),
  });

  app.get('/', async (_req, reply) => {
    return reply.view('index.ejs', { settings, modes: ['playlist', 'album', 'liked', 'saved-albums', 'all-playlists'] });
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
    const id = startJob(store, mode, source);
    return reply.code(303).header('location', `/job/${id}`).send();
  });

  app.get('/jobs', async (_req, reply) => {
    return reply.view('jobs.ejs', { jobs: store.listJobs() });
  });

  app.get('/job/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = store.getJob(id);
    if (!job) return reply.code(404).type('text/plain').send('job not found');
    const items = store.jobItems(id);
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

const store = new Store(settings.dbPath);
const app = buildApp(store);

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js') || process.env.MUSH_RUN === '1') {
  app.listen({ host, port }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { app, store };
