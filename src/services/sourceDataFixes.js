// TEMPORARY (HAI-1306): corrects source data that ZL Central's validation rejects, so those patients can be
// imported. SSPE and HSN accepted these records when they were saved; today's core validators reject them, and
// the whole patient fails. Each rule fixes one pattern, can be turned off on its own, and records every change.
//
// Applied at export, to SOURCE exports only (verification's TARGET exports are left alone). Every change is
// listed in the patient file under FIXES_KEY and appended to LOG_HOME/source-data-fixes.csv. Verification uses
// the list to line the file up with what the target returns, and then drops it.
//
// The import posts each order with its dateStopped, so an order whose stop date is before its activation fails
// with Order.error.dateActivatedAfterDiscontinuedDate. For a RENEW, htmlformentry (not core) set the previous
// order's stop date, to the renewal's dateActivated minus one second (see UHM-9681 and HAI-1306).
//
// Rules so far (applied in this order):
//   visitStopForEncounters (FIX_VISIT_STOP_FOR_ENCOUNTERS): an encounter dated after its visit's stop (the visit
//   was ended, then a form was entered for it later the same day). ZL Central imports it without its visit. Fix:
//   extend the visit's stop to the encounter, but only for an encounter on the same day as the visit's stop and
//   only if that doesn't reach a later visit of the patient; otherwise it's logged for review and left as it is.
//   orderBeforeEncounter (FIX_ORDER_BEFORE_ENCOUNTER): an order activated before its encounter
//   (Order.error.encounterDatetimeAfterDateActivated). The encounter was moved later to fit its visit (the visit's
//   start was edited, or the encounter was put in a visit created after it) and its orders weren't moved with it.
//   Fix: activate the order at its encounter's time. Skipped if that would put the start after the order's stop
//   or auto-expire date, or after an order that stops it. Runs first, so the other rules see the new start.
//   sameSecondRenewal (FIX_SAME_SECOND_RENEWALS): a renewal activated in the same second as the order it renews
//   (retrospective entry puts both encounters at the visit's start time), so the previous order was stopped one
//   second before it started. Fix: activate the renewal one second after the previous order, and stop the
//   previous order at its own activation time.
//   renewalStopDayBefore (FIX_RENEWAL_STOP_DAY_BEFORE): a renewal activated later the same day, while the order it
//   renews was stopped at 23:59:59 the day before the renewal (htmlformentry computed the stop date from the
//   renewal's date-only dateActivated, before moving that to the encounter time). Fix: stop the previous order one
//   second before the renewal, the value htmlformentry meant to set.
//   labCancelBrowserTime (FIX_LAB_CANCEL_TIMES): a lab order cancellation (test order DISCONTINUE) dated before
//   the order it cancels. The PIH Apps lab orders page sent the browser's local time without a zone for the
//   cancellation's own encounter and dateActivated, and browsers 3 hours behind the server put it 3 hours early
//   (or, when that fell before the visit, emrapi moved it to the visit start). Fix: put the cancellation's
//   encounter at the time it was entered (dateCreated), or at the visit's stop if the visit had already ended;
//   activate the cancellation then (at least one second after the cancelled order), and stop the cancelled
//   order one second before it. Only when the encounter holds nothing but the cancellation.
//   renewalBeforeOriginal (FIX_RENEWALS_BEFORE_ORIGINAL): a renewal activated before the order it renews (a
//   form entered later for the same visit, at the visit's start time, renewing orders from a later encounter), so
//   the renewed order was stopped before it started. Fix: activate the renewal one second after the order it
//   renews, and stop that order at its own activation time (as for same-second renewals).
//   stopBeforeStartNoStopper (FIX_STOP_WITHOUT_STOPPER): an order stopped before it started that no exported
//   order stops (the renewal that stopped it was voided, and voiding a RENEW doesn't reopen the order it renewed:
//   UHM-9685). Fix: clear the stop date, as core does when a DISCONTINUE or REVISE is voided. Runs last, after
//   the rules that fix stops set by an existing order.
//   autoExpireBeforeStart (FIX_AUTO_EXPIRE_BEFORE_START): a drug order with a duration of 0, which core turns into
//   an auto-expire date one second before the start (Order.error.dateActivatedAfterAutoExpireDate). Fix: expire it
//   at its start. Only for a gap of one second; core keeps an auto-expire date that is already set.
//   overlappingDrugOrders (FIX_OVERLAPPING_DRUG_ORDERS): two drug orders for the same drug (same concept, drug and
//   care setting, neither replacing the other) where the later one starts while the earlier one is still active
//   (AmbiguousOrderException: Order.cannot.have.more.than.one). Core only checks for this at save time against the
//   orders active *now* for a same-day save, so an earlier order that had already ended by then wasn't seen. Fix:
//   stop the earlier order one second before the later one starts. When other orders refer to the earlier one as
//   their previous order: if they are all RENEWs that start after the later order has ended, the earlier order is
//   still stopped (logged as its own count, "...stopped before the next one (renewed later)"). Core doesn't stop the
//   previous order of a RENEW or check that it is still active, so the renewal imports; the earlier order then
//   shows as stopped when the later one started, with its renewal after a gap (HSN: one patient, two drugs ordered
//   together, earlier stop moved from day 78 to day 38; decided on HAI-1312). Any other order that refers to it
//   (REVISE, DISCONTINUE: core would stop it again), or a RENEW that starts while the later order is still active
//   (it would clash in turn): skipped and logged. Runs last, on the final start and stop dates.
//   zeroDoseMixtard (FIX_ZERO_DOSE_MIXTARD): HSN Mixtard 70/30 insulin orders saved with a dose of 0
//   (DrugOrder.error.doseZeroOrLess). They were entered on the Outpatient Followup (Adult) form between
//   2026-03-13 and 2026-04-21, before HSN ran core 2.8.5 (TRUNK-6576), which added the dose > 0 check. The real dose
//   wasn't recorded. A dose of 1 or any other number would be invented, and for a high-alert drug a believable but
//   wrong dose is worse than a missing one (other Mixtard orders in units are nearly all 10-49 units). Fix: make it
//   a free-text order: dosingType FreeTextDosingInstructions, dose and doseUnits cleared, and dosingInstructions
//   saying the dose wasn't recorded. Frequency, route and quantity are kept. Note that the form's drug order widget
//   only does simple dosing, so the form shows these orders with a blank dose and doesn't show the free-text
//   instructions. Only for the Mixtard drug (MIXTARD_DRUG_UUID) and only for orders that are voided or already
//   expired (stopped or auto-expired before the export); any other zero-dose order is logged and left as it is,
//   so its patient still fails and gets looked at. Decided on HAI-1312.
//   returnDateInAdmissionLocation (FIX_RETURN_DATE_IN_ADMISSION_LOCATION): the long-standing form bug UHM-3407 (see
//   also UHM-5682), never reproduced: on a form with a disposition, htmlformentry voids the "Return visit date" obs
//   and, in the same save, stores its date as text (yyyy-mm-dd) in an "Admission location in hospital" obs inside
//   the disposition construct. That obs holds a location id as text, marked with the comment org.openmrs.Location;
//   REST can't resolve a date as a location, so the export gets no value (Obs.error.inGroupMember / error.noValue)
//   and the form can't be edited. On the source servers this was cleaned up by hand: void the admission location
//   obs and unvoid the return visit date. Fix: turn the admission location obs into a top-level "Return visit date"
//   obs with that date, which gives the same result without exporting voided obs, and keeps the date as last
//   submitted (in 1 of the 5 HSN cases it differs from the voided return visit date by 4 days). If the disposition
//   construct has no other member left, it is left out too, since an empty group can't be saved. Only for this
//   concept with the location comment and a yyyy-mm-dd text; the text comes from REST's valueText, fetched for
//   these obs only (fetchMisfiledReturnDates, called before the rules). The disposition construct's other wrong
//   member in these encounters ("Transfer out location" = Discharged) is left as it is (see UHM-3407).
//   formEditVoidedTwins (FIX_FORM_EDIT_VOIDED_TWINS): when an order is revised in its own encounter with the same
//   start (Revise on an edited form), htmlformentry voids it ("Voided by htmlformentry") and creates a replacement
//   with the same action and previous order in the same second (OrderSubmissionElement/FormEntrySession), possibly
//   with changed dosing fields, but it doesn't move anything that points to the voided order over to the
//   replacement. About 980 HSN orders went through this; it only matters when something still points to the voided
//   one: a dispense (19 in HSN, see UHM-9678) or another order's previousOrder (2 in HSN). Those voided orders are carried over (HAI-1305, and the
//   voided previous orders above) and posted on the target while their live copy is active, which fails with
//   AmbiguousOrderException (2 HSN patients). Checked on HSN that these were form edits, not a cleanup script: voided
//   by the user who created them, with the copy created in the same second in the same encounter. Fix: leave the
//   voided order out and point its dispenses and the orders that refer to it to the live replacement, which is
//   what htmlformentry should have done. Only when the void reason is htmlformentry's and the replacement is in the
//   same encounter, has the same action, concept, drug, care setting, previous order and start, and was created within
//   2 seconds of the void (dateVoided and voidReason are fetched for the carried voided orders only, by
//   fetchVoidInfo). Runs first, so the other rules see the repointed links.
//
// On by default; set a rule's flag to false to turn it off. To remove: delete this file and its calls in
// exporterService.js, exportPatients.js and verifyPatients.js.
import fs from "fs/promises";
import path from "path";
import config from "../utils/config.js";
import logger from "../utils/logger.js";
import { increment } from "../utils/metrics.js";
import CONSTANTS from "../utils/constants.js";
import { VOIDED_RECORDS_KEY } from "./voidedDispenseOrders.js";
import { fetchData } from "./openmrsService.js";

