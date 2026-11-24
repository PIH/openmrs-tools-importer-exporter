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
//
// TEMPORARY (HAI-1306), same approach: voided *previous* orders. A drug order can revise, renew or discontinue an
// order that was voided afterwards (its encounter deleted, or removed from its form). Without it, a REVISE or
// DISCONTINUE fails to import ("Previous Order is required"). Export: such previous orders (following chains) are
// sequenced with the patient's drug orders, then kept under VOIDED_RECORDS_KEY.voidedPreviousOrders, with their
// encounters if voided. Import: each is posted, still active, just before the first order that refers to it, so
// that order stops it as it did on the source; all are voided again after the drug orders. On by default;
// INCLUDE_VOIDED_PREVIOUS_ORDERS=false turns it off.
import CONSTANTS from "../utils/constants.js";
import config from "../utils/config.js";
import logger from "../utils/logger.js";
import { increment } from "../utils/metrics.js";
import { deleteData, fetchData, postDataIfNotExists } from "./openmrsService.js";
import { stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight } from "../utils/utils.js";

export const VOIDED_RECORDS_KEY = 'voidedRecordsForDispenses';
const VOID_REASON = 'copied from source server due to HAI-1305';
const PREVIOUS_VOID_REASON = 'copied from source server due to HAI-1306';

export function isEnabled() {
  return config.INCLUDE_VOIDED_DISPENSE_ORDERS !== 'false';
}

