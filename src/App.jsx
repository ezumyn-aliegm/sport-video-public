import { useState } from 'react';
import './App.css';

const childrenSeed = [
  {
    id: 'child_1',
    name: 'Emma',
    sport: 'Soccer',
    team: 'Blue Hawks',
    clips: 5,
    avatar: '/assets/child-avatar-default.svg',
  },
  {
    id: 'child_2',
    name: 'Noah',
    sport: 'Basketball',
    team: 'Sunset Sparks',
    clips: 3,
    avatar: '/assets/child-avatar-default.svg',
  },
];

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

const videosSeed = [
  {
    id: 'vid_1',
    childId: 'child_1',
    title: 'Quick corner kick goal',
    subtitle: 'vs. Tigers · Jan 15',
    sport: 'Soccer',
    duration: '0:32',
    hidden: false,
    thumb: '/assets/demo/video-thumb-demo-1.svg',
    sourceType: 'link',
    url: 'https://example.invalid/demo/soccer',
  },
  {
    id: 'vid_2',
    childId: 'child_1',
    title: 'Practice: dribble drills',
    subtitle: 'Team practice · Feb 02',
    sport: 'Soccer',
    duration: '1:12',
    hidden: true,
    thumb: '/assets/demo/video-thumb-demo-2.svg',
    sourceType: 'upload',
    url: 'https://youtube.com/watch?v=mock_demo_upload',
  },
  {
    id: 'vid_3',
    childId: 'child_2',
    title: 'Fast break finish',
    subtitle: 'vs. North Stars · Mar 03',
    sport: 'Basketball',
    duration: '0:48',
    hidden: false,
    thumb: '/assets/demo/video-thumb-demo-3.svg',
    sourceType: 'link',
    url: 'https://example.invalid/demo/basketball',
  },
];

const sports = ['All sports', 'Soccer', 'Basketball', 'Baseball'];

export default function App() {
  const [activeChild, setActiveChild] = useState(childrenSeed[0]);
  const [activeSport, setActiveSport] = useState('All sports');

  const filteredVideos = videosSeed.filter((video) => {
    const matchesChild = video.childId === activeChild.id;
    const matchesSport = activeSport === 'All sports' || video.sport === activeSport;
    return matchesChild && matchesSport;
  });

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <img src="/assets/logo-icon.svg" alt="Logo" />
          <div>
            <h1>Our Team Memories</h1>
            <div className="pin-pill">Family PIN enabled</div>
          </div>
        </div>
        <button className="secondary-btn">Lock</button>
      </header>

      <section className="section">
        <div className="hero">
          <div>
            <h2>Whose highlights?</h2>
            <p className="muted">
              Add or upload a clip in under a minute. Everything stays organized by child and sport.
            </p>
            <div className="hero-actions">
              <button className="primary-btn">Add a video</button>
              <button className="secondary-btn">Paste a link</button>
            </div>
          </div>
          <img src="/assets/hero-empty-state.svg" alt="Highlights" className="hero-art" />
        </div>

        <div className="child-grid">
          {childrenSeed.map((child) => (
            <button
              key={child.id}
              className="child-card"
              onClick={() => setActiveChild(child)}
              type="button"
            >
              <img src={child.avatar} alt={child.name} />
              <div className="child-info">
                <h3>{child.name}</h3>
                <p>
                  {child.sport} · {child.team}
                </p>
              </div>
              <span className="child-badge">{child.clips} clips</span>
            </button>
          ))}
        </div>
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

      <section className="section">
        <div className="top-bar">
          <div>
            <h2>{activeChild.name}'s clips</h2>
            <p style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
              Tap a clip to play or edit. Hidden clips stay private.
            </p>
          </div>
          <button className="primary-btn">Add video</button>
        </div>

        <div className="chips">
          {sports.map((sport) => (
            <button
              key={sport}
              type="button"
              className={`chip ${activeSport === sport ? 'active' : ''}`}
              onClick={() => setActiveSport(sport)}
            >
              {sport}
            </button>
          ))}
        </div>

        <div className="video-grid">
          {filteredVideos.map((video) => (
            <div key={video.id} className="video-card">
              <div className="video-thumb">
                <img src={video.thumb} alt={video.title} />
                <div className="play">▶</div>
                <div className="video-duration">{video.duration}</div>
                {video.hidden && <div className="hidden-flag">Hidden</div>}
              </div>
              <div className="video-body">
                <h4>{video.title}</h4>
                <p>{video.subtitle}</p>
                <div className="badge-row">
                  <span className="badge">{video.sport}</span>
                  <span className="badge">
                    {video.sourceType === 'upload' ? 'Demo link (YouTube not connected)' : 'Link'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section card">
        <h2>Add a video</h2>
        <div className="form-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <button className="secondary-btn">Paste a link</button>
          <button className="secondary-btn">Upload from phone</button>
        </div>
        <div className="upload-box">
          <img src="/assets/upload-placeholder.svg" alt="Upload" />
          <strong>Tap to choose video</strong>
          <p style={{ margin: '8px 0 0', color: 'var(--color-ink-muted)' }}>
            MP4, MOV up to 500MB
          </p>
        </div>
        <div className="form-grid" style={{ marginTop: 'var(--space-4)' }}>
          <input className="input" placeholder="https://..." />
          <input className="input" placeholder="What happened?" />
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <select className="input" defaultValue="Emma">
              <option>Emma</option>
              <option>Noah</option>
            </select>
            <select className="input" defaultValue="Soccer">
              <option>Soccer</option>
              <option>Basketball</option>
              <option>Baseball</option>
            </select>
          </div>
          <input className="input" type="date" defaultValue="2026-01-15" />
          <textarea className="input textarea" placeholder="Any notes? (optional)" />
          <input className="input" placeholder="Tags (comma separated)" />
        </div>
        <div className="footer-actions" style={{ marginTop: 'var(--space-4)' }}>
          <div className="note">Keep private for now</div>
          <button className="primary-btn">Save to Emma's highlights</button>
        </div>
      </section>

      <section className="section card">
        <h2>Video detail</h2>
        <div className="video-thumb" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <img src="/assets/demo/video-thumb-demo-1.svg" alt="Preview" />
          <div className="play">▶</div>
        </div>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <h3 style={{ margin: 0 }}>Quick corner kick goal</h3>
          <p style={{ margin: '4px 0', color: 'var(--color-ink-muted)' }}>
            Emma · Soccer · Jan 15
          </p>
          <p style={{ margin: 0 }}>
            Final minute winner from the left corner. Crowd went wild.
          </p>
          <div className="badge-row">
            <span className="badge">Tournament</span>
            <span className="badge">Highlight</span>
          </div>
        </div>
        <div className="detail-actions" style={{ marginTop: 'var(--space-4)' }}>
          <button className="primary-btn">Play</button>
          <button className="secondary-btn">Edit</button>
          <button className="secondary-btn">Hide</button>
          <button className="secondary-btn">Share</button>
        </div>
      </section>

      <button className="fab" aria-label="Add">+</button>
    </div>
  );
}
