import tape from 'tape';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import solc from '../';
import { https } from 'follow-redirects';

// Tests for the optional retry behavior of loadRemoteVersion
// (https://github.com/argotorg/solc-js/issues/469). The shared
// follow-redirects https.get is stubbed so the tests are deterministic and
// offline; st.teardown restores the original even when a test fails.
tape('loadRemoteVersion retries', function (t) {
  const realGet = https.get;
  const soljson = fs.readFileSync(path.join(process.cwd(), 'soljson.js'));

  // Replaces https.get with a fake driving the given outcome sequence.
  // An outcome is a status code (a response with that status is produced;
  // 200 serves the bundled soljson), or a function (request, respond)
  // for scripted behavior. attempts records the number of calls and any
  // drained responses.
  function stubGet (st, outcomes, attempts) {
    st.teardown(function () { (https as any).get = realGet; });
    (https as any).get = function (url, cb) {
      const outcome = outcomes[Math.min(attempts.count, outcomes.length - 1)];
      attempts.count++;
      const request = new EventEmitter();
      if (typeof outcome === 'function') {
        outcome(request, cb);
      } else if (outcome === 'error') {
        process.nextTick(function () { request.emit('error', new Error('socket hang up')); });
      } else {
        const response = Readable.from(outcome === 'garbage' ? Buffer.from('this is not javascript') : soljson) as any;
        response.statusCode = outcome === 'garbage' ? 200 : outcome;
        response.statusMessage = outcome === 200 || outcome === 'garbage' ? 'OK' : 'Not Found';
        if (response.statusCode !== 200) {
          // Track drains; 200 responses must keep the original resume
          // because pipe() drives the stream through it.
          response.resume = function () { attempts.drained++; };
        }
        process.nextTick(function () { cb(response); });
      }
      return request;
    };
  }

  t.test('makes a single attempt by default', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, [500], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', function (err) {
      st.ok(err, 'error returned');
      st.equal(attempts.count, 1, 'exactly one attempt');
      st.end();
    });
  });

  t.test('does not retry without the option', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, [500, 200], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 0, retryDelay: 1 }, function (err) {
      st.ok(err, 'error returned');
      st.equal(attempts.count, 1, 'exactly one attempt');
      st.end();
    });
  });

  t.test('retries failed attempts and succeeds', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, [500, 500, 200], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 2, retryDelay: 1 }, function (err, solcSnapshot) {
      st.error(err, 'no error');
      st.equal(attempts.count, 3, 'three attempts');
      st.equal(attempts.drained, 2, 'failed responses drained');
      st.equal(solcSnapshot && solcSnapshot.version(), (solc as any).version(), 'working compiler returned');
      st.end();
    });
  });

  t.test('gives up after the retries are exhausted with the last error', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, [500], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 2, retryDelay: 1 }, function (err) {
      st.ok(err, 'error returned');
      st.equal(attempts.count, 3, 'three attempts');
      st.end();
    });
  });

  t.test('retries network errors too', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, ['error', 200], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 1, retryDelay: 1 }, function (err, solcSnapshot) {
      st.error(err, 'no error');
      st.equal(attempts.count, 2, 'two attempts');
      st.ok(solcSnapshot, 'compiler returned');
      st.end();
    });
  });

  t.test('retries a response that fails mid-body', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, [function (request, cb) {
      const response = Readable.from(soljson) as any;
      response.statusCode = 200;
      response.statusMessage = 'OK';
      process.nextTick(function () {
        cb(response);
        response.emit('error', new Error('connection reset'));
      });
    }, 200], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 1, retryDelay: 1 }, function (err, solcSnapshot) {
      st.error(err, 'no error');
      st.equal(attempts.count, 2, 'two attempts');
      st.ok(solcSnapshot, 'compiler returned');
      st.end();
    });
  });

  t.test('retries a downloaded file that cannot be compiled', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, ['garbage', 200], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 1, retryDelay: 1 }, function (err, solcSnapshot) {
      st.error(err, 'no error');
      st.equal(attempts.count, 2, 'two attempts');
      st.ok(solcSnapshot, 'compiler returned');
      st.end();
    });
  });

  t.test('reports the compile failure after the last attempt', function (st) {
    const attempts = { count: 0, drained: 0 };
    stubGet(st, ['garbage'], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 1, retryDelay: 1 }, function (err) {
      st.ok(err, 'error returned');
      st.ok(/Error compiling downloaded binary/.test(err.message), 'compile error reported');
      st.equal(attempts.count, 2, 'two attempts');
      st.end();
    });
  });

  t.test('calls the callback exactly once when an error follows a completed response', function (st) {
    const attempts = { count: 0, drained: 0 };
    let callbackCount = 0;
    stubGet(st, [function (request, cb) {
      const response = Readable.from(soljson) as any;
      response.statusCode = 200;
      response.statusMessage = 'OK';
      process.nextTick(function () {
        cb(response);
        response.on('end', function () {
          request.emit('error', new Error('late socket error'));
        });
      });
    }], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 3, retryDelay: 1 }, function (err, solcSnapshot) {
      callbackCount++;
      st.error(err, 'no error');
      st.ok(solcSnapshot, 'compiler returned');
      setTimeout(function () {
        st.equal(callbackCount, 1, 'callback invoked exactly once');
        st.equal(attempts.count, 1, 'late error did not trigger a retry');
        st.end();
      }, 20);
    });
  });

  t.test('rejects invalid options', function (st) {
    const badRetries = [-1, 1.5, NaN, Infinity, 1e20, Math.pow(2, 53), 'abc'];
    for (const retries of badRetries) {
      st.throws(function () {
        (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: retries }, function () {});
      }, /TypeError/, 'retries ' + String(retries) + ' rejected');
    }
    const badDelays = [-1, NaN, Infinity, 0x80000000, 'abc'];
    for (const retryDelay of badDelays) {
      st.throws(function () {
        (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 1, retryDelay: retryDelay }, function () {});
      }, /TypeError/, 'retryDelay ' + String(retryDelay) + ' rejected');
    }
    st.throws(function () {
      (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', 5, function () {});
    }, /TypeError/, 'non-object options rejected');
    st.throws(function () {
      (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247');
    }, /TypeError/, 'missing callback rejected');
    st.end();
  });

  t.test('handles a late error on a drained non-200 response', function (st) {
    const attempts = { count: 0, drained: 0 };
    let emitLateError: any;
    stubGet(st, [function (request, cb) {
      const response: any = new EventEmitter();
      response.statusCode = 500;
      response.statusMessage = 'Internal Server Error';
      response.resume = function () { attempts.drained++; };
      process.nextTick(function () {
        cb(response);
        emitLateError = function () {
          try {
            response.emit('error', new Error('late response error'));
            return false;
          } catch (e) {
            // EventEmitter rethrows an 'error' event nothing listens to.
            return true;
          }
        };
      });
    }], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 0, retryDelay: 1 }, function (err) {
      st.ok(err && /Internal Server Error/.test(err.message), 'non-200 error reported');
      st.equal(attempts.drained, 1, 'response drained');
      setTimeout(function () {
        st.notOk(emitLateError(), 'late error handled, nothing thrown');
        st.end();
      }, 10);
    });
  });

  t.test('does not compile the buffered body of an aborted response', function (st) {
    const attempts = { count: 0, drained: 0 };
    st.teardown(function () { delete (globalThis as any).__solc469Discarded; });
    stubGet(st, [function (request, cb) {
      const response: any = new EventEmitter();
      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.pipe = function (dest) {
        dest.write(Buffer.from('globalThis.__solc469Discarded = true;'));
        dest.end();
      };
      process.nextTick(function () {
        cb(response);
        response.emit('aborted');
        // A stream can still end after being aborted; the buffered
        // partial body must not be compiled for the settled attempt.
        response.emit('end');
      });
    }], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 0, retryDelay: 1 }, function (err) {
      st.ok(err && /response aborted/.test(err.message), 'abort reported');
      st.equal(attempts.count, 1, 'single attempt');
      setTimeout(function () {
        st.notOk((globalThis as any).__solc469Discarded, 'discarded body never compiled');
        st.end();
      }, 10);
    });
  });

  t.test('does not swallow an exception thrown by the callback', function (st) {
    const attempts = { count: 0, drained: 0 };
    let driveEnd: any;
    stubGet(st, [function (request, cb) {
      const response: any = new EventEmitter();
      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.pipe = function (dest) {
        dest.write(soljson);
        dest.end();
      };
      process.nextTick(function () {
        cb(response);
        driveEnd = function () { response.emit('end'); };
      });
    }], attempts);
    (solc as any).loadRemoteVersion('v0.8.38+commit.1835d247', { retries: 0, retryDelay: 1 }, function () {
      throw new Error('user callback boom');
    });
    setTimeout(function () {
      st.equal(attempts.count, 1, 'single attempt');
      st.throws(function () { driveEnd(); }, /user callback boom/, 'the original exception propagates');
      st.end();
    }, 10);
  });
});
