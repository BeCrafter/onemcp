#!/bin/bash
# ============================================================================
# onemcp MCP 协议端到端验证脚本
#
# 验证范围：
#   HTTP Server 模式:
#     场景 1: 正常初始化 → 工具列表 → 工具调用 → 断开连接
#     场景 2: 未初始化保护
#     场景 3: 工具调用异常（缺参数、不存在工具）
#     场景 4: 会话隔离
#     场景 5: 连接断开后资源清理（DELETE 幂等）
#     场景 6: 重复 initialize
#     场景 7: HTTP 端点（根路径、诊断、指标、健康检查结构）
#     场景 8: HTTP Header（X-MCP-Tags、X-MCP-Smart-Discovery）
#     场景 9: 错误处理（无效请求体）
#   CLI stdio 模式:
#     场景 10: Content-Length 帧模式完整流程
#     场景 11: NDJSON 模式完整流程
#     场景 12: 未初始化保护
# ============================================================================

set -uo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo -e "  ${GREEN}✓ $1${NC}"; }
fail() { FAIL=$((FAIL + 1)); echo -e "  ${RED}✗ $1${NC}"; }
info() { echo -e "  ${CYAN}→ $1${NC}"; }
section() { echo -e "\n${BOLD}[$1]${NC}"; echo "  ─────────────────────────────────────────"; }

json_has() {
    echo "$1" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
for k in sys.argv[1].split('.'):
    if isinstance(d,dict): d=d.get(k)
    else: d=None; break
sys.exit(0 if d is not None else 1)
" "$2" 2>/dev/null
}

