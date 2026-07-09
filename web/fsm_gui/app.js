const els = {};
const ids = [
  "serverState", "rcAllowed", "cameraEnabled", "reloadCamera", "cameraFeed", "cameraEmpty",
  "cameraMeta", "missionRunning", "saveConfig", "startDry", "startLive", "stopMission",
  "startPinger", "stopPinger", "startMarkers", "startRviz", "stopRviz", "stopMarkers",
  "course", "ownCourse", "boundaryX", "boundaryMargin", "boundaryStandoff", "rateHz",
  "transport", "poseTopic", "statusPath", "fsmState", "robotState", "targetState",
  "countState", "commandState", "robotPose", "rcStatus", "rcRelease", "rcCenter",
  "rcSendAxes", "axisForward", "axisLateral", "axisHeave", "axisYaw", "rcReadout",
  "topicRows", "buoyRows", "processLog"
];

for (const id of ids) {
  els[id] = document.getElementById(id);
}

let firstConfigLoad = true;
let lastCameraUrl = "";

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toFixed(digits);
}

function setPill(el, text, cls = "") {
  el.textContent = text;
  el.className = `pill ${cls}`.trim();
}

function setConfigFields(config) {
  if (!firstConfigLoad || !config) return;
  els.course.value = config.course ?? "all";
  els.ownCourse.value = config.own_course ?? "a";
  els.boundaryX.value = config.course_boundary_x ?? 0;
  els.boundaryMargin.value = config.course_boundary_margin ?? 0.8;
  els.boundaryStandoff.value = config.course_boundary_standoff ?? 0.7;
  els.rateHz.value = config.rate_hz ?? 30;
  els.transport.value = config.transport ?? "rc_override";
  els.poseTopic.value = config.pose_topic ?? "/odometry/filtered";
  firstConfigLoad = false;
}

function collectConfig() {
  return {
    course: els.course.value,
    own_course: els.ownCourse.value,
    course_boundary_x: Number(els.boundaryX.value),
    course_boundary_margin: Number(els.boundaryMargin.value),
    course_boundary_standoff: Number(els.boundaryStandoff.value),
    rate_hz: Number(els.rateHz.value),
    transport: els.transport.value,
    pose_topic: els.poseTopic.value,
    camera_enabled: els.cameraEnabled.checked
  };
}

async function post(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `${path} failed`);
  }
  return data;
}

async function saveConfig() {
  await post("/api/config", collectConfig());
  await refreshStatus();
}

async function startProcess(kind, extra = {}) {
  await saveConfig();
  await post("/api/process/start", {kind, ...extra});
  await refreshStatus();
}

async function stopProcess(kind) {
  await post("/api/process/stop", {kind});
  await refreshStatus();
}

async function sendRc(mode) {
  const axes = {
    forward: Number(els.axisForward.value),
    lateral: Number(els.axisLateral.value),
    heave: Number(els.axisHeave.value),
    yaw: Number(els.axisYaw.value)
  };
  await post("/api/rc", {mode, axes});
  await refreshStatus();
}

function renderTopics(topics) {
  const rows = Object.entries(topics || {}).map(([key, item]) => {
    const alive = item.alive ? "<span class=\"pill ok\">yes</span>" : "<span class=\"pill bad\">no</span>";
    return `<tr>
      <td class="topic-name" title="${item.name || key}">${item.name || key}</td>
      <td>${alive}</td>
      <td>${fmt(item.hz, 1)}</td>
      <td>${item.age === null || item.age === undefined ? "n/a" : fmt(item.age, 1) + "s"}</td>
    </tr>`;
  });
  els.topicRows.innerHTML = rows.join("");
}

function renderBuoys(status) {
  const buoys = Array.isArray(status?.buoys) ? status.buoys : [];
  if (!buoys.length) {
    els.buoyRows.innerHTML = `<tr><td colspan="5">No buoy status</td></tr>`;
    return;
  }
  els.buoyRows.innerHTML = buoys.map((b) => {
    const xyz = Array.isArray(b.xyz) ? b.xyz.map((v) => fmt(v, 1)).join(", ") : "n/a";
    const flags = [
      b.processed ? "processed" : "",
      b.failed ? "failed" : "",
      b.capture ? "capture" : ""
    ].filter(Boolean).join(" ");
    return `<tr>
      <td title="${b.id || ""}">${b.id || "n/a"}</td>
      <td>${b.class || b.target_class || "n/a"}</td>
      <td>${b.state || "n/a"}</td>
      <td>${xyz}</td>
      <td>${flags || "-"}</td>
    </tr>`;
  }).join("");
}

function renderProcesses(processes) {
  const mission = processes?.mission?.running;
  setPill(els.missionRunning, mission ? "mission running" : "mission idle", mission ? "ok" : "");
  const lines = [];
  for (const [key, proc] of Object.entries(processes || {})) {
    lines.push(`${key}: ${proc.running ? "running" : "stopped"} pid=${proc.pid ?? "-"}`);
    if (proc.command?.length) lines.push(`  ${proc.command.join(" ")}`);
  }
  els.processLog.textContent = lines.join("\n");
}

