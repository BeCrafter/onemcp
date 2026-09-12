#!/usr/bin/env node
/**
 * scripts/tui-e2e.mjs — TUI 端到端回归（真实终端）
 *
 * 为什么单独一个脚本：TUI 需要真实 PTY 才能验证「渲染结果」与「按键行为」，
 * 不适用 e2e-local.mjs 的 HTTP/stdio 断言方式（见 CLAUDE.md「E2E 场景回归规则」）。
 * 这里用 tmux 充当真实终端：私有 socket 建会话、send-keys 驱动、capture-pane
 * 读屏。tmux 本身就是终端模拟器，读到的画面即 ground truth —— 自研 ANSI 仿真
 * 会因为滚动语义差异产生假象（帧超高时尤其明显）。
 *
 * 隔离保证（绝不触碰用户环境）：
 *   - tmux 私有 socket（-L onemcp-tui-e2e），不影响默认 tmux server
 *   - 每场景独立 mkdtemp 配置目录，不读写 ~/.onemcp
 *   - 不占用任何端口，与 :5625 运行实例无关
 *
 * 用例（T*）：
 *   T1 列表一屏渲染：16 服务 @34 行 —— 每服务恰好一行、无换行续行、无游离字符
 *   T2 窄终端降级：60 列 —— 丢 tags 列、端点省略号截断、仍每服务一行
 *   T3 删除二次确认：d → 确认框 → n 取消 / y 才删除
 *   T4 重名覆盖确认：同名保存 → 确认框 → n 取消且原配置（tags）完好
 *   T5 Ctrl+S 不污染：空 Command 连按 3 次 → 字段无 's'、有错误提示、零落库
 *   T6 Ctrl+C 退出：有服务配置时也能真正退出进程
 *   T7 参数粘贴并运行：整块粘贴 → Ctrl+R → 回显结果
 *   T8 工具视图：工具清单（含精确计数）+ 搜索粘贴过滤
 *   T9 结果区操作：Ctrl+P 原始输出 / v 选行 + Ctrl+Y 复制选区 / f 全宽
 *   T10 结果分页：大输出下 PageDown/PageUp 改变可见行区间
 *   T11 CJK：中文服务名占一行 + 中文参数值运行后原样回显
 *   T12 配置路径与自身写盘提示：footer 显示真实 configDir；保存后提示是成功而非"外部变更"
 *   T13 存档：Ctrl+O 生成临时文件并给出路径
 *   T14 长描述滚动：Ctrl+E 展开后焦点进入描述区，↑/↓ 逐行滚动（选中项不变）；
 *       Esc 回到工具列表后 ↑/↓ 立刻切换工具（无需先折叠描述）
 *   T15 区域焦点可见 + 提示按区域：标题字形恒定（无焦点箭头），焦点靠颜色 ——
 *       `-e` 抓屏断言聚焦区的**标题文字**与竖线同色、且与未聚焦区不同；
 *       提示只讲当前区域；通知不顶掉提示
 *
 * 用法：
 *   npm run verify:tui [-- --keep] [--verbose]
 *   （需先 npm run build；脚本会断言 dist 比 src 新）
 *
 * 注：脚本会为 tmux 会话剥掉 CI / CONTINUOUS_INTEGRATION / CI_* 环境变量 —— Ink 检测到它们时
 * 只在退出时画最后一帧（is-in-ci），驱动会一直看到空屏。
 *
 * 退出码：0 = 全部通过；1 = 有断言失败；2 = 环境不具备（未安装 tmux）——
 * 刻意用非 0，避免「跳过」被当成「通过」（CI 上尤其危险）。确需在无 tmux
 * 环境跳过时显式传 --allow-skip。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist/cli.js');
const MOCK_BACKEND = path.join(ROOT, 'tests/integration/fixtures/tui-mock-mcp.cjs');
const SOCKET = 'onemcp-tui-e2e';

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const VERBOSE = args.includes('--verbose');
const ALLOW_SKIP = args.includes('--allow-skip');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Focus markers the forms/panels render: waiting for them keeps typing steps
// deterministic on slow runners (a Tab/Enter that has not been committed yet
// would otherwise send the following text into the previous field).
const FOCUS_NAME = /▶ Service Name/;
const FOCUS_COMMAND = /▶ Command/;
const FOCUS_PARAM = /▶ 1\s/;

/**
 * 工具视图里把焦点挪到参数区。Tab 循环是「列表 → 描述 → 参数」，从列表出发是两站、
 * 从描述区出发是一站，所以按「按到参数区出现为止」处理，而不是固定按几次 ——
 * 按多了会绕回列表，随后的输入会被列表吃掉（`t` 甚至会切换工具启用状态）。
 */
