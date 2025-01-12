import fs from 'fs';
import path from 'path';

import YTDlpWrap from './yt-dlp-wrap.js';
import { uuid } from './utils.js';

const ytDlpWrap = new YTDlpWrap();

function getMedia(src, tempFolder, formats, targetFileSize = null, attempt = 0) {
  const format = formats[attempt];
  console.log(`Try downloading video  ${src} as: ${format}`);
  let filepath;
  do {
    const extension = (format.includes('video') || format.includes('best[') || format.includes('b[') || format.includes('bc') || format.includes('wv') || format === 'best')
      ? '.mp4' : '.m4a';
    const filename = uuid() + extension;
    filepath = path.resolve(tempFolder, filename);
  } while (fs.existsSync(filepath));
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let killed = false;
    ytDlpWrap
    .exec([
        src,
        '-f',
        format,
        '-o',
        filepath,
    ], {}, controller.signal)
    .on('ytDlpEvent', (eventType, eventData) => {
        if (killed || !targetFileSize || eventType !== 'download') {
          return;
        }
        const stats = eventData.match(/([0-9]+\.[0-9]+)([KMG]iB)/);
        if (stats?.length !== 3) {
          return;
        }

        let multiplier = 1;
        switch (stats[2]) {
          case 'KiB':
            multiplier /= 1024;
            break;
          case 'TiB':
            multiplier *= 1024;
          case 'GiB':
            multiplier *= 1024;
            break;
        }
        const fileSize = parseInt(stats[1]) * multiplier;
        if (fileSize > targetFileSize) {
          if (attempt + 1 < formats.length) {
            console.log('File too large');
            killed = true;
            controller.abort();
          }
        }
      })
    .on('error', (err) => {
        if (err.message.includes('Requested format is not available.')) {
          attempt += 1;
          if (attempt < formats.length) {
            console.log('Format not available.');
            getMedia(src, tempFolder, formats, targetFileSize, attempt)
              .then(resolve)
              .catch(reject);
            return;
          }
        }
        reject(err);
      })
    .on('close', () => {
        if (killed) {
          attempt += 1;
          if (attempt < formats.length) {
            getMedia(src, tempFolder, formats, targetFileSize, attempt)
              .then(resolve)
              .catch(reject);
            return;
          }
        }
        resolve(`file://${filepath}`);
      });
  });
}

export default getMedia;


