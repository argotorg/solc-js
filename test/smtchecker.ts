import tape from 'tape';
import * as semver from 'semver';
import solc from '../';
import smtchecker from '../smtchecker';
import smtsolver from '../smtsolver';

const preamble = 'pragma solidity >=0.0;\n// SPDX-License-Identifier: GPL-3.0\n';
//
tape('SMTChecker', function (t) {
  // We use null for `solverFunction` and `solver` when calling `handleSMTQueries`
  // because these tests do not call a solver.

  t.test('smoke test with no axuiliaryInputRequested', function (st) {
    const input = {};
    const output = {};
    st.equal(smtchecker.handleSMTQueries(input, output, null, null), null);
    st.end();
  });

  t.test('smoke test with no smtlib2queries', function (st) {
    const input = {};
    const output = { auxiliaryInputRequested: {} };
    st.equal(smtchecker.handleSMTQueries(input, output, null, null), null);
    st.end();
  });

  t.test('smoke test with empty smtlib2queries', function (st) {
    const input = {};
    const output = { auxiliaryInputRequested: { smtlib2queries: { } } };
    st.equal(smtchecker.handleSMTQueries(input, output, null, null), null);
    st.end();
  });

  t.test('smtCallback should return type function', (st) => {
    const response = smtchecker.smtCallback(() => {});
    st.equal(typeof response, 'function');
    st.end();
  });

  t.test('smtCallback should error when passed parser fails', (st) => {
    const cbFun = smtchecker.smtCallback((content) => { throw new Error(content); });
    const response = cbFun('expected-error-message');

    st.deepEqual(response, { error: new Error('expected-error-message') });
    st.end();
  });

  t.test('smtCallback should return content when passed parser does not fail', (st) => {
    const cbFun = smtchecker.smtCallback((content) => { return content; });
    const response = cbFun('expected-content-message');

    st.deepEqual(response, { contents: 'expected-content-message' });
    st.end();
  });
});

tape('SMTCheckerWithSolver', function (t) {
  // In these tests we require z3 to actually run the solver.
  // This uses the SMT double-run mechanism instead of the callback.

  t.test('Simple test with axuiliaryInputRequested', function (st) {
    const z3 = smtsolver.availableSolvers.filter(solver => solver.command === 'z3');
    if (z3.length === 0) {
      st.skip('Test requires z3.');
      st.end();
      return;
    }

    if (semver.lt(solc.semver(), '0.8.7')) {
      st.skip('This test requires Solidity 0.8.7 to enable all SMTChecker options.');
      st.end();
      return;
    }

    const settings = {
      modelChecker: {
        engine: 'chc',
        solvers: ['smtlib2']
      }
    };

    const source = { a: { content: preamble + '\ncontract C { function f(uint x) public pure { assert(x > 0); } }' } };

    const input = {
      language: 'Solidity',
      sources: source,
      settings: settings
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    st.ok(output);

    const newInput = smtchecker.handleSMTQueries(input, output, smtsolver.smtSolver, z3[0]);
    st.notEqual(newInput, null);

    const newOutput = JSON.parse(solc.compile(JSON.stringify(newInput)));
    st.ok(newOutput);

    const smtErrors = newOutput.errors.filter(e => e.errorCode === '6328');
    st.equal(smtErrors.length, 1);

    st.end();
  });
});
