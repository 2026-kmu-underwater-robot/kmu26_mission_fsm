# Pinger homing

This directory is the single source of truth for the vehicle-side pinger homing controller.
The hydrophone signal-processing algorithm is not copied into this package. It is consumed from
the team fork of `kmu26_auv_hydrophone` through ROS topics.

## Controllers

- `pinger_homing_controller.cpp`: installed canonical C++ Phase/SNR RC controller.
- `pinger_homing_math.hpp`: robust moving-sensor source fit, yaw stabilization,
  no-odometry ABBA/Huber bearing fit, and safety functions used by that controller.
- `single_hydrophone_homing_controller.py`: archived prior Python controller. It is
  installed only for source compatibility and is not selected by the real launch.

The active controller keeps the tested state order:

```text
WAIT_VEHICLE -> PROBE <-> REPROBE -> ALIGN <-> APPROACH -> CONTACT -> COMPLETE
```

The physical default is `no_odom_phase`: it makes neutral-separated ABBA X/Y
probe legs, estimates the bearing from Phase range changes, aligns with
MAVROS IMU yaw, moves forward briefly, then probes again.  It deliberately
does not feed `/odometry/filtered` or any simulator ground truth into Phase
control.  ALT_HOLD owns vertical control.

## Topic boundary

Inputs from the forked hydrophone package:

- `/audio_phase_estimator/delta_range_m` (`std_msgs/Float64`)
- `/audio_phase_estimator/iq_magnitude` (`std_msgs/Float64`)
- `/homing/direction` (`geometry_msgs/Vector3Stamped`, optional fit seed)

Vehicle inputs:

- `/mavros/imu/data` (`sensor_msgs/Imu`)
- `/mavros/state` (`mavros_msgs/State`)
- `/depth/pose` (`geometry_msgs/PoseWithCovarianceStamped`, monitored for
  the physical preflight; not a no-odometry Phase fitting input or a gate for
  the horizontal-only ALT_HOLD profile)

Outputs:

- `/control/pinger/rc_override` through `rc_override_mux` in the real launch
- `/pinger_homing/status`
- `/pinger_homing/direction_body`

The controller never reads MuJoCo ground truth. Ground truth is used only by external regression
tests as an oracle.

## Real-vehicle launch

Start the physical audio stream first.  Then use the wrapper below instead of
launching the real launch directly.  It scans for five seconds, prints up to
five candidates, accepts a candidate number or a Hz value in the terminal,
and starts the untouched `audio_phase_estimator` at that selected frequency.

```bash
ros2 run kmu26_pinger_homing start_pinger_homing_real.sh \
  dry_run:=true use_audio_capture:=false tank_max_depth_m:=11.0
```

`use_audio_capture:=true` is intentionally rejected by this wrapper: audio
must already be present before it can be scanned.  Direct launch remains
available only when the operator has already measured a frequency and passes
`reference_frequency_hz:=...` explicitly.

The C++ controller never arms automatically by default and will publish
non-neutral RC only while MAVROS reports both `armed=true` and actual
`ALT_HOLD`.  The first physical profile uses ±20 PWM ABBA probes and +25 PWM
approach demand around 1500; these are launch parameters, not hidden code
constants.  The amplitude range relation `(K / iq_magnitude)^2` still requires
a measured physical calibration, so the default `K=0` disables metric-range
completion.  The simulator-only `0.325` must not be used on the vehicle.
