import type {
  AppSettings,
  ContactStatus,
  CrmFields,
  RawVenue,
  RememberedWorkspaceState,
  Venue,
  Workspace,
} from './types';

export const REMEMBERED_WORKSPACES_KEY = 'outreach-desk-workspaces-v1';
export const SESSION_WORKSPACE_KEY = 'outreach-desk-session-workspace-v1';
export const LEGACY_CONNECTION_KEY = 'outreach-desk-connection-v2';
export const CACHE_KEY_PREFIX = 'outreach-desk-cache-v3:';

export const emptyRememberedWorkspaces: RememberedWorkspaceState = {
  activeId: null,
  items: [],
};

export const defaultSettings: AppSettings = {
  appName: 'Outreach Desk',
  appSubtitle: 'A lightweight venue and business outreach CRM',
  defaultCountryCode: 'IT',
  messageTemplate: `Ciao {{title}},

vorrei contattarvi riguardo a una possibile collaborazione.

[Personalizza questo messaggio nelle impostazioni dell'app.]

Grazie!`,
};

export const defaultCrmFields: CrmFields = {
  status: 'not-contacted',
  notes: '',
  favourite: false,
  contactedAt: null,
  followUpDate: null,
};

export const statusOptions: Array<{ value: ContactStatus; label: string }> = [
  { value: 'not-contacted', label: 'Not contacted' },
  { value: 'opened', label: 'Opened in WhatsApp' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
  { value: 'interested', label: 'Interested' },
  { value: 'booked', label: 'Booked' },
  { value: 'not-suitable', label: 'Not suitable' },
  { value: 'invalid-number', label: 'Invalid number' },
];

export function createWorkspaceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function workspaceCacheKey(workspaceId: string): string {
  return `${CACHE_KEY_PREFIX}${workspaceId}`;
}

export function isAppsScriptExecUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === 'https:' &&
      url.hostname === 'script.google.com' &&
      url.pathname.startsWith('/macros/s/') &&
      url.pathname.endsWith('/exec')
    );
  } catch {
    return false;
  }
}

export function maskToken(token: string): string {
  if (!token) return 'Not set';
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

export function venueId(venue: RawVenue): string {
  return String(
    venue.id ||
      venue.placeId ||
      venue.cid ||
      venue.phoneUnformatted ||
      venue.phone ||
      `${venue.title ?? 'venue'}|${venue.address ?? ''}`,
  );
}

export function hydrateVenues(raw: RawVenue[]): Venue[] {
  return raw.map((item) => {
    const id = venueId(item);
    return {
      ...item,
      _id: id,
      _crm: {
        ...defaultCrmFields,
        ...(item.crm ?? item._crm ?? {}),
      },
    };
  });
}

export function normalisePhone(
  raw?: string | null,
  countryCode = 'IT',
): string | null {
  if (!raw) return null;

  let digits = raw.trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (!digits.startsWith('+')) {
    if (countryCode.toUpperCase() === 'IT') {
      digits = `+39${digits.replace(/\D/g, '')}`;
    } else {
      return null;
    }
  }

  const onlyDigits = digits.replace(/\D/g, '');
  return onlyDigits.length >= 8 && onlyDigits.length <= 15
    ? onlyDigits
    : null;
}

export type PhoneKind = 'mobile' | 'landline' | 'unknown' | 'invalid';

export function phoneKind(
  raw?: string | null,
  countryCode = 'IT',
): PhoneKind {
  const phone = normalisePhone(raw, countryCode);
  if (!phone) return 'invalid';
  if (phone.startsWith('393')) return 'mobile';
  if (phone.startsWith('390')) return 'landline';
  return 'unknown';
}

export function phoneKindLabel(kind: PhoneKind): string {
  if (kind === 'mobile') return 'Mobile';
  if (kind === 'landline') return 'Landline';
  if (kind === 'invalid') return 'Invalid';
  return 'Unknown type';
}

export function renderTemplate(template: string, venue: RawVenue): string {
  const values: Record<string, string> = {
    title: venue.title ?? 'buongiorno',
    city: venue.city ?? '',
    category: venue.categoryName ?? '',
    address: venue.address ?? '',
    website: venue.website ?? '',
    phone: venue.phone ?? venue.phoneUnformatted ?? '',
  };

  return template.replace(
    /{{\s*(title|city|category|address|website|phone)\s*}}/gi,
    (_, key: string) => values[key.toLowerCase()] ?? '',
  );
}

export function whatsappUrl(
  venue: RawVenue,
  message: string,
  defaultCountryCode = 'IT',
): string | null {
  const phone = normalisePhone(
    venue.phoneUnformatted || venue.phone,
    venue.countryCode ?? defaultCountryCode,
  );

  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function readStorageJson<T>(
  storage: Storage,
  key: string,
  fallback: T,
): T {
  try {
    const value = storage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorageJson(
  storage: Storage,
  key: string,
  value: unknown,
): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Google Sheets remains the source of truth if browser storage is full.
  }
}

export function readRememberedWorkspaces(): RememberedWorkspaceState {
  return readStorageJson(
    localStorage,
    REMEMBERED_WORKSPACES_KEY,
    emptyRememberedWorkspaces,
  );
}

export function saveRememberedWorkspaces(
  state: RememberedWorkspaceState,
): void {
  writeStorageJson(localStorage, REMEMBERED_WORKSPACES_KEY, state);
}

export function readSessionWorkspace(): Workspace | null {
  return readStorageJson<Workspace | null>(
    sessionStorage,
    SESSION_WORKSPACE_KEY,
    null,
  );
}

export function saveSessionWorkspace(workspace: Workspace | null): void {
  if (!workspace) {
    sessionStorage.removeItem(SESSION_WORKSPACE_KEY);
    return;
  }
  writeStorageJson(sessionStorage, SESSION_WORKSPACE_KEY, workspace);
}

export function downloadText(
  filename: string,
  content: string,
  type: string,
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function venuesToCsv(venues: Venue[]): string {
  const header = [
    'ID',
    'Name',
    'City',
    'Category',
    'Phone',
    'Phone type',
    'Website',
    'Address',
    'Rating',
    'Reviews',
    'Status',
    'Favourite',
    'Contacted at',
    'Follow-up date',
    'Notes',
    'Google Maps',
    'Sources',
  ];

  const rows = venues.map((venue) => [
    venue._id,
    venue.title,
    venue.city,
    venue.categoryName,
    venue.phoneUnformatted || venue.phone,
    phoneKind(
      venue.phoneUnformatted || venue.phone,
      venue.countryCode ?? 'IT',
    ),
    venue.website,
    venue.address,
    venue.totalScore,
    venue.reviewsCount,
    venue._crm.status,
    venue._crm.favourite,
    venue._crm.contactedAt,
    venue._crm.followUpDate,
    venue._crm.notes,
    venue.url,
    venue.sourceUrls?.join(' | ') ?? '',
  ]);

  return [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}
