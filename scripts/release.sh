#!/usr/bin/env bash
# onemcp 发布脚本 —— 版本号唯一来源是 git tag(只读,不创建/推送)。
# 发布前预检(lint / typecheck / test / build),强制走官方 registry,支持 --dry-run。
#
# 用法:
#   ./scripts/release.sh            # CI:版本取自当前 git tag(如 v1.2.3)
#   ./scripts/release.sh 1.2.3      # 本地:显式指定版本(不创建/推送 tag)
#   ./scripts/release.sh --dry-run  # 只预检 + npm publish --dry-run,不真发
#
# 环境变量:
#   NPM_REGISTRY  覆盖发布目标 registry(默认 https://registry.npmjs.org/)
#   CI=true 时依赖 NODE_AUTH_TOKEN(由 setup-node 注入 .npmrc),跳过交互登录。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org/}"
export NPM_REGISTRY

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${CYAN}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
die()  { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

DRY_RUN=false
VERSION_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) VERSION_ARG="$arg" ;;
  esac
done

# ── 版本号:唯一来源是 git tag(只读),本地可用参数显式指定 ──
if [[ -n "$VERSION_ARG" ]]; then
  VERSION="${VERSION_ARG#v}"
else
  TAG="$(git describe --tags --exact-match 2>/dev/null || echo "")"
  [[ -n "$TAG" ]] || die "当前 HEAD 无 tag;CI 需由 tag 触发,本地请显式指定版本: ./scripts/release.sh 1.2.3"
  VERSION="${TAG#v}"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.\-]+)?$ ]] || die "非法版本号: $VERSION"

# ── npm tag:latest / dev / alpha / beta / rc / next ──
case "$VERSION" in
  *-dev.*)    NPM_TAG=dev ;;
  *-alpha.*)  NPM_TAG=alpha ;;
  *-beta.*)   NPM_TAG=beta ;;
  *-rc.*)     NPM_TAG=rc ;;
  *-*)        NPM_TAG=next ;;
  *)          NPM_TAG=latest ;;
esac

# ── 预检:官方 registry + 本地 npm 配置提示 ──
info "版本 $VERSION → npm tag $NPM_TAG(registry: $NPM_REGISTRY)$($DRY_RUN && echo ' [dry-run]')"
LOCAL_REG="$(npm config get registry 2>/dev/null | tr -d '\r')"
if [[ -n "$LOCAL_REG" && "$LOCAL_REG" != "$NPM_REGISTRY" && "$LOCAL_REG" != "undefined" && "$LOCAL_REG" != "null" ]]; then
  warn "本地默认 registry 指向 $LOCAL_REG(非官方);发布强制走官方 $NPM_REGISTRY"
fi

npm ci || die "npm ci 失败"
# 同步 package.json / package-lock.json 版本与 tag(只改本地文件,不创建/推送 git tag;
# --dry-run 同样同步以便预览准确,结束后可 git checkout -- package.json 还原)
npm version "$VERSION" --no-git-tag-version --allow-same-version || die "同步版本失败"
npm run lint || die "lint 失败"
npm run typecheck || die "typecheck 失败"
# 集成测试会 spawn dist/cli.js,必须先 build 再 test(与 CI 的 build→test 顺序一致)
npm run build || die "build 失败"
npm test || die "test 失败"

# ── 发布(强制官方 registry)──
if $DRY_RUN; then
  info "dry-run: npm publish --dry-run,不真发"
  npm publish --access public --tag "$NPM_TAG" --registry "$NPM_REGISTRY" --dry-run
else
  npm publish --access public --tag "$NPM_TAG" --registry "$NPM_REGISTRY"
fi
ok "版本 $VERSION 发布完成(tag: $NPM_TAG)"
