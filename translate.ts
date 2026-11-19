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

/// Compilers older than 0.4.20 split source paths at the first colon when
/// producing the contracts output: "C:\project\a.sol" is reported as
/// file "C" with a "contract" named "\project\a.sol:A"
/// (https://github.com/argotorg/solc-js/issues/557). Solidity identifiers
/// cannot contain a colon, so the contract name is everything after the
/// LAST colon of the mangled name, and the source path is the outer key
/// plus the remainder before it. Entries that do not resolve to a known
/// input source (e.g. files supplied only through the import callback)
/// are left untouched. The repair is all-or-nothing: if two entries would
/// land on the same key, the original output is returned unchanged so no
/// compiler data is ever dropped or overwritten.
function repairColonPathsInContracts (contracts, sourcePaths) {
  // Anything but plain path -> name -> contract mappings is left to the
  // compiler's own error reporting.
  for (const file of Object.keys(contracts)) {
    if (contracts[file] === null || typeof contracts[file] !== 'object') return contracts;
  }

  let mangled = false;
  for (const file of Object.keys(contracts)) {
    for (const name of Object.keys(contracts[file])) {
      if (name.indexOf(':') !== -1) {
        mangled = true;
        break;
      }
    }
    if (mangled) break;
  }
  if (!mangled) return contracts;

  const repaired = Object.create(null);
  for (const file of Object.keys(contracts)) {
    for (const name of Object.keys(contracts[file])) {
      let path = file;
      let contractName = name;
      const lastColon = name.lastIndexOf(':');
      if (lastColon !== -1) {
        const candidate = file + ':' + name.slice(0, lastColon);
        if (sourcePaths.indexOf(candidate) !== -1) {
          path = candidate;
          contractName = name.slice(lastColon + 1);
        }
      }
      if (repaired[path] === undefined) repaired[path] = Object.create(null);
      if (repaired[path][contractName] !== undefined) {
        // Ambiguous mapping: refuse to repair rather than lose data.
        return contracts;
      }
      repaired[path][contractName] = contracts[file][name];
    }
  }
  return repaired;
}

function prettyPrintLegacyAssemblyJSON (assembly, source) {
  return formatAssemblyText(assembly, '', source);
}

export = {
  versionToSemver,
  translateJsonCompilerOutput,
  repairColonPathsInContracts,
  prettyPrintLegacyAssemblyJSON
};
