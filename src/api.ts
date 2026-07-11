import type {
  ApiEnvelope,
  AppSettings,
  BootstrapData,
  ConnectionConfig,
  ConnectionInfo,
  CrmFields,
  ImportResult,
} from './types';

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  connection: ConnectionConfig,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!connection.apiUrl.trim()) {
    throw new ApiError('Google Apps Script URL is missing.');
  }

  if (!connection.apiToken.trim()) {
    throw new ApiError('API token is missing.');
  }

  let response: Response;

  try {
    response = await fetch(connection.apiUrl.trim(), {
      method: 'POST',
      // text/plain keeps this a simple CORS request. Apps Script web apps do not
      // reliably answer browser OPTIONS preflight requests.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        token: connection.apiToken.trim(),
        ...payload,
      }),
      redirect: 'follow',
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? `Could not reach Google Apps Script: ${error.message}`
        : 'Could not reach Google Apps Script.',
    );
  }

  if (!response.ok) {
    throw new ApiError(`Google Apps Script returned HTTP ${response.status}.`);
  }

  let envelope: ApiEnvelope<T>;

  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      'The endpoint did not return JSON. Use the deployed URL ending in /exec, not the editor or /dev URL.',
    );
  }

  if (!envelope.ok) {
    throw new ApiError(envelope.error || 'The request failed.');
  }

  if (envelope.data === undefined) {
    throw new ApiError('The response did not contain data.');
  }

  return envelope.data;
}

export const outreachApi = {
  connectionInfo(connection: ConnectionConfig): Promise<ConnectionInfo> {
    return request<ConnectionInfo>(connection, 'connectionInfo');
  },

  bootstrap(connection: ConnectionConfig): Promise<BootstrapData> {
    return request<BootstrapData>(connection, 'bootstrap');
  },

  updateCrm(
    connection: ConnectionConfig,
    venueId: string,
    patch: Partial<CrmFields>,
  ): Promise<{ venueId: string; crm: CrmFields }> {
    return request(connection, 'updateCrm', { venueId, patch });
  },

  saveSettings(
    connection: ConnectionConfig,
    settings: AppSettings,
  ): Promise<AppSettings> {
    return request(connection, 'saveSettings', { settings });
  },

  importApify(
    connection: ConnectionConfig,
    datasetUrl: string,
  ): Promise<ImportResult> {
    return request(connection, 'importApify', { datasetUrl });
  },
};
