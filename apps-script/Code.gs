/**
 * Outreach Desk — Google Sheets backend
 *
 * Bind this script to the spreadsheet that should hold the CRM.
 * Run setupProject(), then generateApiToken(), then deploy as a web app.
 */

const SHEETS = {
  VENUES: 'Venues',
  IMPORTS: 'Imports',
  SETTINGS: 'Settings',
};

const VENUE_HEADERS = [
  'id',
  'placeId',
  'cid',
  'title',
  'subTitle',
  'description',
  'categoryName',
  'categoriesJson',
  'address',
  'city',
  'state',
  'countryCode',
  'website',
  'phone',
  'phoneUnformatted',
  'phoneKind',
  'totalScore',
  'reviewsCount',
  'permanentlyClosed',
  'temporarilyClosed',
  'mapsUrl',
  'imageUrl',
  'searchString',
  'scrapedAt',
  'sourceUrlsJson',
  'status',
  'notes',
  'favourite',
  'contactedAt',
  'followUpDate',
  'createdAt',
  'updatedAt',
  'lastImportedAt',
];

const IMPORT_HEADERS = [
  'importedAt',
  'datasetUrl',
  'received',
  'added',
  'updated',
  'skipped',
  'totalAfterImport',
];

const SETTINGS_HEADERS = ['key', 'value', 'updatedAt'];

const DEFAULT_SETTINGS = {
  appName: 'Outreach Desk',
  appSubtitle: 'A lightweight venue and business outreach CRM',
  defaultCountryCode: 'IT',
  messageTemplate:
    'Ciao {{title}},\n\n' +
    'vorrei contattarvi riguardo a una possibile collaborazione.\n\n' +
    '[Personalizza questo messaggio nelle impostazioni dell\'app.]\n\n' +
    'Grazie!',
};

const CRM_DEFAULTS = {
  status: 'not-contacted',
  notes: '',
  favourite: false,
  contactedAt: '',
  followUpDate: '',
};

const ALLOWED_STATUSES = [
  'not-contacted',
  'opened',
  'sent',
  'replied',
  'interested',
  'booked',
  'not-suitable',
  'invalid-number',
];

function doGet() {
  return jsonResponse_({
    ok: true,
    data: {
      service: 'Outreach Desk Google Sheets API',
      status: 'ready',
    },
  });
}

function doPost(e) {
  try {
    const request = parseRequest_(e);
    verifyToken_(request.token);
    ensureProject_();

    let data;

    switch (request.action) {
      case 'connectionInfo':
        data = connectionInfo_();
        break;
      case 'bootstrap':
        data = bootstrap_();
        break;
      case 'importApify':
        data = importApify_(request.datasetUrl);
        break;
      case 'updateCrm':
        data = updateCrm_(request.venueId, request.patch || {});
        break;
      case 'saveSettings':
        data = saveSettings_(request.settings || {});
        break;
      default:
        throw new Error('Unknown action: ' + String(request.action || ''));
    }

    return jsonResponse_({ ok: true, data: data });
  } catch (error) {
    console.error(error);
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

/** Run once from the Apps Script editor. */
function setupProject() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Open this script from a Google Sheet via Extensions → Apps Script.');
  }

  PropertiesService.getScriptProperties().setProperty(
    'SPREADSHEET_ID',
    spreadsheet.getId(),
  );

  ensureProject_();
  console.log('Spreadsheet configured: ' + spreadsheet.getUrl());
}

/**
 * Run once, then copy the token from the execution log into the app's
 * Connection dialog. Running it again invalidates the previous token.
 */
function generateApiToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  console.log('API token (copy this now): ' + token);
  return token;
}

