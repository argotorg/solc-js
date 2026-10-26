import tape from 'tape';
import spawn from 'tape-spawn';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import solc from '../';
import wrapper from '../wrapper';

// fs.cpSync is only available from Node 16.7 while the repo supports
// >=16.0.0, so copy directories with this small recursive helper instead.
function copyRecursive (source: string, destination: string): void {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination);
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
  } else {
    fs.copyFileSync(source, destination);
  }
}

// Validates the value of --use-soljson <path> (#665).
function validateUseSoljson (arg: string | undefined): string {
  if (arg === undefined || arg.startsWith('--')) {
    fs.writeSync(2, 'Error: --use-soljson requires a path to a soljson file\n');
    process.exit(1);
  }
  const resolved = path.resolve(arg);
  if (!fs.existsSync(resolved)) {
    fs.writeSync(2, 'Error: --use-soljson: no such file: ' + arg + '\n');
    process.exit(1);
  }
  return resolved;
}

const useSoljsonIndex = process.argv.indexOf('--use-soljson');
const useSoljson = useSoljsonIndex >= 0 ? validateUseSoljson(process.argv[useSoljsonIndex + 1]) : null;

// With --use-soljson <path> the CLI tests run against a specific soljson
// binary instead of the bundled one (#665). The CLI hard-requires the
// bundled ./soljson.js, so an isolated copy of the CLI is assembled in a
// temporary directory inside dist (keeping node_modules resolution and
// fixture paths unchanged) with the requested binary in place of soljson.js.
// The real dist/soljson.js is never modified.
let cliCommand = './solc.js';
let cliSolc = solc;
if (useSoljson !== null) {
  const isolatedDir = fs.mkdtempSync(path.join(process.cwd(), 'cli-soljson-test-'));
  // Register cleanup before any operation that can throw, so a setup
  // failure cannot leave the directory behind. SIGINT/SIGTERM are routed
  // through process.exit so the exit handler still runs; only a hard kill
  // (SIGKILL) can leave the temporary directory.
  process.on('exit', function () {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });
  process.on('SIGINT', function () { process.exit(130); });
  process.on('SIGTERM', function () { process.exit(143); });
  for (const file of fs.readdirSync(process.cwd())) {
    const fullPath = path.join(process.cwd(), file);
    if (file === 'soljson.js' || file === 'test' || file.startsWith('cli-soljson-test-')) continue;
    copyRecursive(fullPath, path.join(isolatedDir, file));
  }
  fs.copyFileSync(useSoljson, path.join(isolatedDir, 'soljson.js'));
  // --no-warnings hides the V8 "Invalid asm.js" process warnings emitted when
  // loading old asm.js binaries; CLI errors are printed normally and unaffected.
  // The path is quoted so a checkout location containing spaces still works.
  cliCommand = 'node --no-warnings "' + path.join(isolatedDir, 'solc.js') + '"';
  cliSolc = wrapper(require(useSoljson));
}

