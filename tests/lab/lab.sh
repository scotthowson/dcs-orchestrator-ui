#!/usr/bin/env bash
# =============================================================================
# The dashboard's test lab: a mock Proxmox, a hub API, a member API and a fresh
# (never set up) API for the setup wizard — throwaway copies of the AIO
# repository, never the real one — and the Vite dev server of this checkout.
# Nothing here talks to a real Docker daemon: the APIs run with tests/lab/bin
# first on their PATH, whose `docker` answers the read-only calls from a fixed
# set of containers and refuses everything that changes state.
#
#   tests/lab/lab.sh start     # build the lab (first run) and start everything
#   tests/lab/lab.sh stop      # stop what `start` started (by the PIDs it saved)
#   tests/lab/lab.sh status
#
# Environment: AIO (the AIO checkout to copy, read-only), LAB (where the lab
# lives, default /tmp/dcs-ui-lab), PVE_PORT (28021), HUB_PORT (41921),
# MEMBER_PORT (41922), FRESH_PORT (41923), UI_PORT (3021). The lab admin on the
# hub and the member is lab / Lab-Only-Pass-123 — a throwaway account of a
# throwaway install.
# =============================================================================

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT="$(cd "$HERE/../.." && pwd)"
AIO="${AIO:-/mnt/linux_drive/GitHub/scotthowson/Docker-Compose-Skeleton-AIO}"
LAB="${LAB:-/tmp/dcs-ui-lab}"
PVE_PORT="${PVE_PORT:-28021}"
HUB_PORT="${HUB_PORT:-41921}"
MEMBER_PORT="${MEMBER_PORT:-41922}"
FRESH_PORT="${FRESH_PORT:-41923}"
UI_PORT="${UI_PORT:-3021}"
LAB_USER=lab
LAB_PASS='Lab-Only-Pass-123'
PVE_TOKEN_ID='dcs@pve!smoke'
PVE_SECRET='smoke-secret'

log() { printf '[lab] %s\n' "$*"; }

