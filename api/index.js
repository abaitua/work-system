const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const app = express();

let redis = null;
try {
  redis = Redis.fromEnv();
  console.log("Redis 连接成功");
} catch (err) {
  console.error('Redis 初始化失败:', err);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Redis 键名
const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";
const TIME_CONFIG_KEY = "work_system_time_config";

// 默认数据
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

// 初始化所有默认数据到 Redis
async function initDefaultData() {
  if (!redis) return DEFAULT_DATA;
  await redis.set(DATA_KEY, JSON.stringify(DEFAULT_DATA));
  return DEFAULT_DATA;
}
async function initDefaultWorkList() {
  if (!redis) return DEFAULT_WORK_LIST;
  await redis.set(WORK_LIST_KEY, JSON.stringify(DEFAULT_WORK_LIST));
  return DEFAULT_WORK_LIST;
}
async function initDefaultTimeConfig() {
  if (!redis) return DEFAULT_TIME_CONFIG;
  await redis.set(TIME_CONFIG_KEY, JSON.stringify(DEFAULT_TIME_CONFIG));
  return DEFAULT_TIME_CONFIG;
}
async function initDefaultLog() {
  if (!redis) return DEFAULT_LOG;
  await redis.set(LOG_KEY, JSON.stringify(DEFAULT_LOG));
  return DEFAULT_LOG;
}

// ========== 服务启动 全局自检（关键：缺失则自动补全所有云端数据） ==========
(async function serverBootInit() {
  if (!redis) return;
  try {
    // 主数据(员工/管理员/工时)
    let dataRaw = await redis.get(DATA_KEY);
    if (!dataRaw) await initDefaultData();
    // 工作项
    let workRaw = await redis.get(WORK_LIST_KEY);
    if (!workRaw) await initDefaultWorkList();
    // 耗时配置
    let timeRaw = await redis.get(TIME_CONFIG_KEY);
    if (!timeRaw) await initDefaultTimeConfig();
    // 日志
    let logRaw = await redis.get(LOG_KEY);
    if (!logRaw) await initDefaultLog();
    console.log("服务启动，云端数据自检完成");
  } catch (e) {
    console.error("启动自检异常：", e);
  }
})();

// 主数据读写（员工、管理员、填报工时）
async function readData() {
  if (!redis) return DEFAULT_DATA;
  let raw = await redis.get(DATA_KEY);
  if (!raw) return await initDefaultData();
  try { return JSON.parse(raw); } catch { return DEFAULT_DATA; }
}
async function writeData(data) {
  if (!redis) return;
  const copy = JSON.parse(JSON.stringify(data));
  await redis.set(DATA_KEY, JSON.stringify(copy));
}

// 工作项列表
async function readWorkList() {
  if (!redis) return DEFAULT_WORK_LIST;
  let raw = await redis.get(WORK_LIST_KEY);
  if (!raw) return await initDefaultWorkList();
  try { return JSON.parse(raw); } catch { return DEFAULT_WORK_LIST; }
}
async function writeWorkList(list) {
  if (!redis) return;
  await redis.set(WORK_LIST_KEY, JSON.stringify(list));
}

// 耗时配置
async function readTimeConfig() {
  if (!redis) return DEFAULT_TIME_CONFIG;
  let raw = await redis.get(TIME_CONFIG_KEY);
  if (!raw) return await initDefaultTimeConfig();
  try { return JSON.parse(raw); } catch { return DEFAULT_TIME_CONFIG; }
}
async function writeTimeConfig(config) {
  if (!redis) return;
  const copy = JSON.parse(JSON.stringify(config));
  await redis.set(TIME_CONFIG_KEY, JSON.stringify(copy));
}

// 日志
async function readLog() {
  if (!redis) return DEFAULT_LOG;
  let raw = await redis.get(LOG_KEY);
  if (!raw) return DEFAULT_LOG;
  try { return JSON.parse(raw); } catch { return DEFAULT_LOG; }
}
async function addLog(logItem) {
  if (!redis) return;
  let logList = await readLog();
  logList.unshift(logItem);
  if (logList.length > 500) logList = logList.slice(0, 500);
  await redis.set(LOG_KEY, JSON.stringify(logList));
}
async function clearAllLog() {
  if (!redis) return;
  await redis.set(LOG_KEY, JSON.stringify(DEFAULT_LOG));
}

// 时间格式化
function formatUTCDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
}

// 数组对齐
function alignWorkArray(oldArr, newLen) {
  const res = [];
  for(let i = 0; i < newLen; i++){
    res.push(oldArr[i] ?? 0);
  }
  return res;
}

// 静态页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ========== 耗时配置接口（云端持久化） ==========
app.get('/api/getTimeConfig', async (req, res) => {
  try {
    const data = await readTimeConfig();
    res.json({ code: 0, data });
  } catch (e) {
    console.error("读取耗时配置失败：", e);
    res.json({ code: -1, data: DEFAULT_TIME_CONFIG });
  }
});
app.post('/api/saveTimeConfig', async (req, res) => {
  try {
    const config = req.body;
    if (typeof config !== 'object' || config === null) {
      return res.json({ code: -1, msg: "配置格式错误" });
    }
    await writeTimeConfig(config);
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr, logDate: "", operator: "管理员", operatorId: "admin",
      type: "工时配置修改", content: "修改每项工作单次耗时配置", workDetail: ""
    });
    res.json({ code: 0, msg: "耗时配置已保存，全局生效" });
  } catch (e) {
    console.error("保存耗时配置失败：", e);
    res.json({ code: -1, msg: "保存失败" });
  }
});