tape('CLI', function (t) {
  t.test('--version', function (st) {
    const spt = spawn(st, cliCommand + ' --version');
    spt.stdout.match(cliSolc.version() + '\n');
    spt.stdout.match(/^\s*[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?\+commit\.[0-9a-f]+([a-zA-Z0-9.-]+)?\s*$/);
    spt.stderr.empty();
    spt.end();
  });

  t.test('no parameters', function (st) {
    const spt = spawn(st, cliCommand + '');
    spt.stderr.match(/^Must provide a file/);
    spt.end();
  });

  t.test('no mode specified', function (st) {
    const spt = spawn(st, cliCommand + ' test/resources/fixtureSmoke.sol');
    spt.stderr.match(/^Invalid option selected/);
    spt.end();
  });

  t.test('--bin', function (st) {
    const spt = spawn(st, cliCommand + ' --bin test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --optimize', function (st) {
    const spt = spawn(st, cliCommand + ' --bin --optimize test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --optimize-runs 666', function (st) {
    const spt = spawn(st, cliCommand + ' --bin --optimize-runs 666 test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --optimize-runs not-a-number', function (st) {
    const spt = spawn(st, cliCommand + ' --bin --optimize-runs not-a-number test/resources/fixtureSmoke.sol');
    spt.stderr.match(/^error: option '--optimize-runs <optimize-runs>' argument 'not-a-number' is invalid/);
    spt.end();
  });

  t.test('invalid file specified', function (st) {
    const spt = spawn(st, cliCommand + ' --bin test/fileNotFound.sol');
    spt.stderr.match(/^Error reading /);
    spt.end();
  });

  t.test('incorrect source source', function (st) {
    const spt = spawn(st, cliCommand + ' --bin test/resources/fixtureIncorrectSource.sol');
    // solc <0.4.16 reports an unknown pragma instead of an invalid one,
    // with inconsistent severity formatting between releases.
    if (semver.lt(cliSolc.semver(), '0.4.16')) {
      spt.stderr.match(/Unknown pragma "contract"/);
    } else {
      spt.stderr.match(/SyntaxError: Invalid pragma "contract"/);
    }
    spt.end();
  });

  t.test('--abi', function (st) {
    const spt = spawn(st, cliCommand + ' --abi test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('--bin --abi', function (st) {
    const spt = spawn(st, cliCommand + ' --bin --abi test/resources/fixtureSmoke.sol');
    spt.stderr.empty();
    spt.succeeds();
    spt.end();
  });

  t.test('no base path', function (st) {
    const spt = spawn(
      st,
      cliCommand + ' --bin ' +
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
      cliCommand + ' --bin --base-path test/resources ' +
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
      cliCommand + ' --bin --base-path ./test/resources ' +
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
      cliCommand + ' --bin --base-path ' + path.resolve('test/resources') + ' ' +
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
      cliCommand + ' --bin ' +
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
      cliCommand + ' --bin ' +
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
      cliCommand + ' --bin ' +
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
          // Older compilers reject the >=0.5.0 pragma and pure functions,
          // so use a version-neutral contract when exercising them (#665).
          content: semver.lt(cliSolc.semver(), '0.5.0')
            ? 'contract Contract { function f() public {} }'
            : 'pragma solidity >=0.5.0; contract Contract { function f() pure public {} }'
        }
      }
    };
    const spt = spawn(st, cliCommand + ' --standard-json');
    spt.stdin.setEncoding('utf-8');
    spt.stdin.write(JSON.stringify(input));
    spt.stdin.end();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      spt.stdout.match(/Contract.sol/);
      // userdoc output exists only on solc 0.4.7 and later.
      if (semver.gte(cliSolc.semver(), '0.4.7')) {
        spt.stdout.match(/userdoc/);
      }
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
    const spt = spawn(st, cliCommand + ' --standard-json --base-path test/resources');
    spt.stdin.setEncoding('utf-8');
    spt.stdin.write(JSON.stringify(input));
    spt.stdin.end();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      if (useSoljson === null || semver.gte(cliSolc.semver(), '0.5.0')) {
        // Modern compilers produce this exact output shape.
        spt.stdout.match(/{"contracts":{"importB.sol":{"D":{"metadata":/);
      } else {
        // The import must resolve via the base path on every old version.
        spt.stdout.match(/"importB.sol"/);
        // Per-file contract keys and the metadata field only exist from
        // 0.4.11 on, and those compilers also emit an (empty) evm object
        // next to the selected metadata field, so match the fields rather
        // than their exact order.
        if (semver.gte(cliSolc.semver(), '0.4.11')) {
          spt.stdout.match(/"contracts":\{"importB.sol":\{"D":\{/);
          spt.stdout.match(/"metadata":/);
        }
      }
      spt.succeeds();
      spt.end();
    });
  });

  t.test('standard json include paths', function (st) {
    // Deep import chains via include paths hit an internal compiler error on
    // old compilers (observed on 0.4.0), and the modern sources-id output
    // shape does not exist before 0.4.11.
    if (useSoljson !== null && semver.lt(cliSolc.semver(), '0.4.11')) {
      st.skip('Not supported by this solc version');
      st.end();
      return;
    }
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
      cliCommand + ' --standard-json ' +
        '--base-path test/resources/importCallback/base ' +
        '--include-path test/resources/importCallback/includeA ' +
        '--include-path ' + path.resolve('test/resources/importCallback/includeB/')
    );
    spt.stdin.setEncoding('utf-8');
    spt.stdin.write(JSON.stringify(input));
    spt.stdin.end();
    spt.stdin.on('finish', function () {
      spt.stderr.empty();
      if (useSoljson === null || semver.gte(cliSolc.semver(), '0.5.0')) {
        spt.stdout.match(/"sources":{"contractA.sol":{"id":0},"contractB.sol":{"id":1},"libX.sol":{"id":2},"libY.sol":{"id":3},"libZ.sol":{"id":4},"utils.sol":{"id":5}}}/);
      } else {
        // Old compilers attach the legacyAST to each sources entry, so match
        // the id mapping per file rather than the exact serialized shape.
        spt.stdout.match(/"contractA.sol":\{"id":0/);
        spt.stdout.match(/"contractB.sol":\{"id":1/);
        spt.stdout.match(/"libX.sol":\{"id":2/);
        spt.stdout.match(/"libY.sol":\{"id":3/);
        spt.stdout.match(/"libZ.sol":\{"id":4/);
        spt.stdout.match(/"utils.sol":\{"id":5/);
      }
      spt.succeeds();
      spt.end();
    });
  });

  t.test('--use-soljson without a path', function (st) {
    const spt = spawn(st, 'node test/cli.js --use-soljson');
    spt.exitCode(1);
    spt.stderr.match(/^Error: --use-soljson requires a path to a soljson file/);
    spt.end();
  });

  t.test('--use-soljson with a file that does not exist', function (st) {
    const spt = spawn(st, 'node test/cli.js --use-soljson ./test/resources/does-not-exist.js');
    spt.exitCode(1);
    spt.stderr.match(/^Error: --use-soljson: no such file/);
    spt.end();
  });
});
