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
  ]);

  result = await json(await request('/api/auth/lock', { method: 'POST' }));
  assert.equal(result.response.status, 200);
  cookie = '';

  result = await json(await request('/api/me'));
  assert.deepEqual(result.body, { authenticated: false });
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
  assert.deepEqual(result.body.map(({ label }) => label), ['Soccer', 'Basketball', 'Baseball', 'Swim']);

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