function renderStatus(data) {
  setPill(els.serverState, "connected", "ok");
  setPill(els.rcAllowed, data.rc_send_allowed ? "RC send enabled" : "RC send locked", data.rc_send_allowed ? "warn" : "");
  setPill(els.rcStatus, data.rc_send_allowed ? "enabled" : "locked", data.rc_send_allowed ? "warn" : "");
  els.rcRelease.disabled = !data.rc_send_allowed;
  els.rcCenter.disabled = !data.rc_send_allowed;
  els.rcSendAxes.disabled = !data.rc_send_allowed;

  setConfigFields(data.config);
  els.cameraEnabled.checked = Boolean(data.camera?.enabled);
  const camAge = data.camera?.age;
  els.cameraEmpty.style.display = data.camera?.has_frame ? "none" : "grid";
  els.cameraMeta.textContent = `compressed: ${data.camera?.compressed_topic || "-"} | raw: ${data.camera?.raw_topic || "-"} | age: ${camAge == null ? "n/a" : fmt(camAge, 1) + "s"} | raw conversion: ${data.camera?.raw_conversion || "n/a"}`;
  if (data.camera?.enabled && lastCameraUrl === "") {
    reloadCamera();
  }

  const status = data.mission_status || {};
  els.statusPath.textContent = data.mission_status_path || "";
  els.fsmState.textContent = status.state || "NO_STATUS";
  els.robotState.textContent = status.robot_state_label || status.robot_state || "n/a";
  const target = [status.target_class, status.target_id].filter(Boolean).join(" ");
  els.targetState.textContent = target || "none";
  const rem = status.remaining_attached ?? 0;
  const ok = status.processed_count ?? 0;
  const fail = status.failed_count ?? 0;
  const scored = status.scored_count ?? 0;
  els.countState.textContent = `rem ${rem} | ok ${ok} | fail ${fail} | scored ${scored}`;
  const cmd = status.command || {};
  els.commandState.textContent = `${cmd.phase || "n/a"} f=${fmt(cmd.forward)} s=${fmt(cmd.sway)} h=${fmt(cmd.heave)} y=${fmt(cmd.yaw)}`;
  const robot = status.robot || data.telemetry?.pose || {};
  els.robotPose.textContent = `x ${fmt(robot.x)} y ${fmt(robot.y)} z ${fmt(robot.z)} yaw ${fmt(robot.yaw_rad ?? robot.yaw)}`;

  const rc = data.telemetry?.last_rc_override || [];
  const manual = data.telemetry?.last_manual_control || {};
  els.rcReadout.textContent = [
    `override: ${rc.slice(0, 8).join(" ") || "n/a"}`,
    `manual: x=${manual.x ?? "n/a"} y=${manual.y ?? "n/a"} z=${manual.z ?? "n/a"} r=${manual.r ?? "n/a"}`,
    `mavros: connected=${data.telemetry?.mavros_state?.connected} armed=${data.telemetry?.mavros_state?.armed} mode=${data.telemetry?.mavros_state?.mode || ""}`
  ].join("\n");

  renderTopics(data.topics);
  renderBuoys(status);
  renderProcesses(data.processes);
  const extraLogs = Array.isArray(data.logs) ? data.logs.slice(-80).join("\n") : "";
  if (extraLogs) {
    els.processLog.textContent = `${els.processLog.textContent}\n${extraLogs}`.trim();
  }
}

async function refreshStatus() {
  try {
    const res = await fetch("/api/status", {cache: "no-store"});
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    setPill(els.serverState, "disconnected", "bad");
  }
}

function reloadCamera() {
  lastCameraUrl = `/api/camera.mjpg?t=${Date.now()}`;
  els.cameraFeed.src = lastCameraUrl;
}

els.saveConfig.addEventListener("click", () => saveConfig().catch(alert));
els.startDry.addEventListener("click", () => startProcess("mission", {dry_run: true}).catch(alert));
els.startLive.addEventListener("click", () => startProcess("mission", {dry_run: false}).catch(alert));
els.stopMission.addEventListener("click", () => stopProcess("mission").catch(alert));
els.startPinger.addEventListener("click", () => startProcess("pinger").catch(alert));
els.stopPinger.addEventListener("click", () => stopProcess("pinger").catch(alert));
els.startMarkers.addEventListener("click", () => startProcess("markers").catch(alert));
els.stopMarkers.addEventListener("click", () => stopProcess("markers").catch(alert));
els.startRviz.addEventListener("click", () => startProcess("rviz").catch(alert));
els.stopRviz.addEventListener("click", () => stopProcess("rviz").catch(alert));
els.rcRelease.addEventListener("click", () => sendRc("release").catch(alert));
els.rcCenter.addEventListener("click", () => sendRc("center").catch(alert));
els.rcSendAxes.addEventListener("click", () => sendRc("axes").catch(alert));
els.reloadCamera.addEventListener("click", reloadCamera);
els.cameraEnabled.addEventListener("change", () => saveConfig().then(reloadCamera).catch(alert));

refreshStatus();
setInterval(refreshStatus, 700);
