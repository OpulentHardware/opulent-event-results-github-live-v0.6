const DATA_URL = './data/current-event.json';
const SOURCE_URL = 'https://live.sfrautox.com/#N';

const state = {
  data: null,
  view: 'overall',
  selectedClass: 'all',
  driverIndex: [],
  compareSelections: ['', '', '']
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, '')
    .trim();
}

function setStatus(message, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;

  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
  el.style.borderColor = isError ? 'rgba(255,62,62,0.6)' : 'rgba(223,255,0,0.26)';
  el.style.color = isError ? '#ff9a9a' : 'rgba(245,245,245,0.68)';
}

function formatDate(value) {
  if (!value || value === 'Not yet fetched') return value || '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function toNumber(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function formatTime(value) {
  if (value === null || value === undefined || value === '') return '—';

  const num = Number(value);

  if (Number.isFinite(num)) {
    return num.toFixed(3);
  }

  return String(value);
}

function formatGap(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) return '—';
  if (Math.abs(num) < 0.0005) return 'LEADER';

  return `+${num.toFixed(3)}`;
}

function cleanDriverName(name) {
  return String(name || '')
    .replace(/\s+#\d+\s*\([^)]+\)\s*$/i, '')
    .replace(/\s+\([A-Z0-9-]+\)\s*$/i, '')
    .trim();
}

function cleanClassCode(value) {
  return String(value || '')
    .replace(/^N-?/i, 'N')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
}

function normalizeDriverRow(row = {}) {
  const rawDriver = row.driver || row.name || '';
  const driverText = String(rawDriver || '').trim();

  let driver = cleanDriverName(driverText);
  let number = row.number || '';
  let cls = row.cls || row.class || row.classCode || '';

  const driverMatch = driverText.match(/^(.*?)\s+#?([A-Za-z0-9]+)\s*\(([A-Z0-9-]+)\)\s*$/i);
  if (driverMatch) {
    driver = cleanDriverName(driverMatch[1]);
    number = number || `#${driverMatch[2]}`;
    cls = cls || driverMatch[3];
  }

  const classNumberText = row.classNumber || '';
  const classNumberMatch = String(classNumberText).match(/([A-Z0-9-]+)\s*(#?[A-Za-z0-9]+)/i);
  if (classNumberMatch) {
    cls = cls || classNumberMatch[1];
    number = number || classNumberMatch[2];
  }

  cls = cleanClassCode(cls);
  number = String(number || '').trim();
  if (number && !number.startsWith('#')) number = `#${number}`;

  const classNumber = [cls, number].filter(Boolean).join(' ');

  return {
    ...row,
    driver,
    cls,
    class: cls,
    number,
    classNumber,
    label: `${driver}${classNumber ? ` — ${classNumber}` : ''}`
  };
}

function hydrateMeta() {
  const meta = state.data?.meta || state.data?.event || {};
  const eventTitle = document.getElementById('eventTitle');
  const eventDate = document.getElementById('eventDate');
  const participantCount = document.getElementById('participantCount');
  const updatedAt = document.getElementById('updatedAt');

  if (eventTitle) eventTitle.textContent = meta.title || state.data?.title || 'SFR Solo Day of Event Results';
  if (eventDate) eventDate.textContent = meta.date || state.data?.date || '—';
  if (participantCount) participantCount.textContent = meta.participants || state.data?.participants || countParticipants(state.data) || '—';
  if (updatedAt) updatedAt.textContent = formatDate(meta.updatedAt || state.data?.updatedAt);
}

function countParticipants(data) {
  if (!data) return null;
  if (Array.isArray(data.overall) && data.overall.length) return data.overall.length;

  const classRows = Object.values(data.classes || {}).flat();
  return classRows.length || null;
}

async function loadLiveData() {
  try {
    setStatus('Loading live event JSON...');

    const response = await fetch(`${DATA_URL}?v=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    ingestData(data);

    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus(`Could not load live JSON: ${error.message}. Use Choose Excel as fallback.`, true);
    updateDiagnostics(`ERROR\n${error.message}\n\nExpected file:\n${DATA_URL}`);
  }
}

function ingestData(data) {
  state.data = normalizeDataShape(data);
  state.driverIndex = buildDriverIndex(state.data);

  hydrateMeta();
  render();
  updateDiagnostics();
}

function normalizeDataShape(data) {
  const normalized = {
    ...data,
    meta: data.meta || data.event || {},
    overall: Array.isArray(data.overall) ? data.overall.map(normalizeDriverRow) : [],
    pax: Array.isArray(data.pax) ? data.pax.map(normalizeDriverRow) : [],
    classes: {},
    classOrder: Array.isArray(data.classOrder) ? data.classOrder : []
  };

  Object.entries(data.classes || {}).forEach(([cls, rows]) => {
    const cleanCls = cleanClassCode(cls);
    normalized.classes[cleanCls] = (rows || []).map(row => normalizeDriverRow({
      ...row,
      cls: row.cls || row.class || cleanCls,
      class: row.class || row.cls || cleanCls
    }));
  });

  if (!normalized.classOrder.length) {
    normalized.classOrder = Object.keys(normalized.classes);
  } else {
    normalized.classOrder = normalized.classOrder.map(cleanClassCode).filter(cls => normalized.classes[cls]);
  }

  if (!normalized.meta.updatedAt && normalized.updatedAt) {
    normalized.meta.updatedAt = normalized.updatedAt;
  }

  return normalized;
}

function setView(view) {
  state.view = view;

  if (view === 'diag') {
    toggleDiag(true);
    return;
  }

  toggleDiag(false);
  render();
}

function render() {
  if (!state.data) return;

  if (state.view === 'overall') {
    renderSimpleResults('Overall Raw Ranking', state.data.overall || [], 'BEST RAW');
    return;
  }

  if (state.view === 'pax') {
    renderSimpleResults('PAX Indexed Ranking', state.data.pax || [], 'INDEXED');
    return;
  }

  if (state.view === 'class') {
    renderClassResults();
    return;
  }

  if (state.view === 'compare') {
    renderCompare();
  }
}

function buildSubLine(row) {
  const normalized = normalizeDriverRow(row);
  const classPart = normalized.classNumber || [normalized.cls || normalized.class, normalized.number].filter(Boolean).join(' ');
  const carPart = normalized.car || '';

  if (classPart && carPart) return `${classPart} · ${carPart}`;
  return classPart || carPart || '';
}

function rankClass(rank) {
  const value = Number(rank);
  return value <= 3 ? `rank-${value}` : '';
}

function getDisplayTime(row, mode = state.view) {
  if (mode === 'overall') return row.time ?? row.rawTime ?? row.bestRaw;
  if (mode === 'pax') return row.time ?? row.indexedTime ?? row.bestPax;
  return row.time ?? row.bestRaw ?? row.indexedTime ?? row.rawTime;
}

function getViewTitle() {
  if (state.view === 'overall') return 'OVERALL';
  if (state.view === 'pax') return 'PAX';
  if (state.view === 'class') return state.selectedClass === 'all' ? 'CLASS' : state.selectedClass;
  if (state.view === 'compare') return 'COMPARE';
  return 'VIEW';
}

function renderViewDock() {
  const order = state.data?.classOrder || Object.keys(state.data?.classes || {});

  return `
    <div class="view-dock">
      <button class="view-dock-trigger" type="button" data-view-dock-toggle aria-label="Open view menu">
        <span class="view-dock-bars" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>

      <div class="view-dock-panel">
        <div class="view-dock-kicker">RESULT VIEW</div>

        <button data-view-button="overall" class="view-button ${state.view === 'overall' ? 'active' : ''}" type="button">
          OVERALL
        </button>

        <button data-view-button="pax" class="view-button ${state.view === 'pax' ? 'active' : ''}" type="button">
          PAX
        </button>

        <button data-view-button="class" class="view-button ${state.view === 'class' ? 'active' : ''}" type="button">
          CLASS
        </button>

        <button data-view-button="compare" class="view-button ${state.view === 'compare' ? 'active' : ''}" type="button">
          COMPARE
        </button>

        ${state.view === 'class' ? `
          <select class="view-dock-select" data-class-filter>
            <option value="all" ${state.selectedClass === 'all' ? 'selected' : ''}>ALL CLASSES</option>
            ${order.map(cls => `
              <option value="${escapeHtml(cls)}" ${state.selectedClass === cls ? 'selected' : ''}>
                ${escapeHtml(cls)}
              </option>
            `).join('')}
          </select>
        ` : ''}

        <button data-refresh-inline class="view-button toolbar-action" type="button">
          FETCH LIVE
        </button>

        <button data-diag-inline class="view-button diag-menu-action" type="button">
          DIAGNOSTICS
        </button>
      </div>
    </div>
  `;
}

function renderPodium(rows, label) {
  const top = rows.slice(0, 3);
  if (!top.length) return '';

  return `
    <section class="podium">
      ${top.map((row, index) => `
        <article class="podium-card">
          <div class="podium-rank">P${escapeHtml(row.rank || row.position || index + 1)}</div>
          <div class="podium-name">${escapeHtml(cleanDriverName(row.driver))}</div>
          <div class="podium-sub">${escapeHtml(buildSubLine(row))}</div>
          <div class="podium-time">${escapeHtml(formatTime(getDisplayTime(row)))}</div>
          <div class="time-label">${escapeHtml(label)}</div>
        </article>
      `).join('')}
    </section>
  `;
}

function renderSimpleResults(title, rows, timeLabel) {
  const root = document.getElementById('rankings');
  if (!root) return;

  const body = rows.length ? rows.map(row => {
    const normalized = normalizeDriverRow(row);

    return `
      <div class="result-row">
        <div class="rank ${rankClass(row.rank)}">${escapeHtml(row.rank)}</div>

        <div>
          <div class="driver-name">${escapeHtml(normalized.driver)}</div>
          <div class="driver-sub">${escapeHtml(buildSubLine(normalized))}</div>

          ${row.runs?.length ? `
            <div class="run-strip">
              ${row.runs.map(run => `<span class="run-pill">${escapeHtml(run)}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="time-cell">
          <span class="time-val">${escapeHtml(formatTime(getDisplayTime(row)))}</span>
          <span class="time-label">${escapeHtml(timeLabel)}</span>
        </div>
      </div>
    `;
  }).join('') : emptyRow('No event rows found');

  root.innerHTML = `
    ${renderPodium(rows, timeLabel)}

    <section class="results-shell">
      ${renderViewDock()}

      <section class="card results-card">
        <div class="card-header">
          <div class="class-title">
            <div class="acr-tag">${escapeHtml(getViewTitle())}</div>
            <div class="header-main">${escapeHtml(title)}</div>
          </div>

          <div class="class-count">
            ${rows.length} SOURCE ROW${rows.length === 1 ? '' : 'S'}
          </div>
        </div>

        <div class="card-body">
          ${body}
        </div>
      </section>
    </section>
  `;

  attachDockHandlers();
}

function renderClassResults() {
  const root = document.getElementById('rankings');
  if (!root) return;

  const classes = state.data.classes || {};
  const order = state.data.classOrder || Object.keys(classes);
  const selected = state.selectedClass;
  const visible = selected === 'all' ? order : [selected];

  root.innerHTML =
    visible.map((cls, index) => renderClassCard(cls, classes[cls] || [], index)).join('') ||
    renderEmptyCard('CLASS', 'No class data found');

  attachDockHandlers();
}

function renderClassCard(cls, rows, index = 0) {
  const body = rows.length ? rows.map(row => {
    const normalized = normalizeDriverRow(row);

    return `
      <div class="result-row">
        <div class="rank ${rankClass(row.position)}">${escapeHtml(row.position)}</div>

        <div>
          <div class="driver-name">${escapeHtml(normalized.driver)}</div>
          <div class="driver-sub">${escapeHtml(buildSubLine(normalized))}</div>

          ${row.runs?.length ? `
            <div class="run-strip">
              ${row.runs.map(run => `<span class="run-pill">${escapeHtml(run)}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="time-cell">
          <span class="time-val">${escapeHtml(formatTime(row.bestRaw))}</span>
          <span class="time-label">Best Raw / PAX ${escapeHtml(formatTime(row.bestPax))}</span>
        </div>
      </div>
    `;
  }).join('') : emptyRow('No class rows found');

  const card = `
    <section class="card results-card" data-class="${escapeHtml(cls)}">
      <div class="card-header">
        <div class="class-title">
          <div class="acr-tag">${escapeHtml(cls)}</div>
          <div class="header-main">Class Results</div>
        </div>

        <div class="class-count">
          ${rows.length} DRIVER${rows.length === 1 ? '' : 'S'}
        </div>
      </div>

      <div class="card-body">
        ${body}
      </div>
    </section>
  `;

  if (index === 0) {
    return `
      <section class="results-shell">
        ${renderViewDock()}
        ${card}
      </section>
    `;
  }

  return card;
}

function emptyRow(message) {
  return `
    <div class="result-row">
      <div class="rank">—</div>

      <div>
        <div class="driver-name">${escapeHtml(message)}</div>
        <div class="driver-sub">Fetch live data or choose a valid SFR-style Excel workbook.</div>
      </div>

      <div class="time-cell">
        <span class="time-val">—</span>
        <span class="time-label">NO DATA</span>
      </div>
    </div>
  `;
}

function renderEmptyCard(tag, message) {
  return `
    <section class="results-shell">
      ${renderViewDock()}

      <section class="card results-card">
        <div class="card-header">
          <div class="class-title">
            <div class="acr-tag">${escapeHtml(tag)}</div>
            <div class="header-main">${escapeHtml(message)}</div>
          </div>
        </div>

        <div class="card-body">
          ${emptyRow(message)}
        </div>
      </section>
    </section>
  `;
}

function buildDriverIndex(data) {
  const map = new Map();

  function rowKey(row = {}) {
    const normalized = normalizeDriverRow(row);
    return normalizeKey(`${normalized.driver}|${normalized.number || ''}|${normalized.cls || normalized.class || ''}`);
  }

  function upsertDriver(row = {}) {
    const normalized = normalizeDriverRow(row);
    if (!normalized.driver) return null;

    const key = rowKey(normalized);
    if (!key) return null;

    const existing = map.get(key) || {};

    const merged = normalizeDriverRow({
      ...existing,
      ...normalized,
      driver: normalized.driver || existing.driver || '',
      cls: normalized.cls || normalized.class || existing.cls || existing.class || '',
      class: normalized.class || normalized.cls || existing.class || existing.cls || '',
      number: normalized.number || existing.number || '',
      car: normalized.car || existing.car || '',

      bestRaw: normalized.bestRaw ?? normalized.rawTime ?? existing.bestRaw ?? existing.rawTime ?? null,
      bestPax: normalized.bestPax ?? normalized.indexedTime ?? existing.bestPax ?? existing.indexedTime ?? null,

      rawTime: normalized.rawTime ?? normalized.bestRaw ?? existing.rawTime ?? existing.bestRaw ?? null,
      indexedTime: normalized.indexedTime ?? normalized.bestPax ?? existing.indexedTime ?? existing.bestPax ?? null,

      overallRank: normalized.overallRank ?? existing.overallRank ?? null,
      paxRank: normalized.paxRank ?? existing.paxRank ?? null,
      classPosition: normalized.classPosition ?? normalized.position ?? existing.classPosition ?? existing.position ?? null,

      runs: normalized.runs?.length ? normalized.runs : existing.runs || []
    });

    map.set(key, merged);
    return merged;
  }

  Object.entries(data.classes || {}).forEach(([cls, rows]) => {
    rows.forEach(row => {
      upsertDriver({
        ...row,
        cls,
        class: cls,
        classPosition: row.position
      });
    });
  });

  (data.overall || []).forEach(row => {
    const match = findDriverInMap(map, row);

    if (match) {
      upsertDriver({
        ...match,
        ...row,
        overallRank: row.rank,
        bestRaw: match.bestRaw ?? row.rawTime ?? row.time,
        rawTime: row.rawTime ?? row.time,
        bestPax: match.bestPax ?? row.bestPax,
        indexedTime: match.indexedTime ?? row.indexedTime
      });
    } else {
      upsertDriver({
        ...row,
        overallRank: row.rank,
        bestRaw: row.bestRaw ?? row.rawTime ?? row.time,
        rawTime: row.rawTime ?? row.time
      });
    }
  });

  (data.pax || []).forEach(row => {
    const match = findDriverInMap(map, row);

    if (match) {
      upsertDriver({
        ...match,
        ...row,
        paxRank: row.rank,
        bestPax: match.bestPax ?? row.indexedTime ?? row.time,
        indexedTime: row.indexedTime ?? row.time,
        bestRaw: match.bestRaw ?? row.bestRaw,
        rawTime: match.rawTime ?? row.rawTime
      });
    } else {
      upsertDriver({
        ...row,
        paxRank: row.rank,
        bestPax: row.bestPax ?? row.indexedTime ?? row.time,
        indexedTime: row.indexedTime ?? row.time
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    const aRank = Number(a.overallRank || 9999);
    const bRank = Number(b.overallRank || 9999);

    if (aRank !== bRank) return aRank - bRank;

    return String(a.driver).localeCompare(String(b.driver));
  });
}

function findDriverInMap(map, row) {
  const normalized = normalizeDriverRow(row);
  const rowClass = normalized.cls || normalized.class || '';

  const keys = [
    `${normalized.driver}|${normalized.number || ''}|${rowClass}`,
    `${normalized.driver}|${normalized.number || ''}`,
    `${normalized.driver}`
  ].map(normalizeKey);

  return Array.from(map.values()).find(candidate => {
    const candidateNormalized = normalizeDriverRow(candidate);
    const candidateKeys = [
      `${candidateNormalized.driver}|${candidateNormalized.number || ''}|${candidateNormalized.cls || candidateNormalized.class || ''}`,
      `${candidateNormalized.driver}|${candidateNormalized.number || ''}`,
      `${candidateNormalized.driver}`
    ].map(normalizeKey);

    return keys.some(key => candidateKeys.includes(key));
  });
}

function findSelectedDriver(label) {
  const wanted = normalizeKey(label);

  if (!wanted) return null;

  return state.driverIndex.find(driver => normalizeKey(driver.label) === wanted) ||
    state.driverIndex.find(driver => normalizeKey(driver.driver) === wanted) ||
    state.driverIndex.find(driver => normalizeKey(driver.label).includes(wanted));
}

function renderCompare() {
  const root = document.getElementById('rankings');
  if (!root) return;

  const selectedDrivers = state.compareSelections
    .map(label => findSelectedDriver(label))
    .filter(Boolean);

  root.innerHTML = `
    <section class="results-shell">
      ${renderViewDock()}

      <section class="card results-card compare-shell">
        <div class="card-header">
          <div class="class-title">
            <div class="acr-tag">COMPARE</div>
            <div class="header-main">Driver Comparison</div>
          </div>

          <div class="class-count">
            ${selectedDrivers.length} SELECTED
          </div>
        </div>

        <div class="card-body">
          <datalist id="driverOptions">
            ${state.driverIndex.map(driver => `<option value="${escapeHtml(driver.label)}"></option>`).join('')}
          </datalist>

          <div class="compare-input-grid">
            ${[0, 1, 2].map(index => `
              <label class="compare-input-wrap">
                <span>Driver ${index + 1}</span>

                <input
                  class="compare-input"
                  data-compare-index="${index}"
                  list="driverOptions"
                  placeholder="Start typing a driver name..."
                  value="${escapeHtml(state.compareSelections[index] || '')}"
                />
              </label>
            `).join('')}
          </div>

          ${selectedDrivers.length ? renderCompareDriverCards(selectedDrivers) : renderCompareEmptyState()}
          ${selectedDrivers.length >= 2 ? renderGapAnalysis(selectedDrivers) : ''}
        </div>
      </section>
    </section>
  `;

  attachDockHandlers();
  attachCompareHandlers();
}

function attachCompareHandlers() {
  document.querySelectorAll('.compare-input').forEach(input => {
    input.addEventListener('input', event => {
      const index = Number(event.target.dataset.compareIndex);
      state.compareSelections[index] = event.target.value;
    });

    input.addEventListener('change', event => {
      const index = Number(event.target.dataset.compareIndex);
      state.compareSelections[index] = event.target.value;
      renderCompare();
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.target.blur();
        renderCompare();
      }
    });
  });
}

function renderCompareEmptyState() {
  return `
    <div class="compare-empty">
      Select two or three drivers to compare best raw, best PAX, class position,
      overall rank, PAX rank, car, and runs.
    </div>
  `;
}

function renderCompareDriverCards(drivers) {
  return `
    <div class="compare-driver-grid">
      ${drivers.map(driver => {
        const normalized = normalizeDriverRow(driver);

        return `
          <article class="compare-driver-card">
            <div class="compare-driver-top">
              <div>
                <div class="compare-driver-name">${escapeHtml(normalized.driver)}</div>
                <div class="compare-driver-sub">${escapeHtml(buildSubLine(normalized))}</div>
              </div>
            </div>

            <div class="compare-stat-table">
              <div class="compare-stat-row">
                <span>Best Raw</span>
                <strong>${escapeHtml(formatTime(driver.bestRaw || driver.rawTime))}</strong>
              </div>

              <div class="compare-stat-row">
                <span>Best PAX</span>
                <strong>${escapeHtml(formatTime(driver.bestPax || driver.indexedTime))}</strong>
              </div>

              <div class="compare-stat-row">
                <span>Overall Rank</span>
                <strong>${escapeHtml(driver.overallRank || '—')}</strong>
              </div>

              <div class="compare-stat-row">
                <span>PAX Rank</span>
                <strong>${escapeHtml(driver.paxRank || '—')}</strong>
              </div>

              <div class="compare-stat-row">
                <span>Class Position</span>
                <strong>${escapeHtml(driver.classPosition || '—')}</strong>
              </div>
            </div>

            ${driver.runs?.length ? `
              <div class="compare-runs">
                <div class="compare-section-label">Runs</div>

                <div class="run-strip">
                  ${driver.runs.map(run => `<span class="run-pill">${escapeHtml(run)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderGapAnalysis(drivers) {
  const rawDrivers = drivers
    .filter(driver => Number.isFinite(Number(driver.bestRaw || driver.rawTime)))
    .map(driver => ({
      ...driver,
      compareTime: Number(driver.bestRaw || driver.rawTime)
    }))
    .sort((a, b) => a.compareTime - b.compareTime);

  const paxDrivers = drivers
    .filter(driver => Number.isFinite(Number(driver.bestPax || driver.indexedTime)))
    .map(driver => ({
      ...driver,
      compareTime: Number(driver.bestPax || driver.indexedTime)
    }))
    .sort((a, b) => a.compareTime - b.compareTime);

  return `
    <section class="gap-analysis">
      <div class="gap-header">
        <div>
          <div class="gap-kicker">Gap Analysis</div>
          <div class="gap-title">Raw and PAX</div>
        </div>

        <div class="gap-note">
          Lower time wins. Gap is shown relative to the fastest selected driver in each category.
        </div>
      </div>

      <div class="gap-grid">
        ${renderGapTable('RAW GAP', rawDrivers, 'BEST RAW')}
        ${renderGapTable('PAX GAP', paxDrivers, 'BEST PAX')}
      </div>
    </section>
  `;
}

function renderGapTable(title, drivers, timeLabel) {
  if (!drivers.length) {
    return `
      <div class="gap-table">
        <div class="gap-table-title">${escapeHtml(title)}</div>
        <div class="gap-row muted">No valid timing data.</div>
      </div>
    `;
  }

  const leaderTime = drivers[0].compareTime;

  return `
    <div class="gap-table">
      <div class="gap-table-title">${escapeHtml(title)}</div>

      ${drivers.map((driver, index) => {
        const normalized = normalizeDriverRow(driver);
        const gap = driver.compareTime - leaderTime;

        return `
          <div class="gap-row">
            <div class="gap-pos">${index + 1}</div>

            <div class="gap-driver">
              <span>${escapeHtml(normalized.driver)}</span>
              <small>${escapeHtml(normalized.classNumber || '')}</small>
            </div>

            <div class="gap-time">
              <span>${escapeHtml(formatTime(driver.compareTime))}</span>
              <small>${escapeHtml(timeLabel)}</small>
            </div>

            <div class="gap-delta ${Math.abs(gap) < 0.0005 ? 'leader' : ''}">
              ${escapeHtml(formatGap(gap))}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function attachDockHandlers() {
  document.querySelectorAll('[data-view-dock-toggle]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const dock = button.closest('.view-dock');
      if (dock) dock.classList.toggle('active');
    });
  });

  document.querySelectorAll('[data-view-button]').forEach(button => {
    button.addEventListener('click', () => {
      setView(button.dataset.viewButton);
    });
  });

  document.querySelectorAll('[data-class-filter]').forEach(select => {
    select.addEventListener('change', event => {
      state.selectedClass = event.target.value;
      renderClassResults();
    });
  });

  document.querySelectorAll('[data-refresh-inline]').forEach(button => {
    button.addEventListener('click', () => {
      loadLiveData();
    });
  });

  document.querySelectorAll('[data-diag-inline]').forEach(button => {
    button.addEventListener('click', () => {
      toggleDiag(true);
    });
  });
}

function toggleDiag(forceState) {
  const diag = document.getElementById('diag');
  if (!diag) return;

  if (typeof forceState === 'boolean') {
    diag.classList.toggle('active', forceState);
  } else {
    diag.classList.toggle('active');
  }
}

function updateDiagnostics(customText = '') {
  const diag = document.getElementById('diagText');
  if (!diag) return;

  if (customText) {
    diag.textContent = customText;
    return;
  }

  const data = state.data || {};
  const classCounts = Object.entries(data.classes || {})
    .map(([cls, rows]) => `${cls}: ${rows.length}`)
    .join('\n');

  const lines = [
    'OPULENT EVENT RESULTS',
    '',
    `Mode: ${data.sourceMode || 'Live JSON / Local Fallback'}`,
    `Title: ${data.meta?.title || data.title || '—'}`,
    `Date: ${data.meta?.date || data.date || '—'}`,
    `Participants: ${data.meta?.participants || data.participants || countParticipants(data) || '—'}`,
    `Updated: ${data.meta?.updatedAt || data.updatedAt || '—'}`,
    '',
    `Overall rows: ${(data.overall || []).length}`,
    `PAX rows: ${(data.pax || []).length}`,
    `Class groups: ${Object.keys(data.classes || {}).length}`,
    '',
    'Class rows:',
    classCounts || '—',
    '',
    'Source:',
    data.meta?.sourceUrl || data.sourceUrl || SOURCE_URL
  ];

  diag.textContent = lines.join('\n');
}

document.addEventListener('click', event => {
  if (!event.target.closest('.view-dock')) {
    document.querySelectorAll('.view-dock.active').forEach(dock => dock.classList.remove('active'));
  }
});

function wireControls() {
  const liveButton = document.getElementById('liveButton');
  if (liveButton) {
    liveButton.addEventListener('click', () => {
      loadLiveData();
    });
  }

  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;

      setStatus('Excel upload selected. This hosted patch keeps live JSON as the primary data source. If Excel parsing is needed here, use the previous local build or add SheetJS.');
      updateDiagnostics(`Excel selected:\n${file.name}\n\nLive JSON mode is active.\n\nTo fully parse XLSX inside this hosted app, add SheetJS or reuse the local Excel parser from the local build.`);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wireControls();
  loadLiveData();
});
