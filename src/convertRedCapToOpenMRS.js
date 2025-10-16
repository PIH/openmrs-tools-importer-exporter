import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import config from './utils/config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from './utils/logger.js';
import { trimNonAlphanumeric} from "./utils/utils.js";

const REDCAP_FILE_PATH = path.join(config.REDCAP_EXPORT_FILE);
const ZL_EMR_IDENTIFIERS_FILE_PATH = path.join(config.ZL_EMR_IDENTIFIERS_FILE);
const REDCAP_ADDRESSES_MAP_FILE_PATH = path.join(config.REDCAP_ADDRESSES_MAPPING_FILE);
const ZL_EMR_PATIENT_IDENTIFIER_TYPE_UUID = "a541af1e-105c-40bf-b345-ba1fd6a59b85";
const REDCAP_RECORD_ID_TYPE_UUID = "59c0c5e5-4ec4-4852-8da4-a1f4d12fcc2d";
const REDCAP_DOSSIER_NUMBER_TYPE_UUID = "9f9f8d7f-450d-4142-be44-13e261598faa";
const PERSON_PHONE_NUMBER_ATTRIBUTE_TYPE_UUID = "14d4f066-15f5-102d-96e4-000c29c2a5d7";
const CLINIC_VISIT_TYPE_UUID = "f01c54cb-2225-471a-9cd5-d348552c337c";
const HINCHE_LOCATION_UUID = "328f6a60-0370-102d-b0e3-001ec94a0cc1";
const NCD_PROGRAM_UUID = "515796ec-bf3a-11e7-abc4-cec278b6b50a";
const TREATMENT_STOPPED_OUTCOME_UUID = "3cdc0d7a-26fe-102b-80cb-0017a47871b2";
const PATIENT_TRASFERRED_OUT_OUTCOME_UUID = "3cdd5c02-26fe-102b-80cb-0017a47871b2";
const PATIENT_DIED_OUTCOME_UUID = "3cdd446a-26fe-102b-80cb-0017a47871b2";
const NCD_INITIAL_ENCOUNTER_TYPE_UUID = "ae06d311-1866-455b-8a64-126a9bd74171";
const NCD_FOLLOWUP_ENCOUNTER_TYPE_UUID = "5cbfd6a2-92d9-4ad0-b526-9d29bfe1d10c";
const LAB_RESULTS_ENCOUNTER_TYPE_UUID = "4d77916a-0620-11e5-a6c0-1697f925ec7b";
const LAB_RESULTS_FORM_UUID = "5e1b0c3a-3acf-4e50-aab1-738a3a282dea";
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
const PRESCRIPTION_CONSTRUCT_CONCEPT_UUID = "9ab17798-1486-4d56-9218-e3578646a772";
const MEDICATION_ORDERS_CONCEPT_UUID = "3cd9491e-26fe-102b-80cb-0017a47871b2";
const CURRENTLY_TAKING_MEDICATION_CONCEPT_UUID = "d5afe6ab-ce66-43b0-9121-733e0f4f001d";
const ANTI_TB_MEDICATION_CONCEPT_UUID = "2bcc2619-01c1-4f9a-a85d-8f92f4e10413";
const ARV_MEDICATION_CONCEPT_UUID = "6e986ce6-f972-4469-8aa9-6b44f08defac";
const OTHER_MEDICATION_CONCEPT_UUID = "3fa2be15-6e21-4603-81d9-cd2bd04d4e08";

