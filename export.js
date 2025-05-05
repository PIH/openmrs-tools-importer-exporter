require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// TODO: break up into utility scripts, add support for other data objects

const OPENMRS_CONTEXT_PATH = process.env.OPENMRS_SOURCE_CONTEXT_PATH;
const AUTH = {
  username: process.env.OPENMRS_SOURCE_USERNAME,
  password: process.env.OPENMRS_SOURCE_PASSWORD,
};
const EXPORT_LIST_FILE = process.env.EXPORT_LIST_FILE
const TARGET_DIRECTORY = process.env.TARGET_DIRECTORY

// Define the OpenMRS URLs and representations
const CONSTANTS = {
  URLS: {
    PATIENT: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/patient`,
    VISIT: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/visit`,
    ENCOUNTER: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/encounter`,
    OBS: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/obs`,
  },
  PATIENT_CUSTOM_REP: "v=custom:(uuid,display,identifiers:(uuid,identifier,identifierType:(uuid),preferred),person:(uuid,display,gender,age,birthdate,birthdateEstimated,dead,deathDate,causeOfDeath,names,addresses,attributes))",
  VISIT_CUSTOM_REP: "v=custom:(patient:(uuid),attributes,startDatetime,stopDatetime,indication,location:(uuid),visitType:(uuid),encounters:(uuid,patient:(uuid),location:(uuid),encounterType:(uuid),encounterDatetime,voided,voidReason),voided)",
  ENCOUNTER_CUSTOM_REP: "v=custom:(uuid,patient:(uuid),location:(uuid),encounterType:(uuid),encounterDatetime,voided,obs:(uuid,concept:(uuid),person:(uuid),obsDatetime,location:(uuid),encounter:(uuid),comment,valueModifier,valueCodedName:(uuid),groupMembers:(uuid,person:(uuid),concept:(uuid),obsDatetime,value,valueCodedName:(uuid),voided),voided,value:(uuid)))",
  OBS_CUSTOM_REP: "v=custom:(uuid,concept:(uuid),person:(uuid),obsDatetime,location:(uuid),valueCoded:(uuid),valueDatetime,valueNumeric,valueText,valueComplex,encounter:(uuid),comment,valueModifier,valueCodedName:(uuid),obsGroup:(uuid),groupMembers:(uuid),voided)"
};

function loadPatientUuids(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')); // remove empty lines or comments
  } catch (err) {
    console.error(`Failed to read UUIDs from file: ${err.message}`);
    process.exit(1);
  }
}

const UUID_FILE_PATH = path.join(EXPORT_LIST_FILE);
const PATIENTS_TO_EXPORT = loadPatientUuids(UUID_FILE_PATH);

// Helper function to get data from OpenMRS API with Basic Authentication
async function fetchData(url) {
  try {
    const response = await axios.get(url, { auth: AUTH });
    if (typeof response.data === 'string') {
      throw new Error('Bad Response - Unauthenticated?');
    }
    return response.data;
  } catch (error) {
    logger.error("Error fetching data from OpenMRS: ", error);
    return null;
  }
}

// Helper function to parse observations
function parseObs(inputObs) {
  let obs = {};
  obs.uuid = inputObs.uuid;
  obs.concept = inputObs.concept.uuid;
  obs.person = inputObs.person;
  obs.obsDatetime = inputObs.obsDatetime;
  obs.location = inputObs.location;
  obs.encounter = inputObs.encounter;
  obs.comment = inputObs.comment;
  obs.valueModifier = inputObs.valueModifier;
  obs.valueCodedName = inputObs.valueCodedName;
  obs.voided = inputObs.voided;
  if (inputObs.value != null) {
    if (inputObs.value.uuid) {
      let tempValue = {};
      tempValue.uuid = inputObs.value.uuid;
      obs.value = tempValue;
    } else {
      obs.value = inputObs.value;
    }
  }
  if (inputObs.groupMembers && inputObs.groupMembers.length > 0) {
    let importedGroupMembers = [];
    inputObs.groupMembers.forEach(expGroupMember => {
      importedGroupMembers.push(parseObs(expGroupMember));
    });
    obs.groupMembers = importedGroupMembers;
  }
  return obs;
}

// Helper function to parse encounters
function parseEncounters(results) {
  let encounters = [];
  results.forEach(result => {
    let encounter = {};
    encounter.uuid = result.uuid;
    encounter.patient = result.patient;
    if (result.location && result.location.uuid) {
      encounter.location = result.location.uuid;
    }
    encounter.encounterType = result.encounterType;
    encounter.encounterDatetime = result.encounterDatetime;
    encounter.voided = result.voided;
    if (result.obs && result.obs.length > 0) {
      let obs = [];
      result.obs.forEach(expObs => {
        obs.push(parseObs(expObs));
      });
      encounter.obs = obs;
    }
    encounters.push(encounter);
  });
  return encounters;
}

async function exportAllPatients()  {

  try {
    for (const patientUuid of PATIENTS_TO_EXPORT) {
      const patientUrl = `${CONSTANTS.URLS.PATIENT}/${patientUuid}?${CONSTANTS.PATIENT_CUSTOM_REP}`;
      const visitsUrl = `${CONSTANTS.URLS.VISIT}?patient=${patientUuid}&${CONSTANTS.VISIT_CUSTOM_REP}`;
      const encountersUrl = `${CONSTANTS.URLS.ENCOUNTER}?patient=${patientUuid}&s=default&${CONSTANTS.ENCOUNTER_CUSTOM_REP}`;
      const [patientData, visitsData, encountersData] = await Promise.all([
        fetchData(patientUrl),
        fetchData(visitsUrl),
        fetchData(encountersUrl),
      ]);

      let patientRecord = {
        patient: patientData,
        visits: visitsData ? visitsData.results : [],
        encounters: parseEncounters(encountersData ? encountersData.results : [])
      };

      const jsonData = JSON.stringify([patientRecord], null, 4);
      const filename = `${patientUuid}_patient.json`;

      // Save to file
      fs.writeFileSync(path.join(TARGET_DIRECTORY, filename), jsonData);
      logger.info(`Patient data exported to ${filename}`);
    }
    logger.info('Patient data exported successfully');
  } catch (error) {
    logger.error('Error exporting patient data', error);
  }
}

exportAllPatients();


