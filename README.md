# KMU26 AUV Control

이 저장소는 역할이 겹치지 않는 ROS 2 패키지 두 개만 관리한다. 하이드로폰
신호처리 코드는 이 저장소에 포함하지 않고 별도 팀 포크를 sibling Git 저장소로
가져온다.

```text
kmu26_pinger_homing/       완성된 하이드로폰 핑거 호밍 + RC + Web GUI
kmu26_vision_mission_fsm/  시험 중인 YOLO/비전 제어 + 미션 FSM
hydrophone.repos           별도 hydrophone Git 저장소와 검증 커밋
```

NUC의 최종 소스 경계는 다음과 같다.

```text
~/auv_ws/src/
├── kmu26_mission_fsm/              # 이 Git 저장소
│   ├── kmu26_pinger_homing/        # 차량측 RC 제어·mux·GUI ROS 패키지
│   └── kmu26_vision_mission_fsm/   # 비전 FSM ROS 패키지
└── kmu26_auv_hydrophone/           # 별도 Git 저장소, 신호처리 ROS 패키지들
    ├── audio_common/
    ├── audio_common_msgs/
    └── audio_capture/
```

`kmu26_auv_hydrophone`을 `kmu26_pinger_homing` 안에 복사하거나 중첩 clone하지 않는다.

## 설치

```bash
mkdir -p ~/auv_ws/src
cd ~/auv_ws/src
git clone https://github.com/2026-kmu-underwater-robot/kmu26_mission_fsm.git
git clone https://github.com/2026-kmu-underwater-robot/kmu26_auv.git
cd ~/auv_ws
vcs import src < src/kmu26_mission_fsm/hydrophone.repos
rosdep install --from-paths src --ignore-src -r -y
colcon build --symlink-install \
  --packages-up-to kmu26_pinger_homing kmu26_vision_mission_fsm
source install/setup.bash
```

`hit25_auv_ros2`가 사용하는 팀 `dvl_msgs` 패키지도 실물 ROS 작업공간에 있어야 한다.

## 실행

완성된 핑거 호밍 dry-run:

```bash
ros2 launch kmu26_pinger_homing pinger_homing_real.launch.py \
  dry_run:=true tank_max_depth_m:=2.0
```

핑거 Web GUI:

```bash
ros2 run kmu26_pinger_homing start_pinger_homing_gui.sh
```

`http://<robot-ip>:8878/`에서 `Start Robot Stack` → mode 설정 → `ARM` → `Preflight` →
`Start Live RC` 순서로 실행한다. 처음에는 반드시 프로펠러를 제거하고 `Start Dry Run`으로
토픽과 추정 상태부터 확인한다.

시험 중인 비전 FSM dry-run:

```bash
ros2 launch kmu26_vision_mission_fsm mission_fsm_real.launch.py \
  use_observation_mission_fsm:=true dry_run:=true
```
