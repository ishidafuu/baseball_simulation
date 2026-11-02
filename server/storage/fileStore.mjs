import {
  readFile,
  writeFile,
  rename,
  mkdir,
  unlink,
  open,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

// ローカル専用。単一プロセスでキューに積み、fsyncした一式をrenameで公開する。
export class FileStore {
  constructor(path) {
    this.path = path;
    this.queue = Promise.resolve();
  }
  async read() {
    try {
      return JSON.parse(gunzipSync(await readFile(this.path)));
    } catch (error) {
      if (error.code === 'ENOENT')
        return { league: null, sessions: {}, receipts: {} };
      throw error;
    }
  }
  transaction(fn) {
    const result = this.queue.then(async () => {
      const value = await this.read();
      const outcome = await fn(value);
      if (outcome?.unchanged) return outcome.value;
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        // ローカル専用なので圧縮率より速さを取る。読み書きのたびにリーグ全体を圧縮するので、
        // 既定（level 6）だと1刻みの時間の多くが圧縮に消える。読む側は level を問わない。
        await writeFile(temp, gzipSync(JSON.stringify(value), { level: 1 }));
        const file = await open(temp, 'r');
        try {
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temp, this.path);
      } finally {
        await unlink(temp).catch(() => {});
      }
      return outcome?.value;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
