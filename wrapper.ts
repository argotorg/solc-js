import MemoryStream from 'memorystream';
import { https } from 'follow-redirects';

import { formatFatalError } from './formatters';
import { isNil } from './common/helpers';
import setupBindings from './bindings';
import translate from './translate';

const Module = module.constructor as any;

function wrapper (soljson) {
  const {
    coreBindings,
    compileBindings,
    methodFlags
  } = setupBindings(soljson);

  return {
    version: coreBindings.version,
    semver: coreBindings.versionToSemver,
    license: coreBindings.license,
    lowlevel: {
      compileSingle: compileBindings.compileJson,
      compileMulti: compileBindings.compileJsonMulti,
      compileCallback: compileBindings.compileJsonCallback,
      compileStandard: compileBindings.compileStandard
    },
    features: {
      legacySingleInput: methodFlags.compileJsonStandardSupported,
      multipleInputs: methodFlags.compileJsonMultiSupported || methodFlags.compileJsonStandardSupported,
      importCallback: methodFlags.compileJsonCallbackSuppported || methodFlags.compileJsonStandardSupported,
      nativeStandardJSON: methodFlags.compileJsonStandardSupported
    },
    compile: compileStandardWrapper.bind(this, compileBindings),
    // Loads the compiler of the given version from the github repository
    // instead of from the local filesystem.
    loadRemoteVersion,
    // Use this if you want to add wrapper functions around the pure module.
    setupMethods: wrapper
  };
}

// Loads the given soljson binary over HTTP(S) once and reports the result.
// Any failure of the attempt is reported through the callback: network
// errors, non-200 responses, a response that fails or is aborted mid-body
// and a downloaded file that cannot be compiled all count as a failed
// attempt. The callback is invoked exactly once per attempt, even when
// several failure signals fire (e.g. a request error after the response
// has already completed).
function downloadBinaryOnce (url, versionString, callback) {
  let finished = false;
  function finish (error, solcSnapshot?) {
    if (finished) return;
    finished = true;
    callback(error, solcSnapshot);
  }

  const request = https.get(url, response => {
    // Failure handlers are registered before the status check so that a
    // late failure of a response the attempt has already settled (e.g. a
    // drained non-200 response) is ignored instead of escaping as an
    // unhandled 'error' event.
    response.on('error', function (error) {
      finish(error);
    });
    response.on('aborted', function () {
      finish(new Error('Error retrieving binary: response aborted'));
    });
    if (response.statusCode !== 200) {
      // Drain the response so the socket is released.
      response.resume();
      finish(new Error(`Error retrieving binary: ${response.statusMessage}`));
      return;
    }
    const memoryStream = new MemoryStream(null, { readable: false });
    response.pipe(memoryStream);
    response.on('end', () => {
      // The attempt may already have failed (error or aborted); never
      // load the buffered body of a settled attempt.
      if (finished) return;
      // Based on the require-from-string package.
      let solcSnapshot;
      try {
        const soljson = new Module();
        soljson._compile(memoryStream.toString(), `soljson-${versionString}.js`);

        if (module.parent && module.parent.children) {
          // Make sure the module is plugged into the hierarchy correctly to have parent
          // properly garbage collected.
          module.parent.children.splice(module.parent.children.indexOf(soljson), 1);
        }

        solcSnapshot = wrapper(soljson.exports);
      } catch (error) {
        finish(new Error(`Error compiling downloaded binary: ${error}`));
        return;
      }
      // Called outside the try so that an exception thrown by the
      // callback itself propagates instead of being misreported as a
      // compile failure of the downloaded binary.
      finish(null, solcSnapshot);
    });
  });
  request.on('error', function (error) {
    finish(error);
  });
}

