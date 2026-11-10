import { test, beforeEach, afterEach } from 'node:test';
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

const json = async (response) => {
  const body = await response.json();
  return { response, body };
};

test('production rejects missing or placeholder session secrets', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => createApp({ sessionSecret: '' }),
      /SESSION_SECRET must be configured in production/
    );
    assert.throws(
      () => createApp({ sessionSecret: 'change-me-in-production' }),
      /SESSION_SECRET must be configured in production/
    );
    assert.throws(
      () => createApp({ sessionSecret: '   ' }),
      /SESSION_SECRET must be configured in production/
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sport-video-api-'));
  db = await initDb(path.join(tempDir, 'catalog.db'));
  const rawHash = await bcrypt.hash('2468', 4);
  const app = createApp({
    db,
    familyPinHash: rawHash.split('$').join('$$'),
    sessionSecret: 'test-session-secret',
    uploadDir: path.join(tempDir, 'uploads'),
    distPath: path.join(tempDir, 'dist'),
    maxUploadStorageMb: 0.00003,
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

test('auth gates the catalog and lock destroys the session', async () => {
  let result = await json(await request('/api/me'));
  assert.deepEqual(result.body, { authenticated: false });

  result = await json(await request('/api/children'));
  assert.equal(result.response.status, 401);

  result = await json(await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  }));
  assert.equal(result.response.status, 200);
  cookie = result.response.headers.get('set-cookie').split(';')[0];

  result = await json(await request('/api/children'));
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.map(({ id, clip_count }) => ({ id, clip_count })), [
    { id: 'child_1', clip_count: 2 },
    { id: 'child_2', clip_count: 1 },
    { id: 'ath_demo_tkd', clip_count: 3 },
  ]);

  result = await json(await request('/api/auth/lock', { method: 'POST' }));
  assert.equal(result.response.status, 200);
  cookie = '';

  result = await json(await request('/api/me'));
  assert.deepEqual(result.body, { authenticated: false });
});

test('production HTTP unlock establishes a session for direct LAN access', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTrustProxy = process.env.TRUST_PROXY;
  const productionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sport-video-production-auth-'));
  let productionDb;
  let productionServer;
  process.env.NODE_ENV = 'production';
  process.env.TRUST_PROXY = '127.0.0.1/32';
  try {
    productionDb = await initDb(path.join(productionDir, 'catalog.db'));
    const rawHash = await bcrypt.hash('2468', 4);
    const app = createApp({
      db: productionDb,
      familyPinHash: rawHash,
      sessionSecret: 'production-test-session',
      uploadDir: path.join(productionDir, 'uploads'),
      distPath: path.join(productionDir, 'dist'),
    });
    assert.equal(app.get('trust proxy'), '127.0.0.1/32');
    productionServer = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const productionBaseUrl = `http://127.0.0.1:${productionServer.address().port}`;
    const unlockResponse = await fetch(`${productionBaseUrl}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '2468' }),
    });
    assert.equal(unlockResponse.status, 200);
    const setCookie = unlockResponse.headers.get('set-cookie');
    assert.ok(setCookie, 'successful production unlock must set a session cookie over HTTP');
    assert.doesNotMatch(setCookie, /; Secure(?:;|$)/i);
    const productionCookie = setCookie.split(';')[0];
    const requestWithSession = (pathname) => fetch(`${productionBaseUrl}${pathname}`, {
      headers: { Cookie: productionCookie },
    });

    const meResponse = await requestWithSession('/api/me');
    assert.deepEqual(await meResponse.json(), { authenticated: true });
    assert.equal((await requestWithSession('/api/athletes')).status, 200);
    assert.equal((await requestWithSession('/api/sports')).status, 200);

    const forwardedUnlockResponse = await fetch(`${productionBaseUrl}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ pin: '2468' }),
    });
    assert.equal(forwardedUnlockResponse.status, 200);
    assert.match(forwardedUnlockResponse.headers.get('set-cookie') || '', /; Secure(?:;|$)/i);
  } finally {
    if (productionServer) {
      await new Promise((resolve, reject) => productionServer.close((error) => (error ? reject(error) : resolve())));
    }
    if (productionDb) await productionDb.close();
    await fs.rm(productionDir, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrustProxy;
  }
});

