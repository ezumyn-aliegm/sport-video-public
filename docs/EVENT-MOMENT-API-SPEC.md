# Sport Video v0.2.0 — Event → Moment → Clip domain, SQLite migration, and API contract

Status: implementation-ready specification
Scope: multi-sport family timeline; Taekwondo (TKD) is a sport pack, not a separate product
Compatibility target: current Express + SQLite app (`children`, `sports`, `videos`, `settings`)
Auth target: existing family PIN + `express-session` cookie behavior

## 0. Decisions at a glance

1. **Family is a persisted tenant boundary.** A database normally contains one family, seeded as `family_default`; the family PIN remains an environment-held bcrypt hash and is never stored in SQLite. Every new domain row carries or derives a `family_id`.
2. **Athlete is the canonical name for the current `children` table.** The migration renames `children` to `athletes` without changing existing IDs, keeps the old columns needed by compatibility clients, and exposes a read-only `children` view after cutover. Existing `child_1`/`child_2` IDs therefore remain valid opaque athlete IDs.
3. **An athlete can play many sports.** `athlete_sports` is the authoritative athlete/sport relationship. The legacy `athletes.sport` and `athletes.team` columns are compatibility fields only.
4. **An event has exactly one sport and zero or more participating athletes.** An event can initially be created without participants so an event-first capture wizard can save the container before the athlete is selected.
5. **A moment belongs to exactly one event and can involve one or more of that event's athletes.** `moment_athletes` supports team games without forcing a single-child model; service validation requires every moment athlete to be an event participant.
6. **A clip always has an event owner and optionally a moment owner.** `clips.event_id` is always non-null. `moment_id IS NULL` means event-level clip; a non-null `moment_id` means moment-level clip. A database trigger and service validation require the moment's `event_id` to equal `clips.event_id`. There is no polymorphic or ambiguous target column.
7. **Notes are normalized; tags are normalized.** Notes are one-to-many rows with a target FK (event, moment, or clip). Tags are family-scoped and joined through typed join tables. API responses always return notes and tags as arrays.
8. **Hidden is reversible and non-destructive.** `hidden=1` is excluded by default. Hiding a parent creates inherited effective hidden state in reads but does not overwrite child flags. Hard delete is explicit and transactional; the UI should expose hide, not an accidental hard delete.
9. **Existing flat videos are not deleted.** Each legacy video is mapped to one event, one moment, and one clip. The old `videos` table stays during v0.2.0 for compatibility and rollback/export; canonical routes read the new tables.
10. **No live scoring, analytics, or sport-specific table explosion.** Typed common fields cover timeline/filter needs. TKD fields live in a validated `sport_data_json` pack; unknown future sports can use the base model without TKD columns.

## 1. Domain vocabulary and invariants

### 1.1 Hierarchy

```text
Family (authenticated shared PIN)
└── Athlete (child; many sports)
    └── Sport profile / filter
        └── Event / Tournament (one sport; one day or date range)
            └── Moment (fight, game, performance, drill, highlight, etc.)
                └── Clip(s)
```

An event-level clip is a clip of the event as a whole (for example, a tournament opening montage). A moment-level clip is a clip of one fight/game/performance. Event-level clips never acquire a fake moment owner merely to satisfy a foreign key.

### 1.2 Required ownership rules

- Every athlete, event, moment, clip, note, and tag join is scoped to the authenticated family.
- `events.sport_id` is the source of truth for all moments in that event. A moment does not duplicate `sport_id`.
- `events.start_date` and `events.end_date` are local calendar dates. A one-day event has equal dates.
- `moments.occurred_date` is required even when time is unknown. `moments.occurred_at` is optional and, when present, is a UTC ISO-8601 instant; `moments.timezone` preserves the local interpretation.
- A moment date must fall within the event date range. A migrated/legacy row uses the event date when no better value exists.
- `event_athletes` is the event participation set. `moment_athletes` must be a subset of it.
- A clip's `event_id` is always the owning event. If `moment_id` is present, that moment must belong to the same event and family.
- `hidden` is an integer `0|1` in SQLite and a boolean in JSON.
- IDs are opaque text IDs. New IDs use `fam_`, `ath_`, `evt_`, `mom_`, `clip_`, `note_`, and `tag_` prefixes; old `child_*`, `vid_*`, and UUID IDs are retained exactly.

## 2. Canonical SQLite schema

The following is the logical target schema. A migration may rebuild a table where SQLite cannot add a constraint in place, but must preserve all source values and IDs. All timestamps are stored as UTC ISO-8601 strings (`YYYY-MM-DDTHH:mm:ss.sssZ`). All date-only values are strict `YYYY-MM-DD` strings.

### 2.1 `schema_migrations`

| Column | Type / rule | Purpose |
|---|---|---|
| `version` | `TEXT PRIMARY KEY` | Ordered migration ID, for example `2026-08-08-event-moment-v1` |
| `checksum` | `TEXT NOT NULL` | Hash of migration definition |
| `applied_at` | `TEXT NOT NULL` | UTC completion timestamp |
| `backfill_counts_json` | `TEXT` | Auditable counts, never secrets/PII |

### 2.2 `families`

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `family_default` for the current single-family deployment |
| `display_name` | `TEXT NOT NULL` | From current `settings.family_name`, default `Our Team` |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Audit timestamps |

The family PIN hash remains `FAMILY_PIN_HASH` in the environment. Do not add PINs, sessions, or bcrypt hashes to this table.

### 2.3 `athletes` (renamed from current `children`)

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Existing child ID preserved; new IDs `ath_...` |
| `family_id` | `TEXT NOT NULL FK families(id) ON DELETE CASCADE` | Tenant boundary |
| `name` | `TEXT NOT NULL` | 1–120 Unicode characters after trim |
| `photo_url` | `TEXT` | Optional future-safe image URL; no PII requirement |
| `archived` | `INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))` | Reversible athlete retirement |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |
| `sport` | `TEXT` | **Legacy compatibility only**; old label such as `Soccer` |
| `team` | `TEXT` | **Legacy compatibility only** |
| `color` | `TEXT` | **Legacy compatibility only** |

The existing `sport`, `team`, and `color` columns are retained during v0.2.0 so old responses and rollback code do not lose data. New code reads `athlete_sports`.

### 2.4 `sports`

Existing IDs are retained (`soccer`, `basketball`, `baseball`, `swim`).

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Stable slug, e.g. `taekwondo` |
| `label` | `TEXT NOT NULL` | Display label |
| `sort_order` | `INTEGER NOT NULL` | UI ordering |
| `is_active` | `INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))` | Hide from new forms without deleting history |
| `created_at`, `updated_at` | `TEXT` | Backfilled for existing rows |

`id`/`slug` is the canonical API value. Labels are display-only and must not be used as foreign keys.

### 2.5 `athlete_sports`

