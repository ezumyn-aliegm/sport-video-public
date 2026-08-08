import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'sport-video.db');

const schema = `
CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sport TEXT,
  team TEXT,
  color TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sports (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  sport TEXT,
  event_name TEXT,
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  tags TEXT,
  source_type TEXT NOT NULL,
  external_url TEXT,
  youtube_url TEXT,
  youtube_video_id TEXT,
  publish_status TEXT NOT NULL,
  publish_error TEXT,
  hidden INTEGER DEFAULT 0,
  local_path TEXT,
  thumbnail_url TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(child_id) REFERENCES children(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_child_date ON videos(child_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_videos_hidden_date ON videos(hidden, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_video_id);
`;

const seedData = async (db) => {
  const now = new Date().toISOString();
  const row = await db.get('SELECT COUNT(*) as count FROM children');
  if (row?.count > 0) return;

  const children = [
    {
      id: 'child_1',
      name: 'Emma',
      sport: 'Soccer',
      team: 'Blue Hawks',
      color: '#4A90D9',
    },
    {
      id: 'child_2',
      name: 'Noah',
      sport: 'Basketball',
      team: 'Sunset Sparks',
      color: '#E85D04',
    },
  ];

  const insertChild = await db.prepare(
    `INSERT INTO children (id, name, sport, team, color, archived, created_at, updated_at)
     VALUES ($id, $name, $sport, $team, $color, 0, $created_at, $updated_at)`
  );

  for (const child of children) {
    await insertChild.run({
      $id: child.id,
      $name: child.name,
      $sport: child.sport,
      $team: child.team,
      $color: child.color,
      $created_at: now,
      $updated_at: now,
    });
  }

  await insertChild.finalize();

  const sports = [
    { id: 'soccer', label: 'Soccer', sort_order: 1 },
    { id: 'basketball', label: 'Basketball', sort_order: 2 },
    { id: 'baseball', label: 'Baseball', sort_order: 3 },
    { id: 'swim', label: 'Swim', sort_order: 4 },
  ];

  const insertSport = await db.prepare(
    'INSERT INTO sports (id, label, sort_order) VALUES ($id, $label, $sort_order)'
  );

  for (const sport of sports) {
    await insertSport.run({
      $id: sport.id,
      $label: sport.label,
      $sort_order: sport.sort_order,
    });
  }

  await insertSport.finalize();

  const insertVideo = await db.prepare(
    `INSERT INTO videos (
      id, child_id, sport, event_name, event_date, title, notes, tags, source_type,
      external_url, youtube_url, youtube_video_id, publish_status, publish_error,
      hidden, local_path, thumbnail_url, created_at, updated_at
    ) VALUES (
      $id, $child_id, $sport, $event_name, $event_date, $title, $notes, $tags, $source_type,
      $external_url, $youtube_url, $youtube_video_id, $publish_status, $publish_error,
      $hidden, $local_path, $thumbnail_url, $created_at, $updated_at
    )`
  );

  const videos = [
    {
      id: 'vid_1',
      child_id: 'child_1',
      sport: 'Soccer',
      event_name: 'vs. Tigers',
      event_date: '2026-01-15',
      title: 'Quick corner kick goal',
      notes: 'Final minute winner from the left corner.',
      tags: JSON.stringify(['Tournament', 'Highlight']),
      source_type: 'link',
      external_url: 'https://example.invalid/demo/soccer',
      youtube_url: 'https://example.invalid/demo/soccer',
      youtube_video_id: 'demo_soccer',
      publish_status: 'ready',
      publish_error: null,
      hidden: 0,
      local_path: null,
      thumbnail_url: '/assets/demo/video-thumb-demo-1.svg',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'vid_2',
      child_id: 'child_1',
      sport: 'Soccer',
      event_name: 'Team practice',
      event_date: '2026-02-02',
      title: 'Practice: dribble drills',
      notes: 'Footwork focus. Saved for later.',
      tags: JSON.stringify(['Practice']),
      source_type: 'upload',
      external_url: null,
      youtube_url: 'https://youtube.com/watch?v=mock_demo_upload',
      youtube_video_id: 'mock_demo_upload',
      publish_status: 'mock',
      publish_error: null,
      hidden: 1,
      local_path: null,
      thumbnail_url: '/assets/demo/video-thumb-demo-2.svg',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'vid_3',
      child_id: 'child_2',
      sport: 'Basketball',
      event_name: 'vs. North Stars',
      event_date: '2026-03-03',
      title: 'Fast break finish',
      notes: 'Great assist from midfield.',
      tags: JSON.stringify(['Game', 'Fast break']),
      source_type: 'link',
      external_url: 'https://example.invalid/demo/basketball',
      youtube_url: 'https://example.invalid/demo/basketball',
      youtube_video_id: 'demo_basketball',
      publish_status: 'ready',
      publish_error: null,
      hidden: 0,
      local_path: null,
      thumbnail_url: '/assets/demo/video-thumb-demo-3.svg',
      created_at: now,
      updated_at: now,
    },
  ];

  for (const video of videos) {
    await insertVideo.run({
      $id: video.id,
      $child_id: video.child_id,
      $sport: video.sport,
      $event_name: video.event_name,
      $event_date: video.event_date,
      $title: video.title,
      $notes: video.notes,
      $tags: video.tags,
      $source_type: video.source_type,
      $external_url: video.external_url,
      $youtube_url: video.youtube_url,
      $youtube_video_id: video.youtube_video_id,
      $publish_status: video.publish_status,
      $publish_error: video.publish_error,
      $hidden: video.hidden,
      $local_path: video.local_path,
      $thumbnail_url: video.thumbnail_url,
      $created_at: video.created_at,
      $updated_at: video.updated_at,
    });
  }

  await insertVideo.finalize();

  const insertSetting = await db.prepare('INSERT INTO settings (key, value) VALUES ($key, $value)');
  await insertSetting.run({
    $key: 'family_name',
    $value: 'Our Team',
  });
  await insertSetting.finalize();
};

export const initDb = async () => {
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const dataDir = path.dirname(dbPath);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(schema);
  await seedData(db);
  return db;
};

export const nowIso = () => new Date().toISOString();

export const toTagArray = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    return JSON.parse(tags);
  } catch {
    return String(tags)
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
};

export const buildVideoRow = (input) => ({
  id: input.id || randomUUID(),
  child_id: input.child_id,
  sport: input.sport || null,
  event_name: input.event_name || null,
  event_date: input.event_date,
  title: input.title,
  notes: input.notes || null,
  tags: JSON.stringify(toTagArray(input.tags || [])),
  source_type: input.source_type,
  external_url: input.external_url || null,
  youtube_url: input.youtube_url || null,
  youtube_video_id: input.youtube_video_id || null,
  publish_status: input.publish_status || 'ready',
  publish_error: input.publish_error || null,
  hidden: input.hidden ? 1 : 0,
  local_path: input.local_path || null,
  thumbnail_url: input.thumbnail_url || null,
  created_at: input.created_at || nowIso(),
  updated_at: input.updated_at || nowIso(),
});
