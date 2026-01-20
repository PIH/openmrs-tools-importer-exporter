import CONSTANTS from "../utils/constants.js";
import config from "../utils/config.js";
import {fetchData} from "./openmrsService.js";
import {sortByUuid, stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight} from "../utils/utils.js";

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
  const testOrdersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ORDER : CONSTANTS.SOURCE.URLS.ORDER}?orderTypes=${CONSTANTS.TEST_ORDER_TYPE_UUID},${CONSTANTS.PATHOLOGY_TEST_ORDER_TYPE}&patient=${patientUuid}&${CONSTANTS.TEST_ORDER_CUSTOM_REP}`;
  const drugOrderUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ORDER : CONSTANTS.SOURCE.URLS.ORDER}?orderTypes=${CONSTANTS.DRUG_ORDER_TYPE_UUID}&patient=${patientUuid}&${CONSTANTS.DRUG_ORDER_CUSTOM_REP}`;
  const patientProgramsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT : CONSTANTS.SOURCE.URLS.PROGRAM_ENROLLMENT}?patient=${patientUuid}&voided=false&${CONSTANTS.PROGRAM_ENROLLMENT_CUSTOM_REP}`;
  const allergiesUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}/allergy?${CONSTANTS.ALLERGY_CUSTOM_REP}`;
  const [patientData, visitsData, encountersData, obsData, testOrderData, drugOrderData, patientProgramsData, allergiesData] = await Promise.all([
    fetchData(patientUrl, server),
    fetchData(visitsUrl, server),
    fetchData(encountersUrl, server),
    fetchData(obsUrl, server),
    fetchData(testOrdersUrl, server),
    fetchData(drugOrderUrl, server),
    fetchData(patientProgramsUrl, server),
    fetchData(allergiesUrl, server)
  ]);

  return {
    patient: parsePatient(patientData),
    visits: parseVisits(visitsData ? visitsData.results : []),
    encounters: parseEncounters(encountersData ? encountersData.results : [], server),
    obs: parseObsList(obsData ? obsData.results : [], server),   // note that this is only encounterless obs, the majority of the obs will be coming in via the encounter
    testOrders: parseTestOrderList(testOrderData ? testOrderData.results : [], server),
    drugOrders: parseDrugOrderList(drugOrderData ? drugOrderData.results : [], server),
    programEnrollments: parseProgramEnrollments(patientProgramsData ? patientProgramsData.results : []),
    allergies: parseAllergies(allergiesData ? allergiesData.results : [])
  };

}

/**
 * This function is used to parse the person attributes from the REST response and
 * replaces person.attributes.value.uuid with just the value of the uuid.
 * @param person
 * @returns person
 */
function parsePersonAttributes(results) {
  if (results.person?.attributes) {
      results.person.attributes = results.person.attributes.map(attr => {
          if (attr.value && typeof attr.value === 'object' && attr.value.uuid) {
              return {
                  ...attr,
                  value: attr.value.uuid
              };
          }
          return attr;
      });
  }
  return results;
}

function parsePatient(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(parsePersonAttributes(results));
}

function parseVisits(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseProgramEnrollments(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseAllergies(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseDrugOrderList(results, server, processedUuids = []) {
  let drugOrderList = [];
  let unprocessedDrugOrderList = [];
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results))
    .forEach(drugOrder => {
      // if we haven't processsed the previous order, we don't want to add this one to the order list yet
      if (drugOrder.previousOrder?.uuid && !processedUuids.includes(drugOrder.previousOrder.uuid)) {
        unprocessedDrugOrderList.push(drugOrder);
      }
      // otherwise, process as normal
      else {
        processedUuids.push(drugOrder.uuid);
        drugOrderList.push(parseDrugOrder(drugOrder,server));
      }

    })
  // recursively process any unprocessed orders and add to the list
  // TODO: will run infinitely if there are voided previous orders (which would not be included in the export), can this happen IRL?
  if (unprocessedDrugOrderList.length > 0) {
    drugOrderList.push(...parseDrugOrderList(unprocessedDrugOrderList, server, processedUuids));
  }
  return drugOrderList;
}

function parseDrugOrder(inputDrugOrder, server) {
  return {
    ...inputDrugOrder,
    orderNumber: (config.ORDER_NUMBER_PREFIX && server ==='SOURCE') ? (config.ORDER_NUMBER_PREFIX + '-' + inputDrugOrder.orderNumber) : inputDrugOrder.orderNumber,
    type: 'drugorder'
  };
}

// TODO do we need the recursive previous order here as well (we aren't currently including the previous order in the test export)
function parseTestOrderList(results, server) {
  let testOrderList = [];
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results))
    .forEach(testOrder => {
    testOrderList.push(parseTestOrder(testOrder, server));
  })
  return testOrderList;
}

function parseTestOrder(inputTestOrder, server) {
  return {
    ...inputTestOrder,
    orderNumber: (config.ORDER_NUMBER_PREFIX  && server === 'SOURCE') ? (config.ORDER_NUMBER_PREFIX + '-' + inputTestOrder.orderNumber) : inputTestOrder.orderNumber,
    type: 'testorder'
  };
}

function parseObsList(results, server) {
  let obsList = [];
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results))
    .forEach(obs => {
    // we are only collecting *encounterless* obs here
    if (obs.encounter == null) {
      obsList.push(parseObs(obs, server));
    }
  });
  return obsList;
}

function parseObs(inputObs, server) {
  let obs = inputObs;

  // delete the resourceVersion, as this varies when the obs gets updated with interpretation and reference ranges
  delete obs['resourceVersion'];

  // if this is a Test Order Number obs, append any order number prefix when exportings from source server
  if (obs.concept.uuid === CONSTANTS.TEST_ORDER_NUMBER_CONCEPT_UUID) {
    obs.value = (config.ORDER_NUMBER_PREFIX && server ==='SOURCE') ? (config.ORDER_NUMBER_PREFIX + '-' + obs.value) : obs.value;
  }

  // don't attempt to upload/import the actual value complex, will be copying over the complex_obs directory directly
  if (inputObs.valueComplex != null) {
    delete obs['value']
  }

  // REST expects value coded obs just to have the uuid string directly set as the value
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
      importedGroupMembers.push(parseObs(expGroupMember, server));
    });
    obs.groupMembers = importedGroupMembers;
  } else {
    obs.groupMembers = [];  // REST web services is not null safe on group members, we should ticket and fix
  }
  return obs;
}

// Helper function to parse encounters
function parseEncounters(results, server) {
  let encounters = [];
  stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results))
   .forEach(result => {
    let encounter = result;
    if (result.obs && result.obs.length > 0) {
      let obs = [];
      result.obs.forEach(expObs => {
        obs.push(parseObs(expObs, server));
      });
      encounter.obs = obs;
    }
    encounters.push(encounter);
  });
  return encounters;
}
