import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App.jsx';

const responseFor = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
  status,
  headers: body === null ? {} : { 'Content-Type': 'application/json' },
});

const event = {
  id: 'evt_tkd',
  name: 'Mountain West Open',
  type: 'tournament',
  sport: { id: 'taekwondo', label: 'Taekwondo' },
  start_date: '2026-05-16',
  end_date: '2026-05-17',
  venue: { name: 'Civic Arena' },
  result: 'unknown',
  placement: '2nd',
  medal: 'silver',
  hidden: false,
  participants: [{ id: 'ath_maya', name: 'Maya' }],
  tags: ['Taekwondo', 'Silver'],
};

const timelineBody = {
  items: [{
    event,
    event_clip_count: 1,
    moments: [{
      id: 'mom_qf',
      title: 'Quarterfinal - Fight 2',
      kind: 'fight',
      opponent_name: 'Demo Opponent B',
      round_label: 'quarterfinal',
      score: { for: 12, against: 8, text: null },
      clip_count: 1,
      hidden: false,
    }],
  }],
};

const installApi = ({ authenticated = true } = {}) => {
  const calls = [];
  const fetchMock = vi.fn(async (input, options = {}) => {
    const pathname = String(input);
    calls.push({ pathname, options });
    if (pathname === '/api/me') return responseFor({ authenticated });
    if (pathname === '/api/auth/unlock' || pathname === '/api/auth/lock') return responseFor({ ok: true });
    if (pathname === '/api/athletes') return responseFor({ items: [{ id: 'ath_maya', name: 'Maya', sports: [] }] });
    if (pathname === '/api/sports') return responseFor([{ id: 'soccer', label: 'Soccer' }, { id: 'taekwondo', label: 'Taekwondo' }]);
    if (pathname.startsWith('/api/timeline')) return responseFor(timelineBody);
    if (pathname === '/api/events/evt_tkd?include_hidden=true') return responseFor({ ...event, event_clips: [], moments: timelineBody.items[0].moments, notes: [], tags: event.tags });
    throw new Error(`Unhandled request: ${options.method || 'GET'} ${pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe('timeline UI', () => {
  it('renders API-backed event parents and ordered moments instead of a flat clip wall', async () => {
    installApi();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Mountain West Open' })).toBeTruthy();
    expect(screen.getByText('Moments from this event')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quarterfinal - Fight 2/ })).toBeTruthy();
    expect(screen.getByText('2nd silver')).toBeTruthy();
  });

  it('uses the authenticated timeline API when a sport filter changes', async () => {
    const { calls } = installApi();
    render(<App />);
    await screen.findByRole('heading', { name: 'Mountain West Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Taekwondo', pressed: false }));
    await waitFor(() => expect(calls.some(({ pathname }) => pathname.includes('sport_id=taekwondo'))).toBe(true));
  });

  it('shows a real file input and keeps an upload honest', async () => {
    installApi();
    render(<App />);
    await screen.findByRole('heading', { name: 'Mountain West Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a clip first' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload from phone' }));
    expect(await screen.findByLabelText('Choose a video file')).toBeTruthy();
    expect(screen.getByText(/saved item will show mock or pending/i)).toBeTruthy();
  });

  it('clears the privileged timeline on lock even when the server request is still pending', async () => {
    let resolveLock;
    const catalog = installApi();
    catalog.fetchMock.mockImplementation(async (input, options = {}) => {
      const pathname = String(input);
      if (pathname === '/api/me') return responseFor({ authenticated: true });
      if (pathname === '/api/auth/lock') return new Promise((resolve) => { resolveLock = () => resolve(responseFor({ ok: true })); });
      if (pathname === '/api/athletes') return responseFor({ items: [{ id: 'ath_maya', name: 'Maya', sports: [] }] });
      if (pathname === '/api/sports') return responseFor([{ id: 'taekwondo', label: 'Taekwondo' }]);
      if (pathname.startsWith('/api/timeline')) return responseFor(timelineBody);
      throw new Error(`Unhandled request: ${options.method || 'GET'} ${pathname}`);
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Mountain West Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByRole('heading', { name: 'Our Team Memories' });
    expect(screen.queryByRole('heading', { name: 'Mountain West Open' })).toBeNull();
    resolveLock();
  });

  it('holds the unlock form until a pending lock request settles', async () => {
    let resolveLock;
    const { fetchMock } = installApi();
    const unlockCalls = [];
    fetchMock.mockImplementation(async (input, options = {}) => {
      const pathname = String(input);
      if (pathname === '/api/me') return responseFor({ authenticated: true });
      if (pathname === '/api/auth/lock') return new Promise((resolve) => { resolveLock = () => resolve(responseFor({ ok: true })); });
      if (pathname === '/api/auth/unlock') {
        unlockCalls.push(pathname);
        return responseFor({ ok: true });
      }
      if (pathname === '/api/athletes') return responseFor({ items: [{ id: 'ath_maya', name: 'Maya', sports: [] }] });
      if (pathname === '/api/sports') return responseFor([{ id: 'taekwondo', label: 'Taekwondo' }]);
      if (pathname.startsWith('/api/timeline')) return responseFor(timelineBody);
      throw new Error(`Unhandled request: ${options.method || 'GET'} ${pathname}`);
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Mountain West Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    const pin = await screen.findByLabelText('Family PIN');
    fireEvent.change(pin, { target: { value: '2468' } });
    expect(screen.getByRole('button', { name: 'Unlocking...' }).disabled).toBe(true);
    expect(unlockCalls).toHaveLength(0);
    resolveLock();
    await waitFor(() => expect(screen.getByRole('button', { name: /Unlock/ }).disabled).toBe(false));
  });

  it('submits the event-first form and shows the saved event after refreshing the timeline', async () => {
    const calls = [];
    const createdEvent = {
      ...event,
      id: 'evt_spring_opener',
      name: 'Spring opener',
      type: 'game',
      sport: { id: 'soccer', label: 'Soccer' },
      start_date: '2026-08-08',
      end_date: '2026-08-08',
      participants: [{ id: 'ath_maya', name: 'Maya' }],
      tags: ['Family'],
    };
    let timelineRequestCount = 0;
    const fetchMock = vi.fn(async (input, options = {}) => {
      const pathname = String(input);
      calls.push({ pathname, options });
      if (pathname === '/api/me') return responseFor({ authenticated: true });
      if (pathname === '/api/athletes') return responseFor({ items: [{ id: 'ath_maya', name: 'Maya', sports: [] }] });
      if (pathname === '/api/sports') return responseFor([{ id: 'soccer', label: 'Soccer' }]);
      if (pathname.startsWith('/api/timeline')) {
        timelineRequestCount += 1;
        return responseFor(timelineRequestCount === 1 ? { items: [] } : { items: [{ event: createdEvent, event_clip_count: 0, moments: [] }] });
      }
      if (pathname === '/api/events' && options.method === 'POST') return responseFor(createdEvent, 201);
      if (pathname === '/api/events/evt_spring_opener?include_hidden=true') return responseFor({ ...createdEvent, event_clips: [], moments: [], notes: [], tags: createdEvent.tags });
      throw new Error(`Unhandled request: ${options.method || 'GET'} ${pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add a memory' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a memory' })[0]);
    const eventName = await screen.findByLabelText('Event name');
    await waitFor(() => expect(document.activeElement).toBe(eventName));
    fireEvent.change(eventName, { target: { value: 'Spring opener' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    await waitFor(() => expect(calls.some(({ pathname, options }) => pathname === '/api/events' && options.method === 'POST')).toBe(true));
    const createCall = calls.find(({ pathname, options }) => pathname === '/api/events' && options.method === 'POST');
    expect(JSON.parse(createCall.options.body)).toMatchObject({ name: 'Spring opener', sport_id: 'soccer' });
    await waitFor(() => {
      expect(timelineRequestCount).toBeGreaterThan(1);
      expect(document.querySelector('.timeline-list')?.textContent).toContain('Spring opener');
    });
    expect((await screen.findAllByRole('heading', { name: 'Spring opener' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog').querySelector('.dialog-scroll')).toBeTruthy();
  });

  it('starts a fresh event flow after closing an event detail dialog', async () => {
    installApi();
    render(<App />);
    await screen.findByRole('heading', { name: 'Mountain West Open' });
    fireEvent.click(screen.getByRole('button', { name: 'Mountain West Open' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(document.querySelector('.site-header').inert).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a memory' }));
    expect(await screen.findByLabelText('Event name')).toBeTruthy();
  });
});

describe('PIN screen', () => {
  it('uses the unlock endpoint and reports an invalid PIN', async () => {
    const { fetchMock } = installApi({ authenticated: false });
    fetchMock.mockImplementation(async (input, options = {}) => {
      const pathname = String(input);
      if (pathname === '/api/me') return responseFor({ authenticated: false });
      if (pathname === '/api/auth/unlock') return responseFor({ error: 'Check your PIN and try again' }, 401);
      throw new Error(`Unhandled request: ${options.method || 'GET'} ${pathname}`);
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Family PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock memories' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Check your PIN'));
  });
});