export const FIXES_KEY = 'sourceDataFixesHAI1306';
const LOG_FILE = 'source-data-fixes.csv';

export function isVisitStopForEncountersFixEnabled() {
  return config.FIX_VISIT_STOP_FOR_ENCOUNTERS !== 'false';
}

export function isOrderBeforeEncounterFixEnabled() {
  return config.FIX_ORDER_BEFORE_ENCOUNTER !== 'false';
}

export function isSameSecondRenewalFixEnabled() {
  return config.FIX_SAME_SECOND_RENEWALS !== 'false';
}

export function isRenewalStopDayBeforeFixEnabled() {
  return config.FIX_RENEWAL_STOP_DAY_BEFORE !== 'false';
}

export function isLabCancelTimesFixEnabled() {
  return config.FIX_LAB_CANCEL_TIMES !== 'false';
}

export function isRenewalBeforeOriginalFixEnabled() {
  return config.FIX_RENEWALS_BEFORE_ORIGINAL !== 'false';
}

export function isStopWithoutStopperFixEnabled() {
  return config.FIX_STOP_WITHOUT_STOPPER !== 'false';
}

export function isAutoExpireBeforeStartFixEnabled() {
  return config.FIX_AUTO_EXPIRE_BEFORE_START !== 'false';
}

export function isOverlappingDrugOrdersFixEnabled() {
  return config.FIX_OVERLAPPING_DRUG_ORDERS !== 'false';
}