function connectionInfo_() {
  const spreadsheet = getSpreadsheet_();
  const venueSheet = spreadsheet.getSheetByName(SHEETS.VENUES);
  const importSheet = spreadsheet.getSheetByName(SHEETS.IMPORTS);
  const settingRows = readSheetObjects_(SHEETS.SETTINGS);

  return {
    spreadsheet: {
      id: spreadsheet.getId(),
      name: spreadsheet.getName(),
      url: spreadsheet.getUrl(),
      venueCount: Math.max(0, venueSheet.getLastRow() - 1),
      importCount: Math.max(0, importSheet.getLastRow() - 1),
      settingsConfigured: settingRows.length > 0,
    },
    settings: readSettings_(),
  };
}

function bootstrap_() {
  const info = connectionInfo_();
  return {
    spreadsheet: info.spreadsheet,
    settings: info.settings,
    venues: readVenues_(),
    imports: readImports_(),
  };
}


function importApify_(datasetUrl) {
  if (!datasetUrl || typeof datasetUrl !== 'string') {
    throw new Error('An Apify dataset URL is required.');
  }

  const cleanUrl = datasetUrl.trim();
  if (!/^https:\/\/api\.apify\.com\/v2\/datasets\//i.test(cleanUrl)) {
    throw new Error('Only https://api.apify.com/v2/datasets/... URLs are accepted.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const response = UrlFetchApp.fetch(cleanUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        Accept: 'application/json',
      },
    });

    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error('Apify returned HTTP ' + statusCode + '.');
    }

    let parsed;
    try {
      parsed = JSON.parse(response.getContentText());
    } catch (error) {
      throw new Error('Apify did not return valid JSON.');
    }

    const items = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.items)
        ? parsed.items
        : null;

    if (!items) {
      throw new Error('Expected an Apify JSON array or an object containing items.');
    }

    const now = new Date().toISOString();
    const sourceUrl = redactUrl_(cleanUrl);
    const existingRows = readSheetObjects_(SHEETS.VENUES);
    const recordsById = {};

    existingRows.forEach(function (row) {
      if (row.id) recordsById[String(row.id)] = row;
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;

    items.forEach(function (item) {
      if (!item || typeof item !== 'object') {
        skipped += 1;
        return;
      }

      const incoming = normaliseIncomingVenue_(item, sourceUrl, now);
      if (!incoming.id || !incoming.title) {
        skipped += 1;
        return;
      }

      const existing = recordsById[incoming.id];
      if (existing) {
        recordsById[incoming.id] = mergeVenueRecord_(existing, incoming, now);
        updated += 1;
      } else {
        recordsById[incoming.id] = incoming;
        added += 1;
      }
    });

    const mergedRows = Object.keys(recordsById)
      .map(function (id) { return recordsById[id]; })
      .sort(function (a, b) {
        return String(a.title || '').localeCompare(String(b.title || ''));
      });

    writeSheetObjects_(SHEETS.VENUES, VENUE_HEADERS, mergedRows);

    appendImportLog_({
      importedAt: now,
      datasetUrl: sourceUrl,
      received: items.length,
      added: added,
      updated: updated,
      skipped: skipped,
      totalAfterImport: mergedRows.length,
    });

    return {
      received: items.length,
      added: added,
      updated: updated,
      skipped: skipped,
      total: mergedRows.length,
    };
  } finally {
    lock.releaseLock();
  }
}

