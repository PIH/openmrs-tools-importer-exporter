
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');


// TODO: add to git (***don't include credential**)
// TODO: break up into import and export script
// TODO: componentize?

// TODO: obviously need a better way to define this list
const PATIENTS_TO_EXPORT = [
  "06e23772-6480-44c4-855e-1e099ade2cd4",
];

// Replace with your OpenMRS credentials and context path
const OPENMRS_CONTEXT_PATH = process.env.OPENMRS_SOURCE_CONTEXT_PATH;
const OPENMRS_USERNAME = process.env.OPENMRS_SOURCE_USERNAME;
const OPENMRS_PASSWORD = process.env.OPENMRS_SOURCE_PASSWORD;
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

// Helper function to get data from OpenMRS API with Basic Authentication
async function fetchData(url) {
  try {
    const response = await axios.get(url, {
      auth: {
        username: OPENMRS_USERNAME,
        password: OPENMRS_PASSWORD
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching data from OpenMRS: ", error);
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
  if (inputObs.value) {
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
    }
    logger.info('Patient data exported successfully');
  } catch (error) {
    logger.error('Error exporting patient data', error);
  }
}

exportAllPatients();