export function isZeroDoseMixtardFixEnabled() {
  return config.FIX_ZERO_DOSE_MIXTARD !== 'false';
}

// Insulin, Solution for injection, Neutral human, 70/30 (Mixtard), 100IU/mL, 10mL vial (same uuid on HSN, SSPE and
// ZL Central)
const MIXTARD_DRUG_UUID = '77077171-df0f-43c8-9a6b-245914fc143b';
export function isReturnDateInAdmissionLocationFixEnabled() {
  return config.FIX_RETURN_DATE_IN_ADMISSION_LOCATION !== 'false';
}

// "Admission location in hospital" (Text, a location id with the comment org.openmrs.Location) and "Return visit
// date" (Date); the same uuids on HSN, SSPE and ZL Central
const ADMISSION_LOCATION_CONCEPT_UUID = 'f3e04276-2db0-4181-b937-d73275dc1b15';
const RETURN_VISIT_DATE_CONCEPT_UUID = '3ce94df0-26fe-102b-80cb-0017a47871b2';
const LOCATION_COMMENT = 'org.openmrs.Location';
const MISFILED_TEXT_KEY = 'valueTextHAI1306';   // temporary, removed by the rule

const isMisfiledCandidate = obs => obs.concept?.uuid === ADMISSION_LOCATION_CONCEPT_UUID
  && obs.comment === LOCATION_COMMENT && !('value' in obs) && !(obs.groupMembers?.length);

/**
 * Call on a SOURCE export record before applySourceDataFixes. For each admission location obs that REST gave no
 * value (its text isn't a location id), fetches the raw text (valueText), which the rule then checks for a date.
 */
export async function fetchMisfiledReturnDates(record, server) {
  if (!isReturnDateInAdmissionLocationFixEnabled()) {
    return;
  }
  for (const encounter of record.encounters ?? []) {
    for (const group of encounter.obs ?? []) {
      for (const member of group.groupMembers ?? []) {
        if (isMisfiledCandidate(member)) {
          const obs = await fetchData(`${CONSTANTS.SOURCE.URLS.OBS}/${member.uuid}?v=custom:(uuid,valueText)`, server);
          member[MISFILED_TEXT_KEY] = obs?.valueText ?? null;
        }
      }
    }
  }
}

export function isFormEditVoidedTwinsFixEnabled() {
  return config.FIX_FORM_EDIT_VOIDED_TWINS !== 'false';
}

const HFE_VOID_REASON = 'Voided by htmlformentry';
const VOID_INFO_KEY = 'voidInfoHAI1306';   // temporary, removed by the rule

const voidedOrderLists = record => {
  const voided = record[VOIDED_RECORDS_KEY] ?? {};
  return [['voidedDrugOrders', voided, 'drugOrders'], ['voidedPreviousOrders', voided, 'voidedPreviousOrders']];
};

/** Call on a SOURCE export record before applySourceDataFixes: fetches what the rules need that the export leaves out. */
export async function fetchForSourceDataFixes(record, server) {
  await fetchMisfiledReturnDates(record, server);
  if (isFormEditVoidedTwinsFixEnabled()) {
    for (const [, holder, key] of voidedOrderLists(record)) {
      for (const order of holder[key] ?? []) {
        const audit = await fetchData(`${CONSTANTS.SOURCE.URLS.ORDER}/${order.uuid}?v=custom:(uuid,auditInfo)`, server);
        order[VOID_INFO_KEY] = { dateVoided: audit?.auditInfo?.dateVoided ?? null, voidReason: audit?.auditInfo?.voidReason ?? null };
      }
    }
  }
}

export const ZERO_DOSE_INSTRUCTIONS = 'Dose not recorded (saved as 0 before dose validation; changed in migration, HAI-1306)';

// REST dates look like 2023-06-15T10:14:00.000-0500. The export strips the zone from times at midnight and one
// second before midnight (2023-06-15T00:00:00), so those are local times on the target server.
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

// The date's wall-clock time to the second, for comparing two dates written the same way
function toSecond(date) {
  const match = DATE_REGEX.exec(date ?? '');
  return match ? match.slice(1, 7).join('') : undefined;
}

