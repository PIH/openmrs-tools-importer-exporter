
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