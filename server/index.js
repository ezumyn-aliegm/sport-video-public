import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import { initDb, nowIso, buildVideoRow, toTagArray } from './db.js';
import { isBcryptHash, normalizeFamilyPinHash } from './config.js';

dotenv.config();

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const DEFAULT_DIST_PATH = path.resolve(process.cwd(), 'dist');
const DEFAULT_MAX_UPLOAD_STORAGE_MB = 2048;
const INSECURE_SESSION_SECRETS = new Set([
  'dev-secret-change-me',
  'change-me-in-production',
]);

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const trimOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const positiveMegabytes = (value, fallback, name) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
};

const isIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const getHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

const youtubeIdFromUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
    if (url.hostname.endsWith('youtube.com')) return url.searchParams.get('v');
  } catch {
    return null;
  }
  return null;
};

const deleteUploadedFile = async (file) => {
  if (!file?.path) return;
  await fs.promises.rm(file.path, { force: true });
};

const uploadRoute = (handler) => asyncRoute(async (req, res, next) => {
  try {
    return await handler(req, res, next);
  } catch (error) {
    await deleteUploadedFile(req.file);
    throw error;
  }
});

const directoryBytes = async (directory) => {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const stat = await fs.promises.stat(path.join(directory, entry.name));
      return stat.size;
    }));
  return sizes.reduce((total, size) => total + size, 0);
};

const toPublicVideo = (row) => {
  const safeRow = { ...row };
  delete safeRow.local_path;
  return {
    ...safeRow,
    tags: toTagArray(safeRow.tags),
  };
};

