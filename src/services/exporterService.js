import CONSTANTS from "../utils/constants.js";
import { fetchData } from "./openmrsService.js";


export async function exportPatient(patientUuid, server = 'SOURCE') {
  const patientUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}?${CONSTANTS.PATIENT_CUSTOM_REP}`;
  const visitsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.VISIT : CONSTANTS.SOURCE.URLS.VISIT}?patient=${patientUuid}&${CONSTANTS.VISIT_CUSTOM_REP}`;
  const encountersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ENCOUNTER : CONSTANTS.SOURCE.URLS.ENCOUNTER}?patient=${patientUuid}&s=default&${CONSTANTS.ENCOUNTER_CUSTOM_REP}`;
  const [patientData, visitsData, encountersData] = await Promise.all([
    fetchData(patientUrl, server),
    fetchData(visitsUrl, server),
    fetchData(encountersUrl, server),
  ]);

  return {
    patient: patientData,
    visits: visitsData ? visitsData.results : [],
    encounters: parseEncounters(encountersData ? encountersData.results : [])
  };

}

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