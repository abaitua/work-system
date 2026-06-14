const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const serverless = require('serverless-http');
const app = express();

// Redis 初始化 + 容错（无环境变量不崩溃）
let redis = null;
let redisAvailable = false;
try {
  redis = Redis.fromEnv();
  redisAvailable = true;
  console.log('Redis 连接成功');
} catch (err) {
  console.error('Redis 初始化失败，降级为内存模式:', err.message);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// 所有存储KEY
const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";
const TIME_CONFIG_KEY = "work_time_config";

// 默认数据
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};
const DEFAULT_LOG = [];
const DEFAULT_WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];
// 新增：默认工时配置
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

// 内存兜底数据（Redis失效时使用）
let memoryData = JSON.parse(JSON.stringify(DEFAULT_DATA));
let memoryLog = [...DEFAULT_LOG];
let memoryWorkList = [...DEFAULT_WORK_LIST];
let memoryTimeConfig = JSON.parse(JSON.stringify(DEFAULT_TIME_CONFIG));

// ========== 原有读写方法 兼容Redis/内存 ==========
async function initDefaultData() {
  if (!redisAvailable) return DEFAULT_DATA;
  await redis.set(DATA_KEY, DEFAULT_DATA);
  return DEFAULT_DATA;
}
async function initDefaultWorkList() {
  if (!redisAvailable) return DEFAULT_WORK_LIST;
  await redis.set(WORK_LIST_KEY, DEFAULT_WORK_LIST);
  return DEFAULT_WORK_LIST;
}

// 读写主数据
async function readData() {
  if (!redisAvailable) return memoryData;
  let data = await redis.get(DATA_KEY);
  const res = data || await initDefaultData();
  memoryData = JSON.parse(JSON.stringify(res));
  return res;
}
async function writeData(data) {
  memoryData = JSON.parse(JSON.stringify(data));
  if (!redisAvailable) return;
  await redis.set(DATA_KEY, data);
}

// 读写工作项列表
async function readWorkList() {
  if (!redisAvailable) return memoryWorkList;
  let list = await redis.get(WORK_LIST_KEY);
  const res = list || await initDefaultWorkList();
  memoryWorkList = [...res];
  return res;
}
async function writeWorkList(list) {
  memoryWorkList = [...list];
  if (!redisAvailable) return;
  await redis.set(WORK_LIST_KEY, list);
}

// 日志读写
async function readLog() {
  if (!redisAvailable) return memoryLog;
  let log = await redis.get(LOG_KEY);
  const res = log || DEFAULT_LOG;
  memoryLog = [...res];
  return res;
}
async function addLog(logItem) {
  if (!redisAvailable) {
    memoryLog.unshift(logItem);
    return;
  }
  let logList = await readLog();
  logList.unshift(logItem);
  await redis.set(LOG_KEY, logList);
}
async function clearAllLog() {
  memoryLog = [...DEFAULT_LOG];
  if (!redisAvailable) return;
  await redis.set(LOG_KEY, DEFAULT_LOG);
}

// ========== 新增：工时配置读写方法 ==========
async function readTimeConfig() {
  if (!redisAvailable) return memoryTimeConfig;
  let config = await redis.get(TIME_CONFIG_KEY);
  const res = config || DEFAULT_TIME_CONFIG;
  memoryTimeConfig = JSON.parse(JSON.stringify(res));
  return res;
}
async function writeTimeConfig(config) {
  memoryTimeConfig = JSON.parse(JSON.stringify(config));
  if (!redisAvailable) return;
  await redis.set(TIME_CONFIG_KEY, config);
}

// 时间格式化：UTC 转为 YYYY-MM-DD HH:mm:ss
function formatUTCDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
}

// 工时数组对齐（增删工作项后统一数组长度）
function alignWorkArray(oldArr, newLen) {
  const res = [];
  for(let i = 0; i < newLen; i++){
    res.push(oldArr[i] ?? 0);
  }
  return res;
}

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ========== 新增接口：工时配置 读取 & 保存 ==========
app.get('/api/getTimeConfig', async (req, res) => {
  try {
    const config = await readTimeConfig();
    res.json({ code: 0, data: config });
  } catch {
    res.json({ code: 0, data: DEFAULT_TIME_CONFIG });
  }
});

app.post('/api/saveTimeConfig', async (req, res) => {
  try {
    const config = req.body;
    await writeTimeConfig(config);
    res.json({ code: 0, msg: "配置已全局生效" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// ========== 原有全部接口（无改动，保留你原有逻辑） ==========
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
    const data = await readData();
    const newLen = list.length;

    Object.values(data.workData).forEach(dayMap => {
      Object.keys(dayMap).forEach(dateKey => {
        dayMap[dateKey] = alignWorkArray(dayMap[dateKey], newLen);
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
      content: `修改系统工作内容列表，当前共${list.length}项`,
      workDetail: list.join("、")
    });

    res.json({ code: 0, msg: "保存成功" });
  } catch (e) {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 管理员登录
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

// 员工登录
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
  }
});

// 获取全部数据
app.get('/api/getAllData', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch {
    res.json(DEFAULT_DATA);
  }
});

// 获取单个员工工时
app.get('/api/getStaffWork/:staffId', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.workData[req.params.staffId] || {});
  } catch {
    res.json({});
  }
});

// 保存工时 + UTC 时间日志
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
      time: timeStr,
      logDate: logDate,
      operator: staffName || '未知员工',
      operatorId: staffId,
      type: "工时填报",
      content: `填写日期【${day}】`,
      workDetail: detailStr
    });

    res.json({ code: 0, msg: "保存成功" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 新增员工
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

// 删除员工
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

// 批量删除年月数据
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

// 修改管理员密码
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
  } catch (err) {
    res.json({ code: -1, msg: "修改失败" });
  }
});

// 管理员修改员工密码
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
    await writeData(data);

    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "密码修改",
      content: `修改员工【${staff.name}】登录密码`,
      workDetail: ""
    });

    res.json({ code: 0, msg: "员工密码修改成功" });
  } catch {
    res.json({ code: -1, msg: "修改失败" });
  }
});

// 获取日志（支持员工+日期筛选）
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

// 清空全部日志
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
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "日志操作",
      content: "手动清空全部操作日志",
      workDetail: ""
    });

    res.json({ code: 0, msg: "日志已全部清空" });
  } catch {
    res.json({ code: -1, msg: "清空失败" });
  }
});

// 适配 Vercel Serverless 导出（解决500崩溃核心）
module.exports = serverless(app);
