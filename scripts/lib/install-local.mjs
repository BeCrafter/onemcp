/**
 * install-local.mjs — 共享的"编译 → npm 打包 → 全局安装"管道。
 *
 * 被 deploy:local（部署到 :5625 daemon）与 verify:local（独立实例 E2E）共用，
 * 保证两者验证的都是"从当前源码打包出来的真实 npm 包"：
 *   1. npm run build（内置 clean，dist 全新）
 *   2. 产物新鲜度断言（dist/cli.js mtime 晚于构建开始时间）
 *   3. npm pack 打 tarball（遵循 files 字段过滤）
 *   4. npm install -g <tarball>（全局 node_modules 真实副本，完整替代旧命令）
 *   5. 安装形态硬校验（realpath 必须落在 npm root -g 内，防软链式假安装）
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveBin() {
  try {
    return execSync('command -v onemcp', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * 构建并断言产物新鲜度，然后打包并全局安装。
 * @returns {{ tarball: string, bin: string }}
 */
export async function buildPackAndInstall(root, log = () => {}) {
  const startedAt = new Date();
  log('building (clean + npm run build)...');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });

  const cliJs = path.join(root, 'dist', 'cli.js');
  if (!fs.existsSync(cliJs)) {
    throw new Error('build 未产出 dist/cli.js');
  }
  if (fs.statSync(cliJs).mtimeMs < startedAt.getTime() - 1000) {
    throw new Error('dist/cli.js 的修改时间早于构建开始时间——疑似部署了历史产物，中止');
  }
  log('artifact freshness OK');

  log('packing (npm pack)...');
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onemcp-pack-'));
  let tarball;
  try {
    const out = execSync(`npm pack --json --pack-destination "${packDir}"`, {
      cwd: root,
      encoding: 'utf8',
    });
    const packed = JSON.parse(out)[0];
    tarball = path.join(packDir, packed.filename);
    if (!fs.existsSync(tarball)) {
      throw new Error(`npm pack did not produce ${tarball}`);
    }

    log(`installing globally from tarball (npm install -g ${packed.filename})...`);
    execSync(`npm install -g "${tarball}"`, { cwd: root, stdio: 'inherit' });

    const bin = resolveBin();
    if (!bin) {
      throw new Error('onemcp binary not found on PATH after global install');
    }
    const realBin = fs.realpathSync(bin);
    const realGlobalRoot = fs.realpathSync(execSync('npm root -g', { encoding: 'utf8' }).trim());
    if (!realBin.startsWith(realGlobalRoot + path.sep)) {
      throw new Error(
        `安装形态校验失败：onemcp 解析到 ${realBin}，不在全局 node_modules（${realGlobalRoot}）内。` +
          `全局安装可能仍是仓库软链（npm link 式），请检查。`
      );
    }
    log(`install shape OK: ${bin} → ${realBin}`);

    // tarball 已装入全局 node_modules，临时目录可清理
    fs.rmSync(packDir, { recursive: true, force: true });
    return { tarball, bin };
  } catch (err) {
    fs.rmSync(packDir, { recursive: true, force: true });
    throw err;
  }
}