# a minimal DCS install (the way tests/smoke.sh builds one), with three demo stacks
make_install() {
    local dir="$1" port="$2" role="$3" s
    [[ -f "$dir/.scripts/api-server.sh" ]] && return 0
    log "building the $role install in $dir"
    mkdir -p "$dir/.scripts" "$dir/.lib" "$dir/.config" "$dir/Stacks" "$dir/.data" "$dir/logs" "$dir/.api-auth" "$dir/.templates" "$dir/.plugins-catalog" "$dir/docs"
    cp -r "$AIO/.scripts/." "$dir/.scripts/"
    cp -r "$AIO/.lib/." "$dir/.lib/"
    cp "$AIO/.config/schema.json" "$AIO/.config/template-gallery.json" "$AIO/.config/palette.sh" "$dir/.config/" 2>/dev/null || true
    cp -r "$AIO/.templates/." "$dir/.templates/"
    cp -r "$AIO/.plugins-catalog/." "$dir/.plugins-catalog/"
    mkdir -p "$dir/vm-images"; cp "$AIO/vm-images/images.json" "$dir/vm-images/" 2>/dev/null || true   # the list of DCS images the New VM sheet offers
    cp -r "$AIO/docs/." "$dir/docs/"
    cp "$AIO/compose.sh" "$AIO/VERSION" "$dir/"
    grep -vE '^(API_BIND|API_AUTH_ENABLED|API_INSECURE_NO_AUTH|API_TRUSTED_PROXIES|API_IP_WHITELIST|API_PORT|API_RATE_LIMIT|API_SINGLE_SESSION|API_RESPONSE_CACHE|PROXMOX_[A-Z_]+|FLEET_SCAN_PORTS|FLEET_SELF_URL|METRICS_ENABLED)=' "$AIO/.env.example" > "$dir/.env"
    {
        # the response cache replays the first caller's Access-Control-Allow-Origin, and the lab serves
        # two dashboards (this checkout and a reference one) from different origins: no cache here
        printf 'API_PORT=%s\nAPI_AUTH_ENABLED=true\nAPI_RATE_LIMIT=100000\nAPI_SINGLE_SESSION=false\nAPI_RESPONSE_CACHE=false\nMETRICS_ENABLED=false\n' "$port"
        printf 'SERVER_NAME=%s\nFLEET_SELF_URL=http://127.0.0.1:%s\n' "lab-$role" "$port"
        if [[ "$role" == hub ]]; then
            printf 'PROXMOX_URL=http://127.0.0.1:%s\nPROXMOX_TOKEN_ID=%s\nPROXMOX_TOKEN_SECRET=%s\nPROXMOX_VERIFY_TLS=false\nFLEET_SCAN_PORTS=%s\n' "$PVE_PORT" "$PVE_TOKEN_ID" "$PVE_SECRET" "$MEMBER_PORT"
        fi
    } >> "$dir/.env"
    # the stacks the fake Docker daemon reports containers for: the hub runs two itself, the member (VM 100) one
    if [[ "$role" == hub ]]; then
        mkdir -p "$dir/Stacks/networking-security" "$dir/Stacks/monitoring-management" "$dir/Stacks/development-tools"
        printf 'services:\n  traefik:\n    image: traefik:v3.1\n    container_name: traefik\n    ports: ["80:80", "443:443"]\n  whoami:\n    image: traefik/whoami\n    container_name: whoami\n  sablier:\n    image: acouvreur/sablier:1.6.1\n    container_name: Sablier\n' > "$dir/Stacks/networking-security/docker-compose.yml"
        # a stack that starts on demand (all of it asleep): Traefik's route asks Sablier to wake it-tools on the first request
        printf 'services:\n  it-tools:\n    image: corentinth/it-tools:latest\n    container_name: it-tools\n    ports: ["8380:80"]\n' > "$dir/Stacks/development-tools/docker-compose.yml"
        mkdir -p "$dir/Stacks/networking-security/App-Data/Traefik/custom_routes"
        printf 'http:\n  routers:\n    it-tools:\n      rule: "Host(`tools.lab.test`)"\n      service: it-tools\n      middlewares:\n        - it-tools-sablier\n  services:\n    it-tools:\n      loadBalancer:\n        servers:\n          - url: "http://it-tools:80"\n  middlewares:\n    it-tools-sablier:\n      plugin:\n        sablier:\n          names: it-tools\n          sablierUrl: http://Sablier:10000\n          sessionDuration: 30m\n' > "$dir/Stacks/networking-security/App-Data/Traefik/custom_routes/it-tools.yml"
        printf 'services:\n  dashdot:\n    image: mauricenino/dashdot:latest\n    container_name: dashdot\n    ports: ["3001:3001"]\n  redis:\n    image: redis:alpine\n    container_name: redis\n  uptime-kuma:\n    image: louislam/uptime-kuma:1\n    container_name: uptime-kuma\n' > "$dir/Stacks/monitoring-management/docker-compose.yml"
    elif [[ "$role" == member ]]; then
        mkdir -p "$dir/Stacks/media-services"
        printf 'services:\n  jellyfin:\n    image: jellyfin/jellyfin:10.9.11\n    container_name: jellyfin\n    ports: ["8096:8096"]\n  radarr:\n    image: lscr.io/linuxserver/radarr:latest\n    container_name: radarr\n    ports: ["7878:7878"]\n  sonarr:\n    image: lscr.io/linuxserver/sonarr:latest\n    container_name: sonarr\n    ports: ["8989:8989"]\n  bazarr:\n    image: lscr.io/linuxserver/bazarr:latest\n    container_name: bazarr\n    ports: ["6767:6767"]\n' > "$dir/Stacks/media-services/docker-compose.yml"
        # bazarr starts on demand in the VM: the route the VM offers the hub carries its Sablier block (.data/routes, the
        # feed the hub's Traefik reads; a VM that joined finds it there by itself, the lab's linked one is told so)
        printf 'TRAEFIK_FEED_ENABLED=true\n' >> "$dir/.env"
        mkdir -p "$dir/.data/routes"
        printf 'http:\n  routers:\n    bazarr:\n      rule: "Host(`bazarr.lab.test`)"\n      service: bazarr\n      middlewares:\n        - bazarr-sablier\n  services:\n    bazarr:\n      loadBalancer:\n        servers:\n          - url: "http://bazarr:6767"\n  middlewares:\n    bazarr-sablier:\n      plugin:\n        sablier:\n          names: bazarr\n          sablierUrl: http://Sablier:10000\n          sessionDuration: 30m\n' > "$dir/.data/routes/bazarr.yml"
    fi
}

pid_alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

# spawn PIDFILE LOG DIR CMD... — start CMD in DIR as the leader of a session of its own (so `stop` ends it
# with everything it started), detached from this script's output; PIDFILE gets CMD's own PID
spawn() {
    local pidfile="$1" logf="$2" dir="$3"
    shift 3
    ( cd "$dir" && exec setsid "$@" ) > "$logf" 2>&1 < /dev/null &
    echo $! > "$pidfile"
}

wait_http() {
    local url="$1" i
    for i in $(seq 1 60); do
        curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null && return 0
        sleep 0.5
    done
    log "timed out waiting for $url"; return 1
}

start_api() {
    local dir="$1" port="$2" name="$3"
    if pid_alive "$LAB/$name.pid"; then log "$name API already runs (pid $(cat "$LAB/$name.pid"))"; return 0; fi
    log "starting the $name API on 127.0.0.1:$port"
    PATH="$HERE/bin:$PATH" DCS_FAKE_DOCKER_PROFILE="$name" spawn "$LAB/$name.pid" "$LAB/$name.log" "$dir" .scripts/api-server.sh --bind 127.0.0.1 --port "$port"
    wait_http "http://127.0.0.1:$port/ping"
}

