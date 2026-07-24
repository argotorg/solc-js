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
      importCallback: methodFlags.compileJsonCallbackSupported || methodFlags.compileJsonStandardSupported,
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

function loadRemoteVersion (versionString, callback) {
  const memoryStream = new MemoryStream(null, { readable: false });
  const url = `https://binaries.soliditylang.org/bin/soljson-${versionString}.js`;

  https.get(url, response => {
    if (response.statusCode !== 200) {
      callback(new Error(`Error retrieving binary: ${response.statusMessage}`));
    } else {
      response.pipe(memoryStream);
      response.on('end', () => {
        // Based on the require-from-string package.
        const soljson = new Module();
        soljson._compile(memoryStream.toString(), `soljson-${versionString}.js`);

        if (module.parent && module.parent.children) {
          // Make sure the module is plugged into the hierarchy correctly to have parent
          // properly garbage collected.
          module.parent.children.splice(module.parent.children.indexOf(soljson), 1);
        }

        callback(null, wrapper(soljson.exports));
      });
    }
  }).on('error', function (error) {
    callback(error);
  });
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