const ACETYLSALICYLIC_ACID_100MG_CONCEPT_UUID = '8d5941e8-5f86-4289-a6ba-122320814bd5';
const AMINOPHYLLINE_SOLUTION_25MG_10ML_CONCEPT_UUID = '5815a762-e68a-42dc-aea9-57957260d44b';
const AMLODIPINE_BESYLATE_5MG_CONCEPT_UUID = '6620289c-cc66-4892-9b2d-ecc40c746945';
const ATENOLOL_50MG_CONCEPT_UUID = '2f8d7a99-d4ec-4ad7-b898-1c953cb332fd';
const CARVEDILOL_12_5MG_CONCEPT_UUID = 'd809f82b-7612-4da2-b075-531f586bdd7c';
const CAPTOPRIL_25MG_CONCEPT_UUID = '7134a5ba-2033-4833-a1ac-d256fd005932';
const CLOPIDOGREL_75MG_CONCEPT_UUID = '8d7c8333-43f2-4e81-9923-14cdd790dcc3';
const DIGOXIN_SOLUTION_250MCG_2ML_CONCEPT_UUID = 'cf38a1ec-9bf0-4760-8329-af3b6374be64';
const ENALAPRIL_MALEATE_5MG_CONCEPT_UUID = '4efe3f48-2656-4178-bfcd-c6d103851084';
const FUROSEMIDE_40MG_CONCEPT_UUID = 'fb5842a2-60ef-4539-b428-f99a1f76c85f';
const HYDRALAZINE_HYDROCHLORIDE_25MG_CONCEPT_UUID = '2ff6dfce-cd7e-4a1c-9916-f398c4aaec1f';
const HYDROCHLOROTHIAZIDE_25MG_CONCEPT_UUID = 'ce857097-f7a1-4178-b018-a8067a5710d1';
const ISOSORBIDE_DINITRATE_20MG_CONCEPT_UUID = '95518896-df94-4e7d-b233-cc5af823975a';
const LISINOPRIL_5MG_CONCEPT_UUID = 'd0876723-9087-4ea5-b26d-d46cf914835f';
const LISINOPRIL_20MG_CONCEPT_UUID = '4534a926-8dc4-440b-bdf9-f9e96d282a28';
const METHYLDOPA_250MG_CONCEPT_UUID = '70123af9-a72a-4f6e-a188-140d905a84be';
const METOPROLOL_SUCCINATE_25MG_CONCEPT_UUID = '819b83c0-e218-4ffe-854c-75c941feb948';
const METOPROLOL_TARTRATE_50MG_CONCEPT_UUID = '01bf21ba-3505-4221-ad41-d81e9aa5cc6e';
const NIFEDIPINE_20MG_CONCEPT_UUID = 'd7937a60-a75b-42f6-9200-cd0e895606c0';
const PROPRANOLOL_HYDROCHLORIDE_40MG_CONCEPT_UUID = '405dfa6c-ebaa-4a51-857f-b4df3788e7dd';
const SIMVASTATIN_20MG_CONCEPT_UUID = '01f14854-8305-4b12-8a52-3e01555fd66e';
const SPIRONOLACTONE_25MG_CONCEPT_UUID = '82f3e5d8-0701-4948-a511-7d6f932dc9e6';
const WARFARIN_5MG_CONCEPT_UUID = '1779f27f-0272-41da-a242-c6851a9aef6d';
const BECLOMETHASONE_50_MICROGRAM_DOSE_CONCEPT_UUID = '0dfc00d1-394a-4dd4-9a56-8b00513fce21';
const BECLOMETHASONE_250_MICROGRAM_DOSE_CONCEPT_UUID = 'a9d56315-5c8d-4442-83ed-563ef2fa3171';
const IPRATROPIUM_BROMIDE_250_MICROGRAM_ML_SOLUTION_CONCEPT_UUID = '8b6830f5-8807-4be1-9062-37388a737a0c';
const MONTELUKAST_SODIUM_10_MG_TABLET_CONCEPT_UUID = '85e9b37a-b7b7-4ec9-84dc-c692b7c9187d';
const SALBUTAMOL_100_MICROGRAM_DOSE_CONCEPT_UUID = '1420b4b9-ca35-4579-ae96-838f75b9e856';
const GLIBENCLAMIDE_5_MG_TABLET_CONCEPT_UUID = '5c21704a-6268-4854-845d-55c573bed967';
const INSULINE_RAPIDE_REGULAR_CONCEPT_UUID = 'def06cd2-c046-4afc-9a49-475d3481cbcf';
const INSULINE_LENTE_INTERMEDIAIRE_CONCEPT_UUID = '568b5484-1f52-424a-a45d-3f1c9e0d92d6';
const INSULINE_70_30_MIXTE_CONCEPT_UUID = '77077171-df0f-43c8-9a6b-245914fc143b';
const METFORMIN_HYDROCHLORIDE_500_MG_TABLET_CONCEPT_UUID = 'afd2cd78-4dc6-4e91-ac9f-51b9e094e34a';
const PREDNISOLONE_5_MG_TABLET_CONCEPT_UUID = 'c63b13b6-210c-4575-ae5e-bbf86b5df747';
const BENZATHINE_BENZYLPENICILLIN_2_4_MILLION_INTERNATIONAL_UNITS_POWDER_FOR_INJECTION_CONCEPT_UUID = 'ab912f78-2112-4e87-aca7-1ded71e8a04b';
const CARBAMAZEPINE_200MG_TABLET_CONCEPT_UUID = 'e371d811-d32c-4f6e-8493-2fa667b7b44c';
const CIMETIDINE_200_MG_TABLET_CONCEPT_UUID = 'ef96f590-2cc3-469e-9b82-072fef563b9e';
const CLOTRIMAZOLE_1_PERCENT_CREAM_CONCEPT_UUID = '5e11cd96-3277-4a74-968e-1aa3d3312e6c';
const DIPHENHYDRAMINE_HYDROCHLORIDE_25_MG_TABLET_CONCEPT_UUID = '81694757-3336-4195-ac6b-ea574b9b8597';
const DOXYCYCLINE_100MG_TABLET_CONCEPT_UUID = '8aad2a23-2977-4b5b-a30a-4a9142ce774b';
const OMEPRAZOLE_20_MG_GASTRO_RESISTANT_CAPSULE_CONCEPT_UUID = 'cb6d3cfb-4d14-4473-af64-88a69bc09a43';
const PHENOBARBITAL_50MG_TABLET_CONCEPT_UUID = '9a499fca-699e-4809-8175-732ef43d5c14';
const PHENOXYMETHYLPENICILLIN_250_MG_TABLET_CONCEPT_UUID = '3fbb89a0-652f-4675-b087-63ce1bed098f';
const POTASSIUM_CHLORIDE_600_MG_SLOW_RELEASE_TABLET_CONCEPT_UUID = '086b2092-a2e9-4a66-8790-7eb12ca328f2';
const RANITIDINE_150_MG_FILM_COATED_TABLET_CONCEPT_UUID = '477cbb97-2ea4-4fde-b32f-e6a3dd668c2b';
const HBA1C_CONCEPT_UUID = '159644AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const HBA1C_RESULTS_DATE_UUID = '68d6bd27-37ff-4d7a-87a0-f5e0f9c8dcc0';
const CREATININE_CONCEPT_UUID = '668cd2a5-60dd-4dc4-889b-e09f072c6a1a';
const TOTAL_CHOLESTEROL_CONCEPT_UUID = '4f2c0162-0a34-4d12-8361-c7c5a3489cf0';
const LDL_CONCEPT_UUID = 'ec10a67f-913f-4a62-a0ed-43fb335ff5af';
const HDL_CONCEPT_UUID = '600135ed-08d9-4791-8faa-94b13f1e095a';
const TRIGLYCERIDES_CONCEPT_UUID = 'ccead4fe-b998-412d-b6bb-9e92bb02d33d';
const INR_CONCEPT_UUID = '16e928e5-bdfb-4ec8-a9c2-9d64c78a0ce5';


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

