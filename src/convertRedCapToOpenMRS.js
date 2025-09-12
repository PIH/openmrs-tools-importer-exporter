import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import config from './utils/config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from './utils/logger.js';
import { trimNonAlphanumeric} from "./utils/utils.js";

const REDCAP_FILE_PATH = path.join(config.REDCAP_EXPORT_FILE);
const REDCAP_ADDRESSES_MAP_FILE_PATH = path.join(config.REDCAP_ADDRESSES_MAPPING_FILE);
const REDCAP_RECORD_ID_TYPE_UUID = "59c0c5e5-4ec4-4852-8da4-a1f4d12fcc2d";
const PERSON_PHONE_NUMBER_ATTRIBUTE_TYPE_UUID = "14d4f066-15f5-102d-96e4-000c29c2a5d7";

function getMostFrequentFieldValue(patientRecords, fieldName) {
    let fieldValue = null;
    if (patientRecords && patientRecords.length && fieldName ) {
        const countByValue = patientRecords.reduce((accumulator, currentItem) => {
            const fieldValue = trimNonAlphanumeric(currentItem[fieldName]);
            if (fieldValue) {
                accumulator[fieldValue] = (accumulator[fieldValue] || 0) + 1;
            }
            return accumulator;
        }, {});
        let maxValue = 0;
        const keys = Object.keys(countByValue);
        for (let i = 0; i < keys.length; i++) {
            // find the value with the highest count
            if (countByValue[keys[i]] > maxValue) {
                maxValue = countByValue[keys[i]];
                fieldValue = keys[i];
            }
        }
    }
    return fieldValue;
}

function getMostRecentFieldValue(patientRecords, fieldName) {
    let fieldValue = null;
    if (patientRecords && patientRecords.length && fieldName ) {
        // look for non-empty values for the given field
        let nonEmptyValues = patientRecords.filter((record) => trimNonAlphanumeric(record[fieldName]));
        if ( nonEmptyValues.length > 0 ) {
            //order the records by date_visit descending
            nonEmptyValues.sort((a, b) => new Date(b.date_visit) - new Date(a.date_visit));
            fieldValue = nonEmptyValues[0][fieldName];
        }
    }
    return fieldValue;
}

function calculateEstimatedDob(recordsWithRecordedAge) {
    let estimatedDob = null;

    if ( recordsWithRecordedAge && recordsWithRecordedAge.length > 0 ) {
        // order the patient records by visit date(date_visit) descending
        recordsWithRecordedAge.sort((a, b) => new Date(b.date_visit) - new Date(a.date_visit));
        // calculate patient's estimated birthdate based on the age recorded at the date_visit
        const recordedDateVisit = new Date(recordsWithRecordedAge[0].date_visit);
        const patientAge = recordsWithRecordedAge[0].age ? recordsWithRecordedAge[0].age : recordsWithRecordedAge[0].age_2;
        estimatedDob = new Date(recordedDateVisit.getFullYear() - patientAge, recordedDateVisit.getMonth(), recordedDateVisit.getDate());
    }
    return estimatedDob;
}

function printRedCapRecordWithNoDob(recordId, patientRecords) {
    if ( patientRecords && patientRecords.length > 0 ) {
        let jsonData = null;
        const filename = `redCAP_record_id_${recordId}_patient.json`;
        // look for the Donnes de Base(Intake) form
        let intakeFormRecord = patientRecords.filter((record) => record.visit_type___1 === 1);
        if ( intakeFormRecord && intakeFormRecord.length > 0 ) {
            jsonData = JSON.stringify(intakeFormRecord[0], null, 4);
        } else {
            //just print the first patient record
            jsonData = JSON.stringify(patientRecords[0], null, 4);
        }
        try {
            fs.writeFileSync(path.join(config.REDCAP_RECORDS_WITH_NO_DOB_DIR, filename), jsonData);
            logger.info(`RedCAP patient with no dob data exported to ${filename}`);
        } catch (error) {
            logger.error(`Error exporting patient data for REDCap record_id: $recordId}`, error);
        }
    }
}