function updateCrm_(venueIdValue, patch) {
  if (!venueIdValue) throw new Error('venueId is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.VENUES);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('The venue database is empty.');

    const headerMap = headerMap_(sheet);
    const idColumn = headerMap.id;
    const idRange = sheet.getRange(2, idColumn, lastRow - 1, 1);
    const found = idRange
      .createTextFinder(String(venueIdValue))
      .matchEntireCell(true)
      .findNext();

    if (!found) throw new Error('Venue not found: ' + venueIdValue);

    const rowNumber = found.getRow();
    const current = rowObject_(sheet, rowNumber);
    const next = {
      status: current.status || CRM_DEFAULTS.status,
      notes: current.notes || '',
      favourite: toBoolean_(current.favourite),
      contactedAt: current.contactedAt || '',
      followUpDate: current.followUpDate || '',
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      if (ALLOWED_STATUSES.indexOf(patch.status) === -1) {
        throw new Error('Invalid CRM status.');
      }
      next.status = patch.status;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
      next.notes = limitCell_(patch.notes, 45000);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'favourite')) {
      next.favourite = Boolean(patch.favourite);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'contactedAt')) {
      next.contactedAt = patch.contactedAt || '';
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'followUpDate')) {
      next.followUpDate = patch.followUpDate || '';
    }

    const now = new Date().toISOString();
    setCellByHeader_(sheet, rowNumber, headerMap, 'status', next.status);
    setCellByHeader_(sheet, rowNumber, headerMap, 'notes', next.notes);
    setCellByHeader_(sheet, rowNumber, headerMap, 'favourite', next.favourite);
    setCellByHeader_(sheet, rowNumber, headerMap, 'contactedAt', next.contactedAt);
    setCellByHeader_(sheet, rowNumber, headerMap, 'followUpDate', next.followUpDate);
    setCellByHeader_(sheet, rowNumber, headerMap, 'updatedAt', now);

    return {
      venueId: String(venueIdValue),
      crm: {
        status: next.status,
        notes: next.notes,
        favourite: next.favourite,
        contactedAt: next.contactedAt || null,
        followUpDate: next.followUpDate || null,
      },
    };
  } finally {
    lock.releaseLock();
  }
}

function saveSettings_(incoming) {
  const allowedKeys = Object.keys(DEFAULT_SETTINGS);
  const next = readSettings_();

  allowedKeys.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) return;
    const value = incoming[key];
    if (typeof value !== 'string') return;
    next[key] = limitCell_(value, key === 'messageTemplate' ? 45000 : 500);
  });

  if (!next.appName.trim()) next.appName = DEFAULT_SETTINGS.appName;
  if (!next.messageTemplate.trim()) {
    next.messageTemplate = DEFAULT_SETTINGS.messageTemplate;
  }
  next.defaultCountryCode = String(next.defaultCountryCode || 'IT')
    .trim()
    .toUpperCase()
    .slice(0, 2);

  writeSettings_(next);
  return next;
}

function readVenues_() {
  return readSheetObjects_(SHEETS.VENUES).map(function (row) {
    return {
      id: stringOrNull_(row.id),
      placeId: stringOrNull_(row.placeId),
      cid: stringOrNull_(row.cid),
      title: stringOrNull_(row.title),
      subTitle: stringOrNull_(row.subTitle),
      description: stringOrNull_(row.description),
      categoryName: stringOrNull_(row.categoryName),
      categories: parseJsonArray_(row.categoriesJson),
      address: stringOrNull_(row.address),
      city: stringOrNull_(row.city),
      state: stringOrNull_(row.state),
      countryCode: stringOrNull_(row.countryCode),
      website: stringOrNull_(row.website),
      phone: stringOrNull_(row.phone),
      phoneUnformatted: stringOrNull_(row.phoneUnformatted),
      totalScore: numberOrNull_(row.totalScore),
      reviewsCount: numberOrNull_(row.reviewsCount),
      permanentlyClosed: toBoolean_(row.permanentlyClosed),
      temporarilyClosed: toBoolean_(row.temporarilyClosed),
      url: stringOrNull_(row.mapsUrl),
      imageUrl: stringOrNull_(row.imageUrl),
      searchString: stringOrNull_(row.searchString),
      scrapedAt: stringOrNull_(row.scrapedAt),
      sourceUrls: parseJsonArray_(row.sourceUrlsJson),
      crm: {
        status: ALLOWED_STATUSES.indexOf(row.status) >= 0
          ? row.status
          : CRM_DEFAULTS.status,
        notes: String(row.notes || ''),
        favourite: toBoolean_(row.favourite),
        contactedAt: stringOrNull_(row.contactedAt),
        followUpDate: stringOrNull_(row.followUpDate),
      },
    };
  });
}

