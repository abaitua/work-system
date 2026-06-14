const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const app = express();

// 全局禁用缓存
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// 适配Vercel KV现有环境变量
function getRedis() {
  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
    console.log("Redis 连接成功");
    return redis;
  } catch (err) {
    console.error('Redis 连接失败:', err.message);
    return null;
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";
const TIME_CONFIG_KEY = "work_system_time_config";

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

// 初始化
async function initDefaultData() {
  const redis = getRedis();
  if (!redis) return DEFAULT_DATA;
  await redis.set(DATA_KEY, JSON.stringify(DEFAULT_DATA));
  console.log("初始化DATA_KEY默认值");
  return DEFAULT_DATA;
}
async function initDefaultWorkList() {
  const redis = getRedis();
  if (!redis) return DEFAULT_WORK_LIST;
  await redis.set(WORK_LIST_KEY, JSON.stringify(DEFAULT_WORK_LIST));
  console.log("初始化WORK_LIST_KEY默认值");
  return DEFAULT_WORK_LIST;
}
async function initDefaultTimeConfig() {
  const redis = getRedis();
  if (!redis) return DEFAULT_TIME_CONFIG;
  await redis.set(TIME_CONFIG_KEY, JSON.stringify(DEFAULT_TIME_CONFIG));
  console.log("初始化TIME_CONFIG_KEY默认值");
  return DEFAULT_TIME_CONFIG;
}

// 主数据读写
async function readData() {
  const redis = getRedis();
  if (!redis) return DEFAULT_DATA;
  let raw = await redis.get(DATA_KEY);
  console.log("readData raw值：", raw);
  if (!raw) return await initDefaultData();
  try { return JSON.parse(raw); } catch { return DEFAULT_DATA; }
}
async function writeData(data) {
  const redis = getRedis();
  if (!redis) return;
  const copy = JSON.parse(JSON.stringify(data));
  const str = JSON.stringify(copy);
  console.log("写入DATA_KEY：", str);
  await redis.set(DATA_KEY, str);
  console.log("DATA_KEY写入完成");
}

// 工作项列表（加详细日志）
async function readWorkList() {
  const redis = getRedis();
  if (!redis) return DEFAULT_WORK_LIST;
  let raw = await redis.get(WORK_LIST_KEY);
  console.log("readWorkList 读取原始raw：", raw);
  if (!raw) {
    console.log("WORK_LIST_KEY为空，执行初始化");
    return await initDefaultWorkList();
  }
  try {
    const parseData = JSON.parse(raw);
    console.log("readWorkList 解析结果：", parseData);
    return parseData;
  } catch (e) {
    console.error("解析WORK_LIST失败", e);
    return DEFAULT_WORK_LIST;
  }
}
async function writeWorkList(list) {
  const redis = getRedis();
  if (!redis) return;
  const str = JSON.stringify(list);
  console.log("即将写入WORK_LIST_KEY内容：", str);
  await redis.set(WORK_LIST_KEY, str);
  console.log("WORK_LIST_KEY 写入完成");
}

// 工时配置
async function readTimeConfig() {
  const redis = getRedis();
  if (!redis) return DEFAULT_TIME_CONFIG;
  let raw = await redis.get(TIME_CONFIG_KEY);
  console.log("readTimeConfig raw：", raw);
  if (!raw) return await initDefaultTimeConfig();
  try { return JSON.parse(raw); } catch { return DEFAULT_TIME_CONFIG; }
}
async function writeTimeConfig(config) {
  const redis = getRedis();
  if (!redis) return;
  const str = JSON.stringify(config);
  console.log("写入TIME_CONFIG_KEY：", str);
  await redis.set(TIME_CONFIG_KEY, str);
  console.log("TIME_CONFIG_KEY写入完成");
}

// 日志
async function readLog() {
  const redis = getRedis();
  if (!redis) return DEFAULT_LOG;
  let raw = await redis.get(LOG_KEY);
  if (!raw) return DEFAULT_LOG;
  try { return JSON.parse(raw); } catch { return DEFAULT_LOG; }
}
async function addLog(logItem) {
  const redis = getRedis();
  if (!redis) return;
  let logList = await readLog();
  logList.unshift(logItem);
  if (logList.length > 500) logList = logList.slice(0, 500);
  await redis.set(LOG_KEY, JSON.stringify(logList));
}
async function clearAllLog() {
  const redis = getRedis();
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 工时配置接口
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
    console.error(e);
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 工作项列表
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
    console.log("前端提交的list：", list);
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
    console.error("保存工作项失败：", e);
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

// 单个员工工时
app.get('/api/getStaffWork/:staffId', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.workData[req.params.staffId] || {});
  } catch {
    res.json({});
  }
});

// 保存工时
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

// 批量删除月份数据
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

// 修改员工密码
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

// 获取日志
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

// 清空日志
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

module.exports = app;