function getFirstVisitDate(patientRecords) {
    let oldestVisitDate = null;
    if (patientRecords && patientRecords.length) {
        // filter out records with empty date_visit
        let nonEmptyValues = patientRecords.filter((record) => trimNonAlphanumeric(record["date_visit"]));
        if ( nonEmptyValues && nonEmptyValues.length > 0 ) {
            const oldestVisit = nonEmptyValues.reduce((oldest, current) => {
                return new Date(oldest.date_visit) < new Date(current.date_visit) ? oldest : current;
            });
            oldestVisitDate = oldestVisit.date_visit;
        }
    }
    return oldestVisitDate;
}

function createProgramEnrollment(patientUuid, patientRecords) {
    let enrollments = [];
    const oldestVisitDate = getFirstVisitDate(patientRecords);
    if (oldestVisitDate) {
        let programEnrollment = {
            uuid: uuidv4(),
            patient: {
                uuid: patientUuid
            },
            program: {
                uuid: NCD_PROGRAM_UUID
            },
            location: {
                uuid: HINCHE_LOCATION_UUID
            },
            dateEnrolled: oldestVisitDate
        }

        const exitVisit = getMostRecentVisitWithFieldValue(patientRecords, "exit");
        if ( exitVisit ) {
            if (exitVisit.exit === "1") {
                programEnrollment.outcome = {
                    uuid: TREATMENT_STOPPED_OUTCOME_UUID
                }
            } else if (exitVisit.exit === "2") {
                programEnrollment.outcome = {
                    uuid: PATIENT_TRASFERRED_OUT_OUTCOME_UUID
                }
            } else if (exitVisit.exit === "3") {
                programEnrollment.outcome = {
                    uuid: PATIENT_DIED_OUTCOME_UUID
                }
            }
            programEnrollment.dateCompleted = exitVisit.date_visit;
        }
        enrollments.push(programEnrollment);
    }
    return enrollments;
}