export function isVoidedPreviousEnabled() {
  return config.INCLUDE_VOIDED_PREVIOUS_ORDERS !== 'false';
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
export async function exportVoidedRecordsForDispenses(record, server, { parseDrugOrder, parseEncounter }, alreadyIncluded = new Set()) {
  const urls = server === 'TARGET' ? CONSTANTS.TARGET.URLS : CONSTANTS.SOURCE.URLS;
  const exportedOrderUuids = new Set([...record.drugOrders.map(order => order.uuid), ...alreadyIncluded]);
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

/**
 * HAI-1306: the voided drug orders that the given (REST) drug orders refer to as their previous order, following
 * chains of voided previous orders. Returns them as REST returned them, without the voided flag.
 */
export async function fetchVoidedPreviousOrders(drugOrders, server, patientUuid) {
  const urls = server === 'TARGET' ? CONSTANTS.TARGET.URLS : CONSTANTS.SOURCE.URLS;
  const known = new Set(drugOrders.map(order => order.uuid));
  const fetched = [];
  let missing = drugOrders.map(order => order.previousOrder?.uuid).filter(uuid => uuid && !known.has(uuid));
  while (missing.length > 0) {
    const next = [];
    for (const uuid of [...new Set(missing)].sort()) {
      if (known.has(uuid)) {
        continue;
      }
      known.add(uuid);
      const order = await fetchData(`${urls.ORDER}/${uuid}?${withVoided(CONSTANTS.DRUG_ORDER_CUSTOM_REP)}`, server);
      if (!order.voided) {
        logger.warn(`Patient ${patientUuid}: an order refers to previous order ${uuid}, which isn't voided but wasn't exported; leaving it out`);
        continue;
      }
      delete order.voided;
      fetched.push(order);
      if (order.previousOrder?.uuid && !known.has(order.previousOrder.uuid)) {
        next.push(order.previousOrder.uuid);
      }
    }
    missing = next;
  }
  return fetched;
}

/**
 * HAI-1306: adds the (parsed, sequenced) voided previous orders, and their encounters if voided, to the voided
 * records (which may be undefined); returns the voided records, or undefined if there are none.
 */
export async function addVoidedPreviousOrders(voided, voidedPreviousOrders, server, parseEncounter) {
  if (voidedPreviousOrders.length === 0) {
    return voided;
  }
  const urls = server === 'TARGET' ? CONSTANTS.TARGET.URLS : CONSTANTS.SOURCE.URLS;
  const result = voided ?? { encounters: [], drugOrders: [] };
  const encounterUuids = new Set(result.encounters.map(encounter => encounter.uuid));
  for (const order of voidedPreviousOrders) {
    const encounterUuid = order.encounter?.uuid;
    if (encounterUuid && !encounterUuids.has(encounterUuid)) {
      encounterUuids.add(encounterUuid);
      const encounter = await fetchData(`${urls.ENCOUNTER}/${encounterUuid}?${withVoided(CONSTANTS.ENCOUNTER_CUSTOM_REP)}`, server);
      if (encounter.voided) {
        delete encounter.voided;
        result.encounters.push(parseEncounter(encounter, server));
      }
    }
  }
  result.voidedPreviousOrders = voidedPreviousOrders;
  increment('voided previous orders exported (HAI-1306)', voidedPreviousOrders.length);
  return result;
}

// Voids the resource at url on the target, unless it's already voided (a resumed run or a retry); returns
// whether it voided it
async function voidOnTarget(url, reason = VOID_REASON) {
  const current = await fetchData(`${url}?v=custom:(uuid,voided)`, 'TARGET');
  if (current.voided) {
    return false;
  }
  await deleteData(`${url}?reason=${encodeURIComponent(reason)}`);
  return true;
}

/**
 * HAI-1306: call just before posting each of the patient's drug orders. Posts the voided previous order it refers
 * to (and that order's own voided previous orders first), still active, so the order stops it as on the source.
 */
export async function importVoidedPreviousOrderFor(record, drugOrder) {
  const previousOrders = record[VOIDED_RECORDS_KEY]?.voidedPreviousOrders;
  if (!isVoidedPreviousEnabled() || !previousOrders) {
    return;
  }
  const byUuid = new Map(previousOrders.map(order => [order.uuid, order]));
  const post = async (uuid) => {
    const order = byUuid.get(uuid);
    if (!order) {
      return;
    }
    await post(order.previousOrder?.uuid);
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, order, order.uuid);
  };
  await post(drugOrder.previousOrder?.uuid);
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
  if (!voided || (!isEnabled() && !isVoidedPreviousEnabled())) {
    return;
  }
  // Posted active for now: their orders go in next, and they are voided after the drug orders
  for (const encounter of voided.encounters) {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.ENCOUNTER, encounter, encounter.uuid);
  }
  if (!isEnabled()) {
    return;
  }
  const voidedOrderUuids = new Set(voided.drugOrders.map(order => order.uuid));
  for (const order of voided.drugOrders.filter(order => !needsExportedPreviousOrder(order, voidedOrderUuids))) {
    await postAndVoidOrder(order);
  }
}

/** Call just after posting the patient's drug orders (and before the dispenses). */
export async function importVoidedRecordsAfterDrugOrders(record) {
  const voided = record[VOIDED_RECORDS_KEY];
  if (!voided) {
    return;
  }
  if (isEnabled()) {
    const voidedOrderUuids = new Set(voided.drugOrders.map(order => order.uuid));
    for (const order of voided.drugOrders.filter(order => needsExportedPreviousOrder(order, voidedOrderUuids))) {
      await postAndVoidOrder(order);
    }
  }
  // HAI-1306: void the previous orders again, latest first (each was posted before the order that refers to it;
  // one that no exported order refers to, e.g. at the start of a chain, is posted here if it wasn't yet)
  if (isVoidedPreviousEnabled()) {
    for (const order of [...(voided.voidedPreviousOrders ?? [])].reverse()) {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, order, order.uuid);
      if (await voidOnTarget(`${CONSTANTS.TARGET.URLS.ORDER}/${order.uuid}`, PREVIOUS_VOID_REASON)) {
        increment('voided previous orders imported (HAI-1306)');
      }
    }
  }
  if (!isEnabled() && !isVoidedPreviousEnabled()) {
    return;
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
