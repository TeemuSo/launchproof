// LaunchProof dashboard client. No build step, no framework -- fetches
// /api/runs and /api/runs/:id and renders the two-pane layout by hand.

const rail = document.getElementById('rail');
const theater = document.getElementById('theater');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

let runsIndex = [];
let activeRunId = null;

async function main() {
  try {
    runsIndex = await fetchJson('/api/runs');
  } catch (err) {
    renderRailError(err);
    return;
  }

  if (runsIndex.length === 0) {
    rail.innerHTML = '<div class="rail-empty">No runs recorded yet.<br><br>Run <code>node run.mjs &lt;test&gt;</code> from the project root to record one.</div>';
    theater.innerHTML = '<div class="theater-empty">No evidence on file.</div>';
    return;
  }

  renderRail();
  selectRun(runsIndex[0].runId);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function renderRailError(err) {
  rail.innerHTML = `<div class="rail-empty">Could not reach the case file index.<br><br>${escapeHtml(err.message)}</div>`;
}

function renderRail() {
  rail.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'rail-header';
  header.textContent = `Tests (${runsIndex.length})`;
  rail.appendChild(header);

  for (const run of runsIndex) {
    const card = document.createElement('div');
    card.className = 'test-card' + (run.runId === activeRunId ? ' active' : '');
    card.dataset.runId = run.runId;
    card.innerHTML = `
      <div class="name">${escapeHtml(run.test)}</div>
      <div class="meta-row">
        <span class="pill ${pillClass(run.verdict)}">${escapeHtml(run.verdict)}</span>
        <span class="timestamp">${relativeTime(run.startedAt)}</span>
      </div>
    `;
    card.addEventListener('click', () => selectRun(run.runId));
    rail.appendChild(card);
  }
}

function pillClass(verdict) {
  if (verdict === 'WORKING') return 'pill-working';
  if (verdict === 'BROKEN') return 'pill-broken';
  return 'pill-inconclusive';
}

function verdictClass(verdict) {
  if (verdict === 'WORKING') return 'verdict-working';
  if (verdict === 'BROKEN') return 'verdict-broken';
  return 'verdict-inconclusive';
}

async function selectRun(runId) {
  activeRunId = runId;
  document.querySelectorAll('.test-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.runId === runId);
  });

  theater.innerHTML = '<div class="theater-empty">Pulling case file...</div>';

  let run;
  try {
    run = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  } catch (err) {
    theater.innerHTML = `<div class="theater-empty">Could not load run ${escapeHtml(runId)}: ${escapeHtml(err.message)}</div>`;
    return;
  }

  renderTheater(run);
}

