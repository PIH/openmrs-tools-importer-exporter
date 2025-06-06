import CONSTANTS from "../utils/constants.js";
import {fetchData} from "./openmrsService.js";

export async function exportUser(userUuid, server = 'SOURCE') {
  const userUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.USER : CONSTANTS.SOURCE.URLS.USER}/${userUuid}?${CONSTANTS.USER_CUSTOM_REP}`;
  const user = await fetchData(userUrl, server);
  return parseUser(user);
}

function parseUser(inputUser) {
  let user = inputUser;
  // TODO currently no processing required, remove this function entirely if not needed
  return user;
}

export async function exportProvider(providerUuid, server = 'SOURCE') {
  const providerUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROVIDER : CONSTANTS.SOURCE.URLS.PROVIDER}/${providerUuid}?${CONSTANTS.PROVIDER_CUSTOM_REP}`;
  return await fetchData(providerUrl, server);
}

export async function exportPatient(patientUuid, server = 'SOURCE') {
  const patientUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}?${CONSTANTS.PATIENT_CUSTOM_REP}`;
  const visitsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.VISIT : CONSTANTS.SOURCE.URLS.VISIT}?patient=${patientUuid}&${CONSTANTS.VISIT_CUSTOM_REP}`;
  const encountersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ENCOUNTER : CONSTANTS.SOURCE.URLS.ENCOUNTER}?patient=${patientUuid}&s=default&${CONSTANTS.ENCOUNTER_CUSTOM_REP}`;
  const patientProgramsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT : CONSTANTS.SOURCE.URLS.PROGRAM_ENROLLMENT}?patient=${patientUuid}&voided=false&${CONSTANTS.PROGRAM_ENROLLMENT_CUSTOM_REP}`;
  const [patientData, visitsData, encountersData, patientProgramsData] = await Promise.all([
    fetchData(patientUrl, server),
    fetchData(visitsUrl, server),
    fetchData(encountersUrl, server),
    fetchData(patientProgramsUrl, server)
  ]);

  return {
    patient: patientData,
    visits: visitsData ? visitsData.results : [],
    encounters: parseEncounters(encountersData ? encountersData.results : []),
    programEnrollments: patientProgramsData ? patientProgramsData.results : []
  };

}

function parseObs(inputObs) {
  let obs = inputObs;
  if (inputObs.value != null) {
    if (inputObs.value.uuid) {
      obs.value = inputObs.value.uuid;
    } else {
      obs.value = inputObs.value;
    }
  }
  else {
    delete obs['value'];  // REST web services doesn't like when you try to import an obs with an explicitly null value (ie obs group), we should ticket and fix
  }
  if (inputObs.groupMembers && inputObs.groupMembers.length > 0) {
    let importedGroupMembers = [];
    inputObs.groupMembers.forEach(expGroupMember => {
      importedGroupMembers.push(parseObs(expGroupMember));
    });
    obs.groupMembers = importedGroupMembers;
  } else {
    obs.groupMembers = [];  // REST web services is not null safe on group members, we should ticket and fix
  }
  return obs;
}

// Helper function to parse encounters
function parseEncounters(results) {
  let encounters = [];
  results.forEach(result => {
    let encounter = result;
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