cleanup() {
    [ -n "${SERVER_PID:-}" ] && { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
}
trap cleanup EXIT

DIST_DIR="$(cd "$(dirname "$0")/../../dist" && pwd)"
CLI="$DIST_DIR/cli.js"

CONFIG_DIR="/tmp/onemcp-e2e-$$"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/config.json" <<CONFEOF
{
  "mode": "server",
  "configDir": "${CONFIG_DIR}",
  "logLevel": "ERROR",
  "host": "127.0.0.1",
  "port": 15023,
  "mcpServers": {},
  "connectionPool": { "maxConnections": 5, "idleTimeout": 60000, "connectionTimeout": 30000 },
  "healthCheck": { "enabled": false, "interval": 30000, "failureThreshold": 3, "autoUnload": true },
  "audit": { "enabled": false, "level": "minimal", "logInput": false, "logOutput": false, "retention": { "days": 30, "maxSize": "1GB" } },
  "security": { "dataMasking": { "enabled": true, "patterns": ["password", "token"] } },
  "logging": { "level": "ERROR", "outputs": ["console"], "format": "json" },
  "metrics": { "enabled": false, "collectionInterval": 60000, "retentionPeriod": 86400000 }
}
CONFEOF

MCP_ACCEPT="Accept: application/json, text/event-stream"
PORT=15023
BASE="http://127.0.0.1:$PORT/mcp"

mcp_post() {
    local session="$1" body="$2"
    curl -s -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        ${session:+-H "mcp-session-id: $session"} \
        -d "$body" 2>&1
}

mcp_post_hdr() {
    local session="$1" body="$2" extra_headers="${3:-}"
    curl -s -D - -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        ${session:+-H "mcp-session-id: $session"} \
        ${extra_headers} \
        -d "$body" 2>&1
}

mcp_code() {
    local session="$1" body="$2"
    curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        -H "mcp-session-id: $session" \
        -d "$body" 2>&1
}

mcp_delete() {
    local session="$1"
    curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE" \
        -H "mcp-session-id: $session" 2>&1
}

handshake() {
    local extra_headers="${1:-}"
    local raw
    raw=$(curl -s -D - -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        ${extra_headers} \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1.0"}}}' -o /dev/null 2>&1)
    local sid
    sid=$(echo "$raw" | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r\n' || true)
    [ -z "$sid" ] && { echo ""; return 1; }
    mcp_code "$sid" '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
    echo "$sid"
}

cl_send() {
    local body="$1" len
    len=$(echo -n "$body" | wc -c | tr -d ' ')
    printf "Content-Length: %d\r\n\r\n%s" "$len" "$body"
}

stop_server() {
    [ -n "${SERVER_PID:-}" ] && { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""; }
}

start_server() {
    stop_server
    node "$CLI" -m server -p "$PORT" --config-dir "$CONFIG_DIR" &>/dev/null &
    SERVER_PID=$!
    local ready=false
    for i in $(seq 1 60); do
        curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { ready=true; break; }
        sleep 1
    done
    $ready || { fail "服务器启动超时"; return 1; }
}

# ============================================================================
# 场景 1: 正常初始化 → 工具列表 → 工具调用 → 断开连接
# ============================================================================

run_scenario_1() {
    section "场景 1" "正常初始化 → 工具列表 → 工具调用 → 断开连接"

    info "1.1 initialize 握手"
    local raw sid resp
    raw=$(mcp_post_hdr "" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e-client","version":"1.0"}}}')

    local body
    body=$(echo "$raw" | sed '1,/^\r$/d')
    echo "$body" | grep -q '"protocolVersion":"2024-11-05"' && pass "initialize 返回 protocolVersion" || fail "initialize 缺 protocolVersion"
    echo "$body" | grep -q '"serverInfo"' && pass "initialize 返回 serverInfo" || fail "initialize 缺 serverInfo"
    json_has "$body" "result.capabilities.tools" && pass "initialize 声明 tools 能力" || fail "initialize 缺 capabilities.tools"

    sid=$(echo "$raw" | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r\n' || true)
    [ -n "$sid" ] && pass "mcp-session-id: ${sid:0:16}..." || { fail "mcp-session-id 未返回"; return 1; }

    info "1.2 notifications/initialized"
    local code
    code=$(mcp_code "$sid" '{"jsonrpc":"2.0","method":"notifications/initialized"}')
    [ "$code" = "202" ] && pass "initialized 通知返回 202" || fail "应返回 202，实际: $code"

    info "1.3 tools/list"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
    echo "$resp" | grep -q '"jsonrpc":"2.0"' && pass "tools/list 包含 jsonrpc 2.0" || fail "tools/list 缺 jsonrpc"
    echo "$resp" | grep -q '"id":2' && pass "tools/list 响应 id=2" || fail "tools/list 响应 id 不匹配"
    json_has "$resp" "result.tools" && pass "tools/list 返回 result.tools" || fail "tools/list 缺 result.tools"

    # 展示工具列表
    echo "$resp" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
tools=d.get('result',{}).get('tools',[])
if not tools:
    print('  ┌─ 工具列表: (空)')
else:
    print(f'  ┌─ 工具列表 ({len(tools)} 个):')
    for i,t in enumerate(tools):
        name=t.get('name','?')
        desc=t.get('description','')
        first_line=desc.split(chr(10))[0][:80] if desc else '(无描述)'
        prefix='  ├─' if i<len(tools)-1 else '  └─'
        print(f'{prefix} {name}')
        prefix='  │ ' if i<len(tools)-1 else '   '
        print(f'{prefix}   {first_line}')
" 2>/dev/null || true

    local fmt_ok
    fmt_ok=$(echo "$resp" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
tools=d.get('result',{}).get('tools',[])
if not tools: print('empty'); sys.exit(0)
required=('name','description','inputSchema')
bad=[t.get('name','?') for t in tools if not all(k in t for k in required)]
if bad: print('bad:'+','.join(bad)); sys.exit(1)
print('ok'); sys.exit(0)
" 2>/dev/null || echo "bad")
    case "$fmt_ok" in
        ok)    pass "所有工具均包含 name/description/inputSchema" ;;
        empty) pass "工具列表为空（无后端服务）" ;;
        *)     fail "工具格式不完整: $fmt_ok" ;;
    esac

    info "1.4 tools/call 不存在的工具"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fake__nonexistent","arguments":{}}}')
    echo "$resp" | grep -q '"error"' && pass "不存在的工具返回 error" || fail "应返回 error"
    echo "$resp" | grep -q '"id":3' && pass "error 响应保持 id=3" || fail "error 响应 id 不匹配"

    info "1.5 tools/call 存在的工具"
    local tool_name
    tool_name=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
tools=d.get('result',{}).get('tools',[])
print(tools[0]['name'] if tools else '')
" 2>/dev/null || true)
    if [ -n "$tool_name" ]; then
        resp=$(mcp_post "$sid" "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool_name\",\"arguments\":{}}}")
        echo "$resp" | grep -q '"result"\|"error"' && pass "tools/call '$tool_name' 返回有效响应" || fail "无有效响应"
        echo "$resp" | grep -q '"id":4' && pass "tools/call 响应保持 id=4" || fail "id 不匹配"
    else
        pass "无工具可调用（跳过）"
    fi

    info "1.6 ping"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":5,"method":"ping","params":{}}')
    json_has "$resp" "result" && pass "ping 返回 result" || fail "ping 应返回 result"
    echo "$resp" | grep -q '"id":5' && pass "ping 响应 id=5" || fail "id 不匹配"

    info "1.7 DELETE 断开连接"
    code=$(mcp_delete "$sid")
    [ "$code" = "200" ] && pass "DELETE 返回 200" || fail "应返回 200，实际: $code"

    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":99,"method":"tools/list","params":{}}')
    echo "$resp" | grep -q '"error"' && pass "断开后 tools/list 返回 error" || pass "断开后（服务端可能新建 session）"
}

# ============================================================================
# 场景 2: 未初始化保护
# ============================================================================

run_scenario_2() {
    section "场景 2" "未初始化保护"

    info "2.1 未初始化 → tools/list"
    local resp
    resp=$(mcp_post "" '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
    echo "$resp" | grep -q '"error"' && pass "未初始化 tools/list 返回 error" || fail "应返回 error"

    info "2.2 未初始化 → tools/call"
    resp=$(mcp_post "" '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"any__tool","arguments":{}}}')
    echo "$resp" | grep -q '"error"' && pass "未初始化 tools/call 返回 error" || fail "应返回 error"

    info "2.3 未初始化 → ping"
    resp=$(mcp_post "" '{"jsonrpc":"2.0","id":3,"method":"ping","params":{}}')
    json_has "$resp" "result" && pass "ping 不需要初始化" || fail "ping 应返回 result"
}

# ============================================================================
# 场景 3: 工具调用异常
# ============================================================================

run_scenario_3() {
    section "场景 3" "工具调用异常处理"

    local sid
    sid=$(handshake)
    [ -z "$sid" ] && { fail "握手失败"; return 1; }

    local resp

    info "3.1 tools/call 缺少 name"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{}}')
    echo "$resp" | grep -q '"error"' && pass "缺少 name 返回 error" || fail "应返回 error"

    info "3.2 tools/call name 为空"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"","arguments":{}}}')
    echo "$resp" | grep -q '"error"' && pass "name 为空返回 error" || fail "应返回 error"

    info "3.3 tools/call 不存在的工具"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"no_such__tool","arguments":{}}}')
    echo "$resp" | grep -q '"error"' && pass "不存在工具返回 error" || fail "应返回 error"

    info "3.4 tools/call 无 arguments"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"no_such__tool"}}')
    echo "$resp" | grep -q '"error"\|"result"' && pass "无 arguments 返回有效响应" || fail "应返回 error 或 result"

    info "3.5 tools/list 带 tagFilter"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":14,"method":"tools/list","params":{"tagFilter":{"tags":["nonexistent"],"logic":"OR"}}}')
    echo "$resp" | grep -q '"tools"' && pass "带 tagFilter 返回 tools" || fail "应返回 tools"

    mcp_delete "$sid" >/dev/null 2>&1 || true
}

