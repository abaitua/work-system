const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const app = express();

// 全局 Redis 实例（Vercel 环境优先读环境变量）
const redis = Redis.fromEnv();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Redis Key
const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";
const TIME_CONFIG_KEY = "work_system_time_config";

// 默认基础数据
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};
const DEFAULT_LOG = [];
const DEFAULT_WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];
const DEFAULT_TIME_CONFIG = {
  "首件": 20,
  "巡检": 20,
  "入库": 10,
  "出货": 10,
  "外箱标": 10,
  "内箱标": 10,
  "特标": 10,
  "工单打印": 10,
  "核对物料": 10
};

// 初始化函数：仅当Key不存在时写入，不再覆盖已有数据
async function initDefaultData() {
  const exist = await redis.exists(DATA_KEY);
  if (!exist) {
    await redis.set(DATA_KEY, JSON.stringify(DEFAULT_DATA));
  }
  return JSON.parse(await redis.get(DATA_KEY)) || DEFAULT_DATA;
}
async function initDefaultWorkList() {
  const exist = await redis.exists(WORK_LIST_KEY);
  if (!exist) {
    await redis.set(WORK_LIST_KEY, JSON.stringify(DEFAULT_WORK_LIST));
  }
  return JSON.parse(await redis.get(WORK_LIST_KEY)) || DEFAULT_WORK_LIST;
}
async function initDefaultTimeConfig() {
  const exist = await redis.exists(TIME_CONFIG_KEY);
  if (!exist) {
    await redis.set(TIME_CONFIG_KEY, JSON.stringify(DEFAULT_TIME_CONFIG));
  }
  return JSON.parse(await redis.get(TIME_CONFIG_KEY)) || DEFAULT_TIME_CONFIG;
}

// 数据读写封装
async function readData() {
  let raw = await redis.get(DATA_KEY);
  if (!raw) return await initDefaultData();
  try { return JSON.parse(raw); } catch { return await initDefaultData(); }
}
async function writeData(data) {
  await redis.set(DATA_KEY, JSON.stringify(data));
}

async function readWorkList() {
  let raw = await redis.get(WORK_LIST_KEY);
  if (!raw) return await initDefaultWorkList();
  try { return JSON.parse(raw); } catch { return await initDefaultWorkList(); }
}
async function writeWorkList(list) {
  await redis.set(WORK_LIST_KEY, JSON.stringify(list));
}

async function readTimeConfig() {
  let raw = await redis.get(TIME_CONFIG_KEY);
  if (!raw) return await initDefaultTimeConfig();
  try { return JSON.parse(raw); } catch { return await initDefaultTimeConfig(); }
}
async function writeTimeConfig(config) {
  // 强制持久化到远程 Redis
  await redis.set(TIME_CONFIG_KEY, JSON.stringify(config));
}

async function readLog() {
  let raw = await redis.get(LOG_KEY);
  if (!raw) return DEFAULT_LOG;
  try { return JSON.parse(raw); } catch { return DEFAULT_LOG; }
}
async function addLog(logItem) {
  let logList = await readLog();
  logList.unshift(logItem);
  if (logList.length > 500) logList = logList.slice(0, 500);
  await redis.set(LOG_KEY, JSON.stringify(logList));
}
async function clearAllLog() {
  await redis.set(LOG_KEY, JSON.stringify(DEFAULT_LOG));
}

function formatUTCDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mi}:${s}`;
}

function alignWorkArray(oldArr, newLen) {
  const res = [];
  for (let i = 0; i < newLen; i++) {
    res.push(oldArr[i] ?? 0);
  }
  return res;
}

// 路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/api/getTimeConfig', async (req, res) => {
  try {
    const data = await readTimeConfig();
    res.json({ code: 0, data });
  } catch (e) {
    res.json({ code: -1, data: DEFAULT_TIME_CONFIG });
  }
});

app.post('/api/saveTimeConfig', async (req, res) => {
  try {
    const config = req.body;
    await writeTimeConfig(config);
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "工时配置修改",
      content: "修改每项工作单次耗时配置",
      workDetail: ""
    });
    res.json({ code: 0, msg: "工时配置保存成功" });
  } catch (e) {
    res.json({ code: -1, msg: "保存失败" });
  }
});

app.get('/api/getWorkList', async (req, res) => {
  try {
    const list = await readWorkList();
    res.json({ code: 0, list });
  } catch {
    res.json({ code: -1, list: DEFAULT_WORK_LIST });
  }
});

app.post('/api/saveWorkList', async (req, res) => {
  try {
    const { list } = req.body;
    if (!Array.isArray(list) || list.length === 0) {
      return res.json({ code: 1, msg: "工作项不能为空" });
    }
    const newLen = list.length;
    const data = await readData();
    Object.values(data.workData).forEach(dayMap => {
      Object.keys(dayMap).forEach(dateKey => {
        dayMap[dateKey] = alignWorkArray(dayMap[dateKey] || [], newLen);
      });
    });
    await writeWorkList(list);
    await writeData(data);
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "工作项编辑",
      content: `修改工作列表，共${list.length}项`,
      workDetail: list.join("、")
    });
    res.json({ code: 0, msg: "保存成功" });
  } catch (e) {
    res.json({ code: -1, msg: "保存失败" });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const data = await readData();
    const { username, pwd } = req.body;
    res.json(data.admin.username === username && data.admin.pwd === pwd
      ? { code: 0, msg: "登录成功" }
      : { code: 1, msg: "账号密码错误" });
  } catch {
    res.json({ code: -1, msg: "服务异常" });
  }
});

app.post('/api/staff/login', async (req, res) => {
  try {
    const data = await readData();
    const { name, pwd } = req.body;
    const user = data.staffList.find(item => item.name === name && item.pwd === pwd);
    res.json(user
      ? { code: 0, msg: "登录成功", id: user.id, name: user.name }
      : { code: 1, msg: "账号密码错误" });
  } catch {
    res.json({ code: -1, msg: "服务异常" });
  }
});

app.get('/api/getAllData', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch {
    res.json(DEFAULT_DATA);
  }
});

app.get('/api/getStaffWork/:staffId', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.workData[req.params.staffId] || {});
  } catch {
    res.json({});
  }
});

app.post('/api/saveWorkData', async (req, res) => {
  try {
    const data = await readData();
    const workList = await readWorkList();
    const { staffId, day, workArr, staffName } = req.body;
    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;
    await writeData(data);
    let detailStr = "";
    workArr.forEach((val, idx) => {
      detailStr += `${workList[idx] || "未知"}:${val}次；`;
    });
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: day,
      operator: staffName || "员工",
      operatorId: staffId,
      type: "工时填报",
      content: `填报日期：${day}`,
      workDetail: detailStr
    });
    res.json({ code: 0, msg: "保存成功" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});

app.post('/api/addStaff', async (req, res) => {
  try {
    const data = await readData();
    const { name, pwd } = req.body;
    if (data.staffList.some(s => s.name === name)) {
      return res.json({ code: 1, msg: "员工已存在" });
    }
    const newId = Date.now().toString();
    data.staffList.push({ id: newId, name, pwd });
    await writeData(data);
    res.json({ code: 0, msg: "添加成功" });
  } catch {
    res.json({ code: -1, msg: "添加失败" });
  }
});

app.delete('/api/delStaff/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = req.params.id;
    data.staffList = data.staffList.filter(s => s.id !== id);
    delete data.workData[id];
    await writeData(data);
    res.json({ code: 0, msg: "删除成功" });
  } catch {
    res.json({ code: -1, msg: "删除失败" });
  }
});

app.post('/api/admin/batchDeleteWork', async (req, res) => {
  try {
    const { username, pwd, staffId, year, month } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限不足" });
    }
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    if (staffId) {
      if (data.workData[staffId]) {
        Object.keys(data.workData[staffId]).forEach(key => {
          if (key.startsWith(prefix)) delete data.workData[staffId][key];
        });
      }
    } else {
      Object.values(data.workData).forEach(person => {
        Object.keys(person).forEach(key => {
          if (key.startsWith(prefix)) delete person[key];
        });
      });
    }
    await writeData(data);
    res.json({ code: 0, msg: "数据删除成功" });
  } catch {
    res.json({ code: -1, msg: "删除失败" });
  }
});

app.post('/api/updateAdminPwd', async (req, res) => {
  try {
    const { oldPwd, newPwd } = req.body;
    const data = await readData();
    if (data.admin.pwd !== oldPwd) {
      return res.json({ code: 1, msg: "原密码错误" });
    }
    data.admin.pwd = newPwd;
    await writeData(data);
    res.json({ code: 0, msg: "密码修改成功，请重新登录" });
  } catch {
    res.json({ code: -1, msg: "修改失败" });
  }
});

app.post('/api/admin/updateStaffPwd', async (req, res) => {
  try {
    const { username, pwd, staffId, newPwd } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限不足" });
    }
    const staff = data.staffList.find(s => s.id === staffId);
    if (!staff) return res.json({ code: 2, msg: "员工不存在" });
    staff.pwd = newPwd;
    await writeData(data);
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "密码修改",
      content: `修改员工【${staff.name}】密码`,
      workDetail: ""
    });
    res.json({ code: 0, msg: "修改成功" });
  } catch {
    res.json({ code: -1, msg: "修改失败" });
  }
});

app.post('/api/admin/getLog', async (req, res) => {
  try {
    const { username, pwd, filterStaffId, filterDate } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限不足" });
    }
    let logList = await readLog();
    if (filterStaffId && filterStaffId !== "") logList = logList.filter(i => i.operatorId === filterStaffId);
    if (filterDate && filterDate !== "") logList = logList.filter(i => i.logDate === filterDate);
    res.json({ code: 0, data: logList });
  } catch {
    res.json({ code: -1, msg: "获取日志失败" });
  }
});

app.post('/api/admin/clearLog', async (req, res) => {
  try {
    const { username, pwd } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限不足" });
    }
    await clearAllLog();
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "日志操作",
      content: "清空全部日志",
      workDetail: ""
    });
    res.json({ code: 0, msg: "日志已清空" });
  } catch {
    res.json({ code: -1, msg: "清空失败" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务运行端口: ${PORT}`);
});
