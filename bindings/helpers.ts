import { isNil } from '../common/helpers';

export function bindSolcMethod (solJson, method, returnType, args, defaultValue) {
  if (isNil(solJson[`_${method}`]) && defaultValue !== undefined) {
    return defaultValue;
  }

  return solJson.cwrap(method, returnType, args);
}

export function bindSolcMethodWithFallbackFunc (solJson, method, returnType, args, fallbackMethod, finalFallback = undefined) {
  const methodFunc = bindSolcMethod(solJson, method, returnType, args, null);

  if (!isNil(methodFunc)) {
    return methodFunc;
  }

  return bindSolcMethod(solJson, fallbackMethod, returnType, args, finalFallback);
}

export function getSupportedMethods (solJson) {
  return {
    licenseSupported: anyMethodExists(solJson, 'solidity_license'),
    versionSupported: anyMethodExists(solJson, 'solidity_version'),
    allocSupported: anyMethodExists(solJson, 'solidity_alloc'),
    resetSupported: anyMethodExists(solJson, 'solidity_reset'),
    compileJsonSupported: anyMethodExists(solJson, 'compileJSON'),
    compileJsonMultiSupported: anyMethodExists(solJson, 'compileJSONMulti'),
    compileJsonCallbackSupported: anyMethodExists(solJson, 'compileJSONCallback'),
    compileJsonStandardSupported: anyMethodExists(solJson, 'compileStandard', 'solidity_compile')
  };
}

function anyMethodExists (solJson, ...names) {
  return names.some(name => !isNil(solJson[`_${name}`]));
}