// Shifts the wall-clock time by a number of seconds and keeps the date's own fraction and zone, so the result is
// written the way the server writes it. (A shift of a second can't cross a daylight-saving change in practice:
// Haiti changes at 02:00, and these are times of other orders.)
export function shiftSeconds(date, seconds) {
  const match = DATE_REGEX.exec(date);
  if (!match) {
    throw new Error(`Not a date: ${date}`);
  }
  const [, y, mo, d, h, mi, s, fraction = '', zone = ''] = match;
  const shifted = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + seconds * 1000);
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${fraction}${zone}`;
}

export const plusOneSecond = date => shiftSeconds(date, 1);

// 23:59:59 on the day before the date, as yyyyMMddHHmmss (the form toSecond returns)
function secondBeforeItsDay(date) {
  const match = DATE_REGEX.exec(date ?? '');
  return match ? toSecond(shiftSeconds(`${match[1]}-${match[2]}-${match[3]}T00:00:00`, -1)) : undefined;
}

/**
 * Renewals activated in the same second as the order they renew. orders must be sequenced (each order after its
 * previous order), as the exporter's sequenceOrders leaves them, so a chain of same-second renewals moves up one
 * second per step.
 */
function fixSameSecondRenewals(orders, listName, fixes) {
  const byUuid = new Map(orders.map(order => [order.uuid, order]));
  const originalActivation = new Map(orders.map(order => [order.uuid, toSecond(order.dateActivated)]));
  for (const renewal of orders) {
    const previous = byUuid.get(renewal.previousOrder?.uuid);
    if (renewal.action !== 'RENEW' || !previous
      || originalActivation.get(renewal.uuid) === undefined
      || originalActivation.get(renewal.uuid) !== originalActivation.get(previous.uuid)) {
      continue;
    }
    const newActivation = plusOneSecond(previous.dateActivated);
    fixes.push({ rule: 'sameSecondRenewal', list: listName, uuid: renewal.uuid, field: 'dateActivated',
      from: renewal.dateActivated, to: newActivation });
    renewal.dateActivated = newActivation;
    fixes.push({ rule: 'sameSecondRenewal', list: listName, uuid: previous.uuid, field: 'dateStopped',
      from: previous.dateStopped, to: previous.dateActivated });
    previous.dateStopped = previous.dateActivated;
    increment('HAI-1306 same-second renewals moved by one second');
  }
}

/**
 * Renewals activated later than the order they renew, where that order was stopped at 23:59:59 on the day before
 * the renewal, so before it started.
 */
function fixRenewalStopDayBefore(orders, listName, fixes) {
  const byUuid = new Map(orders.map(order => [order.uuid, order]));
  for (const renewal of orders) {
    const previous = byUuid.get(renewal.previousOrder?.uuid);
    if (renewal.action !== 'RENEW' || !previous || !previous.dateStopped) {
      continue;
    }
    const renewalStart = toSecond(renewal.dateActivated);
    const previousStart = toSecond(previous.dateActivated);
    const previousStop = toSecond(previous.dateStopped);
    if (!renewalStart || !previousStart || !previousStop
      || !(renewalStart > previousStart)               // a renewal before or at the same second is another rule
      || !(previousStop < previousStart)               // only stops that are before the order started
      || previousStop !== secondBeforeItsDay(renewal.dateActivated)) {
      continue;
    }
    const newStop = shiftSeconds(renewal.dateActivated, -1);
    fixes.push({ rule: 'renewalStopDayBefore', list: listName, uuid: previous.uuid, field: 'dateStopped',
      from: previous.dateStopped, to: newStop });
    previous.dateStopped = newStop;
    increment('HAI-1306 renewal stop dates moved from the day before');
  }
}

/**
 * Lab order cancellations dated before the order they cancel, in an encounter of their own (see the header).
 */
function fixLabCancelTimes(record, fixes) {
  const orders = record.testOrders ?? [];
  const byUuid = new Map(orders.map(order => [order.uuid, order]));
  const allOrders = [...(record.drugOrders ?? []), ...orders];
  for (const cancel of orders) {
    const cancelled = byUuid.get(cancel.previousOrder?.uuid);
    const encounter = record.encounters?.find(e => e.uuid === cancel.encounter?.uuid);
    if (cancel.action !== 'DISCONTINUE' || !cancelled || !encounter || !cancel.dateCreated) {
      continue;
    }
    const cancelStart = toSecond(cancel.dateActivated);
    const cancelledStart = toSecond(cancelled.dateActivated);
    if (!cancelStart || !cancelledStart
      || !(cancelStart < cancelledStart)                                   // cancelled before the order started
      || !(toSecond(cancel.dateCreated) > cancelledStart)                  // but entered after it
      || toSecond(encounter.encounterDatetime) !== cancelStart             // dated by the same timestamp
      || (encounter.obs ?? []).length > 0                                  // and alone in its encounter
      || allOrders.some(o => o !== cancel && o.encounter?.uuid === encounter.uuid)) {
      continue;
    }
    const visit = record.visits?.find(v => v.uuid === encounter.visit?.uuid);
    let encounterTime = cancel.dateCreated;
    if (visit?.stopDatetime && toSecond(visit.stopDatetime) < toSecond(encounterTime)) {
      encounterTime = visit.stopDatetime;   // an encounter must be within its visit
    }
    // The cancelled order must start before the cancellation, or it would be stopped before it started
    const cancelTime = toSecond(encounterTime) > cancelledStart ? encounterTime : plusOneSecond(cancelled.dateActivated);
    const cancelledStop = shiftSeconds(cancelTime, -1);
    const change = (list, item, field, to) => {
      fixes.push({ rule: 'labCancelBrowserTime', list, uuid: item.uuid, field, from: item[field], to });
      item[field] = to;
    };
    change('encounters', encounter, 'encounterDatetime', encounterTime);
    change('testOrders', cancel, 'dateActivated', cancelTime);
    if (cancel.autoExpireDate) {
      change('testOrders', cancel, 'autoExpireDate', cancelTime);   // core expires a cancellation when it starts
    }
    change('testOrders', cancelled, 'dateStopped', cancelledStop);
    increment('HAI-1306 lab cancellations moved to their entry time');
  }
}

/**
 * Renewals activated before the order they renew, where that order was stopped before it started. Runs after the
 * same-second rule, so a renewal it moved is no longer before its previous order.
 */
function fixRenewalsBeforeOriginal(orders, listName, fixes) {
  const byUuid = new Map(orders.map(order => [order.uuid, order]));
  for (const renewal of orders) {
    const previous = byUuid.get(renewal.previousOrder?.uuid);
    if (renewal.action !== 'RENEW' || !previous || !previous.dateStopped) {
      continue;
    }
    const renewalStart = toSecond(renewal.dateActivated);
    const previousStart = toSecond(previous.dateActivated);
    if (!renewalStart || !previousStart || !(renewalStart < previousStart)
      || !(toSecond(previous.dateStopped) < previousStart)) {
      continue;
    }
    const newActivation = plusOneSecond(previous.dateActivated);
    fixes.push({ rule: 'renewalBeforeOriginal', list: listName, uuid: renewal.uuid, field: 'dateActivated',
      from: renewal.dateActivated, to: newActivation });
    renewal.dateActivated = newActivation;
    fixes.push({ rule: 'renewalBeforeOriginal', list: listName, uuid: previous.uuid, field: 'dateStopped',
      from: previous.dateStopped, to: previous.dateActivated });
    previous.dateStopped = previous.dateActivated;
    increment('HAI-1306 renewals before their original moved after it');
  }
}

/**
 * Orders stopped before they started that no exported order stops. The export leaves out voided orders, so a
 * voided renewal isn't there; nothing in the patient's record stops the order any more.
 */
function fixStopWithoutStopper(orders, listName, allOrders, fixes) {
  const stopped = new Set(allOrders.map(order => order.previousOrder?.uuid).filter(Boolean));
  for (const order of orders) {
    const start = toSecond(order.dateActivated);
    const stop = toSecond(order.dateStopped);
    if (!start || !stop || !(stop < start) || stopped.has(order.uuid)) {
      continue;
    }
    fixes.push({ rule: 'stopBeforeStartNoStopper', list: listName, uuid: order.uuid, field: 'dateStopped',
      from: order.dateStopped, to: null });
    order.dateStopped = null;
    increment('HAI-1306 stop dates cleared (no stopping order)');
  }
}

/** Orders that auto-expire one second before they start. */
function fixAutoExpireBeforeStart(orders, listName, fixes) {
  for (const order of orders) {
    if (!order.autoExpireDate || !toSecond(order.dateActivated)
      || toSecond(plusOneSecond(order.autoExpireDate)) !== toSecond(order.dateActivated)
      || toSecond(order.dateActivated).endsWith('000000')) {   // core moves a midnight auto-expire to 23:59:59
      continue;
    }
    fixes.push({ rule: 'autoExpireBeforeStart', list: listName, uuid: order.uuid, field: 'autoExpireDate',
      from: order.autoExpireDate, to: order.dateActivated });
    order.autoExpireDate = order.dateActivated;
    increment('HAI-1306 auto-expire dates moved to the start');
  }
}

/** Encounters dated after their visit's stop. */
function fixVisitStopForEncounters(record, fixes) {
  const visits = record.visits ?? [];
  for (const visit of visits) {
    const stop = toSecond(visit.stopDatetime);
    if (!stop) {
      continue;
    }
    const after = (record.encounters ?? []).filter(e => e.visit?.uuid === visit.uuid && toSecond(e.encounterDatetime) > stop);
    if (after.length === 0) {
      continue;
    }
    const sameDay = after.filter(e => toSecond(e.encounterDatetime).slice(0, 8) === stop.slice(0, 8));
    const latest = [...sameDay].sort((a, b) => toSecond(a.encounterDatetime).localeCompare(toSecond(b.encounterDatetime))).at(-1);
    const newStop = latest && toSecond(latest.encounterDatetime);
    const start = toSecond(visit.startDatetime);
    const reachesLaterVisit = newStop && visits.some(v => v !== visit && toSecond(v.startDatetime) > start
      && toSecond(v.startDatetime) <= newStop);
    if (!latest || reachesLaterVisit || sameDay.length < after.length) {
      logger.warn(`Patient ${record.patient.uuid}: visit ${visit.uuid} has ${after.length} encounter(s) after its stop`
        + (latest && !reachesLaterVisit ? `; extended only over the ${sameDay.length} on the same day` : '; left as it is') + ' (review)');
      increment('HAI-1306 encounters after their visit stop left for review', after.length - (latest && !reachesLaterVisit ? sameDay.length : 0));
    }
    if (!latest || reachesLaterVisit) {
      continue;
    }
    fixes.push({ rule: 'visitStopForEncounters', list: 'visits', uuid: visit.uuid, field: 'stopDatetime',
      from: visit.stopDatetime, to: latest.encounterDatetime });
    visit.stopDatetime = latest.encounterDatetime;
    increment('HAI-1306 visit stops extended to cover encounters');
  }
}

/** Orders activated before their encounter. */
function fixOrderBeforeEncounter(record, listName, fixes) {
  const orders = record[listName] ?? [];
  const allOrders = [...(record.drugOrders ?? []), ...(record.testOrders ?? [])];
  for (const order of orders) {
    const encounter = record.encounters?.find(e => e.uuid === order.encounter?.uuid);
    const start = toSecond(order.dateActivated);
    const encounterTime = toSecond(encounter?.encounterDatetime);
    if (!start || !encounterTime || !(start < encounterTime)) {
      continue;
    }
    const laterThanNewStart = date => date && toSecond(date) < encounterTime;
    if (laterThanNewStart(order.dateStopped) || laterThanNewStart(order.autoExpireDate)
      || allOrders.some(o => o.previousOrder?.uuid === order.uuid && laterThanNewStart(o.dateActivated))) {
      logger.warn(`Patient ${record.patient.uuid}: ${listName} ${order.uuid} starts before its encounter, but moving it would put it after its stop; left as it is`);
      increment('HAI-1306 orders before their encounter left as they are');
      continue;
    }
    fixes.push({ rule: 'orderBeforeEncounter', list: listName, uuid: order.uuid, field: 'dateActivated',
      from: order.dateActivated, to: encounter.encounterDatetime });
    order.dateActivated = encounter.encounterDatetime;
    increment('HAI-1306 orders moved to their encounter time');
  }
}

// When an order stops being active (its stop or auto-expire date, whichever is first), as toSecond; undefined if never
function endOf(order) {
  const ends = [order.dateStopped, order.autoExpireDate].map(toSecond).filter(Boolean).sort();
  return ends[0];
}

/** Drug orders for the same drug where a later one starts while an earlier one is still active. */
function fixOverlappingDrugOrders(record, fixes) {
  const orders = (record.drugOrders ?? []).filter(o => o.action !== 'DISCONTINUE' && toSecond(o.dateActivated)
    && o.concept?.uuid && (o.drug?.uuid || o.drugNonCoded) && o.careSetting?.uuid);
  const key = o => [o.concept?.uuid, o.drug?.uuid, o.drugNonCoded, o.careSetting?.uuid].join('|');
  // Orders stopped by another order, including the voided orders carried over for HAI-1305/HAI-1306 (posted on the
  // target before being voided again, so they stop their previous order there as on the source)
  const voided = record[VOIDED_RECORDS_KEY] ?? {};
  const stoppers = new Map();   // order uuid -> the orders that refer to it as their previous order
  for (const o of [...(record.drugOrders ?? []), ...(voided.drugOrders ?? []), ...(voided.voidedPreviousOrders ?? [])]) {
    if (o.previousOrder?.uuid) {
      stoppers.set(o.previousOrder.uuid, [...(stoppers.get(o.previousOrder.uuid) ?? []), o]);
    }
  }
  const linked = (a, b) => a.previousOrder?.uuid === b.uuid || b.previousOrder?.uuid === a.uuid;
  const sorted = [...orders].sort((a, b) => toSecond(a.dateActivated).localeCompare(toSecond(b.dateActivated)));
  for (const earlier of sorted) {
    const start = toSecond(earlier.dateActivated);
    const end = endOf(earlier);
    // the first later order for the same drug that starts while this one is still active
    const later = sorted.find(o => o !== earlier && key(o) === key(earlier) && !linked(o, earlier)
      && toSecond(o.dateActivated) > start && (!end || toSecond(o.dateActivated) < end));
    if (!later) {
      continue;
    }
    const refs = stoppers.get(earlier.uuid) ?? [];
    const laterEnd = endOf(later);
    const renewedAfterLater = refs.length > 0 && refs.every(o => o.action === 'RENEW'
      && laterEnd && toSecond(o.dateActivated) >= laterEnd);
    if (refs.length > 0 && !renewedAfterLater) {
      logger.warn(`Patient ${record.patient.uuid}: drug order ${earlier.uuid} overlaps ${later.uuid} for the same drug, but another order `
        + `(${[...new Set(refs.map(o => o.action))].join(', ')}) refers to it; left as it is`);
      increment('HAI-1306 overlapping drug orders left as they are');
      continue;
    }
    const newStop = shiftSeconds(later.dateActivated, -1);
    fixes.push({ rule: 'overlappingDrugOrders', list: 'drugOrders', uuid: earlier.uuid, field: 'dateStopped',
      from: earlier.dateStopped, to: newStop });
    earlier.dateStopped = newStop;
    if (renewedAfterLater) {
      logger.warn(`Patient ${record.patient.uuid}: drug order ${earlier.uuid} overlaps ${later.uuid} for the same drug and is renewed `
        + 'after it ends; stopped before the later one anyway (review)');
      increment('HAI-1306 overlapping drug orders stopped before the next one (renewed later)');
    } else {
      increment('HAI-1306 overlapping drug orders stopped before the next one');
    }
  }
}

/**
 * Drug orders with a dose of 0 or less. Only Mixtard orders that are voided or already expired are changed (see the
 * header); the rest are logged and left as they are.
 */
function fixZeroDoseMixtard(record, fixes) {
  const voided = record[VOIDED_RECORDS_KEY] ?? {};
  const lists = [
    ['drugOrders', record.drugOrders ?? [], false],
    // voided orders carried over for dispenses and as previous orders (HAI-1305/HAI-1306) are posted and then voided
    // again, so they are validated too
    ['voidedDrugOrders', voided.drugOrders ?? [], true],
    ['voidedPreviousOrders', voided.voidedPreviousOrders ?? [], true],
  ];
  const now = Date.now();
  const endedBeforeNow = date => date && !Number.isNaN(Date.parse(date)) && Date.parse(date) <= now;
  for (const [listName, orders, isVoided] of lists) {
    for (const order of orders) {
      if (order.dose === null || order.dose === undefined || !(Number(order.dose) <= 0)) {
        continue;
      }
      const expired = endedBeforeNow(order.dateStopped) || endedBeforeNow(order.autoExpireDate);
      if (order.drug?.uuid !== MIXTARD_DRUG_UUID || !(isVoided || order.voided || expired)) {
        logger.warn(`Patient ${record.patient.uuid}: ${listName} ${order.uuid} has a dose of ${order.dose}, but it isn't`
          + ' a voided or expired Mixtard order; left as it is');
        increment('HAI-1306 zero-dose drug orders left as they are');
        continue;
      }
      const change = (field, to) => {
        fixes.push({ rule: 'zeroDoseMixtard', list: listName, uuid: order.uuid, field,
          from: typeof order[field] === 'object' && order[field] !== null ? order[field].uuid : order[field], to });
        order[field] = to;
      };
      change('dosingType', 'org.openmrs.FreeTextDosingInstructions');
      change('dosingInstructions', ZERO_DOSE_INSTRUCTIONS);
      change('dose', null);
      change('doseUnits', null);
      increment('HAI-1306 zero-dose Mixtard orders made free-text');
    }
  }
}

