import config from "../utils/config.js";

const PERSON_REP = `(uuid,gender,birthdate,birthdateEstimated,dead,deathDate,causeOfDeath:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid),` +
  `names:(uuid,preferred,prefix,givenName,familyName,familyName2,familyNamePrefix,familyNameSuffix,middleName,degree,dateCreated,creator:(uuid),dateChanged,changedBy:(uuid)),` +
  `addresses:(preferred,address1,address2,address3,address4,address5,address6,address7,address8,address9,address10,address11,address12,address13,address14,address15,cityVillage,stateProvince,postalCode,countyDistrict,country,latitude,longitude,startDate,endDate,dateCreated,creator:(uuid),dateChanged,changedBy:(uuid)),` +
  `attributes:(uuid,value,attributeType:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid)))`

const OBS_BASE_REP = `(uuid,concept:(uuid),person:(uuid),obsDatetime,location:(uuid),encounter:(uuid),comment,accessionNumber,formNamespaceAndPath,status,valueModifier,valueCodedName:(uuid),value:(uuid),valueComplex,dateCreated,creator:(uuid),GROUP_MEMBERS)`
// support two levels of nested obs
let OBS_REP = OBS_BASE_REP;
OBS_REP = OBS_REP.replace("GROUP_MEMBERS", `groupMembers:${OBS_BASE_REP}`);
OBS_REP = OBS_REP.replace("GROUP_MEMBERS", `groupMembers:${OBS_BASE_REP}`);
OBS_REP = OBS_REP.replace(",GROUP_MEMBERS", "");

const ORDER_BASE_REP = `uuid,patient:(uuid),action,orderType:(uuid),orderer:(uuid),concept:(uuid),encounter:(uuid),instructions,dateActivated,autoExpireDate,dateStopped,orderReason:(uuid),orderReasonNonCoded,formNamespaceAndPath,accessionNumber,urgency,orderNumber,commentToFulfiller,careSetting:(uuid),orderGroup:(uuid),sortWeight,fulfillerStatus,fulfillerComment,dateCreated,creator:(uuid)`;

export default {
  SOURCE: {
    URLS: {
      PATIENT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/patient`,
      VISIT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/visit`,
      ENCOUNTER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/encounter`,
      OBS: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/obs`,
      ORDER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/order`,
      USER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/user`,
      PROVIDER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/provider`,
      PROGRAM_ENROLLMENT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/programenrollment`,
      RELATIONSHIP: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/relationship`,
      GLOBAL_PROPERTY: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/systemsetting`,
    }
  },
  TARGET: {
    URLS: {
      PATIENT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/patient`,
      VISIT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/visit`,
      ENCOUNTER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/encounter`,
      OBS: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/obs`,
      ORDER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/order`,
      USER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/user`,
      PROVIDER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/provider`,
      PROGRAM_ENROLLMENT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/programenrollment`,
      RELATIONSHIP: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/relationship`,
      GLOBAL_PROPERTY: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/systemsetting`,
    }
  },
  PATIENT_CUSTOM_REP: `v=custom:(uuid,display,identifiers:(uuid,identifier,location:(uuid),identifierType:(uuid),preferred,dateCreated,creator:(uuid),dateChanged,changedBy:(uuid)),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid),person:${PERSON_REP})`,
  VISIT_CUSTOM_REP: `v=custom:(uuid,patient:(uuid),attributes:(uuid,value,attributeType:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid)),startDatetime,stopDatetime,indication:(uuid),location:(uuid),visitType:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid))`,
  ENCOUNTER_CUSTOM_REP: `v=custom:(uuid,patient:(uuid),location:(uuid),encounterType:(uuid),form:(uuid),visit:(uuid),encounterDatetime,encounterProviders:(provider:(uuid),encounterRole:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid)),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid),obs:${OBS_REP})`,
  OBS_CUSTOM_REP: `v=custom:${OBS_REP}`,
  USER_CUSTOM_REP: `v=custom:(uuid,username,email,userProperties,roles:(uuid),person:${PERSON_REP},dateCreated,creator:(uuid))`,  // NOTE: we don't include date change and changed by for user due to potential circular references
  PROVIDER_CUSTOM_REP: `v=custom:(uuid,identifier,providerRole:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid),person:${PERSON_REP})`,
  PROGRAM_ENROLLMENT_CUSTOM_REP: `v=custom:(uuid,patient:(uuid),program:(uuid),location:(uuid),dateEnrolled,dateCompleted,outcome:(uuid),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid),states:(uuid,startDate,endDate,dateCreated,creator:(uuid),dateChanged,changedBy:(uuid),state:(uuid)))`,
  ALLERGY_CUSTOM_REP: `v=custom:(uuid,allergen:(allergenType,codedAllergen:(uuid),nonCodedAllergen),severity:(uuid),comment,reactions:(reaction:(uuid),reactionNonCoded),dateCreated,creator:(uuid),dateChanged,changedBy:(uuid))`,
  RELATIONSHIP_CUSTOM_REP: `v=custom:(uuid,personA:(uuid),personB:(uuid),relationshipType:(uuid),startDate,endDate,dateCreated,creator:(uuid),dateChanged,changedBy:(uuid))`,
  TEST_ORDER_CUSTOM_REP: `v=custom:(${ORDER_BASE_REP},specimenSource:(uuid),laterality,clinicalHistory,frequency:(uuid),numberOfRepeats,location:(uuid)`,
  DRUG_ORDER_CUSTOM_REP: `v=custom:(${ORDER_BASE_REP},previousOrder:(uuid),drug:(uuid),dose,doseUnits:(uuid),dosingType,frequency:(uuid),asNeeded,quantity,quantityUnits:(uuid),asNeededCondition,numRefills,dosingInstructions,duration,durationUnits:(uuid),route:(uuid),brandName,dispenseAsWritten,drugNonCoded)`,
  GP_VISIT_ASSIGNMENT_HANDLER_DISABLED: "emrapi.emrApiVisitAssignmentHandler.disabled",
  GP_MAX_RESULTS_DEFAULT: "webservices.rest.maxResultsDefault",
  GP_MAX_RESULTS_ABSOLUTE: "webservices.rest.maxResultsAbsolute",
  GP_ALLOW_SETTING_ORDER_NUMBER: "order.allowSettingOrderNumber",
  GP_IGNORE_ATTEMPTS_TO_STOP_INACTIVE_ORDERS: "order.allowSettingStopDateOnInactiveOrders",
  MAX_RESULTS_DEFAULT: "500",
  MAX_RESULTS_ABSOLUTE: "3000",
  DRUG_ORDER_TYPE_UUID: "131168f4-15f5-102d-96e4-000c29c2a5d7",
  TEST_ORDER_TYPE_UUID:"52a447d3-a64a-11e3-9aeb-50e549534c5e",
  TEST_ORDER_NUMBER_CONCEPT_UUID: "393dec41-2fb5-428f-acfa-36ea85da6666",
  PATHOLOGY_TEST_ORDER_TYPE: "65c912c2-88cf-46c2-83ae-2b03b1f97d3a"
};