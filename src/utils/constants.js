import config from "../utils/config.js";

const PERSON_REP = `(uuid,gender,birthdate,birthdateEstimated,dead,deathDate,causeOfDeath,dateCreated,creator:(uuid),` +
  `names:(uuid,preferred,prefix,givenName,familyName,familyName2,familyNamePrefix,familyNameSuffix,middleName,degree,dateCreated,creator:(uuid)),` +
  `addresses:(preferred,address1,address2,address3,address4,address5,address6,address7,address8,address9,address10,address11,address12,address13,address14,address15,cityVillage,stateProvince,postalCode,countyDistrict,country,latitude,longitude,startDate,endDate,dateCreated,creator:(uuid)),` +
  `attributes:(uuid,value,attributeType:(uuid),dateCreated,creator:(uuid)))`

const OBS_BASE_REP = `(uuid,concept:(uuid),person:(uuid),obsDatetime,location:(uuid),encounter:(uuid),comment,accessionNumber,formNamespaceAndPath,status,valueModifier,valueCodedName:(uuid),value:(uuid),dateCreated,creator:(uuid),GROUP_MEMBERS)`
// support two levels of nested obs
let OBS_REP = OBS_BASE_REP;
OBS_REP = OBS_REP.replace("GROUP_MEMBERS", `groupMembers:${OBS_BASE_REP}`);
OBS_REP = OBS_REP.replace("GROUP_MEMBERS", `groupMembers:${OBS_BASE_REP}`);
OBS_REP = OBS_REP.replace(",GROUP_MEMBERS", "");


export default {
  SOURCE: {
    URLS: {
      PATIENT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/patient`,
      VISIT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/visit`,
      ENCOUNTER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/encounter`,
      OBS: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/obs`,
      USER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/user`,
      PROVIDER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/providermanagement/provider`,
      PROGRAM_ENROLLMENT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/programenrollment`,
      GLOBAL_PROPERTY: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/systemsetting`,
    }
  },
  TARGET: {
    URLS: {
      PATIENT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/patient`,
      VISIT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/visit`,
      ENCOUNTER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/encounter`,
      OBS: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/obs`,
      USER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/user`,
      PROVIDER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/providermanagement/provider`,
      PROGRAM_ENROLLMENT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/programenrollment`,
      GLOBAL_PROPERTY: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/systemsetting`,
    }
  },
  PATIENT_CUSTOM_REP: `v=custom:(uuid,display,allergyStatus,identifiers:(uuid,identifier,identifierType:(uuid),preferred,dateCreated,creator:(uuid)),dateCreated,creator:(uuid),person:${PERSON_REP})`,
  VISIT_CUSTOM_REP: `v=custom:(uuid,patient:(uuid),attributes:(uuid,value,attributeType:(uuid),dateCreated,creator:(uuid)),startDatetime,stopDatetime,indication:(uuid),location:(uuid),visitType:(uuid),dateCreated,creator:(uuid))`,
  ENCOUNTER_CUSTOM_REP: `v=custom:(uuid,patient:(uuid),location:(uuid),encounterType:(uuid),form:(uuid),visit:(uuid),encounterDatetime,encounterProviders:(provider:(uuid),encounterRole:(uuid),dateCreated,creator:(uuid)),dateCreated,creator:(uuid),obs:${OBS_REP})`,
  USER_CUSTOM_REP: `v=custom:(uuid,username,email,userProperties,roles:(uuid),person:${PERSON_REP},dateCreated,creator:(uuid))`,
  PROVIDER_CUSTOM_REP: `v=custom:(uuid,identifier,providerRole:(uuid),dateCreated,creator:(uuid),person:${PERSON_REP})`,
  PROGRAM_ENROLLMENT_CUSTOM_REP: `v=custom:(uuid,patient:(uuid),program:(uuid),location:(uuid),dateEnrolled,dateCompleted,outcome:(uuid),dateCreated,creator:(uuid),states:(uuid,startDate,endDate,,dateCreated,creator:(uuid),state:(uuid)))`,
  GP_VISIT_ASSIGNMENT_HANDLER_DISABLED: "emrapi.emrApiVisitAssignmentHandler.disabled"
};