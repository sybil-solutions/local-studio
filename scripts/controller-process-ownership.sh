controller_process_command() {
  local configured="$1"
  local fallback="$2"
  if [ -n "$configured" ]; then
    printf '%s\n' "$configured"
    return
  fi
  command -v "$fallback" 2>/dev/null || true
}

controller_process_canonical_path() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null
  else
    readlink -f "$1" 2>/dev/null
  fi
}

controller_process_signal() {
  local signal="$1"
  local pid="$2"
  local signal_command
  signal_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_KILL_BIN:-}" kill)"
  [ -n "$signal_command" ] || return 1
  "$signal_command" "$signal" "$pid"
}

controller_process_alive() {
  controller_process_signal -0 "$1" >/dev/null 2>&1
}

controller_process_proc_root() {
  printf '%s\n' "${LOCAL_STUDIO_PROCESS_PROC_ROOT:-/proc}"
}

controller_process_uid() {
  local pid="$1"
  local proc_root process_directory ps_command
  proc_root="$(controller_process_proc_root)"
  process_directory="$proc_root/$pid"
  if [ -d "$process_directory" ]; then
    stat -f '%u' "$process_directory" 2>/dev/null || stat -c '%u' "$process_directory" 2>/dev/null
    return
  fi
  ps_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_PS_BIN:-}" ps)"
  [ -n "$ps_command" ] || return 1
  "$ps_command" -o uid= -p "$pid" 2>/dev/null | tr -d '[:space:]'
}

controller_process_lsof_path() {
  local pid="$1"
  local descriptor="$2"
  local lsof_command
  lsof_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_LSOF_BIN:-}" lsof)"
  [ -n "$lsof_command" ] || return 1
  "$lsof_command" -a -p "$pid" -d "$descriptor" -Fn 2>/dev/null |
    sed -n 's/^n//p' |
    head -1
}

controller_process_cwd() {
  local pid="$1"
  local proc_root path
  proc_root="$(controller_process_proc_root)"
  if [ -L "$proc_root/$pid/cwd" ]; then
    controller_process_canonical_path "$proc_root/$pid/cwd"
    return
  fi
  path="$(controller_process_lsof_path "$pid" cwd)" || return 1
  controller_process_canonical_path "$path"
}

controller_process_executable() {
  local pid="$1"
  local proc_root path
  proc_root="$(controller_process_proc_root)"
  if [ -L "$proc_root/$pid/exe" ]; then
    controller_process_canonical_path "$proc_root/$pid/exe"
    return
  fi
  path="$(controller_process_lsof_path "$pid" txt)" || return 1
  controller_process_canonical_path "$path"
}

controller_process_arguments() {
  local pid="$1"
  local proc_root ps_command
  proc_root="$(controller_process_proc_root)"
  if [ -f "$proc_root/$pid/cmdline" ]; then
    printf 'argv\n'
    tr '\0' '\n' < "$proc_root/$pid/cmdline"
    return
  fi
  ps_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_PS_BIN:-}" ps)"
  [ -n "$ps_command" ] || return 1
  printf 'command\n'
  "$ps_command" -ww -o command= -p "$pid" 2>/dev/null |
    sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

controller_process_start_identity() {
  local pid="$1"
  local proc_root ps_command
  proc_root="$(controller_process_proc_root)"
  if [ -f "$proc_root/$pid/stat" ]; then
    sed 's/^.*) //' "$proc_root/$pid/stat" 2>/dev/null | awk '{print $20}'
    return
  fi
  ps_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_PS_BIN:-}" ps)"
  [ -n "$ps_command" ] || return 1
  "$ps_command" -ww -o lstart= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

controller_process_arguments_match() {
  local arguments="$1"
  local bun="$2"
  local entrypoint="$3"
  [ "$arguments" = "$(printf 'argv\n%s\n%s' "$bun" "$entrypoint")" ] ||
    [ "$arguments" = "$(printf 'command\n%s %s' "$bun" "$entrypoint")" ]
}

controller_process_expected_layout() {
  local cwd="$1"
  local arguments="$2"
  local bun="$3"
  local install_root="$4"
  local controller_directory="$5"
  local bootstrap="$6"
  local legacy="$7"
  if [ "$cwd" = "$controller_directory" ]; then
    controller_process_arguments_match "$arguments" "$bun" "$bootstrap" ||
      controller_process_arguments_match "$arguments" "$bun" src/bootstrap.ts ||
      controller_process_arguments_match "$arguments" "$bun" "$legacy" ||
      controller_process_arguments_match "$arguments" "$bun" src/main.ts
    return
  fi
  [ "$cwd" = "$install_root" ] && {
    controller_process_arguments_match "$arguments" "$bun" "$bootstrap" ||
      controller_process_arguments_match "$arguments" "$bun" "$legacy" ||
      controller_process_arguments_match "$arguments" "$bun" controller/src/main.ts
  }
}

controller_process_record() {
  local pid="$1"
  local bun="$2"
  local install_root="$3"
  local controller_directory="$4"
  local bootstrap="$5"
  local legacy="$6"
  local uid executable cwd arguments start_identity
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  controller_process_alive "$pid" || return 1
  uid="$(controller_process_uid "$pid")" || return 1
  [ "$uid" = "$(id -u)" ] || return 1
  executable="$(controller_process_executable "$pid")" || return 1
  [ "$executable" = "$bun" ] || return 1
  cwd="$(controller_process_cwd "$pid")" || return 1
  arguments="$(controller_process_arguments "$pid")" || return 1
  controller_process_expected_layout "$cwd" "$arguments" "$bun" "$install_root" "$controller_directory" "$bootstrap" "$legacy" || return 1
  start_identity="$(controller_process_start_identity "$pid")" || return 1
  [ -n "$start_identity" ] || return 1
  printf '%s|%s\n' "$pid" "$start_identity"
}

