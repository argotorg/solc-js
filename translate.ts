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

// Compilers older than 0.4.9 do not include source paths in their contract
// output: the wrapper groups every contract under the empty path "". Rebuild
// the per-file grouping from the legacyAST of each source when a contract
// name is declared in exactly one source. Anything ambiguous or unrecognized
// is left under "" so no compiler output is ever moved on a guess.
function repairEmptyPathContracts (contracts, sources) {
  if (contracts === null || typeof contracts !== 'object') return contracts;
  const emptyBucket = contracts[''];
  if (emptyBucket === null || typeof emptyBucket !== 'object') return contracts;

  // Sets an own property without triggering the __proto__ setter.
  function setOwn (obj, key, value) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, writable: true, configurable: true });
  }

  // Only the legacyAST shape emitted by 0.4.x (a SourceUnit whose children
  // are ContractDefinition nodes carrying attributes.name) is understood.
  // Older formats (e.g. a "root" node) are left untouched.
  const declarations = Object.create(null);
  if (sources !== null && typeof sources === 'object') {
    for (const path of Object.keys(sources)) {
      const entry = sources[path];
      const ast = entry !== null && typeof entry === 'object' ? entry.legacyAST : null;
      if (ast === null || typeof ast !== 'object' || ast.name !== 'SourceUnit' || !Array.isArray(ast.children)) continue;
      for (const node of ast.children) {
        if (node === null || typeof node !== 'object' || node.name !== 'ContractDefinition') continue;
        if (node.attributes === null || typeof node.attributes !== 'object' || typeof node.attributes.name !== 'string') continue;
        const name = node.attributes.name;
        if (declarations[name] === undefined) declarations[name] = Object.create(null);
        declarations[name][path] = true;
      }
    }
  }

  let movedAny = false;
  const repaired = {};
  for (const file of Object.keys(contracts)) {
    if (file !== '') setOwn(repaired, file, contracts[file]);
  }

  const remaining = {};
  for (const name of Object.keys(emptyBucket)) {
    const paths = declarations[name] === undefined ? [] : Object.keys(declarations[name]);
    const target = paths.length === 1 ? paths[0] : null;
    // Move only on a unique declaration that does not clobber an existing
    // entry; otherwise keep the contract under "". An existing bucket that
    // is not a plain object (null, scalar or array) is preserved unchanged
    // and blocks the move.
    let canMove = false;
    if (target !== null && target !== '') {
      if (!Object.prototype.hasOwnProperty.call(repaired, target)) {
        canMove = true;
      } else {
        const bucket = repaired[target];
        if (bucket !== null && typeof bucket === 'object' && !Array.isArray(bucket) && !Object.prototype.hasOwnProperty.call(bucket, name)) canMove = true;
      }
    }
    if (canMove) {
      if (!Object.prototype.hasOwnProperty.call(repaired, target)) setOwn(repaired, target, {});
      setOwn(repaired[target], name, emptyBucket[name]);
      movedAny = true;
    } else {
      setOwn(remaining, name, emptyBucket[name]);
    }
  }
  if (Object.keys(remaining).length !== 0) setOwn(repaired, '', remaining);

  if (!movedAny) return contracts;
  return repaired;
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

  ret.contracts = repairEmptyPathContracts(ret.contracts, ret.sources);

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

export = {
  versionToSemver,
  repairEmptyPathContracts,
  translateJsonCompilerOutput,
  prettyPrintLegacyAssemblyJSON
};
