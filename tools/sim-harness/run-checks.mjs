// 検査をまとめて、CPU の数だけ同時に走らせる。
//
//   node tools/sim-harness/run-checks.mjs quick    # 普段の作業向け（約30秒）
//   node tools/sim-harness/run-checks.mjs check    # コミット前・CI（全部。progression は除く）
//   node tools/sim-harness/run-checks.mjs full     # check ＋ progression
//   node tools/sim-harness/run-checks.mjs online   # オンライン版の検査だけ
//   node tools/sim-harness/run-checks.mjs check --serial   # 1本ずつ（出力を追いたいとき）
//   node tools/sim-harness/run-checks.mjs check -j 2       # 同時に走らせる数を決める
//   node tools/sim-harness/run-checks.mjs season-check online-parity-check  # 名前で選ぶ
//
// 各検査は別プロセスで動くので、互いの TEAMS_DATA などは混ざらない。出力は検査ごとに
// ためておき、落ちた検査の分だけ最後にそのまま出す。最後に所要時間の一覧を出す。
//
// ⚠ 検査を足すときは CHECKS に1行足す。`group` が 'quick' のものは quick・check・full の
//    すべてで走る。`slow` は時間の目安（秒）で、重い順に先に始めると全体が早く終わる。
//    実測し直したら書き換えてよい（合否には使わない）。
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const harness = (name) => join('tools', 'sim-harness', `${name}.mjs`);

// group: quick（軽い・毎回）/ check（重い・コミット前）/ full（さらに重い）
const CHECKS = [
  { name: 'lint', group: 'quick', slow: 5, args: ['node_modules/eslint/bin/eslint.js', 'src', '--quiet'] },
  { name: 'scope-check', group: 'quick', slow: 3 },
  { name: 'save-check', group: 'quick', slow: 1 },
  { name: 'review-check', group: 'quick', slow: 1 },
  { name: 'oneplayer-fix-check', group: 'quick', slow: 2 },
  { name: 'sim-integrity-check', group: 'quick', slow: 4 },
  { name: 'season-check', group: 'quick', slow: 8 },
  { name: 'draft-check', group: 'quick', slow: 8 },
  { name: 'bracket-check', group: 'quick', slow: 2 },
  { name: 'contract-scope-check', group: 'quick', slow: 2 },
  { name: 'pool-leak-check', group: 'quick', slow: 2 },
  { name: 'base-state-check', group: 'quick', slow: 1 },
  { name: 'bunt-check', group: 'quick', slow: 1 },
  { name: 'doc-check', group: 'quick', slow: 1 },
  { name: 'online-config-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-pyramid-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-membership-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-panels-render-check', group: 'quick', online: true, slow: 3 },
  { name: 'online-core-check', group: 'quick', online: true, slow: 3 },
  { name: 'online-boundary-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-auth-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-clock-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-edit-conflict-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-label-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-stats-view-check', group: 'quick', online: true, slow: 1 },
  { name: 'online-migration-check', group: 'check', online: true, slow: 21 },
  { name: 'online-join-check', group: 'check', online: true, slow: 9 },
  { name: 'online-deadline-check', group: 'check', online: true, slow: 25 },
  { name: 'online-testmode-check', group: 'check', online: true, slow: 10 },
  { name: 'online-lineup-port-check', group: 'check', online: true, slow: 16 },
  { name: 'online-tryout-plan-check', group: 'check', online: true, slow: 10 },
  { name: 'online-parity-check', group: 'check', online: true, slow: 75 },
  { name: 'online-service-check', group: 'check', online: true, slow: 55 },
  { name: 'online-storage-check', group: 'check', online: true, slow: 3 },
  { name: 'online-roster-recovery-check', group: 'check', online: true, slow: 27 },
  { name: 'online-snapshot-check', group: 'check', online: true, slow: 8 },
  { name: 'online-records-check', group: 'check', online: true, slow: 52 },
  { name: 'progression-check', group: 'full', slow: 38 },
];

