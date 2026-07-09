# KMU26 Mission FSM

Focused ROS 2 package for the KMU26 underwater mission controller.

## Nodes

- `ground_truth_buoy_fsm`: mission FSM and RC/manual/direct command output.
- `pinger_homing_controller`: hydrophone direction + optional YOLO final-align controller.
- `mission_rviz_visualizer`: RViz marker publisher for FSM state, course boundary, target state, and YOLO view.
- `fsm_web_gui.py`: dedicated FSM web GUI for mission start/stop, RViz helpers, camera preview, state, RC monitor, and course boundary setup.

## Build

Place this repository under a ROS 2 workspace `src/` directory, then:

```bash
source /opt/ros/humble/setup.bash
colcon build --packages-select kmu26_mission_fsm
source install/setup.bash
```

After pulling updates on the vehicle NUC, run the preflight from the workspace
without permanently changing the shell environment:

```bash
./src/kmu26_mission_fsm/scripts/real_vehicle_preflight.sh --build
```

If the vehicle uses different topic names, pass them explicitly:

```bash
./src/kmu26_mission_fsm/scripts/real_vehicle_preflight.sh --build \
  --pose-topic /odometry/filtered \
  --state-topic /mavros/state \
  --dvl-twist-topic /dvl/twist \
  --depth-topic /depth/pose \
  --camera-compressed-topic /camera/camera/color/image_raw/compressed
```

The preflight follows the original `kmu26_auv_web_gui` real-robot contract:
`hit25_auv_ros2 localization_test.launch.py` is the robot stack, and the GUI
expects `/odometry/filtered`, `/dvl/twist`, `/depth/pose`,
`/mavros/imu/data`, `/joy`, `/battery`, and
`/camera/camera/color/image_raw/compressed`.

`FAIL` on `/odometry/filtered` or `/mavros/state` means the robot localization
or MAVROS bringup is not visible in the current ROS graph, or the topic names do
not match the FSM launch arguments. `WARN` on DVL/depth/IMU/joy/battery means
the mission package can still parse and start, but the real GUI stack is not
publishing the same status topics it normally uses. The preflight prints similar
candidate topics when it can find them.

After the package is built, the same check is also available through ROS:

```bash
ros2 run kmu26_mission_fsm real_vehicle_preflight.sh
```

## Real Robot Quick Application Checklist

This section is the field checklist for applying this package directly on the
real AUV NUC.

### 1. Build and source the correct workspace

Run these commands from `~/catkin_ws` on the NUC:

```bash
source /opt/ros/humble/setup.bash
colcon build --packages-select kmu26_mission_fsm
source install/setup.bash
```

The GUI executable is pinned to `/usr/bin/python3` because ROS Humble packages
are installed for the system Python. A conda `(base)` prompt is OK as long as
the installed GUI script is used through `ros2 launch`, but do not change the
script back to `#!/usr/bin/env python3`.

After pulling new code, always run:

```bash
./src/kmu26_mission_fsm/scripts/real_vehicle_preflight.sh --build
```

For real-robot readiness, the important result is `FAIL=0`. These topics should
be visible before live operation:

```text
/odometry/filtered
/mavros/state
/dvl/twist
/depth/pose
/mavros/imu/data
/joy
/battery
/camera/camera/color/image_raw/compressed
/camera/camera/color/image_raw
```

`/mujoco/hydrophone/direction` is only required when pinger homing is actually
being tested.

### 2. Bring up the robot stack first

Keep the vehicle stack running in a separate terminal. Use the team's current
robot launch, for example:

```bash
source /opt/ros/humble/setup.bash
source ~/catkin_ws/install/setup.bash
ros2 launch hit25_auv_ros2 rov_start.launch.py
```

Then verify that the mission package can see the robot:

```bash
ros2 topic list
ros2 topic echo --once /mavros/state
ros2 topic echo --once /odometry/filtered
```

If `/mavros/state` or `/odometry/filtered` is missing, do not start live
mission control yet. Fix the robot stack, `ROS_DOMAIN_ID`, topic names, or
workspace sourcing first.

### 3. Start the FSM GUI with camera enabled

For local NUC access:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py camera_on:=true
```

For a laptop on the same network:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py host:=0.0.0.0 camera_on:=true
```

