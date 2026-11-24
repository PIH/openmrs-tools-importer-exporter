import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { loadMappingFile } from './services/fileService.js';
import { fetchData, fetchDataIfExists } from './services/openmrsService.js';
import { appendCsvRows } from './utils/csvLog.js';
import CONSTANTS from './utils/constants.js';

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const MAPPED_TO_EXISTING_DIR = path.join(TARGET_DIR, 'mapped_to_existing');

const SOURCE_FACILITY_UUID = config.OPENMRS_SOURCE_FACILITY_UUID;

const USER_MAPPINGS_FILE_PATH = config.EXPORT_USER_MAPPINGS_FILE ? path.join(config.EXPORT_USER_MAPPINGS_FILE) : undefined;
const userMappings = (USER_MAPPINGS_FILE_PATH ? loadMappingFile(USER_MAPPINGS_FILE_PATH) : null) ?? {};

const REPORT_FILE = 'verify-users.csv';
const REPORT_HEADER = ['source user uuid', 'target user uuid', 'username', 'problem', 'allowedVisitLocations'];

/**
 * Checks that every imported user has access to the site it came from. Run after importUsers.js, with the same .env.
 *
 * Site access is the "allowedVisitLocations" user property: a comma-separated list of visit location uuids.
 * importUsers.js sets it to OPENMRS_SOURCE_FACILITY_UUID for a new user, and adds OPENMRS_SOURCE_FACILITY_UUID to it
 * for a user in the user mapping file (who is mapped to an existing user on the target).
 *
 * For every ${uuid}_user.json in TARGET_DIR/successful and TARGET_DIR/mapped_to_existing, it fetches the target user
 * (the mapped user, if the uuid is in the user mapping file) and reports a problem when:
 *    - the user isn't on the target (importUser skips a user whose username is already taken by another user)
 *    - allowedVisitLocations doesn't include OPENMRS_SOURCE_FACILITY_UUID (e.g. the user already existed on the
 *      target with the same uuid, so importUsers.js didn't add the site)
 *    - allowedVisitLocations lists a location more than once
 *    - allowedVisitLocations lists a uuid that isn't a Visit Location on the target
 *
 * Problems are logged and listed in LOG_HOME/verify-users.csv; files are not moved. Running it again for an earlier
 * import (with that import's TARGET_DIR, mapping file and facility) checks that a later import didn't remove its site.
 */
async function verifyUsers() {
  if (!SOURCE_FACILITY_UUID) {
    throw new Error('OPENMRS_SOURCE_FACILITY_UUID is not set, so there is no site to check');
  }

  const visitLocationUuids = await getVisitLocationUuids();
  if (!visitLocationUuids.has(SOURCE_FACILITY_UUID)) {
    logger.warn(`⚠️  OPENMRS_SOURCE_FACILITY_UUID ${SOURCE_FACILITY_UUID} is not a Visit Location on the target`);
  }

  const files = [
    ...(await userFilesIn(SUCCESS_DIR)),
    ...(await userFilesIn(MAPPED_TO_EXISTING_DIR)),
  ];

  let verified = 0;
  let failed = 0;
  // one at a time, as importUsers.js does: there are only a few hundred users
  for (const file of files) {
    const problems = await verifyUser(file, visitLocationUuids);
    if (problems.length) {
      failed++;
    } else {
      verified++;
    }
  }

  logger.info(`🎉 Users checked against ${SOURCE_FACILITY_UUID}: ${files.length}; without problems: ${verified}; with problems: ${failed}` +
    (failed ? ` (see ${path.join(config.LOG_HOME, REPORT_FILE)})` : ''));
}

// Returns the problems found for one exported user file (empty if none), after logging and reporting them
async function verifyUser(file, visitLocationUuids) {
  const sourceUser = JSON.parse(await fs.readFile(file, 'utf8'));
  const sourceUuid = sourceUser.uuid;
  const targetUuid = userMappings[sourceUuid] ?? sourceUuid;
  const problems = [];
  let allowed = '';

  let targetUser;
  try {
    targetUser = await fetchDataIfExists(`${CONSTANTS.TARGET.URLS.USER}/${targetUuid}?v=custom:(uuid,username,userProperties)`, 'TARGET');
    if (!targetUser) {
      problems.push('user not found on the target');
    }
  } catch (err) {
    problems.push(`could not fetch the user: ${err.message}`);
  }

  if (targetUser) {
    allowed = targetUser.userProperties?.allowedVisitLocations ?? '';
    const locations = allowed.split(',').map(uuid => uuid.trim()).filter(uuid => uuid.length > 0);

    if (!locations.includes(SOURCE_FACILITY_UUID)) {
      problems.push('allowedVisitLocations does not include the source facility');
    }
    const duplicates = [...new Set(locations.filter((uuid, i) => locations.indexOf(uuid) !== i))];
    if (duplicates.length) {
      problems.push(`allowedVisitLocations lists ${duplicates.join(' ')} more than once`);
    }
    const unknown = locations.filter(uuid => !visitLocationUuids.has(uuid));
    if (unknown.length) {
      problems.push(`allowedVisitLocations lists ${unknown.join(' ')}, which is not a Visit Location on the target`);
    }
  }

  const username = targetUser?.username ?? sourceUser.username;
  if (problems.length) {
    logger.warn(`⚠️  User ${username} (${sourceUuid}${targetUuid !== sourceUuid ? ` → ${targetUuid}` : ''}): ${problems.join('; ')}`);
    await appendCsvRows(REPORT_FILE, REPORT_HEADER,
      problems.map(problem => [sourceUuid, targetUuid, username, problem, allowed]));
  } else {
    logger.info(`✅ User ${username} has access to the source facility`);
  }
  return problems;
}

// The uuids of all locations tagged "Visit Location" on the target, retired ones included
async function getVisitLocationUuids() {
  const response = await fetchData(
    `${CONSTANTS.TARGET.URLS.LOCATION}?tag=${encodeURIComponent('Visit Location')}&includeAll=true&v=custom:(uuid)&limit=1000`, 'TARGET');
  return new Set((response.results ?? []).map(location => location.uuid));
}

// The paths of the ${uuid}_user.json files in a directory (none if the directory doesn't exist)
async function userFilesIn(directory) {
  try {
    return (await fs.readdir(directory))
      .filter(file => file.endsWith('_user.json'))
      .map(file => path.join(directory, file));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

verifyUsers().catch(err => logger.error(`Fatal error: ${err.message}`));