function renderTheater(run) {
  const vClass = verdictClass(run.verdict);
  const bannerLabel = bannerLabelFor(run);
  const bannerSub = bannerSubFor(run);

  // Prefer the transcoded, seekable mp4 when it's on file; fall back to the
  // raw webm for old/backfilled-without-ffmpeg runs so they still play,
  // just without scrubbing.
  const videoRelPath = run.artifacts && (run.artifacts.videoSeekable || run.artifacts.video);
  const videoHtml = videoRelPath
    ? `<video controls preload="metadata" src="/runs/${encodeURIComponent(run.runId)}/${videoRelPath}"></video>`
    : '<div class="no-video">NO VIDEO ON FILE FOR THIS RUN</div>';

  const chapterTrackHtml = renderChapterTrack(run, Boolean(videoRelPath));

  const stepsHtml = (run.steps || []).map((step) => renderStep(run.runId, step)).join('');

  const shotsHtml = (run.steps || [])
    .filter((s) => s.shot)
    .map((s) => `
      <div class="evidence-thumb" data-src="/runs/${encodeURIComponent(run.runId)}/${s.shot}" data-step-index="${s.index}">
        <img src="/runs/${encodeURIComponent(run.runId)}/${s.shot}" alt="${escapeHtml(s.name)}" loading="lazy" />
        <div class="thumb-label">${String(s.index).padStart(2, '0')} ${escapeHtml(s.name)}</div>
      </div>
    `)
    .join('');

  const traceHtml = run.artifacts && run.artifacts.trace
    ? `
      <div class="trace-box">
        <a href="/runs/${encodeURIComponent(run.runId)}/${run.artifacts.trace}" download>download trace.zip</a>
        <span>or replay it with:</span>
        <code class="trace-hint" id="trace-hint">npx playwright show-trace runs/${escapeHtml(run.runId)}/trace.zip</code>
      </div>
    `
    : '';

  theater.innerHTML = `
    <div class="case-line">Case <span>${escapeHtml(run.runId)}</span> &middot; test <span>${escapeHtml(run.test)}</span> &middot; intent <span>${escapeHtml(run.intent || 'unknown')}</span> &middot; target <span>${escapeHtml(run.target || '')}</span></div>
    <div class="verdict-banner ${vClass}">
      <div>
        <div class="verdict-label">${bannerLabel}</div>
        <div class="verdict-sub">${bannerSub}</div>
      </div>
      <div class="verdict-icon">${run.verdict}</div>
    </div>
    <div class="video-frame">${videoHtml}</div>
    ${chapterTrackHtml}
    <div class="section-title">Step timeline</div>
    <div class="step-list">${stepsHtml || '<div class="rail-empty">No steps recorded.</div>'}</div>
    <div class="section-title">Evidence</div>
    <div class="evidence-strip">${shotsHtml || '<div class="rail-empty">No screenshots on file.</div>'}</div>
    ${traceHtml}
  `;

  theater.querySelectorAll('.evidence-thumb').forEach((el) => {
    el.addEventListener('click', () => openLightbox(el.dataset.src));
  });

  setupChapterTrack(run);

  const traceHint = document.getElementById('trace-hint');
  if (traceHint) {
    traceHint.title = 'Click to copy';
    traceHint.addEventListener('click', () => {
      navigator.clipboard?.writeText(traceHint.textContent.trim()).catch(() => {});
      const original = traceHint.textContent;
      traceHint.textContent = 'copied';
      setTimeout(() => { traceHint.textContent = original; }, 900);
    });
  }
}