Open the GUI from the NUC:

```text
http://127.0.0.1:8890/
```

Open it from another laptop using the NUC IP, for example:

```text
http://192.168.0.6:8890/
```

If launch prints `0.0.0.0:8890 is already in use`, the GUI is already running
or an old process still owns the port. Either open the existing GUI, stop the
old process, or start on another port:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py host:=0.0.0.0 port:=8891 camera_on:=true
```

### 4. Camera behavior

The GUI camera display uses this compressed RealSense topic first:

```text
/camera/camera/color/image_raw/compressed
```

That path does not require OpenCV inside `kmu26_mission_fsm`; it forwards the
already-compressed JPEG frames as MJPEG to the browser. The raw fallback topic
is:

```text
/camera/camera/color/image_raw
```

Raw conversion is optional. If the GUI status says:

```text
raw conversion: unavailable
raw conversion_error: numpy.core.multiarray failed to import
```

the camera can still work through the compressed topic. This means the local
OpenCV module was built against a NumPy version that does not match the active
Python environment. It is not fatal for the GUI camera stream.

If camera topics exist but the GUI says `No camera frame`, check the GUI
`Feed` switch in the Camera panel. `Feed` must be enabled, or launch with
`camera_on:=true`.

Useful checks:

```bash
ros2 topic hz /camera/camera/color/image_raw/compressed
curl http://127.0.0.1:8890/api/status
curl -o /tmp/kmu26_camera.jpg http://127.0.0.1:8890/api/camera.jpg
```

### 5. Dry-run before live command output

Start the mission in dry-run first:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py \
  use_mission_fsm:=true \
  dry_run:=true \
  wait_armed:=false
```

Dry-run does not send RC/manual commands, but it still needs live pose and
status topics. In the GUI, verify:

```text
/odometry/filtered alive
/mavros/state alive
camera_compressed alive
FSM state updating
robot pose updating
```

Only after bench/safety checks should live RC output be enabled:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py \
  use_mission_fsm:=true \
  dry_run:=false \
  wait_armed:=true \
  transport:=rc_override
```

The web GUI also locks manual RC send by default. To enable GUI RC send:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py \
  host:=0.0.0.0 \
  camera_on:=true \
  allow_rc_send:=true
```

Use `allow_rc_send:=true` only on a checked bench/safety path.

### 6. YOLO model and topic expectations

This repository does not currently contain a `.pt` YOLO model file. The local
workspace also may not contain one. The related vision package expects a model
path such as:

```text
/home/auv/models/buoy.pt
/home/pc/Downloads/yolo26m_underwater_batch4_last.pt
```

Check for a model before starting YOLO:

```bash
find ~/catkin_ws /home/kuuve -name '*.pt' -o -name '*.onnx' -o -name '*.engine'
```

The laptop/vision-side detector in `auv_buoy_vision_control` reads the
compressed camera topic and publishes bounding boxes:

```bash
ros2 launch auv_buoy_vision_control laptop_yolo_detection.launch.py \
  model_path:=/absolute/path/to/model.pt \
  image_topic:=/camera/camera/color/image_raw/compressed \
  bbox_topic:=/vision/buoy_bbox \
  device:=cuda:0 \
  show_preview:=true
```

If CUDA is unavailable, use `device:=cpu`.

Important topic distinction:

```text
/vision/buoy_bbox
  std_msgs/Float32MultiArray from auv_buoy_vision_control

/uuv_mujoco/yolo_buoy_detections
  std_msgs/String status expected by kmu26_mission_fsm mission/GUI code
```

The current FSM web GUI camera panel shows the RealSense camera stream. It does
not draw YOLO boxes over that stream yet. YOLO preview boxes are shown by the
YOLO detector's OpenCV preview window when `show_preview:=true`, or need a
future bridge/overlay that converts `/vision/buoy_bbox` into the GUI overlay or
into `/uuv_mujoco/yolo_buoy_detections`.

### 7. Common field failures

- `Address already in use`: the GUI is already running on `8890`; open the
  existing page, kill the old `fsm_web_gui.py`, or use `port:=8891`.
- `No camera frame` while camera topics exist: enable the Camera `Feed` switch
  or launch with `camera_on:=true`.