function readSettings_() {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  readSheetObjects_(SHEETS.SETTINGS).forEach(function (row) {
    if (Object.prototype.hasOwnProperty.call(settings, row.key)) {
      settings[row.key] = String(row.value == null ? '' : row.value);
    }
  });
  return settings;
}

function writeSettings_(settings) {
  const now = new Date().toISOString();
  const rows = Object.keys(DEFAULT_SETTINGS).map(function (key) {
    return {
      key: key,
      value: settings[key],
      updatedAt: now,
    };
  });
  writeSheetObjects_(SHEETS.SETTINGS, SETTINGS_HEADERS, rows);
}

function readImports_() {
  return readSheetObjects_(SHEETS.IMPORTS)
    .slice(-50)
    .reverse()
    .map(function (row) {
      return {
        importedAt: String(row.importedAt || ''),
        datasetUrl: String(row.datasetUrl || ''),
        received: Number(row.received || 0),
        added: Number(row.added || 0),
        updated: Number(row.updated || 0),
        skipped: Number(row.skipped || 0),
        totalAfterImport: Number(row.totalAfterImport || 0),
      };
    });
}

function appendImportLog_(entry) {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.IMPORTS);
  const values = IMPORT_HEADERS.map(function (header) { return entry[header] == null ? '' : entry[header]; });
  sheet.appendRow(values);
}

function normaliseIncomingVenue_(item, sourceUrl, now) {
  const id = venueId_(item);
  const sourceUrls = uniqueStrings_([sourceUrl]);

  return {
    id: id,
    placeId: cleanValue_(item.placeId),
    cid: cleanValue_(item.cid),
    title: cleanValue_(item.title),
    subTitle: cleanValue_(item.subTitle),
    description: limitCell_(item.description, 45000),
    categoryName: cleanValue_(item.categoryName),
    categoriesJson: JSON.stringify(Array.isArray(item.categories) ? item.categories : []),
    address: cleanValue_(item.address),
    city: cleanValue_(item.city),
    state: cleanValue_(item.state),
    countryCode: cleanValue_(item.countryCode) || 'IT',
    website: cleanValue_(item.website),
    phone: cleanValue_(item.phone),
    phoneUnformatted: cleanValue_(item.phoneUnformatted),
    phoneKind: phoneKind_(item.phoneUnformatted || item.phone, item.countryCode || 'IT'),
    totalScore: numberOrBlank_(item.totalScore),
    reviewsCount: numberOrBlank_(item.reviewsCount),
    permanentlyClosed: Boolean(item.permanentlyClosed),
    temporarilyClosed: Boolean(item.temporarilyClosed),
    mapsUrl: cleanValue_(item.url),
    imageUrl: cleanValue_(item.imageUrl),
    searchString: cleanValue_(item.searchString),
    scrapedAt: cleanValue_(item.scrapedAt),
    sourceUrlsJson: JSON.stringify(sourceUrls),
    status: CRM_DEFAULTS.status,
    notes: CRM_DEFAULTS.notes,
    favourite: CRM_DEFAULTS.favourite,
    contactedAt: CRM_DEFAULTS.contactedAt,
    followUpDate: CRM_DEFAULTS.followUpDate,
    createdAt: now,
    updatedAt: now,
    lastImportedAt: now,
  };
}

function mergeVenueRecord_(existing, incoming, now) {
  const merged = Object.assign({}, existing);
  const preserved = [
    'status',
    'notes',
    'favourite',
    'contactedAt',
    'followUpDate',
    'createdAt',
  ];

  VENUE_HEADERS.forEach(function (key) {
    if (preserved.indexOf(key) >= 0) return;
    const value = incoming[key];
    if (value !== '' && value !== null && value !== undefined) {
      merged[key] = value;
    }
  });

  const sourceUrls = uniqueStrings_(
    parseJsonArray_(existing.sourceUrlsJson).concat(
      parseJsonArray_(incoming.sourceUrlsJson),
    ),
  );

  merged.sourceUrlsJson = JSON.stringify(sourceUrls);
  merged.status = existing.status || CRM_DEFAULTS.status;
  merged.notes = existing.notes || '';
  merged.favourite = toBoolean_(existing.favourite);
  merged.contactedAt = existing.contactedAt || '';
  merged.followUpDate = existing.followUpDate || '';
  merged.createdAt = existing.createdAt || now;
  merged.updatedAt = now;
  merged.lastImportedAt = now;
  return merged;
}

