const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const app = express();

let redis = null;
try {
  redis = Redis.fromEnv();
} catch (err) {
  console.error('Redis 初始化失败:', err);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Redis Key
const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";
// 新增：工作项分钟配置Key
const WORK_MIN_CFG_KEY = "work_system_min_config";

// 默认基础数据
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};
const DEFAULT_LOG = [];
const DEFAULT_WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];
// 默认单次分钟配置（和工作项一一对应）
const DEFAULT_MIN_CONFIG = {
  "首件": 20,
  "巡检": 20,
  "入库": 10,
  "出货": 20,
  "外箱标": 10,
  "内箱标": 10,
  "特标": 10,
  "工单打印": 10,
  "核对物料": 10
};

// ========== 通用工具函数 ==========
// 次数 + 配置 → 计算总小时（保留2位小数）
function calcTotalHour(workList, countArr, minCfg) {
  let totalMin = 0;
  workList.forEach((name, idx) => {
    const count = Number(countArr[idx]) || 0;
    const perMin = Number(minCfg[name]) || 10;
    totalMin += count * perMin;
  });
  return (totalMin / 60).toFixed(2);
}

// 工时数组对齐（增删工作项后统一长度）
function alignWorkArray(oldArr, newLen) {
  const res = [];
  for(let i = 0; i < newLen; i++){
    res.push(oldArr[i] ?? 0);
  }
  return res;
}

// 时间格式化 UTC
function formatUTCDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
}

// ========== Redis 读写封装 ==========
async function initDefaultData() {
  if (!redis) return DEFAULT_DATA;
  await redis.set(DATA_KEY, DEFAULT_DATA);
  return DEFAULT_DATA;
}
async function initDefaultWorkList() {
  if (!redis) return DEFAULT_WORK_LIST;
  await redis.set(WORK_LIST_KEY, DEFAULT_WORK_LIST);
  return DEFAULT_WORK_LIST;
}
async function initDefaultMinConfig() {
  if (!redis) return DEFAULT_MIN_CONFIG;
  await redis.set(WORK_MIN_CFG_KEY, DEFAULT_MIN_CONFIG);
  return DEFAULT_MIN_CONFIG;
}

async function readData() {
  if (!redis) return DEFAULT_DATA;
  let data = await redis.get(DATA_KEY);
  return data || await initDefaultData();
}
async function writeData(data) {
  if (!redis) return;
  await redis.set(DATA_KEY, data);
}

async function readWorkList() {
  if (!redis) return DEFAULT_WORK_LIST;
  let list = await redis.get(WORK_LIST_KEY);
  return list || await initDefaultWorkList();
}
async function writeWorkList(list) {
  if (!redis) return;
  await redis.set(WORK_LIST_KEY, list);
}

async function readMinConfig() {
  if (!redis) return DEFAULT_MIN_CONFIG;
  let cfg = await redis.get(WORK_MIN_CFG_KEY);
  return cfg || await initDefaultMinConfig();
}
async function writeMinConfig(cfg) {
  if (!redis) return;
  await redis.set(WORK_MIN_CFG_KEY, cfg);
}

async function readLog() {
  if (!redis) return DEFAULT_LOG;
  let log = await redis.get(LOG_KEY);
  return log || DEFAULT_LOG;
}
async function addLog(logItem) {
  if (!redis) return;
  let logList = await readLog();
  logList.unshift(logItem);
  await redis.set(LOG_KEY, logList);
}
async function clearAllLog() {
  if (!redis) return;
  await redis.set(LOG_KEY, DEFAULT_LOG);
}

// ========== 路由接口 ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 获取工作项 + 分钟配置
app.get('/api/getWorkList', async (req, res) => {
  try {
    const list = await readWorkList();
    const minCfg = await readMinConfig();
    res.json({ code: 0, list, minCfg });
  } catch {
    res.json({ code: -1, list: DEFAULT_WORK_LIST, minCfg: DEFAULT_MIN_CONFIG });
  }
});

// 保存工作项列表（同步更新分钟配置、对齐历史数据）
app.post('/api/saveWorkList', async (req, res) => {
  try {
    const { list } = req.body;
    if(!Array.isArray(list) || list.length === 0){
      return res.json({ code: 1, msg: "工作项列表不能为空" });
    }

    const oldList = await readWorkList();
    const oldMinCfg = await readMinConfig();
    const newMinCfg = {};

    // 保留原有配置，新增项默认10分钟
    list.forEach(name => {
      newMinCfg[name] = oldMinCfg[name] ?? 10;
    });

    // 对齐所有员工历史工时数组长度
    const data = await readData();
    const newLen = list.length;
    Object.values(data.workData).forEach(dayMap => {
      Object.keys(dayMap).forEach(dateKey => {
        dayMap[dateKey] = alignWorkArray(dayMap[dateKey], newLen);
      });
    });

    // 批量保存
    await writeWorkList(list);
    await writeMinConfig(newMinCfg);
    await writeData(data);

    // 日志
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

// 单独保存分钟配置
app.post('/api/saveMinConfig', async (req, res) => {
  try {
    const { minCfg } = req.body;
    if(typeof minCfg !== 'object'){
      return res.json({ code: 1, msg: "配置格式错误" });
    }
    await writeMinConfig(minCfg);

    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "工时配置修改",
      content: "修改各工作项单次耗时(分钟)",
      workDetail: ""
    });

    res.json({ code: 0, msg: "分钟配置保存成功" });
  } catch {
    res.json({ code: -1, msg: "配置保存失败" });
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

// 保存工时次数
app.post('/api/saveWorkData', async (req, res) => {
  try {
    const data = await readData();
    const workList = await readWorkList();
    const minCfg = await readMinConfig();
    const { staffId, day, workArr, staffName } = req.body;

    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;
    await writeData(data);

    // 计算当日总工时
    const totalHour = calcTotalHour(workList, workArr, minCfg);
    let detailStr = `当日总工时：${totalHour} 小时 | `;
    workArr.forEach((val, idx) => {
      detailStr += `${workList[idx]}:${val}次；`;
    });

    const now = new Date();
    const timeStr = formatUTCDate(now);
    await addLog({
      time: timeStr,
      logDate: day,
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

module.exports = app;
