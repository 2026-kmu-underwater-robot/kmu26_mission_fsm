const els = {};
const ids = [
  "serverState", "rcAllowed", "cameraEnabled", "reloadCamera", "cameraFeed", "cameraEmpty",
  "cameraMeta", "missionRunning", "saveConfig", "startDry", "startLive", "stopMission",
  "startPinger", "stopPinger", "startMarkers", "startRviz", "stopRviz", "stopMarkers",
  "course", "ownCourse", "boundaryX", "boundaryMargin", "boundaryStandoff", "rateHz",
  "transport", "poseTopic", "statusPath", "fsmState", "robotState", "targetState",
  "countState", "commandState", "robotPose", "rcStatus", "rcRelease", "rcCenter",
  "rcSendAxes", "axisForward", "axisLateral", "axisHeave", "axisYaw", "rcReadout",
  "topicRows", "buoyRows", "processLog", "missionMap", "mapMeta", "tankXMin", "tankXMax",
  "tankYMin", "tankYMax", "robotStartX", "robotStartY", "robotStartYaw", "scoreZoneX",
  "scoreZoneY", "scoreZoneRadius"
];

for (const id of ids) {
  els[id] = document.getElementById(id);
}

let firstConfigLoad = true;
let lastCameraUrl = "";
let latestStatus = null;

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
  els.tankXMin.value = config.tank_x_min ?? -12;
  els.tankXMax.value = config.tank_x_max ?? 12;
  els.tankYMin.value = config.tank_y_min ?? -8;
  els.tankYMax.value = config.tank_y_max ?? 8;
  els.robotStartX.value = config.robot_start_x ?? 0;
  els.robotStartY.value = config.robot_start_y ?? 0;
  els.robotStartYaw.value = config.robot_start_yaw_deg ?? 0;
  els.scoreZoneX.value = config.score_zone_x ?? 8;
  els.scoreZoneY.value = config.score_zone_y ?? 0;
  els.scoreZoneRadius.value = config.score_zone_radius ?? 1.5;
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
    tank_x_min: Number(els.tankXMin.value),
    tank_x_max: Number(els.tankXMax.value),
    tank_y_min: Number(els.tankYMin.value),
    tank_y_max: Number(els.tankYMax.value),
    robot_start_x: Number(els.robotStartX.value),
    robot_start_y: Number(els.robotStartY.value),
    robot_start_yaw_deg: Number(els.robotStartYaw.value),
    score_zone_x: Number(els.scoreZoneX.value),
    score_zone_y: Number(els.scoreZoneY.value),
    score_zone_radius: Number(els.scoreZoneRadius.value),
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

function numberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeLimits(config) {
  let xMin = numberOr(config?.tank_x_min, -12);
  let xMax = numberOr(config?.tank_x_max, 12);
  let yMin = numberOr(config?.tank_y_min, -8);
  let yMax = numberOr(config?.tank_y_max, 8);
  if (xMax <= xMin) xMax = xMin + 1;
  if (yMax <= yMin) yMax = yMin + 1;
  return {xMin, xMax, yMin, yMax};
}