function venueId_(item) {
  return String(
    item.placeId ||
      item.cid ||
      item.phoneUnformatted ||
      item.phone ||
      ((item.title || 'venue') + '|' + (item.address || '')),
  ).trim();
}

function phoneKind_(raw, countryCode) {
  const text = String(raw || '').replace(/\D/g, '');
  if (!text) return 'invalid';
  const country = String(countryCode || 'IT').toUpperCase();
  const phone = text.indexOf('39') === 0 ? text : country === 'IT' ? '39' + text : text;
  if (phone.indexOf('393') === 0) return 'mobile';
  if (phone.indexOf('390') === 0) return 'landline';
  return 'unknown';
}

function ensureProject_() {
  const spreadsheet = getSpreadsheet_();
  ensureSheet_(spreadsheet, SHEETS.VENUES, VENUE_HEADERS);
  ensureSheet_(spreadsheet, SHEETS.IMPORTS, IMPORT_HEADERS);
  ensureSheet_(spreadsheet, SHEETS.SETTINGS, SETTINGS_HEADERS);

  if (readSheetObjects_(SHEETS.SETTINGS).length === 0) {
    writeSettings_(DEFAULT_SETTINGS);
  }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('Spreadsheet is not configured. Run setupProject() first.');
  }
  return active;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return sheet;
  }

  const existing = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
    .getValues()[0]
    .map(String);

  headers.forEach(function (header) {
    if (existing.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing.push(header);
    }
  });

  sheet.setFrozenRows(1);
  return sheet;
}

function readSheetObjects_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);

  return values
    .filter(function (row) {
      return row.some(function (cell) { return cell !== ''; });
    })
    .map(function (row) {
      const object = {};
      headers.forEach(function (header, index) {
        object[header] = row[index];
      });
      return object;
    });
}

function writeSheetObjects_(sheetName, headers, rows) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  if (!rows.length) return;

  const values = rows.map(function (row) {
    return headers.map(function (header) {
      const value = row[header];
      return value === null || value === undefined ? '' : value;
    });
  });

  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (header, index) {
    map[String(header)] = index + 1;
  });
  return map;
}

function rowObject_(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const result = {};
  headers.forEach(function (header, index) {
    result[String(header)] = values[index];
  });
  return result;
}

function setCellByHeader_(sheet, rowNumber, headerMap, header, value) {
  if (!headerMap[header]) throw new Error('Missing sheet column: ' + header);
  sheet.getRange(rowNumber, headerMap[header]).setValue(value == null ? '' : value);
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('POST body is missing.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('POST body must be valid JSON.');
  }
}

function verifyToken_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) {
    throw new Error('API token is not configured. Run generateApiToken().');
  }
  if (!provided || String(provided) !== expected) {
    throw new Error('Invalid API token.');
  }
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function cleanValue_(value) {
  if (value === null || value === undefined) return '';
  return limitCell_(String(value).trim(), 45000);
}

function limitCell_(value, limit) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, limit || 45000);
}

function numberOrBlank_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function numberOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  return String(value);
}

function toBoolean_(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function parseJsonArray_(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function uniqueStrings_(values) {
  const seen = {};
  return values
    .map(function (value) { return String(value || '').trim(); })
    .filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function redactUrl_(url) {
  return String(url)
    .replace(/([?&])(signature|token)=[^&]*/gi, '$1$2=REDACTED')
    .replace(/\?&/, '?');
}
