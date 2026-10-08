import * as tmp from 'tmp';
import tape from 'tape';
import nock from 'nock';
import fs from 'fs';
import path from 'path';
import { https } from 'follow-redirects';
import downloader from '../downloader';
import { keccak256 } from 'js-sha3';
import { hashFile } from '../common/helpers';

const assets = path.resolve(__dirname, 'resources/assets');

tape.onFinish(() => {
  if (!nock.isDone()) {
    throw Error('Expected download requests were not performed');
  }
});

function generateTestFile (t: tape.Test, content: string): tmp.FileResult {
  // As the `keep` option is set to true the removeCallback must be called by the caller
  // to cleanup the files after the test.
  const file = tmp.fileSync({ template: 'soljson-XXXXXX.js', keep: true });
  try {
    fs.writeFileSync(file.name, content);
  } catch (err) {
    t.fail(`Error writing test file: ${err.message}`);
  }

  return file;
}

function versionListMock (host: string): nock.Interceptor {
  return nock(host).get('/bin/list.json');
}

function downloadBinaryMock (host: string, filename: string): nock.Interceptor {
  return nock(host).get(`/bin/${path.basename(filename)}`);
}

function defaultListener (req: any, res: any): void {
  res.writeHead(200);
  res.end('OK');
};

async function startMockServer (listener = defaultListener): Promise<any> {
  const server = https.createServer({
    key: fs.readFileSync(path.resolve(assets, 'key.pem')),
    cert: fs.readFileSync(path.resolve(assets, 'cert.pem'))
  }, listener);

  await new Promise(resolve => server.listen(resolve));
  server.port = server.address().port;
  server.origin = `https://localhost:${server.port}`;
  return server;
}

tape('Download version list', async function (t) {
  const server = await startMockServer();

  t.teardown(function () {
    server.close();
    nock.cleanAll();
  });

  t.test('successfully get version list', async function (st) {
    const dummyListPath = path.resolve(assets, 'dummy-list.json');
    versionListMock(server.origin).replyWithFile(200, dummyListPath, {
      'Content-Type': 'application/json'
    });

    try {
      const list = JSON.parse(
        await downloader.getVersionList(server.origin)
      );
      const expected = require(dummyListPath);
      st.deepEqual(list, expected, 'list should match');
      st.equal(list.latestRelease, expected.latestRelease, 'latest release should be equal');
    } catch (err) {
      st.fail(err.message);
    }
    st.end();
  });

  t.test('should throw an exception when version list not found', async function (st) {
    versionListMock(server.origin).reply(404);

    try {
      await downloader.getVersionList(server.origin);
      st.fail('should throw file not found error');
    } catch (err) {
      st.equal(err.message, 'Error downloading file: 404', 'should throw file not found error');
    }
    st.end();
  });
});

tape('Download binary', async function (t) {
  const server = await startMockServer();
  const content = '() => {}';
  const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: 'solcjs-download-test-' }).name;

  t.teardown(function () {
    server.close();
    nock.cleanAll();
  });

  t.test('successfully download binary', async function (st) {
    const targetFilename = `${tmpDir}/target-success.js`;
    const file = generateTestFile(st, content);

    st.teardown(function () {
      file.removeCallback();
    });

    downloadBinaryMock(server.origin, file.name)
      .replyWithFile(200, file.name, {
        'content-type': 'application/javascript',
        'content-length': content.length.toString()
      });

    try {
      await downloader.downloadBinary(
        server.origin,
        targetFilename,
        file.name,
        hashFile(file.name)
      );

      if (!fs.existsSync(targetFilename)) {
        st.fail('download failed');
      }

      const got = fs.readFileSync(targetFilename, { encoding: 'binary' });
      const expected = fs.readFileSync(file.name, { encoding: 'binary' });
      st.equal(got.length, expected.length, 'should download the correct file');
    } catch (err) {
      st.fail(err.message);
    }
    st.end();
  });

  t.test('should throw an exception when file not found', async function (st) {
    const targetFilename = `${tmpDir}/target-fail404.js`;
    downloadBinaryMock(server.origin, 'test.js').reply(404);

    try {
      await downloader.downloadBinary(
        server.origin,
        targetFilename,
        'test.js',
        `0x${keccak256('something')}`
      );
      st.fail('should throw file not found error');
    } catch (err) {
      st.equal(err.message, 'Error downloading file: 404', 'should throw file not found error');
    }
    st.end();
  });

  t.test('should throw an exception if hashes do not match', async function (st) {
    const targetFilename = `${tmpDir}/target-fail-hash.js`;
    const file = generateTestFile(st, content);

    st.teardown(function () {
      file.removeCallback();
    });

    downloadBinaryMock(server.origin, file.name)
      .replyWithFile(200, file.name, {
        'content-type': 'application/javascript',
        'content-length': content.length.toString()
      });

    try {
      await downloader.downloadBinary(
        server.origin,
        targetFilename,
        file.name,
        `0x${keccak256('something')}`
      );
      st.fail('should throw hash mismatch error');
    } catch (err) {
      st.match(err.message, /Hash mismatch/, 'should detect hash mismatch');
    }
    st.end();
  });
});