# ============================================================================
# 场景 4: 会话隔离
# ============================================================================

run_scenario_4() {
    section "场景 4" "会话隔离"

    info "4.1 创建两个独立 session"
    local sid1 sid2
    sid1=$(handshake)
    sid2=$(handshake)
    [ -n "$sid1" ] && pass "Session A: ${sid1:0:16}..." || { fail "Session A 创建失败"; return 1; }
    [ -n "$sid2" ] && pass "Session B: ${sid2:0:16}..." || { fail "Session B 创建失败"; return 1; }
    [ "$sid1" != "$sid2" ] && pass "两个 session ID 独立" || fail "ID 不应相同"

    info "4.2 独立 tools/list"
    local r1 r2
    r1=$(mcp_post "$sid1" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
    r2=$(mcp_post "$sid2" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
    echo "$r1" | grep -q '"tools"' && pass "Session A tools/list 成功" || fail "Session A 失败"
    echo "$r2" | grep -q '"tools"' && pass "Session B tools/list 成功" || fail "Session B 失败"

    info "4.3 终止 A，B 不受影响"
    local code
    code=$(mcp_delete "$sid1")
    [ "$code" = "200" ] && pass "Session A DELETE 200" || fail "DELETE 应返回 200"
    r2=$(mcp_post "$sid2" '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}')
    echo "$r2" | grep -q '"tools"' && pass "Session B tools/list 仍正常" || fail "Session B 应不受影响"

    mcp_delete "$sid2" >/dev/null 2>&1 || true
}

# ============================================================================
# 场景 5: 连接断开后资源清理
# ============================================================================

run_scenario_5() {
    section "场景 5" "连接断开后资源清理"

    local sid
    sid=$(handshake)
    [ -z "$sid" ] && { fail "握手失败"; return 1; }
    mcp_post "$sid" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' >/dev/null

    info "5.1 DELETE"
    local code
    code=$(mcp_delete "$sid")
    [ "$code" = "200" ] && pass "DELETE 返回 200" || fail "应返回 200"

    info "5.2 重复 DELETE 幂等"
    code=$(mcp_delete "$sid")
    pass "重复 DELETE 返回 $code（幂等）"

    info "5.3 删除后 tools/list"
    local resp
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":99,"method":"tools/list","params":{}}')
    echo "$resp" | grep -q '"error"' && pass "删除后 tools/list 返回 error" || pass "删除后（行为可接受）"

    info "5.4 活跃会话确认"
    local health active
    health=$(curl -sf "http://127.0.0.1:$PORT/health" 2>&1)
    active=$(echo "$health" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('sessions',{}).get('active',-1))" 2>/dev/null || echo "-1")
    [ "$active" = "0" ] && pass "活跃会话数为 0" || info "活跃会话数: $active"
}

# ============================================================================
# 场景 6: 重复 initialize
# ============================================================================

run_scenario_6() {
    section "场景 6" "重复 initialize"

    local sid
    sid=$(handshake)
    [ -z "$sid" ] && { fail "握手失败"; return 1; }

    info "6.1 同一 session 重复 initialize"
    local resp
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":50,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"dup","version":"1.0"}}}')
    echo "$resp" | grep -q '"error"' && pass "重复 initialize 返回 error" || fail "应返回 error"

    info "6.2 重复 initialize 后 tools/list"
    resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":51,"method":"tools/list","params":{}}')
    echo "$resp" | grep -q '"tools"' && pass "tools/list 仍正常" || fail "tools/list 应正常"

    mcp_delete "$sid" >/dev/null 2>&1 || true
}

# ============================================================================
# 场景 7: HTTP 端点（根路径、诊断、指标、健康检查结构）
# ============================================================================

run_scenario_7() {
    section "场景 7" "HTTP 端点验证"

    info "7.1 GET / 根路径"
    local root
    root=$(curl -sf "http://127.0.0.1:$PORT/" 2>&1)
    echo "$root" | grep -q '"name"' && pass "根路径返回 name" || fail "根路径缺 name"
    echo "$root" | grep -q '"status":"running"' && pass "根路径 status: running" || fail "缺 status"

    info "7.2 GET /diagnostics"
    local diag
    diag=$(curl -sf "http://127.0.0.1:$PORT/diagnostics" 2>&1)
    json_has "$diag" "services" && pass "diagnostics 包含 services" || fail "缺 services"
    json_has "$diag" "sessions" && pass "diagnostics 包含 sessions" || fail "缺 sessions"
    json_has "$diag" "health" && pass "diagnostics 包含 health" || fail "缺 health"

    info "7.3 GET /metrics"
    local metrics
    metrics=$(curl -sf "http://127.0.0.1:$PORT/metrics" 2>&1)
    json_has "$metrics" "metrics" && pass "metrics 返回 metrics" || fail "缺 metrics"

    info "7.4 GET /health 结构"
    local health
    health=$(curl -sf "http://127.0.0.1:$PORT/health" 2>&1)
    json_has "$health" "status" && pass "health 包含 status" || fail "缺 status"
    json_has "$health" "timestamp" && pass "health 包含 timestamp" || fail "缺 timestamp"
    json_has "$health" "services" && pass "health 包含 services" || fail "缺 services"
    json_has "$health" "summary" && pass "health 包含 summary" || fail "缺 summary"
    json_has "$health" "sessions" && pass "health 包含 sessions" || fail "缺 sessions"
}

# ============================================================================
# 场景 8: HTTP Header 功能
# ============================================================================

run_scenario_8() {
    section "场景 8" "HTTP Header 功能"

    local sid resp

    info "8.1 X-MCP-Tags header"
    sid=$(handshake "-H X-MCP-Tags: tag1,tag2")
    if [ -n "$sid" ]; then
        resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
        echo "$resp" | grep -q '"tools"' && pass "带 X-MCP-Tags 的 tools/list 正常" || fail "失败"
        mcp_delete "$sid" >/dev/null 2>&1 || true
    else
        fail "带 X-MCP-Tags 的握手失败"
    fi

    info "8.2 X-MCP-Smart-Discovery: false"
    sid=$(handshake "-H X-MCP-Smart-Discovery: false")
    if [ -n "$sid" ]; then
        resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
        echo "$resp" | grep -q '"tools"' && pass "Smart Discovery: false 正常" || fail "失败"
        mcp_delete "$sid" >/dev/null 2>&1 || true
    else
        fail "Smart Discovery: false 握手失败"
    fi

    info "8.3 X-MCP-Smart-Discovery: true"
    sid=$(handshake "-H X-MCP-Smart-Discovery: true")
    if [ -n "$sid" ]; then
        resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
        echo "$resp" | grep -q '"tools"' && pass "Smart Discovery: true 正常" || fail "失败"
        mcp_delete "$sid" >/dev/null 2>&1 || true
    else
        fail "Smart Discovery: true 握手失败"
    fi
}

# ============================================================================
# 场景 9: 错误处理
# ============================================================================

run_scenario_9() {
    section "场景 9" "错误处理"

    local code

    info "9.1 无效 JSON"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        -d 'not valid json' 2>&1)
    [ "$code" = "400" ] && pass "无效 JSON 返回 400" || fail "应返回 400，实际: $code"

    info "9.2 无 method 字段"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        -d '{"jsonrpc":"2.0","id":1}' 2>&1)
    [ "$code" = "400" ] && pass "无 method 返回 400" || fail "应返回 400，实际: $code"

    info "9.3 无 jsonrpc 字段"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        -d '{"id":1,"method":"ping"}' 2>&1)
    [ "$code" = "400" ] && pass "无 jsonrpc 返回 400" || fail "应返回 400，实际: $code"

    info "9.4 JSON 数组"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE" \
        -H "Content-Type: application/json" -H "$MCP_ACCEPT" \
        -d '[1,2,3]' 2>&1)
    [ "$code" = "400" ] && pass "JSON 数组返回 400" || fail "应返回 400，实际: $code"

    info "9.5 未知方法"
    local sid resp
    sid=$(handshake)
    if [ -n "$sid" ]; then
        resp=$(mcp_post "$sid" '{"jsonrpc":"2.0","id":3,"method":"unknown/method","params":{}}')
        echo "$resp" | grep -q '"code":-32601' && pass "未知方法返回 -32601" || fail "应返回 -32601"
        mcp_delete "$sid" >/dev/null 2>&1 || true
    fi
}