async function importAllRedCap() {
    const text = await readFile(REDCAP_FILE_PATH, 'utf8');
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
        throw new Error('Invalid JSON format');
    }

    const addressesMap = JSON.parse(await readFile(REDCAP_ADDRESSES_MAP_FILE_PATH, 'utf8'));

    // counters used for printing statistics
    let distinctPatientCount = 0;
    let patientsWithDob = 0;
    let patientsWithAge = 0;
    let patientsWithoutDobNorAge = 0;

    const distinctIds = [...new Set(data.map(item => item.record_id))];
    distinctPatientCount = distinctIds.length;

    for (const distinctId of distinctIds) {
        logger.info(`Processing REDCap patient with record_id = ${distinctId}`);
        let patientRecords = data.filter((record)=> record.record_id === distinctId);

        let patient = {};
        const patientUuid = uuidv4();
        patient.uuid = patientUuid;
        patient.identifiers = [{
            uuid: uuidv4(),
            identifier: distinctId,
            identifierType: {
                uuid: REDCAP_RECORD_ID_TYPE_UUID
            },
            preferred: true
        }];

        let person = {};
        person.uuid = patientUuid;
        const gender = getMostFrequentFieldValue(patientRecords, "sex");
        person.gender = (gender === "0") ? "F" : "M";
        person.dead = false;
        person.names = [];
        let personName = {};
        personName.uuid = uuidv4();
        personName.givenName = getMostFrequentFieldValue(patientRecords, "first_name");
        personName.familyName = getMostFrequentFieldValue(patientRecords, "last_name");
        person.names.push(personName);

        person.birthdate = null;
        const dob = getMostFrequentFieldValue(patientRecords, "dob");
        if ( dob ) {
            person.birthdate = dob;
            person.birthdateEstimated = false;
            patientsWithDob++;
        } else {
            // looking for forms that have a recorded age
            let recordsWithRecordedAge = patientRecords.filter((record) => record.age || record.age_2);
            if ( recordsWithRecordedAge.length > 0 ) {
                let estimatedDob = calculateEstimatedDob(recordsWithRecordedAge);
                if ( estimatedDob ) {
                    person.birthdate = estimatedDob.toISOString().split('T')[0];
                    person.birthdateEstimated = true;
                    patientsWithAge++;
                }
            } else if (person.birthdate === null) {
                logger.info(`Patient with record_id = ${distinctId} has neither dob nor age recorded.`);
            }
        }

        let lastKnownAddress = getMostRecentFieldValue(patientRecords, "commune");
        if ( lastKnownAddress ) {
            let personAddresses = [];
            let address = {};
            const fullAddress = addressesMap[lastKnownAddress];
            if ( fullAddress ) {
                address = {
                    "address1": fullAddress.address1,
                    "address3": fullAddress.address3,
                    "cityVillage": fullAddress.cityVillage,
                    "stateProvince": fullAddress.stateProvince,
                    "country": fullAddress.country,
                    "preferred": true
                };
                personAddresses.push(address);
                person.addresses = personAddresses;
            }
        }

        //phone numbers
        let phoneNumber = getMostRecentFieldValue(patientRecords, "phone1") || getMostRecentFieldValue(patientRecords, "phone2");
        if ( phoneNumber ) {
            let attributes = [];
            let attribute = {};
            attribute.uuid = uuidv4();
            attribute.attributeType = {
                uuid: PERSON_PHONE_NUMBER_ATTRIBUTE_TYPE_UUID
            };
            attribute.value = phoneNumber;
            attributes.push(attribute);
            person.attributes = attributes;
        }

        patient.person = person;
        let patientRecord = {
            patient: patient
        };

        const jsonData = JSON.stringify(patientRecord, null, 4);
        const filename = `${patientUuid}_patient.json`;
        if ( patient.person.birthdate ) {
            try {
                fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
                logger.info(`Patient data exported to ${filename}`);
            } catch (error) {
                logger.error(`Error exporting patient data for UUID: ${patientUuid}`, error);
            }
        } else {
            printRedCapRecordWithNoDob(distinctId, patientRecords);
            patientsWithoutDobNorAge++;
        }
    }

    logger.info(`Number of distinct REDCap patients: ${distinctPatientCount}`);
    logger.info(`Number of REDCap patients that have an exact birthdate recorded: ${patientsWithDob}`);
    logger.info(`Number of REDCap patients that have an age recorded: ${patientsWithAge}`);
    logger.info(`Number of REDCap patients that have neither birthdate nor age recorded: ${patientsWithoutDobNorAge}`);

    return data;
}

importAllRedCap().then(data => {
    logger.info(`${data.length} REDCap records have been processed`);
});