// ここに無い *-check.mjs は、別の手順で回すもの。ブラウザやサーバーが要る画面検査と、
// 10分近くかかる通年検査（CI では別のジョブ）。
const SEPARATE = [
  'online-engine-check', // check:online:season
  'online-ui-check',
  'online-auth-ui-check',
  'online-edit-ui-check',
  'online-replay-ui-check',
  'online-mobile-gameplay-ui-check',
  'online-label-ui-check',
  'singleplayer-ui-check', // check:ui
];

const LEVEL = { quick: 0, check: 1, full: 2 };

// 検査を足したのに CHECKS へ書き忘れると、誰も回さないまま腐る。ここで止める。
function assertAllListed() {
  const known = new Set([...CHECKS.map((c) => c.name), ...SEPARATE]);
  const missing = readdirSync(join(root, 'tools', 'sim-harness'))
    .filter((f) => f.endsWith('-check.mjs'))
    .map((f) => f.replace(/\.mjs$/, ''))
    .filter((name) => !known.has(name));
  if (missing.length) {
    console.error(`run-checks.mjs の CHECKS か SEPARATE に載っていない検査があります: ${missing.join(', ')}`);
    process.exit(2);
  }
}

function parseArgs(argv) {
  const opts = { jobs: availableParallelism(), names: [], preset: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serial') opts.jobs = 1;
    else if (a === '-j' || a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 1);
    else if (a in LEVEL || a === 'online') opts.preset = a;
    else opts.names.push(a);
  }
  if (process.env.SIM_HARNESS_JOBS)
    opts.jobs = Math.max(1, Number(process.env.SIM_HARNESS_JOBS) || 1);
  return opts;
}

function select({ preset, names }) {
  if (names.length) {
    const unknown = names.filter((n) => !CHECKS.some((c) => c.name === n));
    if (unknown.length) {
      console.error(`知らない検査: ${unknown.join(', ')}`);
      console.error(`使える名前: ${CHECKS.map((c) => c.name).join(', ')}`);
      process.exit(2);
    }
    return CHECKS.filter((c) => names.includes(c.name));
  }
  if (preset === 'online') return CHECKS.filter((c) => c.online);
  const level = LEVEL[preset ?? 'check'];
  return CHECKS.filter((c) => LEVEL[c.group] <= level);
}

function run(check) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = check.args ?? [harness(check.name)];
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('close', (code, signal) => {
      resolve({
        ...check,
        ok: code === 0,
        code: code ?? signal,
        seconds: (Date.now() - started) / 1000,
        output: Buffer.concat(chunks).toString(),
      });
    });
  });
}

async function main() {
  assertAllListed();
  const opts = parseArgs(process.argv.slice(2));
  const checks = select(opts).sort((a, b) => b.slow - a.slow);
  const jobs = Math.min(opts.jobs, checks.length);
  console.log(`検査 ${checks.length} 本を同時 ${jobs} 本で実行します`);
  const started = Date.now();
  const queue = [...checks];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const check = queue.shift();
      const result = await run(check);
      results.push(result);
      const mark = result.ok ? 'PASS' : 'FAIL';
      console.log(`  ${mark} ${result.name}（${result.seconds.toFixed(1)}秒）`);
      if (opts.jobs === 1 || !result.ok) process.stdout.write(indent(result.output));
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  const failed = results.filter((r) => !r.ok);
  const total = (Date.now() - started) / 1000;
  console.log('\n所要時間（長い順）');
  for (const r of [...results].sort((a, b) => b.seconds - a.seconds))
    console.log(`  ${r.seconds.toFixed(1).padStart(6)}秒  ${r.ok ? '  ' : '✗ '}${r.name}`);
  console.log(`\n全体 ${total.toFixed(1)}秒 / ${results.length - failed.length} PASS / ${failed.length} FAIL`);
  if (failed.length) {
    console.log(`落ちた検査: ${failed.map((r) => r.name).join(', ')}`);
    console.log('1本だけ回すには: node tools/sim-harness/run-checks.mjs <名前>');
    process.exit(1);
  }
}

const indent = (text) =>
  text
    .split('\n')
    .filter((line, i, all) => line || i < all.length - 1)
    .map((line) => `      ${line}\n`)
    .join('');

await main();
