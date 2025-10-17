import CONSTANTS from "../utils/constants.js";
import {fetchData} from "./openmrsService.js";
import {stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight} from "../utils/utils.js";

export async function exportUser(userUuid, server = 'SOURCE') {
  const userUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.USER : CONSTANTS.SOURCE.URLS.USER}/${userUuid}?${CONSTANTS.USER_CUSTOM_REP}`;
  return await fetchData(userUrl, server);
}

export async function exportProvider(providerUuid, server = 'SOURCE') {
  const providerUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROVIDER : CONSTANTS.SOURCE.URLS.PROVIDER}/${providerUuid}?${CONSTANTS.PROVIDER_CUSTOM_REP}`;
  return await fetchData(providerUrl, server);
}

export async function exportRelationship(relationshipUuid, server = 'SOURCE') {
  const relationshipUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.RELATIONSHIP : CONSTANTS.SOURCE.URLS.RELATIONSHIP}/${relationshipUuid}?${CONSTANTS.RELATIONSHIP_CUSTOM_REP}`;
  return await fetchData(relationshipUrl, server);
}

export async function exportPatient(patientUuid, server = 'SOURCE') {
  const patientUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}?${CONSTANTS.PATIENT_CUSTOM_REP}`;
  const visitsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.VISIT : CONSTANTS.SOURCE.URLS.VISIT}?patient=${patientUuid}&${CONSTANTS.VISIT_CUSTOM_REP}`;
  const encountersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ENCOUNTER : CONSTANTS.SOURCE.URLS.ENCOUNTER}?patient=${patientUuid}&s=default&${CONSTANTS.ENCOUNTER_CUSTOM_REP}`;
  const obsUrl  = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.OBS : CONSTANTS.SOURCE.URLS.OBS}?patient=${patientUuid}&${CONSTANTS.OBS_CUSTOM_REP}`;
  const testOrdersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ORDER : CONSTANTS.SOURCE.URLS.ORDER}?orderTypes=65c912c2-88cf-46c2-83ae-2b03b1f97d3a,52a447d3-a64a-11e3-9aeb-50e549534c5e&patient=${patientUuid}&${CONSTANTS.TEST_ORDER_CUSTOM_REP}`;
  const patientProgramsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT : CONSTANTS.SOURCE.URLS.PROGRAM_ENROLLMENT}?patient=${patientUuid}&voided=false&${CONSTANTS.PROGRAM_ENROLLMENT_CUSTOM_REP}`;
  const allergiesUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}/allergy?${CONSTANTS.ALLERGY_CUSTOM_REP}`;
  const [patientData, visitsData, encountersData, obsData, testOrderData, patientProgramsData, allergiesData] = await Promise.all([
    fetchData(patientUrl, server),
    fetchData(visitsUrl, server),
    fetchData(encountersUrl, server),
    fetchData(obsUrl, server),
    fetchData(testOrdersUrl, server),
    fetchData(patientProgramsUrl, server),
    fetchData(allergiesUrl, server)
  ]);

  return {
    patient: parsePatient(patientData),
    visits: parseVisits(visitsData ? visitsData.results : []),
    encounters: parseEncounters(encountersData ? encountersData.results : []),
    obs: parseObsList(obsData ? obsData.results : []),   // note that this is only encounterless obs, the majority of the obs will be coming in via the encounter
    testOrders: parseTestOrderList(testOrderData ? testOrderData.results : []),
    programEnrollments: parseProgramEnrollments(patientProgramsData ? patientProgramsData.results : []),
    allergies: parseAllergies(allergiesData ? allergiesData.results : [])
  };

}

function parsePatient(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results);
}

function parseVisits(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results);
}

function parseProgramEnrollments(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results);
}

function parseAllergies(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results);
}

function parseTestOrderList(results) {
  let testOrderList = [];
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results)
    .forEach(testOrder => {
    testOrderList.push(parseTestOrder(testOrder));
  })
  return testOrderList;
}

function parseTestOrder(inputTestOrder) {
  return {...inputTestOrder, type: 'testorder'};
}

function parseObsList(results) {
  let obsList = [];
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results)
    .forEach(obs => {
    // we are only collecting *encounterless* obs here
    if (obs.encounter == null) {
      obsList.push(parseObs(obs));
    }
  });
  return obsList;
}

function parseObs(inputObs) {
  let obs = inputObs;

  // don't attempt to upload/import the actual value complex, will be copying over the complex_obs directory directly
  if (inputObs.valueComplex != null) {
    delete obs['value']
  }

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
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(results)
   .forEach(result => {
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