const tabToFirstParam = async () => {
  for (let i = 0; i < 3 && !FOCUS_PARAM.test(capture()); i += 1) {
    await sendKey('Tab');
  }
  await waitFor(() => FOCUS_PARAM.test(capture()));
};

/**
 * Ink (via the `is-in-ci` helper) renders ONLY the final frame when it detects a
 * CI environment — `CI` / `CONTINUOUS_INTEGRATION` / any `CI_*` variable. Driving
 * the TUI then stares at a blank pane until the app exits, which is exactly what
 * every scenario here waits on. The app under test is interactive, so the tmux
 * server (and therefore its panes) is started with those markers stripped,
 * matching a developer's terminal. Runs on CI runners included.
 */
const withoutCiMarkers = (env) => {
  const cleaned = { ...env };
  for (const key of Object.keys(cleaned)) {
    if (key === 'CI' || key === 'CONTINUOUS_INTEGRATION' || key.startsWith('CI_')) {
      delete cleaned[key];
    }
  }
  return cleaned;
};
const TMUX_ENV = withoutCiMarkers(process.env);
const CI_UNSET_FLAGS = ['CI', 'CONTINUOUS_INTEGRATION']
  .concat(Object.keys(process.env).filter((key) => key.startsWith('CI_')))
  .map((key) => `-u ${key}`)
  .join(' ');

// ---------------------------------------------------------------- tmux driver

const tmuxRaw = (tmuxArgs) =>
  spawnSync('tmux', ['-L', SOCKET, ...tmuxArgs], { encoding: 'utf8', env: TMUX_ENV });
const tmux = (tmuxArgs) => {
  const res = tmuxRaw(tmuxArgs);
  if (res.status !== 0 && VERBOSE) {
    process.stderr.write(`[tmux] ${tmuxArgs.join(' ')} → ${res.stderr ?? ''}\n`);
  }
  return res;
};

const killServer = () =>
  spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { encoding: 'utf8', env: TMUX_ENV });
const capture = () => tmuxRaw(['capture-pane', '-p', '-t', 'tui']).stdout ?? '';
/** Same frame, but keeping SGR colour codes (`-e`) — the only way to see colour. */
const captureColored = () => tmuxRaw(['capture-pane', '-e', '-p', '-t', 'tui']).stdout ?? '';
/**
 * The SGR code that applies to the text immediately before `needle`, on the
 * screen line containing `label`. Returns 'none' when that text inherits the
 * terminal default colour, or null when label/needle are not on screen.
 */
const sgrBefore = (colored, label, needle) => {
  const line = colored.split('\n').find((l) => l.includes(label));
  if (line === undefined) return null;
  const at = line.indexOf(needle);
  if (at < 0) return null;
  const codes = line.slice(0, at).match(/\x1b\[[0-9;]*m/g);
  return codes === null ? 'none' : codes[codes.length - 1];
};
const sessionAlive = () => tmuxRaw(['has-session', '-t', 'tui']).status === 0;
/**
 * Keys are sent one at a time with a settle delay: a slow runner needs the app
 * to re-render between keystrokes, otherwise the next key lands on stale focus
 * (e.g. Down/Down for navigation collapsing into one, or text going into the
 * previously focused field). Override with TUI_E2E_KEY_DELAY (ms).
 */
const KEY_DELAY = Number(process.env['TUI_E2E_KEY_DELAY'] ?? 140);
const sendText = async (text) => {
  tmux(['send-keys', '-t', 'tui', '-l', text]);
  await sleep(KEY_DELAY);
};
const sendKey = async (key) => {
  tmux(['send-keys', '-t', 'tui', key]);
  await sleep(KEY_DELAY);
};

async function waitFor(predicate, timeoutMs = 8000, intervalMs = 120) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
}

/** Screen lines with trailing blank rows removed. */
const screenLines = (text) => {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === '') last -= 1;
  return lines.slice(0, last + 1);
};

/** The service-name cell of a rendered list row (status symbol + name). */
const nameInRow = (line) => {
  const match = /^\s*[+-]\s+(\S+)/.exec(line.slice(4, 29));
  return match?.[1] ?? '';
};

// --------------------------------------------------------------- config files

/**
 * Config for one scenario. Delegates the shape to `onemcp --init` instead of
 * duplicating the schema here — a hand-written template silently rots the day a
 * new required field appears (which is exactly how `security.dataMasking` broke
 * an earlier revision), and the app exits on a validation failure.
 */
function seedConfigDir(configDir, services) {
  const init = spawnSync('node', [CLI, '--init', '--config-dir', configDir], { encoding: 'utf8' });
  if (init.status !== 0) {
    throw new Error(`onemcp --init 失败：${init.stderr || init.stdout}`);
  }
  const configPath = path.join(configDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.mode = 'tui';
  config.logLevel = 'ERROR';
  config.mcpServers = services;
  // Keep the run quiet and independent of the host: no health polling, no audit.
  config.healthCheck = { ...config.healthCheck, enabled: false };
  config.audit = { ...config.audit, enabled: false };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}

const readConfig = (configDir) =>
  JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));