| Column | Type / rule | Purpose |
|---|---|---|
| `athlete_id` | `TEXT NOT NULL FK athletes(id) ON DELETE CASCADE` | Athlete |
| `sport_id` | `TEXT NOT NULL FK sports(id) ON DELETE RESTRICT` | Sport |
| `is_primary` | `INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1))` | Primary display sport, not an ownership constraint |
| `team_name` | `TEXT` | Team name for soccer/basketball/etc. |
| `club_name` | `TEXT` | Club/dojang when useful |
| `belt_rank` | `TEXT` | Optional profile summary, not a TKD-only required field |
| `age_group` | `TEXT` | Optional known profile value |
| `weight_class` | `TEXT` | Optional known profile value |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |

Primary key: `(athlete_id, sport_id)`. At most one `is_primary=1` per athlete, enforced with a partial unique index.

### 2.6 `events`

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `evt_...` or deterministic legacy ID |
| `family_id` | `TEXT NOT NULL FK families(id) ON DELETE CASCADE` | Tenant |
| `sport_id` | `TEXT NOT NULL FK sports(id) ON DELETE RESTRICT` | One sport per event |
| `name` | `TEXT NOT NULL` | Tournament, game, practice, etc. |
| `type` | `TEXT NOT NULL CHECK (type IN ('tournament','game','practice','test','camp','seminar','other'))` | Stable v0.2 enum |
| `start_date` | `TEXT NOT NULL` | Local date |
| `end_date` | `TEXT NOT NULL` | Local date; `end_date >= start_date` |
| `timezone` | `TEXT NOT NULL DEFAULT 'UTC'` | IANA timezone for local dates/times |
| `venue_name` | `TEXT` | Gym, field, venue, dojang |
| `location_city` | `TEXT` | City |
| `location_region` | `TEXT` | State/province/region |
| `location_country` | `TEXT` | Optional ISO-3166 alpha-2 |
| `result` | `TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('win','loss','draw','dq','unknown'))` | Family/event summary result; do not infer from placement |
| `placement` | `TEXT` | `1st`, `2nd`, `top 8`, etc. |
| `medal` | `TEXT NOT NULL DEFAULT 'none' CHECK (medal IN ('gold','silver','bronze','none','unknown'))` | Event-level medal summary |
| `hidden` | `INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1))` | Reversible event hide |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |

Event-level `result`, `placement`, and `medal` are summaries. When a multi-athlete event has different outcomes, use the corresponding fields on `event_athletes` as the authoritative per-athlete values and leave the event summary `unknown`/`none` if no single summary is honest.

Notes and tags are in `notes` and `event_tags`; they are intentionally not duplicated as JSON columns on `events`.

### 2.7 `event_athletes`

| Column | Type / rule | Purpose |
|---|---|---|
| `event_id` | `TEXT NOT NULL FK events(id) ON DELETE CASCADE` | Event |
| `athlete_id` | `TEXT NOT NULL FK athletes(id) ON DELETE RESTRICT` | Participant |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` | Stable UI order |
| `result` | `TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('win','loss','draw','dq','unknown'))` | Participant's event result |
| `placement` | `TEXT` | Participant's placement |
| `medal` | `TEXT NOT NULL DEFAULT 'none' CHECK (medal IN ('gold','silver','bronze','none','unknown'))` | Participant's medal |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |

Primary key: `(event_id, athlete_id)`. `event_id` and `athlete_id` must belong to the same family; enforce in service transaction (and a trigger if the implementation uses denormalized `family_id`).

### 2.8 `moments`

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `mom_...` or deterministic legacy ID |
| `family_id` | `TEXT NOT NULL FK families(id) ON DELETE CASCADE` | Tenant/query key |
| `event_id` | `TEXT NOT NULL FK events(id) ON DELETE CASCADE` | Parent event |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('fight','game','performance','drill','test','highlight','other'))` | Generic container kind |
| `title` | `TEXT NOT NULL` | Human-readable moment title |
| `occurred_date` | `TEXT NOT NULL` | Local calendar date |
| `occurred_at` | `TEXT` | Optional UTC instant when time is known |
| `timezone` | `TEXT NOT NULL` | IANA timezone; normally inherited from event |
| `sort_order` | `INTEGER NOT NULL DEFAULT 0` | Explicit child order within event |
| `result` | `TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('win','loss','draw','dq','unknown'))` | Common result vocabulary |
| `score_for` | `INTEGER` | Non-negative numeric score for the athlete/team |
| `score_against` | `INTEGER` | Non-negative numeric opponent score |
| `score_text` | `TEXT` | Non-numeric score representation, mutually exclusive with numeric pair |
| `opponent_name` | `TEXT` | Person or opposing side display name |
| `opponent_team_name` | `TEXT` | Optional team name for team sports |
| `round_label` | `TEXT` | `prelim`, `quarterfinal`, `semi`, `final`, etc. |
| `period_label` | `TEXT` | `Q3`, `2nd half`, `set 2`, etc. |
| `bout_number` | `INTEGER` | TKD bout number when known; null for non-bouts |
| `sport_pack` | `TEXT` | `tkd.v1` or null in v0.2.0 |
| `sport_data_json` | `TEXT` | Validated JSON object; max 16 KB |
| `hidden` | `INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1))` | Reversible moment hide |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |

Checks: `score_for` and `score_against` are both null or both non-negative integers; `score_text` is null when the numeric pair is present. `family_id` must equal the parent event family. `occurred_date` must be in the event's date range.

### 2.9 `moment_athletes`

| Column | Type / rule | Purpose |
|---|---|---|
| `moment_id` | `TEXT NOT NULL FK moments(id) ON DELETE CASCADE` | Moment |
| `athlete_id` | `TEXT NOT NULL FK athletes(id) ON DELETE RESTRICT` | Athlete involved |
| `role` | `TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('primary','participant'))` | Primary athlete or team participant |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` | Stable ordering |

Primary key: `(moment_id, athlete_id)`. Exactly one `primary` role is recommended for individual moments; team moments may have multiple `participant` rows and one optional primary. The API rejects a moment athlete not present in `event_athletes`.

### 2.10 `clips`

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `clip_...` or compatibility alias |
| `family_id` | `TEXT NOT NULL FK families(id) ON DELETE CASCADE` | Tenant |
| `event_id` | `TEXT NOT NULL FK events(id) ON DELETE CASCADE` | Always present; unambiguous owner |
| `moment_id` | `TEXT FK moments(id) ON DELETE CASCADE` | Null for event-level, set for moment-level |
| `title` | `TEXT NOT NULL` | Clip display title |
| `source_type` | `TEXT NOT NULL CHECK (source_type IN ('link','upload'))` | Link or local/upload flow |
| `external_url` | `TEXT` | Original safe HTTP(S) URL |
| `youtube_url` | `TEXT` | Ready/mock/pending URL when available |
| `youtube_video_id` | `TEXT` | Extracted or mock ID |
| `publish_status` | `TEXT NOT NULL CHECK (publish_status IN ('ready','mock','pending','failed'))` | Honest upload state |
| `publish_error` | `TEXT` | Explanation for `mock`, `pending`, or `failed` |
| `local_path` | `TEXT` | Private server path; never serialize in JSON |
| `thumbnail_url` | `TEXT` | Safe public or app asset URL |
| `hidden` | `INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1))` | Reversible clip hide |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |

Constraint: `(moment_id IS NULL)` means event-level; `(moment_id IS NOT NULL)` means moment-level. A trigger on insert/update must reject a non-null `moment_id` unless that moment has the same `event_id` and `family_id`. `source_type='link'` requires `external_url`; `source_type='upload'` requires a stored upload path or an explicit failed state.

### 2.11 `notes`

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `note_...` |
| `family_id` | `TEXT NOT NULL FK families(id) ON DELETE CASCADE` | Tenant |
| `event_id` | `TEXT FK events(id) ON DELETE CASCADE` | Exactly one target FK |
| `moment_id` | `TEXT FK moments(id) ON DELETE CASCADE` | Exactly one target FK |
| `clip_id` | `TEXT FK clips(id) ON DELETE CASCADE` | Exactly one target FK |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('summary','coach','parent','other'))` | TKD coach/parent notes without special columns |
| `body` | `TEXT NOT NULL` | 1–5,000 characters |
| `created_at`, `updated_at` | `TEXT NOT NULL` | Timestamps |

