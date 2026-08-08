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
import {
  FAMILY_ID,
  addNote,
  addTags,
  deterministicId,
  initDb,
  nowIso,
  normalizeTagValues,
  toTagArray,
  buildVideoRow,
} from './db.js';
import { isBcryptHash, normalizeFamilyPinHash } from './config.js';

dotenv.config();

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const DEFAULT_DIST_PATH = path.resolve(process.cwd(), 'dist');
const VALID_RESULTS = new Set(['win', 'loss', 'draw', 'dq', 'unknown']);
const VALID_MEDALS = new Set(['gold', 'silver', 'bronze', 'none', 'unknown']);
const VALID_EVENT_TYPES = new Set(['tournament', 'game', 'practice', 'test', 'belt_test', 'camp', 'seminar', 'other']);
const VALID_MOMENT_KINDS = new Set(['fight', 'game', 'performance', 'drill', 'test', 'highlight', 'other']);
const VALID_NOTE_KINDS = new Set(['summary', 'coach', 'parent', 'other']);
const MAX_PAGE_SIZE = 100;

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const trimOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const isIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const isTimezone = (value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const getHttpUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) return null;
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

const parseList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const filterTagSlug = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const parseJson = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toPublicClip = (row) => {
  if (!row) return null;
  const safe = { ...row };
  delete safe.local_path;
  return {
    ...safe,
    hidden: Boolean(safe.hidden),
    attachment_level: safe.moment_id ? 'moment' : 'event',
    tags: Array.isArray(safe.tags) ? safe.tags : toTagArray(safe.tags),
  };
};

const sendError = (res, status, code, message, fields) => res.status(status).json({
  error: {
    code,
    message,
    ...(fields ? { fields } : {}),
  },
});

const sendCompatError = (res, status, message) => res.status(status).json({ error: message });

const deleteUploadedFile = async (file) => {
  const filePath = file?.path || file?.local_path;
  if (!filePath) return;
  await fs.promises.rm(filePath, { force: true });
};

const uploadDirectoryBytes = async (directory) => {
  let total = 0;
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    total += (await fs.promises.stat(path.join(directory, entry.name))).size;
  }
  return total;
};

const transactionTails = new WeakMap();

const withTransaction = async (db, callback) => {
  const previous = transactionTails.get(db) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  transactionTails.set(db, current);
  await previous;
  try {
    await db.exec('BEGIN IMMEDIATE');
    try {
      const value = await callback();
      await db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        // Preserve the original database or validation error.
      }
      throw error;
    }
  } finally {
    release();
    if (transactionTails.get(db) === current) transactionTails.delete(db);
  }
};

const createDomainError = (status, code, message, fields) => {
  const error = new Error(message);
  error.httpStatus = status;
  error.code = code;
  error.fields = fields;
  return error;
};

const assertOrThrow = (condition, status, code, message, fields) => {
  if (!condition) throw createDomainError(status, code, message, fields);
};

const assertUploadQuota = async (file, maxUploadStorageMb, uploadDir) => {
  if (!file || maxUploadStorageMb <= 0) return;
  const bytes = await uploadDirectoryBytes(uploadDir);
  assertOrThrow(bytes <= maxUploadStorageMb * 1024 * 1024, 413, 'UPLOAD_QUOTA_EXCEEDED', 'Upload storage quota exceeded');
};

const validateResult = (value, field = 'result') => {
  if (value === undefined || value === null) return 'unknown';
  assertOrThrow(VALID_RESULTS.has(value), 400, 'VALIDATION_ERROR', `${field} must be a valid result`);
  return value;
};

const validateTags = (tags) => normalizeTagValues(tags).map(({ label }) => label);

const validateNotes = (notes) => {
  if (notes === undefined) return undefined;
  assertOrThrow(Array.isArray(notes), 400, 'VALIDATION_ERROR', 'notes must be an array');
  return notes.filter(Boolean).map((note) => {
    const kind = note.kind || 'summary';
    const body = trimOrNull(note.body);
    assertOrThrow(VALID_NOTE_KINDS.has(kind), 400, 'VALIDATION_ERROR', 'note kind is invalid');
    assertOrThrow(body && body.length <= 5000, 400, 'VALIDATION_ERROR', 'note body is required and must be short');
    return { kind, body };
  });
};

const validateSportPack = (sportId, sportPack, sportData) => {
  if (!sportPack && !sportData) return { sportPack: null, sportData: null };
  assertOrThrow(sportId === 'taekwondo', 400, 'VALIDATION_ERROR', 'TKD fields are only available for Taekwondo moments');
  assertOrThrow(sportPack === 'tkd.v1', 400, 'VALIDATION_ERROR', 'Unsupported sport pack');
  assertOrThrow(sportData && typeof sportData === 'object' && !Array.isArray(sportData), 400, 'VALIDATION_ERROR', 'sport_data must be an object');
  const allowed = new Set(['pack', 'division', 'weight_class', 'age_group', 'belt_division', 'opponent_club', 'format', 'format_notes']);
  for (const key of Object.keys(sportData)) assertOrThrow(allowed.has(key), 400, 'VALIDATION_ERROR', `Unknown TKD field: ${key}`);
  assertOrThrow(sportData.pack === 'tkd.v1', 400, 'VALIDATION_ERROR', 'sport_data.pack must be tkd.v1');
  assertOrThrow(['sparring', 'poomsae'].includes(sportData.format), 400, 'VALIDATION_ERROR', 'TKD format must be sparring or poomsae');
  return { sportPack, sportData };
};

const clipFields = `
  c.id, c.family_id, c.event_id, c.moment_id, c.title, c.source_type, c.external_url,
  c.youtube_url, c.youtube_video_id, c.publish_status, c.publish_error, c.local_path,
  c.thumbnail_url, c.hidden, c.created_at, c.updated_at
`;

const loadTags = async (db, table, targetColumn, targetId) => {
  const rows = await db.all(
    `SELECT t.slug, t.label
     FROM ${table} j JOIN tags t ON t.id = j.tag_id
     WHERE j.${targetColumn} = ? ORDER BY j.rowid ASC`,
    targetId
  );
  return rows.map(({ label }) => label);
};

const loadTagSlugs = async (db, table, targetColumn, targetId) => {
  const rows = await db.all(
    `SELECT t.slug
     FROM ${table} j JOIN tags t ON t.id = j.tag_id
     WHERE j.${targetColumn} = ? ORDER BY j.rowid ASC`,
    targetId
  );
  return rows.map(({ slug }) => slug);
};

const loadNotes = async (db, targetColumn, targetId) => db.all(
  `SELECT id, kind, body, created_at, updated_at FROM notes WHERE ${targetColumn} = ? ORDER BY created_at ASC, id ASC`,
  targetId
);

const loadAthlete = async (db, id) => db.get(
  `SELECT a.id, a.family_id, a.name, a.photo_url, a.archived, a.sport, a.team, a.color,
          a.created_at, a.updated_at,
          COUNT(DISTINCT ec.clip_id) AS clip_count,
          COUNT(DISTINCT ea.event_id) AS event_count
   FROM athletes a
   LEFT JOIN event_athletes ea ON ea.athlete_id = a.id
   LEFT JOIN (
     SELECT c.id AS clip_id, c.event_id FROM clips c
   ) ec ON ec.event_id = ea.event_id
   WHERE a.id = ? AND a.family_id = ?
   GROUP BY a.id`,
  id,
  FAMILY_ID
);

const loadAthleteSports = async (db, athleteId) => db.all(
  `SELECT s.id, s.label, s.sort_order, asp.is_primary, asp.team_name, asp.club_name,
          asp.belt_rank, asp.age_group, asp.weight_class
   FROM athlete_sports asp JOIN sports s ON s.id = asp.sport_id
   WHERE asp.athlete_id = ? ORDER BY asp.is_primary DESC, s.sort_order ASC, s.label ASC`,
  athleteId
);

const loadAthleteDetail = async (db, id) => {
  const athlete = await loadAthlete(db, id);
  if (!athlete) return null;
  return {
    ...athlete,
    archived: Boolean(athlete.archived),
    sports: await loadAthleteSports(db, id),
  };
};

const loadEventRow = async (db, id) => db.get(
  `SELECT e.*, s.id AS sport_id_value, s.label AS sport_label, s.sort_order AS sport_sort_order
   FROM events e JOIN sports s ON s.id = e.sport_id
   WHERE e.id = ? AND e.family_id = ?`,
  id,
  FAMILY_ID
);

const loadEventParticipants = async (db, eventId) => db.all(
  `SELECT a.id, a.name, a.photo_url, ea.display_order, ea.result, ea.placement, ea.medal
   FROM event_athletes ea JOIN athletes a ON a.id = ea.athlete_id
   WHERE ea.event_id = ? ORDER BY ea.display_order ASC, a.name ASC`,
  eventId
);

const loadClipRows = async (db, targetClause, targetId, includeHidden = false, extraClause = '') => {
  const hiddenClause = includeHidden ? '' : ' AND c.hidden = 0';
  const rows = await db.all(
    `SELECT ${clipFields}
     FROM clips c WHERE ${targetClause} = ?${extraClause}${hiddenClause}
     ORDER BY c.created_at DESC, c.id DESC`,
    targetId
  );
  return Promise.all(rows.map(async (row) => ({
    ...toPublicClip(row),
    tags: await loadTags(db, 'clip_tags', 'clip_id', row.id),
    notes: await loadNotes(db, 'clip_id', row.id),
  })));
};