const stdioService = (name, extra = {}) => ({
  transport: 'stdio',
  enabled: true,
  tags: ['e2e', 'mock'],
  command: `node ${MOCK_BACKEND}`,
  connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
  ...extra,
});

/** Long http endpoints so the list actually has to truncate. */
const httpService = (index) => ({
  transport: 'http',
  enabled: false,
  tags: ['tag' + index],
  url: `https://svc-${index}.example.com/very/long/path/to/mcp/endpoint`,
  connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
});

// ------------------------------------------------------------------ harness

let checks = 0;
let failures = 0;
const failedLabels = [];

function check(label, ok, detail = '') {
  checks += 1;
  if (ok) {
    process.stdout.write(`  ✓ ${label}\n`);
  } else {
    failures += 1;
    failedLabels.push(label);
    process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function dumpScreen(label, cols, rows) {
  process.stdout.write(`  --- 失败画面 (${label}, ${cols}x${rows}) ---\n`);
  for (const line of capture().split('\n').slice(0, rows)) {
    process.stdout.write(`  |${line}|\n`);
  }
}

const tmpDirs = [];
function makeConfigDir(services) {
  // Short base path on purpose: the TUI renders the config directory in its
  // footer, and a long /var/folders path gets truncated before an exact-match
  // assertion can see it.
  const base = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'onemcp-tui-e2e-'));
  tmpDirs.push(dir);
  seedConfigDir(dir, services);
  return dir;
}

async function startSession({ configDir, cols = 100, rows = 34, ready = /Enter Edit/ }) {
  killServer();
  tmux([
    'new-session',
    '-d',
    '-x',
    String(cols),
    '-y',
    String(rows),
    '-s',
    'tui',
    '-c',
    ROOT,
    '-e',
    `ONEMCP_CONFIG_DIR=${configDir}`,
    '-e',
    'TERM=tmux-256color',
    // Strip the CI markers in the command itself as well: filtering only the tmux
    // client's env relies on how a given tmux version seeds its server/global
    // environment (tmux 3.4 on CI did not honour it), while `env -u` is explicit.
    `env ${CI_UNSET_FLAGS} node ${CLI} --mode tui`,
  ]);
  const ok = await waitFor(() => ready.test(capture()), 25_000);
  if (!ok) {
    dumpScreen('启动', cols, rows);
    throw new Error('TUI 未在超时内就绪');
  }
}

// ----------------------------------------------------------------- scenarios

/** T1 — 一屏渲染不多不少：每个服务恰好一行（帧溢出会表现为续行/游离字符）。 */
async function t1ListLayout() {
  process.stdout.write('\n[T1] 列表一屏渲染（16 服务 @34 行 / @50 行）\n');
  const services = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`svc-${i}`, httpService(i)])
  );
  const configDir = makeConfigDir(services);
  const names = Object.keys(services);

  await startSession({ configDir, cols: 100, rows: 34 });
  const lines34 = screenLines(capture());
  check(
    '34 行下 16 个服务全部渲染',
    names.every((n) => lines34.some((l) => nameInRow(l) === n))
  );
  check(
    '每个服务恰好占一行（无换行续行）',
    names.every((n) => lines34.filter((l) => nameInRow(l) === n).length === 1)
  );
  check(
    '每行不超过终端宽度',
    lines34.every((l) => l.length <= 100)
  );
  check('长端点被省略号截断而非折行', capture().includes('…'));
  check(
    '无游离字符残留（原帧溢出特征）',
    !capture().includes('-http://') && !capture().includes('/https://'),
    '出现 -http:// 或 /https://'
  );
  check(
    '画面不超出终端高度（写入行数 ≤ 行数上限）',
    lines34.length <= 34,
    `写入 ${lines34.length} 行`
  );

  // 高度变化不应该改变列表本身的渲染（终端余量只影响底部留白）。
  killServer();
  await startSession({ configDir, cols: 100, rows: 50 });
  const rows34 = lines34.filter((l) => nameInRow(l) !== '');
  const rows50 = screenLines(capture()).filter((l) => nameInRow(l) !== '');
  check(
    '34 行与 50 行的服务行完全一致（渲染不再受终端高度影响）',
    rows34.length === names.length && JSON.stringify(rows34) === JSON.stringify(rows50),
    `34 行 ${rows34.length} 条 / 50 行 ${rows50.length} 条`
  );
}