/** Voided orders replaced by htmlformentry when revised in their own encounter (see the header). */
function fixFormEditVoidedTwins(record, fixes) {
  const live = record.drugOrders ?? [];
  const same = (a, b, field) => (a[field]?.uuid ?? a[field] ?? null) === (b[field]?.uuid ?? b[field] ?? null);
  for (const [listName, holder, key] of voidedOrderLists(record)) {
    for (const voided of [...(holder[key] ?? [])]) {
      const info = voided[VOID_INFO_KEY];
      delete voided[VOID_INFO_KEY];
      if (info?.voidReason !== HFE_VOID_REASON || !info.dateVoided) {
        continue;
      }
      const twin = live.find(o => ['encounter', 'concept', 'drug', 'drugNonCoded', 'careSetting', 'previousOrder', 'action']
          .every(field => same(o, voided, field))
        && toSecond(o.dateActivated) === toSecond(voided.dateActivated)
        && o.dateCreated && Math.abs(Date.parse(o.dateCreated) - Date.parse(info.dateVoided)) <= 2000);
      if (!twin) {
        continue;
      }
      const log = (list, uuid, field, from, to) => fixes.push({ rule: 'formEditVoidedTwins', list, uuid, field, from, to });
      for (const dispense of record.medicationDispenses ?? []) {
        if (dispense.drugOrder?.uuid === voided.uuid) {
          log('medicationDispenses', dispense.uuid, 'drugOrder', voided.uuid, twin.uuid);
          dispense.drugOrder = { ...dispense.drugOrder, uuid: twin.uuid };
        }
      }
      for (const [otherList, orders] of [['drugOrders', live], ...voidedOrderLists(record).map(([n, h, k]) => [n, h[k] ?? []])]) {
        for (const order of orders) {
          if (order.previousOrder?.uuid === voided.uuid) {
            log(otherList, order.uuid, 'previousOrder', voided.uuid, twin.uuid);
            order.previousOrder = { ...order.previousOrder, uuid: twin.uuid };
          }
        }
      }
      log(listName, voided.uuid, 'order', 'voided copy', 'left out');
      holder[key] = holder[key].filter(o => o !== voided);
      increment('HAI-1306 voided form-edit copies replaced by their live order');
    }
  }
  // An emptied container would be compared with a target that has none
  const voided = record[VOIDED_RECORDS_KEY];
  if (voided && Object.values(voided).every(list => !list?.length)) {
    delete record[VOIDED_RECORDS_KEY];
  }
}