test('direct clients cannot forge a trusted HTTPS forwarded header', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const tempTrustProxyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sport-video-trust-proxy-'));
  let trustProxyServer;
  process.env.NODE_ENV = 'production';
  try {
    const app = createApp({
      familyPinHash: await bcrypt.hash('2468', 4),
      sessionSecret: 'trust-proxy-test-session',
      trustProxy: '192.0.2.10/32',
      uploadDir: path.join(tempTrustProxyDir, 'uploads'),
      distPath: path.join(tempTrustProxyDir, 'dist'),
    });
    trustProxyServer = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const trustProxyBaseUrl = `http://127.0.0.1:${trustProxyServer.address().port}`;
    const unlockResponse = await fetch(`${trustProxyBaseUrl}/api/auth/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ pin: '2468' }),
    });
    assert.equal(unlockResponse.status, 200);
    const setCookie = unlockResponse.headers.get('set-cookie');
    assert.ok(setCookie, 'direct HTTP unlock must still set a session cookie');
    assert.doesNotMatch(setCookie, /; Secure(?:;|$)/i);
    const sessionCookie = setCookie.split(';')[0];
    const meResponse = await fetch(`${trustProxyBaseUrl}/api/me`, { headers: { Cookie: sessionCookie } });
    assert.deepEqual(await meResponse.json(), { authenticated: true });
  } finally {
    if (trustProxyServer) {
      await new Promise((resolve, reject) => trustProxyServer.close((error) => (error ? reject(error) : resolve())));
    }
    await fs.rm(tempTrustProxyDir, { recursive: true, force: true });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('link creation persists catalog fields and refreshes through the API', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const form = new FormData();
  form.set('child_id', 'child_1');
  form.set('sport', 'Soccer');
  form.set('event_name', 'QA match');
  form.set('event_date', '2026-08-07');
  form.set('title', 'QA link highlight');
  form.set('notes', 'Saved from the regression test');
  form.set('tags', 'QA, Highlight');
  form.set('source_type', 'link');
  form.set('external_url', 'https://www.youtube.com/watch?v=QA_LINK_987');

  let result = await json(await request('/api/videos', { method: 'POST', body: form }));
  assert.equal(result.response.status, 201);
  assert.equal(result.body.child_id, 'child_1');
  assert.equal(result.body.event_name, 'QA match');
  assert.deepEqual(result.body.tags, ['QA', 'Highlight']);
  assert.equal(result.body.external_url, 'https://www.youtube.com/watch?v=QA_LINK_987');

  result = await json(await request('/api/videos?childId=child_1&includeHidden=true'));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.some((video) => video.title === 'QA link highlight'), true);

  result = await json(await request('/api/sports'));
  assert.deepEqual(result.body.map(({ label }) => label), ['Soccer', 'Basketball', 'Baseball', 'Swim', 'Taekwondo']);

  result = await json(await request('/api/videos?childId=child_2&sport=Basketball&includeHidden=true'));
  assert.deepEqual(result.body.map(({ id }) => id), ['vid_3']);

  result = await json(await request('/api/videos?childId=child_2&sport=Soccer&includeHidden=true'));
  assert.deepEqual(result.body, []);
});

test('upload creation returns an honest mock status and is selectable as a file upload', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const form = new FormData();
  form.set('child_id', 'child_2');
  form.set('sport', 'Basketball');
  form.set('event_name', 'Practice');
  form.set('event_date', '2026-08-07');
  form.set('title', 'Phone upload');
  form.set('source_type', 'upload');
  form.set('tags', 'Practice');
  form.set('file', new Blob(['fake video bytes'], { type: 'video/mp4' }), 'phone-upload.mp4');

  const result = await json(await request('/api/videos', { method: 'POST', body: form }));
  assert.equal(result.response.status, 201);
  assert.equal(result.body.publish_status, 'mock');
  assert.match(result.body.youtube_url, /^https:\/\/youtube\.com\/watch\?v=mock_/);
  assert.equal(result.body.source_type, 'upload');
  assert.equal(result.body.external_url, null);
});

test('video responses redact local paths and reject invalid sports or upload types', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  let result = await json(await request('/api/videos?includeHidden=true'));
  assert.equal('local_path' in result.body[0], false);

  const invalidUpload = new FormData();
  invalidUpload.set('child_id', 'child_1');
  invalidUpload.set('sport', 'Soccer');
  invalidUpload.set('event_date', '2026-08-07');
  invalidUpload.set('title', 'Not a video');
  invalidUpload.set('source_type', 'upload');
  invalidUpload.set('file', new Blob(['plain text'], { type: 'text/plain' }), 'not-a-video.txt');

  result = await json(await request('/api/videos', { method: 'POST', body: invalidUpload }));
  assert.equal(result.response.status, 400);
  assert.deepEqual(await fs.readdir(path.join(tempDir, 'uploads')), []);

  const invalidSport = new FormData();
  invalidSport.set('child_id', 'child_1');
  invalidSport.set('sport', 'Futsal');
  invalidSport.set('event_date', '2026-08-07');
  invalidSport.set('title', 'Unlisted sport');
  invalidSport.set('source_type', 'link');
  invalidSport.set('external_url', 'https://example.com/video');

  result = await json(await request('/api/videos', { method: 'POST', body: invalidSport }));
  assert.equal(result.response.status, 400);

  result = await json(await request('/api/videos/vid_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sport: 'Futsal' }),
  }));
  assert.equal(result.response.status, 400);
});

test('child creation rejects sports that are not in the catalog', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const result = await json(await request('/api/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Avery', sport: 'Futsal' }),
  }));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'Unsupported sport');
});

test('compatibility child creation populates canonical athlete sport relationships', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const created = await json(await request('/api/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Avery Soccer',
      sport: 'Soccer',
      team: 'QA Comets',
      color: '#123456',
    }),
  }));
  assert.equal(created.response.status, 201);

  const filtered = await json(await request('/api/athletes?sport_id=soccer'));
  assert.equal(filtered.response.status, 200);
  const saved = filtered.body.items.find(({ id }) => id === created.body.id);
  assert.ok(saved);
  assert.deepEqual(saved.sports.map(({ id, is_primary, team_name }) => ({ id, is_primary, team_name })), [
    { id: 'soccer', is_primary: 1, team_name: 'QA Comets' },
  ]);
});

test('legacy video compatibility routes remain scoped to the authenticated family', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];
  await db.run('UPDATE athletes SET family_id = ? WHERE id = ?', 'other_family', 'child_1');

  let result = await json(await request('/api/videos?includeHidden=true'));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.some(({ id }) => id === 'vid_1'), false);

  result = await json(await request('/api/videos/vid_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Should not update' }),
  }));
  assert.equal(result.response.status, 404);
});

test('link requests carrying a multipart file are rejected and cleaned up', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const malformedLink = new FormData();
  malformedLink.set('child_id', 'child_1');
  malformedLink.set('sport', 'Soccer');
  malformedLink.set('event_date', '2026-08-08');
  malformedLink.set('title', 'Link with stray file');
  malformedLink.set('source_type', 'link');
  malformedLink.set('external_url', 'https://www.youtube.com/watch?v=stray_file');
  malformedLink.set('file', new Blob(['stray file'], { type: 'video/mp4' }), 'stray.mp4');

  const result = await json(await request('/api/videos', { method: 'POST', body: malformedLink }));
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /file/i);
  assert.deepEqual(await fs.readdir(path.join(tempDir, 'uploads')), []);
});

test('canonical upload routes clean files for invalid targets and capture quota failures', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const invalidTarget = new FormData();
  invalidTarget.set('metadata', JSON.stringify({ source_type: 'upload', title: 'Orphan check' }));
  invalidTarget.set('file', new Blob(['orphan bytes'], { type: 'video/mp4' }), 'orphan.mp4');
  let result = await json(await request('/api/moments/missing-moment/clips', { method: 'POST', body: invalidTarget }));
  assert.equal(result.response.status, 404);
  assert.deepEqual(await fs.readdir(path.join(tempDir, 'uploads')), []);

  const capture = new FormData();
  capture.set('event', JSON.stringify({
    name: 'Quota capture',
    type: 'game',
    sport_id: 'soccer',
    start_date: '2026-08-08',
    end_date: '2026-08-08',
    participants: [{ athlete_id: 'child_1' }],
  }));
  capture.set('moment', JSON.stringify({
    kind: 'game',
    title: 'Quota moment',
    occurred_date: '2026-08-08',
    athlete_ids: ['child_1'],
  }));
  capture.set('clip', JSON.stringify({ source_type: 'upload', title: 'Quota clip' }));
  capture.set('file', new Blob(['capture bytes that exceed the tiny test quota'], { type: 'video/mp4' }), 'capture.mp4');
  result = await json(await request('/api/capture', { method: 'POST', body: capture }));
  assert.equal(result.response.status, 413);
  assert.deepEqual(await fs.readdir(path.join(tempDir, 'uploads')), []);
});

test('deleting a canonical event removes its private uploaded files', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  let result = await json(await request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cleanup event',
      type: 'game',
      sport_id: 'soccer',
      start_date: '2026-08-08',
      end_date: '2026-08-08',
      participants: [{ athlete_id: 'child_1' }],
    }),
  }));
  assert.equal(result.response.status, 201);
  const eventId = result.body.id;

  const upload = new FormData();
  upload.set('metadata', JSON.stringify({ source_type: 'upload', title: 'Cleanup clip' }));
  upload.set('file', new Blob(['tiny'], { type: 'video/mp4' }), 'cleanup.mp4');
  result = await json(await request(`/api/events/${eventId}/clips`, { method: 'POST', body: upload }));
  assert.equal(result.response.status, 201);
  assert.equal((await fs.readdir(path.join(tempDir, 'uploads'))).length, 1);

  result = await request(`/api/events/${eventId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(result.status, 204);
  assert.deepEqual(await fs.readdir(path.join(tempDir, 'uploads')), []);
});

test('video editing and hide state persist while hidden filtering remains explicit', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  let result = await json(await request('/api/videos?childId=child_1&includeHidden=true'));
  const video = result.body.find(({ id }) => id === 'vid_1');
  assert.ok(video);

  result = await json(await request(`/api/videos/${video.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Edited highlight',
      event_name: 'Edited match',
      notes: 'Updated notes',
      event_date: '2026-08-08',
      tags: ['Edited'],
      hidden: true,
      sport: 'Soccer',
    }),
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.title, 'Edited highlight');
  assert.equal(result.body.hidden, 1);

  result = await json(await request('/api/videos?childId=child_1'));
  assert.equal(result.body.some(({ id }) => id === video.id), false);

  result = await json(await request('/api/videos?childId=child_1&includeHidden=true'));
  assert.equal(result.body.find(({ id }) => id === video.id).title, 'Edited highlight');

  result = await json(await request('/api/timeline?athlete_id=child_1&sport_id=soccer&include_hidden=true'));
  const editedEvent = result.body.items.find(({ moments }) => moments.some(({ title }) => title === 'Edited highlight'));
  assert.ok(editedEvent);
  assert.equal(editedEvent.event.name, 'Edited match');
  assert.equal(editedEvent.moments[0].title, 'Edited highlight');
  assert.equal(editedEvent.moments[0].occurred_date, '2026-08-08');
});

test('aggregate upload storage quota rejects new files without leaving an orphan', async () => {
  const unlock = await request('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  });
  cookie = unlock.headers.get('set-cookie').split(';')[0];

  const makeUpload = (title) => {
    const form = new FormData();
    form.set('child_id', 'child_2');
    form.set('sport', 'Basketball');
    form.set('event_date', '2026-08-08');
    form.set('title', title);
    form.set('source_type', 'upload');
    form.set('file', new Blob(['sixteen-byte-file'], { type: 'video/mp4' }), `${title}.mp4`);
    return form;
  };

  let result = await json(await request('/api/videos', { method: 'POST', body: makeUpload('First bounded upload') }));
  assert.equal(result.response.status, 201);

  result = await json(await request('/api/videos', { method: 'POST', body: makeUpload('Second bounded upload') }));
  assert.equal(result.response.status, 413);
  assert.match(result.body.error, /storage quota/i);
  assert.equal((await fs.readdir(path.join(tempDir, 'uploads'))).length, 1);
});
