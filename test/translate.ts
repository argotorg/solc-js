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

tape('Colon path repair in contracts output', function (t) {
  t.test('No colon in any contract name returns the input unchanged', function (st) {
    const contracts = { 'a.sol': { A: { x: 1 } }, 'b.sol': { B: { y: 2 } } };
    st.equal(translate.repairColonPathsInContracts(contracts, ['a.sol', 'b.sol']), contracts);
    st.end();
  });

  t.test('Mangled entry is repaired using the known source path', function (st) {
    const contracts = { C: { '\\project\\a.sol:A': { x: 1 } }, 'b.sol': { B: { y: 2 } } };
    const repaired = translate.repairColonPathsInContracts(contracts, ['C:\\project\\a.sol', 'b.sol']);
    st.deepEqual(Object.keys(repaired).sort(), ['C:\\project\\a.sol', 'b.sol']);
    st.deepEqual(Object.keys(repaired['C:\\project\\a.sol']), ['A']);
    st.equal(repaired['C:\\project\\a.sol'].A.x, 1);
    st.equal(repaired['b.sol'].B.y, 2);
    st.end();
  });

  t.test('Path containing multiple colons is repaired at the last colon', function (st) {
    const contracts = { a: { 'b:c.sol:G': { x: 1 } } };
    const repaired = translate.repairColonPathsInContracts(contracts, ['a:b:c.sol']);
    st.deepEqual(Object.keys(repaired), ['a:b:c.sol']);
    st.deepEqual(Object.keys(repaired['a:b:c.sol']), ['G']);
    st.end();
  });

  t.test('Path starting with a colon repairs to an empty outer key', function (st) {
    const contracts = { '': { 'a.sol:A': { x: 1 } } };
    const repaired = translate.repairColonPathsInContracts(contracts, [':a.sol']);
    st.deepEqual(Object.keys(repaired), [':a.sol']);
    st.deepEqual(Object.keys(repaired[':a.sol']), ['A']);
    st.end();
  });

  t.test('Mangled entry that resolves to no known source is left untouched', function (st) {
    const contracts = { C: { '\\project\\a.sol:A': { x: 1 } } };
    const repaired = translate.repairColonPathsInContracts(contracts, ['other.sol']);
    st.deepEqual(Object.keys(repaired), ['C']);
    st.deepEqual(Object.keys(repaired.C), ['\\project\\a.sol:A']);
    st.end();
  });

  t.test('Collision returns the original output unchanged (all-or-nothing)', function (st) {
    // A repaired entry landing on an occupied key must not overwrite or
    // drop data: refuse the whole repair instead.
    const contracts = { x: { 'a.sol:B': { first: true } }, 'x:a.sol': { B: { second: true } } };
    const repaired = translate.repairColonPathsInContracts(contracts, ['x:a.sol']);
    st.equal(repaired, contracts);
    st.equal(repaired.x['a.sol:B'].first, true);
    st.equal(repaired['x:a.sol'].B.second, true);
    st.end();
  });

  t.test('Non-object file bucket returns the input unchanged', function (st) {
    const contracts = { 'a.sol': null, C: { '\\p\\a.sol:A': { x: 1 } } };
    st.equal(translate.repairColonPathsInContracts(contracts, ['C:\\p\\a.sol']), contracts);
    st.end();
  });

  t.test('Source named __proto__ does not pollute the prototype', function (st) {
    // JSON.parse creates an own "__proto__" property; an object literal would not.
    const contracts = JSON.parse('{"__proto__": {"a.sol:A": {"x": 1}}}');
    const repaired = translate.repairColonPathsInContracts(contracts, ['__proto__:a.sol']);
    st.ok(Object.prototype['a.sol'] === undefined);
    st.deepEqual(Object.keys(repaired), ['__proto__:a.sol']);
    st.equal(Object.keys(repaired['__proto__:a.sol'])[0], 'A');
    st.end();
  });
});