// ========== 工作项列表（联动耗时配置） ==========
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
    if(!Array.isArray(list) || list.length === 0){
      return res.json({ code: 1, msg: "工作项列表不能为空" });
    }
    const newLen = list.length;
    const data = JSON.parse(JSON.stringify(await readData()));

    Object.values(data.workData).forEach(dayMap => {
      Object.keys(dayMap).forEach(dateKey => {
        dayMap[dateKey] = alignWorkArray(dayMap[dateKey] || [], newLen);
      });
    });

    // 自动同步耗时配置
    let timeConfig = await readTimeConfig();
    let newTimeConfig = {};
    list.forEach(item => {
      newTimeConfig[item] = timeConfig[item] ?? 10;
    });
    await writeTimeConfig(newTimeConfig);

    await writeWorkList(list);
    await writeData(data);

    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr, logDate: "", operator: "管理员", operatorId: "admin",
      type: "工作项编辑", content: `修改系统工作内容列表，当前共${list.length}项`,
      workDetail: list.join("、")
    });
    res.json({ code: 0, msg: "保存成功" });
  } catch (e) {
    console.error("保存工作项失败：", e);
    res.json({ code: -1, msg: "保存失败" });
  }
});

// ========== 登录接口 ==========
app.post('/api/admin/login', async (req, res) => {
  try {
    const data = await readData();
    const { username, pwd } = req.body;
    res.json(data.admin.username === username && data.admin.pwd === pwd
      ? { code: 0, msg: "登录成功" }
      : { code: 1, msg: "账号或密码错误" });
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
      : { code: 1, msg: "账号或密码错误" });
  } catch {
    res.json({ code: -1, msg: "服务异常" });
});

// ========== 新增员工【重点修复】 强制写入Redis ==========
app.post('/api/addStaff', async (req, res) => {
  try {
    const data = await readData();
    const { name, pwd } = req.body;
    if (data.staffList.some(s => s.name === name)) {
      return res.json({ code: 1, msg: "员工已存在" });
    }
    const newId = Date.now().toString();
    // 内存添加
    data.staffList.push({ id: newId, name, pwd });
    // 立刻持久化到云端 Redis
    await writeData(data);
    res.json({ code: 0, msg: "添加成功" });
  } catch (e) {
    console.error("新增员工失败：", e);
    res.json({ code: -1, msg: "添加失败" });
  }
});

// ========== 删除员工【重点修复】 强制写入Redis ==========
app.delete('/api/delStaff/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = req.params.id;
    data.staffList = data.staffList.filter(s => s.id !== id);
    delete data.workData[id];
    // 立刻持久化到云端 Redis
    await writeData(data);
    res.json({ code: 0, msg: "删除成功" });
  } catch (e) {
    console.error("删除员工失败：", e);
    res.json({ code: -1, msg: "删除失败" });
  }
});

// ========== 员工密码修改【修复】 ==========
app.post('/api/admin/updateStaffPwd', async (req, res) => {
  try {
    const { username, pwd, staffId, newPwd } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    const staff = data.staffList.find(s => s.id === staffId);
    if (!staff) {
      return res.json({ code: 2, msg: "员工不存在" });
    }
    staff.pwd = newPwd;
    // 持久化
    await writeData(data);

    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr, logDate: "", operator: "管理员", operatorId: "admin",
      type: "密码修改", content: `修改员工【${staff.name}】登录密码`, workDetail: ""
    });
    res.json({ code: 0, msg: "员工密码修改成功" });
  } catch (e) {
    console.error("修改员工密码失败：", e);
    res.json({ code: -1, msg: "修改失败" });
  }
});

// ========== 管理员密码修改 ==========
app.post('/api/updateAdminPwd', async (req, res) => {
  try {
    const { oldPwd, newPwd } = req.body;
    const data = await readData();
    if (data.admin.pwd !== oldPwd) {
      return res.json({ code: 1, msg: "原密码输入错误" });
    }
    data.admin.pwd = newPwd;
    await writeData(data);
    res.json({ code: 0, msg: "管理员密码修改成功，请使用新密码重新登录" });
  } catch (e) {
    console.error("修改管理员密码失败：", e);
    res.json({ code: -1, msg: "修改失败" });
  }
});

// 其他接口（工时、日志、批量删除）
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
      detailStr += `${workList[idx] || "未知项"}:${val}工时；`;
    });
    const now = new Date();
    const timeStr = formatUTCDate(now);
    const logDate = day;
    await addLog({
      time: timeStr, logDate: logDate, operator: staffName || '未知员工',
      operatorId: staffId, type: "工时填报", content: `填写日期【${day}】`, workDetail: detailStr
    });
    res.json({ code: 0, msg: "保存成功" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});
app.post('/api/admin/batchDeleteWork', async (req, res) => {
  try {
    const { username, pwd, staffId, year, month } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
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
  } catch (err) {
    res.json({ code: -1, msg: "删除失败" });
  }
});
app.post('/api/admin/getLog', async (req, res) => {
  try {
    const { username, pwd, filterStaffId, filterDate } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    let logList = await readLog();
    if (filterStaffId && filterStaffId !== "") {
      logList = logList.filter(item => item.operatorId === filterStaffId);
    }
    if (filterDate && filterDate !== "") {
      logList = logList.filter(item => item.logDate === filterDate);
    }
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
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    await clearAllLog();
    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr, logDate: "", operator: "管理员", operatorId: "admin",
      type: "日志操作", content: "手动清空全部操作日志", workDetail: ""
    });
    res.json({ code: 0, msg: "日志已全部清空" });
  } catch {
    res.json({ code: -1, msg: "清空失败" });
  }
});

module.exports = app;
