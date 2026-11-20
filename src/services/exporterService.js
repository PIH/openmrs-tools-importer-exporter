import CONSTANTS from "../utils/constants.js";
import config from "../utils/config.js";
import {fetchData} from "./openmrsService.js";
import logger from "../utils/logger.js";
import { increment } from "../utils/metrics.js";
import * as voidedDispenseOrders from "./voidedDispenseOrders.js";
import {sortByUuid, stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight} from "../utils/utils.js";

// Must match the max-results value exportPatients.js and verifyPatients.js set on the server
const MAX_RESULTS = 99999;

export async function exportUser(userUuid, server = 'SOURCE') {
  const userUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.USER : CONSTANTS.SOURCE.URLS.USER}/${userUuid}?${CONSTANTS.USER_CUSTOM_REP}`;
  const userData = await fetchData(userUrl, server);
  return parseUserAttributes(parsePersonAttributes(userData));
}

export async function exportProvider(providerUuid, server = 'SOURCE') {
  const providerUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROVIDER : CONSTANTS.SOURCE.URLS.PROVIDER}/${providerUuid}?${CONSTANTS.PROVIDER_CUSTOM_REP}`;
  const providerData = await fetchData(providerUrl, server);
  return parsePersonAttributes(providerData);
}

export async function exportRelationship(relationshipUuid, server = 'SOURCE') {
  const relationshipUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.RELATIONSHIP : CONSTANTS.SOURCE.URLS.RELATIONSHIP}/${relationshipUuid}?${CONSTANTS.RELATIONSHIP_CUSTOM_REP}`;
  return await fetchData(relationshipUrl, server);
}

export async function exportPerson(personUuid, server = 'SOURCE') {
    const personUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PERSON : CONSTANTS.SOURCE.URLS.PERSON}/${personUuid}?${CONSTANTS.PERSON_CUSTOM_REP}`;
    const personData = await fetchData(personUrl, server);
    return parsePersonAttributes(personData);
}

