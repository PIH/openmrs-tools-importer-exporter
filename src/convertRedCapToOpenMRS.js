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
const CLINIC_VISIT_TYPE_UUID = "f01c54cb-2225-471a-9cd5-d348552c337c";
const HINCHE_LOCATION_UUID = "328f6a60-0370-102d-b0e3-001ec94a0cc1";
const NCD_INITIAL_ENCOUNTER_TYPE_UUID = "ae06d311-1866-455b-8a64-126a9bd74171";
const NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID = "5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c";
const REDCAP_NCD_INITIAL_FORM_UUID = "5b915a22-c695-4f60-8b2d-9a72d006b304";
const REDCAP_NCD_FOLLOWUP_FORM_UUID = "109b588f-25a2-44e6-989d-d1d58f901a94";
const REDCAP_STUDY_ID_CONCEPT_UUID = "08148c0a-bf99-432f-afba-1f45ba435cf7";
const NCD_CATEGORY_CONCEPT_UUID = "27b30028-0ed0-4f62-a4d8-52a9c5b600e3";
const HTN_CONCEPT_UUID = "3cd50188-26fe-102b-80cb-0017a47871b2";
const DIABETES_CONCEPT_UUID ="edf4ecc4-44f6-457a-b561-179f4426b16a";
const HEART_FAILURE_CONCEPT_UUID ="0670f6b9-5456-4bd3-86b1-846abc4fe2ba";
const STROKE_CONCEPT_UUID ="111103AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RESPIRATORY_CONCEPT_UUID ="880ee6e8-1685-41e4-9055-ba066c2cecb7";
const REHAB_PROGRAM_CONCEPT_UUID ="7255ea55-1209-4104-9cb0-fd722b5a60c2";
const EPILEPSY_CONCEPT_UUID ="3cce0a90-26fe-102b-80cb-0017a47871b2";
const OTHER_CONCEPT_UUID ="3cee7fb4-26fe-102b-80cb-0017a47871b2";
const REFERRING_SERVICE_CONCEPT_UUID = "0e9c836d-b99a-4ffe-95f7-e9886cdbbcfc";
const INPATIENT_HSTH_CONCEPT_UUID = "d80ad207-e63b-46b3-9925-9ab3d7c3c5c1";
const INPATIENT_ZL_CONCEPT_UUID = "1d09195e-ce0c-4612-bcee-7c868d0e2cfb";
const OUTPATIENT_HSTH_CONCEPT_UUID = "87d41dfb-b9cb-43c9-8c8c-5c574ba69cea";
const OUTPATIENT_ZL_CONCEPT_UUID = "1c15ad1c-057f-4734-abfb-7580acbc654e";
const COMMUNITY_MTG_CONCEPT_UUID = "9bf4d32b-b3fe-412e-860e-8d00f03bf5d8";
const CHW_CONCEPT_UUID = "bf997029-a496-41a2-a7e7-7981e82d2dd0";
const EMERGENCY_ROOM_CONCEPT_UUID = "160473AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SYSTOLIC_BP_CONCEPT_UUID = "3ce934fa-26fe-102b-80cb-0017a47871b2";
const DIASTOLIC_BP_CONCEPT_UUID = "3ce93694-26fe-102b-80cb-0017a47871b2";
const HEART_RATE_CONCEPT_UUID = "3ce93824-26fe-102b-80cb-0017a47871b2";
const WEIGHT_CONCEPT_UUID = "3ce93b62-26fe-102b-80cb-0017a47871b2";
const HEIGHT_CONCEPT_UUID = "3ce93cf2-26fe-102b-80cb-0017a47871b2";
const WAIST_SIZE_CONCEPT_UUID = "163080AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const HIP_SIZE_CONCEPT_UUID = "163081AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NYHA_CLASS_CONCEPT_UUID = "e90416ff-65d8-4ab3-9fc6-8e16ae5f2caf";
const NYHA_CLASS_1_CONCEPT_UUID = "ef44dc83-7d6d-4e80-91c0-d9b447a689ff";
const NYHA_CLASS_2_CONCEPT_UUID = "e10400f0-053f-48bb-9983-e52b6231ef41";
const NYHA_CLASS_3_CONCEPT_UUID = "a2cb697a-a105-4d62-8f4a-7e2bcc942bb2";
const NYHA_CLASS_4_CONCEPT_UUID = "33f45cc0-fe1c-4731-8877-1e6b44dca288";
const FLUID_STATUS_CONCEPT_UUID = "5c5755df-3d1b-4ae2-a465-31dc05f49ddd";
const EUVOLEMIC_CONCEPT_UUID = "a8ad2208-8dbf-4429-81fd-faea1ad3bf96";
const HYPOVOLEMIA_CONCEPT_UUID = "7b11675c-2c20-4fd5-8ccd-a5547f330ebd";
const HYPERVOLEMIC_CONCEPT_UUID = "7c28e6fc-080d-4839-ad47-7eb7cd9a7973";
const DIAGNOSIS_CONCEPT_UUID = "226ed7ad-b776-4b99-966d-fd818d3302c2";
const TYPE_1_DIABETES_CONCEPT_UUID = "105903f4-7b6d-496a-b613-37ab9d0f5450";
const RANDOM_BLOOD_SUGAR_CONCEPT_UUID = "3cd4e194-26fe-102b-80cb-0017a47871b2";
const FASTING_FOR_BLOOD_GLUCOSE_TEST_CONCEPT_UUID = "2effb850-0384-4a09-8ae0-a7b5f7e7289f";
const YES_CONCEPT_UUID = "3cd6f600-26fe-102b-80cb-0017a47871b2";
const NO_CONCEPT_UUID = "3cd6f86c-26fe-102b-80cb-0017a47871b2";
const HYPOGLYCEMIA_PRESENT_CONCEPT_UUID = "b7104b35-3a72-43e8-9879-2ab5dc8ab2fb";
const SALBUTAMOL_PUFFS_PER_WEEK_CONCEPT_UUID = "77e19c53-b8ee-4dd2-b47a-fd1df174790e";
const NOT_AT_ALL_CONCEPT_UUID = "160215AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LESS_THAN_ONCE_A_WEEK_CONCEPT_UUID = "3ce107d0-26fe-102b-80cb-0017a47871b2";
const MORE_THAN_ONCE_A_WEEK_CONCEPT_UUID = "807637af-559d-495e-a305-a63c04aa4787";
const EVERY_DAY_CONCEPT_UUID = "1464AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ASTHMA_CONCEPT_UUID = "3ccc4bf6-26fe-102b-80cb-0017a47871b2";
const COPD_CONCEPT_UUID = "be7adab0-2ed5-44d7-972e-586911b08c8e";
const VISIT_DIAGNOSIS_CONCEPT_UUID = "159947AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ASTHMA_CLASSIFICATION_CONCEPT_UUID = "33c38f5b-0a68-4499-bd86-87ca792c868e";
const ASTHMA_INTERMITTENT_CONCEPT_UUID = "153753AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ASTHMA_MILD_PERSISTENT_CONCEPT_UUID = "0016512d-4388-44f0-a4b6-f6ad9e18fdcd";
const ASTHMA_MODERATE_PERSISTENT_CONCEPT_UUID = "134026AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ASTHMA_SEVERE_PERSISTENT_CONCEPT_UUID = "113018AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NUMBER_OF_SEIZURES_SINCE_LAST_VISIT_CONCEPT_UUID = "027409bf-2b87-4860-a9da-3422d21c2030";
const APPEARANCE_AT_APPT_TIME_CONCEPT_UUID = "7099fe6d-34ce-4264-84ea-2afa45362031";
const LESS_THAN_SEVEN_DAYS_LATE_CONCEPT_UUID = "2c9715c2-dd25-47ff-927a-cc63554bb33d";
const MORE_THAN_SEVEN_DAYS_LATE_CONCEPT_UUID = "4c4c4cbf-381d-42ac-9188-0025a150e4d0";
const DRUG_ADHERENCE_CONCEPT_UUID = "64da3185-449f-43db-999d-61295e30f67d";
const HOSPITALIZED_SINCE_LAST_VISIT_CONCEPT_UUID = "3cdcee66-26fe-102b-80cb-0017a47871b2";
const HIV_STATUS_CONCEPT_UUID = "aec6ad18-f4dd-4cfa-b68d-3d7bb6ea908e";
const NEGATIVE_CONCEPT_UUID = "3cd28732-26fe-102b-80cb-0017a47871b2";
const POSITIVE_CONCEPT_UUID = "3cd3a7a2-26fe-102b-80cb-0017a47871b2";
const UNKNOWN_CONCEPT_UUID = "3cd6fac4-26fe-102b-80cb-0017a47871b2";
const RETURN_VISIT_DATE_CONCEPT_UUID = "3ce94df0-26fe-102b-80cb-0017a47871b2";
const DISPOSITION_CONSTRUCT_CONCEPT_UUID = "164e9e1b-d26c-4a93-9bdf-af1ce4ae8fce";
const DISPOSITION_CATEGORIES_CONCEPT_UUID = "c8b22b09-e2f2-4606-af7d-e52579996de3";
const NCD_FOLLOWUP_VISIT_CONCEPT_UUID = "945aff50-bb81-4010-9dec-9a697d64aa42";
const REFER_TO_CHW_CONCEPT_UUID = "455a59d5-75fa-4364-8881-ea4f06376b99";
const ADMIT_TO_HOSIPITAL_CONCEPT_UUID = "6c047a20-c2bf-43ef-9e88-6da7b17e8c1a";
const TRANSFER_WITHIN_HOSPITAL_CONCEPT_UUID = "0de2ced1-8ab5-47b9-ba24-24bf2c78dbf0";
const DISCHARGED_CONCEPT_UUID = "6340fd67-facb-4a6c-a9d9-f629c9e53053";
const NOT_APPLICABLE_CONCEPT_UUID = "3cd7b72a-26fe-102b-80cb-0017a47871b2";
const DISPOSITION_COMMENT_CONCEPT_UUID = "b4457f1e-ef60-484c-b96a-08180a347e58";


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

