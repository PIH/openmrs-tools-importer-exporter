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
//
// On by default; set a rule's flag to false to turn it off. To remove: delete this file and its calls in
// exporterService.js, exportPatients.js and verifyPatients.js.
import fs from "fs/promises";
import path from "path";
import config from "../utils/config.js";
import logger from "../utils/logger.js";
import { increment } from "../utils/metrics.js";

export const FIXES_KEY = 'sourceDataFixesHAI1306';
const LOG_FILE = 'source-data-fixes.csv';

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

/** Call on a SOURCE export record, after its orders are sequenced. Changes the record in place. */
export function applySourceDataFixes(record) {
  const fixes = [];
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
  if (fixes.length > 0) {
    record[FIXES_KEY] = fixes;
    logger.info(`Patient ${record.patient.uuid}: ${fixes.length} HAI-1306 source data fix(es)`);
  }
  return record;
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
    [fix.rule, record.patient.uuid, fix.list, fix.uuid, fix.field, fix.from ?? '', fix.to].join(',')).join('\n');
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
    const order = targetRecord?.[fix.list]?.find(o => o.uuid === fix.uuid);   // an order or an encounter
    const targetValue = order?.[fix.field];
    if (targetValue && fix.to && targetValue !== fix.to && !DATE_REGEX.exec(fix.to)[8]
      && toSecond(targetValue) === toSecond(fix.to)) {
      order[fix.field] = fix.to;
    }
  }
}