/** T2 — 窄终端降级：丢可选列，端点保持可读，仍每服务一行。 */
async function t2NarrowTerminal() {
  process.stdout.write('\n[T2] 窄终端降级（60 列）\n');
  const services = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`svc-${i}`, httpService(i)])
  );
  const configDir = makeConfigDir(services);
  const names = Object.keys(services);

  await startSession({ configDir, cols: 60, rows: 30 });
  const text = capture();
  const lines = screenLines(text);
  check(
    '仍每服务一行',
    names.every((n) => lines.filter((l) => nameInRow(l) === n).length === 1)
  );
  check('丢弃 tags 列以换取端点宽度', !text.includes('[tag0]'));
  check(
    '端点仍可读（省略号截断）',
    text.includes('https://svc-0.example.c…') || text.includes('…')
  );
  check(
    '每行不超过 60 列',
    lines.every((l) => l.length <= 60)
  );
}

/** T3 — 删除必须二次确认。 */
async function t3DeleteConfirm() {
  process.stdout.write('\n[T3] 删除二次确认\n');
  const configDir = makeConfigDir({
    'keep-me': stdioService('keep-me'),
    'delete-me': stdioService('delete-me'),
  });

  await startSession({ configDir, cols: 100, rows: 40 });
  await sendKey('Down'); // 选中 delete-me
  await waitFor(() => /▶\s+- delete-me/.test(capture()));
  await sendText('d');
  const promptAppeared = await waitFor(() => capture().includes("Delete service 'delete-me'?"));
  check('d 弹出确认框', promptAppeared);
  check('确认前不删除（服务数不变）', capture().includes('2 Services'));

  await sendText('n');
  check('n 取消并保留服务', await waitFor(() => capture().includes('Cancelled')));
  check('取消后配置未变', readConfig(configDir).mcpServers['delete-me'] !== undefined);

  await sendText('d');
  await waitFor(() => capture().includes("Delete service 'delete-me'?"));
  await sendText('y');
  const deleted = await waitFor(() => capture().includes("Service 'delete-me' deleted"));
  check('y 才真正删除', deleted);
  check(
    '删除已写入配置',
    readConfig(configDir).mcpServers['delete-me'] === undefined &&
      readConfig(configDir).mcpServers['keep-me'] !== undefined
  );
}

/** T4 — 重名保存必须确认，且不静默覆盖既有配置。 */
async function t4OverwriteConfirm() {
  process.stdout.write('\n[T4] 重名覆盖确认\n');
  const configDir = makeConfigDir({
    existing: stdioService('existing', { tags: ['keep', 'this'] }),
  });

  await startSession({ configDir, cols: 100, rows: 40 });
  await sendText('a');
  await waitFor(() => FOCUS_NAME.test(capture()));
  await sendText('existing'); // 整块输入 = 粘贴路径
  await sendKey('Tab');
  await sendKey('Enter');
  await waitFor(() => FOCUS_COMMAND.test(capture())); // 等焦点落到 Command 再输入
  await sendText(`node ${MOCK_BACKEND}`);
  await sendKey('C-s');

  const promptAppeared = await waitFor(() => capture().includes('already exists — overwrite it?'));
  check('同名保存弹出覆盖确认', promptAppeared);
  check(
    '确认前不覆盖（tags 完好）',
    readConfig(configDir).mcpServers['existing'].tags.join() === 'keep,this'
  );

  await sendText('n');
  await waitFor(() => capture().includes('Cancelled'));
  check(
    'n 取消后配置未变',
    readConfig(configDir).mcpServers['existing'].tags.join() === 'keep,this'
  );
}

/** T5 — Ctrl+S 不得把 's' 敲进字段，更不得据此落库。 */
async function t5CtrlSDoesNotPollute() {
  process.stdout.write('\n[T5] Ctrl+S 不污染输入 / 不误落库\n');
  const configDir = makeConfigDir({ demo: stdioService('demo') });

  await startSession({ configDir, cols: 100, rows: 40 });
  await sendText('a');
  await waitFor(() => FOCUS_NAME.test(capture()));
  await sendText('e2e-leak');
  await sendKey('Tab');
  await sendKey('Enter'); // stdio → Command 字段（留空）
  await waitFor(() => FOCUS_COMMAND.test(capture()));

  for (let i = 0; i < 3; i += 1) {
    await sendKey('C-s');
    await sleep(500);
  }
  const text = capture();
  check('字段未被追加 s', text.includes('e2e-leak') && !text.includes('e2e-leaks'));
  check('校验失败有可见提示', text.includes('required'));
  check('连按 Ctrl+S 不产生服务', readConfig(configDir).mcpServers['e2e-leak'] === undefined);
  check('服务总数不变', Object.keys(readConfig(configDir).mcpServers).length === 1);
}