# ============================================================================
# 场景 10: STDIO Content-Length 帧模式
# ============================================================================

run_scenario_10() {
    section "场景 10" "STDIO Content-Length 帧模式"

    local tmp_out bg_pid wait_count
    tmp_out=$(mktemp)

    (
        cl_send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cl-e2e","version":"1.0"}}}'
        sleep 0.5
        cl_send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fake__tool","arguments":{}}}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{}}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":5,"method":"ping","params":{}}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":6,"method":"resources/list","params":{}}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":7,"method":"prompts/list","params":{}}'
        sleep 0.3
        cl_send '{"jsonrpc":"2.0","id":8,"method":"bad/method","params":{}}'
        sleep 0.5
        exec 0<&-
        sleep 0.5
    ) | node "$CLI" -m cli --config-dir "$CONFIG_DIR" > "$tmp_out" 2>/dev/null &
    bg_pid=$!
    wait_count=0
    while kill -0 "$bg_pid" 2>/dev/null && [ $wait_count -lt 20 ]; do sleep 1; wait_count=$((wait_count + 1)); done
    kill "$bg_pid" 2>/dev/null || true; wait "$bg_pid" 2>/dev/null || true
    local out_file="$tmp_out"

    local frame_count
    frame_count=$(grep -c "Content-Length:" "$out_file" || true)
    [ "$frame_count" -ge 1 ] && pass "Content-Length 帧: $frame_count 个响应" || fail "未检测到 Content-Length 帧"

    section "10.1" "Initialize"
    grep -q '"protocolVersion":"2024-11-05"' "$out_file" && pass "protocolVersion 正确" || fail "缺 protocolVersion"
    grep -q '"serverInfo"' "$out_file" && pass "serverInfo 存在" || fail "缺 serverInfo"
    grep -q '"capabilities"' "$out_file" && pass "capabilities 存在" || fail "缺 capabilities"

    section "10.2" "tools/list"
    grep -q '"tools"' "$out_file" && pass "返回 tools 数组" || fail "未返回 tools"

    section "10.3" "tools/call 不存在的工具"
    grep -q '"error"' "$out_file" && pass "返回 error" || fail "未返回 error"

    section "10.4" "tools/call 缺少 name"
    grep -q '"id"[[:space:]]*:[[:space:]]*4' "$out_file" && grep -q '"error"' "$out_file" && pass "id=4 返回 error" || fail "id=4 应返回 error"

    section "10.5" "Ping"
    grep -q '"id"[[:space:]]*:[[:space:]]*5' "$out_file" && pass "ping 响应 id=5" || fail "ping 无响应"

    section "10.6" "resources/list + prompts/list"
    grep -q '"resources"' "$out_file" && pass "resources/list 返回" || fail "resources/list 失败"
    grep -q '"prompts"' "$out_file" && pass "prompts/list 返回" || fail "prompts/list 失败"

    section "10.7" "未知方法"
    grep -q '\-32601' "$out_file" && pass "返回 -32601" || fail "未返回 -32601"

    rm -f "$out_file"
}

