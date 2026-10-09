#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
base=/opt/careerscape
sha=${1:-}
run=${2:-}
[[ $sha =~ ^[a-f0-9]{40}$ && $run =~ ^[0-9]+$ ]] || { echo 'Invalid release arguments.' >&2; exit 2; }
release="$base/releases/$sha"
[[ -d $release && -f $base/deploy.env && -f $base/app.env ]] || { echo 'Server is not initialized.' >&2; exit 2; }
exec 9>"$base/deploy.lock"
flock -w 600 9
if [[ ! -f "$base/app.env.sha256" ]] || ! sha256sum --check --status "$base/app.env.sha256"; then
  echo 'Server app.env changed or checksum missing; deployment stopped.' >&2
  exit 1
fi
cd "$release"
sha256sum --check careerscape-image.sha256
python3 - "$sha" <<'PY'
import hashlib,json,sys
m=json.load(open('release.json'))
assert m['version']==1 and m['gitSha']==sys.argv[1]
assert m['imageTag']=='careerscape:sha-'+sys.argv[1]
assert len(m['imageId'])==71 and m['imageId'].startswith('sha256:')
assert set(m['files'])==set(['deploy.sh','compose.production.yaml'])
for name,expected in m['files'].items():
 assert hashlib.sha256(open(name,'rb').read()).hexdigest()==expected
assert open('careerscape-image.sha256').read().split()[0]==m['archiveSha256']
PY
old=$(readlink -f "$base/current" || true)
if [[ -f $base/current.json ]]; then
  previous_run=$(python3 -c 'import json;print(json.load(open("/opt/careerscape/current.json"))["runNumber"])')
  if (( run < previous_run )); then echo 'Superseded release; deployment skipped.'; exit 0; fi
fi
docker load --input careerscape-image.tar.gz
export CAREERSCAPE_IMAGE="careerscape:sha-$sha"
actual_id=$(docker image inspect "$CAREERSCAPE_IMAGE" --format '{{.Id}}')
expected_id=$(python3 -c 'import json;print(json.load(open("release.json"))["imageId"])')
[[ $actual_id == "$expected_id" ]] || { echo 'Loaded image ID mismatch.' >&2; exit 1; }
[[ $(docker image inspect "$CAREERSCAPE_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$sha" ]] || exit 1
[[ $(docker image inspect "$CAREERSCAPE_IMAGE" --format '{{.Architecture}}') == amd64 && $(uname -m) == x86_64 ]] || exit 1
port=$(sed -n 's/^CAREERSCAPE_PORT=//p' "$base/deploy.env")
origin=$(sed -n 's/^APP_ORIGIN=//p' "$base/deploy.env")
[[ $port =~ ^[0-9]+$ && $origin == https://* ]] || exit 1
compose() { docker compose -p careerscape --env-file "$base/deploy.env" -f "$release/compose.production.yaml" "$@"; }
http_get() {
  docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges \
    --env "PROBE_URL=$1" --entrypoint node "$CAREERSCAPE_IMAGE" --input-type=module -e \
    'const r=await fetch(process.env.PROBE_URL,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Health HTTP ${r.status}`);process.stdout.write(await r.text())'
}
old_compose() {
  CAREERSCAPE_IMAGE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["imageTag"])' "$old/release.json")" \
    docker compose -p careerscape --env-file "$base/deploy.env" -f "$old/compose.production.yaml" "$@"
}
compose config --quiet
if ss -ltn "sport = :$port" | tail -n +2 | grep -q .; then
  owned=$(compose ps -q careerscape)
  [[ -n $owned && $(docker port "$owned" 3000/tcp) == "127.0.0.1:$port" ]] || { echo "Port $port belongs to another service." >&2; exit 1; }
fi
if [[ $old == "$release" ]] && http_get "$origin/api/health" >/dev/null; then
  echo 'This release is already healthy; no restart needed.'; exit 0
fi
backup=''
stopped=0
activated=0
rollback() {
  status=$?
  trap - ERR
  if (( stopped == 1 && activated == 0 )); then
    echo 'New release failed before public activation; attempting rollback.' >&2
    compose stop careerscape || true
    if [[ -n $old && -f $old/release.json ]]; then
      if [[ -n $backup ]]; then
        docker run --rm --network none --mount type=volume,source=careerscape-data,target=/data \
          --mount "type=bind,source=$base/backups,target=/backups" --entrypoint node "$CAREERSCAPE_IMAGE" \
          /app/server/container-db.mjs restore "/backups/$backup" || { echo 'Restore failed; maintenance remains active.' >&2; exit "$status"; }
      fi
      old_compose up -d --no-build --pull never --wait --wait-timeout 120 || { echo 'Previous release failed; maintenance remains active.' >&2; exit "$status"; }
      rm -f "$base/state/maintenance"
      echo 'Previous image and verified pre-release database restored.' >&2
    else
      echo 'First deployment failed; maintenance remains active and diagnostics retained.' >&2
    fi
  fi
  exit "$status"
}
trap rollback ERR
touch "$base/state/maintenance"
chmod 644 "$base/state/maintenance"
stopped=1
if [[ -n $old && -f $old/release.json ]]; then
  old_compose stop careerscape
  candidate="before-$sha-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  docker run --rm --network none --mount type=volume,source=careerscape-data,target=/data,readonly \
    --mount "type=bind,source=$base/backups,target=/backups" --entrypoint node "$CAREERSCAPE_IMAGE" \
    /app/server/container-db.mjs backup "/backups/$candidate"
  backup="$candidate"
fi
compose up -d --no-build --pull never --wait --wait-timeout 120
http_get "http://127.0.0.1:$port/api/health" | python3 -c 'import json,sys;m=json.load(sys.stdin);assert m["status"]=="ok" and m["schemaVersion"]=="0002"'
http_get "http://127.0.0.1:$port/art/manifest-careerscape-art-v2.json" >/dev/null
# Public health bypasses maintenance, so TLS is tested before opening player writes.
rm -f "$base/state/health.json"
for attempt in $(seq 1 60); do
  if http_get "$origin/api/health" >"$base/state/health.json" 2>/dev/null; then break; fi
  sleep 2
done
python3 -c 'import json;m=json.load(open("/opt/careerscape/state/health.json"));assert m["status"]=="ok" and m["schemaVersion"]=="0002"'
rm -f "$base/current.next"
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
python3 - "$sha" "$run" "$actual_id" "$origin" <<'PY'
import json,sys,os
m=dict(gitSha=sys.argv[1],runNumber=int(sys.argv[2]),imageId=sys.argv[3],origin=sys.argv[4])
with open('/opt/careerscape/current.json.next','w') as f:json.dump(m,f)
os.rename('/opt/careerscape/current.json.next','/opt/careerscape/current.json')
PY
rm -f "$base/state/maintenance"
activated=1
echo "Deployed $sha ($actual_id) at $origin"
