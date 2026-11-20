// TEMPORARY (HAI-1305): carries over the voided drug orders (and voided encounters) that medication dispenses
// point to. Core doesn't stop an order or encounter with dispenses from being voided (UHM-9678), so some
// dispenses point to voided orders. The export leaves voided orders out, so those dispenses failed to import
// and their patients failed with them.
//
// Export: for each dispense whose drug order isn't among the exported drug orders, fetch that (voided) order,
// and its encounter if that is voided too, into the patient file under VOIDED_RECORDS_KEY.
// Import: post those encounters and orders and void them again on the target with VOID_REASON, before the
// dispenses are posted. Orders with no previous order go in before the patient's other drug orders, so a
// replacement order for the same drug can't clash with them; orders that renew/revise an exported order go in
// after the drug orders, once their previous order exists. Voided encounters are voided last.
//
// On by default; INCLUDE_VOIDED_DISPENSE_ORDERS=false turns it off. To remove: delete this file and its calls in
// exporterService.js and importerService.js.
import CONSTANTS from "../utils/constants.js";
import config from "../utils/config.js";
import logger from "../utils/logger.js";
import { increment } from "../utils/metrics.js";
import { deleteData, fetchData, postDataIfNotExists } from "./openmrsService.js";
import { stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight } from "../utils/utils.js";

export const VOIDED_RECORDS_KEY = 'voidedRecordsForDispenses';
const VOID_REASON = 'copied from source server due to HAI-1305';

export function isEnabled() {
  return config.INCLUDE_VOIDED_DISPENSE_ORDERS !== 'false';
}

// Adds "voided" to a "v=custom:(...)" representation
function withVoided(rep) {
  return rep.replace(/\)$/, ',voided)');
}

/**
 * Returns { encounters, drugOrders } for the dispenses in record whose drug order wasn't exported, or undefined
 * if there are none. parseDrugOrder and parseEncounter are the exporter's own parsers, so these records get the
 * same treatment (order number prefix, dates) as the rest of the export.
 */
export async function exportVoidedRecordsForDispenses(record, server, { parseDrugOrder, parseEncounter }) {
  const urls = server === 'TARGET' ? CONSTANTS.TARGET.URLS : CONSTANTS.SOURCE.URLS;
  const exportedOrderUuids = new Set(record.drugOrders.map(order => order.uuid));
  const missingOrderUuids = [...new Set(record.medicationDispenses
    .map(dispense => dispense.drugOrder?.uuid)
    .filter(uuid => uuid && !exportedOrderUuids.has(uuid)))].sort();
  if (missingOrderUuids.length === 0) {
    return undefined;
  }

  const drugOrders = [];
  const encounters = new Map();
  for (const orderUuid of missingOrderUuids) {
    const order = await fetchData(`${urls.ORDER}/${orderUuid}?${withVoided(CONSTANTS.DRUG_ORDER_CUSTOM_REP)}`, server);
    if (!order.voided) {
      logger.warn(`Patient ${record.patient.uuid}: a dispense points to drug order ${orderUuid}, which isn't voided but wasn't exported; leaving it out`);
      increment('dispense orders not exported but not voided');
      continue;
    }
    delete order.voided;
    drugOrders.push(parseDrugOrder(stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight([order])[0], server));

    const encounterUuid = order.encounter?.uuid;
    if (encounterUuid && !encounters.has(encounterUuid)) {
      const encounter = await fetchData(`${urls.ENCOUNTER}/${encounterUuid}?${withVoided(CONSTANTS.ENCOUNTER_CUSTOM_REP)}`, server);
      if (encounter.voided) {
        delete encounter.voided;
        encounters.set(encounterUuid, parseEncounter(encounter, server));
      }
    }
  }
  if (drugOrders.length === 0) {
    return undefined;
  }
  increment('voided drug orders exported for dispenses', drugOrders.length);
  increment('voided encounters exported for dispenses', encounters.size);
  return { encounters: [...encounters.values()], drugOrders };
}

// Voids the resource at url on the target, unless it's already voided (a resumed run or a retry); returns
// whether it voided it
async function voidOnTarget(url) {
  const current = await fetchData(`${url}?v=custom:(uuid,voided)`, 'TARGET');
  if (current.voided) {
    return false;
  }
  await deleteData(`${url}?reason=${encodeURIComponent(VOID_REASON)}`);
  return true;
}

async function postAndVoidOrder(order) {
  await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, order, order.uuid);
  if (await voidOnTarget(`${CONSTANTS.TARGET.URLS.ORDER}/${order.uuid}`)) {
    increment('voided drug orders imported for dispenses');
  }
}

// Orders with a previous order that isn't one of these voided orders must wait for the patient's drug orders
function needsExportedPreviousOrder(order, voidedOrderUuids) {
  return order.previousOrder?.uuid && !voidedOrderUuids.has(order.previousOrder.uuid);
}

/** Call just before posting the patient's drug orders. */
export async function importVoidedRecordsBeforeDrugOrders(record) {
  const voided = record[VOIDED_RECORDS_KEY];
  if (!isEnabled() || !voided) {
    return;
  }
  // Posted active for now: their orders go in next, and they are voided after the drug orders
  for (const encounter of voided.encounters) {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.ENCOUNTER, encounter, encounter.uuid);
  }
  const voidedOrderUuids = new Set(voided.drugOrders.map(order => order.uuid));
  for (const order of voided.drugOrders.filter(order => !needsExportedPreviousOrder(order, voidedOrderUuids))) {
    await postAndVoidOrder(order);
  }
}

/** Call just after posting the patient's drug orders (and before the dispenses). */
export async function importVoidedRecordsAfterDrugOrders(record) {
  const voided = record[VOIDED_RECORDS_KEY];
  if (!isEnabled() || !voided) {
    return;
  }
  const voidedOrderUuids = new Set(voided.drugOrders.map(order => order.uuid));
  for (const order of voided.drugOrders.filter(order => needsExportedPreviousOrder(order, voidedOrderUuids))) {
    await postAndVoidOrder(order);
  }
  for (const encounter of voided.encounters) {
    if (await voidOnTarget(`${CONSTANTS.TARGET.URLS.ENCOUNTER}/${encounter.uuid}`)) {
      increment('voided encounters imported for dispenses');
    }
  }
}

/**
 * Call on both the target record and the file contents before verification compares them. Voiding an encounter on
 * the target records the import as a change and voids its encounter providers (which REST then leaves out), so
 * those fields can't match the source for these voided encounters.
 */
export function normalizeForVerification(record) {
  for (const encounter of record?.[VOIDED_RECORDS_KEY]?.encounters ?? []) {
    delete encounter.dateChanged;
    delete encounter.changedBy;
    delete encounter.encounterProviders;
  }
  return record;
}
