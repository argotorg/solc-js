import tape from 'tape';
import spawn from 'tape-spawn';
import * as path from 'path';
import solc from '../';

tape('CLI', function (t) {
  t.test('--version', function (st) {
    const spt = spawn(st, './solc.js --version');
    spt.stdout.match(solc.version() + '\n');
    spt.stdout.match(/^\s*[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?\+commit\.[0-9a-f]+([a-zA-Z0-9.-]+)?\s*$/);
    spt.stderr.empty();
    spt.end();
  });

  t.test('no parameters', function (st) {
    const spt = spawn(st, './solc.js');
    spt.stderr.match(/^Must provide a file/);
    spt.end();
  });

  t.test('no mode specified', function (st) {
    const spt = spawn(st, './solc.js test/resources/fixtureSmoke.sol');
    spt.stderr.match(/^Invalid option selected/);
    spt.end();
  });

  t.test('--bin', function (st) {
    const spt = spawn(st, './solc.js --bin test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --optimize', function (st) {
    const spt = spawn(st, './solc.js --bin --optimize test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --optimize-runs 666', function (st) {
    const spt = spawn(st, './solc.js --bin --optimize-runs 666 test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --optimize-runs not-a-number', function (st) {
    const spt = spawn(st, './solc.js --bin --optimize-runs not-a-number test/resources/fixtureSmoke.sol');
    spt.stderr.match(/^error: option '--optimize-runs <optimize-runs>' argument 'not-a-number' is invalid/);
    spt.end();
  });

  t.test('invalid file specified', function (st) {
    const spt = spawn(st, './solc.js --bin test/fileNotFound.sol');
    spt.stderr.match(/^Error reading /);
    spt.end();
  });

  t.test('incorrect source source', function (st) {
    const spt = spawn(st, './solc.js --bin test/resources/fixtureIncorrectSource.sol');
    spt.stderr.match(/SyntaxError: Invalid pragma "contract"/);
    spt.end();
  });

  t.test('--abi', function (st) {
    const spt = spawn(st, './solc.js --abi test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --abi', function (st) {
    const spt = spawn(st, './solc.js --bin --abi test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('no base path', function (st) {
    const spt = spawn(
      st,
      './solc.js --bin ' +
        'test/resources/importA.sol ' +
        './test/resources//importA.sol ' +
        path.resolve('test/resources/importA.sol')
    );
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('relative base path', function (st) {
    // NOTE: This and other base path tests rely on the relative ./importB.sol import in importA.sol.
    // If base path is not stripped correctly from all source paths below, they will not be found
    // by the import callback when it appends the base path back.
    const spt = spawn(
      st,
      './solc.js --bin --base-path test/resources ' +
        'test/resources/importA.sol ' +
        './test/resources//importA.sol ' +
        path.resolve('test/resources/importA.sol')
    );
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('relative non canonical base path', function (st) {
    const spt = spawn(
      st,
      './solc.js --bin --base-path ./test/resources ' +
        'test/resources/importA.sol ' +
        './test/resources//importA.sol ' +
        path.resolve('test/resources/importA.sol')
    );
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('absolute base path', function (st) {
    const spt = spawn(
      st,
      './solc.js --bin --base-path ' + path.resolve('test/resources') + ' ' +
        'test/resources/importA.sol ' +
        './test/resources//importA.sol ' +
        path.resolve('test/resources/importA.sol')
    );
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('include paths', function (st) {
    const spt = spawn(
      st,
      './solc.js --bin ' +
        'test/resources/importCallback/base/contractB.sol ' +
        'test/resources/importCallback/includeA/libY.sol ' +
        './test/resources/importCallback/includeA//libY.sol ' +
        path.resolve('test/resources/importCallback/includeA/libY.sol') + ' ' +
        '--base-path test/resources/importCallback/base ' +
        '--include-path test/resources/importCallback/includeA ' +
        '--include-path ' + path.resolve('test/resources/importCallback/includeB/')
    );
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('include paths without base path', function (st) {
    const spt = spawn(
      st,
      './solc.js --bin ' +
        'test/resources/importCallback/contractC.sol ' +
        '--include-path test/resources/importCallback/includeA'
    );
    spt.stderr.match(/--include-path option requires a non-empty base path\./);
    spt.fails();
    spt.end();
  });

  t.test('empty include paths', function (st) {
    const spt = spawn(
      st,
      './solc.js --bin ' +
        'test/resources/importCallback/contractC.sol ' +
        '--base-path test/resources/importCallback/base ' +
        '--include-path='
    );
    spt.stderr.match(/Empty values are not allowed in --include-path\./);
    spt.fails();
    spt.end();
  });

  t.test('standard json', function (st) {
    const input = {
      language: 'Solidity',
      settings: {
        outputSelection: {
          '*': {
            '*': ['evm.bytecode', 'userdoc']
          }
        }
      },
      sources: {
        'Contract.sol': {
          content: 'pragma solidity >=0.5.0; contract Contract { function f() pure public {} }'
        }
      }
    };
    const spt = spawn(st, './solc.js --standard-json');
    spt.stdin.setEncoding('utf-8');
    spt.stdin.write(JSON.stringify(input));
    spt.stdin.end();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      spt.stdout.match(/Contract.sol/);
      spt.stdout.match(/userdoc/);
      spt.succeeds();
      spt.end();
    });
  });

  t.test('standard json with input arriving on stdin in small chunks', function (st) {
    // NOTE: Regression test for #460. A single write of the whole input arrives atomically and
    // would not reproduce the bug; writing one byte at a time forces the race that triggers it.
    const input = {
      language: 'Solidity',
      settings: {
        outputSelection: {
          '*': {
            '*': ['evm.bytecode', 'userdoc']
          }
        }
      },
      sources: {
        'Contract.sol': {
          content: 'pragma solidity >=0.5.0; contract Contract { function f() pure public {} }'
        }
      }
    };
    const data = JSON.stringify(input);
    const spt = spawn(st, './solc.js --standard-json');
    spt.stdin.setEncoding('utf-8');
    let i = 0;
    const writeNextChunk = function () {
      if (i >= data.length) {
        spt.stdin.end();
        return;
      }
      spt.stdin.write(data[i]);
      i++;
      setImmediate(writeNextChunk);
    };
    writeNextChunk();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      spt.stdout.match(/Contract.sol/);
      spt.stdout.match(/userdoc/);
      spt.succeeds();
      spt.end();
    });
  });

  t.test('standard json base path', function (st) {
    const input = {
      language: 'Solidity',
      settings: {
        outputSelection: {
          '*': {
            '*': ['metadata']
          }
        }
      },
      sources: {
        'importA.sol': {
          content: 'import "./importB.sol";'
        }
      }
    };
    const spt = spawn(st, './solc.js --standard-json --base-path test/resources');
    spt.stdin.setEncoding('utf-8');
    spt.stdin.write(JSON.stringify(input));
    spt.stdin.end();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      spt.stdout.match(/{"contracts":{"importB.sol":{"D":{"metadata":/);
      spt.succeeds();
      spt.end();
    });
  });

  t.test('standard json include paths', function (st) {
    const input = {
      language: 'Solidity',
      sources: {
        'contractB.sol': {
          content:
            '// SPDX-License-Identifier: GPL-3.0\n' +
            'pragma solidity >=0.0;\n' +
            'import "./contractA.sol";\n'
        }
      }
    };
    const spt = spawn(
      st,
      './solc.js --standard-json ' +
        '--base-path test/resources/importCallback/base ' +
        '--include-path test/resources/importCallback/includeA ' +
        '--include-path ' + path.resolve('test/resources/importCallback/includeB/')
    );
    spt.stdin.setEncoding('utf-8');
    spt.stdin.write(JSON.stringify(input));
    spt.stdin.end();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      spt.stdout.match(/"sources":{"contractA.sol":{"id":0},"contractB.sol":{"id":1},"libX.sol":{"id":2},"libY.sol":{"id":3},"libZ.sol":{"id":4},"utils.sol":{"id":5}}}/);
      spt.succeeds();
      spt.end();
    });
  });
});
