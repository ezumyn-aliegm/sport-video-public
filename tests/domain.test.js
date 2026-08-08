import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { initDb } from '../server/db.js';
import { createApp } from '../server/index.js';

let tempDir;
let server;
let baseUrl;
let cookie;
let db;

const request = (pathname, options = {}) => fetch(`${baseUrl}${pathname}`, {
  ...options,
  headers: {
    ...(options.headers || {}),
    ...(cookie ? { Cookie: cookie } : {}),
  },
});

const json = async (response) => ({ response, body: await response.json() });

const unlock = async () => {
  const response = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
};

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sport-video-domain-'));
  db = await initDb(path.join(tempDir, 'catalog.db'), { seedDemo: true });
  const rawHash = await bcrypt.hash('2468', 4);
  const app = createApp({
    db,
    familyPinHash: rawHash.split('$').join('$$'),
    sessionSecret: 'domain-test-session',
    uploadDir: path.join(tempDir, 'uploads'),
    distPath: path.join(tempDir, 'dist'),
  });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  cookie = '';
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('migration exposes an API-backed multi-sport tournament timeline with ordered TKD moments', async () => {
  await unlock();

  const result = await json(await request('/api/timeline?sport_id=taekwondo'));
  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body.items));

  const tournament = result.body.items.find(({ event }) => event.id === 'evt_demo_tkd_open_2026');
  assert.ok(tournament);
  assert.equal(tournament.event.type, 'tournament');
  assert.equal(tournament.event.medal, 'silver');
  assert.equal(tournament.event.participants[0].name, 'Maya');
  assert.deepEqual(tournament.event.tags, ['Taekwondo', 'Silver', 'Tournament']);
  assert.equal(tournament.event.clip_count, 3);
  assert.equal(tournament.event_clip_count, 1);
  assert.deepEqual(tournament.moments.map(({ title }) => title), [
    'Preliminary - Fight 1',
    'Quarterfinal - Fight 2',
    'Final - Fight 3',
  ]);
  assert.equal(tournament.moments[1].sport_pack, 'tkd.v1');
  assert.equal(tournament.moments[1].sport_data.format, 'sparring');

  const detail = await json(await request('/api/events/evt_demo_tkd_open_2026'));
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.moments.length, 3);
  assert.equal(detail.body.clips.filter(({ attachment_level }) => attachment_level === 'event').length, 1);
  assert.ok(detail.body.moments.every(({ clips }) => clips.every((clip) => clip.event_id === detail.body.id)));
});

test('event collection route returns newest event summaries using the same filters', async () => {
  await unlock();
  const result = await json(await request('/api/events?sport_id=taekwondo'));
  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.body.items));
  assert.equal(result.body.items[0].id, 'evt_demo_tkd_open_2026');
  assert.equal(result.body.items[0].sport.id, 'taekwondo');
});

test('event-first creation persists participants, notes, tags, moment fields, and moment-level clips', async () => {
  await unlock();

  const event = await json(await request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Spring Invitational',
      type: 'game',
      sport_id: 'soccer',
      start_date: '2026-08-08',
      end_date: '2026-08-08',
      venue: { name: 'Oak Field', city: 'Albany' },
      participants: [{ athlete_id: 'child_1', result: 'win' }],
      notes: [{ kind: 'summary', body: 'A close family game.' }],
      tags: ['Spring', 'Family'],
    }),
  }));
  assert.equal(event.response.status, 201);
  const createdEventId = event.body.id;
  assert.equal(event.body.sport.id, 'soccer');
  assert.equal(event.body.notes[0].body, 'A close family game.');
  assert.deepEqual([...event.body.tags].sort(), ['Family', 'Spring']);

  const moment = await json(await request(`/api/events/${event.body.id}/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'game',
      title: 'Final whistle',
      occurred_date: '2026-08-08',
      result: 'win',
      score_for: 3,
      score_against: 1,
      opponent_name: 'Tigers',
      opponent_team_name: 'Tigers FC',
      period_label: '2nd half',
      athlete_ids: ['child_1'],
      notes: [{ kind: 'parent', body: 'Emma kept running until the end.' }],
      tags: ['Highlight'],
    }),
  }));
  assert.equal(moment.response.status, 201);
  assert.equal(moment.body.score.for, 3);
  assert.equal(moment.body.score.against, 1);
  assert.equal(moment.body.athletes[0].id, 'child_1');
  assert.equal(moment.body.sport_pack, null);

  const clip = await json(await request(`/api/moments/${moment.body.id}/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_type: 'link',
      title: 'Final whistle clip',
      external_url: 'https://www.youtube.com/watch?v=final_whistle',
      tags: ['Replay'],
    }),
  }));
  assert.equal(clip.response.status, 201);
  assert.equal(clip.body.attachment_level, 'moment');
  assert.equal(clip.body.event_id, event.body.id);
  assert.equal(clip.body.moment_id, moment.body.id);

  const timeline = await json(await request('/api/timeline?athlete_id=child_1&sport_id=soccer&tag=highlight'));
  assert.equal(timeline.response.status, 200);
  const saved = timeline.body.items.find(({ event: timelineEvent }) => timelineEvent.id === createdEventId);
  assert.ok(saved);
  assert.equal(saved.moments[0].title, 'Final whistle');
});