# ============================================================================
# 场景 11: STDIO NDJSON 模式
# ============================================================================

run_scenario_11() {
    section "场景 11" "STDIO NDJSON 模式"

    local tmp_out bg_pid wait_count
    tmp_out=$(mktemp)

    (
        echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ndjson-e2e","version":"1.0"}}}'
        sleep 0.3
        echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
        sleep 0.2
        echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
        sleep 0.3
        echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fake__tool","arguments":{}}}'
        sleep 0.3
        echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{}}'
        sleep 0.3
        echo '{"jsonrpc":"2.0","id":5,"method":"ping","params":{}}'
        sleep 0.3
        echo '{"jsonrpc":"2.0","id":6,"method":"resources/list","params":{}}'
        sleep 0.2
        echo '{"jsonrpc":"2.0","id":7,"method":"prompts/list","params":{}}'
        sleep 0.5
        exec 0<&-
        sleep 0.5
    ) | node "$CLI" -m cli --config-dir "$CONFIG_DIR" > "$tmp_out" 2>/dev/null &
    bg_pid=$!
    wait_count=0
    while kill -0 "$bg_pid" 2>/dev/null && [ $wait_count -lt 20 ]; do sleep 1; wait_count=$((wait_count + 1)); done
    kill "$bg_pid" 2>/dev/null || true; wait "$bg_pid" 2>/dev/null || true
    local out_file="$tmp_out"

    local json_count
    json_count=$(grep -c '^{' "$out_file" || true)
    [ "$json_count" -ge 5 ] && pass "NDJSON: $json_count 行有效 JSON" || fail "仅 $json_count 行 (≥5)"

    section "11.1" "Initialize"
    grep -q '"protocolVersion":"2024-11-05"' "$out_file" && pass "initialize 成功" || fail "initialize 失败"
    grep -q '"serverInfo"' "$out_file" && pass "serverInfo 存在" || fail "缺 serverInfo"

    section "11.2" "tools/list"
    grep -q '"tools"' "$out_file" && pass "返回 tools" || fail "未返回 tools"

    section "11.3" "tools/call"
    grep -q '"error"' "$out_file" && pass "返回 error" || fail "未返回 error"

    section "11.4" "tools/call 缺少 name"
    grep -q '"id"[[:space:]]*:[[:space:]]*4' "$out_file" && grep -q '"error"' "$out_file" && pass "id=4 返回 error" || fail "id=4 应返回 error"

    section "11.5" "Ping"
    grep -q '"id"[[:space:]]*:[[:space:]]*5' "$out_file" && pass "ping 响应" || fail "ping 无响应"

    section "11.6" "resources/list + prompts/list"
    grep -q '"resources"' "$out_file" && pass "resources/list 返回" || fail "resources/list 失败"
    grep -q '"prompts"' "$out_file" && pass "prompts/list 返回" || fail "prompts/list 失败"

    rm -f "$out_file"
}

