import config from "../utils/config.js";

export default {
  SOURCE: {
    URLS: {
      PATIENT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/patient`,
      VISIT: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/visit`,
      ENCOUNTER: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/encounter`,
      OBS: `${config.OPENMRS_SOURCE_CONTEXT_PATH}/ws/rest/v1/obs`,
    }
  },
  TARGET: {
    URLS: {
      PATIENT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/patient`,
      VISIT: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/visit`,
      ENCOUNTER: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/encounter`,
      OBS: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/obs`,
    }
  },
  PATIENT_CUSTOM_REP: "v=custom:(uuid,display,identifiers:(uuid,identifier,identifierType:(uuid),preferred),person:(uuid,display,gender,age,birthdate,birthdateEstimated,dead,deathDate,causeOfDeath,names,addresses,attributes))",
  VISIT_CUSTOM_REP: "v=custom:(uuid,patient:(uuid),attributes,startDatetime,stopDatetime,indication,location:(uuid),visitType:(uuid),encounters:(uuid,patient:(uuid),location:(uuid),encounterType:(uuid),encounterDatetime,voided,voidReason),voided)",
  ENCOUNTER_CUSTOM_REP: "v=custom:(uuid,patient:(uuid),location:(uuid),encounterType:(uuid),encounterDatetime,voided,obs:(uuid,concept:(uuid),person:(uuid),obsDatetime,location:(uuid),encounter:(uuid),comment,valueModifier,valueCodedName:(uuid),groupMembers:(uuid,person:(uuid),concept:(uuid),obsDatetime,value,valueCodedName:(uuid),voided),voided,value:(uuid)))",
  OBS_CUSTOM_REP: "v=custom:(uuid,concept:(uuid),person:(uuid),obsDatetime,location:(uuid),valueCoded:(uuid),valueDatetime,valueNumeric,valueText,valueComplex,encounter:(uuid),comment,valueModifier,valueCodedName:(uuid),obsGroup:(uuid),groupMembers:(uuid),voided)"
};
