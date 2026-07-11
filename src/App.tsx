import { useEffect, useMemo, useState } from 'react';
import { outreachApi } from './api';
import { SetupWizard } from './components/SetupWizard';
import type {
  AppSettings,
  BootstrapData,
  ConnectionInfo,
  ContactStatus,
  CrmFields,
  RawVenue,
  RememberedWorkspaceState,
  SpreadsheetInfo,
  Venue,
  Workspace,
} from './types';
import {
  LEGACY_CONNECTION_KEY,
  defaultCrmFields,
  defaultSettings,
  downloadText,
  hydrateVenues,
  maskToken,
  normalisePhone,
  phoneKind,
  phoneKindLabel,
  readRememberedWorkspaces,
  readSessionWorkspace,
  readStorageJson,
  renderTemplate,
  saveRememberedWorkspaces,
  saveSessionWorkspace,
  statusOptions,
  venueId,
  venuesToCsv,
  whatsappUrl,
  workspaceCacheKey,
  writeStorageJson,
} from './utils';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type SetupState = { open: boolean; initial: Workspace | null };

type CachedSnapshot = BootstrapData;

const envWorkspace = createEnvironmentWorkspace();

function createEnvironmentWorkspace(): Workspace | null {
  const apiUrl = String(
    import.meta.env.VITE_API_URL ??
      import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL ??
      '',
  ).trim();
  const apiToken = String(import.meta.env.VITE_API_TOKEN ?? '').trim();
  const label = String(
    import.meta.env.VITE_CONNECTION_NAME ?? 'Development workspace',
  ).trim();

  if (!apiUrl || !apiToken) return null;
  return { id: 'environment-default', label, apiUrl, apiToken };
}

function readInitialWorkspace(
  remembered: RememberedWorkspaceState,
): Workspace | null {
  const session = readSessionWorkspace();
  if (session) return session;

  const rememberedActive = remembered.items.find(
    (workspace) => workspace.id === remembered.activeId,
  );
  if (rememberedActive) return rememberedActive;

  const legacy = readStorageJson<
    { apiUrl?: string; apiToken?: string } | null
  >(localStorage, LEGACY_CONNECTION_KEY, null);
  if (legacy?.apiUrl && legacy.apiToken) {
    return {
      id: 'legacy-workspace',
      label: 'Migrated workspace',
      apiUrl: legacy.apiUrl,
      apiToken: legacy.apiToken,
    };
  }

  return envWorkspace;
}

