import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './App.css';

const fallbackSports = [
  { id: 'soccer', label: 'Soccer' },
  { id: 'basketball', label: 'Basketball' },
  { id: 'taekwondo', label: 'Taekwondo' },
];

const emptyFilters = {
  athlete_id: '',
  sport_id: '',
  event_type: '',
  result: '',
  tag: '',
  from: '',
  to: '',
};

const today = () => new Date().toISOString().slice(0, 10);

const parseError = async (response) => {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') return body.error;
    return body?.error?.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

const api = async (pathname, options = {}) => {
  const response = await fetch(pathname, { credentials: 'include', ...options });
  if (!response.ok) {
    const error = new Error(await parseError(response));
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
};

const formatDate = (value, options = {}) => {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(date);
};

const eventImage = (event) => {
  if (event.sport?.id === 'taekwondo') return '/assets/generated/thumb-tkd-tournament.png';
  if (event.sport?.id === 'basketball') return '/assets/generated/thumb-noah-basketball.png';
  return '/assets/generated/thumb-emma-soccer.png';
};

const momentImage = (event, moment) => {
  if (event?.sport?.id === 'taekwondo') return '/assets/generated/thumb-tkd-tournament.png';
  if (moment?.kind === 'game') return '/assets/generated/moment-soccer-celebration.png';
  return eventImage(event || {});
};

const resultLabel = (result, event) => {
  if (event?.medal && event.medal !== 'none' && event.medal !== 'unknown') return `${event.placement || ''} ${event.medal}`.trim();
  if (result === 'win') return 'Won';
  if (result === 'loss') return 'Lost';
  if (result === 'draw') return 'Draw';
  if (result === 'dq') return 'Disqualified';
  return 'Result not set';
};

const scoreLabel = (moment) => {
  if (!moment?.score) return '';
  if (moment.score.text) return moment.score.text;
  if (moment.score.for === null || moment.score.for === undefined) return '';
  return `${moment.score.for} - ${moment.score.against}`;
};

const activeFilterCount = (filters) => Object.values(filters).filter(Boolean).length;

function Dialog({ title, description, onClose, children, dialogRef }) {
  const [footerNode, setFooterNode] = useState(null);
  const supportsFooter = isValidElement(children) && typeof children.type === 'function';
  const dialogChild = supportsFooter && footerNode ? cloneElement(children, { dialogFooterNode: footerNode }) : children;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-description' : undefined}
        tabIndex="-1"
      >
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Family space</p>
            <h2 id="dialog-title">{title}</h2>
            {description && <p className="muted" id="dialog-description">{description}</p>}
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <div className="dialog-scroll">{dialogChild}</div>
        {supportsFooter && <div className="dialog-footer" ref={setFooterNode} />}
      </section>
    </div>
  );
}

function Status({ status }) {
  if (!status) return null;
  return <p className={`status-message ${status.type}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</p>;
}

function MomentRow({ event, moment, onOpen }) {
  return (
    <button className="moment-row" type="button" onClick={() => onOpen(moment.id)}>
      <img src={momentImage(event, moment)} alt="" />
      <span className="moment-row-copy">
        <strong>{moment.title}</strong>
        <span>{[moment.opponent_name && `vs. ${moment.opponent_name}`, moment.round_label, moment.period_label, scoreLabel(moment)].filter(Boolean).join(' · ') || 'Moment details'}</span>
      </span>
      <span className="moment-row-meta">{moment.clip_count || 0} {moment.clip_count === 1 ? 'clip' : 'clips'} <span aria-hidden="true">›</span></span>
    </button>
  );
}

function EventCard({ item, onOpenEvent, onOpenMoment }) {
  const { event, moments } = item;
  return (
    <article className={`event-card ${event.hidden ? 'is-hidden' : ''}`}>
      <button className="event-cover" type="button" onClick={() => onOpenEvent(event.id)} aria-label={`Open ${event.name}`}>
        <img src={eventImage(event)} alt="" />
        <span className="cover-shade" />
        <span className="cover-meta">{event.type.replace('_', ' ')} · {event.sport.label}</span>
        {event.hidden && <span className="hidden-flag">Hidden from family</span>}
      </button>
      <div className="event-card-body">
        <div className="event-kicker-row">
          <span className="event-kicker">{event.type === 'tournament' ? 'Tournament' : event.type === 'game' ? 'Game day' : 'Family memory'}</span>
          <span className={`result-mark result-${event.result}`}>{resultLabel(event.result, event)}</span>
        </div>
        <button className="event-title-button" type="button" onClick={() => onOpenEvent(event.id)}>
          <h2>{event.name}</h2>
        </button>
        <p className="event-summary">{event.participants.map(({ name }) => name).join(' + ') || 'Family event'} · {formatDate(event.start_date)}{event.end_date !== event.start_date ? ` - ${formatDate(event.end_date)}` : ''}{event.venue?.name ? ` · ${event.venue.name}` : ''}</p>
        <div className="tag-row">{(event.tags || []).slice(0, 4).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
        <div className="moment-divider"><span>Moments from this event</span><span>{moments.length}</span></div>
        <div className="moment-list">
          {moments.map((moment) => <MomentRow key={moment.id} event={event} moment={moment} onOpen={onOpenMoment} />)}
          {!moments.length && <p className="empty-inline">No moments match these filters yet.</p>}
        </div>
      </div>
    </article>
  );
}

function PinScreen({ pin, setPin, busy, error, onSubmit }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="unlock-title">
        <img src="/assets/logo-icon.svg" alt="" className="auth-logo" />
        <p className="eyebrow">Family space</p>
        <h1 id="unlock-title">Our Team Memories</h1>
        <p className="auth-lede">Enter your family PIN to keep every highlight in the right hands.</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="form-field">
            <span>Family PIN</span>
            <input className="input pin-input" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="Enter your PIN" required autoFocus />
          </label>
          <p className="helper-copy">One PIN for the whole family. Ask the team parent if you need it.</p>
          {error && <p className="status-message error" role="alert">{error}</p>}
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Unlocking...' : 'Unlock memories'}</button>
        </form>
      </section>
    </main>
  );
}

function AddMemoryForm({ mode, athletes, sports, selectedEvent, selectedMoment, onSaved, onCancel, dialogFooterNode }) {
  const formId = useId();
  const [sourceType, setSourceType] = useState('link');
  const [form, setForm] = useState({
    name: '',
    type: 'game',
    sport_id: sports[0]?.id || 'soccer',
    athlete_id: athletes[0]?.id || '',
    start_date: today(),
    end_date: today(),
    title: '',
    occurred_date: today(),
    opponent_name: '',
    opponent_team_name: '',
    score_for: '',
    score_against: '',
    period_label: '',
    round_label: '',
    result: 'unknown',
    external_url: '',
    notes: '',
    tags: '',
    division: '',
    weight_class: '',
    age_group: '',
    belt_division: '',
    opponent_club: '',
    tkd_format: 'sparring',
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const sport = selectedEvent?.sport || selectedMoment?.event?.sport || sports.find((item) => item.id === form.sport_id) || fallbackSports.find((item) => item.id === form.sport_id);
  const isTkd = sport?.id === 'taekwondo';
  const isMoment = mode === 'moment';
  const isClip = mode === 'clip';
  const athleteId = selectedEvent?.participants?.[0]?.id || selectedMoment?.athletes?.[0]?.id || form.athlete_id;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      let eventId = selectedEvent?.id || selectedMoment?.event_id;
      if (!eventId) {
        const createdEvent = await api('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name || form.title,
            type: form.type,
            sport_id: form.sport_id,
            start_date: form.start_date,
            end_date: form.end_date || form.start_date,
            participants: athleteId ? [{ athlete_id: athleteId }] : [],
            tags: form.tags,
            notes: form.notes ? [{ kind: 'summary', body: form.notes }] : [],
          }),
        });
        eventId = createdEvent.id;
      }
      if (isMoment) {
        const sportData = isTkd ? {
          pack: 'tkd.v1',
          division: form.division || undefined,
          weight_class: form.weight_class || undefined,
          age_group: form.age_group || undefined,
          belt_division: form.belt_division || undefined,
          opponent_club: form.opponent_club || undefined,
          format: form.tkd_format,
        } : null;
        const createdMoment = await api(`/api/events/${eventId}/moments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: isTkd ? 'fight' : 'game',
            title: form.title,
            occurred_date: form.occurred_date,
            athlete_ids: athleteId ? [athleteId] : undefined,
            result: form.result,
            score_for: form.score_for || null,
            score_against: form.score_against || null,
            opponent_name: form.opponent_name,
            opponent_team_name: form.opponent_team_name,
            period_label: form.period_label,
            round_label: form.round_label,
            sport_pack: isTkd ? 'tkd.v1' : null,
            sport_data: sportData,
            notes: form.notes ? [{ kind: 'parent', body: form.notes }] : [],
            tags: form.tags,
          }),
        });
        setStatus({ type: 'success', message: `Saved ${createdMoment.title} to the timeline.` });
        await onSaved(eventId, createdMoment.id);
        return;
      }
      if (isClip) {
        const body = new FormData();
        const metadata = {
          source_type: sourceType,
          title: form.title || form.name,
          external_url: form.external_url,
          notes: form.notes ? [{ kind: 'summary', body: form.notes }] : [],
          tags: form.tags,
        };
        body.set('metadata', JSON.stringify(metadata));
        if (file) body.set('file', file);
        const clipPath = selectedMoment?.id ? `/api/moments/${selectedMoment.id}/clips` : `/api/events/${eventId}/clips`;
        const createdClip = await api(clipPath, { method: 'POST', body });
        const honestStatus = createdClip.publish_status === 'mock' ? 'Clip saved as a mock pending memory. YouTube is not connected.' : createdClip.publish_status === 'pending' ? 'Clip saved as a pending memory.' : 'Clip saved to the event.';
        setStatus({ type: 'success', message: honestStatus });
        await onSaved(eventId, null);
        return;
      }
      setStatus({ type: 'success', message: 'Event saved to your timeline.' });
      await onSaved(eventId, null);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form id={formId} className="form-grid" onSubmit={submit}>
        {!selectedEvent && !isClip && <label className="form-field full-width"><span>Event name</span><input className="input" data-dialog-initial-focus="true" value={form.name} onChange={update('name')} placeholder="e.g. Mountain West Open" required /></label>}
        {isClip && !selectedEvent && <label className="form-field full-width"><span>Event name</span><input className="input" data-dialog-initial-focus="true" value={form.name} onChange={update('name')} placeholder="Start with the event" required /></label>}
        {!selectedEvent && <div className="form-grid form-grid-two"><label className="form-field"><span>Sport</span><select className="input" value={form.sport_id} onChange={update('sport_id')}>{sports.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="form-field"><span>Athlete</span><select className="input" value={form.athlete_id} onChange={update('athlete_id')}><option value="">Choose later</option>{athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}</select></label></div>}
        {!selectedEvent && !isClip && <div className="form-grid form-grid-two"><label className="form-field"><span>Event type</span><select className="input" value={form.type} onChange={update('type')}><option value="game">Game</option><option value="tournament">Tournament</option><option value="practice">Practice</option><option value="test">Test</option><option value="camp">Camp or seminar</option></select></label><label className="form-field"><span>Start date</span><input className="input" type="date" value={form.start_date} onChange={update('start_date')} required /></label></div>}
        {!selectedEvent && !isClip && <label className="form-field"><span>End date</span><input className="input" type="date" value={form.end_date} onChange={update('end_date')} required /></label>}
        {(isMoment || isClip) && <label className="form-field full-width"><span>{isMoment ? 'Moment title' : 'Clip title'}</span><input className="input" data-dialog-initial-focus={isMoment ? 'true' : undefined} value={form.title} onChange={update('title')} placeholder={isMoment ? 'e.g. Semi-final - Fight 2' : 'e.g. Full game replay'} required /></label>}
        {isClip && <div className="source-switcher"><button className={`secondary-btn ${sourceType === 'link' ? 'active' : ''}`} type="button" onClick={() => { setSourceType('link'); setFile(null); }}>Paste a link</button><button className={`secondary-btn ${sourceType === 'upload' ? 'active' : ''}`} type="button" onClick={() => setSourceType('upload')}>Upload from phone</button></div>}
        {isClip && sourceType === 'link' && <label className="form-field full-width"><span>Video link</span><input className="input" type="url" value={form.external_url} onChange={update('external_url')} placeholder="https://..." required /></label>}
        {isClip && sourceType === 'upload' && <label className="upload-box form-field full-width"><span>Choose a video file</span><input className="input file-visible" type="file" accept="video/*" aria-label="Choose a video file" onChange={(event) => setFile(event.target.files?.[0] || null)} required /><small>{file ? `${file.name} selected` : 'MP4, MOV or WebM. The saved item will show mock or pending.'}</small></label>}
        {isMoment && <label className="form-field"><span>Date</span><input className="input" type="date" value={form.occurred_date} onChange={update('occurred_date')} required /></label>}
        {isMoment && <div className="form-grid form-grid-two"><label className="form-field"><span>Result</span><select className="input" value={form.result} onChange={update('result')}><option value="unknown">Not set</option><option value="win">Won</option><option value="loss">Lost</option><option value="draw">Draw</option><option value="dq">DQ</option></select></label><label className="form-field"><span>{isTkd ? 'Opponent' : 'Opponent or team'}</span><input className="input" value={form.opponent_name} onChange={update('opponent_name')} placeholder="Name" /></label></div>}
        {isMoment && <div className="form-grid form-grid-two"><label className="form-field"><span>Score for</span><input className="input" inputMode="numeric" value={form.score_for} onChange={update('score_for')} /></label><label className="form-field"><span>Score against</span><input className="input" inputMode="numeric" value={form.score_against} onChange={update('score_against')} /></label></div>}
        {isMoment && !isTkd && <label className="form-field"><span>Period or half</span><input className="input" value={form.period_label} onChange={update('period_label')} placeholder="2nd half or Q3" /></label>}
        {isMoment && isTkd && <fieldset className="sport-pack"><legend>Taekwondo details</legend><div className="form-grid form-grid-two"><label className="form-field"><span>Division</span><input className="input" value={form.division} onChange={update('division')} /></label><label className="form-field"><span>Weight class</span><input className="input" value={form.weight_class} onChange={update('weight_class')} /></label><label className="form-field"><span>Age group</span><input className="input" value={form.age_group} onChange={update('age_group')} /></label><label className="form-field"><span>Belt division</span><input className="input" value={form.belt_division} onChange={update('belt_division')} /></label><label className="form-field"><span>Opponent club</span><input className="input" value={form.opponent_club} onChange={update('opponent_club')} /></label><label className="form-field"><span>Format</span><select className="input" value={form.tkd_format} onChange={update('tkd_format')}><option value="sparring">Sparring</option><option value="poomsae">Poomsae</option></select></label></div></fieldset>}
        {(isMoment || isClip || !selectedEvent) && <><label className="form-field full-width"><span>Notes</span><textarea className="input textarea" value={form.notes} onChange={update('notes')} placeholder="Add the part you want to remember" /></label><label className="form-field full-width"><span>Tags</span><input className="input" value={form.tags} onChange={update('tags')} placeholder="Tournament, highlight" /></label></>}
        <Status status={status} />
      </form>
      {dialogFooterNode && createPortal(<div className="dialog-actions"><button className="secondary-btn" type="button" onClick={onCancel}>Not now</button><button className="primary-btn" type="submit" form={formId} disabled={busy}>{busy ? 'Saving...' : isMoment ? 'Save moment' : isClip ? 'Save clip' : 'Save event'}</button></div>, dialogFooterNode)}
    </>
  );
}

