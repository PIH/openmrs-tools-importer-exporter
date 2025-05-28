
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