function createOpenMRSObs(patientUuid, encounterUuid, encounterDatetime, redCapVisit) {
    let obs = [];
    if ( redCapVisit ) {
        // Iterate through all keys of redCapVisit
        const keys = Object.keys(redCapVisit);

        for (const key of keys) {
            const value = redCapVisit[key];
            if (value === undefined || value === null || value === "" || value === "0") {
                // skip entries with undefined, null, or empty values
                continue;
            }
            // Example: log each key/value; replace with your handling (e.g., map to concepts)
            console.log(`redCapVisit[${key}] = ${value}`);
            let obsMember = {
                uuid: uuidv4(),
                obsDatetime: encounterDatetime,
                person: {
                    uuid: patientUuid
                },
                encounter: {
                    uuid: encounterUuid
                }
            }
            if ( key === "record_id" ) {
                obsMember.concept = {
                    uuid: REDCAP_STUDY_ID_CONCEPT_UUID
                };
                obsMember.value = value;

            } else if ( key.startsWith("disease_cat_rdv___")) {
                obsMember.concept = {
                    uuid: NCD_CATEGORY_CONCEPT_UUID
                };
                if ( redCapVisit.disease_cat_rdv___1 === "1" ) {
                    obsMember.value = HTN_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___1 === "1" ) {
                    obsMember.value = HTN_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___2 === "1" ) {
                    obsMember.value = DIABETES_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___3 === "1" ) {
                    obsMember.value = HEART_FAILURE_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___4 === "1" ) {
                    obsMember.value = STROKE_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___5 === "1" ) {
                    obsMember.value = RESPIRATORY_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___6 === "1" ) {
                    obsMember.value = REHAB_PROGRAM_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___7 === "1" ) {
                    obsMember.value = EPILEPSY_CONCEPT_UUID;
                } else if ( redCapVisit.disease_cat_rdv___8 === "1" ) {
                    obsMember.value = OTHER_CONCEPT_UUID;
                    if ( redCapVisit.disease_other ) {
                        obsMember.comment = redCapVisit.disease_other;
                    }
                }
            } else if (key === "referral") {
                obsMember.concept = {
                    uuid: REFERRING_SERVICE_CONCEPT_UUID
                };
                switch (value) {
                    case "1":
                        obsMember.value = INPATIENT_HSTH_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = INPATIENT_ZL_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = OUTPATIENT_HSTH_CONCEPT_UUID;
                        break;
                    case "4":
                        obsMember.value = OUTPATIENT_ZL_CONCEPT_UUID;
                        break;
                    case "5":
                        obsMember.value = COMMUNITY_MTG_CONCEPT_UUID;
                        break;
                    case "6":
                        obsMember.value = CHW_CONCEPT_UUID;
                        break;
                    case "7":
                        obsMember.value = EMERGENCY_ROOM_CONCEPT_UUID;
                        break;
                    case "8":
                        obsMember.value = OTHER_CONCEPT_UUID;
                        break;
                }
            } else if (key === "sbp") {
                obsMember.concept = {
                    uuid: SYSTOLIC_BP_CONCEPT_UUID
                };
                obsMember.value = value;

            } else if (key === "dbp") {
                obsMember.concept = {
                    uuid: DIASTOLIC_BP_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "pulse") {
                obsMember.concept = {
                    uuid: HEART_RATE_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "weight") {
                obsMember.concept = {
                    uuid: WEIGHT_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "height") {
                obsMember.concept = {
                    uuid: HEIGHT_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "waist") {
                obsMember.concept = {
                    uuid: WAIST_SIZE_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "hip") {
                obsMember.concept = {
                    uuid: HIP_SIZE_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "nyha_rdv") {
                obsMember.concept = {
                    uuid: NYHA_CLASS_CONCEPT_UUID
                };
                switch (value) {
                    case "1":
                        obsMember.value = NYHA_CLASS_1_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = NYHA_CLASS_2_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = NYHA_CLASS_3_CONCEPT_UUID;
                        break;
                    case "4":
                        obsMember.value = NYHA_CLASS_4_CONCEPT_UUID;
                        break;
                }
            } else if (key === "volume_rdv") {
                obsMember.concept = {
                    uuid: FLUID_STATUS_CONCEPT_UUID
                };
                switch (value) {
                    case "1":
                        obsMember.value = HYPERVOLEMIC_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = EUVOLEMIC_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = HYPOVOLEMIA_CONCEPT_UUID;
                        break;
                }
            } else if (key === "t1d") {  // type 1 diabetes
                obsMember.concept = {
                    uuid: DIAGNOSIS_CONCEPT_UUID
                };
                if ( value === "1" ) {
                    obsMember.value = TYPE_1_DIABETES_CONCEPT_UUID;
                }
            } else if (key === "glucose_rdv") {  // type 1 diabetes
                obsMember.concept = {
                    uuid: RANDOM_BLOOD_SUGAR_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "fasting_rdv" && value === "1") {  // type 1 diabetes
                obsMember.concept = {
                    uuid: FASTING_FOR_BLOOD_GLUCOSE_TEST_CONCEPT_UUID
                };
                obsMember.value = YES_CONCEPT_UUID;
            } else if (key === "hypoglycemia") {
                obsMember.concept = {
                    uuid: HYPOGLYCEMIA_PRESENT_CONCEPT_UUID
                };
                if ( value === "1" ) {
                    obsMember.value = YES_CONCEPT_UUID;
                } else if ( value === "0" ) {
                    obsMember.value = NO_CONCEPT_UUID;
                }
            } else if (key === "salbutamol") {
                obsMember.concept = {
                    uuid: SALBUTAMOL_PUFFS_PER_WEEK_CONCEPT_UUID
                };
                switch (value) {
                    case "1":
                        obsMember.value = NOT_AT_ALL_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = LESS_THAN_ONCE_A_WEEK_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = MORE_THAN_ONCE_A_WEEK_CONCEPT_UUID;
                        break;
                    case "4":
                        obsMember.value = EVERY_DAY_CONCEPT_UUID;
                        break;
                }
            } else if (key === "resp_type") {
                obsMember.concept = {
                    uuid: VISIT_DIAGNOSIS_CONCEPT_UUID
                };
                let groupMember = {
                    uuid: uuidv4(),
                    obsDatetime: encounterDatetime,
                    concept: {
                      uuid: DIAGNOSIS_CONCEPT_UUID
                    },
                    person: {
                        uuid: patientUuid
                    },
                    encounter: {
                        uuid: encounterUuid
                    }
                };
                switch (value) {
                    case "1":
                        groupMember.value = ASTHMA_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = COPD_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = OTHER_CONCEPT_UUID;
                        break;
                }
                obsMember.groupMembers = [groupMember];
            } else if (key === "asthma_class") {
                obsMember.concept = {
                    uuid: ASTHMA_CLASSIFICATION_CONCEPT_UUID
                };
                switch (value) {
                    case "1":
                        obsMember.value = ASTHMA_INTERMITTENT_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = ASTHMA_MILD_PERSISTENT_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = ASTHMA_MODERATE_PERSISTENT_CONCEPT_UUID;
                        break;
                    case "4":
                        obsMember.value = ASTHMA_SEVERE_PERSISTENT_CONCEPT_UUID;
                        break;
                }
            } else if (key === "seizure_rdv") {
                obsMember.concept = {
                    uuid: NUMBER_OF_SEIZURES_SINCE_LAST_VISIT_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "rdv_respect") {
                obsMember.concept = {
                    uuid: APPEARANCE_AT_APPT_TIME_CONCEPT_UUID
                };
                switch (value) {
                    case "1":
                        obsMember.value = YES_CONCEPT_UUID;
                        break;
                    case "2":
                        obsMember.value = LESS_THAN_SEVEN_DAYS_LATE_CONCEPT_UUID;
                        break;
                    case "3":
                        obsMember.value = MORE_THAN_SEVEN_DAYS_LATE_CONCEPT_UUID;
                        break;
                }
            } else if (key === "missed_med") {
                obsMember.concept = {
                    uuid: DRUG_ADHERENCE_CONCEPT_UUID
                };
                switch (value) {
                    case "0":
                        obsMember.value = YES_CONCEPT_UUID;
                        break;
                    case "1":
                        obsMember.value = NO_CONCEPT_UUID;
                        break;
                }
            } else if (key === "hospitalized_rdv") {
                obsMember.concept = {
                    uuid: HOSPITALIZED_SINCE_LAST_VISIT_CONCEPT_UUID
                };
                switch (value) {
                    case "0":
                        obsMember.value = NO_CONCEPT_UUID;
                        break;
                    case "1":
                        obsMember.value = YES_CONCEPT_UUID;
                        break;
                }
            } else if (key === "hiv") {
                obsMember.concept = {
                    uuid: HIV_STATUS_CONCEPT_UUID
                };
                switch (value) {
                    case "0":
                        obsMember.value = NEGATIVE_CONCEPT_UUID;
                        break;
                    case "1":
                        obsMember.value = POSITIVE_CONCEPT_UUID;
                        break;
                    case "9":
                        obsMember.value = UNKNOWN_CONCEPT_UUID;
                        break;
                }
            } else if (key === "date_next_rdv") {
                obsMember.concept = {
                    uuid: RETURN_VISIT_DATE_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key.startsWith("decision___")) {
                obsMember.concept = {
                    uuid: DISPOSITION_CONSTRUCT_CONCEPT_UUID
                };
                let groupMember = {
                    uuid: uuidv4(),
                    obsDatetime: encounterDatetime,
                    concept: {
                        uuid: DISPOSITION_CATEGORIES_CONCEPT_UUID
                    },
                    person: {
                        uuid: patientUuid
                    },
                    encounter: {
                        uuid: encounterUuid
                    }
                };
                if ( redCapVisit.decision___1 === "1" ) {
                    groupMember.value = NCD_FOLLOWUP_VISIT_CONCEPT_UUID;
                } else if ( redCapVisit.decision___2 === "1" ) {
                    groupMember.value = REFER_TO_CHW_CONCEPT_UUID;
                } else if ( redCapVisit.decision___3 === "1" ) {
                    groupMember.value = ADMIT_TO_HOSIPITAL_CONCEPT_UUID;
                } else if ( redCapVisit.decision___4 === "1" ) {
                    groupMember.value = TRANSFER_WITHIN_HOSPITAL_CONCEPT_UUID;
                } else if ( redCapVisit.decision___5 === "1" ) {
                    groupMember.value = DISCHARGED_CONCEPT_UUID;
                } else if ( redCapVisit.decision___9 === "1" ) {
                    groupMember.value = NOT_APPLICABLE_CONCEPT_UUID;
                }
                obsMember.groupMembers = [groupMember];
            } else if (key === "comments_rdv") {
                obsMember.concept = {
                    uuid: DISPOSITION_COMMENT_CONCEPT_UUID
                };
                obsMember.value = value;
            }

            if (obsMember.value || obsMember.groupMembers) {
                obs.push(obsMember);
            }
        }
    }
    return obs;
}

function createOpenMRSEncounter(patientUuid, visitUuid, redCapVisit) {

    let encounter = {};
    let encounterTypeUuid = "";
    let formUuid = "";

    if ( redCapVisit ) {
        if ( redCapVisit.visit_type___1 === "1" ) {
            //NCD intake form (1, Donnes de Base encounter)
            encounterTypeUuid = NCD_INITIAL_ENCOUNTER_TYPE_UUID;
            formUuid = REDCAP_NCD_INITIAL_FORM_UUID;
        } else {
            //NCD followup form
            encounterTypeUuid = NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID;
            formUuid = REDCAP_NCD_FOLLOWUP_FORM_UUID;
        }

        encounter = {
            uuid: uuidv4(),
            encounterDatetime: redCapVisit.date_visit,
            patient: {
                uuid: patientUuid
            },
            location: {
                uuid: HINCHE_LOCATION_UUID
            },
            encounterType: {
                uuid: encounterTypeUuid
            },
            form: {
                uuid: formUuid
            },
            visit: {
                uuid: visitUuid
            }
        };
    }

    return encounter
}

function getOpenMRSVisits(patientUuid, redCapVisits) {
    let visits = [];
    let encounters=[];
    console.log("redCapVisits.length: " + redCapVisits.length);

    for (const redCapVisit of redCapVisits) {
        if (redCapVisit.date_visit ) {
            const visitUuid = uuidv4();
            let visit = {
                uuid: visitUuid,
                patient: {
                    uuid: patientUuid
                },
                startDatetime: redCapVisit.date_visit,
                stopDatetime: redCapVisit.date_visit,
                location: {
                    uuid: HINCHE_LOCATION_UUID
                },
                visitType: {
                    uuid: CLINIC_VISIT_TYPE_UUID
                }
            };
            console.log("visit: " + JSON.stringify(visit, null, 4) + "\n\n" );
            visits.push(visit);
            let encounter = createOpenMRSEncounter(patientUuid, visit.uuid, redCapVisit);
            let obs = createOpenMRSObs(patientUuid, encounter.uuid, encounter.encounterDatetime, redCapVisit);
            encounter.obs = obs;
            encounters.push(encounter);
        }

    }
    return {
        visits: visits,
        encounters: encounters
    };
}

async function convertAllRedCapRecords() {
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
    let outputFileCount = 0;

    const distinctIds = [...new Set(data.map(item => item.record_id))];
    distinctPatientCount = distinctIds.length;

    for (const distinctId of distinctIds) {
        if ( distinctId != 57 ) {
            continue;
        }
        logger.info(`Processing REDCap patient with record_id = ${distinctId}`);
        let patientRecords = data.filter((record)=> record.record_id === distinctId);
        console.log("patientRecords.length: " + patientRecords.length);
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
        let clinicVisits = getOpenMRSVisits(patientUuid, patientRecords);
        let patientRecord = {
            patient: patient,
            visits: clinicVisits.visits,
            encounters: clinicVisits.encounters,
            obs: "",
            programEnrollments: "",
            allergies: ""
        };

        const jsonData = JSON.stringify(patientRecord, null, 4);
        const filename = `${patientUuid}_patient.json`;
        if ( patient.person.birthdate ) {
            try {
                fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
                logger.info(`Patient data exported to ${filename}`);
                outputFileCount++;
            } catch (error) {
                logger.error(`Error exporting patient data for UUID: ${patientUuid}`, error);
            }
        } else {
            printRedCapRecordWithNoDob(distinctId, patientRecords);
            patientsWithoutDobNorAge++;
        }
        if ( outputFileCount === 20 ) {
            break;
        }
        break;
    }

    logger.info(`Number of distinct REDCap patients: ${distinctPatientCount}`);
    logger.info(`Number of REDCap patients that have an exact birthdate recorded: ${patientsWithDob}`);
    logger.info(`Number of REDCap patients that have an age recorded: ${patientsWithAge}`);
    logger.info(`Number of REDCap patients that have neither birthdate nor age recorded: ${patientsWithoutDobNorAge}`);

    return data;
}

convertAllRedCapRecords().then(data => {
    logger.info(`${data.length} REDCap records have been processed`);
});