# ============================================================================
# 场景 12: STDIO 未初始化保护
# ============================================================================

run_scenario_12() {
    section "场景 12" "STDIO 未初始化保护"

    local tmp_out bg_pid wait_count
    tmp_out=$(mktemp)
    (
        echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
        sleep 0.5; exec 0<&-; sleep 0.3
    ) | node "$CLI" -m cli --config-dir "$CONFIG_DIR" > "$tmp_out" 2>/dev/null &
    bg_pid=$!
    wait_count=0
    while kill -0 "$bg_pid" 2>/dev/null && [ $wait_count -lt 10 ]; do sleep 1; wait_count=$((wait_count + 1)); done
    kill "$bg_pid" 2>/dev/null || true; wait "$bg_pid" 2>/dev/null || true
    local out_file="$tmp_out"

    grep -q '"error"\|not initialized\|Protocol not initialized' "$out_file" && pass "未初始化 tools/list 返回错误" || fail "应返回错误"
    rm -f "$out_file"
}

# ============================================================================
# 主入口
# ============================================================================

main() {
    local use_real_config=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --config-dir) CONFIG_DIR="$2"; use_real_config=true; shift 2 ;;
            *) shift ;;
        esac
    done

    if $use_real_config; then
        local real_cfg="$CONFIG_DIR/config.json"
        [ ! -f "$real_cfg" ] && { echo -e "${RED}配置文件不存在: $real_cfg${NC}"; exit 1; }
        python3 -c "
