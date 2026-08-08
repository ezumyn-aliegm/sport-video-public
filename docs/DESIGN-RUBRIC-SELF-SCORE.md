# v0.2.0 design rubric self-score

Screenshots were rendered from the API-backed product at 1280x1000 and 390x844 after the timeline loaded. Generated assets from the Event/Moment design handoff are consumed from `public/assets/generated/`.

Reference translation: FamilyAlbum warmth + Google Photos chronological scan + Hudl event/moment sports context.
Foundation translation: rounded Card, Button, Tabs/filter, Form/Input, and Dialog primitives implemented with the existing React/CSS token layer.

| Dimension | Weight | Score | Screenshot-grounded justification |
|---|---:|---:|---|
| Type scale and pairing | 3 | 4.5 | `timeline-desktop-1280.png` uses Nunito's humanist pairing with a clear eyebrow -> hero -> event -> moment scale; mobile keeps the title readable without flattening hierarchy. |
| Spacing rhythm and density | 3 | 4.0 | `timeline-mobile-390.png` uses 8/12/16/24px rhythm; date rails and nested rows leave enough scan space without an empty dashboard column. |
| Color discipline | 2 | 4.5 | `timeline-desktop-1280.png` stays within grass, cream, orange, sky, and paper; orange is reserved for add actions and no purple/gradient SaaS treatment appears. |
| Visual richness and imagery | 3 | 4.5 | Hero, Taekwondo, basketball, and soccer cards use real generated PNG imagery in the desktop timeline; no empty hero or CSS-only sports illustration is used. |
| Component fidelity vs reference | 3 | 4.0 | The filter bar, event Card, nested Moment rows, clip strip, and Dialog in both renders translate the named references instead of presenting a flat clip wall. |
| Layout and information architecture | 2 | 4.5 | `timeline-desktop-1280.png` makes Event the visual parent and Moment the ordered child; `timeline-mobile-390.png` preserves that relationship in one column. |
| Motion and detail | 1 | 3.5 | Hover/focus states and reduced-motion handling are purposeful; the release avoids animation that would compete with family memories. |
| Copy and value clarity | 1 | 4.5 | Hero copy says what families can save, while cards use parent language such as game day, tournament, moments, and saved memory. |

Weighted total: 4.28 / 5 (PASS; no dimension below 3).

Known limitation: this is a private QA candidate with no public HTTPS deployment. SEO files are explicitly noindex/disallow-all until an operator provisions and verifies a real host.