/** Admission location obs holding a return visit date (UHM-3407, see the header). */
function fixReturnDateInAdmissionLocation(record, fixes) {
  for (const encounter of record.encounters ?? []) {
    for (const group of [...(encounter.obs ?? [])]) {
      for (const member of [...(group.groupMembers ?? [])]) {
        if (!(MISFILED_TEXT_KEY in member)) {
          continue;
        }
        const text = member[MISFILED_TEXT_KEY];
        delete member[MISFILED_TEXT_KEY];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text ?? '')) {
          logger.warn(`Patient ${record.patient.uuid}: admission location obs ${member.uuid} has no location and no date; left as it is`);
          increment('HAI-1306 admission location obs without a location left as they are');
          continue;
        }
        const log = (uuid, field, from, to) => fixes.push({ rule: 'returnDateInAdmissionLocation', list: 'obs', uuid, field, from, to });
        log(member.uuid, 'concept', ADMISSION_LOCATION_CONCEPT_UUID, RETURN_VISIT_DATE_CONCEPT_UUID);
        log(member.uuid, 'value', null, text);
        log(member.uuid, 'comment', LOCATION_COMMENT, null);
        log(member.uuid, 'obsGroup', group.uuid, null);
        group.groupMembers = group.groupMembers.filter(o => o !== member);
        const moved = { ...member, concept: { ...member.concept, uuid: RETURN_VISIT_DATE_CONCEPT_UUID }, value: text, groupMembers: [] };
        delete moved.comment;
        encounter.obs.push(moved);
        increment('HAI-1306 admission location dates moved to a return visit date');
        if (group.groupMembers.length === 0 && !('value' in group)) {
          log(group.uuid, 'groupMembers', 'no members left', 'group left out');
          encounter.obs = encounter.obs.filter(o => o !== group);
          increment('HAI-1306 empty disposition constructs left out');
        }
      }
    }
  }
}