export const createApp = (options = {}) => {
  const database = options.db;
  const configuredSessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET;
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const sessionSecret = String(configuredSessionSecret ?? '').trim() || 'dev-secret-change-me';
  if (isProduction && INSECURE_SESSION_SECRETS.has(sessionSecret.toLowerCase())) {
    throw new Error('SESSION_SECRET must be configured in production');
  }
  const familyPinHash = normalizeFamilyPinHash(options.familyPinHash ?? process.env.FAMILY_PIN_HASH);
  const maxUploadMb = positiveMegabytes(options.maxUploadMb ?? process.env.MAX_UPLOAD_MB, 500, 'MAX_UPLOAD_MB');
  const maxUploadStorageMb = positiveMegabytes(
    options.maxUploadStorageMb ?? process.env.MAX_UPLOAD_STORAGE_MB,
    DEFAULT_MAX_UPLOAD_STORAGE_MB,
    'MAX_UPLOAD_STORAGE_MB'
  );
  const maxUploadStorageBytes = maxUploadStorageMb * 1024 * 1024;
  const youtubeMode = options.youtubeMode ?? process.env.YOUTUBE_MODE ?? 'mock';
  const uploadDir = path.resolve(options.uploadDir ?? DEFAULT_UPLOAD_DIR);
  const distPath = path.resolve(options.distPath ?? DEFAULT_DIST_PATH);
  const trustProxy = options.trustProxy ?? ['1', 'true'].includes(String(process.env.TRUST_PROXY).toLowerCase());

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: maxUploadMb * 1024 * 1024 },
  });

  const getDb = () => {
    if (!database) throw new Error('Database is not initialized');
    return database;
  };

  const isKnownSport = async (sport) => {
    if (!sport) return true;
    const row = await getDb().get('SELECT 1 FROM sports WHERE label = ?', sport);
    return Boolean(row);
  };

  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'production') {
    const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    app.use(cors({ origin: configuredOrigins, credentials: true }));
  }

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    })
  );

  const pinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const requireAuth = (req, res, next) => {
    if (req.session?.authenticated) return next();
    return res.status(401).json({ error: 'PIN required' });
  };

  const regenerateSession = (req) => new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  app.post('/api/auth/unlock', pinLimiter, asyncRoute(async (req, res) => {
    const { pin } = req.body || {};
    if (pin === undefined || pin === null || String(pin).length === 0) {
      return res.status(400).json({ error: 'PIN is required' });
    }
    if (!isBcryptHash(familyPinHash)) {
      return res.status(500).json({ error: 'Server missing valid FAMILY_PIN_HASH' });
    }

    const ok = await bcrypt.compare(String(pin), familyPinHash);
    if (!ok) return res.status(401).json({ error: 'Check your PIN and try again' });

    await regenerateSession(req);
    req.session.authenticated = true;
    return res.json({ ok: true });
  }));

  app.post('/api/auth/lock', (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('connect.sid');
      return res.json({ ok: true });
    });
  });

  app.get('/api/me', (req, res) => {
    res.json({ authenticated: Boolean(req.session?.authenticated) });
  });

  app.get('/api/settings', requireAuth, (req, res) => {
    res.json({
      youtube_mode: youtubeMode,
      max_upload_mb: maxUploadMb,
      max_upload_storage_mb: maxUploadStorageMb,
    });
  });

  app.get('/api/children', requireAuth, asyncRoute(async (req, res) => {
    const children = await getDb().all(`
      SELECT c.*, COUNT(v.id) AS clip_count
      FROM children c
      LEFT JOIN videos v ON v.child_id = c.id
      WHERE c.archived = 0
      GROUP BY c.id
      ORDER BY c.created_at ASC, c.name ASC
    `);
    res.json(children);
  }));

  app.post('/api/children', requireAuth, asyncRoute(async (req, res) => {
    const name = trimOrNull(req.body?.name);
    const sport = trimOrNull(req.body?.sport);
    const team = trimOrNull(req.body?.team);
    const color = trimOrNull(req.body?.color);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!(await isKnownSport(sport))) return res.status(400).json({ error: 'Unsupported sport' });

    const id = randomUUID();
    const now = nowIso();
    await getDb().run(
      `INSERT INTO children (id, name, sport, team, color, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      name,
      sport,
      team,
      color,
      now,
      now
    );

    const child = await getDb().get('SELECT * FROM children WHERE id = ?', id);
    res.status(201).json(child);
  }));

  app.get('/api/sports', requireAuth, asyncRoute(async (req, res) => {
    const sports = await getDb().all('SELECT * FROM sports ORDER BY sort_order ASC, label ASC');
    res.json(sports);
  }));

  app.get('/api/videos', requireAuth, asyncRoute(async (req, res) => {
    const { childId, sport } = req.query;
    const includeHidden = ['true', '1'].includes(String(req.query.includeHidden || '').toLowerCase());
    let query = 'SELECT * FROM videos';
    const clauses = [];
    const params = [];

    if (childId) {
      clauses.push('child_id = ?');
      params.push(childId);
    }

    if (sport && sport !== 'All sports') {
      clauses.push('sport = ?');
      params.push(sport);
    }

    if (!includeHidden) clauses.push('hidden = 0');

    if (clauses.length) query += ` WHERE ${clauses.join(' AND ')}`;
    query += ' ORDER BY event_date DESC, created_at DESC';

    const rows = (await getDb().all(query, params)).map(toPublicVideo);

    res.json(rows);
  }));

  app.post('/api/videos', requireAuth, upload.single('file'), uploadRoute(async (req, res) => {
    const childId = trimOrNull(req.body?.child_id);
    const sport = trimOrNull(req.body?.sport);
    const eventName = trimOrNull(req.body?.event_name);
    const eventDate = trimOrNull(req.body?.event_date);
    const title = trimOrNull(req.body?.title);
    const notes = trimOrNull(req.body?.notes);
    const tags = req.body?.tags;
    const sourceType = trimOrNull(req.body?.source_type);
    const externalUrl = trimOrNull(req.body?.external_url);

    if (!childId || !eventDate || !title || !sourceType) {
      await deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isIsoDate(eventDate)) {
      await deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Event date must be YYYY-MM-DD' });
    }
    if (!['link', 'upload'].includes(sourceType)) {
      await deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Unsupported source type' });
    }

    if (sourceType === 'link' && req.file) {
      await deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Link requests cannot include a file' });
    }

    if (req.file) {
      try {
        const usedBytes = await directoryBytes(uploadDir);
        if (usedBytes > maxUploadStorageBytes) {
          await deleteUploadedFile(req.file);
          return res.status(413).json({ error: `Upload exceeds ${maxUploadStorageMb}MB storage quota` });
        }
      } catch (error) {
        await deleteUploadedFile(req.file);
        throw error;
      }
    }

    const child = await getDb().get('SELECT * FROM children WHERE id = ? AND archived = 0', childId);
    if (!child) {
      await deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Child not found' });
    }

    const chosenSport = sport || child.sport || null;
    if (!(await isKnownSport(chosenSport))) {
      await deleteUploadedFile(req.file);
      return res.status(400).json({ error: 'Unsupported sport' });
    }

    const payload = {
      child_id: childId,
      sport: chosenSport,
      event_name: eventName,
      event_date: eventDate,
      title,
      notes,
      tags,
      source_type: sourceType,
      external_url: externalUrl,
    };

    if (sourceType === 'link') {
      if (!externalUrl) {
        await deleteUploadedFile(req.file);
        return res.status(400).json({ error: 'Link URL required' });
      }
      const safeUrl = getHttpUrl(externalUrl);
      if (!safeUrl) {
        await deleteUploadedFile(req.file);
        return res.status(400).json({ error: 'Link URL must use http or https' });
      }
      Object.assign(payload, {
        external_url: safeUrl,
        youtube_url: safeUrl,
        youtube_video_id: youtubeIdFromUrl(safeUrl),
        publish_status: 'ready',
        thumbnail_url: '/assets/demo/video-thumb-demo-1.svg',
      });
    }

    if (sourceType === 'upload') {
      if (!req.file) return res.status(400).json({ error: 'Upload file required' });
      if (!String(req.file.mimetype || '').startsWith('video/')) {
        await deleteUploadedFile(req.file);
        return res.status(400).json({ error: 'Upload must be a video file' });
      }
      const mockId = `mock_${randomUUID()}`;
      Object.assign(payload, {
        external_url: null,
        youtube_url: youtubeMode === 'mock' ? `https://youtube.com/watch?v=${mockId}` : null,
        youtube_video_id: youtubeMode === 'mock' ? mockId : null,
        publish_status: youtubeMode === 'mock' ? 'mock' : 'pending',
        publish_error: youtubeMode === 'mock'
          ? 'YouTube is not connected; this upload is a local mock.'
          : 'Upload is waiting for YouTube live-mode credentials.',
        local_path: req.file.path,
        thumbnail_url: '/assets/demo/video-thumb-demo-2.svg',
      });
    }

    const row = buildVideoRow(payload);

    await getDb().run(
      `INSERT INTO videos (
        id, child_id, sport, event_name, event_date, title, notes, tags, source_type,
        external_url, youtube_url, youtube_video_id, publish_status, publish_error,
        hidden, local_path, thumbnail_url, created_at, updated_at
      ) VALUES (
        $id, $child_id, $sport, $event_name, $event_date, $title, $notes, $tags, $source_type,
        $external_url, $youtube_url, $youtube_video_id, $publish_status, $publish_error,
        $hidden, $local_path, $thumbnail_url, $created_at, $updated_at
      )`,
      {
        $id: row.id,
        $child_id: row.child_id,
        $sport: row.sport,
        $event_name: row.event_name,
        $event_date: row.event_date,
        $title: row.title,
        $notes: row.notes,
        $tags: row.tags,
        $source_type: row.source_type,
        $external_url: row.external_url,
        $youtube_url: row.youtube_url,
        $youtube_video_id: row.youtube_video_id,
        $publish_status: row.publish_status,
        $publish_error: row.publish_error,
        $hidden: row.hidden,
        $local_path: row.local_path,
        $thumbnail_url: row.thumbnail_url,
        $created_at: row.created_at,
        $updated_at: row.updated_at,
      }
    ).catch(async (error) => {
      await deleteUploadedFile(req.file);
      throw error;
    });

    const created = await getDb().get('SELECT * FROM videos WHERE id = ?', row.id);
    res.status(201).json(toPublicVideo(created));
  }));

  app.patch('/api/videos/:id', requireAuth, asyncRoute(async (req, res) => {
    const { id } = req.params;
    const existing = await getDb().get('SELECT * FROM videos WHERE id = ?', id);
    if (!existing) return res.status(404).json({ error: 'Video not found' });

    const nextTitle = req.body?.title === undefined ? existing.title : trimOrNull(req.body.title);
    const nextDate = req.body?.event_date === undefined ? existing.event_date : trimOrNull(req.body.event_date);
    const nextSport = req.body?.sport === undefined ? existing.sport : trimOrNull(req.body.sport);
    if (!nextTitle) return res.status(400).json({ error: 'Title is required' });
    if (!isIsoDate(nextDate)) return res.status(400).json({ error: 'Event date must be YYYY-MM-DD' });
    if (!(await isKnownSport(nextSport))) return res.status(400).json({ error: 'Unsupported sport' });

    const nextHidden = typeof req.body?.hidden === 'boolean'
      ? (req.body.hidden ? 1 : 0)
      : existing.hidden;
    const nextTags = req.body?.tags === undefined
      ? existing.tags
      : JSON.stringify(toTagArray(req.body.tags));
    const updated = {
      ...existing,
      title: nextTitle,
      notes: req.body?.notes === undefined ? existing.notes : trimOrNull(req.body.notes),
      event_name: req.body?.event_name === undefined ? existing.event_name : trimOrNull(req.body.event_name),
      event_date: nextDate,
      tags: nextTags,
      hidden: nextHidden,
      sport: nextSport,
      updated_at: nowIso(),
    };

    await getDb().run(
      `UPDATE videos
       SET title = ?, notes = ?, event_name = ?, event_date = ?, tags = ?, hidden = ?, sport = ?, updated_at = ?
       WHERE id = ?`,
      updated.title,
      updated.notes,
      updated.event_name,
      updated.event_date,
      updated.tags,
      updated.hidden,
      updated.sport,
      updated.updated_at,
      id
    );

    const row = await getDb().get('SELECT * FROM videos WHERE id = ?', id);
    res.json(toPublicVideo(row));
  }));

  app.use('/uploads', requireAuth, express.static(uploadDir));

  const publicPath = path.resolve(process.cwd(), 'public');
  const resolvePublicFile = (name) => {
    const fromDist = path.join(distPath, name);
    if (fs.existsSync(fromDist)) return fromDist;
    return path.join(publicPath, name);
  };

  // SEO files must never fall through to the SPA HTML shell
  app.get('/robots.txt', (req, res) => {
    const file = resolvePublicFile('robots.txt');
    if (!fs.existsSync(file)) return res.status(404).type('text/plain').send('Not found');
    return res.type('text/plain').sendFile(file);
  });

  app.get('/sitemap.xml', (req, res) => {
    const file = resolvePublicFile('sitemap.xml');
    if (!fs.existsSync(file)) return res.status(404).type('application/xml').send('Not found');
    return res.type('application/xml').sendFile(file);
  });

  app.use(express.static(distPath));
  app.use('/assets', express.static(path.join(publicPath, 'assets')));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const indexPath = path.join(distPath, 'index.html');
    if (!fs.existsSync(indexPath)) return res.status(404).json({ error: 'Not found' });
    return res.sendFile(indexPath);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Upload exceeds ${maxUploadMb}MB limit` });
      }
      return res.status(400).json({ error: 'Upload could not be processed' });
    }
    return res.status(500).json({ error: 'Unexpected server error' });
  });

  return app;
};

export const start = async ({ port = DEFAULT_PORT } = {}) => {
  const db = await initDb();
  const app = createApp({ db });
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`sport-video running on port ${port}`);
  });
  return { app, db, server };
};

if (path.resolve(process.argv[1] || '') === MODULE_PATH) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('sport-video failed to start', error.message);
    process.exitCode = 1;
  });
}