export async function exportPatient(patientUuid, server = 'SOURCE') {
  const patientUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}?${CONSTANTS.PATIENT_CUSTOM_REP}`;
  const visitsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.VISIT : CONSTANTS.SOURCE.URLS.VISIT}?patient=${patientUuid}&${CONSTANTS.VISIT_CUSTOM_REP}`;
  const encountersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ENCOUNTER : CONSTANTS.SOURCE.URLS.ENCOUNTER}?patient=${patientUuid}&s=default&${CONSTANTS.ENCOUNTER_CUSTOM_REP}`;
  const obsBaseUrl = server === 'TARGET' ? CONSTANTS.TARGET.URLS.OBS : CONSTANTS.SOURCE.URLS.OBS;
  // Only enough to find the encounterless obs: the encounter call already returns every encounter obs in full
  const obsUrl  = `${obsBaseUrl}?patient=${patientUuid}&v=custom:(uuid,encounter:(uuid))`;
  const testOrdersUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ORDER : CONSTANTS.SOURCE.URLS.ORDER}?orderTypes=${CONSTANTS.TEST_ORDER_TYPE_UUID},${CONSTANTS.PATHOLOGY_TEST_ORDER_TYPE}&patient=${patientUuid}&${CONSTANTS.TEST_ORDER_CUSTOM_REP}`;
  const drugOrderUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.ORDER : CONSTANTS.SOURCE.URLS.ORDER}?orderTypes=${CONSTANTS.DRUG_ORDER_TYPE_UUID}&patient=${patientUuid}&${CONSTANTS.DRUG_ORDER_CUSTOM_REP}`;
  const medicationDispenseUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.MEDICATION_DISPENSE : CONSTANTS.SOURCE.URLS.MEDICATION_DISPENSE}?patient=${patientUuid}&${CONSTANTS.MEDICATION_DISPENSE_CUSTOM_REP}`;
  const patientProgramsUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT : CONSTANTS.SOURCE.URLS.PROGRAM_ENROLLMENT}?patient=${patientUuid}&voided=false&${CONSTANTS.PROGRAM_ENROLLMENT_CUSTOM_REP}`;
  const allergiesUrl = `${server === 'TARGET' ? CONSTANTS.TARGET.URLS.PATIENT : CONSTANTS.SOURCE.URLS.PATIENT}/${patientUuid}/allergy?${CONSTANTS.ALLERGY_CUSTOM_REP}`;
  const [patientData, visitsData, encountersData, obsData, testOrderData, drugOrderData, medicationDispenseData, patientProgramsData, allergiesData] = await Promise.all([
    fetchData(patientUrl, server),
    fetchData(visitsUrl, server),
    fetchData(encountersUrl, server),
    fetchData(obsUrl, server),
    fetchData(testOrdersUrl, server),
    fetchData(drugOrderUrl, server),
    fetchData(medicationDispenseUrl, server),
    fetchData(patientProgramsUrl, server),
    fetchData(allergiesUrl, server)
  ]);

  // The export raises the REST max-results setting to 99999 instead of paging, so a search that returns
  // that many results may have been cut off
  const searches = { visits: visitsData, encounters: encountersData, obs: obsData, testOrders: testOrderData,
    drugOrders: drugOrderData, medicationDispenses: medicationDispenseData, programEnrollments: patientProgramsData,
    allergies: allergiesData };
  for (const [name, data] of Object.entries(searches)) {
    if ((data?.results?.length ?? 0) >= MAX_RESULTS) {
      logger.warn(`Patient ${patientUuid}: the ${name} search returned ${data.results.length} results, the maximum; it may be incomplete`);
      increment('searches that hit the max results (may be incomplete)');
    }
  }

  // Fetch the full representation only for the encounterless obs
  const encounterlessObsUuids = (obsData ? obsData.results : []).filter(obs => obs.encounter == null).map(obs => obs.uuid);
  const encounterlessObs = await Promise.all(encounterlessObsUuids.map(uuid =>
    fetchData(`${obsBaseUrl}/${uuid}?${CONSTANTS.OBS_CUSTOM_REP}`, server)));

  const record = {
    patient: parsePatient(patientData),
    visits: parseVisits(visitsData ? visitsData.results : []),
    encounters: parseEncounters(encountersData ? encountersData.results : [], server),
    obs: parseObsList(encounterlessObs, server),   // note that this is only encounterless obs, the majority of the obs will be coming in via the encounter
    testOrders: parseTestOrderList(testOrderData ? testOrderData.results : [], server),
    drugOrders: parseDrugOrderList(drugOrderData ? drugOrderData.results : [], server),
    medicationDispenses: parseMedicationDispense(medicationDispenseData ? medicationDispenseData.results : []),
    programEnrollments: parseProgramEnrollments(patientProgramsData ? patientProgramsData.results : []),
    allergies: parseAllergies(allergiesData ? allergiesData.results : [])
  };

  // TEMPORARY (HAI-1305): the voided drug orders and encounters that dispenses point to
  if (voidedDispenseOrders.isEnabled()) {
    const voided = await voidedDispenseOrders.exportVoidedRecordsForDispenses(record, server,
      { parseDrugOrder, parseEncounter: (encounter, s) => parseEncounters([encounter], s)[0] });
    if (voided) {
      record[voidedDispenseOrders.VOIDED_RECORDS_KEY] = voided;
    }
  }
  return record;

}

/**
 * This function is used to parse the user properties from the REST response and
 * drop all properties of type "authentication.%" (we don't want to export authentication details,
 * these will need to be set up again on the target system)
 */
function parseUserAttributes(results) {
  if (results.userProperties) {
      results.userProperties =  Object.fromEntries(
        Object.entries(results.userProperties).filter(([key, value]) => !key.startsWith('authentication.'))
      );
  }
  return results;
}

/**
 * This function is used to parse the person attributes from the REST response and
 * replaces person.attributes.value.uuid with just the value of the uuid.
 * @param person
 * @returns person
 */
function parsePersonAttributes(results) {
  let personAttributes = null;

  if ( results.attributes || results.person?.attributes !== null) {
      personAttributes = results.attributes || results.person?.attributes;
      personAttributes = personAttributes.map(attr => {
          if (attr.value && typeof attr.value === 'object' && attr.value.uuid) {
              return {
                  ...attr,
                  value: attr.value.uuid
              };
          }
          return attr;
      });
      if (results.attributes) {
          results.attributes = personAttributes;
      } else {
          results.person.attributes = personAttributes;
      }
  }
  return results;
}

function parsePatient(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(parsePersonAttributes(results));
}

function parseVisits(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseMedicationDispense(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseProgramEnrollments(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseAllergies(results) {
  return stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));
}

function parseDrugOrderList(results, server) {
  return sequenceOrders(results, 'drug').map(order => parseDrugOrder(order, server));
}

// Sorts orders (drug or test orders) so each comes after its previous order, which must be imported first.
// An order's previousOrder must be in this export too. If it isn't (e.g. the previous order is voided, so the
// order search leaves it out), the reference is dropped rather than refer to an order that won't exist on
// the target. (Before, the recursion here never ended in that case and the patient wasn't exported.)
function sequenceOrders(results, kind) {
  const orders = stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(sortByUuid(results));

  const exportedUuids = new Set(orders.map(order => order.uuid));
  orders.forEach(order => {
    if (order.previousOrder?.uuid && !exportedUuids.has(order.previousOrder.uuid)) {
      logger.warn(`${kind} order ${order.uuid} refers to previous order ${order.previousOrder.uuid}, which isn't in the export; removing the reference`);
      delete order.previousOrder;
    }
  });

  // Each pass goes through the remaining orders in uuid order, placing an order once its previous order (if
  // any) has been placed, and defers the rest to the next pass
  const sequenced = [];
  const processedUuids = new Set();
  let remaining = orders;
  while (remaining.length > 0) {
    const deferred = [];
    remaining.forEach(order => {
      if (order.previousOrder?.uuid && !processedUuids.has(order.previousOrder.uuid)) {
        deferred.push(order);
      } else {
        processedUuids.add(order.uuid);
        sequenced.push(order);
      }
    });
    if (deferred.length === remaining.length) {
      // Only possible with a cycle of previous orders; add the rest as they are rather than loop forever
      logger.warn(`${deferred.length} ${kind} orders form a cycle of previous orders; adding them unordered`);
      sequenced.push(...deferred);
      break;
    }
    remaining = deferred;
  }
  return sequenced;
}

function parseDrugOrder(inputDrugOrder, server) {
  return {
    ...inputDrugOrder,
    orderNumber: (config.ORDER_NUMBER_PREFIX && server ==='SOURCE') ? (config.ORDER_NUMBER_PREFIX + '-' + inputDrugOrder.orderNumber) : inputDrugOrder.orderNumber,
    type: 'drugorder'
  };
}

function parseTestOrderList(results, server) {
  return sequenceOrders(results, 'test').map(order => parseTestOrder(order, server));
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
  // see: https://pihemr.atlassian.net/browse/UHM-9051
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
