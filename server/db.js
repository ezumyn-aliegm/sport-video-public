import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'sport-video.db');
const FAMILY_ID = 'family_default';
const MIGRATION_VERSION = '2026-08-08-event-moment-v1';

const legacySports = [
  { id: 'soccer', label: 'Soccer', sort_order: 1 },
  { id: 'basketball', label: 'Basketball', sort_order: 2 },
  { id: 'baseball', label: 'Baseball', sort_order: 3 },
  { id: 'swim', label: 'Swim', sort_order: 4 },
  { id: 'taekwondo', label: 'Taekwondo', sort_order: 5 },
];

// Fictional demo records for an empty database; never copied from a family archive.
const legacyChildren = [
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

const legacyVideos = [
  {
    id: 'vid_1',
    child_id: 'child_1',
    sport: 'Soccer',
    event_name: 'vs. Tigers',
    event_date: '2026-01-15',
    title: 'Quick corner kick goal',
    notes: 'Final minute winner from the left corner.',
    tags: ['Tournament', 'Highlight'],
    source_type: 'link',
    external_url: 'https://example.invalid/demo/soccer',
    youtube_url: null,
    youtube_video_id: null,
    publish_status: 'ready',
    publish_error: null,
    hidden: 0,
    local_path: null,
    thumbnail_url: '/assets/demo/video-thumb-demo-1.svg',
  },
  {
    id: 'vid_2',
    child_id: 'child_1',
    sport: 'Soccer',
    event_name: 'Team practice',
    event_date: '2026-02-02',
    title: 'Practice: dribble drills',
    notes: 'Footwork focus. Saved for later.',
    tags: ['Practice'],
    source_type: 'upload',
    external_url: null,
    youtube_url: 'https://youtube.com/watch?v=mock_demo_upload',
    youtube_video_id: 'mock_demo_upload',
    publish_status: 'mock',
    publish_error: 'YouTube is not connected; this upload is a local mock.',
    hidden: 1,
    local_path: null,
    thumbnail_url: '/assets/demo/video-thumb-demo-2.svg',
  },
  {
    id: 'vid_3',
    child_id: 'child_2',
    sport: 'Basketball',
    event_name: 'vs. North Stars',
    event_date: '2026-03-03',
    title: 'Fast break finish',
    notes: 'Great assist from midfield.',
    tags: ['Game', 'Fast break'],
    source_type: 'link',
    external_url: 'https://example.invalid/demo/basketball',
    youtube_url: null,
    youtube_video_id: null,
    publish_status: 'ready',
    publish_error: null,
    hidden: 0,
    local_path: null,
    thumbnail_url: '/assets/demo/video-thumb-demo-3.svg',
  },
];

const baseSchema = (athleteTable) => `
CREATE TABLE IF NOT EXISTS ${athleteTable} (
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
  FOREIGN KEY(child_id) REFERENCES ${athleteTable}(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_child_date ON videos(child_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_videos_hidden_date ON videos(hidden, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_video_id);
`;

const tableObject = async (db, name) => db.get(
  "SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
  name
);

const tableExists = async (db, name) => Boolean(await tableObject(db, name));

const tableColumns = async (db, name) => {
  const object = await tableObject(db, name);
  if (!object || object.type !== 'table') return [];
  return (await db.all(`PRAGMA table_info(${name})`)).map(({ name: column }) => column);
};

const addColumnIfMissing = async (db, table, column, definition) => {
  const columns = await tableColumns(db, table);
  if (!columns.includes(column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

const insertMany = async (db, sql, rows) => {
  const statement = await db.prepare(sql);
  try {
    for (const row of rows) await statement.run(row);
  } finally {
    await statement.finalize();
  }
};

const seedLegacyData = async (db) => {
  const athleteTable = (await tableExists(db, 'athletes')) ? 'athletes' : 'children';
  const count = await db.get(`SELECT COUNT(*) AS count FROM ${athleteTable}`);
  if (Number(count?.count || 0) > 0) return false;

  const now = nowIso();
  await insertMany(
    db,
    `INSERT INTO ${athleteTable} (id, name, sport, team, color, archived, created_at, updated_at)
     VALUES ($id, $name, $sport, $team, $color, 0, $created_at, $updated_at)`,
    legacyChildren.map((child) => ({
      $id: child.id,
      $name: child.name,
      $sport: child.sport,
      $team: child.team,
      $color: child.color,
      $created_at: now,
      $updated_at: now,
    }))
  );

  await insertMany(
    db,
    `INSERT OR IGNORE INTO sports (id, label, sort_order) VALUES ($id, $label, $sort_order)`,
    legacySports.map(({ id, label, sort_order }) => ({ $id: id, $label: label, $sort_order: sort_order }))
  );

  await insertMany(
    db,
    `INSERT INTO videos (
      id, child_id, sport, event_name, event_date, title, notes, tags, source_type,
      external_url, youtube_url, youtube_video_id, publish_status, publish_error,
      hidden, local_path, thumbnail_url, created_at, updated_at
    ) VALUES (
      $id, $child_id, $sport, $event_name, $event_date, $title, $notes, $tags, $source_type,
      $external_url, $youtube_url, $youtube_video_id, $publish_status, $publish_error,
      $hidden, $local_path, $thumbnail_url, $created_at, $updated_at
    )`,
    legacyVideos.map((video) => ({
      $id: video.id,
      $child_id: video.child_id,
      $sport: video.sport,
      $event_name: video.event_name,
      $event_date: video.event_date,
      $title: video.title,
      $notes: video.notes,
      $tags: JSON.stringify(video.tags),
      $source_type: video.source_type,
      $external_url: video.external_url,
      $youtube_url: video.youtube_url,
      $youtube_video_id: video.youtube_video_id,
      $publish_status: video.publish_status,
      $publish_error: video.publish_error,
      $hidden: video.hidden,
      $local_path: video.local_path,
      $thumbnail_url: video.thumbnail_url,
      $created_at: now,
      $updated_at: now,
    }))
  );

  await db.run(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    'family_name',
    'Our Team'
  );
  return true;
};

const canonicalSchema = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  backfill_counts_json TEXT
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS athlete_sports (
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  sport_id TEXT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  team_name TEXT,
  club_name TEXT,
  belt_rank TEXT,
  age_group TEXT,
  weight_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (athlete_id, sport_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  sport_id TEXT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tournament', 'game', 'practice', 'test', 'belt_test', 'camp', 'seminar', 'other')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  venue_name TEXT,
  location_city TEXT,
  location_region TEXT,
  location_country TEXT,
  result TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('win', 'loss', 'draw', 'dq', 'unknown')),
  placement TEXT,
  medal TEXT NOT NULL DEFAULT 'none' CHECK (medal IN ('gold', 'silver', 'bronze', 'none', 'unknown')),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS event_athletes (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('win', 'loss', 'draw', 'dq', 'unknown')),
  placement TEXT,
  medal TEXT NOT NULL DEFAULT 'none' CHECK (medal IN ('gold', 'silver', 'bronze', 'none', 'unknown')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fight', 'game', 'performance', 'drill', 'test', 'highlight', 'other')),
  title TEXT NOT NULL,
  occurred_date TEXT NOT NULL,
  occurred_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  sort_order INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('win', 'loss', 'draw', 'dq', 'unknown')),
  score_for INTEGER,
  score_against INTEGER,
  score_text TEXT,
  opponent_name TEXT,
  opponent_team_name TEXT,
  round_label TEXT,
  period_label TEXT,
  bout_number INTEGER,
  sport_pack TEXT,
  sport_data_json TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((score_for IS NULL AND score_against IS NULL) OR (score_for >= 0 AND score_against >= 0)),
  CHECK (score_text IS NULL OR (score_for IS NULL AND score_against IS NULL))
);

CREATE TABLE IF NOT EXISTS moment_athletes (
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('primary', 'participant')),
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (moment_id, athlete_id)
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  moment_id TEXT REFERENCES moments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('link', 'upload')),
  external_url TEXT,
  youtube_url TEXT,
  youtube_video_id TEXT,
  publish_status TEXT NOT NULL CHECK (publish_status IN ('ready', 'mock', 'pending', 'failed')),
  publish_error TEXT,
  local_path TEXT,
  thumbnail_url TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  moment_id TEXT REFERENCES moments(id) ON DELETE CASCADE,
  clip_id TEXT REFERENCES clips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('summary', 'coach', 'parent', 'other')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((event_id IS NOT NULL) + (moment_id IS NOT NULL) + (clip_id IS NOT NULL) = 1)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (family_id, slug)
);

CREATE TABLE IF NOT EXISTS event_tags (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
);

CREATE TABLE IF NOT EXISTS moment_tags (
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (moment_id, tag_id)
);

CREATE TABLE IF NOT EXISTS clip_tags (
  clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (clip_id, tag_id)
);

CREATE TABLE IF NOT EXISTS legacy_video_map (
  legacy_video_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL UNIQUE REFERENCES clips(id) ON DELETE CASCADE,
  migrated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_athletes_family_active ON athletes(family_id, archived, name);
CREATE INDEX IF NOT EXISTS idx_athlete_sports_sport ON athlete_sports(sport_id, athlete_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_athlete_one_primary_sport ON athlete_sports(athlete_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_events_family_date ON events(family_id, end_date DESC, start_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_family_type_date ON events(family_id, type, start_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_family_sport_date ON events(family_id, sport_id, start_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_visible_date ON events(family_id, hidden, end_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_event_athletes_athlete_event ON event_athletes(athlete_id, event_id);
CREATE INDEX IF NOT EXISTS idx_moments_event_order ON moments(event_id, hidden, sort_order, occurred_date, id);
CREATE INDEX IF NOT EXISTS idx_moments_family_date_result ON moments(family_id, occurred_date DESC, result, id DESC);
CREATE INDEX IF NOT EXISTS idx_moment_athletes_athlete ON moment_athletes(athlete_id, moment_id);
CREATE INDEX IF NOT EXISTS idx_clips_event_created ON clips(event_id, hidden, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_clips_moment_created ON clips(moment_id, hidden, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_clips_youtube_id ON clips(youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_notes_event ON notes(event_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_moment ON notes(moment_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_clip ON notes(clip_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_tags_tag ON event_tags(tag_id, event_id);
CREATE INDEX IF NOT EXISTS idx_moment_tags_tag ON moment_tags(tag_id, moment_id);
CREATE INDEX IF NOT EXISTS idx_clip_tags_tag ON clip_tags(tag_id, clip_id);

CREATE TRIGGER IF NOT EXISTS clips_moment_owner_insert
BEFORE INSERT ON clips
WHEN NEW.moment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM moments m
  WHERE m.id = NEW.moment_id AND m.event_id = NEW.event_id AND m.family_id = NEW.family_id
)
BEGIN
  SELECT RAISE(ABORT, 'clip moment must belong to event');
END;

CREATE TRIGGER IF NOT EXISTS clips_moment_owner_update
BEFORE UPDATE OF event_id, moment_id, family_id ON clips
WHEN NEW.moment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM moments m
  WHERE m.id = NEW.moment_id AND m.event_id = NEW.event_id AND m.family_id = NEW.family_id
)
BEGIN
  SELECT RAISE(ABORT, 'clip moment must belong to event');
END;
`;

const deterministicId = (prefix, value) => `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const normalizeTagValues = (tags) => {
  const values = Array.isArray(tags)
    ? tags
    : String(tags || '').split(',');
  const unique = new Map();
  values
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((label) => {
      const slug = slugify(label);
      if (slug && !unique.has(slug)) unique.set(slug, label.slice(0, 40));
    });
  return [...unique.entries()].map(([slug, label]) => ({ slug, label }));
};

const ensureTag = async (db, label) => {
  const { slug } = typeof label === 'object' ? label : { slug: slugify(label) };
  const display = typeof label === 'object' ? label.label : String(label);
  if (!slug) return null;
  const now = nowIso();
  await db.run(
    `INSERT OR IGNORE INTO tags (id, family_id, slug, label, created_at)
     VALUES ($id, $family_id, $slug, $label, $created_at)`,
    {
      $id: deterministicId('tag', `${FAMILY_ID}:${slug}`),
      $family_id: FAMILY_ID,
      $slug: slug,
      $label: display.slice(0, 40),
      $created_at: now,
    }
  );
  return db.get('SELECT id, slug, label FROM tags WHERE family_id = ? AND slug = ?', FAMILY_ID, slug);
};

const addTags = async (db, table, targetColumn, targetId, tags) => {
  const normalized = normalizeTagValues(tags);
  for (const tag of normalized) {
    const saved = await ensureTag(db, tag);
    await db.run(
      `INSERT OR IGNORE INTO ${table} (${targetColumn}, tag_id) VALUES (?, ?)`,
      targetId,
      saved.id
    );
  }
};

const addNote = async (db, targetColumn, targetId, note, id = randomUUID()) => {
  if (!note?.body || !['summary', 'coach', 'parent', 'other'].includes(note.kind || 'summary')) return null;
  const now = nowIso();
  await db.run(
    `INSERT OR IGNORE INTO notes (id, family_id, ${targetColumn}, kind, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    FAMILY_ID,
    targetId,
    note.kind || 'summary',
    String(note.body).trim().slice(0, 5000),
    now,
    now
  );
  return db.get('SELECT id, kind, body, created_at, updated_at FROM notes WHERE id = ?', id);
};

const inferEventType = (video) => {
  const text = `${video.event_name || ''} ${(video.tags || []).join(' ')}`.toLowerCase();
  if (/tournament|championship|cup/.test(text)) return 'tournament';
  if (/practice|training|drill/.test(text)) return 'practice';
  if (/test|grading|belt/.test(text)) return 'test';
  if (/vs|versus|match|game/.test(text)) return 'game';
  return 'other';
};

const inferMomentKind = (video) => {
  const eventType = inferEventType(video);
  if (eventType === 'practice') return 'drill';
  if (eventType === 'test') return 'test';
  if (eventType === 'game') return 'game';
  return 'highlight';
};

const migrateLegacyVideos = async (db) => {
  const rows = await db.all('SELECT * FROM videos ORDER BY event_date ASC, created_at ASC, id ASC');
  let migrated = 0;
  for (const video of rows) {
    const existing = await db.get('SELECT * FROM legacy_video_map WHERE legacy_video_id = ?', video.id);
    if (existing) continue;

    const sport = await db.get(
      `SELECT id, label FROM sports WHERE lower(label) = lower(?) OR id = lower(?) LIMIT 1`,
      video.sport || '',
      String(video.sport || '').toLowerCase()
    );
    const sportId = sport?.id || 'legacy-unknown';
    if (!sport) {
      await db.run(
        `INSERT OR IGNORE INTO sports (id, label, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, 99, 1, ?, ?)`,
        sportId,
        video.sport || 'Other',
        nowIso(),
        nowIso()
      );
    }

    const eventName = video.event_name?.trim() || `Unsorted ${video.sport || 'Sport'} · ${video.event_date}`;
    const eventKey = `${FAMILY_ID}|${video.child_id}|${sportId}|${video.event_name?.trim() ? eventName.toLowerCase() : video.id}|${video.event_date}`;
    const eventId = deterministicId('evt_legacy', eventKey);
    const momentId = deterministicId('mom_legacy', video.id);
    const clipId = deterministicId('clip_legacy', video.id);
    const now = video.created_at || nowIso();

    await db.run(
      `INSERT OR IGNORE INTO events (
        id, family_id, sport_id, name, type, start_date, end_date, timezone, result, medal,
        hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UTC', 'unknown', 'none', ?, ?, ?)`,
      eventId,
      FAMILY_ID,
      sportId,
      eventName,
      inferEventType({ ...video, tags: toTagArray(video.tags) }),
      video.event_date,
      video.event_date,
      0,
      now,
      video.updated_at || now
    );
    await db.run(
      `INSERT OR IGNORE INTO event_athletes
       (event_id, athlete_id, display_order, result, medal, created_at, updated_at)
       VALUES (?, ?, 0, 'unknown', 'none', ?, ?)`,
      eventId,
      video.child_id,
      now,
      video.updated_at || now
    );
    await db.run(
      `INSERT OR IGNORE INTO moments (
        id, family_id, event_id, kind, title, occurred_date, timezone, sort_order, result,
        hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'UTC', 0, 'unknown', ?, ?, ?)`,
      momentId,
      FAMILY_ID,
      eventId,
      inferMomentKind({ ...video, tags: toTagArray(video.tags) }),
      video.title,
      video.event_date,
      video.hidden ? 1 : 0,
      now,
      video.updated_at || now
    );
    await db.run(
      `INSERT OR IGNORE INTO moment_athletes (moment_id, athlete_id, role, display_order)
       VALUES (?, ?, 'primary', 0)`,
      momentId,
      video.child_id
    );
    await db.run(
      `INSERT OR IGNORE INTO clips (
        id, family_id, event_id, moment_id, title, source_type, external_url, youtube_url,
        youtube_video_id, publish_status, publish_error, local_path, thumbnail_url, hidden,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clipId,
      FAMILY_ID,
      eventId,
      momentId,
      video.title,
      ['link', 'upload'].includes(video.source_type) ? video.source_type : 'link',
      video.external_url,
      video.youtube_url,
      video.youtube_video_id,
      ['ready', 'mock', 'pending', 'failed'].includes(video.publish_status) ? video.publish_status : 'failed',
      video.publish_error,
      video.local_path,
      video.thumbnail_url,
      video.hidden ? 1 : 0,
      now,
      video.updated_at || now
    );
    if (video.notes) await addNote(db, 'moment_id', momentId, { kind: 'summary', body: video.notes }, deterministicId('note_legacy', video.id));
    await addTags(db, 'moment_tags', 'moment_id', momentId, toTagArray(video.tags));
    await addTags(db, 'clip_tags', 'clip_id', clipId, toTagArray(video.tags));
    await db.run(
      `INSERT INTO legacy_video_map (legacy_video_id, event_id, moment_id, clip_id, migrated_at)
       VALUES (?, ?, ?, ?, ?)`,
      video.id,
      eventId,
      momentId,
      clipId,
      nowIso()
    );
    migrated += 1;
  }
  return { migrated, source_count: rows.length };
};

const seedDemoFixture = async (db) => {
  const now = nowIso();
  await db.run(
    `INSERT OR IGNORE INTO athletes
      (id, family_id, name, sport, team, color, archived, created_at, updated_at)
     VALUES ('ath_demo_tkd', ?, 'Maya', 'Taekwondo', 'Northside Taekwondo', '#2D5016', 0, ?, ?)`,
    FAMILY_ID,
    now,
    now
  );
  await db.run(
    `INSERT OR IGNORE INTO athlete_sports
      (athlete_id, sport_id, is_primary, club_name, belt_rank, age_group, weight_class, created_at, updated_at)
     VALUES ('ath_demo_tkd', 'taekwondo', 1, 'Northside Taekwondo', 'Red/Black', '12-14', '-49 kg', ?, ?)`,
    now,
    now
  );
  await db.run(
    `INSERT OR IGNORE INTO events (
      id, family_id, sport_id, name, type, start_date, end_date, timezone, venue_name,
      location_city, location_region, location_country, result, placement, medal, hidden,
      created_at, updated_at
    ) VALUES (
      'evt_demo_tkd_open_2026', ?, 'taekwondo', 'Mountain West Open', 'tournament',
      '2026-05-16', '2026-05-17', 'America/New_York', 'Civic Arena', 'Albany', 'NY', 'US',
      'unknown', '2nd', 'silver', 0, ?, ?
    )`,
    FAMILY_ID,
    now,
    now
  );
  await db.run(
    `INSERT OR IGNORE INTO event_athletes
      (event_id, athlete_id, display_order, result, placement, medal, created_at, updated_at)
     VALUES ('evt_demo_tkd_open_2026', 'ath_demo_tkd', 0, 'unknown', '2nd', 'silver', ?, ?)`,
    now,
    now
  );
  await addNote(db, 'event_id', 'evt_demo_tkd_open_2026', {
    kind: 'parent',
    body: 'Maya stayed calm through three fights and brought home a silver medal.',
  }, 'note_demo_tkd_event');
  await addTags(db, 'event_tags', 'event_id', 'evt_demo_tkd_open_2026', ['Taekwondo', 'Silver', 'Tournament']);

  const moments = [
    {
      id: 'mom_demo_tkd_prelim_2026',
      title: 'Preliminary - Fight 1',
      sort_order: 1,
      date: '2026-05-16',
      result: 'win',
      scoreFor: null,
      scoreAgainst: null,
      opponent: 'Demo Opponent A',
      round: 'prelim',
      bout: 12,
      tags: ['Prelim', 'Fight 1'],
      pack: { pack: 'tkd.v1', division: 'Cadet', weight_class: '-49 kg', age_group: '12-14', belt_division: 'Red/Black', opponent_club: 'Westside TKD', format: 'sparring', format_notes: 'Best of three rounds' },
    },
    {
      id: 'mom_demo_tkd_qf_2026',
      title: 'Quarterfinal - Fight 2',
      sort_order: 2,
      date: '2026-05-16',
      result: 'win',
      scoreFor: 12,
      scoreAgainst: 8,
      opponent: 'Demo Opponent B',
      round: 'quarterfinal',
      bout: 23,
      tags: ['Quarterfinal', 'Comeback'],
      pack: { pack: 'tkd.v1', division: 'Cadet', weight_class: '-49 kg', age_group: '12-14', belt_division: 'Red/Black', opponent_club: 'Northside Taekwondo', format: 'sparring', format_notes: 'Best of three rounds' },
    },
    {
      id: 'mom_demo_tkd_final_2026',
      title: 'Final - Fight 3',
      sort_order: 3,
      date: '2026-05-17',
      result: 'loss',
      scoreFor: 8,
      scoreAgainst: 10,
      opponent: 'Demo Opponent C',
      round: 'final',
      bout: 31,
      tags: ['Final', 'Silver'],
      pack: { pack: 'tkd.v1', division: 'Cadet', weight_class: '-49 kg', age_group: '12-14', belt_division: 'Red/Black', opponent_club: 'River City TKD', format: 'sparring', format_notes: 'Best of three rounds' },
    },
  ];
  for (const moment of moments) {
    await db.run(
      `INSERT OR IGNORE INTO moments (
        id, family_id, event_id, kind, title, occurred_date, timezone, sort_order, result,
        score_for, score_against, opponent_name, round_label, bout_number, sport_pack,
        sport_data_json, hidden, created_at, updated_at
      ) VALUES (?, ?, 'evt_demo_tkd_open_2026', 'fight', ?, ?, 'America/New_York', ?, ?, ?, ?, ?, ?, ?, 'tkd.v1', ?, 0, ?, ?)`,
      moment.id,
      FAMILY_ID,
      moment.title,
      moment.date,
      moment.sort_order,
      moment.result,
      moment.scoreFor,
      moment.scoreAgainst,
      moment.opponent,
      moment.round,
      moment.bout,
      JSON.stringify(moment.pack),
      now,
      now
    );
    await db.run(
      `INSERT OR IGNORE INTO moment_athletes (moment_id, athlete_id, role, display_order)
       VALUES (?, 'ath_demo_tkd', 'primary', 0)`,
      moment.id
    );
    await addTags(db, 'moment_tags', 'moment_id', moment.id, moment.tags);
  }

  await db.run(
    `INSERT OR IGNORE INTO clips (
      id, family_id, event_id, moment_id, title, source_type, external_url, youtube_url,
      youtube_video_id, publish_status, publish_error, thumbnail_url, hidden, created_at, updated_at
    ) VALUES (
      'clip_demo_tkd_event', ?, 'evt_demo_tkd_open_2026', NULL, 'Mountain West Open day montage',
      'link', 'https://example.invalid/demo/mountain-west-open', 'https://example.invalid/demo/mountain-west-open',
      NULL, 'ready', NULL, '/assets/generated/event-cover-spring-invitational.png', 0, ?, ?
    )`,
    FAMILY_ID,
    now,
    now
  );
  await addTags(db, 'clip_tags', 'clip_id', 'clip_demo_tkd_event', ['Montage']);
  for (const [index, momentId] of ['mom_demo_tkd_qf_2026', 'mom_demo_tkd_final_2026'].entries()) {
    const clipId = index === 0 ? 'clip_demo_tkd_qf' : 'clip_demo_tkd_final';
    await db.run(
      `INSERT OR IGNORE INTO clips (
        id, family_id, event_id, moment_id, title, source_type, external_url, youtube_url,
        youtube_video_id, publish_status, publish_error, thumbnail_url, hidden, created_at, updated_at
      ) VALUES (?, ?, 'evt_demo_tkd_open_2026', ?, ?, 'link', ?, ?, NULL, 'ready', NULL, ?, 0, ?, ?)`,
      clipId,
      FAMILY_ID,
      momentId,
      `${momentId === 'mom_demo_tkd_qf_2026' ? 'Quarterfinal' : 'Final'} replay`,
      `https://example.invalid/demo/${momentId}`,
      `https://example.invalid/demo/${momentId}`,
      '/assets/generated/thumb-tkd-tournament.png',
      now,
      now
    );
    await addTags(db, 'clip_tags', 'clip_id', clipId, ['Replay']);
  }
};

const migrateDomain = async (db, { seedDemo = false } = {}) => {
  await db.exec('BEGIN IMMEDIATE');
  try {
    let children = await tableObject(db, 'children');
    const athletes = await tableObject(db, 'athletes');
    if (!athletes && children?.type === 'table') {
      await db.exec('ALTER TABLE children RENAME TO athletes');
      children = null;
    }
    if (!(await tableExists(db, 'athletes'))) {
      throw new Error('athletes table is required for domain migration');
    }
    await addColumnIfMissing(db, 'athletes', 'family_id', 'TEXT');
    await addColumnIfMissing(db, 'athletes', 'photo_url', 'TEXT');
    await addColumnIfMissing(db, 'athletes', 'created_at', 'TEXT');
    await addColumnIfMissing(db, 'athletes', 'updated_at', 'TEXT');
    const now = nowIso();
    await db.run('UPDATE athletes SET family_id = COALESCE(family_id, ?), created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?)', FAMILY_ID, now, now);

    await addColumnIfMissing(db, 'sports', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
    await addColumnIfMissing(db, 'sports', 'created_at', 'TEXT');
    await addColumnIfMissing(db, 'sports', 'updated_at', 'TEXT');
    await db.run('UPDATE sports SET is_active = COALESCE(is_active, 1), created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?)', now, now);
    await insertMany(
      db,
      `INSERT OR IGNORE INTO sports (id, label, sort_order, is_active, created_at, updated_at)
       VALUES ($id, $label, $sort_order, 1, $created_at, $updated_at)`,
      legacySports.map(({ id, label, sort_order }) => ({ $id: id, $label: label, $sort_order: sort_order, $created_at: now, $updated_at: now }))
    );
    await db.exec(canonicalSchema);
    const familyName = await db.get("SELECT value FROM settings WHERE key = 'family_name'");
    await db.run(
      `INSERT OR IGNORE INTO families (id, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      FAMILY_ID,
      familyName?.value || 'Our Team',
      now,
      now
    );
    await db.run(
      `INSERT OR IGNORE INTO athlete_sports
       (athlete_id, sport_id, is_primary, team_name, created_at, updated_at)
       SELECT a.id, s.id, CASE WHEN lower(a.sport) = lower(s.label) THEN 1 ELSE 0 END,
              a.team, ?, ?
       FROM athletes a JOIN sports s ON lower(a.sport) = lower(s.label)
       WHERE a.sport IS NOT NULL`,
      now,
      now
    );
    await migrateLegacyVideos(db);
    const migration = await db.get('SELECT version FROM schema_migrations WHERE version = ?', MIGRATION_VERSION);
    if (!migration) {
      const counts = {
        athletes: Number((await db.get('SELECT COUNT(*) AS count FROM athletes')).count),
        events: Number((await db.get('SELECT COUNT(*) AS count FROM events')).count),
        moments: Number((await db.get('SELECT COUNT(*) AS count FROM moments')).count),
        clips: Number((await db.get('SELECT COUNT(*) AS count FROM clips')).count),
      };
      await db.run(
        `INSERT INTO schema_migrations (version, checksum, applied_at, backfill_counts_json)
         VALUES (?, ?, ?, ?)`,
        MIGRATION_VERSION,
        createHash('sha256').update(canonicalSchema).digest('hex'),
        nowIso(),
        JSON.stringify(counts)
      );
    }
    await db.exec('COMMIT');
    if (!(await tableObject(db, 'children'))) {
      await db.exec(`CREATE VIEW children AS
        SELECT id, name, sport, team, color, archived, created_at, updated_at FROM athletes`);
    }
    if (seedDemo) await seedDemoFixture(db);
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
};

export const initDb = async (dbPathArg, options = {}) => {
  const dbPath = dbPathArg || process.env.DB_PATH || DEFAULT_DB_PATH;
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const athleteTable = (await tableExists(db, 'athletes')) ? 'athletes' : 'children';
  if (!(await tableExists(db, athleteTable))) await db.exec(baseSchema('children'));
  else if (!(await tableExists(db, 'sports'))) await db.exec(baseSchema(athleteTable));
  const wasEmpty = await seedLegacyData(db);
  await migrateDomain(db, {
    seedDemo: Boolean(options.seedDemo || process.env.SEED_DEMO === '1' || wasEmpty),
  });
  return db;
};

export const nowIso = () => new Date().toISOString();

export const toTagArray = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(tags).split(',').map((tag) => tag.trim()).filter(Boolean);
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

export { FAMILY_ID, addNote, addTags, deterministicId, ensureTag, normalizeTagValues };