/** Call on a SOURCE export record, after its orders are sequenced. Changes the record in place. */
export function applySourceDataFixes(record) {
  const fixes = [];
  if (isFormEditVoidedTwinsFixEnabled()) {
    fixFormEditVoidedTwins(record, fixes);
  }
  if (isVisitStopForEncountersFixEnabled()) {
    fixVisitStopForEncounters(record, fixes);
  }
  if (isOrderBeforeEncounterFixEnabled()) {
    fixOrderBeforeEncounter(record, 'drugOrders', fixes);
    fixOrderBeforeEncounter(record, 'testOrders', fixes);
  }
  if (isSameSecondRenewalFixEnabled()) {
    fixSameSecondRenewals(record.drugOrders ?? [], 'drugOrders', fixes);
    fixSameSecondRenewals(record.testOrders ?? [], 'testOrders', fixes);
  }
  if (isRenewalStopDayBeforeFixEnabled()) {
    fixRenewalStopDayBefore(record.drugOrders ?? [], 'drugOrders', fixes);
    fixRenewalStopDayBefore(record.testOrders ?? [], 'testOrders', fixes);
  }
  if (isLabCancelTimesFixEnabled()) {
    fixLabCancelTimes(record, fixes);
  }
  if (isRenewalBeforeOriginalFixEnabled()) {
    fixRenewalsBeforeOriginal(record.drugOrders ?? [], 'drugOrders', fixes);
    fixRenewalsBeforeOriginal(record.testOrders ?? [], 'testOrders', fixes);
  }
  if (isStopWithoutStopperFixEnabled()) {
    const allOrders = [...(record.drugOrders ?? []), ...(record.testOrders ?? [])];
    fixStopWithoutStopper(record.drugOrders ?? [], 'drugOrders', allOrders, fixes);
    fixStopWithoutStopper(record.testOrders ?? [], 'testOrders', allOrders, fixes);
  }
  if (isAutoExpireBeforeStartFixEnabled()) {
    fixAutoExpireBeforeStart(record.drugOrders ?? [], 'drugOrders', fixes);
    fixAutoExpireBeforeStart(record.testOrders ?? [], 'testOrders', fixes);
  }
  if (isOverlappingDrugOrdersFixEnabled()) {
    fixOverlappingDrugOrders(record, fixes);
  }
  if (isReturnDateInAdmissionLocationFixEnabled()) {
    fixReturnDateInAdmissionLocation(record, fixes);
  }
  if (isZeroDoseMixtardFixEnabled()) {
    fixZeroDoseMixtard(record, fixes);   // after the rules that change stop and auto-expire dates
  }
  if (fixes.length > 0) {
    record[FIXES_KEY] = fixes;
    logger.info(`Patient ${record.patient.uuid}: ${fixes.length} HAI-1306 source data fix(es)`);
  }
  return record;
}