# the first-run window: create the lab admin, then close the wizard
init_api() {
    local port="$1" name="$2" st tok
    st=$(curl -fsS "http://127.0.0.1:$port/setup/status" | jq -r '.initialized')
    [[ "$st" == true ]] && return 0
    log "creating the lab admin on the $name API"
    tok=$(curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$LAB_USER\",\"password\":\"$LAB_PASS\"}" "http://127.0.0.1:$port/auth/setup" | jq -r '.token')
    curl -fsS -X POST -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$port/setup/complete" > /dev/null
}

hub_token() {
    curl -fsS -X POST -H 'Content-Type: application/json' -d "{\"username\":\"$LAB_USER\",\"password\":\"$LAB_PASS\"}" "http://127.0.0.1:$HUB_PORT/auth/login" | jq -r '.token'
}

# the member lives in VM 100 (the mock guest agent reports 127.0.0.1 for it)
link_member() {
    local tok n
    tok=$(hub_token)
    n=$(curl -fsS -H "Authorization: Bearer $tok" "http://127.0.0.1:$HUB_PORT/fleet/members" | jq -r '(.members // []) | length')
    [[ "$n" != 0 ]] && return 0
    log "linking the member API to the hub as media-vm (VM 100)"
    curl -fsS --max-time 90 -X POST -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
        -d "{\"url\":\"http://127.0.0.1:$MEMBER_PORT\",\"username\":\"$LAB_USER\",\"password\":\"$LAB_PASS\",\"name\":\"media-vm\",\"vmid\":100,\"node\":\"pve\",\"type\":\"qemu\"}" \
        "http://127.0.0.1:$HUB_PORT/fleet/members" | jq -c '{success, message}' || true
}

start() {
    command -v socat >/dev/null || { log "socat is needed"; exit 1; }
    mkdir -p "$LAB"
    make_install "$LAB/hub" "$HUB_PORT" hub
    make_install "$LAB/member" "$MEMBER_PORT" member
    make_install "$LAB/fresh" "$FRESH_PORT" fresh
    if ! pid_alive "$LAB/pve.pid"; then
        log "starting the mock Proxmox on 127.0.0.1:$PVE_PORT"
        spawn "$LAB/pve.pid" "$LAB/pve.log" "$LAB" python3 "$AIO/tests/mock-proxmox.py" "$PVE_PORT" "$PVE_TOKEN_ID" "$PVE_SECRET" "$LAB/pve-state.json"
    fi
    start_api "$LAB/member" "$MEMBER_PORT" member
    start_api "$LAB/hub" "$HUB_PORT" hub
    # never set up: the setup wizard's first screens (tests/ui-sweep.mjs, WIZARD_API)
    start_api "$LAB/fresh" "$FRESH_PORT" fresh
    init_api "$MEMBER_PORT" member
    init_api "$HUB_PORT" hub
    link_member
    if ! pid_alive "$LAB/ui.pid"; then
        log "starting Vite on http://localhost:$UI_PORT"
        spawn "$LAB/ui.pid" "$LAB/ui.log" "$UI_ROOT" node node_modules/.bin/vite --port "$UI_PORT" --strictPort
        wait_http "http://localhost:$UI_PORT/"
    fi
    log "ready: dashboard http://localhost:$UI_PORT  ·  hub API http://127.0.0.1:$HUB_PORT  ·  sign in as $LAB_USER"
}

stop_pidfile() {
    local f="$1" p
    [[ -f "$f" ]] || return 0
    p=$(cat "$f")
    # spawn made each of them a session leader: stop its process group (the API's socat and handlers with it)
    if kill -0 "$p" 2>/dev/null; then kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; fi
    rm -f "$f"
}

stop() {
    local d
    # the process groups first, while their leaders still run: `api-server.sh --stop` ends the leader, and a
    # group whose leader is gone is not stopped by stop_pidfile (its docker followers would outlive the lab)
    stop_pidfile "$LAB/ui.pid"
    stop_pidfile "$LAB/hub.pid"
    stop_pidfile "$LAB/member.pid"
    stop_pidfile "$LAB/fresh.pid"
    stop_pidfile "$LAB/pve.pid"
    for d in hub member fresh; do
        [[ -x "$LAB/$d/.scripts/api-server.sh" ]] && (cd "$LAB/$d" && .scripts/api-server.sh --stop > /dev/null 2>&1 || true)
    done
    log "stopped"
}

status() {
    local n
    for n in pve member hub fresh ui; do
        if pid_alive "$LAB/$n.pid"; then log "$n: running (pid $(cat "$LAB/$n.pid"))"; else log "$n: stopped"; fi
    done
}

case "${1:-}" in
    start) start ;;
    stop) stop ;;
    status) status ;;
    *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
