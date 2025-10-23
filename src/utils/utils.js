
/**
 * Generates a random, strong password (courtesy of AI)
 * @param {number} length - Length of the password to generate. Default is 16.
 * @returns {string} - A randomly generated strong password.
 */
export function generateStrongPassword(length = 16) {
  const upperCaseLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowerCaseLetters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specialCharacters = '!@#$%^&*()_+[]{}|;:,.<>?';

  // Combine all character pools
  const allCharacters = upperCaseLetters + lowerCaseLetters + numbers + specialCharacters;

  // Ensure password contains at least one character from each pool
  const getRandomChar = (chars) => chars[Math.floor(Math.random() * chars.length)];
  const passwordArray = [
    getRandomChar(upperCaseLetters),
    getRandomChar(lowerCaseLetters),
    getRandomChar(numbers),
    getRandomChar(specialCharacters),
  ];

  // Fill the rest of the password length with random characters from all pools
  for (let i = passwordArray.length; i < length; i++) {
    passwordArray.push(getRandomChar(allCharacters));
  }

  // Shuffle the password to randomize character positions
  return passwordArray.sort(() => Math.random() - 0.5).join('');
}

export function replaceMappings(str, mappings) {
  let updatedStr = str;
  for (const [targetValue, newValue] of Object.entries(mappings)) {
    updatedStr = updatedStr.replace(new RegExp(targetValue, "g"), newValue);
  }
  return updatedStr;
}

export function trimNonAlphanumeric(str) {
    if ( str ) {
        return str.replace(/(^[^a-zA-Z0-9]*)|([^a-zA-Z0-9]*$)/g, '');
    }
    return str;
}

// Utility to recursively sanitize JSON objects
// - Removes unnecessary whitespace from strings
// - Provides consistent structure for comparison purposes
export function sanitizeObject(obj)  {
  if (Array.isArray(obj)) {
    return obj
      .sort((a, b) => {
        if (a.uuid && b.uuid) {
          return a.uuid.localeCompare(b.uuid); // Sort by "uuid" if both objects have it
        }
        if (a.encounterRole && b.encounterRole) {
          return a.encounterRole.uuid.localeCompare(b.encounterRole.uuid)  // sort encounter providers by encounter role
        }
        return 0; // No sorting if "uuid" property is missing
      })
      .map(sanitizeObject); // Recursively sanitize elements in arrays
  } else if (typeof obj === "object" && obj !== null) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== undefined) { // drop any undefined properties

        // hack: remove seconds and milliseconds component of date created to ignore issue where the patient date created is a second different from what was expected
        if (key === "dateCreated") {
          value = value.replace(/\d{2}\.\d{3}/g, '');
        }

        acc[key] = sanitizeObject(value); // Recursively sanitize each field in the object
      }
      return acc;
    }, {});
  } else if (typeof obj === "string") {
    // Trim strings, collapse whitespace, and standardize greater than and less than
    return obj.trim().replace(/\s+/g, " ").replace("<","&lt;").replace(">","&gt;");
  }
  return obj; // Return non-object, non-string values as-is
}

/**
 * This method recursively processes all datetime fields in the object and for dates at midnight it strips the
 * time component, while for dates at a second before midight it strips the timezone component (but keeps the time)
 *
 * This is to handle cases when we are migration data between two servers with different time zones; the assumption
 * we are making is that if the event happened exactly at midnight or exactly the second before minute, this is
 * not a "real-time" entry but a retrospective entry we want to record as happening at "midnight" or a "second
 * before midnight" (ie at the end of the day) regardless of time zone
 *
 * @param obj
 * @returns {Object}
 */
export function stripTimeComponentFromDatesAtMidnightAndSecondBeforeMidnight(obj) {
  const isoRegexMidnight = /^(\d{4}-\d{2}-\d{2})T(00:00:00)(\.\d+)?(Z|[+-]\d{2}(:)?\d{2})?$/;
  const isoRegexSecondBeforeMidnight = /^(\d{4}-\d{2}-\d{2}T23:59:59)(\.\d+)?(Z|[+-]\d{2}(:)?\d{2})?$/;
  const stripTime = (isoString) => {
    const midnightMatch = isoRegexMidnight.exec(isoString);
    if (midnightMatch) {
      // If the regex matches, return just the date component (group 1 of the regex).
      return midnightMatch[1]; // YYYY-MM-DD
    }
    const secondBeforeMidnightMatch = isoRegexSecondBeforeMidnight.exec(isoString);
    if (secondBeforeMidnightMatch) {
      return secondBeforeMidnightMatch[1]; // YYYY-MM-DD
    }
    // If it doesn't match the condition (not midnight), return input.
    return isoString;
  }

  return processISODates(obj, stripTime);
}

export function convertHaiti2016TimesToDaylightSavings(obj) {

  // Define the DST start and end times for New York in 2016
  const dstStart = new Date("2016-03-13T02:00:00-05:00"); // Eastern Standard Time (UTC-5:00)
  const dstEnd = new Date("2016-11-06T02:00:00-04:00");   // Eastern Daylight Time (UTC-4:00)

  const convertTime = (isoString) => {
    // Parse the input date
    const inputDate = new Date(isoString);
    // Check if the input date is during DST 2106 (between dstStart and dstEnd)
    if (inputDate >= dstStart && inputDate < dstEnd) {
      // If within DST, convert the date to UTC-4:00
      const offsetDate = new Date(inputDate.getTime() - (4 * 60 * 60 * 1000)); // Subtract 4 hours to convert to UTC-4
      // Return the result as an ISO string with the UTC timezone suffix
      return offsetDate.toISOString().replace("Z", "-0400");
    }
    // If not during DST, return the original date
    return isoString;
  }
  return processISODates(obj, convertTime);
}

/**
 * Recursively processes all properties of a JavaScript object that are ISO date strings.
 *
 * @param {object} obj - The object to check.
 * @param {function} processDateFunction - Function to process date strings (e.g., convert or transform them).
 * @param {string} path - Used internally for tracking nested keys (provide "" when calling the function).
 */
function processISODates(obj, processDateFunction, path = "") {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:)?\d{2})$/;

  // Base case: If it's not an object or array, stop processing.
  if (obj === null || typeof obj !== "object") {
    return;
  }

  // Iterate through the keys of the object.
  for (let key in obj) {
    const value = obj[key];
    const currentPath = path ? `${path}.${key}` : key;

    // If the value is a string and matches ISO date format, process it.
    if (typeof value === "string" && isoDateRegex.test(value)) {
      obj[key] = processDateFunction(value, currentPath);
    }

    // If the value is an object or array, process recursively.
    else if (typeof value === "object") {
      obj[key] = processISODates(value, processDateFunction, currentPath);
    }
  }
  return obj;
}

/**
 * Given a list of elements with a uuid, sorts them by uuid
 * Used to enforce a consistent ordering to allow easier verification of data pre-and-post migration
 *
 * @param results
 * @returns {*}
 */
export function sortByUuid(results) {
  return results.sort((a, b) => a.uuid.localeCompare(b.uuid));
}