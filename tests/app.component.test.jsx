import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App.jsx';

const responseFor = (body, status = 200) => new Response(
  body === null ? null : JSON.stringify(body),
  {
    status,
    headers: body === null ? {} : { 'Content-Type': 'application/json' },
  },
);

const makeVideo = (overrides = {}) => ({
  id: 'vid_emma_soccer',
  child_id: 'child_1',
  sport: 'Soccer',
  event_name: 'vs. Tigers',
  event_date: '2026-01-15',
  title: 'Emma soccer goal',
  notes: 'Emma notes',
  tags: ['Highlight'],
  source_type: 'link',
  external_url: 'https://www.youtube.com/watch?v=emma_soccer',
  youtube_url: 'https://www.youtube.com/watch?v=emma_soccer',
  publish_status: 'ready',
  publish_error: null,
  hidden: false,
  thumbnail_url: '/assets/demo/video-thumb-demo-1.svg',
  ...overrides,
});

const makeCatalog = () => ({
  children: [
    { id: 'child_1', name: 'Emma', sport: 'Soccer', team: 'Blue Hawks', clip_count: 2 },
    { id: 'child_2', name: 'Noah', sport: 'Basketball', team: 'Sunset Sparks', clip_count: 1 },
  ],
  sports: [
    { id: 'soccer', label: 'Soccer' },
    { id: 'basketball', label: 'Basketball' },
  ],
  settings: { youtube_mode: 'mock', max_upload_mb: 500, max_upload_storage_mb: 2048 },
  videos: [
    makeVideo(),
    makeVideo({
      id: 'vid_emma_basketball',
      sport: 'Basketball',
      title: 'Emma basketball shot',
      notes: 'Emma basketball notes',
      external_url: 'https://www.youtube.com/watch?v=emma_basketball',
      youtube_url: 'https://www.youtube.com/watch?v=emma_basketball',
    }),
    makeVideo({
      id: 'vid_noah_basketball',
      child_id: 'child_2',
      sport: 'Basketball',
      title: 'Noah fast break',
      notes: 'Noah notes',
      external_url: 'https://www.youtube.com/watch?v=noah_basketball',
      youtube_url: 'https://www.youtube.com/watch?v=noah_basketball',
    }),
  ],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const installCatalogApi = ({ authenticated = true } = {}) => {
  const catalog = makeCatalog();
  const requests = [];
  let nextId = 1;
  const fetchMock = vi.fn(async (input, options = {}) => {
    const pathname = String(input);
    const method = options.method || 'GET';
    requests.push({ pathname, method, options });

    if (pathname === '/api/me') return responseFor({ authenticated });
    if (pathname === '/api/auth/unlock') return responseFor({ ok: true });
    if (pathname === '/api/auth/lock') return responseFor({ ok: true });
    if (pathname === '/api/children') return responseFor(clone(catalog.children));
    if (pathname === '/api/sports') return responseFor(clone(catalog.sports));
    if (pathname === '/api/settings') return responseFor(clone(catalog.settings));
    if (pathname === '/api/videos?includeHidden=true') return responseFor(clone(catalog.videos));

    if (pathname === '/api/videos' && method === 'POST') {
      const form = options.body;
      const sourceType = form.get('source_type');
      const created = makeVideo({
        id: `vid_created_${nextId++}`,
        child_id: form.get('child_id'),
        sport: form.get('sport'),
        event_name: form.get('event_name') || null,
        event_date: form.get('event_date'),
        title: form.get('title'),
        notes: form.get('notes') || null,
        tags: form.get('tags') ? String(form.get('tags')).split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        source_type: sourceType,
        external_url: sourceType === 'link' ? form.get('external_url') : null,
        youtube_url: sourceType === 'link' ? form.get('external_url') : 'https://youtube.com/watch?v=mock_created',
        publish_status: sourceType === 'upload' ? 'mock' : 'ready',
        publish_error: sourceType === 'upload' ? 'YouTube is not connected; this upload is a local mock.' : null,
      });
      catalog.videos.push(created);
      return responseFor(created, 201);
    }

    if (pathname.startsWith('/api/videos/') && method === 'PATCH') {
      const id = pathname.split('/').pop();
      const video = catalog.videos.find((item) => item.id === id);
      const changes = JSON.parse(options.body);
      Object.assign(video, changes);
      if (typeof changes.tags === 'string') video.tags = changes.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      return responseFor(clone(video));
    }

    throw new Error(`Unhandled request: ${method} ${pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { catalog, requests, fetchMock };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('App authenticated UI flows', () => {
  it('unlocks through the API and clears sensitive state before reporting a lock failure', async () => {
    let rejectLock;
    const catalog = makeCatalog();
    const fetchMock = vi.fn((input, options = {}) => {
      const pathname = String(input);
      if (pathname === '/api/me') return Promise.resolve(responseFor({ authenticated: false }));
      if (pathname === '/api/auth/unlock') return Promise.resolve(responseFor({ ok: true }));
      if (pathname === '/api/auth/lock') {
        return new Promise((_, reject) => {
          rejectLock = reject;
        });
      }
      if (pathname === '/api/children') return Promise.resolve(responseFor(catalog.children));
      if (pathname === '/api/sports') return Promise.resolve(responseFor(catalog.sports));
      if (pathname === '/api/settings') return Promise.resolve(responseFor(catalog.settings));
      if (pathname === '/api/videos?includeHidden=true') return Promise.resolve(responseFor(catalog.videos));
      throw new Error(`Unhandled request: ${pathname} ${options.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.change(await screen.findByLabelText('Family PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock memories' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Whose highlights?' })).toBeTruthy());
    await screen.findByRole('heading', { name: 'Emma' });
    fireEvent.change(screen.getByLabelText('Title', { selector: 'input' }), { target: { value: 'Sensitive draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload from phone' }));
    fireEvent.change(screen.getByLabelText('Choose a video file'), {
      target: { files: [new File(['private draft'], 'private.mp4', { type: 'video/mp4' })] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unlock the family catalog' })).toBeTruthy());
    expect(screen.queryByText('Emma')).toBeNull();

    rejectLock(new Error('logout unavailable'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('server logout failed'));
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/auth/lock')).toBe(true);

    fireEvent.change(screen.getByLabelText('Family PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock memories' }));
    await screen.findByRole('heading', { name: 'Emma' });
    expect(screen.getByLabelText('Video link')).toBeTruthy();
    expect(screen.getByLabelText('Title', { selector: 'input' }).value).toBe('');
  });

  it('waits for a pending server lock before starting a new unlock', async () => {
    const catalog = makeCatalog();
    let resolveLock;
    let unlockCalls = 0;
    const fetchMock = vi.fn((input, options = {}) => {
      const pathname = String(input);
      if (pathname === '/api/me') return Promise.resolve(responseFor({ authenticated: false }));
      if (pathname === '/api/auth/unlock') {
        unlockCalls += 1;
        return Promise.resolve(responseFor({ ok: true }));
      }
      if (pathname === '/api/auth/lock') {
        return new Promise((resolve) => {
          resolveLock = () => resolve(responseFor({ ok: true }));
        });
      }
      if (pathname === '/api/children') return Promise.resolve(responseFor(catalog.children));
      if (pathname === '/api/sports') return Promise.resolve(responseFor(catalog.sports));
      if (pathname === '/api/settings') return Promise.resolve(responseFor(catalog.settings));
      if (pathname === '/api/videos?includeHidden=true') return Promise.resolve(responseFor(catalog.videos));
      throw new Error(`Unhandled request: ${pathname} ${options.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.change(await screen.findByLabelText('Family PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock memories' }));
    await screen.findByRole('heading', { name: 'Emma' });
    expect(unlockCalls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByRole('heading', { name: 'Unlock the family catalog' });
    fireEvent.change(screen.getByLabelText('Family PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock memories' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unlocking…' })).toBeTruthy());
    expect(unlockCalls).toBe(1);

    resolveLock();
    await screen.findByRole('heading', { name: 'Emma' });
    expect(unlockCalls).toBe(2);
  });

  it('keeps a newly created video visible when the form targets another athlete', async () => {
    installCatalogApi();
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('Athlete'), { target: { value: 'child_2' } });
    fireEvent.change(screen.getByLabelText('Video link'), { target: { value: 'https://youtu.be/noah-new' } });
    fireEvent.change(screen.getByLabelText('Title', { selector: 'input' }), { target: { value: 'Noah new memory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Noah' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Noah’s clips' })).toBeTruthy());
    expect(screen.getAllByRole('heading', { name: 'Noah new memory' }).length).toBeGreaterThan(0);
  });

  it('resets the sport filter when locking and unlocking the catalog', async () => {
    installCatalogApi();
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Basketball', pressed: false }));
    expect(screen.getByRole('button', { name: 'Basketball', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByRole('heading', { name: 'Unlock the family catalog' });
    fireEvent.change(screen.getByLabelText('Family PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock memories' }));
    await screen.findByRole('heading', { name: 'Emma’s clips' });
    expect(screen.getByRole('button', { name: 'All sports', pressed: true })).toBeTruthy();
  });

  it('keeps the selected detail inside the active child and sport filter', async () => {
    installCatalogApi();
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /Emma basketball shot/, pressed: false }));
    expect(screen.getAllByRole('heading', { name: 'Emma basketball shot' }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Soccer', pressed: false }));
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: 'Emma basketball shot' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Noah Basketball/, pressed: false }));
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Noah fast break' }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: 'Emma soccer goal' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Emma basketball shot' })).toBeNull();
  });

  it('covers link, upload, edit, and hide API actions from the rendered component', async () => {
    const { catalog, requests } = installCatalogApi();
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('Video link'), { target: { value: 'https://youtu.be/new_link' } });
    fireEvent.change(screen.getByLabelText('Title', { selector: 'input' }), { target: { value: 'New link memory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Emma' }));
    await waitFor(() => expect(screen.getByText('Saved to the catalog.')).toBeTruthy());
    const linkRequest = requests.find(({ pathname, method }) => pathname === '/api/videos' && method === 'POST');
    expect(linkRequest.options.body.get('source_type')).toBe('link');
    expect(linkRequest.options.body.get('external_url')).toBe('https://youtu.be/new_link');

    fireEvent.click(screen.getByRole('button', { name: 'Upload from phone' }));
    const file = new File(['video bytes'], 'practice.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Choose a video file'), { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Paste a link' }).at(-1));
    fireEvent.click(screen.getByRole('button', { name: 'Upload from phone' }));
    expect(screen.getByLabelText('Choose a video file').files).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Choose a video file'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Title', { selector: 'input' }), { target: { value: 'New upload memory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Emma' }));
    await waitFor(() => expect(screen.getByText(/Saved as a mock upload/)).toBeTruthy());
    const uploadRequest = requests.filter(({ pathname, method }) => pathname === '/api/videos' && method === 'POST').at(-1);
    expect(uploadRequest.options.body.get('source_type')).toBe('upload');
    expect(uploadRequest.options.body.get('file').name).toBe('practice.mp4');

    const created = catalog.videos.find((video) => video.title === 'New upload memory');
    expect(created).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editTitle = screen.getAllByLabelText('Title', { selector: 'input' }).at(-1);
    fireEvent.change(editTitle, { target: { value: 'Edited upload memory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Video details updated.')).toBeTruthy());
    expect(catalog.videos.find((video) => video.id === created.id).title).toBe('Edited upload memory');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.getByText('Video is hidden from the public view.')).toBeTruthy());
    expect(catalog.videos.find((video) => video.id === created.id).hidden).toBe(true);
  });

  it('exits an edit form when the active sport filter changes', async () => {
    installCatalogApi();
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Basketball', pressed: false }));
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma basketball shot' }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('ignores an older refresh response after a newer refresh completes', async () => {
    const oldCatalog = makeCatalog();
    const newChildren = [{ id: 'child_new', name: 'Jordan', sport: 'Soccer', team: 'Green Team', clip_count: 1 }];
    const newVideos = [makeVideo({
      id: 'vid_new',
      child_id: 'child_new',
      title: 'Jordan winning goal',
      notes: 'Newest catalog response',
    })];
    let raceMode = false;
    let childrenCallCount = 0;
    let staleResolve;
    const fetchMock = vi.fn((input, options = {}) => {
      const pathname = String(input);
      if (pathname === '/api/me') return Promise.resolve(responseFor({ authenticated: true }));
      if (pathname === '/api/auth/lock') return Promise.resolve(responseFor({ ok: true }));
      if (pathname === '/api/children') {
        if (!raceMode) return Promise.resolve(responseFor(oldCatalog.children));
        childrenCallCount += 1;
        if (childrenCallCount === 1) {
          return new Promise((resolve) => {
            staleResolve = () => resolve(responseFor(oldCatalog.children));
          });
        }
        return Promise.resolve(responseFor(newChildren));
      }
      if (pathname === '/api/sports') return Promise.resolve(responseFor(oldCatalog.sports));
      if (pathname === '/api/settings') return Promise.resolve(responseFor(oldCatalog.settings));
      if (pathname === '/api/videos?includeHidden=true') {
        return Promise.resolve(responseFor(raceMode && childrenCallCount >= 2 ? newVideos : oldCatalog.videos));
      }
      throw new Error(`Unhandled request: ${pathname} ${options.method || 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Emma soccer goal' }).length).toBeGreaterThan(0));

    raceMode = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Jordan’s clips' })).toBeTruthy());
    staleResolve();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Jordan’s clips' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Emma soccer goal' })).toBeNull();
  });
});