function getMostRecentVisitWithFieldValue(patientRecords, fieldName) {
    let visit = null;
    if (patientRecords && patientRecords.length && fieldName ) {
        // look for non-empty values for the given field
        let nonEmptyValues = patientRecords.filter((record) => trimNonAlphanumeric(record[fieldName]));
        if ( nonEmptyValues.length > 0 ) {
            //order the records by date_visit descending
            nonEmptyValues.sort((a, b) => new Date(b.date_visit) - new Date(a.date_visit));
            visit = nonEmptyValues[0];
        }
    }
    return visit;
}

function getMostRecentFieldValue(patientRecords, fieldName) {
    let fieldValue = null;
    if (patientRecords && patientRecords.length && fieldName ) {
        let visit = getMostRecentVisitWithFieldValue(patientRecords, fieldName);
        if ( visit ) {
            fieldValue = visit[fieldName];
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
            if (value === undefined || value === null || value === "") {
                // skip entries with undefined, null, or empty values
                continue;
            }
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

            } else if ( key.startsWith("disease_cat_rdv___") && value === "1") {
                obsMember.concept = {
                    uuid: NCD_CATEGORY_CONCEPT_UUID
                };
                if ( key === "disease_cat_rdv___1" ) {
                    obsMember.value = HTN_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___2" ) {
                    obsMember.value = DIABETES_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___3" ) {
                    obsMember.value = HEART_FAILURE_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___4" ) {
                    obsMember.value = STROKE_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___5" ) {
                    obsMember.value = RESPIRATORY_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___6" ) {
                    obsMember.value = REHAB_PROGRAM_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___7" ) {
                    obsMember.value = EPILEPSY_CONCEPT_UUID;
                } else if ( key === "disease_cat_rdv___8" ) {
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
                if ( (parseInt(value) >= 30) && (parseInt(value) <= 300) ) {
                    obsMember.value = value;
                } else {
                    logger.warn(`Invalid systolic blood pressure value: ${value} on ${redCapVisit.date_visit} for patient with record_id: ${redCapVisit.record_id}`);
                }

            } else if (key === "dbp") {
                obsMember.concept = {
                    uuid: DIASTOLIC_BP_CONCEPT_UUID
                };
                if ( (parseInt(value) >= 20) && (parseInt(value) <= 200) ) {
                    obsMember.value = value;
                } else {
                    logger.warn(`Invalid diastolic blood pressure value: ${value} on ${redCapVisit.date_visit} for patient with record_id: ${redCapVisit.record_id}`);
                }
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
            } else if (key === "t1d" && value === "1") {  // type 1 diabetes
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
                    },
                    value: TYPE_1_DIABETES_CONCEPT_UUID
                };
                obsMember.groupMembers = [groupMember];
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
                        groupMember.value = COPD_CONCEPT_UUID;
                        break;
                    case "3":
                        groupMember.value = OTHER_CONCEPT_UUID;
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
            } else if (key.startsWith("decision___") && value === "1") {
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
                if ( key === "decision___1" ) {
                    groupMember.value = NCD_FOLLOWUP_VISIT_CONCEPT_UUID;
                } else if ( key === "decision___2"  ) {
                    groupMember.value = REFER_TO_CHW_CONCEPT_UUID;
                } else if ( key === "decision___3"  ) {
                    groupMember.value = ADMIT_TO_HOSIPITAL_CONCEPT_UUID;
                } else if ( key === "decision___4"  ) {
                    groupMember.value = TRANSFER_WITHIN_HOSPITAL_CONCEPT_UUID;
                } else if ( key === "decision___5"  ) {
                    groupMember.value = DISCHARGED_CONCEPT_UUID;
                } else if ( key === "decision___9"  ) {
                    groupMember.value = NOT_APPLICABLE_CONCEPT_UUID;
                }
                if ( groupMember.value ) {
                    obsMember.groupMembers = [groupMember];
                }
            } else if (key === "comments_rdv") {
                obsMember.concept = {
                    uuid: DISPOSITION_COMMENT_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key === "meds_rdv___3" || key === "meds_rdv___4" || key === "meds_rdv___37") {
                //Anti-TB, ARVs and Other medication
                obsMember.concept = {
                    uuid: CURRENTLY_TAKING_MEDICATION_CONCEPT_UUID
                };
                if ( redCapVisit.meds_rdv___3 === "1" ) {
                    obsMember.value = ANTI_TB_MEDICATION_CONCEPT_UUID;
                } else if ( redCapVisit.meds_rdv___4 === "1" ) {
                    obsMember.value = ARV_MEDICATION_CONCEPT_UUID;
                } else if ( redCapVisit.meds_rdv___37 === "1" ) {
                    obsMember.value = OTHER_CONCEPT_UUID;
                }
            } else if (key === "med_autre") {
                obsMember.concept = {
                    uuid: OTHER_MEDICATION_CONCEPT_UUID
                };
                obsMember.value = value;
            } else if (key.startsWith("meds_rdv___") && value === "1") {
                obsMember.concept = {
                    uuid: PRESCRIPTION_CONSTRUCT_CONCEPT_UUID
                };
                let groupMember = {
                    uuid: uuidv4(),
                    obsDatetime: encounterDatetime,
                    concept: {
                        uuid: MEDICATION_ORDERS_CONCEPT_UUID
                    },
                    person: {
                        uuid: patientUuid
                    },
                    encounter: {
                        uuid: encounterUuid
                    }
                };
                if ( key === "meds_rdv___1" ) {
                    groupMember.value = AMINOPHYLLINE_SOLUTION_25MG_10ML_CONCEPT_UUID;
                } else if ( key === "meds_rdv___2" ) {
                    groupMember.value = AMLODIPINE_BESYLATE_5MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___5" ) {
                    groupMember.value = ACETYLSALICYLIC_ACID_100MG_CONCEPT_UUID; //aspirin
                } else if ( key === "meds_rdv___6" ) {
                    groupMember.value = ATENOLOL_50MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___7" ) {
                    groupMember.value = BECLOMETHASONE_50_MICROGRAM_DOSE_CONCEPT_UUID;
                } else if ( key === "meds_rdv___8" ) {
                    groupMember.value = CAPTOPRIL_25MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___9" ) {
                    groupMember.value = CARBAMAZEPINE_200MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___10" ) {
                    groupMember.value = CARVEDILOL_12_5MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___11" ) {
                    groupMember.value = CIMETIDINE_200_MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___12" ) {
                    groupMember.value = CLOPIDOGREL_75MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___13" ) {
                    groupMember.value = DIGOXIN_SOLUTION_250MCG_2ML_CONCEPT_UUID;
                } else if ( key === "meds_rdv___14" ) {
                    groupMember.value = ENALAPRIL_MALEATE_5MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___15" ) {
                    groupMember.value = FUROSEMIDE_40MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___16" ) {
                    groupMember.value = GLIBENCLAMIDE_5_MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___17" ) {
                    groupMember.value = HYDRALAZINE_HYDROCHLORIDE_25MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___18" ) {
                    groupMember.value = HYDROCHLOROTHIAZIDE_25MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___19" ) {
                    groupMember.value = INSULINE_RAPIDE_REGULAR_CONCEPT_UUID;
                } else if ( key === "meds_rdv___20" ) {
                    groupMember.value = INSULINE_70_30_MIXTE_CONCEPT_UUID;
                } else if ( key === "meds_rdv___21" ) {
                    groupMember.value = INSULINE_LENTE_INTERMEDIAIRE_CONCEPT_UUID;
                } else if ( key === "meds_rdv___22" ) {
                    groupMember.value = ISOSORBIDE_DINITRATE_20MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___23" ) {
                    groupMember.value = LISINOPRIL_5MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___24" ) {
                    groupMember.value = METFORMIN_HYDROCHLORIDE_500_MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___25" ) {
                    groupMember.value = METHYLDOPA_250MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___26" ) {
                    groupMember.value = NIFEDIPINE_20MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___27" ) {
                    groupMember.value = OMEPRAZOLE_20_MG_GASTRO_RESISTANT_CAPSULE_CONCEPT_UUID;
                } else if ( key === "meds_rdv___28" ) {
                    groupMember.value = BENZATHINE_BENZYLPENICILLIN_2_4_MILLION_INTERNATIONAL_UNITS_POWDER_FOR_INJECTION_CONCEPT_UUID;
                } else if ( key === "meds_rdv___29" ) {
                    groupMember.value = PHENOXYMETHYLPENICILLIN_250_MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___30" ) {
                    groupMember.value = PHENOBARBITAL_50MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___31" ) {
                    groupMember.value = PREDNISOLONE_5_MG_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___32" ) {
                    groupMember.value = RANITIDINE_150_MG_FILM_COATED_TABLET_CONCEPT_UUID;
                } else if ( key === "meds_rdv___33" ) {
                    groupMember.value = SALBUTAMOL_100_MICROGRAM_DOSE_CONCEPT_UUID;
                } else if ( key === "meds_rdv___34" ) {
                    groupMember.value = SIMVASTATIN_20MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___35" ) {
                    groupMember.value = SPIRONOLACTONE_25MG_CONCEPT_UUID;
                } else if ( key === "meds_rdv___36" ) {
                    groupMember.value = WARFARIN_5MG_CONCEPT_UUID;
                }

                if (groupMember.value) {
                    obsMember.groupMembers = [groupMember];
                }
            }

            if (obsMember.value || obsMember.groupMembers) {
                obs.push(obsMember);
            }
        }
    }
    return obs;
}

