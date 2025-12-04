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
  t.test('Broken nightly with leading zeroes', function (st) {
    st.equal(versionToSemver('0.3.6-nightly.2016.08.27+commit.91d4fa47.Emscripten.clang'), '0.3.6-nightly.2016.8.27+commit.91d4fa47.Emscripten.clang');
    st.equal(versionToSemver('0.4.1-nightly.2016.09.09+commit.79867f49.Emscripten.clang'), '0.4.1-nightly.2016.9.9+commit.79867f49.Emscripten.clang');
    st.equal(versionToSemver('0.4.1-nightly.2016.12.06+commit.79867f49.Emscripten.clang'), '0.4.1-nightly.2016.12.6+commit.79867f49.Emscripten.clang');
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
  t.test('Broken 0.3.4 nightly', function (st) {
    st.equal(versionToSemver('0.3.4-0/Release-Emscripten/clang/Interpreter'), '0.3.4-nightly');
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