const loadMomentRow = async (db, id) => db.get(
  `SELECT m.*, e.name AS event_name, e.start_date AS event_start_date, e.end_date AS event_end_date,
          e.hidden AS event_hidden, e.sport_id, s.label AS sport_label
   FROM moments m JOIN events e ON e.id = m.event_id JOIN sports s ON s.id = e.sport_id
   WHERE m.id = ? AND m.family_id = ?`,
  id,
  FAMILY_ID
);

const momentOutput = async (db, row, includeHidden = false, detail = true) => {
  if (!row) return null;
  const score = {
    for: row.score_for === null || row.score_for === undefined ? null : row.score_for,
    against: row.score_against === null || row.score_against === undefined ? null : row.score_against,
    text: row.score_text || null,
  };
  const athletes = await db.all(
    `SELECT a.id, a.name, ma.role, ma.display_order
     FROM moment_athletes ma JOIN athletes a ON a.id = ma.athlete_id
     WHERE ma.moment_id = ? ORDER BY ma.display_order ASC, a.name ASC`,
    row.id
  );
  const result = {
    id: row.id,
    family_id: row.family_id,
    event_id: row.event_id,
    kind: row.kind,
    title: row.title,
    occurred_date: row.occurred_date,
    occurred_at: row.occurred_at,
    timezone: row.timezone,
    sort_order: row.sort_order,
    result: row.result,
    score,
    score_for: row.score_for,
    score_against: row.score_against,
    score_text: row.score_text,
    opponent_name: row.opponent_name,
    opponent_team_name: row.opponent_team_name,
    round_label: row.round_label,
    period_label: row.period_label,
    bout_number: row.bout_number,
    sport_pack: row.sport_pack,
    sport_data: parseJson(row.sport_data_json),
    hidden: Boolean(row.hidden),
    hidden_via_parent: Boolean(row.event_hidden),
    athletes,
    clip_count: Number((await db.get('SELECT COUNT(*) AS count FROM clips WHERE moment_id = ? AND hidden = 0', row.id)).count),
  };
  if (detail) {
    result.notes = await loadNotes(db, 'moment_id', row.id);
    result.tags = await loadTags(db, 'moment_tags', 'moment_id', row.id);
    result.clips = await loadClipRows(db, 'c.moment_id', row.id, includeHidden);
    result.event = {
      id: row.event_id,
      name: row.event_name,
      start_date: row.event_start_date,
      end_date: row.event_end_date,
      sport: { id: row.sport_id, label: row.sport_label },
    };
  }
  return result;
};

const eventSummary = (row, participants, clips, tags = [], clipCount = clips.length) => ({
  id: row.id,
  family_id: row.family_id,
  name: row.name,
  type: row.type,
  sport: { id: row.sport_id, label: row.sport_label },
  start_date: row.start_date,
  end_date: row.end_date,
  timezone: row.timezone,
  venue: {
    name: row.venue_name,
    city: row.location_city,
    region: row.location_region,
    country: row.location_country,
  },
  result: row.result,
  placement: row.placement,
  medal: row.medal,
  hidden: Boolean(row.hidden),
  participants,
  tags,
  clip_count: clipCount,
});

const eventOutput = async (db, row, includeHidden = false, momentFilter = null) => {
  if (!row) return null;
  const participants = await loadEventParticipants(db, row.id);
  const eventClips = await loadClipRows(db, 'c.event_id', row.id, includeHidden, ' AND c.moment_id IS NULL');
  const allMoments = await db.all(
    `SELECT m.*, e.name AS event_name, e.start_date AS event_start_date, e.end_date AS event_end_date,
            e.sport_id, s.label AS sport_label
     FROM moments m JOIN events e ON e.id = m.event_id JOIN sports s ON s.id = e.sport_id
     WHERE m.event_id = ? ${includeHidden ? '' : 'AND m.hidden = 0'}
     ORDER BY m.sort_order ASC, m.occurred_date ASC, m.id ASC`,
    row.id
  );
  const moments = [];
  for (const moment of allMoments) {
    if (momentFilter && !(await momentFilter(moment))) continue;
    moments.push(await momentOutput(db, moment, includeHidden, true));
  }
  const notes = await loadNotes(db, 'event_id', row.id);
  const tags = await loadTags(db, 'event_tags', 'event_id', row.id);
  const clipCount = eventClips.length + moments.reduce((count, moment) => count + moment.clip_count, 0);
  const summary = eventSummary(row, participants, eventClips, tags, clipCount);
  return {
    ...summary,
    notes,
    tags,
    clips: eventClips,
    event_clips: eventClips,
    moments,
  };
};

const ensureSport = async (db, sportId) => {
  const sport = await db.get('SELECT id, label, sort_order, is_active FROM sports WHERE id = ?', sportId);
  assertOrThrow(sport, 400, 'VALIDATION_ERROR', 'Unknown sport');
  return sport;
};

const ensureAthlete = async (db, athleteId) => {
  const athlete = await db.get('SELECT id, name, sport, team FROM athletes WHERE id = ? AND family_id = ? AND archived = 0', athleteId, FAMILY_ID);
  assertOrThrow(athlete, 422, 'UNPROCESSABLE_ENTITY', 'Athlete is not available in this family');
  return athlete;
};

const validateParticipantInput = async (db, participants) => {
  assertOrThrow(Array.isArray(participants), 400, 'VALIDATION_ERROR', 'participants must be an array');
  const seen = new Set();
  const rows = [];
  for (const [index, participant] of participants.entries()) {
    const athleteId = participant?.athlete_id || participant?.id;
    assertOrThrow(athleteId && !seen.has(athleteId), 400, 'VALIDATION_ERROR', 'participants contain a duplicate or missing athlete', { [`participants.${index}`]: 'athlete_id is required' });
    seen.add(athleteId);
    await ensureAthlete(db, athleteId);
    const result = validateResult(participant.result);
    const medal = participant.medal || 'none';
    assertOrThrow(VALID_MEDALS.has(medal), 400, 'VALIDATION_ERROR', 'participant medal is invalid');
    rows.push({
      athlete_id: athleteId,
      display_order: Number.isInteger(participant.display_order) ? participant.display_order : index,
      result,
      placement: trimOrNull(participant.placement),
      medal,
    });
  }
  return rows;
};

const insertEventGraph = async (db, payload, forcedId = null) => {
  const name = trimOrNull(payload.name);
  const type = payload.type || 'other';
  const sportId = trimOrNull(payload.sport_id);
  const startDate = trimOrNull(payload.start_date);
  const endDate = trimOrNull(payload.end_date || payload.start_date);
  const timezone = payload.timezone || 'UTC';
  assertOrThrow(name && name.length <= 120, 400, 'VALIDATION_ERROR', 'Event name is required');
  assertOrThrow(VALID_EVENT_TYPES.has(type), 400, 'VALIDATION_ERROR', 'Event type is invalid');
  assertOrThrow(sportId, 400, 'VALIDATION_ERROR', 'sport_id is required');
  await ensureSport(db, sportId);
  assertOrThrow(isIsoDate(startDate) && isIsoDate(endDate), 400, 'VALIDATION_ERROR', 'Event dates must use YYYY-MM-DD');
  assertOrThrow(endDate >= startDate, 400, 'VALIDATION_ERROR', 'end_date must be on or after start_date');
  assertOrThrow(isTimezone(timezone), 400, 'VALIDATION_ERROR', 'timezone is invalid');
  const result = validateResult(payload.result);
  const medal = payload.medal || 'none';
  assertOrThrow(VALID_MEDALS.has(medal), 400, 'VALIDATION_ERROR', 'medal is invalid');
  const participants = await validateParticipantInput(db, payload.participants || []);
  const notes = validateNotes(payload.notes);
  const tags = validateTags(payload.tags);
  const id = forcedId || `evt_${randomUUID()}`;
  const now = nowIso();
  const venue = payload.venue || {};
  await db.run(
    `INSERT INTO events (
      id, family_id, sport_id, name, type, start_date, end_date, timezone, venue_name,
      location_city, location_region, location_country, result, placement, medal, hidden,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    FAMILY_ID,
    sportId,
    name,
    type,
    startDate,
    endDate,
    timezone,
    trimOrNull(venue.name),
    trimOrNull(venue.city),
    trimOrNull(venue.region),
    trimOrNull(venue.country),
    result,
    trimOrNull(payload.placement),
    medal,
    payload.hidden ? 1 : 0,
    now,
    now
  );
  for (const participant of participants) {
    await db.run(
      `INSERT INTO event_athletes
       (event_id, athlete_id, display_order, result, placement, medal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      participant.athlete_id,
      participant.display_order,
      participant.result,
      participant.placement,
      participant.medal,
      now,
      now
    );
  }
  if (notes) for (const note of notes) await addNote(db, 'event_id', id, note);
  await addTags(db, 'event_tags', 'event_id', id, tags);
  return id;
};