function drawArrow(ctx, sx, sy, ex, ey, color, width = 2) {
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * 10 - uy * 5, ey - uy * 10 + ux * 5);
  ctx.lineTo(ex - ux * 10 + uy * 5, ey - uy * 10 - ux * 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMissionMap(data) {
  const canvas = els.missionMap;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const config = data.config || {};
  const status = data.mission_status || {};
  const limits = normalizeLimits(config);
  const pad = 38;
  const viewW = rect.width - pad * 2;
  const viewH = rect.height - pad * 2;
  const sx = viewW / (limits.xMax - limits.xMin);
  const sy = viewH / (limits.yMax - limits.yMin);
  const scale = Math.min(sx, sy);
  const drawW = (limits.xMax - limits.xMin) * scale;
  const drawH = (limits.yMax - limits.yMin) * scale;
  const ox = (rect.width - drawW) / 2;
  const oy = (rect.height - drawH) / 2;
  const toScreen = (x, y) => ({
    x: ox + (x - limits.xMin) * scale,
    y: oy + drawH - (y - limits.yMin) * scale
  });

  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#eaf3fb";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const bx = numberOr(config.course_boundary_x, 0);
  const margin = Math.max(0, numberOr(config.course_boundary_margin, 0.8));
  const standoff = Math.max(0, numberOr(config.course_boundary_standoff, 0.7));
  const ownSide = String(config.own_course || "a").toLowerCase();
  const left = toScreen(limits.xMin, limits.yMax);
  const right = toScreen(limits.xMax, limits.yMin);
  const boundary = toScreen(bx, 0).x;
  const ownLeft = ownSide !== "b";

  ctx.fillStyle = ownLeft ? "rgba(53, 137, 201, 0.14)" : "rgba(205, 91, 91, 0.12)";
  ctx.fillRect(left.x, left.y, boundary - left.x, right.y - left.y);
  ctx.fillStyle = ownLeft ? "rgba(205, 91, 91, 0.12)" : "rgba(53, 137, 201, 0.14)";
  ctx.fillRect(boundary, left.y, right.x - boundary, right.y - left.y);

  ctx.strokeStyle = "#486577";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left.x, left.y, right.x - left.x, right.y - left.y);

  ctx.strokeStyle = "#1aa6b8";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(boundary, left.y);
  ctx.lineTo(boundary, right.y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [x, color] of [[bx - margin, "#7cc3ce"], [bx + margin, "#7cc3ce"], [bx - standoff, "#b7791f"], [bx + standoff, "#b7791f"]]) {
    const px = toScreen(x, 0).x;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(px, left.y);
    ctx.lineTo(px, right.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = "#2f4354";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(`tank x ${limits.xMin}..${limits.xMax} m | y ${limits.yMin}..${limits.yMax} m`, left.x, Math.max(14, left.y - 12));
  ctx.fillText(ownLeft ? "A / own" : "B / own", left.x + 8, left.y + 18);
  ctx.fillText(ownLeft ? "B / opponent" : "A / opponent", boundary + 8, left.y + 18);

  const score = toScreen(numberOr(config.score_zone_x, 8), numberOr(config.score_zone_y, 0));
  const scoreRadius = Math.max(0, numberOr(config.score_zone_radius, 1.5)) * scale;
  ctx.fillStyle = "rgba(36, 163, 106, 0.22)";
  ctx.strokeStyle = "#16824f";
  ctx.beginPath();
  ctx.arc(score.x, score.y, scoreRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#146c43";
  ctx.fillText("score", score.x + 6, score.y - 6);

  const start = toScreen(numberOr(config.robot_start_x, 0), numberOr(config.robot_start_y, 0));
  const startYaw = numberOr(config.robot_start_yaw_deg, 0) * Math.PI / 180;
  ctx.fillStyle = "#f6c445";
  ctx.strokeStyle = "#5e4b13";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawArrow(ctx, start.x, start.y, start.x + Math.cos(startYaw) * 26, start.y - Math.sin(startYaw) * 26, "#7a5d00", 2);

  const buoys = Array.isArray(status.buoys) ? status.buoys : [];
  const targetId = status.target_id || "";
  for (const buoy of buoys) {
    if (!Array.isArray(buoy.xyz) || buoy.xyz.length < 2) continue;
    const p = toScreen(Number(buoy.xyz[0]), Number(buoy.xyz[1]));
    const isTarget = targetId && buoy.id === targetId;
    const failed = Boolean(buoy.failed);
    const processed = Boolean(buoy.processed);
    ctx.fillStyle = failed ? "#8a8f98" : processed ? "#24a36a" : isTarget ? "#d23232" : "#f28c28";
    ctx.strokeStyle = isTarget ? "#7d0000" : "#603813";
    ctx.lineWidth = isTarget ? 2.5 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, isTarget ? 8 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (isTarget) {
      ctx.fillStyle = "#7d0000";
      ctx.fillText("target", p.x + 8, p.y - 8);
    }
  }

  const robotSource = status.robot || data.telemetry?.pose || {};
  const robotX = Number(robotSource.x);
  const robotY = Number(robotSource.y);
  const robotYaw = Number(robotSource.yaw_rad ?? robotSource.yaw);
  if (Number.isFinite(robotX) && Number.isFinite(robotY)) {
    const robot = toScreen(robotX, robotY);
    ctx.fillStyle = "#1b5c9e";
    ctx.strokeStyle = "#062b50";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(robot.x, robot.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (Number.isFinite(robotYaw)) {
      drawArrow(ctx, robot.x, robot.y, robot.x + Math.cos(robotYaw) * 34, robot.y - Math.sin(robotYaw) * 34, "#062b50", 3);
    }
    const cmd = status.command || {};
    const forward = Number(cmd.forward);
    const sway = Number(cmd.sway);
    if (Number.isFinite(forward) && Number.isFinite(sway) && Math.hypot(forward, sway) > 0.01) {
      const yaw = Number.isFinite(robotYaw) ? robotYaw : 0;
      const worldX = Math.cos(yaw) * forward - Math.sin(yaw) * sway;
      const worldY = Math.sin(yaw) * forward + Math.cos(yaw) * sway;
      drawArrow(ctx, robot.x, robot.y, robot.x + worldX * 40, robot.y - worldY * 40, "#255f2f", 2);
    }
  }

  const detection = status.detection;
  if (detection?.p_intake && Number.isFinite(robotX) && Number.isFinite(robotY)) {
    const yaw = Number.isFinite(robotYaw) ? robotYaw : 0;
    const dx = Number(detection.p_intake[0] ?? 0);
    const dy = Number(detection.p_intake[1] ?? 0);
    const wx = robotX + Math.cos(yaw) * dx - Math.sin(yaw) * dy;
    const wy = robotY + Math.sin(yaw) * dx + Math.cos(yaw) * dy;
    const p = toScreen(wx, wy);
    ctx.strokeStyle = "#d23232";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 8, p.y);
    ctx.lineTo(p.x + 8, p.y);
    ctx.moveTo(p.x, p.y - 8);
    ctx.lineTo(p.x, p.y + 8);
    ctx.stroke();
  }

  els.mapMeta.textContent = `scale ${fmt(1 / scale, 2)} m/px | boundary x=${fmt(bx, 1)} | margin ${fmt(margin, 1)} | standoff ${fmt(standoff, 1)}`;
}

function renderStatus(data) {
  latestStatus = data;
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
  drawMissionMap(data);
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

for (const id of [
  "tankXMin", "tankXMax", "tankYMin", "tankYMax", "robotStartX", "robotStartY",
  "robotStartYaw", "scoreZoneX", "scoreZoneY", "scoreZoneRadius", "boundaryX",
  "boundaryMargin", "boundaryStandoff", "ownCourse"
]) {
  els[id].addEventListener("input", () => {
    if (!latestStatus) return;
    latestStatus.config = {...latestStatus.config, ...collectConfig()};
    drawMissionMap(latestStatus);
  });
}

refreshStatus();
setInterval(refreshStatus, 700);
