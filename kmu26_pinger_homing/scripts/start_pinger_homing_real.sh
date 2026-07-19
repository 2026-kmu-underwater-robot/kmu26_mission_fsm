#!/usr/bin/env bash
# Scan the already-running physical hydrophone stream, let the operator choose
# one candidate, then start the untouched audio_capture estimator and the
# canonical C++ controller with that exact startup frequency.
#
# This deliberately does not alter kmu26_auv_hydrophone.  Its phase estimator
# has no runtime frequency-selection subscription, so selecting before the
# estimator is launched is the only deterministic way to keep its algorithm
# and state untouched.
set -euo pipefail

selector_pid=""
selected_echo_pid=""
selected_file=""

cleanup() {
  if [[ -n "${selected_echo_pid}" ]] && kill -0 "${selected_echo_pid}" 2>/dev/null; then
    kill "${selected_echo_pid}" 2>/dev/null || true
  fi
  if [[ -n "${selector_pid}" ]] && kill -0 "${selector_pid}" 2>/dev/null; then
    kill -INT -- "-${selector_pid}" 2>/dev/null || true
    wait "${selector_pid}" 2>/dev/null || true
  fi
  if [[ -n "${selected_file}" ]]; then
    rm -f "${selected_file}"
  fi
}
trap cleanup EXIT INT TERM

audio_topic="/audio"
audio_channels="2"
audio_sample_rate="96000"
for arg in "$@"; do
  case "${arg}" in
    audio_topic:=*) audio_topic="${arg#audio_topic:=}" ;;
    audio_channels:=*) audio_channels="${arg#audio_channels:=}" ;;
    audio_sample_rate:=*) audio_sample_rate="${arg#audio_sample_rate:=}" ;;
    reference_frequency_hz:=*)
      echo "[pinger] reference_frequency_hz is chosen by this scanner; do not pass it manually." >&2
      exit 2
      ;;
    use_audio_capture:=true)
      echo "[pinger] Start physical audio_capture before this wrapper; use_audio_capture:=true cannot scan before capture exists." >&2
      exit 2
      ;;
  esac
done

run_id="$$"
candidate_topic="/pinger_homing/frequency_candidates_${run_id}"
selection_topic="/pinger_homing/manual_selection_${run_id}"
selected_topic="/pinger_homing/selected_frequency_hz_${run_id}"

setsid ros2 run kmu26_pinger_homing pinger_frequency_selector --ros-args \
  -p audio_topic:="${audio_topic}" \
  -p channels:="${audio_channels}" \
  -p sample_rate:="${audio_sample_rate}" \
  -p auto_select_top:=false \
  -p candidate_topic:="${candidate_topic}" \
  -p manual_selection_topic:="${selection_topic}" \
  -p selected_frequency_topic:="${selected_topic}" &
selector_pid=$!

echo "[pinger] Monitoring ${audio_topic} for five seconds..."
deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  if ros2 topic list 2>/dev/null | grep -Fxq "${candidate_topic}"; then
    break
  fi
  sleep 0.2
done
if ! ros2 topic list 2>/dev/null | grep -Fxq "${candidate_topic}"; then
  echo "[pinger] Frequency selector did not advertise its candidate topic." >&2
  exit 1
fi

if ! timeout 30 ros2 topic echo --once "${candidate_topic}"; then
  echo "[pinger] No frequency candidates arrived. Verify the physical /audio stream." >&2
  exit 1
fi

while true; do
  printf '\n[Pinger] Enter candidate 1-5 or an exact frequency in Hz: ' >&2
  read -r selection
  if [[ "${selection}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    break
  fi
  echo "Enter 1-5 or a frequency in Hz." >&2
done

selected_file="$(mktemp)"
timeout 10 ros2 topic echo --once "${selected_topic}" >"${selected_file}" &
selected_echo_pid=$!
sleep 0.2
ros2 topic pub --once "${selection_topic}" std_msgs/msg/String "{data: '${selection}'}"
if ! wait "${selected_echo_pid}"; then
  echo "[pinger] The selector did not confirm a frequency." >&2
  exit 1
fi
selected_echo_pid=""
selected_hz="$(sed -n 's/^data:[[:space:]]*//p' "${selected_file}" | head -n 1)"
if [[ ! "${selected_hz}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "[pinger] Invalid selected-frequency response: ${selected_hz:-<empty>}" >&2
  exit 1
fi

echo "[pinger] Selected ${selected_hz} Hz. Starting physical C++ Phase homing."
kill -INT -- "-${selector_pid}" 2>/dev/null || true
wait "${selector_pid}" 2>/dev/null || true
selector_pid=""
rm -f "${selected_file}"
selected_file=""
trap - EXIT INT TERM
exec ros2 launch kmu26_pinger_homing pinger_homing_real.launch.py \
  "$@" "reference_frequency_hz:=${selected_hz}"
