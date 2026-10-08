import fs from 'fs';
import { keccak256 } from 'js-sha3';

/**
 * Returns true if and only if the value is null or undefined.
 *
 * @param value
 */
export function isNil (value: any): boolean {
  // Uses == over === which compares both null and undefined.
  return value == null;
}

/**
 * Returns true if and only if the value is an object and not an array.
 *
 * @param value
 */
export function isObject (value: any): boolean {
  // typeof [] will result in an 'object' so this additionally uses Array.isArray
  // to confirm it's just an object.
  return typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns the keccak256 hash of a file.
 *
 * @param path The path to the file to be hashed.
 */
export function hashFile (path: string): string {
  return '0x' + keccak256(fs.readFileSync(path, { encoding: 'binary' }));
}