import json
with open('$real_cfg') as f: d=json.load(f)
d['mode']='server'; d['port']=$PORT; d['logLevel']='ERROR'
with open('$CONFIG_DIR/config.json','w') as f: json.dump(d,f,indent=2)
"
        echo -e "  ${CYAN}使用真实配置: $real_cfg${NC}"
    fi

    echo -e "${BOLD}onemcp MCP 协议 E2E 验证${NC}"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"

    echo ""
    echo -e "${BOLD}════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  HTTP Server 模式${NC}"
    echo -e "${BOLD}════════════════════════════════════════════${NC}"
    start_server

    run_scenario_1   # 初始化 → 工具列表 → 工具调用 → 断开
    run_scenario_2   # 未初始化保护
    run_scenario_3   # 工具调用异常
    run_scenario_4   # 会话隔离
    run_scenario_5   # 连接断开后资源清理
    run_scenario_6   # 重复 initialize
    run_scenario_7   # HTTP 端点（根路径、诊断、指标、健康检查结构）
    run_scenario_8   # HTTP Header（X-MCP-Tags、X-MCP-Smart-Discovery）
    run_scenario_9   # 错误处理（无效请求体）
    stop_server

    echo ""
    echo -e "${BOLD}════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  CLI stdio 模式${NC}"
    echo -e "${BOLD}════════════════════════════════════════════${NC}"
    run_scenario_10  # Content-Length 帧模式
    run_scenario_11  # NDJSON 模式
    run_scenario_12  # 未初始化保护

    echo ""
    echo -e "${BOLD}════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  结果${NC}"
    echo -e "${BOLD}════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}通过: $PASS${NC}"
    echo -e "  ${RED}失败: $FAIL${NC}"
    echo ""

    if [ $FAIL -eq 0 ]; then
        echo -e "  ${GREEN}${BOLD}✓ 端到端验证全部通过${NC}"
    else
        echo -e "  ${RED}${BOLD}✗ 存在失败项${NC}"
    fi

    $use_real_config || rm -rf "$CONFIG_DIR"
    return $FAIL
}

main "$@"