const replaceEventRelations = async (db, eventId, payload) => {
  if (payload.participants !== undefined) {
    const participants = await validateParticipantInput(db, payload.participants);
    const momentCount = await db.get('SELECT COUNT(*) AS count FROM moments WHERE event_id = ?', eventId);
    if (Number(momentCount.count) > 0) {
      const momentAthletes = await db.all('SELECT DISTINCT athlete_id FROM moment_athletes WHERE moment_id IN (SELECT id FROM moments WHERE event_id = ?)', eventId);
      const ids = new Set(participants.map(({ athlete_id }) => athlete_id));
      assertOrThrow(momentAthletes.every(({ athlete_id }) => ids.has(athlete_id)), 409, 'CONFLICT', 'Participants cannot remove an athlete used by a moment');
    }
    await db.run('DELETE FROM event_athletes WHERE event_id = ?', eventId);
    const now = nowIso();
    for (const participant of participants) {
      await db.run(
        `INSERT INTO event_athletes
         (event_id, athlete_id, display_order, result, placement, medal, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        eventId,
        participant.athlete_id,
        participant.display_order,
        participant.result,
        participant.placement,
        participant.medal,
        now,
        now
      );
    }
  }
  if (payload.notes !== undefined) {
    const notes = validateNotes(payload.notes);
    await db.run('DELETE FROM notes WHERE event_id = ?', eventId);
    if (notes) for (const note of notes) await addNote(db, 'event_id', eventId, note);
  }
  if (payload.tags !== undefined) {
    await db.run('DELETE FROM event_tags WHERE event_id = ?', eventId);
    await addTags(db, 'event_tags', 'event_id', eventId, validateTags(payload.tags));
  }
};

const insertMomentGraph = async (db, eventRow, payload, forcedId = null) => {
  const title = trimOrNull(payload.title);
  const kind = payload.kind || 'other';
  const occurredDate = trimOrNull(payload.occurred_date);
  assertOrThrow(title && title.length <= 160, 400, 'VALIDATION_ERROR', 'Moment title is required');
  assertOrThrow(VALID_MOMENT_KINDS.has(kind), 400, 'VALIDATION_ERROR', 'Moment kind is invalid');
  assertOrThrow(isIsoDate(occurredDate), 400, 'VALIDATION_ERROR', 'occurred_date must use YYYY-MM-DD');
  assertOrThrow(occurredDate >= eventRow.start_date && occurredDate <= eventRow.end_date, 422, 'UNPROCESSABLE_ENTITY', 'Moment date must be within the event date range');
  const result = validateResult(payload.result);
  const scoreFor = payload.score_for === null || payload.score_for === undefined || payload.score_for === '' ? null : Number(payload.score_for);
  const scoreAgainst = payload.score_against === null || payload.score_against === undefined || payload.score_against === '' ? null : Number(payload.score_against);
  const scoreText = trimOrNull(payload.score_text);
  assertOrThrow((scoreFor === null && scoreAgainst === null) || (Number.isInteger(scoreFor) && Number.isInteger(scoreAgainst) && scoreFor >= 0 && scoreAgainst >= 0), 400, 'VALIDATION_ERROR', 'Scores must be two non-negative integers');
  assertOrThrow(!scoreText || (scoreFor === null && scoreAgainst === null), 400, 'VALIDATION_ERROR', 'score_text cannot be combined with numeric scores');
  assertOrThrow(!scoreText || scoreText.length <= 40, 400, 'VALIDATION_ERROR', 'score_text is too long');
  const pack = validateSportPack(eventRow.sport_id, payload.sport_pack || null, payload.sport_data || null);
  const athleteIds = payload.athlete_ids || (await db.all('SELECT athlete_id FROM event_athletes WHERE event_id = ?', eventRow.id)).map(({ athlete_id }) => athlete_id);
  assertOrThrow(Array.isArray(athleteIds) && athleteIds.length > 0, 400, 'VALIDATION_ERROR', 'athlete_ids must include at least one event participant');
  const eventAthletes = new Set((await db.all('SELECT athlete_id FROM event_athletes WHERE event_id = ?', eventRow.id)).map(({ athlete_id }) => athlete_id));
  assertOrThrow(athleteIds.every((id) => eventAthletes.has(id)), 422, 'UNPROCESSABLE_ENTITY', 'Moment athletes must participate in the event');
  const notes = validateNotes(payload.notes);
  const tags = validateTags(payload.tags);
  const id = forcedId || `mom_${randomUUID()}`;
  const now = nowIso();
  await db.run(
    `INSERT INTO moments (
      id, family_id, event_id, kind, title, occurred_date, occurred_at, timezone, sort_order,
      result, score_for, score_against, score_text, opponent_name, opponent_team_name,
      round_label, period_label, bout_number, sport_pack, sport_data_json, hidden,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    FAMILY_ID,
    eventRow.id,
    kind,
    title,
    occurredDate,
    trimOrNull(payload.occurred_at),
    payload.timezone || eventRow.timezone,
    Number.isInteger(payload.sort_order) ? payload.sort_order : 0,
    result,
    scoreFor,
    scoreAgainst,
    scoreText,
    trimOrNull(payload.opponent_name),
    trimOrNull(payload.opponent_team_name),
    trimOrNull(payload.round_label),
    trimOrNull(payload.period_label),
    payload.bout_number === undefined || payload.bout_number === null || payload.bout_number === '' ? null : Number(payload.bout_number),
    pack.sportPack,
    pack.sportData ? JSON.stringify(pack.sportData) : null,
    payload.hidden ? 1 : 0,
    now,
    now
  );
  for (const [index, athleteId] of athleteIds.entries()) {
    await db.run(
      `INSERT INTO moment_athletes (moment_id, athlete_id, role, display_order)
       VALUES (?, ?, ?, ?)`,
      id,
      athleteId,
      index === 0 ? 'primary' : 'participant',
      index
    );
  }
  if (notes) for (const note of notes) await addNote(db, 'moment_id', id, note);
  await addTags(db, 'moment_tags', 'moment_id', id, tags);
  return id;
};

const replaceMomentRelations = async (db, momentId, payload) => {
  if (payload.athlete_ids !== undefined) {
    const moment = await loadMomentRow(db, momentId);
    const eventAthletes = new Set((await db.all('SELECT athlete_id FROM event_athletes WHERE event_id = ?', moment.event_id)).map(({ athlete_id }) => athlete_id));
    assertOrThrow(Array.isArray(payload.athlete_ids) && payload.athlete_ids.length > 0 && payload.athlete_ids.every((id) => eventAthletes.has(id)), 422, 'UNPROCESSABLE_ENTITY', 'Moment athletes must participate in the event');
    await db.run('DELETE FROM moment_athletes WHERE moment_id = ?', momentId);
    for (const [index, athleteId] of payload.athlete_ids.entries()) {
      await db.run('INSERT INTO moment_athletes (moment_id, athlete_id, role, display_order) VALUES (?, ?, ?, ?)', momentId, athleteId, index === 0 ? 'primary' : 'participant', index);
    }
  }
  if (payload.notes !== undefined) {
    const notes = validateNotes(payload.notes);
    await db.run('DELETE FROM notes WHERE moment_id = ?', momentId);
    if (notes) for (const note of notes) await addNote(db, 'moment_id', momentId, note);
  }
  if (payload.tags !== undefined) {
    await db.run('DELETE FROM moment_tags WHERE moment_id = ?', momentId);
    await addTags(db, 'moment_tags', 'moment_id', momentId, validateTags(payload.tags));
  }
};

const prepareClipPayload = async ({ body, file, youtubeMode, defaultTitle }) => {
  const metadata = parseJson(body?.metadata, {}) || {};
  const sourceType = trimOrNull(metadata.source_type || body?.source_type);
  const title = trimOrNull(metadata.title || body?.title || defaultTitle);
  const externalUrl = trimOrNull(metadata.external_url || body?.external_url);
  assertOrThrow(title && title.length <= 160, 400, 'VALIDATION_ERROR', 'Clip title is required');
  assertOrThrow(['link', 'upload'].includes(sourceType), 400, 'VALIDATION_ERROR', 'source_type must be link or upload');
  const tags = validateTags(metadata.tags ?? body?.tags);
  const notes = validateNotes(metadata.notes ?? body?.notes);
  if (sourceType === 'link') {
    assertOrThrow(!file, 400, 'VALIDATION_ERROR', 'A link cannot include an upload file');
    const safeUrl = getHttpUrl(externalUrl);
    assertOrThrow(safeUrl, 400, 'VALIDATION_ERROR', 'Link URL must use http or https');
    return {
      title,
      source_type: 'link',
      external_url: safeUrl,
      youtube_url: safeUrl,
      youtube_video_id: youtubeIdFromUrl(safeUrl),
      publish_status: 'ready',
      publish_error: null,
      local_path: null,
      thumbnail_url: metadata.thumbnail_url || '/assets/generated/moment-soccer-celebration.png',
      tags,
      notes,
      file,
    };
  }
  assertOrThrow(file, 400, 'VALIDATION_ERROR', 'Upload file required');
  assertOrThrow(String(file.mimetype || '').startsWith('video/'), 415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload must be a video file');
  const mock = youtubeMode === 'mock';
  const mockId = `mock_${randomUUID()}`;
  return {
    title,
    source_type: 'upload',
    external_url: null,
    youtube_url: mock ? `https://youtube.com/watch?v=${mockId}` : null,
    youtube_video_id: mock ? mockId : null,
    publish_status: mock ? 'mock' : 'pending',
    publish_error: mock
      ? 'YouTube is not connected; this upload is a local mock.'
      : 'Upload is waiting for YouTube live-mode credentials.',
    local_path: file.path,
    thumbnail_url: metadata.thumbnail_url || '/assets/generated/moment-soccer-celebration.png',
    tags,
    notes,
    file,
  };
};

const insertClipGraph = async (db, eventRow, payload, forcedId = null, momentId = null) => {
  if (payload.source_type === 'link') assertOrThrow(payload.external_url, 400, 'VALIDATION_ERROR', 'Link URL is required');
  if (momentId) {
    const moment = await loadMomentRow(db, momentId);
    assertOrThrow(moment && moment.event_id === eventRow.id, 409, 'CONFLICT', 'Moment does not belong to this event');
  }
  const id = forcedId || `clip_${randomUUID()}`;
  const now = nowIso();
  await db.run(
    `INSERT INTO clips (
      id, family_id, event_id, moment_id, title, source_type, external_url, youtube_url,
      youtube_video_id, publish_status, publish_error, local_path, thumbnail_url, hidden,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    FAMILY_ID,
    eventRow.id,
    momentId,
    payload.title,
    payload.source_type,
    payload.external_url,
    payload.youtube_url,
    payload.youtube_video_id,
    payload.publish_status,
    payload.publish_error,
    payload.local_path,
    payload.thumbnail_url,
    payload.hidden ? 1 : 0,
    now,
    now
  );
  if (payload.notes) for (const note of payload.notes) await addNote(db, 'clip_id', id, note);
  await addTags(db, 'clip_tags', 'clip_id', id, payload.tags);
  return id;
};

const loadClipById = async (db, id) => db.get(
  `SELECT ${clipFields}, e.hidden AS event_hidden, m.hidden AS moment_hidden
   FROM clips c JOIN events e ON e.id = c.event_id
   LEFT JOIN moments m ON m.id = c.moment_id
   WHERE c.id = ? AND c.family_id = ?`,
  id,
  FAMILY_ID
);

const createMoment = async (db, eventId, payload, forcedId = null) => {
  const event = await loadEventRow(db, eventId);
  assertOrThrow(event, 404, 'NOT_FOUND', 'Event not found');
  const id = await withTransaction(db, () => insertMomentGraph(db, event, payload, forcedId));
  return loadMomentRow(db, id).then((row) => momentOutput(db, row, true));
};

const createClip = async (db, eventId, payload, file, youtubeMode, maxUploadStorageMb, uploadDir, momentId = null, forcedId = null) => {
  let prepared;
  try {
    const event = await loadEventRow(db, eventId);
    assertOrThrow(event, 404, 'NOT_FOUND', 'Event not found');
    prepared = await prepareClipPayload({ body: payload, file, youtubeMode, defaultTitle: `${event.name} clip` });
    await assertUploadQuota(file, maxUploadStorageMb, uploadDir);
    const id = await withTransaction(db, () => insertClipGraph(db, event, prepared, forcedId, momentId));
    return toPublicClip(await loadClipById(db, id));
  } catch (error) {
    await deleteUploadedFile(file);
    throw error;
  }
};

const createCompatVideo = async (db, req, youtubeMode, maxUploadStorageMb, uploadDir) => {
  const childId = trimOrNull(req.body?.child_id);
  const sport = trimOrNull(req.body?.sport);
  const eventName = trimOrNull(req.body?.event_name);
  const eventDate = trimOrNull(req.body?.event_date);
  const title = trimOrNull(req.body?.title);
  const notes = trimOrNull(req.body?.notes);
  const sourceType = trimOrNull(req.body?.source_type);
  const externalUrl = trimOrNull(req.body?.external_url);
  assertOrThrow(childId && eventDate && title && sourceType, 400, 'VALIDATION_ERROR', 'Missing required fields');
  assertOrThrow(isIsoDate(eventDate), 400, 'VALIDATION_ERROR', 'Event date must be YYYY-MM-DD');
  const athlete = await ensureAthlete(db, childId);
  const sportRow = await db.get('SELECT id, label FROM sports WHERE lower(label) = lower(?)', sport || athlete.sport || '');
  assertOrThrow(sportRow, 400, 'VALIDATION_ERROR', 'Unsupported sport');
  const videoId = trimOrNull(req.body?.id) || `vid_${randomUUID()}`;
  const eventKey = `${FAMILY_ID}|${childId}|${sportRow.id}|${(eventName || videoId).toLowerCase()}|${eventDate}`;
  const eventId = deterministicId('evt_compat', eventKey);
  const momentId = deterministicId('mom_compat', videoId);
  const clipId = deterministicId('clip_compat', videoId);
  const prepared = await prepareClipPayload({
    body: {
      ...req.body,
      source_type: sourceType,
      title,
      external_url: externalUrl,
      tags: req.body?.tags,
      notes: notes ? [{ kind: 'summary', body: notes }] : [],
    },
    file: req.file,
    youtubeMode,
    defaultTitle: title,
  });
  await assertUploadQuota(req.file, maxUploadStorageMb, uploadDir);
  try {
    await withTransaction(db, async () => {
      const eventExists = await loadEventRow(db, eventId);
      if (!eventExists) {
        await insertEventGraph(db, {
          name: eventName || `Unsorted ${sportRow.label} · ${eventDate}`,
          type: /practice|training|drill/i.test(eventName || '') ? 'practice' : /vs|versus|match|game/i.test(eventName || '') ? 'game' : 'other',
          sport_id: sportRow.id,
          start_date: eventDate,
          end_date: eventDate,
          participants: [{ athlete_id: childId }],
          hidden: false,
        }, eventId);
      }
      const event = await loadEventRow(db, eventId);
      await insertMomentGraph(db, event, {
        kind: /practice|training|drill/i.test(eventName || '') ? 'drill' : /vs|versus|match|game/i.test(eventName || '') ? 'game' : 'highlight',
        title,
        occurred_date: eventDate,
        athlete_ids: [childId],
        hidden: Boolean(req.body?.hidden),
        tags: req.body?.tags,
      }, momentId);
      await insertClipGraph(db, event, prepared, clipId, momentId);
      await db.run(
        `INSERT OR IGNORE INTO legacy_video_map (legacy_video_id, event_id, moment_id, clip_id, migrated_at)
         VALUES (?, ?, ?, ?, ?)`,
        videoId,
        eventId,
        momentId,
        clipId,
        nowIso()
      );
      const row = buildVideoRow({
        id: videoId,
        child_id: childId,
        sport: sportRow.label,
        event_name: eventName,
        event_date: eventDate,
        title,
        notes,
        tags: req.body?.tags,
        source_type: prepared.source_type,
        external_url: prepared.external_url,
        youtube_url: prepared.youtube_url,
        youtube_video_id: prepared.youtube_video_id,
        publish_status: prepared.publish_status,
        publish_error: prepared.publish_error,
        hidden: req.body?.hidden,
        local_path: prepared.local_path,
        thumbnail_url: prepared.thumbnail_url,
      });
      await db.run(
        `INSERT INTO videos (
          id, child_id, sport, event_name, event_date, title, notes, tags, source_type,
          external_url, youtube_url, youtube_video_id, publish_status, publish_error, hidden,
          local_path, thumbnail_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.child_id,
        row.sport,
        row.event_name,
        row.event_date,
        row.title,
        row.notes,
        row.tags,
        row.source_type,
        row.external_url,
        row.youtube_url,
        row.youtube_video_id,
        row.publish_status,
        row.publish_error,
        row.hidden,
        row.local_path,
        row.thumbnail_url,
        row.created_at,
        row.updated_at
      );
    });
  } catch (error) {
    await deleteUploadedFile(req.file);
    throw error;
  }
  return toCompatVideo(db, await db.get('SELECT * FROM videos WHERE id = ?', videoId));
};

const toPublicVideo = (row) => {
  if (!row) return null;
  const safe = { ...row };
  delete safe.local_path;
  return { ...safe, tags: toTagArray(safe.tags) };
};

const toCompatVideo = async (db, row) => {
  if (!row) return null;
  const map = await db.get('SELECT event_id, moment_id, clip_id FROM legacy_video_map WHERE legacy_video_id = ?', row.id);
  if (!map) return toPublicVideo(row);
  const canonical = await db.get(
    `SELECT s.label AS sport, e.name AS event_name, m.occurred_date AS event_date, m.title,
            c.source_type, c.external_url, c.youtube_url, c.youtube_video_id,
            c.publish_status, c.publish_error, c.local_path, c.thumbnail_url, c.hidden,
            (SELECT body FROM notes n WHERE n.moment_id = m.id ORDER BY n.created_at ASC, n.id ASC LIMIT 1) AS notes
     FROM clips c
     JOIN events e ON e.id = c.event_id
     JOIN moments m ON m.id = c.moment_id
     JOIN sports s ON s.id = e.sport_id
     WHERE c.id = ? AND c.family_id = ?`,
    map.clip_id,
    FAMILY_ID
  );
  if (!canonical) return toPublicVideo(row);
  const tags = await loadTags(db, 'moment_tags', 'moment_id', map.moment_id);
  return toPublicVideo({
    ...row,
    ...canonical,
    tags: JSON.stringify(tags),
  });
};

export const createApp = (options = {}) => {
  const database = options.db;
  const configuredSessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET;
  const normalizedSessionSecret = String(configuredSessionSecret ?? '').trim();
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && (!normalizedSessionSecret || ['dev-secret-change-me', 'change-me-in-production'].includes(normalizedSessionSecret))) {
    throw new Error('SESSION_SECRET must be configured in production');
  }
  const sessionSecret = normalizedSessionSecret || 'dev-secret-change-me';
  const familyPinHash = normalizeFamilyPinHash(options.familyPinHash ?? process.env.FAMILY_PIN_HASH);
  const maxUploadMb = Number(options.maxUploadMb ?? process.env.MAX_UPLOAD_MB ?? 500);
  const maxUploadStorageMb = Number(options.maxUploadStorageMb ?? process.env.MAX_UPLOAD_STORAGE_MB ?? 2048);
  const youtubeMode = options.youtubeMode ?? process.env.YOUTUBE_MODE ?? 'mock';
  const uploadDir = path.resolve(options.uploadDir ?? DEFAULT_UPLOAD_DIR);
  const distPath = path.resolve(options.distPath ?? DEFAULT_DIST_PATH);
  const trustProxy = options.trustProxy ?? ['1', 'true'].includes(String(process.env.TRUST_PROXY).toLowerCase());
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: maxUploadMb * 1024 * 1024 } });
  const getDb = () => {
    if (!database) throw new Error('Database is not initialized');
    return database;
  };
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (process.env.NODE_ENV !== 'production') {
    const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',').map((origin) => origin.trim()).filter(Boolean);
    app.use(cors({ origin: configuredOrigins, credentials: true }));
  }
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Keep direct HTTP/LAN QA usable while retaining Secure cookies on HTTPS.
      secure: isProduction ? 'auto' : false,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }));
  const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
  const requireAuth = (req, res, next) => {
    if (req.session?.authenticated) return next();
    return sendError(res, 401, 'AUTH_REQUIRED', 'PIN required');
  };
  const requireAuthCompat = (req, res, next) => {
    if (req.session?.authenticated) return next();
    return sendCompatError(res, 401, 'PIN required');
  };
  const regenerateSession = (req) => new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));

  app.post('/api/auth/unlock', pinLimiter, asyncRoute(async (req, res) => {
    const pin = req.body?.pin;
    if (pin === undefined || pin === null || String(pin).length === 0) return sendCompatError(res, 400, 'PIN is required');
    if (!isBcryptHash(familyPinHash)) return sendCompatError(res, 500, 'Server missing valid FAMILY_PIN_HASH');
    if (!await bcrypt.compare(String(pin), familyPinHash)) return sendCompatError(res, 401, 'Check your PIN and try again');
    await regenerateSession(req);
    req.session.authenticated = true;
    return res.json({ ok: true });
  }));
  app.post('/api/auth/lock', (req, res, next) => req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  }));
  app.get('/api/me', (req, res) => res.json({ authenticated: Boolean(req.session?.authenticated) }));
  app.get('/api/settings', requireAuth, (req, res) => res.json({ youtube_mode: youtubeMode, max_upload_mb: maxUploadMb, max_upload_storage_mb: maxUploadStorageMb }));

  app.get('/api/sports', requireAuth, asyncRoute(async (req, res) => {
    const includeInactive = ['1', 'true'].includes(String(req.query.include_inactive || '').toLowerCase());
    const rows = await getDb().all(`SELECT id, label, sort_order, is_active FROM sports ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order ASC, label ASC`);
    res.json(rows);
  }));

  app.get('/api/athletes', requireAuth, asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), MAX_PAGE_SIZE);
    const clauses = ['a.family_id = ?'];
    const params = [FAMILY_ID];
    if (!['1', 'true'].includes(String(req.query.include_archived || '').toLowerCase())) clauses.push('a.archived = 0');
    if (req.query.sport_id) {
      clauses.push('EXISTS (SELECT 1 FROM athlete_sports filter_asp WHERE filter_asp.athlete_id = a.id AND filter_asp.sport_id = ?)');
      params.push(String(req.query.sport_id));
    }
    if (req.query.q) {
      clauses.push('lower(a.name) LIKE ?');
      params.push(`%${String(req.query.q).toLowerCase()}%`);
    }
    const rows = await getDb().all(`SELECT a.id FROM athletes a WHERE ${clauses.join(' AND ')} ORDER BY a.name ASC, a.id ASC LIMIT ?`, ...params, limit);
    res.json({ items: await Promise.all(rows.map(({ id }) => loadAthleteDetail(getDb(), id))), next_cursor: null });
  }));

  app.post('/api/athletes', requireAuth, asyncRoute(async (req, res) => {
    const name = trimOrNull(req.body?.name);
    assertOrThrow(name && name.length <= 120, 400, 'VALIDATION_ERROR', 'Name is required');
    const id = `ath_${randomUUID()}`;
    const now = nowIso();
    await withTransaction(getDb(), async () => {
      await getDb().run(
        `INSERT INTO athletes (id, family_id, name, photo_url, sport, team, color, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?)`,
        id,
        FAMILY_ID,
        name,
        trimOrNull(req.body?.photo_url),
        now,
        now
      );
      const sports = req.body?.sports || [];
      for (const [index, profile] of sports.entries()) {
        await ensureSport(getDb(), profile.sport_id);
        await getDb().run(
          `INSERT INTO athlete_sports (athlete_id, sport_id, is_primary, team_name, club_name, belt_rank, age_group, weight_class, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          profile.sport_id,
          profile.is_primary || index === 0 ? 1 : 0,
          trimOrNull(profile.team_name),
          trimOrNull(profile.club_name),
          trimOrNull(profile.belt_rank),
          trimOrNull(profile.age_group),
          trimOrNull(profile.weight_class),
          now,
          now
        );
      }
    });
    res.status(201).json(await loadAthleteDetail(getDb(), id));
  }));

  app.patch('/api/athletes/:id', requireAuth, asyncRoute(async (req, res) => {
    const existing = await loadAthleteDetail(getDb(), req.params.id);
    if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Athlete not found');
    const name = req.body?.name === undefined ? existing.name : trimOrNull(req.body.name);
    assertOrThrow(name, 400, 'VALIDATION_ERROR', 'Name is required');
    await withTransaction(getDb(), async () => {
      await getDb().run('UPDATE athletes SET name = ?, photo_url = ?, archived = ?, updated_at = ? WHERE id = ?', name, req.body?.photo_url === undefined ? existing.photo_url : trimOrNull(req.body.photo_url), req.body?.archived ? 1 : 0, nowIso(), req.params.id);
      if (req.body?.sports !== undefined) {
        assertOrThrow(Array.isArray(req.body.sports), 400, 'VALIDATION_ERROR', 'sports must be an array');
        await getDb().run('DELETE FROM athlete_sports WHERE athlete_id = ?', req.params.id);
        for (const [index, profile] of req.body.sports.entries()) {
          await ensureSport(getDb(), profile.sport_id);
          await getDb().run(
            `INSERT INTO athlete_sports (athlete_id, sport_id, is_primary, team_name, club_name, belt_rank, age_group, weight_class, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            req.params.id,
            profile.sport_id,
            profile.is_primary || index === 0 ? 1 : 0,
            trimOrNull(profile.team_name),
            trimOrNull(profile.club_name),
            trimOrNull(profile.belt_rank),
            trimOrNull(profile.age_group),
            trimOrNull(profile.weight_class),
            nowIso(),
            nowIso()
          );
        }
      }
    });
    res.json(await loadAthleteDetail(getDb(), req.params.id));
  }));

  app.get('/api/children', requireAuthCompat, asyncRoute(async (req, res) => {
    const includeArchived = ['1', 'true'].includes(String(req.query.includeArchived || '').toLowerCase());
    const rows = await getDb().all(`
      SELECT a.id, a.name, a.sport, a.team, a.color, a.archived, a.created_at, a.updated_at,
             COUNT(DISTINCT c.id) AS clip_count
      FROM athletes a LEFT JOIN clips c ON c.event_id IN (SELECT event_id FROM event_athletes WHERE athlete_id = a.id)
      WHERE a.family_id = ? ${includeArchived ? '' : 'AND a.archived = 0'}
      GROUP BY a.id ORDER BY a.created_at ASC, a.name ASC`,
      FAMILY_ID
    );
    res.json(rows);
  }));

  app.post('/api/children', requireAuthCompat, asyncRoute(async (req, res) => {
    const name = trimOrNull(req.body?.name);
    if (!name) return sendCompatError(res, 400, 'Name is required');
    const sportRow = req.body?.sport
      ? await getDb().get('SELECT id, label FROM sports WHERE lower(label) = lower(?)', req.body.sport)
      : null;
    if (req.body?.sport && !sportRow) return sendCompatError(res, 400, 'Unsupported sport');
    const id = `ath_${randomUUID()}`;
    const now = nowIso();
    const team = trimOrNull(req.body?.team);
    await withTransaction(getDb(), async () => {
      await getDb().run(
        `INSERT INTO athletes (id, family_id, name, sport, team, color, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        id,
        FAMILY_ID,
        name,
        trimOrNull(req.body?.sport),
        team,
        trimOrNull(req.body?.color),
        now,
        now
      );
      if (sportRow) {
        await getDb().run(
          `INSERT INTO athlete_sports (athlete_id, sport_id, is_primary, team_name, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?)`,
          id,
          sportRow.id,
          team,
          now,
          now
        );
      }
    });
    res.status(201).json(await getDb().get('SELECT id, name, sport, team, color, archived, created_at, updated_at FROM athletes WHERE id = ?', id));
  }));

  app.get('/api/timeline', requireAuth, asyncRoute(async (req, res) => {
    const includeHidden = ['1', 'true'].includes(String(req.query.include_hidden || '').toLowerCase());
    const athleteIds = parseList(req.query.athlete_id);
    const sports = parseList(req.query.sport_id);
    const eventTypes = parseList(req.query.event_type);
    const results = parseList(req.query.result);
    const tags = parseList(req.query.tag).map(filterTagSlug).filter(Boolean);
    const tagMode = req.query.tag_mode || 'any';
    assertOrThrow(['any', 'all'].includes(tagMode), 400, 'VALIDATION_ERROR', 'tag_mode must be any or all');
    const from = trimOrNull(req.query.from);
    const to = trimOrNull(req.query.to);
    if (from) assertOrThrow(isIsoDate(from), 400, 'VALIDATION_ERROR', 'from must be YYYY-MM-DD');
    if (to) assertOrThrow(isIsoDate(to), 400, 'VALIDATION_ERROR', 'to must be YYYY-MM-DD');
    if (from && to) assertOrThrow(from <= to, 400, 'VALIDATION_ERROR', 'from must be before to');
    const clauses = ['e.family_id = ?'];
    const params = [FAMILY_ID];
    if (!includeHidden) clauses.push('e.hidden = 0');
    if (sports.length) {
      clauses.push(`e.sport_id IN (${sports.map(() => '?').join(',')})`);
      params.push(...sports);
    }
    if (eventTypes.length) {
      clauses.push(`e.type IN (${eventTypes.map(() => '?').join(',')})`);
      params.push(...eventTypes);
    }
    if (from) { clauses.push('e.end_date >= ?'); params.push(from); }
    if (to) { clauses.push('e.start_date <= ?'); params.push(to); }
    if (athleteIds.length) {
      clauses.push(`EXISTS (SELECT 1 FROM event_athletes filter_ea WHERE filter_ea.event_id = e.id AND filter_ea.athlete_id IN (${athleteIds.map(() => '?').join(',')}))`);
      params.push(...athleteIds);
    }
    if (results.length) {
      clauses.push(`(e.result IN (${results.map(() => '?').join(',')}) OR EXISTS (SELECT 1 FROM moments filter_m WHERE filter_m.event_id = e.id AND filter_m.result IN (${results.map(() => '?').join(',')})))`);
      params.push(...results, ...results);
    }
    if (tags.length) {
      const tagPlaceholders = tags.map(() => '?').join(',');
      const tagExists = `(EXISTS (SELECT 1 FROM event_tags filter_et JOIN tags filter_t ON filter_t.id = filter_et.tag_id WHERE filter_et.event_id = e.id AND filter_t.slug IN (${tagPlaceholders})) OR EXISTS (SELECT 1 FROM moments filter_m2 JOIN moment_tags filter_mt ON filter_mt.moment_id = filter_m2.id JOIN tags filter_t2 ON filter_t2.id = filter_mt.tag_id WHERE filter_m2.event_id = e.id AND filter_t2.slug IN (${tagPlaceholders})))`;
      if (tagMode === 'all') {
        const tagExistsFor = (placeholder) => `(EXISTS (SELECT 1 FROM event_tags filter_et JOIN tags filter_t ON filter_t.id = filter_et.tag_id WHERE filter_et.event_id = e.id AND filter_t.slug = ${placeholder}) OR EXISTS (SELECT 1 FROM moments filter_m2 JOIN moment_tags filter_mt ON filter_mt.moment_id = filter_m2.id JOIN tags filter_t2 ON filter_t2.id = filter_mt.tag_id WHERE filter_m2.event_id = e.id AND filter_t2.slug = ${placeholder}))`;
        clauses.push(tags.map(() => tagExistsFor('?')).join(' AND '));
        params.push(...tags.flatMap((tag) => [tag, tag]));
      } else {
        clauses.push(tagExists);
        params.push(...tags, ...tags);
      }
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), MAX_PAGE_SIZE);
    const rows = await getDb().all(`SELECT e.*, s.label AS sport_label FROM events e JOIN sports s ON s.id = e.sport_id WHERE ${clauses.join(' AND ')} ORDER BY e.end_date DESC, e.start_date DESC, e.id DESC LIMIT ?`, ...params, limit);
    const hasMomentFilter = results.length > 0 || tags.length > 0;
    const items = [];
    for (const row of rows) {
      const detail = await eventOutput(getDb(), row, includeHidden, async (moment) => {
        if (!hasMomentFilter) return true;
        if (results.length && !results.includes(moment.result)) return false;
        if (tags.length) {
          const momentTags = await loadTagSlugs(getDb(), 'moment_tags', 'moment_id', moment.id);
          if (tagMode === 'all' && !tags.every((tag) => momentTags.includes(tag))) return false;
          if (tagMode === 'any' && !tags.some((tag) => momentTags.includes(tag))) return false;
        }
        return true;
      });
      items.push({
        event: eventSummary(row, detail.participants, detail.event_clips, detail.tags, detail.clip_count),
        moments: detail.moments,
        event_clip_count: detail.event_clips.length,
        matched_by: [],
      });
    }
    res.json({
      items,
      next_cursor: null,
      applied_filters: {
        athlete_id: req.query.athlete_id || null,
        sport_id: req.query.sport_id || null,
        event_type: req.query.event_type || null,
        from,
        to,
        result: req.query.result || null,
        tag: req.query.tag || null,
      },
    });
  }));

  app.get('/api/events', requireAuth, asyncRoute(async (req, res) => {
    const includeHidden = ['1', 'true'].includes(String(req.query.include_hidden || '').toLowerCase());
    const athleteIds = parseList(req.query.athlete_id);
    const sportIds = parseList(req.query.sport_id);
    const eventTypes = parseList(req.query.event_type);
    const resultValues = parseList(req.query.result);
    const tagValues = parseList(req.query.tag).map(filterTagSlug).filter(Boolean);
    const clauses = ['e.family_id = ?'];
    const params = [FAMILY_ID];
    if (!includeHidden) clauses.push('e.hidden = 0');
    if (athleteIds.length) {
      clauses.push(`EXISTS (SELECT 1 FROM event_athletes event_filter WHERE event_filter.event_id = e.id AND event_filter.athlete_id IN (${athleteIds.map(() => '?').join(',')}))`);
      params.push(...athleteIds);
    }
    if (sportIds.length) { clauses.push(`e.sport_id IN (${sportIds.map(() => '?').join(',')})`); params.push(...sportIds); }
    if (eventTypes.length) { clauses.push(`e.type IN (${eventTypes.map(() => '?').join(',')})`); params.push(...eventTypes); }
    if (req.query.from) { assertOrThrow(isIsoDate(req.query.from), 400, 'VALIDATION_ERROR', 'from must be YYYY-MM-DD'); clauses.push('e.end_date >= ?'); params.push(req.query.from); }
    if (req.query.to) { assertOrThrow(isIsoDate(req.query.to), 400, 'VALIDATION_ERROR', 'to must be YYYY-MM-DD'); clauses.push('e.start_date <= ?'); params.push(req.query.to); }
    if (resultValues) {
      if (resultValues.length) {
        clauses.push(`(e.result IN (${resultValues.map(() => '?').join(',')}) OR EXISTS (SELECT 1 FROM moments event_result_filter WHERE event_result_filter.event_id = e.id AND event_result_filter.result IN (${resultValues.map(() => '?').join(',')})))`);
        params.push(...resultValues, ...resultValues);
      }
    }
    if (tagValues.length) {
      clauses.push(`(EXISTS (SELECT 1 FROM event_tags event_tag_filter JOIN tags event_tag ON event_tag.id = event_tag_filter.tag_id WHERE event_tag_filter.event_id = e.id AND event_tag.slug IN (${tagValues.map(() => '?').join(',')})) OR EXISTS (SELECT 1 FROM moments tag_moment JOIN moment_tags moment_tag_filter ON moment_tag_filter.moment_id = tag_moment.id JOIN tags moment_tag ON moment_tag.id = moment_tag_filter.tag_id WHERE tag_moment.event_id = e.id AND moment_tag.slug IN (${tagValues.map(() => '?').join(',')})))`);
      params.push(...tagValues, ...tagValues);
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), MAX_PAGE_SIZE);
    const rows = await getDb().all(`SELECT e.id FROM events e WHERE ${clauses.join(' AND ')} ORDER BY e.end_date DESC, e.start_date DESC, e.id DESC LIMIT ?`, ...params, limit);
    const items = [];
    for (const { id } of rows) {
      const row = await loadEventRow(getDb(), id);
      const detail = await eventOutput(getDb(), row, includeHidden);
      items.push(eventSummary(row, detail.participants, detail.event_clips, detail.tags, detail.clip_count));
    }
    res.json({ items, next_cursor: null });
  }));

  app.post('/api/events', requireAuth, asyncRoute(async (req, res) => {
    const id = await withTransaction(getDb(), () => insertEventGraph(getDb(), req.body || {}));
    res.status(201).json(await eventOutput(getDb(), await loadEventRow(getDb(), id), true));
  }));

  app.get('/api/events/:id', requireAuth, asyncRoute(async (req, res) => {
    const includeHidden = ['1', 'true'].includes(String(req.query.include_hidden || '').toLowerCase());
    const row = await loadEventRow(getDb(), req.params.id);
    if (!row || (!includeHidden && row.hidden)) return sendError(res, 404, 'NOT_FOUND', 'Event not found');
    res.json(await eventOutput(getDb(), row, includeHidden));
  }));

  app.patch('/api/events/:id', requireAuth, asyncRoute(async (req, res) => {
    const existing = await loadEventRow(getDb(), req.params.id);
    if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Event not found');
    await withTransaction(getDb(), async () => {
      const nextSport = req.body?.sport_id === undefined ? existing.sport_id : req.body.sport_id;
      assertOrThrow(nextSport === existing.sport_id, 409, 'CONFLICT', 'Event sport is immutable after creation');
      const name = req.body?.name === undefined ? existing.name : trimOrNull(req.body.name);
      const type = req.body?.type === undefined ? existing.type : req.body.type;
      const startDate = req.body?.start_date === undefined ? existing.start_date : trimOrNull(req.body.start_date);
      const endDate = req.body?.end_date === undefined ? existing.end_date : trimOrNull(req.body.end_date);
      assertOrThrow(name && VALID_EVENT_TYPES.has(type) && isIsoDate(startDate) && isIsoDate(endDate) && endDate >= startDate, 400, 'VALIDATION_ERROR', 'Invalid event update');
      const result = req.body?.result === undefined ? existing.result : validateResult(req.body.result);
      const medal = req.body?.medal === undefined ? existing.medal : req.body.medal;
      assertOrThrow(VALID_MEDALS.has(medal), 400, 'VALIDATION_ERROR', 'medal is invalid');
      const venue = req.body?.venue || {};
      await getDb().run(
        `UPDATE events SET name = ?, type = ?, start_date = ?, end_date = ?, timezone = ?, venue_name = ?,
         location_city = ?, location_region = ?, location_country = ?, result = ?, placement = ?, medal = ?,
         hidden = ?, updated_at = ? WHERE id = ?`,
        name,
        type,
        startDate,
        endDate,
        req.body?.timezone || existing.timezone,
        req.body?.venue === undefined ? existing.venue_name : trimOrNull(venue.name),
        req.body?.venue === undefined ? existing.location_city : trimOrNull(venue.city),
        req.body?.venue === undefined ? existing.location_region : trimOrNull(venue.region),
        req.body?.venue === undefined ? existing.location_country : trimOrNull(venue.country),
        result,
        req.body?.placement === undefined ? existing.placement : trimOrNull(req.body.placement),
        medal,
        typeof req.body?.hidden === 'boolean' ? (req.body.hidden ? 1 : 0) : existing.hidden,
        nowIso(),
        req.params.id
      );
      await replaceEventRelations(getDb(), req.params.id, req.body);
    });
    res.json(await eventOutput(getDb(), await loadEventRow(getDb(), req.params.id), true));
  }));

  app.delete('/api/events/:id', requireAuth, asyncRoute(async (req, res) => {
    assertOrThrow(req.body?.confirm === true, 400, 'VALIDATION_ERROR', 'confirm must be true');
    const row = await loadEventRow(getDb(), req.params.id);
    if (!row) return sendError(res, 404, 'NOT_FOUND', 'Event not found');
    const files = await getDb().all('SELECT local_path FROM clips WHERE event_id = ? AND local_path IS NOT NULL', req.params.id);
    await withTransaction(getDb(), () => getDb().run('DELETE FROM events WHERE id = ?', req.params.id));
    await Promise.allSettled(files.map((file) => deleteUploadedFile(file)));
    res.status(204).end();
  }));

  app.get('/api/events/:id/moments', requireAuth, asyncRoute(async (req, res) => {
    const row = await loadEventRow(getDb(), req.params.id);
    const includeHidden = ['1', 'true'].includes(String(req.query.include_hidden || '').toLowerCase());
    if (!row || (!includeHidden && row.hidden)) return sendError(res, 404, 'NOT_FOUND', 'Event not found');
    const moments = await getDb().all(
      `SELECT m.*, e.name AS event_name, e.start_date AS event_start_date, e.end_date AS event_end_date, e.sport_id, s.label AS sport_label
       FROM moments m JOIN events e ON e.id = m.event_id JOIN sports s ON s.id = e.sport_id
       WHERE m.event_id = ? ${includeHidden ? '' : 'AND m.hidden = 0'} ORDER BY m.sort_order ASC, m.occurred_date ASC, m.id ASC`,
      req.params.id
    );
    res.json({ items: await Promise.all(moments.map((moment) => momentOutput(getDb(), moment, includeHidden))), next_cursor: null });
  }));

  app.post('/api/events/:id/moments', requireAuth, asyncRoute(async (req, res) => {
    const id = await createMoment(getDb(), req.params.id, req.body || {});
    res.status(201).json(id);
  }));

  app.get('/api/moments/:id', requireAuth, asyncRoute(async (req, res) => {
    const row = await loadMomentRow(getDb(), req.params.id);
    const includeHidden = ['1', 'true'].includes(String(req.query.include_hidden || '').toLowerCase());
    if (!row || (!includeHidden && (row.hidden || row.event_hidden))) return sendError(res, 404, 'NOT_FOUND', 'Moment not found');
    res.json(await momentOutput(getDb(), row, includeHidden));
  }));

  app.post('/api/moments', requireAuth, asyncRoute(async (req, res) => {
    const id = await createMoment(getDb(), req.body?.event_id, req.body || {});
    res.status(201).json(id);
  }));

  app.patch('/api/moments/:id', requireAuth, asyncRoute(async (req, res) => {
    const existing = await loadMomentRow(getDb(), req.params.id);
    if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Moment not found');
    await withTransaction(getDb(), async () => {
      const title = req.body?.title === undefined ? existing.title : trimOrNull(req.body.title);
      const occurredDate = req.body?.occurred_date === undefined ? existing.occurred_date : trimOrNull(req.body.occurred_date);
      assertOrThrow(title && isIsoDate(occurredDate) && occurredDate >= existing.event_start_date && occurredDate <= existing.event_end_date, 400, 'VALIDATION_ERROR', 'Invalid moment update');
      const pack = validateSportPack(existing.sport_id, req.body?.sport_pack === undefined ? existing.sport_pack : req.body.sport_pack, req.body?.sport_data === undefined ? parseJson(existing.sport_data_json) : req.body.sport_data);
      const scoreFor = req.body?.score_for === undefined ? existing.score_for : (req.body.score_for === null || req.body.score_for === '' ? null : Number(req.body.score_for));
      const scoreAgainst = req.body?.score_against === undefined ? existing.score_against : (req.body.score_against === null || req.body.score_against === '' ? null : Number(req.body.score_against));
      const result = req.body?.result === undefined ? existing.result : validateResult(req.body.result);
      await getDb().run(
        `UPDATE moments SET title = ?, occurred_date = ?, result = ?, score_for = ?, score_against = ?, score_text = ?,
         opponent_name = ?, opponent_team_name = ?, round_label = ?, period_label = ?, bout_number = ?, sport_pack = ?,
         sport_data_json = ?, hidden = ?, updated_at = ? WHERE id = ?`,
        title,
        occurredDate,
        result,
        scoreFor,
        scoreAgainst,
        req.body?.score_text === undefined ? existing.score_text : trimOrNull(req.body.score_text),
        req.body?.opponent_name === undefined ? existing.opponent_name : trimOrNull(req.body.opponent_name),
        req.body?.opponent_team_name === undefined ? existing.opponent_team_name : trimOrNull(req.body.opponent_team_name),
        req.body?.round_label === undefined ? existing.round_label : trimOrNull(req.body.round_label),
        req.body?.period_label === undefined ? existing.period_label : trimOrNull(req.body.period_label),
        req.body?.bout_number === undefined ? existing.bout_number : Number(req.body.bout_number),
        pack.sportPack,
        pack.sportData ? JSON.stringify(pack.sportData) : null,
        typeof req.body?.hidden === 'boolean' ? (req.body.hidden ? 1 : 0) : existing.hidden,
        nowIso(),
        req.params.id
      );
      await replaceMomentRelations(getDb(), req.params.id, req.body);
    });
    res.json(await momentOutput(getDb(), await loadMomentRow(getDb(), req.params.id), true));
  }));

  app.delete('/api/moments/:id', requireAuth, asyncRoute(async (req, res) => {
    assertOrThrow(req.body?.confirm === true, 400, 'VALIDATION_ERROR', 'confirm must be true');
    if (!await loadMomentRow(getDb(), req.params.id)) return sendError(res, 404, 'NOT_FOUND', 'Moment not found');
    const files = await getDb().all('SELECT local_path FROM clips WHERE moment_id = ? AND local_path IS NOT NULL', req.params.id);
    await withTransaction(getDb(), () => getDb().run('DELETE FROM moments WHERE id = ?', req.params.id));
    await Promise.allSettled(files.map((file) => deleteUploadedFile(file)));
    res.status(204).end();
  }));

  const clipRoute = (target) => asyncRoute(async (req, res) => {
    const eventId = target === 'event' ? req.params.id : (await loadMomentRow(getDb(), req.params.id))?.event_id;
    const momentId = target === 'moment' ? req.params.id : null;
    if (!eventId) {
      await deleteUploadedFile(req.file);
      return sendError(res, 404, 'NOT_FOUND', 'Target not found');
    }
    const clip = await createClip(getDb(), eventId, req.body || {}, req.file, youtubeMode, maxUploadStorageMb, uploadDir, momentId);
    res.status(201).json(clip);
  });

  app.post('/api/events/:id/clips', requireAuth, upload.single('file'), clipRoute('event'));
  app.post('/api/moments/:id/clips', requireAuth, upload.single('file'), clipRoute('moment'));

  app.get('/api/clips/:id', requireAuth, asyncRoute(async (req, res) => {
    const row = await loadClipById(getDb(), req.params.id);
    const includeHidden = ['1', 'true'].includes(String(req.query.include_hidden || '').toLowerCase());
    if (!row || (!includeHidden && (row.hidden || row.event_hidden || row.moment_hidden))) return sendError(res, 404, 'NOT_FOUND', 'Clip not found');
    res.json({ ...toPublicClip(row), tags: await loadTags(getDb(), 'clip_tags', 'clip_id', row.id), notes: await loadNotes(getDb(), 'clip_id', row.id) });
  }));

  app.patch('/api/clips/:id', requireAuth, asyncRoute(async (req, res) => {
    const row = await loadClipById(getDb(), req.params.id);
    if (!row) return sendError(res, 404, 'NOT_FOUND', 'Clip not found');
    const title = req.body?.title === undefined ? row.title : trimOrNull(req.body.title);
    assertOrThrow(title, 400, 'VALIDATION_ERROR', 'Clip title is required');
    await withTransaction(getDb(), async () => {
      await getDb().run('UPDATE clips SET title = ?, hidden = ?, updated_at = ? WHERE id = ?', title, typeof req.body?.hidden === 'boolean' ? (req.body.hidden ? 1 : 0) : row.hidden, nowIso(), req.params.id);
      if (req.body?.tags !== undefined) {
        await getDb().run('DELETE FROM clip_tags WHERE clip_id = ?', req.params.id);
        await addTags(getDb(), 'clip_tags', 'clip_id', req.params.id, validateTags(req.body.tags));
      }
      if (req.body?.notes !== undefined) {
        const notes = validateNotes(req.body.notes);
        await getDb().run('DELETE FROM notes WHERE clip_id = ?', req.params.id);
        if (notes) for (const note of notes) await addNote(getDb(), 'clip_id', req.params.id, note);
      }
    });
    const updated = await loadClipById(getDb(), req.params.id);
    res.json({ ...toPublicClip(updated), tags: await loadTags(getDb(), 'clip_tags', 'clip_id', updated.id), notes: await loadNotes(getDb(), 'clip_id', updated.id) });
  }));

  app.delete('/api/clips/:id', requireAuth, asyncRoute(async (req, res) => {
    assertOrThrow(req.body?.confirm === true, 400, 'VALIDATION_ERROR', 'confirm must be true');
    const row = await loadClipById(getDb(), req.params.id);
    if (!row) return sendError(res, 404, 'NOT_FOUND', 'Clip not found');
    await withTransaction(getDb(), () => getDb().run('DELETE FROM clips WHERE id = ?', req.params.id));
    await deleteUploadedFile(row);
    res.status(204).end();
  }));

  app.post('/api/capture', requireAuth, upload.single('file'), asyncRoute(async (req, res) => {
    let eventId;
    let momentId;
    let file = req.file;
    try {
      const eventPayload = parseJson(req.body?.event, req.body?.event || {});
      const momentPayload = parseJson(req.body?.moment, req.body?.moment || {});
      const clipPayload = parseJson(req.body?.clip, req.body?.clip || {});
      await withTransaction(getDb(), async () => {
        eventId = eventPayload.event_id || await insertEventGraph(getDb(), eventPayload);
        const event = await loadEventRow(getDb(), eventId);
        momentId = momentPayload.moment_id || await insertMomentGraph(getDb(), event, momentPayload);
        const prepared = await prepareClipPayload({ body: { ...clipPayload, source_type: clipPayload.source_type || (file ? 'upload' : 'link') }, file, youtubeMode, defaultTitle: momentPayload.title || event.name });
        await assertUploadQuota(file, maxUploadStorageMb, uploadDir);
        await insertClipGraph(getDb(), event, prepared, null, momentId);
      });
      res.status(201).json({
        event: await eventOutput(getDb(), await loadEventRow(getDb(), eventId), true),
        moment: await momentOutput(getDb(), await loadMomentRow(getDb(), momentId), true),
        clip: (await loadClipRows(getDb(), 'c.moment_id', momentId, true))[0],
      });
    } catch (error) {
      await deleteUploadedFile(file);
      throw error;
    }
  }));

  app.get('/api/videos', requireAuthCompat, asyncRoute(async (req, res) => {
    const clauses = ['a.family_id = ?'];
    const params = [FAMILY_ID];
    const includeHidden = ['true', '1'].includes(String(req.query.includeHidden || '').toLowerCase());
    if (req.query.childId) { clauses.push('v.child_id = ?'); params.push(req.query.childId); }
    if (req.query.sport && req.query.sport !== 'All sports') { clauses.push('v.sport = ?'); params.push(req.query.sport); }
    const rows = await getDb().all(`SELECT v.* FROM videos v JOIN athletes a ON a.id = v.child_id WHERE ${clauses.join(' AND ')} ORDER BY v.event_date DESC, v.created_at DESC, v.id DESC`, ...params);
    const videos = await Promise.all(rows.map((row) => toCompatVideo(getDb(), row)));
    res.json(includeHidden ? videos : videos.filter((video) => !video.hidden));
  }));

  app.post('/api/videos', requireAuthCompat, upload.single('file'), asyncRoute(async (req, res) => {
    try {
      const row = await createCompatVideo(getDb(), req, youtubeMode, maxUploadStorageMb, uploadDir);
      res.status(201).json(row);
    } catch (error) {
      await deleteUploadedFile(req.file);
      if (error instanceof multer.MulterError) throw error;
      if (error.httpStatus) return sendCompatError(res, error.httpStatus === 415 ? 400 : error.httpStatus, error.message);
      throw error;
    }
  }));

  app.patch('/api/videos/:id', requireAuthCompat, asyncRoute(async (req, res) => {
    const existing = await getDb().get('SELECT v.* FROM videos v JOIN athletes a ON a.id = v.child_id WHERE v.id = ? AND a.family_id = ?', req.params.id, FAMILY_ID);
    if (!existing) return sendCompatError(res, 404, 'Video not found');
    const title = req.body?.title === undefined ? existing.title : trimOrNull(req.body.title);
    const date = req.body?.event_date === undefined ? existing.event_date : trimOrNull(req.body.event_date);
    if (!title) return sendCompatError(res, 400, 'Title is required');
    if (!isIsoDate(date)) return sendCompatError(res, 400, 'Event date must be YYYY-MM-DD');
    const nextSport = req.body?.sport === undefined ? existing.sport : trimOrNull(req.body.sport);
    const nextSportRow = nextSport ? await getDb().get('SELECT id, label FROM sports WHERE lower(label) = lower(?)', nextSport) : null;
    if (nextSport && !nextSportRow) return sendCompatError(res, 400, 'Unsupported sport');
    const map = await getDb().get('SELECT event_id, moment_id, clip_id FROM legacy_video_map WHERE legacy_video_id = ?', req.params.id);
    const nextEventName = req.body?.event_name === undefined ? existing.event_name : trimOrNull(req.body.event_name);
    const nextNotes = req.body?.notes === undefined ? existing.notes : trimOrNull(req.body.notes);
    const nextTags = toTagArray(req.body?.tags === undefined ? existing.tags : req.body.tags);
    const nextHidden = typeof req.body?.hidden === 'boolean' ? (req.body.hidden ? 1 : 0) : existing.hidden;
    if (map && nextSportRow) {
      const canonicalSport = await getDb().get('SELECT sport_id FROM events WHERE id = ? AND family_id = ?', map.event_id, FAMILY_ID);
      if (canonicalSport && canonicalSport.sport_id !== nextSportRow.id) return sendCompatError(res, 409, 'Event sport is immutable after creation');
    }
    await withTransaction(getDb(), async () => {
      await getDb().run(
        `UPDATE videos SET title = ?, notes = ?, event_name = ?, event_date = ?, tags = ?, hidden = ?, sport = ?, updated_at = ? WHERE id = ?`,
        title,
        nextNotes,
        nextEventName,
        date,
        JSON.stringify(nextTags),
        nextHidden,
        nextSportRow?.label || nextSport,
        nowIso(),
        req.params.id
      );
      if (map) {
        await getDb().run('UPDATE events SET name = ?, updated_at = ? WHERE id = ? AND family_id = ?', nextEventName, nowIso(), map.event_id, FAMILY_ID);
        await getDb().run('UPDATE moments SET title = ?, occurred_date = ?, hidden = ?, updated_at = ? WHERE id = ?', title, date, nextHidden, nowIso(), map.moment_id);
        await getDb().run('UPDATE clips SET title = ?, hidden = ?, updated_at = ? WHERE id = ?', title, nextHidden, nowIso(), map.clip_id);
        await getDb().run('DELETE FROM moment_tags WHERE moment_id = ?', map.moment_id);
        await getDb().run('DELETE FROM clip_tags WHERE clip_id = ?', map.clip_id);
        await addTags(getDb(), 'moment_tags', 'moment_id', map.moment_id, nextTags);
        await addTags(getDb(), 'clip_tags', 'clip_id', map.clip_id, nextTags);
        await getDb().run('DELETE FROM notes WHERE moment_id = ?', map.moment_id);
        if (nextNotes) await addNote(getDb(), 'moment_id', map.moment_id, { kind: 'summary', body: nextNotes });
      }
    });
    res.json(await toCompatVideo(getDb(), await getDb().get('SELECT * FROM videos WHERE id = ?', req.params.id)));
  }));

  app.use('/uploads', requireAuthCompat, express.static(uploadDir));
  const publicPath = path.resolve(process.cwd(), 'public');
  const resolvePublicFile = (name) => {
    const fromDist = path.join(distPath, name);
    if (fs.existsSync(fromDist)) return fromDist;
    return path.join(publicPath, name);
  };
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
      if (error.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'UPLOAD_TOO_LARGE', `Upload exceeds ${maxUploadMb}MB limit`);
      return sendError(res, 400, 'VALIDATION_ERROR', 'Upload could not be processed');
    }
    if (error.httpStatus) return sendError(res, error.httpStatus, error.code || 'INTERNAL_ERROR', error.message, error.fields);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unexpected server error');
  });
  return app;
};

export const start = async ({ port = DEFAULT_PORT } = {}) => {
  const db = await initDb();
  const app = createApp({ db });
  const server = app.listen(port, () => console.log(`sport-video running on port ${port}`));
  return { app, db, server };
};

if (path.resolve(process.argv[1] || '') === MODULE_PATH) {
  start().catch((error) => {
    console.error('sport-video failed to start', error.message);
    process.exitCode = 1;
  });
}