function createObs(patientUuid, encounterUuid, encounterDatetime, concept_uuid, obsValue) {
    if (patientUuid && encounterUuid && encounterDatetime && concept_uuid && obsValue) {
        let obsMember = {
            uuid: uuidv4(),
            concept: {
                uuid: concept_uuid
            },
            obsDatetime: encounterDatetime,
            person: {
                uuid: patientUuid
            },
            encounter: {
                uuid: encounterUuid
            },
            value: obsValue
        }
        return obsMember;
    } else {
        return null;
    }
}

function createOpenMRSLabResultsEncounter(patientUuid, visitUuid, redCapVisit) {
    let labResultsEncounter = null;
    if (redCapVisit && redCapVisit.date_visit) {
        let encounterDatetime = redCapVisit.date_visit;
        if (redCapVisit.hba1c || redCapVisit.hba1c_collect || redCapVisit.hba1c_result || redCapVisit.creat || redCapVisit.chol || redCapVisit.ldl || redCapVisit.hdl || redCapVisit.trig || redCapVisit.inr) {
            let encounterUuid = uuidv4();
            labResultsEncounter = {
                uuid: encounterUuid,
                encounterDatetime: encounterDatetime,
                patient: {
                    uuid: patientUuid
                },
                location: {
                    uuid: HINCHE_LOCATION_UUID
                },
                encounterType: {
                    uuid: LAB_RESULTS_ENCOUNTER_TYPE_UUID
                },
                form: {
                    uuid: LAB_RESULTS_FORM_UUID
                },
                visit: {
                    uuid: visitUuid
                }
            };
            let obs = [];

            if (redCapVisit.hba1c) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, HBA1C_CONCEPT_UUID, redCapVisit.hba1c);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.hba1c_result) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, HBA1C_RESULTS_DATE_UUID, redCapVisit.hba1c_result);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.creat) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, CREATININE_CONCEPT_UUID, redCapVisit.creat);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.chol) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, TOTAL_CHOLESTEROL_CONCEPT_UUID, redCapVisit.chol);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.ldl) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, LDL_CONCEPT_UUID, redCapVisit.ldl);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.hdl) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, HDL_CONCEPT_UUID, redCapVisit.hdl);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.trig) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, TRIGLYCERIDES_CONCEPT_UUID, redCapVisit.trig);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }
            if (redCapVisit.inr) {
                let labResultObs = createObs(patientUuid, encounterUuid, encounterDatetime, INR_CONCEPT_UUID, redCapVisit.inr);
                if (labResultObs) {
                    obs.push(labResultObs);
                }
            }

            if (obs.length > 0) {
                labResultsEncounter.obs = obs;
            }
        }
    }

    return labResultsEncounter;
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
            visits.push(visit);
            let encounter = createOpenMRSEncounter(patientUuid, visit.uuid, redCapVisit);
            let obs = createOpenMRSObs(patientUuid, encounter.uuid, encounter.encounterDatetime, redCapVisit);
            encounter.obs = obs;
            encounters.push(encounter);
            let labResultsEnc = createOpenMRSLabResultsEncounter(patientUuid, visit.uuid, redCapVisit);
            if (labResultsEnc) {
                encounters.push(labResultsEnc);
            }
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

    const zlEmrIds = JSON.parse(await readFile(ZL_EMR_IDENTIFIERS_FILE_PATH, 'utf8'));
    if (!Array.isArray(zlEmrIds.identifiers)) {
        throw new Error('Invalid JSON format');
    }
    const zlEmrIdsLength = zlEmrIds.identifiers.length;

    // counters used for printing statistics
    let distinctPatientCount = 0;
    let patientsWithDob = 0;
    let patientsWithAge = 0;
    let patientsWithoutDobNorAge = 0;

    const distinctIds = [...new Set(data.map(item => item.record_id))];
    distinctPatientCount = distinctIds.length;
    if (distinctPatientCount > zlEmrIdsLength) {
        throw new Error('Not enough ZL EMR identifiers for all patients');
    }
    let zlEmrIdIndex = 0;

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
            preferred: false
        }];
        let dossierNumber = getMostRecentFieldValue(patientRecords, "dossier");
        if (dossierNumber) {
            patient.identifiers.push({
                uuid: uuidv4(),
                identifier: dossierNumber,
                identifierType: {
                    uuid: REDCAP_DOSSIER_NUMBER_TYPE_UUID
                },
                preferred: false
            });
        }
        patient.identifiers.push({
            uuid: uuidv4(),
            identifier: zlEmrIds.identifiers[zlEmrIdIndex],
            identifierType: {
                uuid: ZL_EMR_PATIENT_IDENTIFIER_TYPE_UUID
            },
            preferred: true
        });
        zlEmrIdIndex++;
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
        let patientProgramEnrollments = createProgramEnrollment(patientUuid, patientRecords);
        let patientRecord = {
            patient: patient,
            visits: clinicVisits.visits,
            encounters: clinicVisits.encounters,
            obs: "",
            programEnrollments: patientProgramEnrollments,
            allergies: ""
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

convertAllRedCapRecords().then(data => {
    logger.info(`${data.length} REDCap records have been processed`);
});