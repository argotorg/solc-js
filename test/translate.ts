import * as fs from 'fs';
import * as path from 'path';
import tape from 'tape';
import translate from '../translate';

const versionToSemver = translate.versionToSemver;

tape('Version string to Semver translator', function (t) {
  t.test('Only numbers', function (st) {
    st.equal(versionToSemver('0.1.0'), '0.1.0');
    st.end();
  });
  t.test('New style release (semver)', function (st) {
    st.equal(versionToSemver('0.4.5+commit.b318366e.Emscripten.clang'), '0.4.5+commit.b318366e.Emscripten.clang');
    st.end();
  });
  t.test('New style nightly (semver)', function (st) {
    st.equal(versionToSemver('0.4.20-nightly.2018.2.13+commit.27ef9794.Emscripten.clang'), '0.4.20-nightly.2018.2.13+commit.27ef9794.Emscripten.clang');
    st.end();
  });
  t.test('Old style 0.1.1', function (st) {
    st.equal(versionToSemver('0.1.1-6ff4cd6b/RelWithDebInfo-Emscripten/clang/int'), '0.1.1+commit.6ff4cd6b');
    st.end();
  });
  t.test('Old style 0.1.2', function (st) {
    st.equal(versionToSemver('0.1.2-5c3bfd4b*/.-/clang/int'), '0.1.2+commit.5c3bfd4b');
    st.end();
  });
  t.test('Broken 0.1.3', function (st) {
    st.equal(versionToSemver('0.1.3-0/.-/clang/int linked to libethereum-0.9.92-0/.-/clang/int'), '0.1.3');
    st.end();
  });
  t.test('Old style 0.2.0', function (st) {
    st.equal(
      versionToSemver('0.2.0-e7098958/.-Emscripten/clang/int linked to libethereum-1.1.1-bbb80ab0/.-Emscripten/clang/int'),
      '0.2.0+commit.e7098958'
    );
    st.end();
  });
  t.test('Old style 0.3.5', function (st) {
    // The one in the solc-bin list
    st.equal(versionToSemver('0.3.5-371690f0/Release-Emscripten/clang/Interpreter'), '0.3.5+commit.371690f0');
    // The actual one reported by the compiler
    st.equal(versionToSemver('0.3.5-0/Release-Emscripten/clang/Interpreter'), '0.3.5');
    st.end();
  });
  t.test('Old style 0.3.6', function (st) {
    st.equal(versionToSemver('0.3.6-3fc68da5/Release-Emscripten/clang'), '0.3.6+commit.3fc68da5');
    st.end();
  });
});

tape('prettyPrintLegacyAssemblyJSON', function (t) {
  t.test('Works properly', function (st) {
    const fixtureAsmJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'resources/fixtureAsmJson.json')).toString());
    const fixtureAsmJsonSource = fs.readFileSync(path.resolve(__dirname, 'resources/fixtureAsmJson.sol')).toString();
    const fixtureAsmJsonOutput = fs.readFileSync(path.resolve(__dirname, 'resources/fixtureAsmJson.output')).toString();
    st.equal(translate.prettyPrintLegacyAssemblyJSON(fixtureAsmJson, fixtureAsmJsonSource), fixtureAsmJsonOutput);
    st.end();
  });
});

tape('needsWildcardContractWorkaround', function (t) {
  t.test('false for missing or malformed selection', function (st) {
    st.notOk(translate.needsWildcardContractWorkaround(undefined));
    st.notOk(translate.needsWildcardContractWorkaround(null));
    st.notOk(translate.needsWildcardContractWorkaround({}));
    st.end();
  });
  t.test('false for wildcard contract only', function (st) {
    st.notOk(translate.needsWildcardContractWorkaround({ '*': { '*': ['evm.bytecode'] } }));
    st.end();
  });
  t.test('false for source level outputs only', function (st) {
    st.notOk(translate.needsWildcardContractWorkaround({ '*': { '': ['ast'] } }));
    st.end();
  });
  t.test('false for named source with named contract', function (st) {
    st.notOk(translate.needsWildcardContractWorkaround({ 'a.sol': { A: ['evm.bytecode'] } }));
    st.end();
  });
  t.test('true for wildcard source with named contract', function (st) {
    st.ok(translate.needsWildcardContractWorkaround({ '*': { A: ['evm.bytecode'] } }));
    st.end();
  });
});

tape('isWellFormedOutputSelection', function (t) {
  t.test('true for well formed selections', function (st) {
    st.ok(translate.isWellFormedOutputSelection({ '*': { '*': ['evm.bytecode'], '': ['ast'], A: ['abi'] }, 'a.sol': { B: [] } }));
    st.end();
  });
  t.test('false for null, string, object or non-string-array values', function (st) {
    st.notOk(translate.isWellFormedOutputSelection({ '*': { A: null } }));
    st.notOk(translate.isWellFormedOutputSelection({ '*': { A: 'evm.bytecode' } }));
    st.notOk(translate.isWellFormedOutputSelection({ '*': { A: { output: 'evm.bytecode' } } }));
    st.notOk(translate.isWellFormedOutputSelection({ '*': { A: ['evm.bytecode', 1] } }));
    st.notOk(translate.isWellFormedOutputSelection({ '*': ['evm.bytecode'] }));
    st.notOk(translate.isWellFormedOutputSelection(null));
    st.end();
  });
});

