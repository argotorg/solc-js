import linker from './linker';

/// Translate old style version numbers to semver.
/// Old style: 0.3.6-3fc68da5/Release-Emscripten/clang
///            0.3.5-371690f0/Release-Emscripten/clang/Interpreter
///            0.3.5-0/Release-Emscripten/clang/Interpreter
///            0.2.0-e7098958/.-Emscripten/clang/int linked to libethereum-1.1.1-bbb80ab0/.-Emscripten/clang/int
///            0.1.3-0/.-/clang/int linked to libethereum-0.9.92-0/.-/clang/int
///            0.1.2-5c3bfd4b*/.-/clang/int
///            0.1.1-6ff4cd6b/RelWithDebInfo-Emscripten/clang/int
/// New style: 0.4.5+commit.b318366e.Emscripten.clang
function versionToSemver (version) {
  // FIXME: parse more detail, but this is a good start
  const parsed = version.match(/^([0-9]+\.[0-9]+\.[0-9]+)-([0-9a-f]{8})[/*].*$/);
  if (parsed) {
    return parsed[1] + '+commit.' + parsed[2];
  }
  if (version.indexOf('0.1.3-0') !== -1) {
    return '0.1.3';
  }
  if (version.indexOf('0.3.5-0') !== -1) {
    return '0.3.5';
  }
  // assume it is already semver compatible
  return version;
}

function translateErrors (ret, errors) {
  for (const error in errors) {
    let type = 'error';
    let extractType: any = /^(.*):(\d+):(\d+):(.*):/;
    extractType = extractType.exec(errors[error]);
    if (extractType) {
      type = extractType[4].trim();
    } else if (errors[error].indexOf(': Warning:')) {
      type = 'Warning';
    } else if (errors[error].indexOf(': Error:')) {
      type = 'Error';
    }
    ret.push({
      type: type,
      component: 'general',
      severity: (type === 'Warning') ? 'warning' : 'error',
      message: errors[error],
      formattedMessage: errors[error]
    });
  }
}

function translateGasEstimates (gasEstimates) {
  if (gasEstimates === null) {
    return 'infinite';
  }

  if (typeof gasEstimates === 'number') {
    return gasEstimates.toString();
  }

  const gasEstimatesTranslated = {};
  for (const func in gasEstimates) {
    gasEstimatesTranslated[func] = translateGasEstimates(gasEstimates[func]);
  }
  return gasEstimatesTranslated;
}

function translateJsonCompilerOutput (output, libraries) {
  const ret: any = {};

  ret.errors = [];
  let errors;
  if (output.error) {
    errors = [output.error];
  } else {
    errors = output.errors;
  }
  translateErrors(ret.errors, errors);

  ret.contracts = {};
  for (const contract in output.contracts) {
    // Split name first, can be `contract`, `:contract` or `filename:contract`
    const tmp = contract.match(/^((.*):)?([^:]+)$/);
    if (tmp.length !== 4) {
      // Force abort
      return null;
    }
    let fileName = tmp[2];
    if (fileName === undefined) {
      // this is the case of `contract`
      fileName = '';
    }
    const contractName = tmp[3];

    const contractInput = output.contracts[contract];

    const gasEstimates = contractInput.gasEstimates;
    const translatedGasEstimates: any = {};

    if (gasEstimates.creation) {
      translatedGasEstimates.creation = {
        codeDepositCost: translateGasEstimates(gasEstimates.creation[1]),
        executionCost: translateGasEstimates(gasEstimates.creation[0])
      };
    }
    if (gasEstimates.internal) {
      translatedGasEstimates.internal = translateGasEstimates(gasEstimates.internal);
    }
    if (gasEstimates.external) {
      translatedGasEstimates.external = translateGasEstimates(gasEstimates.external);
    }

    const contractOutput = {
      abi: JSON.parse(contractInput.interface),
      metadata: contractInput.metadata,
      evm: {
        legacyAssembly: contractInput.assembly,
        bytecode: {
          object: contractInput.bytecode && linker.linkBytecode(contractInput.bytecode, libraries || {}),
          opcodes: contractInput.opcodes,
          sourceMap: contractInput.srcmap,
          linkReferences: contractInput.bytecode && linker.findLinkReferences(contractInput.bytecode)
        },
        deployedBytecode: {
          object: contractInput.runtimeBytecode && linker.linkBytecode(contractInput.runtimeBytecode, libraries || {}),
          sourceMap: contractInput.srcmapRuntime,
          linkReferences: contractInput.runtimeBytecode && linker.findLinkReferences(contractInput.runtimeBytecode)
        },
        methodIdentifiers: contractInput.functionHashes,
        gasEstimates: translatedGasEstimates
      }
    };

    if (!ret.contracts[fileName]) {
      ret.contracts[fileName] = {};
    }

    ret.contracts[fileName][contractName] = contractOutput;
  }

  const sourceMap = {};
  for (const sourceId in output.sourceList) {
    sourceMap[output.sourceList[sourceId]] = sourceId;
  }

  ret.sources = {};
  for (const source in output.sources) {
    ret.sources[source] = {
      id: sourceMap[source],
      legacyAST: output.sources[source].AST
    };
  }

  return ret;
}

function escapeString (text) {
  return text
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// 'asm' can be an object or a string
function formatAssemblyText (asm, prefix, source) {
  if (typeof asm === 'string' || asm === null || asm === undefined) {
    return prefix + (asm || '') + '\n';
  }
  let text = prefix + '.code\n';
  asm['.code'].forEach(function (item, i) {
    const v = item.value === undefined ? '' : item.value;
    let src = '';
    if (source !== undefined && item.begin !== undefined && item.end !== undefined) {
      src = escapeString(source.slice(item.begin, item.end));
    }
    if (src.length > 30) {
      src = src.slice(0, 30) + '...';
    }
    if (item.name !== 'tag') {
      text += '  ';
    }
    text += prefix + item.name + ' ' + v + '\t\t\t' + src + '\n';
  });
  text += prefix + '.data\n';
  const asmData = asm['.data'] || [];
  for (const i in asmData) {
    const item = asmData[i];
    text += '  ' + prefix + '' + i + ':\n';
    text += formatAssemblyText(item, prefix + '    ', source);
  }
  return text;
}

function prettyPrintLegacyAssemblyJSON (assembly, source) {
  return formatAssemblyText(assembly, '', source);
}

/// Workaround for https://github.com/argotorg/solc-js/issues/755
/// (https://github.com/ethereum/solidity/issues/14214):
/// compiler versions <=0.5.8 return empty output when the outputSelection
/// uses `*` at the source level together with specific contract names.
/// Adding an explicit source entry for such a contract makes the compiler
/// produce the requested output, so the workaround mirrors the named contract
/// selectors of the `*` source selector into explicit entries for every input
/// source. The `*` selector itself is left untouched: files outside the input
/// sources (e.g. supplied through the import callback) behave exactly as
/// before, and no contract that was not requested is ever selected, so the
/// workaround cannot trigger additional code generation (which could fail,
/// e.g. with "stack too deep", for contracts the user never asked for).

/// True when the outputSelection contains a `*` source selector together with
/// a named contract selector, i.e. the pattern that triggers the bug.
function needsWildcardContractWorkaround (outputSelection) {
  if (outputSelection == null || typeof outputSelection !== 'object') {
    return false;
  }
  const wildcardSelection = outputSelection['*'];
  if (wildcardSelection == null || typeof wildcardSelection !== 'object') {
    return false;
  }
  return Object.keys(wildcardSelection).some(function (contract) {
    return contract !== '*' && contract !== '';
  });
}

/// True when every entry of the outputSelection is well formed, i.e. maps
/// source selectors to objects mapping contract selectors to arrays of
/// output names. Malformed selections are left for the compiler to reject,
/// so that its own error reporting is preserved.
function isWellFormedOutputSelection (outputSelection) {
  if (outputSelection == null || typeof outputSelection !== 'object' || Array.isArray(outputSelection)) {
    return false;
  }
  for (const fileSelector of Object.keys(outputSelection)) {
    const contractSelection = outputSelection[fileSelector];
    if (contractSelection == null || typeof contractSelection !== 'object' || Array.isArray(contractSelection)) {
      return false;
    }
    for (const contractSelector of Object.keys(contractSelection)) {
      const outputs = contractSelection[contractSelector];
      if (!Array.isArray(outputs) || outputs.some(function (output) { return typeof output !== 'string'; })) {
        return false;
      }
    }
  }
  return true;
}

/// Returns a new standard JSON input where the named contract selectors of
/// the `*` source selector are mirrored into explicit entries for every input
/// source. Existing explicit entries are kept and merged (the compiler unions
/// the outputs of all matching selectors). Only call this when
/// needsWildcardContractWorkaround and isWellFormedOutputSelection are true.
///
/// All dictionaries created here use a null prototype and only own keys are
/// enumerated, so that contract or file names colliding with Object.prototype
/// members (e.g. "toString", "constructor", "__proto__" - all valid Solidity
/// identifiers or legal JSON keys) cannot corrupt the expansion.
function expandWildcardSourceSelection (input) {
  const expanded = JSON.parse(JSON.stringify(input));
  const outputSelection = expanded.settings.outputSelection;
  const wildcardSelection = outputSelection['*'];
  const namedContracts = Object.create(null);
  for (const contract of Object.keys(wildcardSelection)) {
    if (contract !== '*' && contract !== '') {
      namedContracts[contract] = wildcardSelection[contract];
    }
  }
  // Rebuild the selection on a null-prototype object: assigning a "__proto__"
  // file key to a plain object would invoke its setter and pollute it.
  const newSelection = Object.create(null);
  for (const fileSelector of Object.keys(outputSelection)) {
    newSelection[fileSelector] = outputSelection[fileSelector];
  }
  for (const fileName of Object.keys(expanded.sources)) {
    const existing = newSelection[fileName];
    const merged = Object.create(null);
    if (existing != null && typeof existing === 'object') {
      for (const contract of Object.keys(existing)) {
        merged[contract] = existing[contract].slice();
      }
    }
    for (const contract of Object.keys(namedContracts)) {
      if (merged[contract] === undefined) {
        merged[contract] = namedContracts[contract].slice();
      } else {
        for (const output of namedContracts[contract]) {
          if (!merged[contract].includes(output)) {
            merged[contract].push(output);
          }
        }
      }
    }
    newSelection[fileName] = merged;
  }
  expanded.settings.outputSelection = newSelection;
  return expanded;
}

export = {
  versionToSemver,
  translateJsonCompilerOutput,
  prettyPrintLegacyAssemblyJSON,
  needsWildcardContractWorkaround,
  isWellFormedOutputSelection,
  expandWildcardSourceSelection
};