// Loads the compiler of the given version from the binary repository.
// By default a single download attempt is made. An options object can be
// passed between the version and the callback to retry failed attempts
// (https://github.com/argotorg/solc-js/issues/469):
//   loadRemoteVersion(version, { retries: 2, retryDelay: 1000 }, callback)
// - retries (default 0): how many times a failed download is retried.
//   Must be a non-negative safe integer.
// - retryDelay (default 1000): delay in milliseconds between attempts.
//   Must be a finite number between 0 and 2^31-1.
// Invalid option values throw a TypeError. After the last attempt the
// callback receives the last error. Note that a request that connects but
// then stalls without producing bytes still hangs indefinitely, as before;
// no timeout is applied.
function loadRemoteVersion (versionString, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (options === null || options === undefined) {
    options = {};
  }
  if (typeof options !== 'object') {
    throw new TypeError('loadRemoteVersion: options must be an object');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('loadRemoteVersion requires a callback');
  }
  const retries = options.retries !== undefined ? options.retries : 0;
  const retryDelay = options.retryDelay !== undefined ? options.retryDelay : 1000;
  if (!Number.isSafeInteger(retries) || retries < 0) {
    throw new TypeError('loadRemoteVersion: retries must be a non-negative safe integer');
  }
  if (typeof retryDelay !== 'number' || !isFinite(retryDelay) || retryDelay < 0 || retryDelay > 0x7fffffff) {
    throw new TypeError('loadRemoteVersion: retryDelay must be a finite number between 0 and 2^31-1');
  }
  const url = `https://binaries.soliditylang.org/bin/soljson-${versionString}.js`;

  // The remaining retries are counted down directly: with a safe integer
  // every decrement is exact, so the sequence always terminates.
  let retriesLeft = retries;
  function attempt () {
    downloadBinaryOnce(url, versionString, function (error, solcSnapshot) {
      if (error && retriesLeft > 0) {
        retriesLeft--;
        setTimeout(attempt, retryDelay);
      } else {
        callback(error, solcSnapshot);
      }
    });
  }
  attempt();
}

// Expects a Standard JSON I/O but supports old compilers
function compileStandardWrapper (compile, inputRaw, readCallback) {
  if (!isNil(compile.compileStandard)) {
    return compile.compileStandard(inputRaw, readCallback);
  }

  let input: { language: string, sources: any[], settings: any };

  try {
    input = JSON.parse(inputRaw);
  } catch (e) {
    return formatFatalError(`Invalid JSON supplied: ${e.message}`);
  }

  if (input.language !== 'Solidity') {
    return formatFatalError('Only "Solidity" is supported as a language.');
  }

  // NOTE: this is deliberately `== null`
  if (isNil(input.sources) || input.sources.length === 0) {
    return formatFatalError('No input sources specified.');
  }

  const sources = translateSources(input);
  const optimize = isOptimizerEnabled(input);
  const libraries = librariesSupplied(input);

  if (isNil(sources) || Object.keys(sources).length === 0) {
    return formatFatalError('Failed to process sources.');
  }

  // Try to wrap around old versions
  if (!isNil(compile.compileJsonCallback)) {
    const inputJson = JSON.stringify({ sources: sources });
    const output = compile.compileJsonCallback(inputJson, optimize, readCallback);
    return translateOutput(output, libraries);
  }

  if (!isNil(compile.compileJsonMulti)) {
    const output = compile.compileJsonMulti(JSON.stringify({ sources: sources }), optimize);
    return translateOutput(output, libraries);
  }

  // Try our luck with an ancient compiler
  if (!isNil(compile.compileJson)) {
    if (Object.keys(sources).length > 1) {
      return formatFatalError('Multiple sources provided, but compiler only supports single input.');
    }

    const input = sources[Object.keys(sources)[0]];
    const output = compile.compileJson(input, optimize);
    return translateOutput(output, libraries);
  }

  return formatFatalError('Compiler does not support any known interface.');
}

function isOptimizerEnabled (input) {
  return input.settings && input.settings.optimizer && input.settings.optimizer.enabled;
}

function translateSources (input) {
  const sources = {};

  for (const source in input.sources) {
    if (input.sources[source].content !== null) {
      sources[source] = input.sources[source].content;
    } else {
      // force failure
      return null;
    }
  }

  return sources;
}

function librariesSupplied (input) {
  if (!isNil(input.settings)) return input.settings.libraries;
}

function translateOutput (outputRaw, libraries) {
  let parsedOutput;

  try {
    parsedOutput = JSON.parse(outputRaw);
  } catch (e) {
    return formatFatalError(`Compiler returned invalid JSON: ${e.message}`);
  }

  const output = translate.translateJsonCompilerOutput(parsedOutput, libraries);

  if (isNil(output)) {
    return formatFatalError('Failed to process output.');
  }

  return JSON.stringify(output);
}

export = wrapper;
