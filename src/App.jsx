import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const flowSteps = [
  {
    title: '1. Unlock with your family PIN',
    detail: 'One shared PIN keeps it fast for busy parents.',
  },
  {
    title: '2. Choose your athlete',
    detail: 'Tap a child to see their highlights instantly.',
  },
  {
    title: '3. Add or paste a video',
    detail: 'Upload from your phone or drop in a YouTube link.',
  },
  {
    title: '4. Save details and share',
    detail: 'Add date, notes, and tags so you can find it later.',
  },
];

const fallbackSports = ['Soccer', 'Basketball', 'Baseball'];

const today = () => new Date().toISOString().slice(0, 10);

const emptyVideoForm = (childId = '', sport = '') => ({
  child_id: childId,
  sport,
  event_name: '',
  event_date: today(),
  title: '',
  notes: '',
  tags: '',
  external_url: '',
});

const parseError = async (response) => {
  try {
    const body = await response.json();
    return body?.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

const api = async (pathname, options = {}) => {
  const response = await fetch(pathname, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    const error = new Error(await parseError(response));
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
};

const formatDate = (value) => {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const videoSubtitle = (video) => [video.event_name, formatDate(video.event_date)].filter(Boolean).join(' · ');

const sourceLabel = (video) => {
  if (video.source_type === 'upload') {
    if (video.publish_status === 'mock') return 'Mock upload';
    if (video.publish_status === 'pending') return 'Upload pending';
    return 'Uploaded clip';
  }
  return 'Link';
};

const matchesVideoView = (video, childId, sport) => Boolean(childId)
  && video.child_id === childId
  && (sport === 'All sports' || video.sport === sport);

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [children, setChildren] = useState([]);
  const [videos, setVideos] = useState([]);
  const [sports, setSports] = useState([]);
  const [settings, setSettings] = useState(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [activeChildId, setActiveChildId] = useState('');
  const [activeSport, setActiveSport] = useState('All sports');
  const [selectedVideoId, setSelectedVideoId] = useState(null);

  const [sourceMode, setSourceMode] = useState('link');
  const [videoForm, setVideoForm] = useState(emptyVideoForm());
  const [selectedFile, setSelectedFile] = useState(null);
  const [formStatus, setFormStatus] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [detailStatus, setDetailStatus] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editVideoId, setEditVideoId] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

  const formRef = useRef(null);
  const urlInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const catalogRequestRef = useRef({ generation: 0, controller: null });
  const sessionGenerationRef = useRef(0);
  const lockRequestRef = useRef(null);
  const activeViewRef = useRef({ childId: '', sport: 'All sports' });

  const activeChild = useMemo(
    () => children.find((child) => child.id === activeChildId) || children[0] || null,
    [activeChildId, children]
  );
  activeViewRef.current = { childId: activeChild?.id || '', sport: activeSport };

  const visibleSports = useMemo(() => {
    const labels = sports.map((sport) => sport.label).filter(Boolean);
    return labels.length ? labels : fallbackSports;
  }, [sports]);

  const filteredVideos = useMemo(
    () => videos.filter((video) => matchesVideoView(video, activeChild?.id, activeSport)),
    [activeChild, activeSport, videos]
  );

  const selectedVideo = useMemo(
    () => filteredVideos.find((video) => video.id === selectedVideoId) || filteredVideos[0] || null,
    [filteredVideos, selectedVideoId]
  );

  const invalidateCatalogRequests = useCallback(() => {
    const current = catalogRequestRef.current;
    current.controller?.abort();
    catalogRequestRef.current = {
      generation: current.generation + 1,
      controller: null,
    };
  }, []);

  const setUnauthenticated = useCallback(() => {
    sessionGenerationRef.current += 1;
    invalidateCatalogRequests();
    setAuthenticated(false);
    setChildren([]);
    setVideos([]);
    setSports([]);
    setSettings(null);
    setActiveChildId('');
    setActiveSport('All sports');
    setSelectedVideoId(null);
    setPin('');
    setAuthBusy(false);
    setVideoForm(emptyVideoForm());
    setSelectedFile(null);
    setSourceMode('link');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setEditForm(null);
    setEditVideoId(null);
    setCatalogBusy(false);
    setCatalogError('');
    setFormStatus(null);
    setDetailStatus(null);
    setFormBusy(false);
    setEditBusy(false);
  }, [invalidateCatalogRequests]);

  const refreshCatalog = useCallback(async (viewOverride = null) => {
    const sessionGeneration = sessionGenerationRef.current;
    const previous = catalogRequestRef.current;
    previous.controller?.abort();
    const generation = previous.generation + 1;
    const controller = new AbortController();
    catalogRequestRef.current = { generation, controller };
    setCatalogBusy(true);
    setCatalogError('');
    try {
      const [nextChildren, nextVideos, nextSports, nextSettings] = await Promise.all([
        api('/api/children', { signal: controller.signal }),
        api('/api/videos?includeHidden=true', { signal: controller.signal }),
        api('/api/sports', { signal: controller.signal }),
        api('/api/settings', { signal: controller.signal }),
      ]);
      const isCurrent = catalogRequestRef.current.generation === generation
        && sessionGenerationRef.current === sessionGeneration
        && !controller.signal.aborted;
      if (!isCurrent) return null;
      setChildren(nextChildren);
      setVideos(nextVideos);
      setSports(nextSports);
      setSettings(nextSettings);
      const { childId: currentChildId, sport: currentSport } = viewOverride || activeViewRef.current;
      const nextActiveChildId = nextChildren.some((child) => child.id === currentChildId)
        ? currentChildId
        : nextChildren[0]?.id || '';
      setActiveChildId(nextActiveChildId);
      setSelectedVideoId((current) => {
        const selected = nextVideos.find((video) => (
          video.id === current && matchesVideoView(video, nextActiveChildId, currentSport)
        ));
        return selected?.id
          || nextVideos.find((video) => matchesVideoView(video, nextActiveChildId, currentSport))?.id
          || null;
      });
      return { children: nextChildren, videos: nextVideos };
    } catch (error) {
      const isCurrent = catalogRequestRef.current.generation === generation
        && sessionGenerationRef.current === sessionGeneration
        && !controller.signal.aborted;
      if (!isCurrent || error.name === 'AbortError') return null;
      if (error.status === 401) {
        setUnauthenticated();
      } else {
        setCatalogError(error.message);
      }
      return null;
    } finally {
      if (catalogRequestRef.current.generation === generation) {
        catalogRequestRef.current = { generation, controller: null };
        setCatalogBusy(false);
      }
    }
  }, [setUnauthenticated]);

  useEffect(() => {
    let cancelled = false;
    api('/api/me')
      .then((body) => {
        if (!cancelled) setAuthenticated(Boolean(body.authenticated));
      })
      .catch((error) => {
        if (!cancelled) setAuthError(error.message);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authenticated) refreshCatalog();
  }, [authenticated, refreshCatalog]);

  useEffect(() => {
    if (!activeChild) return;
    setVideoForm((current) => {
      const childChanged = current.child_id !== activeChild.id;
      return {
        ...current,
        child_id: activeChild.id,
        sport: childChanged ? activeChild.sport || visibleSports[0] || '' : current.sport || activeChild.sport || visibleSports[0] || '',
      };
    });
  }, [activeChild, visibleSports]);

  useEffect(() => {
    if (!filteredVideos.some((video) => video.id === selectedVideoId)) {
      setSelectedVideoId(filteredVideos[0]?.id || null);
    }
  }, [filteredVideos, selectedVideoId]);

  useEffect(() => {
    setEditForm(null);
    setEditVideoId(null);
  }, [activeChildId, activeSport]);

  const handleUnlock = async (event) => {
    event.preventDefault();
    const pendingLock = lockRequestRef.current;
    setAuthBusy(true);
    setAuthError('');
    try {
      if (pendingLock) await pendingLock.catch(() => {});
      await api('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      setPin('');
      setAuthenticated(true);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLock = async () => {
    if (lockRequestRef.current) return;
    setAuthError('');
    setUnauthenticated();
    const lockRequest = api('/api/auth/lock', { method: 'POST' });
    lockRequestRef.current = lockRequest;
    try {
      await lockRequest;
    } catch (error) {
      setAuthError(`Locked locally, but server logout failed: ${error.message}`);
    } finally {
      if (lockRequestRef.current === lockRequest) lockRequestRef.current = null;
    }
  };

  const focusAddForm = (mode = 'link') => {
    setSourceMode(mode);
    setFormStatus(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      if (mode === 'upload') fileInputRef.current?.click();
      else urlInputRef.current?.focus();
    }, 0);
  };

  const handleFieldChange = (field) => (event) => {
    const { value } = event.target;
    setVideoForm((current) => ({ ...current, [field]: value }));
  };

  const handleChildChange = (event) => {
    const childId = event.target.value;
    const child = children.find((item) => item.id === childId);
    setVideoForm((current) => ({
      ...current,
      child_id: childId,
      sport: child?.sport || current.sport || visibleSports[0] || '',
    }));
  };

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files?.[0] || null);
    setSourceMode('upload');
    setFormStatus(null);
  };

  const handleSaveVideo = async (event) => {
    event.preventDefault();
    const sessionGeneration = sessionGenerationRef.current;
    setFormBusy(true);
    setFormStatus(null);

    if (sourceMode === 'upload' && !selectedFile) {
      setFormStatus({ type: 'error', message: 'Choose a video file before saving the upload.' });
      setFormBusy(false);
      return;
    }

    const payload = new FormData();
    Object.entries(videoForm).forEach(([key, value]) => payload.set(key, value || ''));
    payload.set('source_type', sourceMode);
    if (sourceMode === 'upload') payload.set('file', selectedFile);

    try {
      const created = await api('/api/videos', { method: 'POST', body: payload });
      if (sessionGenerationRef.current !== sessionGeneration) return;
      const nextSport = matchesVideoView(created, created.child_id, activeSport)
        ? activeSport
        : created.sport || 'All sports';
      const nextView = { childId: created.child_id, sport: nextSport };
      activeViewRef.current = nextView;
      setActiveChildId(created.child_id);
      setActiveSport(nextSport);
      setSelectedVideoId(created.id);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setVideoForm(emptyVideoForm(created.child_id, created.sport));
      setFormStatus({
        type: 'success',
        message: created.publish_status === 'mock'
          ? 'Saved as a mock upload. YouTube is not connected, so this clip is not public.'
          : 'Saved to the catalog.',
      });
      await refreshCatalog(nextView);
      if (sessionGenerationRef.current === sessionGeneration) setSelectedVideoId(created.id);
    } catch (error) {
      if (sessionGenerationRef.current !== sessionGeneration) return;
      if (error.status === 401) setUnauthenticated();
      setFormStatus({ type: 'error', message: error.message });
    } finally {
      if (sessionGenerationRef.current === sessionGeneration) setFormBusy(false);
    }
  };

  const startEditing = () => {
    if (!selectedVideo) return;
    setDetailStatus(null);
    setEditVideoId(selectedVideo.id);
    setEditForm({
      title: selectedVideo.title || '',
      event_name: selectedVideo.event_name || '',
      event_date: selectedVideo.event_date || today(),
      notes: selectedVideo.notes || '',
      tags: Array.isArray(selectedVideo.tags) ? selectedVideo.tags.join(', ') : '',
      sport: selectedVideo.sport || '',
    });
  };

  const handleEditField = (field) => (event) => {
    setEditForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!selectedVideo || !editForm || editVideoId !== selectedVideo.id) return;
    const sessionGeneration = sessionGenerationRef.current;
    setEditBusy(true);
    setDetailStatus(null);
    try {
      await api(`/api/videos/${selectedVideo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (sessionGenerationRef.current !== sessionGeneration) return;
      setEditForm(null);
      setEditVideoId(null);
      setDetailStatus({ type: 'success', message: 'Video details updated.' });
      await refreshCatalog();
    } catch (error) {
      if (sessionGenerationRef.current !== sessionGeneration) return;
      if (error.status === 401) setUnauthenticated();
      setDetailStatus({ type: 'error', message: error.message });
    } finally {
      if (sessionGenerationRef.current === sessionGeneration) setEditBusy(false);
    }
  };

  const handleToggleHidden = async () => {
    if (!selectedVideo) return;
    const sessionGeneration = sessionGenerationRef.current;
    setDetailStatus(null);
    try {
      await api(`/api/videos/${selectedVideo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: !selectedVideo.hidden }),
      });
      if (sessionGenerationRef.current !== sessionGeneration) return;
      setDetailStatus({
        type: 'success',
        message: selectedVideo.hidden ? 'Video is visible in the family catalog.' : 'Video is hidden from the public view.',
      });
      await refreshCatalog();
    } catch (error) {
      if (sessionGenerationRef.current !== sessionGeneration) return;
      if (error.status === 401) setUnauthenticated();
      setDetailStatus({ type: 'error', message: error.message });
    }
  };

  const handlePlay = () => {
    const url = selectedVideo?.youtube_url || selectedVideo?.external_url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleShare = async () => {
    const url = selectedVideo?.youtube_url || selectedVideo?.external_url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setDetailStatus({ type: 'success', message: 'Video link copied.' });
    } catch {
      setDetailStatus({ type: 'error', message: 'Could not copy the video link on this device.' });
    }
  };

  if (!authChecked) {
    return <main className="auth-shell"><div className="auth-card"><p className="eyebrow">Our Team Memories</p><h1>Checking your family session…</h1></div></main>;
  }

  if (!authenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="unlock-title">
          <img src="/assets/logo-icon.svg" alt="" className="auth-logo" />
          <p className="eyebrow">Our Team Memories</p>
          <h1 id="unlock-title">Unlock the family catalog</h1>
          <p className="muted">Use the shared family PIN to view, add, and organize your kids’ sports memories.</p>
          <form className="auth-form" onSubmit={handleUnlock}>
            <label className="form-field">
              <span>Family PIN</span>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="Enter your PIN"
                required
                autoFocus
              />
            </label>
            {authError && <p className="status-message error" role="alert">{authError}</p>}
            <button className="primary-btn" type="submit" disabled={authBusy}>
              {authBusy ? 'Unlocking…' : 'Unlock memories'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <img src="/assets/logo-icon.svg" alt="" />
          <div>
            <h1>Our Team Memories</h1>
            <div className="pin-pill">Family PIN enabled</div>
          </div>
        </div>
        <button className="secondary-btn" type="button" onClick={handleLock}>Lock</button>
      </header>

      {catalogError && <p className="status-message error" role="alert">{catalogError}</p>}

      <main id="main-content">
        <section className="section">
          <div className="hero">
            <div>
              <p className="eyebrow">A calmer highlight reel</p>
              <h2>Whose highlights?</h2>
              <p className="muted">
                Add or upload a clip in under a minute. Everything stays organized by child and sport.
              </p>
              <div className="hero-actions">
                <button className="primary-btn" type="button" onClick={() => focusAddForm('upload')}>Add a video</button>
                <button className="secondary-btn" type="button" onClick={() => focusAddForm('link')}>Paste a link</button>
              </div>
            </div>
            <img src="/assets/hero-empty-state.svg" alt="Highlights" className="hero-art" />
          </div>

          <div className="child-grid" aria-label="Choose an athlete">
            {children.map((child) => (
              <button
                key={child.id}
                className={`child-card ${child.id === activeChild?.id ? 'selected' : ''}`}
                onClick={() => {
                  setActiveChildId(child.id);
                  setActiveSport('All sports');
                  setSelectedVideoId(null);
                }}
                type="button"
                aria-pressed={child.id === activeChild?.id}
              >
                <img src="/assets/child-avatar-default.svg" alt="" />
                <div className="child-info">
                  <h3>{child.name}</h3>
                  <p>{[child.sport, child.team].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="child-badge">
                  {child.clip_count ?? 0} {Number(child.clip_count) === 1 ? 'clip' : 'clips'}
                </span>
              </button>
            ))}
          </div>
          {!catalogBusy && !children.length && <div className="empty-state">No athletes have been added yet.</div>}
        </section>

        <section className="section card">
          <h2>How it works</h2>
          <div className="flow-grid">
            {flowSteps.map((step) => (
              <div key={step.title} className="flow-card">
                <strong>{step.title}</strong>
                <p className="muted">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="clips-title">
          <div className="top-bar section-heading">
            <div>
              <p className="eyebrow">Your private catalog</p>
              <h2 id="clips-title">{activeChild ? `${activeChild.name}’s clips` : 'Clips'}</h2>
              <p className="muted">Tap a clip to play or edit. Hidden clips stay private.</p>
            </div>
            <div className="section-heading-actions">
              <button className="secondary-btn" type="button" onClick={() => { void refreshCatalog(); }}>Refresh</button>
              <button className="primary-btn" type="button" onClick={() => focusAddForm('link')}>Add video</button>
            </div>
          </div>

          <div className="chips" aria-label="Filter by sport">
            <button
              className={`chip ${activeSport === 'All sports' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveSport('All sports')}
              aria-pressed={activeSport === 'All sports'}
            >
              All sports
            </button>
            {visibleSports.map((sport) => (
              <button
                key={sport}
                className={`chip ${activeSport === sport ? 'active' : ''}`}
                type="button"
                onClick={() => setActiveSport(sport)}
                aria-pressed={activeSport === sport}
              >
                {sport}
              </button>
            ))}
          </div>

          {catalogBusy && <p className="muted">Refreshing your catalog…</p>}
          {!catalogBusy && !filteredVideos.length && <div className="empty-state">No clips match this child and sport yet. Add the first one below.</div>}
          <div className="video-grid">
            {filteredVideos.map((video) => (
              <button
                key={video.id}
                className={`video-card ${video.id === selectedVideo?.id ? 'selected' : ''}`}
                type="button"
                onClick={() => {
                  setSelectedVideoId(video.id);
                  setDetailStatus(null);
                  setEditForm(null);
                }}
                aria-pressed={video.id === selectedVideo?.id}
              >
                <div className="video-thumb">
                  <img src={video.thumbnail_url || '/assets/demo/video-thumb-demo-1.svg'} alt="" />
                  <div className="play" aria-hidden="true">▶</div>
                  {video.hidden ? <div className="hidden-flag">Hidden</div> : null}
                </div>
                <div className="video-body">
                  <h4>{video.title}</h4>
                  <p>{videoSubtitle(video)}</p>
                  <div className="badge-row">
                    <span className="badge">{video.sport || 'Uncategorized'}</span>
                    <span className="badge">{sourceLabel(video)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="section card" ref={formRef} aria-labelledby="add-video-title">
          <div className="section-heading">
            <p className="eyebrow">Keep the context</p>
            <h2 id="add-video-title">Add a video</h2>
            <p className="muted">Choose a link or a phone file. The catalog saves the details either way.</p>
          </div>
          <div className="form-grid source-switcher" role="group" aria-label="Video source">
            <button
              className={`secondary-btn ${sourceMode === 'link' ? 'active' : ''}`}
              type="button"
              onClick={() => {
                setSourceMode('link');
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Paste a link
            </button>
            <button className={`secondary-btn ${sourceMode === 'upload' ? 'active' : ''}`} type="button" onClick={() => setSourceMode('upload')}>Upload from phone</button>
          </div>

          <form onSubmit={handleSaveVideo}>
            {sourceMode === 'upload' ? (
              <div className="upload-box">
                <input
                  ref={fileInputRef}
                  className="file-input"
                  type="file"
                  accept="video/mp4,video/quicktime,video/*"
                  onChange={handleFileChange}
                  aria-label="Choose a video file"
                />
                <button className="upload-picker" type="button" onClick={() => fileInputRef.current?.click()}>
                  <img src="/assets/upload-placeholder.svg" alt="" />
                  <strong>{selectedFile ? selectedFile.name : 'Tap to choose video'}</strong>
                  <span>MP4, MOV up to {settings?.max_upload_mb || 500}MB</span>
                </button>
              </div>
            ) : (
              <label className="form-field full-width">
                <span>Video link</span>
                <input
                  ref={urlInputRef}
                  className="input"
                  value={videoForm.external_url}
                  onChange={handleFieldChange('external_url')}
                  placeholder="https://..."
                  type="url"
                  required
                />
              </label>
            )}

            <div className="form-grid form-grid-fields">
              <label className="form-field">
                <span>Title</span>
                <input className="input" value={videoForm.title} onChange={handleFieldChange('title')} placeholder="What happened?" required />
              </label>
              <label className="form-field">
                <span>Event or opponent</span>
                <input className="input" value={videoForm.event_name} onChange={handleFieldChange('event_name')} placeholder="Team practice or vs. Tigers" />
              </label>
              <label className="form-field">
                <span>Athlete</span>
                <select className="input" value={videoForm.child_id} onChange={handleChildChange} required>
                  {children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Sport</span>
                <select className="input" value={videoForm.sport} onChange={handleFieldChange('sport')} required>
                  {visibleSports.map((sport) => <option key={sport} value={sport}>{sport}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Date</span>
                <input className="input" type="date" value={videoForm.event_date} onChange={handleFieldChange('event_date')} required />
              </label>
              <label className="form-field">
                <span>Tags</span>
                <input className="input" value={videoForm.tags} onChange={handleFieldChange('tags')} placeholder="Tournament, Highlight" />
              </label>
              <label className="form-field full-width">
                <span>Notes</span>
                <textarea className="input textarea" value={videoForm.notes} onChange={handleFieldChange('notes')} placeholder="Any notes? (optional)" />
              </label>
            </div>
            {formStatus && <p className={`status-message ${formStatus.type}`} role="status">{formStatus.message}</p>}
            <div className="footer-actions">
              <div className="note">Hidden clips are still visible to your family while signed in.</div>
              <button className="primary-btn" type="submit" disabled={formBusy || !children.length}>
                {formBusy ? 'Saving…' : `Save to ${children.find((child) => child.id === videoForm.child_id)?.name || 'highlights'}`}
              </button>
            </div>
          </form>
        </section>

        {selectedVideo && (
          <section className="section card" aria-labelledby="video-detail-title">
            <div className="section-heading">
              <p className="eyebrow">Selected memory</p>
              <h2 id="video-detail-title">Video detail</h2>
            </div>
            {!editForm || editVideoId !== selectedVideo.id ? (
              <>
                <div className="video-thumb detail-thumb">
                  <img src={selectedVideo.thumbnail_url || '/assets/demo/video-thumb-demo-1.svg'} alt="" />
                  <div className="play" aria-hidden="true">▶</div>
                  {selectedVideo.hidden ? <div className="hidden-flag">Hidden</div> : null}
                </div>
                <div className="detail-copy">
                  <h3>{selectedVideo.title}</h3>
                  <p className="muted">{activeChild?.name || 'Athlete'} · {selectedVideo.sport || 'Sport'} · {formatDate(selectedVideo.event_date)}</p>
                  {selectedVideo.event_name && <p className="muted">{selectedVideo.event_name}</p>}
                  {selectedVideo.notes && <p>{selectedVideo.notes}</p>}
                  <div className="badge-row">
                    {(selectedVideo.tags || []).map((tag) => <span className="badge" key={tag}>{tag}</span>)}
                    <span className="badge">{sourceLabel(selectedVideo)}</span>
                    {selectedVideo.publish_error && <span className="badge warning">{selectedVideo.publish_error}</span>}
                  </div>
                </div>
                {detailStatus && <p className={`status-message ${detailStatus.type}`} role="status">{detailStatus.message}</p>}
                <div className="detail-actions">
                  <button className="primary-btn" type="button" onClick={handlePlay} disabled={!selectedVideo.youtube_url && !selectedVideo.external_url}>Play</button>
                  <button className="secondary-btn" type="button" onClick={startEditing}>Edit</button>
                  <button className="secondary-btn" type="button" onClick={handleToggleHidden}>{selectedVideo.hidden ? 'Unhide' : 'Hide'}</button>
                  <button className="secondary-btn" type="button" onClick={handleShare}>Share</button>
                </div>
              </>
            ) : (
              <form className="edit-form" onSubmit={handleSaveEdit}>
                <label className="form-field full-width"><span>Title</span><input className="input" value={editForm.title} onChange={handleEditField('title')} required /></label>
                <label className="form-field"><span>Event or opponent</span><input className="input" value={editForm.event_name} onChange={handleEditField('event_name')} /></label>
                <label className="form-field"><span>Sport</span><input className="input" value={editForm.sport} onChange={handleEditField('sport')} required /></label>
                <label className="form-field"><span>Date</span><input className="input" type="date" value={editForm.event_date} onChange={handleEditField('event_date')} required /></label>
                <label className="form-field"><span>Tags</span><input className="input" value={editForm.tags} onChange={handleEditField('tags')} /></label>
                <label className="form-field full-width"><span>Notes</span><textarea className="input textarea" value={editForm.notes} onChange={handleEditField('notes')} /></label>
                {detailStatus && <p className={`status-message ${detailStatus.type}`} role="status">{detailStatus.message}</p>}
                <div className="detail-actions">
                  <button className="primary-btn" type="submit" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save changes'}</button>
                  <button className="secondary-btn" type="button" onClick={() => { setEditForm(null); setEditVideoId(null); }}>Cancel</button>
                </div>
              </form>
            )}
          </section>
        )}
      </main>

      <button className="fab" aria-label="Add a video" type="button" onClick={() => focusAddForm('link')}>+</button>
    </div>
  );
}