function EditEventForm({ event, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: event.name,
    result: event.result || 'unknown',
    placement: event.placement || '',
    medal: event.medal || 'none',
    notes: event.notes?.[0]?.body || '',
    tags: (event.tags || []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const update = (field) => (input) => setForm((current) => ({ ...current, [field]: input.target.value }));
  const submit = async (input) => {
    input.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await api(`/api/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          result: form.result,
          placement: form.placement,
          medal: form.medal,
          tags: form.tags,
          notes: form.notes ? [{ kind: 'summary', body: form.notes }] : [],
        }),
      });
      await onSaved(event.id, null);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  };
  return <form className="form-grid" onSubmit={submit}><label className="form-field"><span>Event name</span><input className="input" value={form.name} onChange={update('name')} required /></label><div className="form-grid form-grid-two"><label className="form-field"><span>Result</span><select className="input" value={form.result} onChange={update('result')}><option value="unknown">Not set</option><option value="win">Won</option><option value="loss">Lost</option><option value="draw">Draw</option><option value="dq">DQ</option></select></label><label className="form-field"><span>Medal</span><select className="input" value={form.medal} onChange={update('medal')}><option value="none">None</option><option value="gold">Gold</option><option value="silver">Silver</option><option value="bronze">Bronze</option></select></label></div><label className="form-field"><span>Placement</span><input className="input" value={form.placement} onChange={update('placement')} placeholder="2nd" /></label><label className="form-field"><span>Tags</span><input className="input" value={form.tags} onChange={update('tags')} /></label><label className="form-field"><span>Notes</span><textarea className="input textarea" value={form.notes} onChange={update('notes')} /></label><Status status={status} /><div className="dialog-actions"><button className="secondary-btn" type="button" onClick={onCancel}>Cancel</button><button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save event changes'}</button></div></form>;
}

function EditMomentForm({ moment, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: moment.title,
    result: moment.result || 'unknown',
    score_for: moment.score?.for ?? '',
    score_against: moment.score?.against ?? '',
    round_label: moment.round_label || '',
    period_label: moment.period_label || '',
    notes: moment.notes?.[0]?.body || '',
    tags: (moment.tags || []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const update = (field) => (input) => setForm((current) => ({ ...current, [field]: input.target.value }));
  const submit = async (input) => {
    input.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await api(`/api/moments/${moment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          result: form.result,
          score_for: form.score_for === '' ? null : Number(form.score_for),
          score_against: form.score_against === '' ? null : Number(form.score_against),
          round_label: form.round_label,
          period_label: form.period_label,
          tags: form.tags,
          notes: form.notes ? [{ kind: 'summary', body: form.notes }] : [],
        }),
      });
      await onSaved(moment.event_id, moment.id);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  };
  return <form className="form-grid" onSubmit={submit}><label className="form-field"><span>Moment title</span><input className="input" value={form.title} onChange={update('title')} required /></label><label className="form-field"><span>Result</span><select className="input" value={form.result} onChange={update('result')}><option value="unknown">Not set</option><option value="win">Won</option><option value="loss">Lost</option><option value="draw">Draw</option><option value="dq">DQ</option></select></label><div className="form-grid form-grid-two"><label className="form-field"><span>Score for</span><input className="input" inputMode="numeric" value={form.score_for} onChange={update('score_for')} /></label><label className="form-field"><span>Score against</span><input className="input" inputMode="numeric" value={form.score_against} onChange={update('score_against')} /></label></div><label className="form-field"><span>Round or period</span><input className="input" value={form.round_label || form.period_label} onChange={update(moment.kind === 'fight' ? 'round_label' : 'period_label')} /></label><label className="form-field"><span>Tags</span><input className="input" value={form.tags} onChange={update('tags')} /></label><label className="form-field"><span>Notes</span><textarea className="input textarea" value={form.notes} onChange={update('notes')} /></label><Status status={status} /><div className="dialog-actions"><button className="secondary-btn" type="button" onClick={onCancel}>Cancel</button><button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save moment changes'}</button></div></form>;
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [athletes, setAthletes] = useState([]);
  const [sports, setSports] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const authEpochRef = useRef(0);
  const authenticatedRef = useRef(false);
  const lockPendingRef = useRef(false);

  const availableSports = sports.length ? sports : fallbackSports;

  const setLoggedOut = useCallback(() => {
    authEpochRef.current += 1;
    authenticatedRef.current = false;
    setAuthenticated(false);
    setAthletes([]);
    setSports([]);
    setTimeline([]);
    setSelectedEvent(null);
    setSelectedMoment(null);
    setDialog(null);
    setFilters(emptyFilters);
    setPin('');
  }, []);

  const loadTimeline = useCallback(async (nextFilters = filters, nextShowHidden = showHidden) => {
    const requestEpoch = authEpochRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ include_hidden: nextShowHidden ? 'true' : 'false' });
      Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const body = await api(`/api/timeline?${params.toString()}`);
      if (requestEpoch !== authEpochRef.current || !authenticatedRef.current) return;
      setTimeline(body.items || []);
    } catch (error) {
      if (requestEpoch !== authEpochRef.current || !authenticatedRef.current) return;
      if (error.status === 401) setLoggedOut();
      else setLoadError(error.message);
    } finally {
      if (requestEpoch === authEpochRef.current) setLoading(false);
    }
  }, [filters, showHidden, setLoggedOut]);

  const loadCatalog = useCallback(async () => {
    const requestEpoch = authEpochRef.current;
    try {
      const [athleteResponse, sportResponse] = await Promise.all([api('/api/athletes'), api('/api/sports')]);
      if (requestEpoch !== authEpochRef.current || !authenticatedRef.current) return;
      setAthletes(athleteResponse.items || []);
      setSports(sportResponse);
      await loadTimeline();
    } catch (error) {
      if (requestEpoch !== authEpochRef.current || !authenticatedRef.current) return;
      if (error.status === 401) setLoggedOut();
      else setLoadError(error.message);
    }
  }, [loadTimeline, setLoggedOut]);

  useEffect(() => {
    let cancelled = false;
    api('/api/me').then((body) => {
      if (!cancelled) {
        authenticatedRef.current = Boolean(body.authenticated);
        setAuthenticated(Boolean(body.authenticated));
      }
    }).catch((error) => {
      if (!cancelled) setAuthError(error.message);
    }).finally(() => {
      if (!cancelled) setAuthChecked(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authenticated) loadCatalog();
  }, [authenticated, loadCatalog]);

  useEffect(() => {
    if (!dialog) return undefined;
    previousFocusRef.current = document.activeElement;
    const backdrop = dialogRef.current?.closest('.dialog-backdrop');
    const backgroundNodes = [...document.querySelectorAll('.app > *')]
      .filter((node) => node !== backdrop)
      .map((node) => ({ node, inert: node.inert }));
    backgroundNodes.forEach(({ node }) => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    const focusable = () => [...dialogRef.current?.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])') || []].filter((element) => !element.disabled);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDialog(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    window.setTimeout(() => {
      const preferred = dialogRef.current?.querySelector('[data-dialog-initial-focus="true"]');
      const first = preferred && !preferred.disabled ? preferred : focusable()[0];
      if (first) first.focus();
      else dialogRef.current?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      backgroundNodes.forEach(({ node, inert }) => { node.inert = inert; });
      previousFocusRef.current?.focus?.();
    };
  }, [dialog]);

  const handleUnlock = async (event) => {
    event.preventDefault();
    if (lockPendingRef.current) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      await api('/api/auth/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      authEpochRef.current += 1;
      authenticatedRef.current = true;
      setPin('');
      setAuthenticated(true);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLock = async () => {
    if (lockPendingRef.current) return;
    lockPendingRef.current = true;
    setAuthBusy(true);
    setAuthError('');
    setLoggedOut();
    try {
      await api('/api/auth/lock', { method: 'POST' });
    } catch (error) {
      setAuthError(`Locked locally, but server logout failed: ${error.message}`);
    } finally {
      lockPendingRef.current = false;
      setAuthBusy(false);
    }
  };

  const openEvent = async (id) => {
    try {
      setSelectedEvent(await api(`/api/events/${id}?include_hidden=true`));
      setSelectedMoment(null);
      setDialog('event');
    } catch (error) {
      setLoadError(error.message);
    }
  };

  const openMoment = async (id) => {
    try {
      setSelectedMoment(await api(`/api/moments/${id}?include_hidden=true`));
      setSelectedEvent(null);
      setDialog('moment');
    } catch (error) {
      setLoadError(error.message);
    }
  };

  const closeDialog = () => {
    setDialog(null);
    setSelectedEvent(null);
    setSelectedMoment(null);
  };

  const refreshAfterSave = async (eventId, momentId) => {
    await loadTimeline();
    if (eventId) setSelectedEvent(await api(`/api/events/${eventId}?include_hidden=true`));
    if (momentId) setSelectedMoment(await api(`/api/moments/${momentId}?include_hidden=true`));
    setDialog(eventId ? (momentId ? 'moment' : 'event') : null);
  };

  const toggleEventHidden = async () => {
    if (!selectedEvent) return;
    await api(`/api/events/${selectedEvent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !selectedEvent.hidden }) });
    await refreshAfterSave(selectedEvent.id, null);
  };

  const toggleMomentHidden = async () => {
    if (!selectedMoment) return;
    await api(`/api/moments/${selectedMoment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !selectedMoment.hidden }) });
    await refreshAfterSave(selectedMoment.event_id, selectedMoment.id);
  };

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => {
    setFilters(emptyFilters);
    setShowHidden(false);
    setDialog(null);
    loadTimeline(emptyFilters, false);
  };

  if (!authChecked) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Family space</p><h1>Checking your memories...</h1></section></main>;
  if (!authenticated) return <PinScreen pin={pin} setPin={setPin} busy={authBusy} error={authError} onSubmit={handleUnlock} />;

  const addDialog = dialog === 'add-event' || dialog === 'add-moment' || dialog === 'add-clip';
  const dialogTitle = dialog === 'filters' ? 'Find a memory' : dialog === 'event' ? selectedEvent?.name : dialog === 'moment' ? selectedMoment?.title : dialog === 'add-event' ? 'Start with an event' : dialog === 'add-moment' ? 'Log a moment' : dialog === 'add-clip' ? 'Add a clip first' : '';

  return (
    <div className="app">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Our Team Memories home"><img src="/assets/logo-icon.svg" alt="" /><span><strong>Our Team Memories</strong><small>Family highlights, kept close</small></span></a>
        <div className="header-actions"><span className="sync-note">Saved from your family space</span><button className="secondary-btn" type="button" onClick={handleLock}>Lock</button></div>
      </header>
      <main id="top" className="timeline-main">
        <section className="hero-panel">
          <div className="hero-copy"><p className="eyebrow">Your family, in motion</p><h1>Our highlights</h1><p>The games, fights, and little wins worth keeping close.</p><div className="hero-actions"><button className="primary-btn" type="button" onClick={() => setDialog('add-event')}>Add a memory</button><button className="secondary-btn" type="button" onClick={() => setDialog('add-clip')}>Add a clip first</button></div></div>
          <div className="hero-visual"><img src="/assets/generated/hero-family-multisport.png" alt="A parent filming children playing different sports" /><span>Every effort has a place here.</span></div>
        </section>
        <section className="filter-bar" aria-label="Timeline filters">
          <div className="athlete-tabs" role="tablist" aria-label="Choose an athlete"><button className={!filters.athlete_id ? 'active' : ''} type="button" role="tab" aria-selected={!filters.athlete_id} onClick={() => { updateFilter('athlete_id', ''); loadTimeline({ ...filters, athlete_id: '' }); }}>All family</button>{athletes.map((athlete) => <button className={filters.athlete_id === athlete.id ? 'active' : ''} key={athlete.id} type="button" role="tab" aria-selected={filters.athlete_id === athlete.id} onClick={() => { updateFilter('athlete_id', athlete.id); loadTimeline({ ...filters, athlete_id: athlete.id }); }}>{athlete.name}</button>)}</div>
          <div className="filter-controls"><div className="chips" aria-label="Quick sports"><button className={!filters.sport_id ? 'chip active' : 'chip'} type="button" aria-pressed={!filters.sport_id} onClick={() => { updateFilter('sport_id', ''); loadTimeline({ ...filters, sport_id: '' }); }}>All sports</button>{availableSports.map((sport) => <button className={filters.sport_id === sport.id ? 'chip active' : 'chip'} type="button" aria-pressed={filters.sport_id === sport.id} key={sport.id} onClick={() => { updateFilter('sport_id', sport.id); loadTimeline({ ...filters, sport_id: sport.id }); }}>{sport.label}</button>)}</div><button className="secondary-btn filter-btn" type="button" onClick={() => setDialog('filters')}>Filters{activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ''}</button></div>
        </section>
        <Status status={loadError ? { type: 'error', message: loadError } : null} />
        {loading && <div className="loading-state" role="status">Loading your memories...</div>}
        {!loading && !timeline.length && <section className="empty-state card"><img src="/assets/generated/empty-state-memories.png" alt="A warm family memory waiting to be saved" /><div><p className="eyebrow">A new chapter</p><h2>{activeFilterCount(filters) ? 'No highlights match those filters' : 'Your first highlight starts here'}</h2><p>Try a different sport or add a game, fight, or small moment and we will keep it easy to find.</p><button className="primary-btn" type="button" onClick={() => activeFilterCount(filters) ? clearFilters() : setDialog('add-event')}>{activeFilterCount(filters) ? 'Clear filters' : 'Add a memory'}</button></div></section>}
        <section className="timeline-list" aria-live="polite">{timeline.map((item) => <div className="timeline-group" key={item.event.id}><div className="date-rail"><strong>{formatDate(item.event.start_date, { weekday: 'long' })}</strong><span>{item.event.start_date === today() ? 'Today' : 'Saved memory'}</span></div><EventCard item={item} onOpenEvent={openEvent} onOpenMoment={openMoment} /></div>)}</section>
      </main>
      {dialog === 'filters' && <Dialog title="Find a memory" description="Filters stay simple and can be cleared anytime." onClose={closeDialog} dialogRef={dialogRef}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); setDialog(null); loadTimeline(); }}><label className="form-field"><span>Child</span><select className="input" value={filters.athlete_id} onChange={(event) => updateFilter('athlete_id', event.target.value)}><option value="">All children</option>{athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}</select></label><label className="form-field"><span>Sport</span><select className="input" value={filters.sport_id} onChange={(event) => updateFilter('sport_id', event.target.value)}><option value="">All sports</option>{availableSports.map((sport) => <option key={sport.id} value={sport.id}>{sport.label}</option>)}</select></label><label className="form-field"><span>Event type</span><select className="input" value={filters.event_type} onChange={(event) => updateFilter('event_type', event.target.value)}><option value="">Any event type</option><option value="game">Game</option><option value="tournament">Tournament</option><option value="practice">Practice</option><option value="test">Test</option></select></label><label className="form-field"><span>Result</span><select className="input" value={filters.result} onChange={(event) => updateFilter('result', event.target.value)}><option value="">Any result</option><option value="win">Won</option><option value="loss">Lost</option><option value="draw">Draw</option></select></label><label className="form-field"><span>Tag</span><input className="input" value={filters.tag} onChange={(event) => updateFilter('tag', event.target.value)} placeholder="medal or highlight" /></label><div className="form-grid form-grid-two"><label className="form-field"><span>From</span><input className="input" type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label><label className="form-field"><span>To</span><input className="input" type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></label></div><label className="check-row"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> Show hidden family memories</label><div className="dialog-actions"><button className="secondary-btn" type="button" onClick={clearFilters}>Clear</button><button className="primary-btn" type="submit">Show memories</button></div></form></Dialog>}
      {addDialog && <Dialog title={dialogTitle} description={dialog === 'add-event' ? 'Start with the part you have. Add the rest when it feels easy. Scroll for more fields.' : 'Start with the part you have. Add the rest when it feels easy.'} onClose={closeDialog} dialogRef={dialogRef}><AddMemoryForm mode={dialog.replace('add-', '')} athletes={athletes} sports={availableSports} selectedEvent={selectedEvent} selectedMoment={selectedMoment} onSaved={refreshAfterSave} onCancel={closeDialog} /></Dialog>}
      {dialog === 'edit-event' && selectedEvent && <Dialog title="Edit event" description="Keep the family story accurate." onClose={closeDialog} dialogRef={dialogRef}><EditEventForm event={selectedEvent} onSaved={refreshAfterSave} onCancel={() => setDialog('event')} /></Dialog>}
      {dialog === 'edit-moment' && selectedMoment && <Dialog title="Edit moment" description="Update the details without losing the clip." onClose={closeDialog} dialogRef={dialogRef}><EditMomentForm moment={selectedMoment} onSaved={refreshAfterSave} onCancel={() => setDialog('moment')} /></Dialog>}
      {dialog === 'event' && selectedEvent && <Dialog title={selectedEvent.name} description={`${selectedEvent.type} · ${selectedEvent.sport.label}`} onClose={closeDialog} dialogRef={dialogRef}><div className="detail-hero"><img src={eventImage(selectedEvent)} alt="" /><div><p className="eyebrow">{selectedEvent.participants.map(({ name }) => name).join(' + ') || 'Family event'}</p><h3>{resultLabel(selectedEvent.result, selectedEvent)}</h3><p>{formatDate(selectedEvent.start_date)}{selectedEvent.end_date !== selectedEvent.start_date ? ` - ${formatDate(selectedEvent.end_date)}` : ''} · {selectedEvent.venue?.name || 'Venue not set'}</p></div></div><div className="detail-section"><div className="section-heading"><div><p className="eyebrow">Event clips</p><h3>{selectedEvent.event_clips?.length || 0} clips across the day</h3></div><button className="secondary-btn" type="button" onClick={() => setDialog('add-clip')}>Add clip</button></div><div className="clip-strip">{(selectedEvent.event_clips || []).map((clip) => <div className="clip-thumb" key={clip.id}><img src={clip.thumbnail_url || eventImage(selectedEvent)} alt="" /><span>{clip.publish_status === 'mock' ? 'Mock upload' : clip.publish_status}</span></div>)}</div></div><div className="detail-section"><div className="section-heading"><div><p className="eyebrow">Moments in order</p><h3>{selectedEvent.moments.length} moments</h3></div><button className="secondary-btn" type="button" onClick={() => setDialog('add-moment')}>Add a moment</button></div><div className="detail-moments">{selectedEvent.moments.map((moment) => <MomentRow key={moment.id} event={selectedEvent} moment={moment} onOpen={openMoment} />)}</div></div><div className="tag-row">{selectedEvent.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>{selectedEvent.notes.map((note) => <p className="parent-note" key={note.id}>{note.body}</p>)}<div className="dialog-actions"><button className="secondary-btn" type="button" onClick={() => setDialog('edit-event')}>Edit event</button><button className="secondary-btn" type="button" onClick={toggleEventHidden}>{selectedEvent.hidden ? 'Show to family' : 'Hide from family'}</button><button className="primary-btn" type="button" onClick={() => setDialog('add-moment')}>Save another moment</button></div></Dialog>}
      {dialog === 'moment' && selectedMoment && <Dialog title={selectedMoment.title} description={`${selectedMoment.event?.name || 'Event'} · ${formatDate(selectedMoment.occurred_date)}`} onClose={closeDialog} dialogRef={dialogRef}><div className="player-preview"><img src={momentImage(selectedMoment.event, selectedMoment)} alt="" /><span>Video preview</span><button className="play-button" type="button" aria-label="Play video preview">▶</button></div><div className="moment-detail-copy"><p className="eyebrow">{selectedMoment.kind === 'fight' ? 'Fight details' : 'Game details'}</p><h3>{resultLabel(selectedMoment.result)} {scoreLabel(selectedMoment) && `· ${scoreLabel(selectedMoment)}`}</h3><p>{[selectedMoment.opponent_name && `Opponent: ${selectedMoment.opponent_name}`, selectedMoment.opponent_team_name && `Team: ${selectedMoment.opponent_team_name}`, selectedMoment.round_label && `Round: ${selectedMoment.round_label}`, selectedMoment.period_label && `Period: ${selectedMoment.period_label}`].filter(Boolean).join(' · ')}</p>{selectedMoment.sport_pack === 'tkd.v1' && <div className="pack-facts"><strong>Taekwondo details</strong><span>{[selectedMoment.sport_data?.division, selectedMoment.sport_data?.weight_class, selectedMoment.sport_data?.age_group, selectedMoment.sport_data?.format].filter(Boolean).join(' · ')}</span></div>}{selectedMoment.notes?.map((note) => <p className="parent-note" key={note.id}>{note.body}</p>)}<div className="tag-row">{(selectedMoment.tags || []).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div></div><div className="dialog-actions"><button className="secondary-btn" type="button" onClick={() => setDialog('edit-moment')}>Edit moment</button><button className="secondary-btn" type="button" onClick={toggleMomentHidden}>{selectedMoment.hidden ? 'Show to family' : 'Hide from family'}</button><button className="primary-btn" type="button" onClick={() => setDialog('add-clip')}>Add a clip</button></div></Dialog>}
    </div>
  );
}
