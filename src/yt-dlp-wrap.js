/*
 * taken from https://github.com/foxesdocode/yt-dlp-wrap
 * and some minor bug fixed, because the original is unmaintained.
 *
 * License: MIT
  */

import { EventEmitter } from 'events';
import { execFile, execSync, spawn, } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import { Readable } from 'stream';

const executableName = 'yt-dlp';
const progressRegex = /\[download\] *(.*) of *([^ ]*)(:? *at *([^ ]*))?(:? *ETA *([^ ]*))?/;

export default class YTDlpWrap {
  binaryPath;

  constructor(binaryPath = executableName) {
    this.binaryPath = binaryPath;
  }

  getBinaryPath() {
    return this.binaryPath;
  }

  setBinaryPath(binaryPath) {
    this.binaryPath = binaryPath;
  }

  static createGetMessage(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (httpResponse) => {
        httpResponse.on('error', (e) => reject(e));
        resolve(httpResponse);
      });
    });
  }

  static processMessageToFile(message, filePath) {
    const file = fs.createWriteStream(filePath);
    return new Promise((resolve, reject) => {
      message.pipe(file);
      message.on('error', (e) => reject(e));
      file.on('finish', () => message.statusCode == 200 ? resolve(message) : reject(message));
    });
  }

  static async downloadFile(fileURL, filePath) {
    let currentUrl = fileURL;
    while (currentUrl) {
      const message = await YTDlpWrap.createGetMessage(currentUrl);
      if (message.headers.location) {
        currentUrl = message.headers.location;
      }
      else {
        return await YTDlpWrap.processMessageToFile(message, filePath);
      }
    }
  }

  static getGithubReleases(page = 1, perPage = 1) {
    return new Promise((resolve, reject) => {
      const apiURL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases?page=' +
        page +
        '&per_page=' +
        perPage;
      https.get(apiURL, { headers: { 'User-Agent': 'node' } }, (response) => {
        let resonseString = '';
        response.setEncoding('utf8');
        response.on('data', (body) => (resonseString += body));
        response.on('error', (e) => reject(e));
        response.on('end', () => response.statusCode == 200
          ? resolve(JSON.parse(resonseString))
          : reject(response));
      });
    });
  }

  static async downloadFromGithub(filePath, version, platform = os.platform()) {
    const isWin32 = platform == 'win32';
    const fileName = `${executableName}${isWin32 ? '.exe' : ''}`;
    if (!version) {
      version = (await YTDlpWrap.getGithubReleases(1, 1))[0].tag_name;
    }
    if (!filePath) {
      filePath = './' + fileName;
    }
    let fileURL = 'https://github.com/yt-dlp/yt-dlp/releases/download/' +
      version +
      '/' +
      fileName;
    await YTDlpWrap.downloadFile(fileURL, filePath);
    !isWin32 && fs.chmodSync(filePath, '777');
  }

  exec(ytDlpArguments = [], options = {}, abortSignal = null) {
    options = YTDlpWrap.setDefaultOptions(options);
    const execEventEmitter = new EventEmitter();
    const ytDlpProcess = spawn(this.binaryPath, ytDlpArguments, options);
    execEventEmitter.ytDlpProcess = ytDlpProcess;
    YTDlpWrap.bindAbortSignal(abortSignal, ytDlpProcess);
    let stderrData = '';
    let processError;
    ytDlpProcess.stdout.on('data', (data) => YTDlpWrap.emitYoutubeDlEvents(data.toString(), execEventEmitter));
    ytDlpProcess.stderr.on('data', (data) => (stderrData += data.toString()));
    ytDlpProcess.on('error', (error) => (processError = error));
    ytDlpProcess.on('close', (code) => {
      if (code === 0 || ytDlpProcess.killed) {
        execEventEmitter.emit('close', code);
      } else {
        execEventEmitter.emit('error', YTDlpWrap.createError(code, processError, stderrData));
      }
    });
    return execEventEmitter;
  }

  execPromise(ytDlpArguments = [], options = {}, abortSignal = null) {
    let ytDlpProcess;
    const ytDlpPromise = new Promise((resolve, reject) => {
      options = YTDlpWrap.setDefaultOptions(options);
      ytDlpProcess = execFile(this.binaryPath, ytDlpArguments, options, (error, stdout, stderr) => {
        if (error) {
          reject(YTDlpWrap.createError(error, null, stderr));
        }
        resolve(stdout);
      });
      YTDlpWrap.bindAbortSignal(abortSignal, ytDlpProcess);
    });
    ytDlpPromise.ytDlpProcess = ytDlpProcess;
    return ytDlpPromise;
  }

  execStream(ytDlpArguments = [], options = {}, abortSignal = null) {
    const readStream = new Readable({ read(size) { } });
    options = YTDlpWrap.setDefaultOptions(options);
    ytDlpArguments = ytDlpArguments.concat(['-o', '-']);
    const ytDlpProcess = spawn(this.binaryPath, ytDlpArguments, options);
    readStream.ytDlpProcess = ytDlpProcess;
    YTDlpWrap.bindAbortSignal(abortSignal, ytDlpProcess);
    let stderrData = '';
    let processError;
    ytDlpProcess.stdout.on('data', (data) => readStream.push(data));
    ytDlpProcess.stderr.on('data', (data) => {
      let stringData = data.toString();
      YTDlpWrap.emitYoutubeDlEvents(stringData, readStream);
      stderrData += stringData;
    });
    ytDlpProcess.on('error', (error) => (processError = error));
    ytDlpProcess.on('close', (code) => {
      if (code === 0 || ytDlpProcess.killed) {
        readStream.emit('close');
        readStream.destroy();
        readStream.emit('end');
      }
      else {
        const error = YTDlpWrap.createError(code, processError, stderrData);
        readStream.emit('error', error);
        readStream.destroy(error);
      }
    });
    return readStream;
  }

  async getExtractors() {
    let ytDlpStdout = await this.execPromise(['--list-extractors']);
    return ytDlpStdout.split('\n');
  }

  async getExtractorDescriptions() {
    let ytDlpStdout = await this.execPromise(['--extractor-descriptions']);
    return ytDlpStdout.split('\n');
  }

  async getHelp() {
    let ytDlpStdout = await this.execPromise(['--help']);
    return ytDlpStdout;
  }

  async getUserAgent() {
    let ytDlpStdout = await this.execPromise(['--dump-user-agent']);
    return ytDlpStdout;
  }

  async getVersion() {
    let ytDlpStdout = await this.execPromise(['--version']);
    return ytDlpStdout;
  }

  async getVideoInfo(ytDlpArguments) {
    if (typeof ytDlpArguments == 'string') {
      ytDlpArguments = [ytDlpArguments];
    }
    if (!ytDlpArguments.includes('-f') &&
      !ytDlpArguments.includes('--format')) {
      ytDlpArguments = ytDlpArguments.concat(['-f', 'best']);
    }
    let ytDlpStdout = await this.execPromise(ytDlpArguments.concat(['--dump-json']));
    try {
      return JSON.parse(ytDlpStdout);
    }
    catch (e) {
      return JSON.parse('[' + ytDlpStdout.replace(/\n/g, ',').slice(0, -1) + ']');
    }
  }

  static bindAbortSignal(signal, process) {
    signal?.addEventListener('abort', () => {
      try {
        if (os.platform() === 'win32') {
          execSync(`taskkill /pid ${process.pid} /T /F`);
        } else {
          execSync(`pgrep -P ${process.pid} | xargs -L 1 kill`, { stdio : 'pipe' });
        }
      }
      catch (e) {
        // at least we tried
      }
      finally {
        process.kill(); // call to make sure that object state is updated even if task might be already killed by OS
      }
    });
  }

  static setDefaultOptions(options) {
    if (!options.maxBuffer) {
      options.maxBuffer = 1024 * 1024 * 1024;
    }
    return options;
  }

  static createError(code, processError, stderrData) {
    let errorMessage = '\nError code: ' + code;
    if (processError) {
      errorMessage += '\n\nProcess error:\n' + processError;
    }
    if (stderrData) {
      errorMessage += '\n\nStderr:\n' + stderrData;
    }
    return new Error(errorMessage);
  }

  static emitYoutubeDlEvents(stringData, emitter) {
    let outputLines = stringData.split(/\r|\n/g).filter(Boolean);
    for (let outputLine of outputLines) {
      if (outputLine[0] == '[') {
        let progressMatch = outputLine.match(progressRegex);
        if (progressMatch) {
          let progressObject = {};
          progressObject.percent = parseFloat(progressMatch[1].replace('%', ''));
          progressObject.totalSize = progressMatch[2].replace('~', '');
          progressObject.currentSpeed = progressMatch[4];
          progressObject.eta = progressMatch[6];
          emitter.emit('progress', progressObject);
        }
        let eventType = outputLine
        .split(' ')[0]
        .replace('[', '')
        .replace(']', '');
        let eventData = outputLine.substring(outputLine.indexOf(' '), outputLine.length);
        emitter.emit('ytDlpEvent', eventType, eventData);
      }
    }
  }
}
