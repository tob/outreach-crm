export type ContactStatus =
  | 'not-contacted'
  | 'opened'
  | 'sent'
  | 'replied'
  | 'interested'
  | 'booked'
  | 'not-suitable'
  | 'invalid-number';

export type CrmFields = {
  status: ContactStatus;
  notes: string;
  favourite: boolean;
  contactedAt: string | null;
  followUpDate: string | null;
};

export type RawVenue = {
  id?: string | null;
  title?: string | null;
  subTitle?: string | null;
  description?: string | null;
  categoryName?: string | null;
  categories?: string[] | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  countryCode?: string | null;
  website?: string | null;
  phone?: string | null;
  phoneUnformatted?: string | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
  placeId?: string | null;
  cid?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  searchString?: string | null;
  scrapedAt?: string | null;
  sourceUrls?: string[] | null;
  crm?: Partial<CrmFields> | null;
  _crm?: Partial<CrmFields> | null;
  [key: string]: unknown;
};

export type Venue = RawVenue & {
  _id: string;
  _crm: CrmFields;
};

export type AppSettings = {
  appName: string;
  appSubtitle: string;
  messageTemplate: string;
  defaultCountryCode: string;
};

export type ConnectionConfig = {
  apiUrl: string;
  apiToken: string;
};

export type Workspace = ConnectionConfig & {
  id: string;
  label: string;
};

export type RememberedWorkspaceState = {
  activeId: string | null;
  items: Workspace[];
};

export type SpreadsheetInfo = {
  id: string;
  name: string;
  url: string;
  venueCount: number;
  importCount: number;
  settingsConfigured: boolean;
};

export type ConnectionInfo = {
  spreadsheet: SpreadsheetInfo;
  settings: AppSettings;
};

export type ImportResult = {
  received: number;
  added: number;
  updated: number;
  skipped: number;
  total: number;
};

export type ImportLog = {
  importedAt: string;
  datasetUrl: string;
  received: number;
  added: number;
  updated: number;
  skipped: number;
  totalAfterImport: number;
};

export type BootstrapData = {
  spreadsheet: SpreadsheetInfo;
  settings: AppSettings;
  venues: RawVenue[];
  imports: ImportLog[];
};

export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};