function App() {
  const [remembered, setRemembered] = useState<RememberedWorkspaceState>(() =>
    readRememberedWorkspaces(),
  );
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(() =>
    readInitialWorkspace(readRememberedWorkspaces()),
  );
  const [setup, setSetup] = useState<SetupState>(() => ({
    open: !readInitialWorkspace(readRememberedWorkspaces()),
    initial: null,
  }));

  const [rawVenues, setRawVenues] = useState<RawVenue[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] =
    useState<AppSettings>(defaultSettings);
  const [imports, setImports] = useState<BootstrapData['imports']>([]);
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | ContactStatus
  >('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [phoneFilter, setPhoneFilter] = useState<
    'all' | 'mobile' | 'landline'
  >('all');
  const [onlyFavourite, setOnlyFavourite] = useState(false);
  const [onlyWithPhone, setOnlyWithPhone] = useState(true);
  const [hideClosed, setHideClosed] = useState(true);

  const [datasetUrl, setDatasetUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const venues = useMemo(() => hydrateVenues(rawVenues), [rawVenues]);

  useEffect(() => {
    document.title = settings.appName || defaultSettings.appName;
  }, [settings.appName]);

  useEffect(() => {
    if (!activeWorkspace) {
      setIsConnected(false);
      setRawVenues([]);
      setImports([]);
      setSpreadsheet(null);
      setSettings(defaultSettings);
      setSettingsDraft(defaultSettings);
      setSetup({ open: true, initial: null });
      return;
    }

    const cached = readStorageJson<CachedSnapshot | null>(
      localStorage,
      workspaceCacheKey(activeWorkspace.id),
      null,
    );

    if (cached) applySnapshot(cached);
    void loadDatabase(activeWorkspace, true);
    // Workspace changes intentionally trigger a fresh bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWorkspace?.apiToken,
    activeWorkspace?.apiUrl,
    activeWorkspace?.id,
  ]);

  useEffect(() => {
    if (!activeWorkspace || !spreadsheet) return;
    writeStorageJson(localStorage, workspaceCacheKey(activeWorkspace.id), {
      spreadsheet,
      venues: rawVenues,
      settings,
      imports,
    } satisfies CachedSnapshot);
  }, [activeWorkspace, imports, rawVenues, settings, spreadsheet]);

  useEffect(() => {
    if (!selectedId && venues.length > 0) setSelectedId(venues[0]._id);
  }, [selectedId, venues]);

  const cities = useMemo(
    () =>
      [
        ...new Set(
          venues
            .map((venue) => venue.city)
            .filter(Boolean) as string[],
        ),
      ].sort(),
    [venues],
  );

  const categories = useMemo(
    () =>
      [
        ...new Set(
          venues
            .map((venue) => venue.categoryName)
            .filter(Boolean) as string[],
        ),
      ].sort(),
    [venues],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return venues.filter((venue) => {
      const rawPhone = venue.phoneUnformatted || venue.phone;
      const phone = normalisePhone(
        rawPhone,
        venue.countryCode ?? settings.defaultCountryCode,
      );
      const kind = phoneKind(
        rawPhone,
        venue.countryCode ?? settings.defaultCountryCode,
      );
      const haystack = [
        venue.title,
        venue.city,
        venue.categoryName,
        venue.address,
        venue.website,
        venue.phone,
        venue.phoneUnformatted,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        (!query || haystack.includes(query)) &&
        (statusFilter === 'all' || venue._crm.status === statusFilter) &&
        (cityFilter === 'all' || venue.city === cityFilter) &&
        (categoryFilter === 'all' ||
          venue.categoryName === categoryFilter) &&
        (phoneFilter === 'all' || kind === phoneFilter) &&
        (!onlyFavourite || venue._crm.favourite) &&
        (!onlyWithPhone || Boolean(phone)) &&
        (!hideClosed ||
          (!venue.permanentlyClosed && !venue.temporarilyClosed))
      );
    });
  }, [
    categories,
    categoryFilter,
    cityFilter,
    hideClosed,
    onlyFavourite,
    onlyWithPhone,
    phoneFilter,
    search,
    settings.defaultCountryCode,
    statusFilter,
    venues,
  ]);

  const selected =
    venues.find((venue) => venue._id === selectedId) ?? filtered[0] ?? null;

  const selectedMessage = selected
    ? renderTemplate(settings.messageTemplate, selected)
    : '';

  const selectedPhoneKind = selected
    ? phoneKind(
        selected.phoneUnformatted || selected.phone,
        selected.countryCode ?? settings.defaultCountryCode,
      )
    : 'invalid';

  const stats = useMemo(() => {
    const count = (status: ContactStatus) =>
      venues.filter((venue) => venue._crm.status === status).length;

    return {
      total: venues.length,
      sent: count('sent'),
      replied: count('replied'),
      booked: count('booked'),
    };
  }, [venues]);

  function applySnapshot(snapshot: BootstrapData) {
    setRawVenues(snapshot.venues);
    setSettings(snapshot.settings);
    setSettingsDraft(snapshot.settings);
    setImports(snapshot.imports ?? []);
    setSpreadsheet(snapshot.spreadsheet);
  }

  async function loadDatabase(
    workspace = activeWorkspace,
    quiet = false,
  ) {
    if (!workspace) return;

    setIsLoading(true);
    setError('');
    if (!quiet) setNotice('');

    try {
      const snapshot = await outreachApi.bootstrap(workspace);
      applySnapshot(snapshot);
      setIsConnected(true);
      if (!quiet) {
        setNotice(
          snapshot.venues.length
            ? `Loaded ${snapshot.venues.length} records from ${snapshot.spreadsheet.name}.`
            : 'Connected. The spreadsheet is ready for its first Apify import.',
        );
      }
    } catch (caught) {
      setIsConnected(false);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load the Google Sheet.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  function updateVenueCrmLocal(id: string, patch: Partial<CrmFields>) {
    setRawVenues((current) =>
      current.map((venue) => {
        if (venueId(venue) !== id) return venue;
        return {
          ...venue,
          crm: {
            ...defaultCrmFields,
            ...(venue.crm ?? venue._crm ?? {}),
            ...patch,
          },
        };
      }),
    );
  }

  async function persistCrm(
    id: string,
    patch: Partial<CrmFields>,
    optimistic = true,
  ) {
    if (!activeWorkspace || !isConnected) {
      setError('Connect to Google Sheets before editing CRM data.');
      return;
    }

    const previous = venues.find((venue) => venue._id === id)?._crm;
    if (optimistic) updateVenueCrmLocal(id, patch);
    setSaveState('saving');
    setError('');

    try {
      const result = await outreachApi.updateCrm(activeWorkspace, id, patch);
      updateVenueCrmLocal(id, result.crm);
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 1400);
    } catch (caught) {
      if (optimistic && previous) updateVenueCrmLocal(id, previous);
      setSaveState('error');
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save the CRM change.',
      );
    }
  }

  async function saveAppSettings() {
    if (!activeWorkspace || !isConnected) {
      setError('Connect to Google Sheets before saving settings.');
      return;
    }

    setSaveState('saving');
    setError('');

    try {
      const saved = await outreachApi.saveSettings(
        activeWorkspace,
        settingsDraft,
      );
      setSettings(saved);
      setSettingsDraft(saved);
      setShowSettings(false);
      setSaveState('saved');
      setNotice('Application settings saved to the Settings sheet.');
      window.setTimeout(() => setSaveState('idle'), 1400);
    } catch (caught) {
      setSaveState('error');
      setError(
        caught instanceof Error ? caught.message : 'Could not save settings.',
      );
    }
  }

  async function importApifyDataset() {
    const url = datasetUrl.trim();
    if (!url) {
      setError('Paste an Apify dataset-items URL first.');
      return;
    }
    if (!activeWorkspace || !isConnected) {
      setError('Connect to Google Sheets before importing.');
      return;
    }

    setIsImporting(true);
    setError('');
    setNotice('');

    try {
      const result = await outreachApi.importApify(activeWorkspace, url);
      setNotice(
        `Import complete: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped. Total: ${result.total}.`,
      );
      setDatasetUrl('');
      setShowImport(false);
      await loadDatabase(activeWorkspace, true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not import the Apify dataset.',
      );
    } finally {
      setIsImporting(false);
    }
  }

  function openWhatsapp(venue: Venue) {
    const link = whatsappUrl(
      venue,
      renderTemplate(settings.messageTemplate, venue),
      settings.defaultCountryCode,
    );

    if (!link) {
      void persistCrm(venue._id, { status: 'invalid-number' });
      setError('This record does not have a valid WhatsApp-compatible number.');
      return;
    }

    void persistCrm(venue._id, {
      status:
        venue._crm.status === 'not-contacted'
          ? 'opened'
          : venue._crm.status,
      contactedAt: venue._crm.contactedAt || new Date().toISOString(),
    });
    window.open(link, '_blank', 'noopener,noreferrer');
  }

  function exportCsv() {
    downloadText(
      'outreach-contacts.csv',
      `\uFEFF${venuesToCsv(venues)}`,
      'text/csv;charset=utf-8',
    );
  }

  function saveWorkspace(
    workspace: Workspace,
    remember: boolean,
    info: ConnectionInfo,
  ) {
    if (remember) {
      const nextItems = [
        ...remembered.items.filter((item) => item.id !== workspace.id),
        workspace,
      ];
      const nextRemembered = { activeId: workspace.id, items: nextItems };
      setRemembered(nextRemembered);
      saveRememberedWorkspaces(nextRemembered);
      saveSessionWorkspace(null);
    } else {
      const nextRemembered = {
        activeId:
          remembered.activeId === workspace.id
            ? null
            : remembered.activeId,
        items: remembered.items.filter((item) => item.id !== workspace.id),
      };
      setRemembered(nextRemembered);
      saveRememberedWorkspaces(nextRemembered);
      saveSessionWorkspace(workspace);
    }

    localStorage.removeItem(LEGACY_CONNECTION_KEY);
    setActiveWorkspace(workspace);
    setSpreadsheet(info.spreadsheet);
    setSettings(info.settings);
    setSettingsDraft(info.settings);
    setSetup({ open: false, initial: null });
    setNotice(`Connected to ${info.spreadsheet.name}.`);
  }

  function switchWorkspace(id: string) {
    const workspace = remembered.items.find((item) => item.id === id);
    if (!workspace) return;

    const nextRemembered = { ...remembered, activeId: id };
    setRemembered(nextRemembered);
    saveRememberedWorkspaces(nextRemembered);
    saveSessionWorkspace(null);
    setSelectedId(null);
    setActiveWorkspace(workspace);
  }

  function forgetActiveWorkspace() {
    if (!activeWorkspace) return;

    const confirmed = window.confirm(
      `Forget the connection “${activeWorkspace.label}” on this device? The Google Sheet itself will not be changed.`,
    );
    if (!confirmed) return;

    saveSessionWorkspace(null);
    const nextItems = remembered.items.filter(
      (item) => item.id !== activeWorkspace.id,
    );
    const nextActive =
      nextItems[0] ??
      (activeWorkspace.id === 'environment-default' ? null : envWorkspace) ??
      null;
    const nextRemembered = {
      activeId: nextItems[0]?.id ?? null,
      items: nextItems,
    };
    setRemembered(nextRemembered);
    saveRememberedWorkspaces(nextRemembered);
    setActiveWorkspace(nextActive);
    setShowSettings(false);
    setSetup({ open: !nextActive, initial: null });
  }

  if (setup.open) {
    return (
      <SetupWizard
        initialWorkspace={setup.initial}
        canCancel={Boolean(activeWorkspace)}
        onCancel={() => setSetup({ open: false, initial: null })}
        onSave={saveWorkspace}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">
            {isConnected ? 'Google Sheets connected' : 'Offline cache'}
          </p>
          <h1>{settings.appName}</h1>
          <p className="app-subtitle">{settings.appSubtitle}</p>
        </div>

        <div className="header-actions">
          <SyncBadge state={saveState} />
          {remembered.items.length > 0 && (
            <select
              className="workspace-select"
              value={
                remembered.items.some((item) => item.id === activeWorkspace?.id)
                  ? activeWorkspace?.id
                  : ''
              }
              onChange={(event) => switchWorkspace(event.target.value)}
              aria-label="Active workspace"
            >
              {!remembered.items.some(
                (item) => item.id === activeWorkspace?.id,
              ) && (
                <option value="">
                  {activeWorkspace?.label ?? 'Temporary workspace'}
                </option>
              )}
              {remembered.items.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          )}
          <button
            className="button button-secondary"
            onClick={() => void loadDatabase()}
            disabled={isLoading || !activeWorkspace}
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="button button-secondary"
            onClick={exportCsv}
            disabled={!venues.length}
          >
            Export CSV
          </button>
          <button
            className="button button-secondary"
            onClick={() => {
              setSettingsDraft(settings);
              setShowSettings(true);
            }}
          >
            Settings
          </button>
          <button
            className="button button-primary"
            onClick={() => setShowImport(true)}
            disabled={!isConnected}
          >
            Import Apify
          </button>
        </div>
      </header>

      {(notice || error) && (
        <div className={`notice ${error ? 'notice-error' : ''}`} role="status">
          <span>{error || notice}</span>
          <button
            aria-label="Dismiss"
            onClick={() => {
              setNotice('');
              setError('');
            }}
          >
            ×
          </button>
        </div>
      )}

      {!venues.length ? (
        <main className="empty-state">
          <div className="empty-card">
            <span className="empty-icon">↗</span>
            <p className="eyebrow">
              {isConnected ? 'Spreadsheet ready' : 'Connection unavailable'}
            </p>
            <h2>
              {isConnected
                ? 'Your database is empty'
                : 'Reconnect your workspace'}
            </h2>
            <p>
              {isConnected
                ? 'Paste an Apify dataset-items URL. The backend will add new records, refresh existing business data and preserve CRM fields.'
                : 'Cached records can remain visible when a request fails, but changes require a working Google Sheets connection.'}
            </p>

            {isConnected ? (
              <div className="bootstrap-import">
                <label>
                  Apify dataset URL
                  <input
                    value={datasetUrl}
                    onChange={(event) => setDatasetUrl(event.target.value)}
                    placeholder="https://api.apify.com/v2/datasets/.../items?format=json&clean=true"
                  />
                </label>
                <button
                  className="button button-primary"
                  onClick={() => void importApifyDataset()}
                  disabled={isImporting || !datasetUrl.trim()}
                >
                  {isImporting ? 'Importing…' : 'Create database from Apify'}
                </button>
              </div>
            ) : (
              <button
                className="button button-primary"
                onClick={() =>
                  setSetup({ open: true, initial: activeWorkspace })
                }
              >
                Open connection setup
              </button>
            )}
          </div>
        </main>
      ) : (
        <main className="workspace">
          <section className="sidebar">
            <div className="stats-grid">
              <Stat label="Records" value={stats.total} />
              <Stat label="Sent" value={stats.sent} />
              <Stat label="Replies" value={stats.replied} />
              <Stat label="Booked" value={stats.booked} />
            </div>

            <div className="filters">
              <input
                className="search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, city, phone…"
              />
              <div className="filter-row">
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as 'all' | ContactStatus,
                    )
                  }
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={cityFilter}
                  onChange={(event) => setCityFilter(event.target.value)}
                >
                  <option value="all">All cities</option>
                  {cities.map((city) => (
                    <option key={city}>{city}</option>
                  ))}
                </select>
              </div>
              <div className="filter-row">
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">All categories</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
                <select
                  value={phoneFilter}
                  onChange={(event) =>
                    setPhoneFilter(
                      event.target.value as 'all' | 'mobile' | 'landline',
                    )
                  }
                >
                  <option value="all">All phone types</option>
                  <option value="mobile">Mobile numbers</option>
                  <option value="landline">Landlines</option>
                </select>
              </div>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={onlyWithPhone}
                    onChange={(event) =>
                      setOnlyWithPhone(event.target.checked)
                    }
                  />
                  With phone
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={onlyFavourite}
                    onChange={(event) =>
                      setOnlyFavourite(event.target.checked)
                    }
                  />
                  Favourites
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={hideClosed}
                    onChange={(event) => setHideClosed(event.target.checked)}
                  />
                  Hide closed
                </label>
              </div>
            </div>

            <div className="list-heading">
              <strong>{filtered.length}</strong> shown ·{' '}
              <strong>{imports.length}</strong> imports
            </div>

            <div className="venue-list">
              {filtered.map((venue) => {
                const kind = phoneKind(
                  venue.phoneUnformatted || venue.phone,
                  venue.countryCode ?? settings.defaultCountryCode,
                );
                return (
                  <button
                    key={venue._id}
                    className={`venue-row ${
                      selected?._id === venue._id ? 'selected' : ''
                    }`}
                    onClick={() => setSelectedId(venue._id)}
                  >
                    <div className="venue-row-top">
                      <strong>{venue.title || 'Untitled record'}</strong>
                      <span
                        className={`status-dot status-${venue._crm.status}`}
                        title={
                          statusOptions.find(
                            (status) => status.value === venue._crm.status,
                          )?.label
                        }
                      />
                    </div>
                    <span>
                      {venue.categoryName || 'Uncategorised'} ·{' '}
                      {venue.city || 'Unknown city'}
                    </span>
                    <small>
                      {venue.phone || venue.phoneUnformatted || 'No phone'}
                      {(venue.phone || venue.phoneUnformatted) && (
                        <span className={`phone-kind phone-kind-${kind}`}>
                          {phoneKindLabel(kind)}
                        </span>
                      )}
                    </small>
                  </button>
                );
              })}
              {!filtered.length && (
                <p className="no-results">No records match these filters.</p>
              )}
            </div>
          </section>

          <section className="detail-panel">
            {selected ? (
              <>
                <div className="detail-header">
                  <div>
                    <div className="title-line">
                      <h2>{selected.title || 'Untitled record'}</h2>
                      <button
                        className={`star ${
                          selected._crm.favourite ? 'active' : ''
                        }`}
                        aria-label="Favourite"
                        onClick={() =>
                          void persistCrm(selected._id, {
                            favourite: !selected._crm.favourite,
                          })
                        }
                      >
                        ★
                      </button>
                    </div>
                    <p>
                      {selected.categoryName || 'Business'} ·{' '}
                      {selected.city || selected.state || 'Unknown location'}
                    </p>
                  </div>
                  <select
                    className={`status-select status-bg-${selected._crm.status}`}
                    value={selected._crm.status}
                    onChange={(event) =>
                      void persistCrm(selected._id, {
                        status: event.target.value as ContactStatus,
                      })
                    }
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="venue-meta">
                  <Meta
                    label="Phone"
                    value={`${
                      selected.phone ||
                      selected.phoneUnformatted ||
                      'Not available'
                    } · ${phoneKindLabel(selectedPhoneKind)}`}
                  />
                  <Meta
                    label="Address"
                    value={selected.address || 'Not available'}
                  />
                  <Meta
                    label="Rating"
                    value={
                      selected.totalScore
                        ? `${selected.totalScore} / 5 · ${
                            selected.reviewsCount ?? 0
                          } reviews`
                        : 'Not available'
                    }
                  />
                  <Meta
                    label="Website"
                    value={selected.website || 'Not available'}
                    link={selected.website || undefined}
                  />
                </div>

                {selectedPhoneKind === 'landline' && (
                  <div className="phone-warning" role="note">
                    This is a landline. It may be a valid telephone number
                    without being registered with WhatsApp.
                  </div>
                )}

                <div className="quick-actions">
                  <button
                    className={`button ${
                      selectedPhoneKind === 'mobile'
                        ? 'whatsapp'
                        : 'button-secondary'
                    }`}
                    onClick={() => openWhatsapp(selected)}
                    disabled={selectedPhoneKind === 'invalid'}
                  >
                    {selectedPhoneKind === 'landline'
                      ? 'Try WhatsApp (landline)'
                      : 'Open in WhatsApp'}
                  </button>
                  {selected.website && (
                    <a
                      className="button button-secondary"
                      href={selected.website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Website
                    </a>
                  )}
                  {selected.url && (
                    <a
                      className="button button-secondary"
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Maps
                    </a>
                  )}
                  {(selected.phoneUnformatted || selected.phone) && (
                    <a
                      className="button button-secondary"
                      href={`tel:${
                        selected.phoneUnformatted || selected.phone || ''
                      }`}
                    >
                      Call
                    </a>
                  )}
                </div>

                <div className="section-card">
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">Message</p>
                      <h3>Current template preview</h3>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSettingsDraft(settings);
                        setShowSettings(true);
                      }}
                    >
                      Edit shared template
                    </button>
                  </div>
                  <div className="preview preview-large">
                    <pre>{selectedMessage}</pre>
                  </div>
                </div>

                <div className="section-card crm-card">
                  <div>
                    <p className="eyebrow">CRM</p>
                    <h3>Notes and follow-up</h3>
                  </div>
                  <div className="crm-grid">
                    <label>
                      Follow-up date
                      <input
                        type="date"
                        value={selected._crm.followUpDate || ''}
                        onChange={(event) =>
                          void persistCrm(selected._id, {
                            followUpDate: event.target.value || null,
                          })
                        }
                      />
                    </label>
                    <label>
                      Contacted at
                      <input
                        type="datetime-local"
                        value={
                          selected._crm.contactedAt
                            ? selected._crm.contactedAt.slice(0, 16)
                            : ''
                        }
                        onChange={(event) =>
                          void persistCrm(selected._id, {
                            contactedAt: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : null,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Notes
                    <textarea
                      rows={5}
                      value={selected._crm.notes}
                      onChange={(event) =>
                        updateVenueCrmLocal(selected._id, {
                          notes: event.target.value,
                        })
                      }
                      onBlur={(event) =>
                        void persistCrm(
                          selected._id,
                          { notes: event.target.value },
                          false,
                        )
                      }
                      placeholder="Who replied, fee, availability, next action…"
                    />
                  </label>
                </div>
              </>
            ) : (
              <div className="no-selection">Select a record.</div>
            )}
          </section>
        </main>
      )}

      <footer className="footer">
        <span>
          {activeWorkspace?.label ?? 'No workspace'} ·{' '}
          {spreadsheet?.name ?? 'Google Sheets'} · credentials stay in this
          browser
        </span>
        <div className="footer-actions">
          {spreadsheet?.url && (
            <a href={spreadsheet.url} target="_blank" rel="noreferrer">
              Open spreadsheet
            </a>
          )}
          <button
            onClick={() => setSetup({ open: true, initial: null })}
          >
            Add workspace
          </button>
          <button
            onClick={() =>
              setSetup({ open: true, initial: activeWorkspace })
            }
          >
            Setup guide
          </button>
        </div>
      </footer>

      {showImport && (
        <Modal title="Import or refresh from Apify" onClose={() => setShowImport(false)}>
          <p className="modal-copy">
            Paste any Apify dataset-items URL. New records are added, matching
            records are refreshed by ID, and CRM fields are preserved.
          </p>
          <label>
            Apify dataset URL
            <input
              value={datasetUrl}
              onChange={(event) => setDatasetUrl(event.target.value)}
              placeholder="https://api.apify.com/v2/datasets/.../items?format=json&clean=true"
            />
          </label>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              onClick={() => setShowImport(false)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={() => void importApifyDataset()}
              disabled={isImporting || !datasetUrl.trim()}
            >
              {isImporting ? 'Importing…' : 'Merge dataset'}
            </button>
          </div>
        </Modal>
      )}

      {showSettings && (
        <Modal
          title="Application and workspace settings"
          onClose={() => setShowSettings(false)}
          wide
        >
          <div className="settings-section">
            <div>
              <p className="eyebrow">Shared in Google Sheets</p>
              <h3>Application settings</h3>
              <p className="modal-copy">
                These values are stored in the Settings sheet and are shared by
                everyone connected to this workspace.
              </p>
            </div>
            <div className="settings-grid">
              <label>
                App name
                <input
                  value={settingsDraft.appName}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      appName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Subtitle
                <input
                  value={settingsDraft.appSubtitle}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      appSubtitle: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Default country
                <input
                  maxLength={2}
                  value={settingsDraft.defaultCountryCode}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      defaultCountryCode: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </label>
            </div>
            <label>
              Message template
              <textarea
                className="template-editor"
                value={settingsDraft.messageTemplate}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    messageTemplate: event.target.value,
                  }))
                }
              />
              <small>
                Variables: {'{{title}} {{city}} {{category}} {{address}} {{website}} {{phone}}'}
              </small>
            </label>
          </div>

          <div className="settings-section workspace-settings">
            <div>
              <p className="eyebrow">Local to this browser</p>
              <h3>Workspace connection</h3>
            </div>
            <dl className="connection-summary">
              <div>
                <dt>Workspace</dt>
                <dd>{activeWorkspace?.label ?? 'Not connected'}</dd>
              </div>
              <div>
                <dt>Spreadsheet</dt>
                <dd>{spreadsheet?.name ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>API token</dt>
                <dd>{maskToken(activeWorkspace?.apiToken ?? '')}</dd>
              </div>
              <div>
                <dt>Records</dt>
                <dd>{spreadsheet?.venueCount ?? venues.length}</dd>
              </div>
            </dl>
            <div className="setup-button-row">
              {spreadsheet?.url && (
                <a
                  className="button button-secondary"
                  href={spreadsheet.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open spreadsheet
                </a>
              )}
              <button
                className="button button-secondary"
                onClick={() => {
                  setShowSettings(false);
                  setSetup({ open: true, initial: activeWorkspace });
                }}
              >
                Edit connection / setup help
              </button>
              <button
                className="button button-secondary"
                onClick={() => {
                  setShowSettings(false);
                  setSetup({ open: true, initial: null });
                }}
              >
                Add workspace
              </button>
              <button className="text-button danger-text" onClick={forgetActiveWorkspace}>
                Forget this workspace
              </button>
            </div>
          </div>

          <div className="modal-actions">
            <button
              className="button button-secondary"
              onClick={() => setShowSettings(false)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={() => void saveAppSettings()}
              disabled={!isConnected || saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save shared settings'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Meta({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: string;
}) {
  return (
    <div className="meta-item">
      <span>{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function SyncBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : 'Save failed';
  return <span className={`sync-badge sync-${state}`}>{label}</span>;
}

function Modal({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export default App;