// Builds the chapters track markup. Positions (left/width) are NOT set
// here -- they depend on the rendered <video> element's real duration,
// which isn't known until it loads. setupChapterTrack() fills those in
// once the element exists in the DOM. Returns '' (renders nothing) when
// there's no video or no steps, so old/inconclusive runs degrade to
// exactly what the dashboard did before this feature existed.
function renderChapterTrack(run, hasVideo) {
  const steps = run.steps || [];
  if (!hasVideo || steps.length === 0) return '';

  const segmentsHtml = steps
    .map((step) => {
      const label = `${String(step.index).padStart(2, '0')} ${truncateLabel(step.name, 16)}`;
      const failureCls = step.status === 'failed' ? ' chapter-segment-failure' : '';
      return `
        <div class="chapter-segment status-${escapeHtml(step.status)}${failureCls}" data-index="${step.index}" title="${escapeHtml(step.name)}">
          <span class="chapter-label">${escapeHtml(label)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <div class="chapter-track" id="chapter-track">
      <div class="chapter-playhead"></div>
      ${segmentsHtml}
    </div>
  `;
}

function truncateLabel(name, maxLen) {
  const str = String(name ?? '');
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
}

// Wires the chapter track + step-list rows + per-step action disclosure to
// the <video> element:
//   - click any marker (chapter segment, step row, or a step's sub-step
//     action row) to seek+PAUSE on that exact frame -- never seek+play, a
//     reviewer should never get a play flash or have to scrub-hunt.
//   - timeupdate highlights whichever chapter segment/step row is
//     "current" and keeps exactly one step's action disclosure
//     auto-expanded, focus-driven, matching playback.
//   - clicking a marker also scrolls that step's evidence screenshot
//     (.evidence-thumb) into view, so even a fast/short step's frame is
//     inspectable without hunting through the filmstrip.
//
// The chapter track itself only ever shows top-level chapters (the
// recordedStep beats) -- there is no sub-track on the video timeline. A
// step's finer pw:api actions (see reporter.mjs/run.mjs's `actions[]`)
// live as a collapsible disclosure in the step-list instead (see
// renderStep): a test can have many actions, and an always-visible
// sub-track on the video would clutter it.
//
// Start offset per step, in priority order:
//   1. step.startMs, when present -- a REAL wall-clock offset stamped by
//      run.mjs from reporter.mjs's captured test.step() timings. This is
//      the source of truth going forward.
//   2. LEGACY FALLBACK: the cumulative sum of prior steps' durationMs
//      (step 0 starts at 0, step N starts at the sum of durations of
//      steps [0..N-1]). This is only an estimate -- it silently absorbs
//      any time Playwright doesn't attribute to a step (inter-step gaps,
//      the delay between video-recording start and the first step
//      beginning) -- but it lets old runs recorded before reporter.mjs
//      existed still render a (less precise) chapter track instead of
//      none at all.
function setupChapterTrack(run) {
  const track = theater.querySelector('#chapter-track');
  const video = theater.querySelector('.video-frame video');
  if (!track || !video) return;

  const steps = run.steps || [];
  const segments = Array.from(track.querySelectorAll('.chapter-segment'));
  const playhead = track.querySelector('.chapter-playhead');
  const stepRows = Array.from(theater.querySelectorAll('.step-row'));
  const evidenceThumbs = Array.from(theater.querySelectorAll('.evidence-thumb'));

  let cumulativeFallback = 0;
  const startMsByIndex = steps.map((step) => {
    const fallback = cumulativeFallback;
    cumulativeFallback += step.durationMs || 0;
    return typeof step.startMs === 'number' ? step.startMs : fallback;
  });

  // Segment boundaries used for BOTH layout and "which one is current"
  // detection, clamped to the video's real duration so a step whose
  // cumulative start overruns the actual recording (setup/teardown
  // overhead the video didn't capture) still lands somewhere sane instead
  // of off the end of the track.
  function computeBoundaries() {
    const durationMs = video.duration * 1000;
    return steps.map((step, i) => {
      const rawStart = startMsByIndex[i];
      const rawNext = i < steps.length - 1 ? startMsByIndex[i + 1] : durationMs;
      const start = Math.min(rawStart, durationMs);
      const next = Math.min(Math.max(rawNext, start), durationMs);
      return { start, next };
    });
  }

  // Minimum on-screen width for a clickable chapter segment: whichever is
  // LARGER of a fixed 10px, or 1.2% of the track's own rendered width. A
  // flat percentage floor (the old 0.4% constant) can render under 10px on
  // a narrow viewport, and a flat px floor can't be expressed in the
  // percentage units segments are laid out in -- so this is computed fresh
  // from the track's real getBoundingClientRect().width on every layout().
  function minSegmentWidthPct() {
    const trackWidthPx = track.getBoundingClientRect().width;
    if (!(trackWidthPx > 0)) return 1.2;
    return Math.max((10 / trackWidthPx) * 100, 1.2);
  }

  function layout() {
    if (!isFinite(video.duration) || video.duration <= 0) return;
    const durationMs = video.duration * 1000;
    const boundaries = computeBoundaries();
    const minWidthPct = minSegmentWidthPct();
    segments.forEach((seg, i) => {
      const { start, next } = boundaries[i];
      const leftPct = (start / durationMs) * 100;
      const widthPct = Math.max(((next - start) / durationMs) * 100, minWidthPct);
      seg.style.left = `${leftPct}%`;
      seg.style.width = `${widthPct}%`;
    });
  }

  // Seek+PAUSE, never seek+play. A reviewer clicking any marker (chapter
  // segment, step row, or a sub-step action row) must land exactly on that
  // frame and stay there -- never a play flash, never scrub-hunting.
  function seekAndPause(startMs) {
    const duration = video.duration;
    const targetSec = startMs / 1000;
    const clamped = isFinite(duration) && duration > 0
      ? Math.min(Math.max(targetSec, 0), duration)
      : Math.max(targetSec, 0);
    video.pause();
    video.currentTime = clamped;
  }

  // Highlights step index `index`'s evidence-thumb (if it has one). Shared
  // by the continuous timeupdate-driven highlight (see highlightCurrent)
  // and the one-shot click handlers below, so both use exactly one source
  // of truth for "which thumb is highlighted right now".
  function setCurrentEvidence(index) {
    evidenceThumbs.forEach((thumb) => {
      thumb.classList.toggle('evidence-current', Number(thumb.dataset.stepIndex) === index);
    });
  }

  // Click-only: scrolls step `index`'s evidence-thumb into view. Deliberately
  // NOT called from highlightCurrent/timeupdate -- doing it on every tick
  // during normal playback would fight the reviewer's own scroll position.
  function revealEvidence(index) {
    setCurrentEvidence(index);
    const thumb = evidenceThumbs.find((t) => Number(t.dataset.stepIndex) === index);
    if (thumb) thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // Expands exactly one step's action disclosure at a time (or none) --
  // "focus-driven show/hide, not everything expanded at once".
  function setExpanded(index) {
    stepRows.forEach((row) => {
      row.classList.toggle('expanded', Number(row.dataset.index) === index);
    });
  }

  let expandedIndex = -1;
  let previousCurrentIndex = -1;

  segments.forEach((seg, i) => {
    seg.addEventListener('click', () => {
      seekAndPause(startMsByIndex[i]);
      revealEvidence(i);
    });
  });

  stepRows.forEach((row, i) => {
    const step = steps[i];
    const hasActions = Boolean(step && step.actions && step.actions.length);

    // Clicking the row body seeks+pauses AND (if it has captured actions)
    // toggles that row's disclosure open/closed. The chevron is part of the
    // row, not a separate listener, so clicking it does the same thing.
    row.addEventListener('click', () => {
      seekAndPause(startMsByIndex[i]);
      revealEvidence(i);
      if (hasActions) {
        expandedIndex = expandedIndex === i ? -1 : i;
        setExpanded(expandedIndex);
      }
    });

    // Sub-rows (actions) seek+pause to their OWN real startMs -- not the
    // parent step's -- and must not also trigger the parent row's
    // toggle-on-click above.
    row.querySelectorAll('.step-action-row').forEach((actionRow) => {
      actionRow.addEventListener('click', (evt) => {
        evt.stopPropagation();
        seekAndPause(Number(actionRow.dataset.startMs));
        revealEvidence(i);
      });
    });
  });

  function highlightCurrent() {
    if (!isFinite(video.duration) || video.duration <= 0) return;
    const currentMs = video.currentTime * 1000;
    const boundaries = computeBoundaries();
    let currentIndex = -1;
    segments.forEach((seg, i) => {
      const { start, next } = boundaries[i];
      const isLast = i === segments.length - 1;
      const inRange = isLast ? currentMs >= start : currentMs >= start && currentMs < next;
      seg.classList.toggle('current', inRange);
      if (inRange) currentIndex = i;
    });
    stepRows.forEach((row, i) => row.classList.toggle('step-current', i === currentIndex));
    setCurrentEvidence(currentIndex);

    // Auto-expand whichever step is current, so a reviewer watching
    // playback doesn't have to manually expand rows as the video advances.
    // Only re-decided on an actual index TRANSITION -- not every tick --
    // so a manual expand/collapse on the still-current step (e.g. clicking
    // the same row twice) isn't immediately clobbered on the next tick.
    if (currentIndex !== previousCurrentIndex) {
      previousCurrentIndex = currentIndex;
      const step = currentIndex >= 0 ? steps[currentIndex] : null;
      const hasActions = Boolean(step && step.actions && step.actions.length);
      expandedIndex = hasActions ? currentIndex : -1;
      setExpanded(expandedIndex);
    }

    if (playhead) {
      const pct = Math.min(Math.max((currentMs / (video.duration * 1000)) * 100, 0), 100);
      playhead.style.left = `${pct}%`;
    }
  }

  if (video.readyState >= 1) {
    layout();
  } else {
    video.addEventListener('loadedmetadata', layout, { once: true });
  }
  video.addEventListener('timeupdate', highlightCurrent);
}

function bannerLabelFor(run) {
  if (run.verdict === 'WORKING') return `WORKING -- ${run.title || run.test}`;
  if (run.verdict === 'BROKEN') return `BROKEN -- ${run.failureStep || 'unknown step'}`;
  return `INCONCLUSIVE -- could not determine (target down / timeout)`;
}

function bannerSubFor(run) {
  if (run.verdict === 'WORKING') return 'Does what it should: every gate observed the real page in the expected state.';
  if (run.verdict === 'BROKEN') return `The test reached the app and saw the wrong thing at "${run.failureStep || 'unknown step'}".`;
  if (run.harnessError) return run.harnessError;
  return 'The test could not reliably observe the app -- this is not a verdict on the app itself.';
}

// A step's actions[] (see reporter.mjs / run.mjs) are the pw:api sub-steps
// captured inside that top-level recordedStep() beat -- e.g. a single "open
// the connect funnel" step driving a CTA click, an overlay appearing, a
// Continue click, an auth field appearing. Old runs (recorded before this
// field existed) simply have no `actions` property, so `step.actions || []`
// degrades them to "no disclosure" rather than crashing.
//
// Rendered COLLAPSED by default as a disclosure under the step row (see
// setupChapterTrack for the expand/collapse + click-to-seek wiring). Steps
// with zero captured actions get no chevron at all -- nothing to disclose.
function renderStep(runId, step) {
  const icon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '–';
  const rowClass = step.status === 'failed' ? 'step-failed' : step.status === 'skipped' ? 'step-skipped' : '';
  const errorHtml = step.error
    ? `<div class="step-error">${escapeHtml(step.error)}</div>`
    : '';
  const actions = step.actions || [];
  const hasActions = actions.length > 0;
  const chevronHtml = hasActions
    ? '<span class="step-chevron">&#9656;</span>'
    : '<span class="step-chevron step-chevron-empty">&#9656;</span>';
  const actionsHtml = hasActions
    ? `<div class="step-actions">${actions.map((a) => `
        <div class="step-action-row" data-start-ms="${a.startMs}" title="${escapeHtml(a.label)}">
          <span class="step-action-type step-action-type-${escapeHtml(a.type)}"></span>
          <span class="step-action-label">${escapeHtml(a.label)}</span>
          <span class="step-action-time">${a.startMs} ms</span>
        </div>
      `).join('')}</div>`
    : '';
  return `
    <div class="step-row ${rowClass}" data-index="${step.index}">
      ${chevronHtml}
      <div class="step-icon ${step.status}">${icon}</div>
      <div class="step-body">
        <span class="step-name">${String(step.index).padStart(2, '0')}. ${escapeHtml(step.name)}</span>
        <span class="step-status-tag">${step.status}${step.status === 'failed' ? ' — FAILED' : ''}</span>
        ${errorHtml}
        ${actionsHtml}
      </div>
      <div class="step-duration">${step.durationMs} ms</div>
    </div>
  `;
}

function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add('open');
}

function closeLightbox() {
  lightbox.classList.remove('open');
  lightboxImg.src = '';
}

lightbox.addEventListener('click', closeLightbox);

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

main();