// Quotes a CSV value that has a comma, quote or line break (the free-text dosing instructions)
function csvField(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Patients are exported concurrently: writes go through one chain, so the header is written once
let logQueue = Promise.resolve();

/** Call once the patient file is written: appends the record's fixes to LOG_HOME/source-data-fixes.csv. */
export function logSourceDataFixes(record) {
  const fixes = record?.[FIXES_KEY];
  if (!fixes?.length) {
    return Promise.resolve();
  }
  const lines = fixes.map(fix =>
    [fix.rule, record.patient.uuid, fix.list, fix.uuid, fix.field, fix.from ?? '', fix.to ?? ''].map(csvField).join(',')).join('\n');
  const write = logQueue.then(async () => {
    const file = path.join(config.LOG_HOME, LOG_FILE);
    await fs.mkdir(config.LOG_HOME, { recursive: true });
    let header = '';
    try {
      await fs.access(file);
    } catch {
      header = 'rule,patient,list,uuid,field,from,to\n';
    }
    await fs.appendFile(file, `${header}${lines}\n`);
  });
  logQueue = write.catch(() => {});
  return write;
}

/**
 * Call on the target record and the file contents before verification compares them. The fixes list is only in
 * the file. A fixed date the export wrote without a zone (midnight dates; a renewal moved to 00:00:01) comes back
 * from the target with one, so the target's value is matched to the file's when it is the same local time.
 */
export function normalizeForVerification(targetRecord, fileRecord) {
  const fixes = fileRecord?.[FIXES_KEY];
  if (!fixes) {
    return;
  }
  delete fileRecord[FIXES_KEY];
  for (const fix of fixes) {
    const order = targetRecord?.[fix.list]?.find(o => o.uuid === fix.uuid);   // an order, encounter or visit
    const targetValue = order?.[fix.field];
    const toDate = DATE_REGEX.exec(fix.to ?? '');   // only dates are matched; other fixed values come back as written
    if (targetValue && toDate && targetValue !== fix.to && !toDate[8]
      && toSecond(targetValue) === toSecond(fix.to)) {
      order[fix.field] = fix.to;
    }
  }
}
