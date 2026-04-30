// Shared validation utility functions
// Used by preload.js and pdf-utils.js to avoid code duplication

/**
 * Maximum input limits for security
 */
const MAX_STRING_LENGTH = 10000;
const MAX_ARRAY_LENGTH = 1000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Validate a string input
 * @param {*} value - The value to validate
 * @param {string} name - Name of the parameter for error messages
 * @param {number} [maxLength=MAX_STRING_LENGTH] - Maximum allowed length
 * @returns {string} The validated string
 * @throws {Error} If validation fails
 */
function validateString(value, name, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters long`);
  }
  return value;
}

/**
 * Validate an array input
 * @param {*} value - The value to validate
 * @param {string} name - Name of the parameter for error messages
 * @param {number} [maxLength=MAX_ARRAY_LENGTH] - Maximum allowed length
 * @returns {Array} The validated array
 * @throws {Error} If validation fails
 */
function validateArray(value, name, maxLength = MAX_ARRAY_LENGTH) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} must contain at most ${maxLength} items`);
  }
  return value;
}

/**
 * Validate a number input
 * @param {*} value - The value to validate
 * @param {string} name - Name of the parameter for error messages
 * @param {number} [min=-Infinity] - Minimum allowed value
 * @param {number} [max=Infinity] - Maximum allowed value
 * @returns {number} The validated number
 * @throws {Error} If validation fails
 */
function validateNumber(value, name, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`${name} must be a valid number`);
  }
  if (value < min) {
    throw new Error(`${name} must be at least ${min}`);
  }
  if (value > max) {
    throw new Error(`${name} must be at most ${max}`);
  }
  return value;
}

/**
 * Validate a buffer input
 * @param {*} value - The value to validate
 * @param {string} name - Name of the parameter for error messages
 * @param {number} [maxSize=MAX_FILE_SIZE] - Maximum allowed size
 * @returns {Uint8Array|Array} The validated buffer
 * @throws {Error} If validation fails
 */
function validateBuffer(value, name, maxSize = MAX_FILE_SIZE) {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) {
    throw new Error(`${name} must be an array or Uint8Array`);
  }
  if (value.length > maxSize) {
    throw new Error(`${name} must be at most ${maxSize} bytes`);
  }
  return value;
}

/**
 * Validate that an object exists and is an object
 * @param {*} value - The value to validate
 * @param {string} name - Name of the parameter for error messages
 * @returns {object} The validated object
 * @throws {Error} If validation fails
 */
function validateObject(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a valid object`);
  }
  return value;
}

/**
 * Validate a page range string (e.g., "1-3", "5")
 * @param {string} range - Range string to validate
 * @param {string} name - Name of the parameter for error messages
 * @returns {string} The validated range
 * @throws {Error} If validation fails
 */
function validatePageRange(range, name) {
  validateString(range, name, 100);
  const trimmed = range.trim();
  
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty range string`);
  }
  
  // Simple format check: either number or number-number
  const rangeRegex = /^\s*\d+\s*(-\s*\d+\s*)?$/;
  if (!rangeRegex.test(trimmed)) {
    throw new Error(`${name} must be a valid page range (e.g., "1", "1-3")`);
  }
  
  return trimmed;
}

module.exports = {
  validateString,
  validateArray,
  validateNumber,
  validateBuffer,
  validateObject,
  validatePageRange,
  MAX_STRING_LENGTH,
  MAX_ARRAY_LENGTH,
  MAX_FILE_SIZE
};