A `CHECK` enforces exactly one target: `(event_id IS NOT NULL) + (moment_id IS NOT NULL) + (clip_id IS NOT NULL) = 1`. Partial unique indexes enforce one `summary` note per target; `coach`, `parent`, and `other` may be multiple. The v0.2 UI can send one summary note while the relation remains extensible.

### 2.12 `tags` and target joins

`tags`:

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `tag_...` |
| `family_id` | `TEXT NOT NULL FK families(id) ON DELETE CASCADE` | Tags do not leak between families |
| `slug` | `TEXT NOT NULL` | Lowercase trimmed canonical key |
| `label` | `TEXT NOT NULL` | Display form |
| `created_at` | `TEXT NOT NULL` | Timestamp |

Unique key: `(family_id, slug)`. Typed joins:

- `event_tags(event_id FK events, tag_id FK tags, PRIMARY KEY(event_id, tag_id))`
- `moment_tags(moment_id FK moments, tag_id FK tags, PRIMARY KEY(moment_id, tag_id))`
- `clip_tags(clip_id FK clips, tag_id FK tags, PRIMARY KEY(clip_id, tag_id))`

All join rows cascade when their target is deleted. Unreferenced tag rows may remain; cleanup is not part of a user mutation transaction.

### 2.13 Legacy mapping

`legacy_video_map` is internal and makes migration, compatibility reads, and rollback auditable:

```sql
CREATE TABLE legacy_video_map (
  legacy_video_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL UNIQUE REFERENCES clips(id) ON DELETE CASCADE,
  migrated_at TEXT NOT NULL
);
```

Every current `videos.id` appears once. New clips created through the legacy `/api/videos` compatibility route receive a generated `legacy_video_id` (`vid_<uuid>`) so old clients can still address them.

### 2.14 Required indexes and triggers

```sql
CREATE INDEX idx_athletes_family_active
  ON athletes(family_id, archived, name);
CREATE INDEX idx_athlete_sports_sport
  ON athlete_sports(sport_id, athlete_id);
CREATE UNIQUE INDEX idx_athlete_one_primary_sport
  ON athlete_sports(athlete_id) WHERE is_primary = 1;

CREATE INDEX idx_events_family_date
  ON events(family_id, start_date DESC, id DESC);
CREATE INDEX idx_events_family_type_date
  ON events(family_id, type, start_date DESC, id DESC);
CREATE INDEX idx_events_family_sport_date
  ON events(family_id, sport_id, start_date DESC, id DESC);
CREATE INDEX idx_events_visible_date
  ON events(family_id, hidden, end_date DESC, id DESC);

CREATE INDEX idx_event_athletes_athlete_event
  ON event_athletes(athlete_id, event_id);
CREATE INDEX idx_moments_event_order
  ON moments(event_id, hidden, sort_order, occurred_date, id);
CREATE INDEX idx_moments_family_date_result
  ON moments(family_id, occurred_date DESC, result, id DESC);
CREATE INDEX idx_moment_athletes_athlete
  ON moment_athletes(athlete_id, moment_id);

CREATE INDEX idx_clips_event_created
  ON clips(event_id, hidden, created_at DESC, id DESC);
CREATE INDEX idx_clips_moment_created
  ON clips(moment_id, hidden, created_at DESC, id DESC);
CREATE INDEX idx_clips_youtube_id
  ON clips(youtube_video_id);
CREATE INDEX idx_notes_event ON notes(event_id, updated_at DESC);
CREATE INDEX idx_notes_moment ON notes(moment_id, updated_at DESC);
CREATE INDEX idx_notes_clip ON notes(clip_id, updated_at DESC);
CREATE INDEX idx_event_tags_tag ON event_tags(tag_id, event_id);
CREATE INDEX idx_moment_tags_tag ON moment_tags(tag_id, moment_id);
CREATE INDEX idx_clip_tags_tag ON clip_tags(tag_id, clip_id);
```

The migration must set `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`, and keep the existing bind-mounted DB path. Use WAL-compatible transactions; do not delete or recreate `data/sport-video.db` in place.

## 3. Sport packs and concrete records

### 3.1 TKD `tkd.v1` pack

Only `sport_pack='tkd.v1'` with event sport `taekwondo` may contain these keys:

```json
{
  "pack": "tkd.v1",
  "division": "Cadet",
  "weight_class": "-49 kg",
  "age_group": "12-14",
  "belt_division": "Red/Black",
  "opponent_club": "Northside Taekwondo",
  "format": "sparring",
  "format_notes": "Best of three rounds"
}
```

Rules:

- `format` is required and is `sparring` or `poomsae`; v0.2 focuses on sparring but does not block poomsae.
- `division`, `weight_class`, `age_group`, `belt_division`, and `opponent_club` are optional strings, because legacy records may not know all values.
- `format_notes` is optional free text. Fight date/time, tournament name/location, round, bout number, opponent name, result, score, notes, tags, and clips remain in common event/moment/clip fields.
- `round_label` contains `prelim`, `quarterfinal`, `semifinal`, or `final`; `bout_number` is numeric when supplied. Do not duplicate these in JSON.
- `opponent_name` is the person; `opponent_club` is the club/dojang. `events.venue_*` is the tournament location.

Example moment response:

```json
{
  "id": "mom_tkd_qf_2026",
  "event_id": "evt_tkd_open_2026",
  "kind": "fight",
  "title": "Quarterfinal vs. Demo Opponent B",
  "occurred_date": "2026-05-16",
  "occurred_at": "2026-05-16T15:30:00.000Z",
  "timezone": "America/New_York",
  "sort_order": 2,
  "result": "win",
  "score": { "for": 12, "against": 8, "text": null },
  "opponent_name": "Demo Opponent B",
  "opponent_team_name": null,
  "round_label": "quarterfinal",
  "period_label": null,
  "bout_number": 23,
  "sport_pack": "tkd.v1",
  "sport_data": {
    "pack": "tkd.v1",
    "division": "Cadet",
    "weight_class": "-49 kg",
    "age_group": "12-14",
    "belt_division": "Red/Black",
    "opponent_club": "Northside Taekwondo",
    "format": "sparring",
    "format_notes": "Best of three rounds"
  },
  "athletes": [{ "id": "ath_maya", "name": "Maya", "role": "primary" }],
  "notes": [
    { "id": "note_1", "kind": "coach", "body": "Stayed composed after round one." },
    { "id": "note_2", "kind": "parent", "body": "First tournament quarterfinal." }
  ],
  "tags": ["comeback", "head-kick"],
  "hidden": false,
  "clips": [
    {
      "id": "clip_tkd_qf",
      "attachment_level": "moment",
      "source_type": "link",
      "external_url": "https://www.youtube.com/watch?v=TKD_QF_2026",
      "youtube_url": "https://www.youtube.com/watch?v=TKD_QF_2026",
      "publish_status": "ready",
      "hidden": false
    }
  ]
}
```