test('canonical routes reject TKD fields for team sports and preserve event-level clip ownership', async () => {
  await unlock();

  const event = await json(await request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Noah Hoops',
      type: 'game',
      sport_id: 'basketball',
      start_date: '2026-08-08',
      end_date: '2026-08-08',
      participants: [{ athlete_id: 'child_2' }],
    }),
  }));
  assert.equal(event.response.status, 201);

  let result = await json(await request(`/api/events/${event.body.id}/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'game',
      title: 'Quarter three run',
      occurred_date: '2026-08-08',
      athlete_ids: ['child_2'],
      sport_pack: 'tkd.v1',
      sport_data: { pack: 'tkd.v1', format: 'sparring' },
    }),
  }));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'VALIDATION_ERROR');

  result = await json(await request(`/api/events/${event.body.id}/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_type: 'link',
      title: 'Game day montage',
      external_url: 'https://example.com/game-montage',
    }),
  }));
  assert.equal(result.response.status, 201);
  assert.equal(result.body.attachment_level, 'event');
  assert.equal(result.body.moment_id, null);
  assert.equal(result.body.event_id, event.body.id);
});

test('migration is idempotent and canonical hidden state survives refresh', async () => {
  await unlock();
  const firstCount = await db.get('SELECT COUNT(*) AS count FROM legacy_video_map');
  assert.equal(firstCount.count, 3);
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await db.close();

  db = await initDb(path.join(tempDir, 'catalog.db'));
  const secondCount = await db.get('SELECT COUNT(*) AS count FROM legacy_video_map');
  assert.equal(secondCount.count, 3);

  const app = createApp({
    db,
    familyPinHash: (await bcrypt.hash('2468', 4)).split('$').join('$$'),
    sessionSecret: 'domain-test-session-2',
    uploadDir: path.join(tempDir, 'uploads'),
    distPath: path.join(tempDir, 'dist'),
  });
  await new Promise((resolve) => server = app.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  cookie = '';
  await unlock();

  const patch = await json(await request('/api/events/evt_demo_tkd_open_2026', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: true }),
  }));
  assert.equal(patch.response.status, 200);

  const hidden = await json(await request('/api/timeline?sport_id=taekwondo'));
  assert.equal(hidden.body.items.some(({ event }) => event.id === 'evt_demo_tkd_open_2026'), false);
  const visibleForOwner = await json(await request('/api/timeline?sport_id=taekwondo&include_hidden=true'));
  const saved = visibleForOwner.body.items.find(({ event }) => event.id === 'evt_demo_tkd_open_2026');
  assert.ok(saved);
  assert.equal(saved.event.hidden, true);
  assert.equal(saved.moments.length, 3);
});

test('explicit demo seeding is idempotent across service restarts', async () => {
  const databasePath = path.join(tempDir, 'catalog.db');
  await db.close();
  db = await initDb(databasePath, { seedDemo: true });
  const firstNotes = await db.get('SELECT COUNT(*) AS count FROM notes WHERE id = ?', 'note_demo_tkd_event');
  assert.equal(firstNotes.count, 1);
  await db.close();

  db = await initDb(databasePath, { seedDemo: true });
  const secondNotes = await db.get('SELECT COUNT(*) AS count FROM notes WHERE id = ?', 'note_demo_tkd_event');
  assert.equal(secondNotes.count, 1);
});

test('timeline tag filters normalize labels and support all-match queries', async () => {
  await unlock();

  const allTags = await json(await request('/api/timeline?tag=Silver,Tournament&tag_mode=all'));
  assert.equal(allTags.response.status, 200);
  assert.ok(allTags.body.items.some(({ event }) => event.id === 'evt_demo_tkd_open_2026'));

  const displayCase = await json(await request('/api/timeline?tag=sIlVeR'));
  assert.equal(displayCase.response.status, 200);
  assert.ok(displayCase.body.items.some(({ event }) => event.id === 'evt_demo_tkd_open_2026'));

  const eventCollection = await json(await request('/api/events?tag=sIlVeR'));
  assert.equal(eventCollection.response.status, 200);
  assert.ok(eventCollection.body.items.some(({ id }) => id === 'evt_demo_tkd_open_2026'));
});

test('hidden event parents conceal moments by default and report inherited visibility', async () => {
  await unlock();

  const patch = await json(await request('/api/events/evt_demo_tkd_open_2026', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: true }),
  }));
  assert.equal(patch.response.status, 200);

  const hidden = await json(await request('/api/moments/mom_demo_tkd_qf_2026'));
  assert.equal(hidden.response.status, 404);

  const ownerView = await json(await request('/api/moments/mom_demo_tkd_qf_2026?include_hidden=true'));
  assert.equal(ownerView.response.status, 200);
  assert.equal(ownerView.body.hidden_via_parent, true);
});

test('legacy backfill keeps clip visibility local and preserves practice semantics', async () => {
  const graph = await db.get(`
    SELECT e.hidden AS event_hidden, m.hidden AS moment_hidden, m.kind
    FROM legacy_video_map map
    JOIN events e ON e.id = map.event_id
    JOIN moments m ON m.id = map.moment_id
    WHERE map.legacy_video_id = ?`, 'vid_2');
  assert.equal(graph.event_hidden, 0);
  assert.equal(graph.moment_hidden, 1);
  assert.equal(graph.kind, 'drill');
});

test('serializes concurrent event writes on a shared SQLite connection', async () => {
  await unlock();

  const responses = await Promise.all(Array.from({ length: 5 }, (_, index) => request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Concurrent event ${index}`,
      type: 'game',
      sport_id: 'soccer',
      start_date: '2026-08-08',
      end_date: '2026-08-08',
      participants: [{ athlete_id: 'child_1' }],
    }),
  })));
  assert.deepEqual(responses.map(({ status }) => status), [201, 201, 201, 201, 201]);
});
