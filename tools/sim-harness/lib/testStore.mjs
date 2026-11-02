// 検査用の保存先。既定はメモリ上で、`SIM_HARNESS_FILE_STORE=1` のときだけ本物の
// FileStore（gzip してディスクへ書く）を使う。
//
// ⚠ 検査の時間の大半は試合ではなく保存だった。online-service-check の内訳を取ると
//    約75%が FileStore の gzip 圧縮・展開と巨大な JSON 文字列の変換で、読むたび・
//    書くたびにリーグ全体を丸ごと処理していた。保存の形そのものを確かめるのは
//    online-storage-check の役目なので、ほかの検査はメモリで回してよい。
//
// FileStore と同じ約束を守ること。
//   - read() は毎回まっさらな複製を返す（呼んだ側が書き換えても保存は変わらない）。
//     複製は JSON を通す。structuredClone だと undefined や Date が残り、
//     本番（JSON で保存）と結果がずれる。
//   - transaction() は1本の列に積み、`{ unchanged }` なら書かない。
//   - 同じパスで作り直すと前の内容が見える（再起動の再現に使う検査がある）。
import { FileStore } from '../../../server/storage/fileStore.mjs';

const memory = new Map();
const empty = () => ({ league: null, sessions: {}, receipts: {} });

export class MemoryStore {
  constructor(path) {
    this.path = path;
    this.queue = Promise.resolve();
  }
  async read() {
    const text = memory.get(this.path);
    return text === undefined ? empty() : JSON.parse(text);
  }
  transaction(fn) {
    const result = this.queue.then(async () => {
      const value = await this.read();
      const outcome = await fn(value);
      if (outcome?.unchanged) return outcome.value;
      memory.set(this.path, JSON.stringify(value));
      return outcome?.value;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

export function createTestStore(path) {
  return process.env.SIM_HARNESS_FILE_STORE === '1'
    ? new FileStore(path)
    : new MemoryStore(path);
}
