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

tape('Empty path contract repair (solc <0.4.9)', function (t) {
  function astFor (...names) {
    return {
      legacyAST: {
        name: 'SourceUnit',
        children: names.map(function (name) {
          return { name: 'ContractDefinition', attributes: { name: name } };
        })
      }
    };
  }

  t.test('Unique names move to their source paths', function (st) {
    const contracts = { '': { Alpha: { x: 1 }, Beta: { x: 2 } } };
    const sources = { 'a.sol': astFor('Alpha'), 'b.sol': astFor('Beta') };
    const repaired = translate.repairEmptyPathContracts(contracts, sources);
    st.deepEqual(Object.keys(repaired), ['a.sol', 'b.sol']);
    st.equal(repaired['a.sol'].Alpha, contracts[''].Alpha);
    st.equal(repaired['b.sol'].Beta, contracts[''].Beta);
    st.end();
  });

  t.test('No empty path bucket returns the input unchanged', function (st) {
    const contracts = { 'a.sol': { Alpha: { x: 1 } } };
    st.equal(translate.repairEmptyPathContracts(contracts, { 'a.sol': astFor('Alpha') }), contracts);
    st.end();
  });

  t.test('Ambiguous duplicate names stay under the empty path', function (st) {
    const contracts = { '': { Alpha: { x: 1 }, Dup: { x: 2 } } };
    const sources = { 'a.sol': astFor('Alpha', 'Dup'), 'b.sol': astFor('Dup') };
    const repaired = translate.repairEmptyPathContracts(contracts, sources);
    st.equal(repaired['a.sol'].Alpha, contracts[''].Alpha);
    st.equal(repaired[''].Dup, contracts[''].Dup);
    st.deepEqual(Object.keys(repaired['']), ['Dup']);
    st.end();
  });

  t.test('Undeclared names stay under the empty path', function (st) {
    const contracts = { '': { Mystery: { x: 1 } } };
    const repaired = translate.repairEmptyPathContracts(contracts, { 'a.sol': astFor('Alpha') });
    st.equal(repaired, contracts);
    st.end();
  });

  t.test('Missing or malformed AST is ignored', function (st) {
    const contracts = { '': { Alpha: { x: 1 } } };
    const sources = { 'a.sol': {}, 'b.sol': { legacyAST: null }, 'c.sol': { legacyAST: { name: 'root', children: [{ name: 'Contract:Alpha' }] } } };
    st.equal(translate.repairEmptyPathContracts(contracts, sources), contracts);
    st.end();
  });

  t.test('Non-object inputs return unchanged', function (st) {
    st.equal(translate.repairEmptyPathContracts(null, {}), null);
    const contracts = { '': null };
    st.equal(translate.repairEmptyPathContracts(contracts, {}), contracts);
    st.end();
  });

  t.test('Existing entries are never clobbered', function (st) {
    const contracts = { '': { Alpha: { x: 1 } }, 'a.sol': { Alpha: { x: 9 } } };
    const sources = { 'a.sol': astFor('Alpha') };
    const repaired = translate.repairEmptyPathContracts(contracts, sources);
    st.equal(repaired['a.sol'].Alpha.x, 9);
    st.equal(repaired[''].Alpha.x, 1);
    st.end();
  });

  t.test('Null, scalar or array target buckets are preserved unchanged', function (st) {
    const arr = [1, 2];
    const contracts = { '': { A: { x: 1 }, B: { x: 2 }, C: { x: 3 }, D: { x: 4 } }, 'a.sol': null, 'b.sol': 'scalar', 'c.sol': arr };
    const sources = { 'a.sol': astFor('A'), 'b.sol': astFor('B'), 'c.sol': astFor('C'), 'd.sol': astFor('D') };
    const repaired = translate.repairEmptyPathContracts(contracts, sources);
    st.equal(repaired['a.sol'], null, 'null bucket preserved');
    st.equal(repaired['b.sol'], 'scalar', 'scalar bucket preserved');
    st.equal(repaired['c.sol'], arr, 'array bucket preserved by reference');
    st.deepEqual(Object.keys(repaired['']), ['A', 'B', 'C'], 'blocked candidates stay under the empty path');
    st.equal(repaired[''].A, contracts[''].A);
    st.equal(repaired[''].B, contracts[''].B);
    st.equal(repaired[''].C, contracts[''].C);
    st.equal(repaired['d.sol'].D, contracts[''].D, 'unblocked candidate still moves');
    st.deepEqual(Object.keys(repaired).sort(), ['', 'a.sol', 'b.sol', 'c.sol', 'd.sol'], 'no entries lost');
    st.end();
  });

  t.test('Source named __proto__ becomes a plain own property', function (st) {
    const contracts = JSON.parse('{ "": { "Alpha": { "x": 1 } } }');
    const sources = JSON.parse('{ "__proto__": { "legacyAST": { "name": "SourceUnit", "children": [ { "name": "ContractDefinition", "attributes": { "name": "Alpha" } } ] } } }');
    const repaired = translate.repairEmptyPathContracts(contracts, sources);
    st.equal(Object.keys(repaired)[0], '__proto__');
    st.equal(repaired[Object.keys(repaired)[0]].Alpha.x, 1);
    st.equal(Object.getPrototypeOf(repaired), Object.prototype, 'repaired object keeps the ordinary prototype');
    st.equal(typeof repaired.hasOwnProperty, 'function');
    st.end();
  });
});