### 3.2 Team-sport example (soccer)

Soccer and basketball use the same base moment fields. They do not receive TKD fields in payloads or UI forms:

```json
{
  "event": {
    "name": "Emma vs. Tigers",
    "type": "game",
    "sport_id": "soccer",
    "start_date": "2026-04-12",
    "end_date": "2026-04-12",
    "timezone": "America/New_York",
    "venue": { "name": "Riverside Field", "city": "Albany" },
    "participants": [{ "athlete_id": "child_1", "result": "win" }],
    "result": "win",
    "placement": null,
    "medal": "none",
    "notes": [{ "kind": "summary", "body": "Tight game; strong final quarter." }],
    "tags": ["league", "spring"]
  },
  "moment": {
    "kind": "game",
    "title": "Quick corner kick goal",
    "occurred_date": "2026-04-12",
    "result": "win",
    "score_for": 3,
    "score_against": 2,
    "opponent_name": "Tigers",
    "opponent_team_name": "Tigers",
    "period_label": "2nd half",
    "round_label": null,
    "bout_number": null,
    "sport_pack": null,
    "sport_data": null,
    "athlete_ids": ["child_1"],
    "notes": [{ "kind": "summary", "body": "Final minute winner from the left corner." }],
    "tags": ["highlight"]
  }
}
```

A basketball game can use `kind='game'`, `opponent_team_name='Sunset Sparks'`, `period_label='Q3'`, and a numeric score. No `division`, `belt_division`, `opponent_club`, or `format` fields are emitted.

### 3.3 Demo tournament fixture outline

Fresh/test demo data must keep the current Emma soccer and Noah basketball coverage and add an obvious multi-moment TKD event:

- Athletes: existing `child_1` Emma and `child_2` Noah; new reserved demo athlete `ath_demo_tkd` (Maya) with a `taekwondo` profile.
- Event: `evt_demo_tkd_open_2026`, `type='tournament'`, sport `taekwondo`, two-day date range, venue/location, event medal `silver`, placement `2nd`.
- Moments in explicit `sort_order`: preliminary win (unknown score), quarterfinal win `12–8`, final loss `8–10`; each has TKD pack data and tags.
- Clips: one event-level montage; at least one moment-level clip on the quarterfinal and final. Include a mock upload clip with `publish_status='mock'` only when `YOUTUBE_MODE=mock`; never represent it as live-ready.
- Seed is idempotent by reserved IDs. Never overwrite an existing user row with a demo ID.
- On a non-empty production DB, migration backfills only; demo rows are added only by an explicit `SEED_DEMO=1`/test fixture operation or a documented operator action.

## 4. Safe SQLite migration and backfill

### 4.1 Preflight and backup

1. Stop the server/container or put the API in maintenance mode so no writes occur during the schema transaction.
2. Verify the path is the existing bind-mounted `DB_PATH` (`./data/sport-video.db` in Docker), not a new volume. Capture file metadata and run `PRAGMA integrity_check;` and `PRAGMA foreign_key_check;` on a copy.
3. Create a restorable backup with `VACUUM INTO` or a filesystem snapshot while SQLite is quiescent. If WAL is active, include the checkpointed database rather than copying only the main file.
4. Record current counts for `children`, `sports`, `videos`, and `settings` in the migration log. Never log PIN hashes, URLs containing tokens, or user notes.

### 4.2 Transactional schema phase

Run the following as one `BEGIN IMMEDIATE` migration, with an application-level migration lock:

1. Create `schema_migrations` and `families`.
2. Read `settings.family_name`, upsert `family_default` with that display name, and do not read or write `FAMILY_PIN_HASH` in SQLite.
3. Rename `children` to `athletes` while preserving IDs and source columns. Modern SQLite updates the `videos.child_id` foreign-key reference during `ALTER TABLE ... RENAME`; verify this with `PRAGMA foreign_key_check`. If the deployed SQLite version cannot safely update the FK, rebuild `videos` with the same columns and an FK to `athletes` rather than disabling referential integrity permanently.
4. Add/fill `athletes.family_id`, `created_at`, and `updated_at`. Existing null timestamps receive the migration timestamp; existing names and IDs are copied unchanged.
5. Extend `sports` with active/timestamp metadata, preserve existing IDs and labels, add `taekwondo` (`id='taekwondo'`, label `Taekwondo`), and add a unique slug constraint. If an existing legacy label is not in the catalogue, insert a stable `legacy-<normalized-label>` sport row instead of dropping the record.
6. Create `athlete_sports` and backfill one row for each non-null legacy `athletes.sport`, matching by case-insensitive label. Copy `athletes.team` to `team_name`; set the first known sport as primary. Do not remove legacy columns.
7. Create `events`, `event_athletes`, `moments`, `moment_athletes`, `clips`, `notes`, `tags`, all typed tag joins, and `legacy_video_map`. Create indexes and clip consistency triggers.
8. For each legacy `videos` row, execute the deterministic backfill in section 4.3. Insert `schema_migrations` only after counts and FK checks pass; then commit.
9. After commit, create a read-only compatibility view named `children` if the old table was renamed. The compatibility API must use explicit column lists, not `SELECT *`, because the view is not writable.

If a NOT NULL/foreign-key constraint cannot be added with `ALTER TABLE`, use the standard SQLite table-rebuild sequence: create `*_new` with final constraints, copy rows, run checks, drop/rename inside the same transaction. Do not use `DROP TABLE children` or `DROP TABLE videos` as a shortcut.

### 4.3 Deterministic legacy row mapping

For each `videos` row:

1. **Choose the sport.** Map `videos.sport` to `sports.id` by case-insensitive label. For null sport, use the athlete's primary profile if one exists; otherwise create/use `legacy-unknown` and preserve null in the compatibility response.
2. **Choose an event key.** Use `(family_default, child_id, sport_id, normalized_event_name, event_date)`. Include `videos.id` in the key when `event_name` is null/blank, so unrelated uncategorized clips are never merged. Including `child_id` avoids falsely merging two children's same-named games; later UI can merge events explicitly.
3. **Deterministic IDs.** Compute SHA-256 outside SQLite over the canonical key and use `evt_legacy_<first 24 hex>` for the event. For each video use `mom_legacy_<first 24 hex of video id>` and `clip_legacy_<first 24 hex of video id>`. If a target ID already exists with different source mapping, add a deterministic suffix rather than overwrite.
4. **Infer event type conservatively.** Case-insensitive name/tags matching: `tournament|championship|cup` → `tournament`; `practice|training|drill` → `practice`; `test|grading|belt` → `test`; `vs|versus|match|game` → `game`; otherwise `other`. Never infer result, medal, placement, round, or opponent from text.
5. **Create the event.** `name` is the old `event_name` when present, otherwise `Unsorted <sport label> · <event_date>`. Set `start_date=end_date=event_date`, `timezone='UTC'`, venue null, result `unknown`, placement null, medal `none`, hidden `0`. Add the child to `event_athletes`.
6. **Create the moment.** `kind='game'` for inferred game, `kind='practice'` for practice, otherwise `highlight`; preserve the old `title`, `event_date`, and a deterministic order from `(event_date, created_at, videos.id)`. Set result `unknown`, score/opponent/round/period/bout null. Copy `videos.notes` to one `notes(kind='summary')` row. Copy old tags to `moment_tags` and clip tags.
7. **Create the clip.** Preserve `source_type`, `external_url`, `youtube_url`, `youtube_video_id`, `publish_status`, `publish_error`, `local_path`, `thumbnail_url`, `hidden`, `created_at`, and `updated_at`. All migrated clips attach at moment level (`event_id` plus `moment_id`); no event-level ownership is invented. Redact `local_path` from every API response, as current behavior does.
8. **Write `legacy_video_map`.** Store the exact old `videos.id` and new IDs. Do not modify or delete the old row. A retry sees the map and skips that source row after verifying the target IDs.

### 4.4 Compatibility and rollback

- Keep the old `videos` table unchanged for at least the v0.2.0 release and one backup cycle. New canonical writes through the compatibility `/api/videos` route must dual-write a flattened row to `videos` and a canonical event/moment/clip record, so an old binary can still recover clip content.
- `/api/children` remains a compatibility alias over `athletes`, with the current response field names (`id`, `name`, `sport`, `team`, `color`, `archived`, `clip_count`). New clients use `/api/athletes`.
- `/api/videos` remains a compatibility alias that flattens canonical clips: `event_name` comes from `events.name`, `event_date` from the moment date, `title` from `moments.title` or clip title, tags from the moment/clip union, and source fields from `clips`. New clients use `/api/timeline`, `/api/events`, `/api/moments`, and `/api/clips`.
- A true schema rollback is a restore of the pre-migration backup, not a partial `DROP` of canonical tables. Before restoring after any v0.2 writes, export/retain canonical rows; event/moment-only records have no faithful representation in the old flat schema.
- A code rollback with the migrated schema is supported only while compatibility tables/routes remain; the old binary may ignore new event/moment metadata but must not lose migrated videos. Do not claim a full hierarchy rollback without restoring the backup.
- If any migration step fails, roll back the transaction, leave the original rows intact, preserve the backup, and report the failing version/check. Never proceed with a partially backfilled database.

## 5. Authenticated REST API contract

### 5.1 Conventions

- Canonical v0.2 routes use `/api/...` to fit the current Express app. They are authenticated by the existing session cookie unless explicitly marked public/auth.
- Requests must include `Content-Type: application/json` for JSON routes. Upload routes use `multipart/form-data` with a `metadata` JSON field and a `file` field.
- IDs are path parameters; query parameter names below are exact snake_case names. Dates are inclusive and interpreted in the event/moment timezone.
- Default reads exclude hidden events, moments, and clips. `include_hidden=true` is allowed only after PIN unlock and includes `hidden` plus `hidden_via_parent` flags.
- Default pagination: `limit=50`; allowed range `1..100`. Use opaque keyset `cursor`, not unbounded `OFFSET`.
- Successful mutation responses include the complete affected resource, not a stale seed object.

### 5.2 Error envelope

