import { bindSolcMethod, bindSolcMethodWithFallbackFunc } from './helpers';
import translate from '../translate';
import * as semver from 'semver';
import { isNil } from '../common/helpers';

export function setupCore (solJson) {
  const core = {
    alloc: bindAlloc(solJson),
    license: bindLicense(solJson),
    version: bindVersion(solJson),
    reset: bindReset(solJson)
  };

  const helpers = {
    addFunction: unboundAddFunction.bind(this, solJson),
    removeFunction: unboundRemoveFunction.bind(this, solJson),

    copyFromCString: unboundCopyFromCString.bind(this, solJson),
    copyToCString: unboundCopyToCString.bind(this, solJson, core.alloc),

    // @ts-ignore
    versionToSemver: versionToSemver(core.version())
  };

  return {
    ...core,
    ...helpers,

    isVersion6OrNewer: semver.gt(helpers.versionToSemver(), '0.5.99')
  };
}

/**********************
 * Core Functions
 **********************/

/**
 * Returns a binding to the solidity_alloc function.
 *
 * @param solJson The Emscripten compiled Solidity object.
 */
function bindAlloc (solJson) {
  const allocBinding = bindSolcMethod(
    solJson,
    'solidity_alloc',
    'number',
    ['number'],
    null
  );

  // the fallback malloc is not a cwrap function and should just be returned
  // directly in-case the alloc binding could not happen.
  if (isNil(allocBinding)) {
    return solJson._malloc;
  }

  return allocBinding;
}

/**
 * Returns a binding to the solidity_version method.
 *
 * @param solJson The Emscripten compiled Solidity object.
 */
function bindVersion (solJson) {
  return bindSolcMethodWithFallbackFunc(
    solJson,
    'solidity_version',
    'string',
    [],
    'version'
  );
}

function versionToSemver (version) {
  return translate.versionToSemver.bind(this, version);
}

/**
 * Returns a binding to the solidity_license method.
 *
 * If the current solJson version < 0.4.14 then this will bind an empty function.
 *
 * @param solJson The Emscripten compiled Solidity object.
 */
function bindLicense (solJson) {
  return bindSolcMethodWithFallbackFunc(
    solJson,
    'solidity_license',
    'string',
    [],
    'license',
    () => {
    }
  );
}

/**
 * Returns a binding to the solidity_reset method.
 *
 * @param solJson The Emscripten compiled Solidity object.
 */
function bindReset (solJson) {
  return bindSolcMethod(
    solJson,
    'solidity_reset',
    null,
    [],
    null
  );
}

/**********************
 * Helpers Functions
 **********************/

/**
 * Copy to a C string.
 *
 * Allocates memory using solc's allocator.
 *
 * Before 0.6.0:
 *   Assuming copyToCString is only used in the context of wrapCallback, solc will free these pointers.
 *   See https://github.com/ethereum/solidity/blob/v0.5.13/libsolc/libsolc.h#L37-L40
 *
 * After 0.6.0:
 *   The duty is on solc-js to free these pointers. We accomplish that by calling `reset` at the end.
 *
 * @param solJson The Emscripten compiled Solidity object.
 * @param alloc The memory allocation function.
 * @param str The source string is being copied to a C string.
 * @param ptr The pointer location where the C string will be set.
 */
function unboundCopyToCString (solJson, alloc, str, ptr) {
  const length = solJson.lengthBytesUTF8(str);

  const buffer = alloc(length + 1);

  solJson.stringToUTF8(str, buffer, length + 1);
  solJson.setValue(ptr, buffer, '*');
}

/**
 * Wrapper over Emscripten's C String copying function (which can be different
 * on different versions).
 *
 * @param solJson The Emscripten compiled Solidity object.
 * @param ptr The pointer location where the C string will be referenced.
 */
function unboundCopyFromCString (solJson, ptr) {
  const copyFromCString = solJson.UTF8ToString || solJson.Pointer_stringify;
  return copyFromCString(ptr);
}

function unboundAddFunction (solJson, func, signature?) {
  return (solJson.addFunction || solJson.Runtime.addFunction)(func, signature);
}

function unboundRemoveFunction (solJson, ptr) {
  return (solJson.removeFunction || solJson.Runtime.removeFunction)(ptr);
}