tape('expandWildcardSourceSelection', function (t) {
  t.test('named contracts are mirrored to every source and wildcard entry is kept', function (st) {
    const input = {
      settings: { outputSelection: { '*': { A: ['evm.bytecode'] } } },
      sources: { 'a.sol': { content: '' }, 'b.sol': { content: '' } }
    };
    const expanded = translate.expandWildcardSourceSelection(input);
    st.deepEqual(expanded.settings.outputSelection, {
      '*': { A: ['evm.bytecode'] },
      'a.sol': { A: ['evm.bytecode'] },
      'b.sol': { A: ['evm.bytecode'] }
    });
    st.end();
  });
  t.test('wildcard contract and source level selectors are not mirrored', function (st) {
    const input = {
      settings: { outputSelection: { '*': { '*': ['metadata'], '': ['ast'], A: ['evm.bytecode'] } } },
      sources: { 'a.sol': { content: '' } }
    };
    const expanded = translate.expandWildcardSourceSelection(input);
    st.deepEqual(expanded.settings.outputSelection, {
      '*': { '*': ['metadata'], '': ['ast'], A: ['evm.bytecode'] },
      'a.sol': { A: ['evm.bytecode'] }
    });
    st.end();
  });
  t.test('existing explicit entries are merged with unioned outputs', function (st) {
    const input = {
      settings: { outputSelection: { '*': { A: ['evm.bytecode'] }, 'a.sol': { A: ['abi'], B: ['abi'] } } },
      sources: { 'a.sol': { content: '' } }
    };
    const expanded = translate.expandWildcardSourceSelection(input);
    st.deepEqual(expanded.settings.outputSelection, {
      '*': { A: ['evm.bytecode'] },
      'a.sol': { A: ['abi', 'evm.bytecode'], B: ['abi'] }
    });
    st.end();
  });
  t.test('original input is not modified', function (st) {
    const input = {
      settings: { outputSelection: { '*': { A: ['evm.bytecode'] } } },
      sources: { 'a.sol': { content: '' } }
    };
    translate.expandWildcardSourceSelection(input);
    st.deepEqual(input.settings.outputSelection, { '*': { A: ['evm.bytecode'] } });
    st.end();
  });
});

tape('expandWildcardSourceSelection hardening', function (t) {
  t.test('contract names colliding with Object.prototype members are handled', function (st) {
    // Built via JSON.parse: in an object literal "__proto__" would set the
    // prototype instead of creating an own property.
    const input = JSON.parse('{"settings":{"outputSelection":{"*":{"toString":["abi"],"valueOf":["abi"],"hasOwnProperty":["abi"],"constructor":["abi"],"__proto__":["abi"]}}},"sources":{"a.sol":{"content":""}}}');
    const expanded = translate.expandWildcardSourceSelection(input);
    const selection = expanded.settings.outputSelection;
    st.ok(Object.prototype.hasOwnProperty.call(selection['a.sol'], 'toString'), 'toString present as own key');
    st.deepEqual(selection['a.sol'].toString, ['abi']);
    st.deepEqual(selection['a.sol'].valueOf, ['abi']);
    st.deepEqual(selection['a.sol'].hasOwnProperty, ['abi']);
    st.deepEqual(selection['a.sol'].constructor, ['abi']);
    st.deepEqual(Reflect.get(selection['a.sol'], '__proto__'), ['abi'], '__proto__ stored as own value, not prototype');
    st.end();
  });

  t.test('file name __proto__ is stored as own key without pollution', function (st) {
    const input = JSON.parse('{"settings":{"outputSelection":{"*":{"A":["abi"]}}},"sources":{"__proto__":{"content":""},"a.sol":{"content":""}}}');
    const expanded = translate.expandWildcardSourceSelection(input);
    const selection = expanded.settings.outputSelection;
    st.ok(Object.prototype.hasOwnProperty.call(selection, '__proto__'), '__proto__ file entry exists as own key');
    st.deepEqual(Reflect.get(selection, '__proto__'), { A: ['abi'] });
    st.notOk(Object.prototype.hasOwnProperty.call({}, 'A'), 'no prototype pollution on plain objects');
    st.end();
  });

  t.test('merging with an existing __proto__-named contract entry', function (st) {
    const input = JSON.parse('{"settings":{"outputSelection":{"*":{"__proto__":["evm.bytecode"]},"a.sol":{"__proto__":["abi"]}}},"sources":{"a.sol":{"content":""}}}');
    const expanded = translate.expandWildcardSourceSelection(input);
    st.deepEqual(Reflect.get(expanded.settings.outputSelection['a.sol'], '__proto__'), ['abi', 'evm.bytecode']);
    st.end();
  });

  t.test('serialization round trip preserves the expanded selection', function (st) {
    const input = {
      settings: { outputSelection: { '*': { toString: ['abi'] } } },
      sources: { 'a.sol': { content: '' } }
    };
    const expanded = translate.expandWildcardSourceSelection(input);
    st.deepEqual(JSON.parse(JSON.stringify(expanded)).settings.outputSelection, {
      '*': { toString: ['abi'] },
      'a.sol': { toString: ['abi'] }
    });
    st.end();
  });
});