/** T6 — Ctrl+C 必须真正结束进程（曾有：仅 unmount，进程被后台句柄挂住）。 */
async function t6CtrlCExits() {
  process.stdout.write('\n[T6] Ctrl+C 退出\n');
  const configDir = makeConfigDir({ demo: stdioService('demo') });

  await startSession({ configDir, cols: 100, rows: 40 });
  check('会话已就绪', sessionAlive());
  await sendKey('C-c');
  const exited = await waitFor(() => !sessionAlive(), 6000);
  check('Ctrl+C 结束 TUI 进程（会话消失）', exited);
}

/** T7 — 粘贴（一次多字符输入事件）可用，并能运行工具拿到结果。 */
async function t7PasteAndRun() {
  process.stdout.write('\n[T7] 参数粘贴并运行\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 45 });
  await sendText('v');
  const toolsLoaded = await waitFor(() => capture().includes('PARAMETERS'));
  check('工具视图加载出参数区', toolsLoaded);

  await tabToFirstParam();
  await sendText('hello'); // 整块写入，等价于粘贴
  await waitFor(() => capture().includes('hello'));
  await sendKey('C-r');
  const ran = await waitFor(() => capture().includes('echo: "hello"'), 10_000);
  check('整块粘贴的参数生效并运行成功', ran, capture().includes('required') ? '参数被丢弃' : '');
}

/** T8 — 工具清单与搜索（含整块粘贴过滤）。 */
async function t8ToolsView() {
  process.stdout.write('\n[T8] 工具视图与搜索\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 45 });
  await sendText('v');
  const listed = await waitFor(() => capture().includes('echo') && capture().includes('fail'));
  const text = capture();
  check('工具清单渲染出全部 4 个工具', listed);
  check('显示发现到的工具总数（精确表头）', text.includes('4✓/0✗ of 4'), '未出现 4✓/0✗ of 4');

  await sendText('/');
  await waitFor(() => capture().includes('Search:'));
  await sendText('big'); // 整块写入 = 粘贴
  const filtered = await waitFor(
    () => capture().includes('Search: big') && capture().includes('1/4')
  );
  check('搜索框接受粘贴并过滤', filtered);
}

/**
 * T9 — 结果区操作：原始输出、按行选择复制、全宽。
 */
async function t9ResultActions() {
  process.stdout.write('\n[T9] 结果区操作（Ctrl+P / v 选行复制 / f 全宽）\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 45 });
  await sendText('v');
  await waitFor(() => capture().includes('PARAMETERS'));
  await tabToFirstParam();
  await sendText('hi');
  await waitFor(() => capture().includes('hi'));
  await sendKey('C-r');
  check('运行成功', await waitFor(() => capture().includes('echo: "hi"'), 10_000));

  await sendKey('C-p'); // 原始输出
  check('Ctrl+P 切到原始 JSON 输出', await waitFor(() => capture().includes('"content"'), 4000));

  await sendText('v'); // 从光标起选行
  await sendKey('Down');
  check(
    'v + ↓ 进入选区（提示切到 Copy selection）',
    await waitFor(() => capture().includes('Copy selection'), 4000)
  );
  await sendKey('C-y');
  check(
    'Ctrl+Y 复制选区（或明确提示无剪贴板工具）',
    await waitFor(
      () => capture().includes('Copied') || capture().includes('No clipboard utility'),
      5000
    )
  );

  await sendText('f');
  check(
    'f 切到全宽（工具列表隐藏）',
    await waitFor(() => !capture().includes('mock__') || capture().includes('OUTPUT'), 4000)
  );
}

/**
 * T10 — 大输出的分页：PageDown/PageUp 必须改变可见行区间。
 */
async function t10ResultPaging() {
  process.stdout.write('\n[T10] 结果分页（大输出）\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 45 });
  await sendText('v');
  await waitFor(() => capture().includes('PARAMETERS'));
  await sendKey('Down');
  await sendKey('Down'); // → big_output
  await waitFor(() => /▶\s+✓\s+big_output/.test(capture())); // 等选中项真的落到 big_output
  await sendKey('C-r');
  check('大输出首行可见', await waitFor(() => capture().includes('[001]'), 10_000));

  await sendKey('PageDown');
  await sendKey('PageDown');
  const paged = await waitFor(() => capture().includes('[02') || capture().includes('[03'), 4000);
  check('PageDown 前进到后续行', paged);
  await sendKey('PageUp');
  check('PageUp 回到前段', await waitFor(() => capture().includes('[0'), 4000));
}

/**
 * T11 — CJK：中文标签在列表里仍占一行；中文参数值运行后原样回显。
 *
 * 服务名按校验规则必须含 ASCII 字母数字（它要作为工具命名空间前缀），所以
 * 中文只出现在标签/参数值这类自由文本上 —— 这正是宽字符最容易出问题的地方。
 */
async function t11Cjk() {
  process.stdout.write('\n[T11] CJK 标签与参数值\n');
  const configDir = makeConfigDir({
    'cjk-one': stdioService('cjk-one', { tags: ['中文标签', '宽字符'] }),
    'cjk-two': stdioService('cjk-two', { tags: ['中文标签'] }),
  });

  await startSession({ configDir, cols: 100, rows: 40 });
  const lines = screenLines(capture());
  // '[中文标签]' 挂在两个服务上，'[宽字符]' 只挂一个：宽字符标签必须完整落在
  // 同一行里（每个服务一行），不能因为宽度算错而折行或截半。
  const tagLines = (tag) => lines.filter((l) => l.includes(tag)).length;
  check(
    '[中文标签] 出现在两个服务所在的行',
    tagLines('[中文标签]') === 2,
    `出现在 ${tagLines('[中文标签]')} 行`
  );
  check(
    '[宽字符] 出现在一个服务所在的行',
    tagLines('[宽字符]') === 1,
    `出现在 ${tagLines('[宽字符]')} 行`
  );
  check(
    '每个服务恰好一行（宽字符未导致折行）',
    lines.filter((l) => l.includes('cjk-one')).length === 1 &&
      lines.filter((l) => l.includes('cjk-two')).length === 1 &&
      lines.length <= 40,
    `渲染 ${lines.length} 行`
  );

  await sendText('v');
  await waitFor(() => capture().includes('PARAMETERS'));
  await tabToFirstParam();
  await sendText('你好世界'); // 整块写入（中文按显示宽度开窗）
  await waitFor(() => capture().includes('你好世界'));
  await sendKey('C-r');
  check(
    '中文参数值运行后原样回显',
    await waitFor(() => capture().includes('echo: "你好世界"'), 10_000)
  );
}

/**
 * T12 — footer 显示真实 configDir；自身写盘的提示是成功而不是"外部变更"。
 */
async function t12ConfigPathAndSelfWriteNotice() {
  process.stdout.write('\n[T12] 配置路径与自身写盘提示\n');
  const configDir = makeConfigDir({ demo: stdioService('demo') });

  await startSession({ configDir, cols: 100, rows: 45 });
  check('footer 显示真实配置目录', capture().includes(`Config: ${configDir}`));

  await sendText('a');
  await waitFor(() => FOCUS_NAME.test(capture()));
  await sendText('e2e-selfwrite');
  await sendKey('Tab');
  await sendKey('Enter');
  await waitFor(() => FOCUS_COMMAND.test(capture()));
  await sendText(`node ${MOCK_BACKEND}`);
  await sendKey('C-s');

  const created = await waitFor(
    () => capture().includes("Service 'e2e-selfwrite' created successfully"),
    6000
  );
  check('保存后提示是创建成功', created);
  check('不再出现误导性的「外部变更」提示', !capture().includes('external changes'));
  check('新服务已写入配置', readConfig(configDir).mcpServers['e2e-selfwrite'] !== undefined);
}

/**
 * T13 — Ctrl+O 存档：生成临时文件并给出路径。
 */
async function t13SaveOutput() {
  process.stdout.write('\n[T13] 结果存档（Ctrl+O）\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 45 });
  await sendText('v');
  await waitFor(() => capture().includes('PARAMETERS'));
  await tabToFirstParam();
  await sendText('save-me');
  await waitFor(() => capture().includes('save-me'));
  await sendKey('C-r');
  await waitFor(() => capture().includes('echo: "save-me"'), 10_000);

  await sendKey('C-o');
  check(
    'Ctrl+O 提示已保存并给出路径',
    await waitFor(() => capture().includes('Saved full output:'), 5000)
  );
  check(
    '同时把完整路径交给剪贴板（无工具时明确说明）',
    capture().includes('path copied to the clipboard') ||
      capture().includes('clipboard unavailable')
  );
}

/**
 * T14 — 长描述：Ctrl+E 展开后焦点进描述区，↑/↓ 逐行滚动；Esc 回工具列表后
 * ↑/↓ 立刻切换工具（不需要先折叠描述）。
 *
 * 对应两个真实交互缺陷：①展开长描述后 ↑/↓ 被描述滚动独占，切不了工具；
 * ②footer 写着 "Esc Done"，但当时按 Esc 会直接退回服务列表。
 */
async function t14DescriptionScroll() {
  process.stdout.write('\n[T14] 长描述展开滚动（Ctrl+E → ↑/↓ 滚动 → Esc 回列表）\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 34 });
  await sendText('v');
  await waitFor(() => capture().includes('PARAMETERS'));
  await sendKey('Down');
  await sendKey('Down'); // → big_output（描述有意很长）
  await waitFor(() => /▶\s+✓\s+big_output/.test(capture()));

  await sendKey('C-e'); // 展开
  // 判据必须同时等「焦点进了描述区」（footer 换成描述区按键）与「描述回到开头」：
  // 折叠态本来就能看到 desc-line-00，只等它的话这一帧可能还没重绘，断言会假通过。
  const inDescRegion = await waitFor(
    () => capture().includes('Esc Back to tool list') && capture().includes('desc-line-00'),
    4000
  );
  check(
    '展开后焦点进描述区、描述回到开头',
    inDescRegion,
    `当前选中=${/▶\s+✓\s+(\S+)/.exec(capture())?.[1] ?? '?'}`
  );

  // 两个注意点：①描述每行会按面板宽度折成 2 个终端行，判据用"描述首个终端行移出视口"
  // 而不是某个 desc-line-NN 消失；②同一读取块内的连续按键可能被合并成一次，
  // 所以这里多按几次而不假设"按 N 次 = 滚 N 行"。
  for (let i = 0; i < 8; i += 1) {
    await sendKey('Down');
  }
  const scrolled = await waitFor(
    () => !capture().includes('Returns a large text payload for paging and copy'),
    4000
  );
  const stillThere = capture().includes('Returns a large text payload for paging and copy');
  const selected = /▶\s+✓\s+(\S+)/.exec(capture())?.[1] ?? '?';
  check(
    '↓ 在描述区逐行滚动（选中项不变）',
    scrolled && /▶\s+✓\s+big_output/.test(capture()),
    `首句仍在=${stillThere} 当前选中=${selected}`
  );

  // Esc 把箭头交还列表：留在工具视图（不退回服务列表），↑/↓ 立刻换工具
  await sendKey('Escape');
  const backToList = await waitFor(() => capture().includes('↑/↓ Navigate'), 4000);
  check('Esc 回到工具列表而不是服务列表', backToList && capture().includes('Tools for: mock'));
  await sendKey('Down');
  check(
    '列表里 ↑/↓ 立即切换工具（无需先折叠描述）',
    await waitFor(() => /▶\s+✓\s+fail/.test(capture()), 4000),
    `当前选中=${/▶\s+✓\s+(\S+)/.exec(capture())?.[1] ?? '?'}`
  );
  check(
    '切换到新工具后描述回到折叠态',
    await waitFor(() => capture().includes('Ctrl+E Expand desc'), 4000)
  );
}

/**
 * T15 — 区域焦点可见 + 底部提示严格按区域。
 *
 * 对应反馈：①切区「看不出来」——聚焦的标题条与未聚焦同色，唯一的线索被抹掉；
 * ②底部提示「有时联动、有时不展示」，跨区泄漏且会被瞬时通知顶掉。
 *
 * 断言：焦点标记跟着 Tab 走、同一帧只有一个区域带标记、带颜色的抓屏里聚焦区
 * 竖线颜色与未聚焦区不同；提示只讲当前区域；运行后结果区加入循环；通知不顶提示。
 */
async function t15FocusAndHints() {
  process.stdout.write('\n[T15] 区域焦点可见 + 提示按区域\n');
  const configDir = makeConfigDir({ mock: stdioService('mock') });

  await startSession({ configDir, cols: 100, rows: 34 });
  await sendText('v');
  await waitFor(() => capture().includes('PARAMETERS'));

  check('列表焦点：标题与提示都指向工具区', capture().includes('Quick Actions — Tools'));
  check('标题里不出现焦点箭头标记', !/▶ ▌/.test(capture()));

  await sendKey('Tab'); // → 描述区
  check(
    '焦点随 Tab 走到描述区（提示行给出区域名）',
    await waitFor(() => capture().includes('Quick Actions — Description'), 4000)
  );
  check(
    '提示只讲当前区域（不再跨区泄漏）',
    !capture().includes('Space Toggle'),
    `footer=${capture().split('\n').slice(-3).join(' | ')}`
  );
  check('切换焦点不添加任何标记字形', !/▶ ▌/.test(capture()));

  // 颜色对拍（不带 -e 的抓屏没有 SGR，这是唯一能看到焦点的办法）：
  // ①聚焦区的**标题文字**必须变色 —— 旧实现只把单个 `▌` 格子改成「终端默认色」，
  //   与旁边永远默认色的标题文字同色，等于没有高亮；
  // ②聚焦时竖线与标题文字取同一个颜色（整块标题区一起变），未聚焦则不是。
  const colored = captureColored();
  const focusedLabel = sgrBefore(colored, 'DESCRIPTION', 'DESCRIPTION');
  const focusedBar = sgrBefore(colored, 'DESCRIPTION', '▌');
  const idleLabel = sgrBefore(colored, 'PARAMETERS', 'PARAMETERS');
  const idleBar = sgrBefore(colored, 'PARAMETERS', '▌');
  check(
    '聚焦区标题文字变色（不只是那个竖线格子）',
    focusedLabel !== null && idleLabel !== null && focusedLabel !== idleLabel,
    `聚焦标题=${focusedLabel} 未聚焦标题=${idleLabel}`
  );
  check(
    '聚焦时整块标题区同色，未聚焦时不是',
    focusedBar === focusedLabel && idleBar !== idleLabel,
    `聚焦 竖线=${focusedBar} 标题=${focusedLabel} / 未聚焦 竖线=${idleBar} 标题=${idleLabel}`
  );

  // 运行：结果区加入循环，提示换成结果区自己的键
  await tabToFirstParam();
  await sendText('t15');
  await sendKey('C-r');
  const ran = await waitFor(() => capture().includes('Result: ✓'), 10_000);
  check('结果区加入循环（提示切到结果区）', ran && capture().includes('Quick Actions — Result'));
  check(
    '结果区提示只讲结果区',
    capture().includes('Ctrl+Y Copy result') && !capture().includes('Space Toggle')
  );

  // 瞬时通知占「标题行」位置：提示两行必须原样保留（旧实现会把整行顶掉 4 秒）
  await sendKey('C-y');
  const notice = await waitFor(() => /Copied|No clipboard utility/.test(capture()), 4000);
  check('复制通知出现', notice);
  check(
    '通知顶掉的是标题行，区域提示仍在',
    capture().includes('Ctrl+Y Copy result') && !capture().includes('Quick Actions —'),
    `footer=${capture().split('\n').slice(-3).join(' | ')}`
  );

  // 循环回到起点：结果 → 列表 → 描述 → 参数 → 结果
  await sendKey('Tab');
  check(
    '结果区 Tab 回到列表',
    await waitFor(() => capture().includes('Quick Actions — Tools'), 4000)
  );
  await sendKey('Tab');
  await sendKey('Tab');
  await sendKey('Tab');
  check(
    'Tab 循环含结果区并可回到它',
    await waitFor(() => capture().includes('Quick Actions — Result'), 4000)
  );
}

// --------------------------------------------------------------------- main

function assertFreshBuild() {
  if (!fs.existsSync(CLI)) {
    process.stderr.write('未找到 dist/cli.js —— 请先运行 npm run build\n');
    process.exit(1);
  }
  const stale = spawnSync('find', [path.join(ROOT, 'src'), '-newer', CLI, '-name', '*.ts*'], {
    encoding: 'utf8',
  })
    .stdout.trim()
    .split('\n')
    .filter(Boolean);
  if (stale.length > 0) {
    process.stderr.write(`dist 比源码旧（例如 ${stale[0]}）—— 请先运行 npm run build 再验证 TUI\n`);
    process.exit(1);
  }
}

async function main() {
  const tmuxVersion = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxVersion.status !== 0) {
    process.stdout.write(
      '跳过 TUI E2E：未安装 tmux（TUI 需要真实终端，无法在无 tmux 环境验证）' +
        (ALLOW_SKIP ? '［--allow-skip，按通过处理］' : '［返回码 2，不视为通过］') +
        '\n'
    );
    return ALLOW_SKIP ? 0 : 2;
  }
  assertFreshBuild();
  process.stdout.write(`TUI E2E：${tmuxVersion.stdout.trim()} · 私有 socket ${SOCKET}\n`);

  const scenarios = [
    t1ListLayout,
    t2NarrowTerminal,
    t3DeleteConfirm,
    t4OverwriteConfirm,
    t5CtrlSDoesNotPollute,
    t6CtrlCExits,
    t7PasteAndRun,
    t8ToolsView,
    t9ResultActions,
    t10ResultPaging,
    t11Cjk,
    t12ConfigPathAndSelfWriteNotice,
    t13SaveOutput,
    t14DescriptionScroll,
    t15FocusAndHints,
  ];

  for (const scenario of scenarios) {
    try {
      await scenario();
    } catch (error) {
      check(
        `${scenario.name} 未抛异常`,
        false,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      if (!KEEP) killServer();
    }
  }

  process.stdout.write(
    `\n${failures === 0 ? 'TUI E2E PASSED' : 'TUI E2E FAILED'}（${checks - failures}/${checks} 项断言通过）\n`
  );
  if (failures > 0) {
    process.stdout.write(`失败项：${failedLabels.join(' / ')}\n`);
  }
  return failures === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  process.stderr.write(
    `TUI E2E 异常终止：${error instanceof Error ? error.stack : String(error)}\n`
  );
} finally {
  if (!KEEP) killServer();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(exitCode);
