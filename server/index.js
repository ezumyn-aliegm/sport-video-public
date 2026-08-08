import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import { initDb, nowIso, buildVideoRow, toTagArray } from './db.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const FAMILY_PIN_HASH = process.env.FAMILY_PIN_HASH || '';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const YOUTUBE_MODE = process.env.YOUTUBE_MODE || 'mock';

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: ['http://localhost:5173'], credentials: true }));
}

app.use(
  session({
    secret: SESSION_SECRET,
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

let db;

const requireAuth = (req, res, next) => {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'PIN required' });
};

app.post('/api/auth/unlock', pinLimiter, async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  if (!FAMILY_PIN_HASH) return res.status(500).json({ error: 'Server missing FAMILY_PIN_HASH' });

  const ok = await bcrypt.compare(String(pin), FAMILY_PIN_HASH);
  if (!ok) return res.status(401).json({ error: 'Check your PIN and try again' });

  req.session.authenticated = true;
  return res.json({ ok: true });
});

app.post('/api/auth/lock', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: Boolean(req.session?.authenticated) });
});

app.get('/api/settings', requireAuth, (req, res) => {
  res.json({
    youtube_mode: YOUTUBE_MODE,
    max_upload_mb: MAX_UPLOAD_MB,
  });
});

app.get('/api/children', requireAuth, async (req, res) => {
  const children = await db.all('SELECT * FROM children WHERE archived = 0');
  res.json(children);
});

app.post('/api/children', requireAuth, async (req, res) => {
  const { name, sport, team, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const id = randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO children (id, name, sport, team, color, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    , id, name, sport || null, team || null, color || null, now, now
  );

  const child = await db.get('SELECT * FROM children WHERE id = ?', id);
  res.status(201).json(child);
});

app.get('/api/sports', requireAuth, async (req, res) => {
  const sports = await db.all('SELECT * FROM sports ORDER BY sort_order ASC');
  res.json(sports);
});

app.get('/api/videos', requireAuth, async (req, res) => {
  const { childId, sport, includeHidden } = req.query;
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

  if (!includeHidden) {
    clauses.push('hidden = 0');
  }

  if (clauses.length) query += ` WHERE ${clauses.join(' AND ')}`;
  query += ' ORDER BY event_date DESC';

  const rows = (await db.all(query, params)).map((row) => ({
    ...row,
    tags: toTagArray(row.tags),
  }));

  res.json(rows);
});

app.post('/api/videos', requireAuth, upload.single('file'), async (req, res) => {
  const {
    child_id,
    sport,
    event_name,
    event_date,
    title,
    notes,
    tags,
    source_type,
    external_url,
  } = req.body;

  if (!child_id || !event_date || !title || !source_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let payload = {
    child_id,
    sport,
    event_name,
    event_date,
    title,
    notes,
    tags,
    source_type,
    external_url,
  };

  if (source_type === 'link') {
    if (!external_url) return res.status(400).json({ error: 'Link URL required' });
    payload = {
      ...payload,
      youtube_url: external_url,
      youtube_video_id: null,
      publish_status: 'ready',
      thumbnail_url: '/assets/demo/video-thumb-demo-1.svg',
    };
  }

  if (source_type === 'upload') {
    if (!req.file) return res.status(400).json({ error: 'Upload file required' });

    if (YOUTUBE_MODE !== 'mock') {
      payload = {
        ...payload,
        publish_status: 'failed',
        publish_error: 'YouTube live mode not configured. Set credentials or switch to mock.',
        local_path: req.file.path,
        thumbnail_url: '/assets/demo/video-thumb-demo-2.svg',
      };
    } else {
      const mockId = `mock_${randomUUID()}`;
      payload = {
        ...payload,
        youtube_url: `https://youtube.com/watch?v=${mockId}`,
        youtube_video_id: mockId,
        publish_status: 'mock',
        local_path: req.file.path,
        thumbnail_url: '/assets/demo/video-thumb-demo-2.svg',
      };
    }
  }

  const row = buildVideoRow(payload);

  await db.run(
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
  );

  const created = await db.get('SELECT * FROM videos WHERE id = ?', row.id);
  res.status(201).json({
    ...created,
    tags: toTagArray(created.tags),
  });
});

app.patch('/api/videos/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const {
    title,
    notes,
    event_name,
    event_date,
    tags,
    hidden,
    sport,
  } = req.body || {};

  const existing = await db.get('SELECT * FROM videos WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: 'Video not found' });

  const updated = {
    ...existing,
    title: title ?? existing.title,
    notes: notes ?? existing.notes,
    event_name: event_name ?? existing.event_name,
    event_date: event_date ?? existing.event_date,
    tags: tags ? JSON.stringify(toTagArray(tags)) : existing.tags,
    hidden: typeof hidden === 'boolean' ? (hidden ? 1 : 0) : existing.hidden,
    sport: sport ?? existing.sport,
    updated_at: nowIso(),
  };

  await db.run(
    `UPDATE videos SET title = ?, notes = ?, event_name = ?, event_date = ?, tags = ?, hidden = ?, sport = ?, updated_at = ?
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

  const row = await db.get('SELECT * FROM videos WHERE id = ?', id);
  res.json({
    ...row,
    tags: toTagArray(row.tags),
  });
});

const distPath = path.resolve(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const start = async () => {
  db = await initDb();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`sport-video running on port ${PORT}`);
  });
};

start();
