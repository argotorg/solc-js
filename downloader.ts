import * as fs from 'fs';
import { https } from 'follow-redirects';
import MemoryStream from 'memorystream';
import { hashFile } from './common/helpers';

function getVersionList (host: string): Promise<string> {
  console.log('Retrieving available version list...');

  return new Promise<string>((resolve, reject) => {
    const mem = new MemoryStream(null, { readable: false });
    https.get(`${host}/bin/list.json`, function (response) {
      if (response.statusCode !== 200) {
        reject(new Error('Error downloading file: ' + response.statusCode));
      }
      response.pipe(mem);
      response.on('end', function () {
        resolve(mem.toString());
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function downloadBinary (host: string, outputName: string, releaseFile: string, expectedHash: string): Promise<void> {
  console.log('Downloading version', releaseFile);

  return new Promise<void>((resolve, reject) => {
    // Remove if existing
    if (fs.existsSync(outputName)) {
      fs.unlinkSync(outputName);
    }

    process.on('SIGINT', function () {
      fs.unlinkSync(outputName);
      reject(new Error('Interrupted... file removed'));
    });

    const file = fs.createWriteStream(outputName, { encoding: 'binary' });
    https.get(`${host}/bin/${releaseFile}`, function (response) {
      if (response.statusCode !== 200) {
        reject(new Error('Error downloading file: ' + response.statusCode));
      }
      response.pipe(file);
      file.on('finish', function () {
        file.close();
        const hash = hashFile(outputName);
        if (expectedHash !== hash) {
          reject(new Error('Hash mismatch: expected ' + expectedHash + ' but got ' + hash));
        } else {
          console.log('Done.');
          resolve();
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

export = {
  getVersionList,
  downloadBinary
};