controller_process_record_is_current() {
  local record="$1"
  shift
  local pid expected_start current
  pid="${record%%|*}"
  expected_start="${record#*|}"
  [ "$pid" != "$expected_start" ] || return 1
  current="$(controller_process_record "$pid" "$@")" || return 1
  [ "$current" = "$record" ]
}

controller_process_listener_pids() {
  local port="$1"
  local lsof_command fuser_command
  lsof_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_LSOF_BIN:-}" lsof)"
  if [ -n "$lsof_command" ]; then
    "$lsof_command" -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null |
      sed -n '/^[0-9][0-9]*$/p' |
      sort -n -u
    return 0
  fi
  fuser_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_FUSER_BIN:-}" fuser)"
  [ -n "$fuser_command" ] || return 2
  "$fuser_command" "$port/tcp" 2>/dev/null |
    tr ' ' '\n' |
    sed -n '/^[0-9][0-9]*$/p' |
    sort -n -u
}

controller_process_candidate_pids() {
  local port="$1"
  local pgrep_command listener_pids
  pgrep_command="$(controller_process_command "${LOCAL_STUDIO_PROCESS_PGREP_BIN:-}" pgrep)"
  if [ -n "$pgrep_command" ]; then
    "$pgrep_command" -x bun 2>/dev/null || true
  fi
  listener_pids="$(controller_process_listener_pids "$port")" || return $?
  printf '%s\n' "$listener_pids"
}

controller_owned_process_records() {
  local port="$1"
  shift
  local pid candidates
  candidates="$(controller_process_candidate_pids "$port")" || return $?
  printf '%s\n' "$candidates" |
    sed -n '/^[0-9][0-9]*$/p' |
    sort -n -u |
    while IFS= read -r pid; do
      controller_process_record "$pid" "$@" || true
    done
}

controller_process_records_contain_pid() {
  local records="$1"
  local expected_pid="$2"
  local record
  while IFS= read -r record; do
    [ -n "$record" ] || continue
    [ "${record%%|*}" != "$expected_pid" ] || return 0
  done <<EOF
$records
EOF
  return 1
}

controller_process_single_listener_pid() {
  local listener_pids="$1"
  local count
  count="$(printf '%s\n' "$listener_pids" | sed -n '/^[0-9][0-9]*$/p' | wc -l | tr -d '[:space:]')"
  [ "$count" = "1" ] || return 1
  printf '%s\n' "$listener_pids"
}

controller_require_listener_ownership() {
  local port="$1"
  local records="$2"
  shift 2
  local listener_pids listener_pid record
  listener_pids="$(controller_process_listener_pids "$port")" || return $?
  [ -n "$listener_pids" ] || return 0
  listener_pid="$(controller_process_single_listener_pid "$listener_pids")" || return 1
  controller_process_records_contain_pid "$records" "$listener_pid" || return 1
  record="$(printf '%s\n' "$records" | sed -n "/^${listener_pid}|/p" | head -1)"
  controller_process_record_is_current "$record" "$@"
}

controller_require_exact_listener_record() {
  local port="$1"
  local record="$2"
  shift 2
  local listener_pids listener_pid
  controller_process_record_is_current "$record" "$@" || return 1
  listener_pids="$(controller_process_listener_pids "$port")" || return $?
  listener_pid="$(controller_process_single_listener_pid "$listener_pids")" || return 1
  [ "$listener_pid" = "${record%%|*}" ] || return 1
  controller_process_record_is_current "$record" "$@"
}

controller_validate_process_records() {
  local records="$1"
  shift
  local record
  while IFS= read -r record; do
    [ -n "$record" ] || continue
    controller_process_record_is_current "$record" "$@" || return 1
  done <<EOF
$records
EOF
}

controller_stop_owned_processes() {
  local records="$1"
  shift
  local record pid survivors="" attempt
  controller_validate_process_records "$records" "$@" || return 1
  while IFS= read -r record; do
    [ -n "$record" ] || continue
    controller_process_record_is_current "$record" "$@" || return 1
    pid="${record%%|*}"
    controller_process_signal -TERM "$pid" >/dev/null 2>&1 || return 1
  done <<EOF
$records
EOF
  for attempt in $(seq 1 40); do
    survivors=""
    while IFS= read -r record; do
      [ -n "$record" ] || continue
      pid="${record%%|*}"
      if controller_process_alive "$pid"; then
        controller_process_record_is_current "$record" "$@" || return 1
        survivors="${survivors}${survivors:+$'\n'}${record}"
      fi
    done <<EOF
$records
EOF
    [ -n "$survivors" ] || return 0
    sleep 0.1
  done
  controller_validate_process_records "$survivors" "$@" || return 1
  while IFS= read -r record; do
    [ -n "$record" ] || continue
    controller_process_record_is_current "$record" "$@" || return 1
    pid="${record%%|*}"
    controller_process_signal -KILL "$pid" >/dev/null 2>&1 || return 1
  done <<EOF
$survivors
EOF
}

controller_require_no_listener() {
  local listener_pids
  listener_pids="$(controller_process_listener_pids "$1")" || return $?
  [ -z "$listener_pids" ]
}