Canonical routes use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "fields": {
      "start_date": "Must be a valid YYYY-MM-DD date"
    }
  }
}
```

Codes and statuses:

| HTTP | Code | Use |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Missing/invalid field, enum, date, URL, JSON pack |
| 401 | `AUTH_REQUIRED` | No authenticated family session |
| 403 | `FORBIDDEN` | Cross-family ID or disallowed operation |
| 404 | `NOT_FOUND` | Resource is absent or hidden from an unauthenticated caller |
| 409 | `CONFLICT` | Duplicate/immutable sport or invalid ownership relationship |
| 413 | `UPLOAD_TOO_LARGE` | Exceeds `MAX_UPLOAD_MB` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Non-video upload |
| 422 | `UNPROCESSABLE_ENTITY` | Valid shape but inconsistent domain state |
| 429 | `RATE_LIMITED` | PIN attempts exceed current limiter |
| 500 | `INTERNAL_ERROR` | Unexpected server failure; no SQL/path/secret details |

Existing compatibility endpoints may retain the current `{ "error": "..." }` string shape to avoid breaking the v0.1 client. New canonical endpoint tests must assert the structured envelope.

### 5.3 Auth endpoints (preserve current behavior)

| Method/path | Auth | Contract |
|---|---|---|
| `POST /api/auth/unlock` | No | Body `{ "pin": "2468" }`; compare against `FAMILY_PIN_HASH`, regenerate session on success, return `200 {"ok":true}`. Missing PIN → 400; mismatch → 401; invalid server hash → 500. Preserve rate limit (5 attempts/15 min/IP). |
| `POST /api/auth/lock` | Session optional | Destroy session, clear `connect.sid`, return `200 {"ok":true}`. |
| `GET /api/me` | No | Return `{ "authenticated": true|false }`. |
| `GET /api/settings` | Yes | Preserve `youtube_mode` and `max_upload_mb`. |

Cookies remain `httpOnly` and `sameSite=lax`; production uses Secure cookies for HTTPS (including a controlled proxy when `TRUST_PROXY` is set to that proxy's exact IPv4 address or `/32` CIDR) and non-Secure cookies only for direct HTTP/LAN access. Direct HTTP has no transport confidentiality. Credentials remain enabled for the current dev CORS origins.

### 5.4 Reference and athlete endpoints

| Method/path | Request/query | Response |
|---|---|---|
| `GET /api/sports` | Optional `include_inactive=true` | `200 [{id,label,sort_order,is_active}]`; keep the current bare-array shape on this reference route so the existing client does not break. |
| `GET /api/athletes` | `sport_id`, `include_archived`, `q`, `limit`, `cursor` | `200 { "items": [AthleteSummary], "next_cursor": string|null }`. Include `sports[]`, `clip_count`, `event_count`. |
| `POST /api/athletes` | `{name, photo_url?, sports?: [{sport_id,is_primary?,team_name?,club_name?,belt_rank?,age_group?,weight_class?}]}` | `201 AthleteDetail`; duplicate/empty name validation. |
| `PATCH /api/athletes/:id` | Partial name/photo/archived and optional complete `sports` replacement | `200 AthleteDetail`. Archiving never deletes events/clips. |
| `GET /api/children` | Existing `includeArchived` compatibility spelling | Current-shaped array over `athletes`; retained for v0.1 clients. |

Athlete hard delete is not exposed in v0.2. Archive it; an athlete referenced by an event is never physically removed.

### 5.5 Timeline and filters

`GET /api/timeline`

Query parameters:

| Parameter | Meaning |
|---|---|
| `athlete_id` | One or comma-separated athlete IDs; event participation or moment participation qualifies |
| `sport_id` | Sport slug, e.g. `soccer`, `basketball`, `taekwondo` |
| `event_type` | One or comma-separated event enum values |
| `from` / `to` | Inclusive `YYYY-MM-DD` range against event overlap (`end_date >= from` and `start_date <= to`) |
| `result` | One or comma-separated common results; matches event summary or moments |
| `tag` | One or comma-separated tag slugs; default `tag_mode=any` |
| `tag_mode` | `any` or `all` when multiple tags are supplied |
| `include_hidden` | `true` only to inspect hidden records after auth; default false |
| `include_moments` | Default true; false returns event cards/counts only |
| `limit` / `cursor` | Keyset pagination, max 100 |

Ordering is newest event `end_date DESC`, then `start_date DESC`, then `id DESC`. The response is event-grouped to avoid duplicating a tournament for every fight:

```json
{
  "items": [
    {
      "event": {
        "id": "evt_tkd_open_2026",
        "name": "Capital Spring Open",
        "type": "tournament",
        "sport": {"id": "taekwondo", "label": "Taekwondo"},
        "start_date": "2026-05-16",
        "end_date": "2026-05-17",
        "venue": {"name": "Civic Arena", "city": "Albany", "region": null, "country": "US"},
        "participants": [{"id":"ath_maya","name":"Maya"}],
        "result": "unknown",
        "placement": "2nd",
        "medal": "silver",
        "hidden": false,
        "clip_count": 3
      },
      "moments": [
        {
          "id": "mom_tkd_qf_2026",
          "kind": "fight",
          "title": "Quarterfinal vs. Demo Opponent B",
          "occurred_date": "2026-05-16",
          "result": "win",
          "score": {"for":12,"against":8,"text":null},
          "round_label": "quarterfinal",
          "bout_number": 23,
          "clip_count": 1,
          "hidden": false
        }
      ],
      "event_clip_count": 1,
      "matched_by": ["tag", "moment.result"]
    }
  ],
  "next_cursor": null,
  "applied_filters": {"athlete_id":"ath_maya","sport_id":"taekwondo"}
}
```

Filter semantics are explicit: an event is included if its event fields match or at least one child matches. When a moment-level filter (`result`, `tag`, or athlete participation) is supplied, `moments[]` contains only matching moments so the UI does not show unrelated fights; without one, it contains all visible moments up to the response cap (the event detail endpoint is authoritative for the full list). `matched_by` is diagnostic UI metadata, not a persistence field.

### 5.6 Event endpoints

`POST /api/events` creates the event container. Payload:

```json
{
  "name": "Capital Spring Open",
  "type": "tournament",
  "sport_id": "taekwondo",
  "start_date": "2026-05-16",
  "end_date": "2026-05-17",
  "timezone": "America/New_York",
  "venue": {"name":"Civic Arena","city":"Albany","region":"NY","country":"US"},
  "participants": [
    {"athlete_id":"ath_maya","display_order":0,"result":"unknown","placement":"2nd","medal":"silver"}
  ],
  "add_sport_profile": true,
  "result": "unknown",
  "placement": "2nd",
  "medal": "silver",
  "notes": [{"kind":"summary","body":"Maya's first two-day tournament."}],
  "tags": ["tournament", "spring-open"],
  "hidden": false
}
```

Rules: `participants` may be omitted/empty for event-first creation. If supplied, all athletes must be in the family; the optional top-level `add_sport_profile=true` allows the service to transactionally upsert a missing `athlete_sports` row for this event sport. Without that explicit flag, a missing profile is `422`; the default UI should select/add the sport profile before submitting. `PATCH` may replace the entire `participants`, `notes`, or `tags` arrays; omission means unchanged. Event sport is immutable after its first moment unless the transaction also validates/re-writes every moment pack; v0.2 should return `409` instead of silently changing it.

| Method/path | Contract |
|---|---|
| `GET /api/events` | Same filters as timeline plus `include_moments=false` default; returns event summaries and cursor. |
| `POST /api/events` | Create event, participants, notes, tags in one transaction; return `201 EventDetail`. |
| `GET /api/events/:id` | Full event detail: venue, summaries, participants, notes, tags, ordered moments, event-level clips, counts. `include_hidden=true` is explicit. |
| `PATCH /api/events/:id` | Partial fields; participants/notes/tags are replace-all when present; return `200 EventDetail`. `{hidden:true}` is the reversible hide action. |
| `DELETE /api/events/:id` | Hard delete only with JSON `{ "confirm": true }`; return `204`. The normal UI uses `PATCH hidden=true`. Cascades are defined in section 7. |
| `GET /api/events/:id/moments` | Ordered moments, cursor optional; default excludes hidden. |
| `POST /api/events/:id/moments` | Same payload as moment create without `event_id`; return `201 MomentDetail`. |
| `POST /api/events/:id/clips` | Event-level clip endpoint; payload rules in section 5.8. It must not accept `moment_id`. |

`EventDetail` always includes `sport` as an object and uses `participants[]` for athlete names; it never presents a single `child_id` as the owner.

### 5.7 Moment endpoints

Moment JSON create/update fields:

```json
{
  "event_id": "evt_tkd_open_2026",
  "kind": "fight",
  "title": "Quarterfinal vs. Demo Opponent B",
  "occurred_date": "2026-05-16",
  "occurred_at": "2026-05-16T15:30:00.000Z",
  "timezone": "America/New_York",
  "sort_order": 2,
  "result": "win",
  "score_for": 12,
  "score_against": 8,
  "opponent_name": "Demo Opponent B",
  "opponent_team_name": null,
  "round_label": "quarterfinal",
  "period_label": null,
  "bout_number": 23,
  "athlete_ids": ["ath_maya"],
  "sport_pack": "tkd.v1",
  "sport_data": {
    "pack": "tkd.v1",
    "division": "Cadet",
    "weight_class": "-49 kg",
    "age_group": "12-14",
    "belt_division": "Red/Black",
    "opponent_club": "Northside Taekwondo",
    "format": "sparring",
    "format_notes": "Best of three rounds"
  },
  "notes": [
    {"kind":"coach","body":"Stayed composed after round one."},
    {"kind":"parent","body":"First tournament quarterfinal."}
  ],
  "tags": ["comeback", "head-kick"],
  "hidden": false
}
```

| Method/path | Contract |
|---|---|
| `GET /api/moments/:id` | Full moment detail, parent event summary, participating athletes, notes/tags, and clips. |
| `POST /api/moments` | Requires `event_id`; creates moment, athlete joins, notes, tags in one transaction. |
| `PATCH /api/moments/:id` | Partial base/pack fields; `athlete_ids`, notes, and tags replace their complete sets when supplied. `{hidden:true}` is reversible. |
| `DELETE /api/moments/:id` | Hard delete only with `{confirm:true}`; returns `204`; normal UI hides. |
| `POST /api/moments/:id/clips` | Moment-level clip endpoint; server sets both `event_id` and `moment_id`. |

A generic/team moment must send `sport_pack=null` and `sport_data=null` (or an explicitly supported future pack). Sending a TKD key under soccer/basketball is `400 VALIDATION_ERROR`; sending `tkd.v1` under a non-TKD event is `422 UNPROCESSABLE_ENTITY`.

### 5.8 Clip link/upload endpoints

Canonical link request (JSON):

```json
{
  "source_type": "link",
  "title": "Quarterfinal full match",
  "external_url": "https://www.youtube.com/watch?v=TKD_QF_2026",
  "notes": [{"kind":"summary","body":"Full match from ring 3."}],
  "tags": ["full-match", "quarterfinal"]
}
```

Upload request (`multipart/form-data`):

- `file`: required video file; accepted MIME starts with `video/`; size bounded by `MAX_UPLOAD_MB`.
- `metadata`: required JSON object containing `source_type:'upload'`, `title`, optional `notes`, and `tags`.

Rules:

- `POST /api/events/:id/clips` always creates an event-level clip; `POST /api/moments/:id/clips` always creates a moment-level clip. Both return `201 Clip` and never accept an ambiguous target.
- Link URLs must parse as `http:` or `https:`. `javascript:`, `data:`, local file paths, and empty URLs are rejected. YouTube ID extraction is convenience only; arbitrary safe HTTPS links are supported.
- Upload stores the file in the existing private uploads directory. In `YOUTUBE_MODE=mock`, return `publish_status='mock'`, a mock URL/ID, and a message such as `YouTube is not connected; this upload is a local mock.` In live mode without credentials, return `publish_status='pending'` with an honest credential message. Never return `ready` for an unperformed upload.
- On any validation or DB failure, delete the newly written temporary file before returning. `local_path` is never exposed; `/uploads/*` remains authenticated.

| Method/path | Contract |
|---|---|
| `GET /api/clips/:id` | Full clip metadata with `attachment_level` (`event` or `moment`), parent IDs, tags/notes; local path omitted. |
| `PATCH /api/clips/:id` | Edit title, notes, tags, or `hidden`; source URL and ownership are immutable in v0.2. |
| `DELETE /api/clips/:id` | Hard delete with `{confirm:true}` only; normal UI uses `PATCH hidden=true`. Remove local file after successful commit and report cleanup failure to server logs without leaking paths to clients. |

### 5.9 Video-first capture contract

To guarantee a video-first wizard always lands on a saved timeline item, implement one composite endpoint in addition to the granular endpoints:

`POST /api/capture` (JSON link or multipart upload)

- Request contains `event` (new event payload), `moment` (new moment payload without `event_id`), and `clip` (link metadata or upload metadata/file).
- The server creates event → participant links → moment → moment participants → clip → notes/tags in one database transaction; the clip receives both event and moment IDs.
- If an existing `event_id` is supplied, skip event creation but still create moment and clip transactionally. An existing `moment_id` may be used only with an existing event and must match it.
- Response `201` returns `{event, moment, clip}`. A failed transaction removes any temporary upload file and leaves no partial timeline item.

The event-first wizard uses `POST /api/events`, then `POST /api/events/:id/moments`, then either clip endpoint. Both paths produce the same canonical resources.

### 5.10 Notes and tags endpoints (optional UI surface, required persistence behavior)

Parent CRUD payloads replace notes/tags atomically. If the UI needs inline editing, these routes are canonical aliases over the same relation:

- `POST /api/events/:id/notes` and `POST /api/moments/:id/notes`: `{kind,body}` → `201 Note`.
- `PATCH /api/notes/:id`: `{kind?,body?}` → `200 Note`.
- `DELETE /api/notes/:id`: hard delete one note → `204`.
- Tags are created/upserted by parent mutations; no standalone tag deletion is needed in v0.2. A tag slug is lowercase, trimmed, max 40 characters; the display label is preserved.

## 6. Validation, timezone, and representation rules

- Trim all user strings. Required names/titles cannot be blank. Reject control characters in labels/titles; allow normal Unicode punctuation.
- Strict dates: regex `^\d{4}-\d{2}-\d{2}$`, real Gregorian date, no silent timezone conversion. `from <= to`; event `start_date <= end_date`.
- Validate IANA timezones with the runtime's timezone database (`Intl.DateTimeFormat`); default to `UTC` only when no local timezone is supplied. Do not infer a parent's local timezone from the server host.
- `occurred_at` must be an ISO-8601 timestamp with an explicit offset or `Z`; normalize to UTC. Preserve `occurred_date` as the user-entered local date. When time is unknown, leave `occurred_at` null rather than using midnight.
- Common results are exactly `win|loss|draw|dq|unknown`. Do not infer a result from a score or medal. Team sports use the same result vocabulary; `dq` is accepted for compatibility but is not shown in irrelevant forms.
- Scores are either two non-negative integers (`score_for`, `score_against`) or a bounded `score_text` (max 40 chars). Do not parse arbitrary score text server-side.
- `sport_data_json` must be an object, not an array/string, valid JSON, and at most 16 KB. Validate exact allowed keys for `tkd.v1`; reject unknown TKD keys so the API does not silently store misspellings. Future packs require an explicit registered validator.
- Tags are capped at 20 per target, labels at 40 characters, and deduplicated case-insensitively by family-scoped slug. Tag filters query joins, never JSON substring matches.
- External URLs are max 2,048 characters and only HTTP(S). Upload MIME and size are checked before persistence. No production YouTube OAuth behavior is invented by the mock path.
- `include_hidden` is an authenticated diagnostic feature. An event hidden by its parent is returned only when explicitly requested and is marked `hidden_via_parent=true`; direct child hidden flags are not overwritten.

## 7. Delete, hide, and transaction semantics

### 7.1 Hide semantics

- `PATCH /api/events/:id {hidden:true}` hides the event in all default timeline/event reads. Its moments and clips remain in SQLite with their original flags; canonical responses include `hidden_via_event=true` when requested with `include_hidden`.
- Hiding a moment hides its moment-level clips effectively, but does not hide event-level clips.
- Hiding a clip affects only that clip.
- Unhide is the same PATCH with `hidden:false`; no child state is guessed or restored.

### 7.2 Hard delete semantics

- Event hard delete cascades `event_athletes`, moments, moment athletes, clips, notes, tags joins, and `legacy_video_map` rows through FKs. It does not delete the family, athlete, sport, or shared tag definitions.
- Moment hard delete cascades moment athletes, moment-level clips, notes, tags joins, and mapping rows. Event-level clips stay attached to the event.
- Clip hard delete removes its notes/tag joins and then its private local file. A missing file is not a client-visible error; log a safe cleanup warning.
- Athletes are archived, not hard deleted, when referenced. Sports are deactivated, not hard deleted.
- The UI exposes hide by default. Hard delete requires `confirm:true`, is not undoable in v0.2, and returns `204` only after the DB commit succeeds.

### 7.3 Transactions

- Migration/backfill: one `BEGIN IMMEDIATE` transaction per version; retry only a transient busy error before any writes; commit only after row counts and FK checks.
- Event create/update: one transaction for event, participants, notes, tags, and any profile upsert. Replacing participants/notes/tags deletes old joins only after payload validation.
- Moment create/update: one transaction for base row, athlete joins, notes, and tags. Validate parent/family/sport pack before changing existing rows.
- Clip link: one transaction for clip, notes, and tags.
- Clip upload: write temporary file first; validate metadata; insert DB rows in a transaction; delete temporary file on rollback. Keep local file path private.
- Composite capture: one transaction for the full Event→Moment→Clip graph. Never return a partially successful object.
- Hard delete: DB transaction first; collect private file paths, commit, then remove files. Orphan cleanup is a bounded maintenance task, not a reason to expose an internal path.

## 8. Query and performance plan

- Use parameterized SQL for every filter. Never interpolate IDs, tags, or sort values.
- Timeline uses event date indexes for the primary keyset and `EXISTS` subqueries for athlete/result/tag predicates. Tag filters use typed joins and can use `idx_*_tags_tag`; no `LIKE '%tag%'` on JSON.
- Use keyset cursor `(COALESCE(end_date,start_date), start_date, id)` descending. Decode/validate cursor server-side and bind values; reject malformed cursors with `400`.
- Event detail is at most a bounded set of queries: event row, participants, moments ordered by `(sort_order, occurred_at, occurred_date, id)`, clips, notes, and tags. Do not issue one query per moment.
- Default timeline moment preview is capped at 20 per event; `GET /api/events/:id/moments` is the full ordered child list with pagination.
- Run `EXPLAIN QUERY PLAN` fixtures for: family newest timeline; athlete + sport + date range; result + tag; event detail; moment detail; clip lookup. The plan must use the family/date or join indexes and avoid full scans on the common timeline paths.
- Set a SQLite busy timeout and serialize writes through the existing async DB connection. WAL is acceptable and preserves the current Docker volume; do not run `VACUUM` during normal request handling.

## 9. Compatibility route mapping

| Existing route | v0.2 behavior |
|---|---|
| `GET /api/children` | Read-only alias over `athletes`; preserve current field names and clip count. |
| `POST /api/children` | Creates an athlete and optional primary sport profile; returns current-shaped child object. |
| `GET /api/sports` | Preserve current bare array for old UI; canonical clients may use the documented envelope if the implementation version-negotiates. |
| `GET /api/videos` | Flatten canonical clips, preserving `childId`, `sport`, `includeHidden`, newest-first behavior. |
| `POST /api/videos` | Translate flat payload into event (or find deterministic legacy event), moment, and clip in one transaction. `source_type=upload` preserves mock/pending semantics. |
| `PATCH /api/videos/:id` | Resolve through `legacy_video_map`/compatibility alias and update moment/clip fields; `{hidden}` remains reversible. |
| `GET /uploads/*` | Keep session-authenticated static serving; never make local uploads public. |

Compatibility routes are deprecated but must remain through v0.2.0 so the existing family PIN/session and upload/mock tests do not silently regress.

## 10. Required tests and acceptance evidence

### 10.1 Migration tests

1. Copy a fixture with the exact current `children`, `sports`, `videos`, and `settings` shape; run migration twice; assert second run is a no-op.
2. Assert all old child IDs, names, legacy sport/team fields, video IDs, URLs, publish states, hidden flags, notes, tags, and local paths are preserved/mapped.
3. Assert one mapped event/moment/clip per legacy video and exact `legacy_video_map` coverage.
4. Assert event grouping is deterministic and does not merge same-name clips across children; null event names remain separate.
5. Assert existing `data/sport-video.db` path/volume is reused, transaction rollback leaves the source schema/data unchanged, and `PRAGMA foreign_key_check`/`integrity_check` pass.
6. Assert `children` compatibility reads and old `/api/videos` responses after migration.

### 10.2 Auth and API tests

1. Unauthenticated canonical routes return structured `401`; valid/invalid unlock and lock preserve current session behavior.
2. Family scoping rejects IDs from another family with `403`/`404` without leaking existence.
3. Create an event with participants, notes, tags, venue, date range, result/placement/medal; refresh and verify persistence.
4. Create a multi-moment TKD tournament with ordered fights, all required TKD pack fields, event-level placement/medal, event-level clip, and moment-level clips.
5. Create soccer/basketball moments and assert TKD fields are rejected/not returned; assert score/opponent/team/period fields work.
6. Exercise timeline filters individually and in combinations: athlete, sport, event type, date range, result, tag any/all, hidden. Assert newest-first and cursor pagination.
7. Verify event detail drill-in returns participants, ordered moments, event clips, moment counts, notes, and tags without N+1 behavior in query instrumentation.
8. Verify event-level clip cannot accept a `moment_id`; moment-level clip stores both event and moment IDs; cross-event moment attachment returns `409`/`422` and writes nothing.
9. Link creation rejects unsafe URLs. Upload accepts a video file, rejects a non-video, cleans failed temporary files, redacts `local_path`, and reports `mock` or `pending` honestly.
10. Edit/hide/unhide event, moment, and clip; verify default reads exclude hidden and `include_hidden` shows inherited/direct flags. Verify refresh persistence.
11. Hard-delete confirmation and cascade tests; verify athlete archive does not remove history.
12. Video-first `/api/capture` rolls back the entire graph on invalid metadata/upload; event-first and video-first both return a saved timeline item.

### 10.3 UI/integration evidence required by the release card

- UI reads timeline, athletes, events, moments, clips, and filters from the authenticated API; no contradictory static seed arrays.
- Desktop 1280 and mobile 390 evidence shows Event → Moment → Clip drill-in, a multi-sport filter, Emma soccer, Noah basketball, and a TKD tournament with multiple fights.
- Browser interaction coverage includes unlock/lock, athlete/sport filter, event create, moment create, event-level and moment-level link/upload, edit/hide, refresh persistence, and keyboard/modal behavior.
- `npm run ci` and GitHub CI are green. Migration proof includes backup/check/integrity output and before/after row counts. No production mutation is part of this research card.

## 11. Risks and open implementation notes

- **Current durable checkout is dirty and contains prior QA rows.** The integration worker must use the clean committed parent handoff/branch, not assume the inspected working tree is a deployable source of truth.
- **SQLite table rename/rebuild behavior varies by SQLite version.** Run the migration against the same Node/sqlite3 runtime used by the container and assert the renamed `videos` FK before enabling writes.
- **Legacy event inference is intentionally lossy.** Preserve the original `event_name`/title and set unknown result/metadata rather than inventing opponent, round, score, or medal. Manual editing is the correction path.
- **Event-level summaries can be ambiguous for multi-athlete events.** Use `event_athletes` per-athlete result/medal and leave event summary unknown when a single value would mislead.
- **Shared PIN has no per-parent audit trail.** This remains a v0.2 limitation; do not imply per-user permissions or audit history in the API.
- **Mock uploads are not YouTube uploads.** The API must display/persist `mock` or `pending` honestly until credentials and the live integration are separately implemented.
- **No production migration should auto-seed demo TKD data.** Acceptance screenshots/tests use an explicit demo fixture; production backfill is non-destructive only.
- **No blockers to the data/API design remain.** The integration card still needs to decide exact implementation sequencing, clean parent commits, and UI scope; those are delivery concerns, not schema ambiguities.