- RealSense prints `requesting incompatible QoS`: rebuild and source this
  package, then rerun the GUI. Current GUI subscriptions use best-effort QoS.
- `raw conversion unavailable`: OpenCV/NumPy mismatch. Compressed camera
  streaming still works.
- `/uuv_mujoco/yolo_buoy_detections` listed but `alive=false`: no YOLO status
  publisher is actively publishing that string topic.
- `.pt` model missing: YOLO cannot start until the trained model is copied to
  the NUC/laptop and passed as `model_path:=...`.
- Browser cannot connect from laptop: launch GUI with `host:=0.0.0.0`, use the
  NUC IP address, and make sure the laptop is on the same network.

## Real-Vehicle Bringup

The focused launch is conservative by default. It starts the headless RViz marker visualizer, but does not start RViz or autonomous control unless explicitly enabled. This avoids Qt/X11 display failures when running on the vehicle NUC through Docker or SSH.

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py
```

Start RViz only when running on a machine with a working display:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py use_rviz:=true
```

Start the FSM in dry-run mode:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py use_mission_fsm:=true dry_run:=true
```

`dry_run` disables command output only. The FSM still needs vehicle pose for state
transitions, relative target coordinates, and RViz/status output. The real-vehicle
launch defaults to `pose_topic:=/odometry/filtered pose_type:=odometry`.

Start the FSM with RC output after MAVROS is ready and the safety path has been checked:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py use_mission_fsm:=true dry_run:=false wait_armed:=true transport:=rc_override
```

Start pinger-only homing:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_real.launch.py use_pinger_homing:=true
```

## Dedicated FSM GUI

This is separate from the MuJoCo simulator GUI and from `kmu26_auv_web_gui`.
It is meant to operate the mission package directly.

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py
```

Open:

```text
http://127.0.0.1:8890/
```

For a remote laptop, bind to the NUC network interface:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py host:=0.0.0.0
```

If port `8890` is already occupied by an old GUI process, either stop that
process or launch with another port, for example `port:=8891`.

The GUI can start/stop the mission FSM, pinger homing, RViz marker visualizer,
and RViz. It also streams a camera from
`/camera/camera/color/image_raw/compressed` or
`/camera/camera/color/image_raw`, reads
`/tmp/kmu26_mission_fsm_status.json`, shows topic health, and stores course
boundary settings in
`/tmp/kmu26_mission_fsm_gui_config.json`.

The GUI executable intentionally uses `/usr/bin/python3` so ROS Humble's Python
packages are used even when a conda Python appears first in `PATH`.

RC publishing is locked by default. Enable it only on a checked bench/safety
path:

```bash
ros2 launch kmu26_mission_fsm mission_fsm_gui.launch.py allow_rc_send:=true
```

## Main Topics

- Pose input: `/odometry/filtered` (`nav_msgs/Odometry`)
- Arm state: `/mavros/state`
- GUI DVL velocity: `/dvl/twist` (`geometry_msgs/TwistWithCovarianceStamped`)
- GUI depth pose: `/depth/pose` (`geometry_msgs/PoseWithCovarianceStamped`)
- GUI IMU: `/mavros/imu/data` (`sensor_msgs/Imu`)
- GUI joystick: `/joy` (`sensor_msgs/Joy`)
- GUI battery: `/battery` (`sensor_msgs/BatteryState`)
- GUI camera compressed: `/camera/camera/color/image_raw/compressed` (`sensor_msgs/CompressedImage`)
- GUI camera raw fallback: `/camera/camera/color/image_raw` (`sensor_msgs/Image`)
- RC output: `/mavros/rc/override`
- YOLO status: `/uuv_mujoco/yolo_buoy_detections`
- Hydrophone direction: `/mujoco/hydrophone/direction`
- Hydrophone status: `/mujoco/hydrophone/status`
- RViz markers: `/mission/rviz_markers`
- Mission status JSON: `/tmp/kmu26_mission_fsm_status.json`

Mission, pinger, visualizer, and GUI telemetry subscriptions use
best-effort-compatible QoS so they can receive from MAVROS, camera, and sensor
publishers that do not offer reliable delivery.

The bundled `config/tank_current_scene.xml` is used for target layout parsing and unit checks. Real mission operation should keep live perception/localization inputs fresh and should be tested in `dry_run` before enabling command output.
