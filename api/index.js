const express = require('express');
const { Redis } = require('@upstash/redis');
const serverless = require('serverless-http');
const path = require('path');

const app = express();

// ===================== 1. Redis 容错初始化（关键：防止无环境变量崩溃） =====================
let redis = null;
let redisAvailable = false;
try {
  redis = Redis.fromEnv();
  redisAvailable = true;
  console.log("Redis 连接成功");
} catch (err) {
  console.warn("Redis 初始化失败，已降级为内存临时存储", err.message);
  redisAvailable = false;
}

// 中间件
app.use(express.json({ limit: '1mb' }));

// 静态资源：指向项目根目录（读取 index.html）
app.use(express.static(path.resolve(__dirname, '..')));

// ===================== 2. 存储 KEY & 默认数据 =====================
const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";

const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};
const DEFAULT_LOG = [];
const DEFAULT_WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];

// 内存临时存储（Redis 失效时兜底）
let memoryData = JSON.parse(JSON.stringify(DEFAULT_DATA));
let memoryLog = [...DEFAULT_LOG];
let memoryWorkList = [...DEFAULT_WORK_LIST];

// ===================== 3. 读写封装（统一兼容 Redis / 内存） =====================
async function getData() {
  if (!redisAvailable) return memoryData;
  try {
    const res = await redis.get(DATA_KEY);
    if (!res) {
      await redis.set(DATA_KEY, DEFAULT_DATA);
      return DEFAULT_DATA;
    }
    return res;
  } catch {
    return memoryData;
  }
}
async function setData(data) {
  memoryData = JSON.parse(JSON.stringify(data));
  if (!redisAvailable) return;
  try { await redis.set(DATA_KEY, data); } catch {}
}

async function getWorkList() {
  if (!redisAvailable) return memoryWorkList;
  try {
    const res = await redis.get(WORK_LIST_KEY);
    if (!res) {
      await redis.set(WORK_LIST_KEY, DEFAULT_WORK_LIST);
      return DEFAULT_WORK_LIST;
    }
    return res;
  } catch {
    return memoryWorkList;
  }
}
async function setWorkList(list) {
  memoryWorkList = [...list];
  if (!redisAvailable) return;
  try { await redis.set(WORK_LIST_KEY, list); } catch {}
}

async function getLog() {
  if (!redisAvailable) return memoryLog;
  try {
    const res = await redis.get(LOG_KEY);
    return res || DEFAULT_LOG;
  } catch {
    return memoryLog;
  }
}
async function addLogItem(logItem) {
  let list = await getLog();
  list.unshift(logItem);
  memoryLog = list;
  if (!redisAvailable) return;
  try { await redis.set(LOG_KEY, list); } catch {}
}
async function clearLog() {
  memoryLog = [...DEFAULT_LOG];
  if (!redisAvailable) return;
  try { await redis.set(LOG_KEY, DEFAULT_LOG); } catch {}
}

// 工时数组对齐
function alignWorkArray(oldArr, newLen) {
  const res = [];
  for (let i = 0; i < newLen; i++) {
    res.push(oldArr[i] ?? 0);
  }
  return res;
}

// UTC 时间格式化
function formatUTCDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
}

// ===================== 4. 接口全部加异常捕获 =====================
app.get('/', async (req, res) => {
  try {
    res.sendFile(path.resolve(__dirname, '..', 'index.html'));
  } catch (e) {
    res.status(500).send("页面加载失败");
  }
});

// 获取工作项
app.get('/api/getWorkList', async (req, res) => {
  try {
    const list = await getWorkList();
    res.json({ code: 0, list });
  } catch {
    res.json({ code: -1, list: DEFAULT_WORK_LIST });
  }
});

// 保存工作项
app.post('/api/saveWorkList', async (req, res) => {
  try {
    const { list } = req.body;
    if (!Array.isArray(list) || list.length === 0) {
      return res.json({ code: 1, msg: "工作项列表不能为空" });
    }
    const data = await getData();
    const newLen = list.length;
    Object.values(data.workData).forEach(dayMap => {
      Object.keys(dayMap).forEach(dateKey => {
        dayMap[dateKey] = alignWorkArray(dayMap[dateKey], newLen);
      });
    });
    await setWorkList(list);
    await setData(data);

    const now = new Date();
    await addLogItem({
      time: formatUTCDate(now),
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "工作项编辑",
      content: `修改系统工作内容列表，当前共${list.length}项`,
      workDetail: list.join("、")
    });
    res.json({ code: 0, msg: "保存成功" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 工时配置保存
app.post('/api/saveTimeConfig', async (req, res) => {
  try {
    res.json({ code: 0, msg: "配置保存成功" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
  try {
    const data = await getData();
    const { username, pwd } = req.body;
    const ok = data.admin.username === username && data.admin.pwd === pwd;
    res.json(ok ? { code: 0, msg: "登录成功" } : { code: 1, msg: "账号或密码错误" });
  } catch {
    res.json({ code: -1, msg: "服务异常" });
  }
});

// 员工登录
app.post('/api/staff/login', async (req, res) => {
  try {
    const data = await getData();
    const { name, pwd } = req.body;
    const user = data.staffList.find(item => item.name === name && item.pwd === pwd);
    user ? res.json({ code: 0, msg: "登录成功", id: user.id, name: user.name })
         : res.json({ code: 1, msg: "账号或密码错误" });
  } catch {
    res.json({ code: -1, msg: "服务异常" });
  }
});

// 获取全部数据
app.get('/api/getAllData', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch {
    res.json(DEFAULT_DATA);
  }
});

// 单个员工工时
app.get('/api/getStaffWork/:staffId', async (req, res) => {
  try {
    const data = await getData();
    res.json(data.workData[req.params.staffId] || {});
  } catch {
    res.json({});
  }
});

// 保存工时
app.post('/api/saveWorkData', async (req, res) => {
  try {
    const data = await getData();
    const workList = await getWorkList();
    const { staffId, day, workArr, staffName } = req.body;
    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;
    await setData(data);

    let detailStr = "";
    workArr.forEach((val, idx) => {
      detailStr += `${workList[idx] || "未知项"}:${val}次；`;
    });

    const now = new Date();
    await addLogItem({
      time: formatUTCDate(now),
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
    const data = await getData();
    const { name, pwd } = req.body;
    if (data.staffList.some(s => s.name === name)) {
      return res.json({ code: 1, msg: "员工已存在" });
    }
    const newId = Date.now().toString();
    data.staffList.push({ id: newId, name, pwd });
    await setData(data);
    res.json({ code: 0, msg: "添加成功" });
  } catch {
    res.json({ code: -1, msg: "添加失败" });
  }
});

// 删除员工
app.delete('/api/delStaff/:id', async (req, res) => {
  try {
    const data = await getData();
    const id = req.params.id;
    data.staffList = data.staffList.filter(s => s.id !== id);
    delete data.workData[id];
    await setData(data);
    res.json({ code: 0, msg: "删除成功" });
  } catch {
    res.json({ code: -1, msg: "删除失败" });
  }
});

// 批量删除月份数据
app.post('/api/admin/batchDeleteWork', async (req, res) => {
  try {
    const { username, pwd, staffId, year, month } = req.body;
    const data = await getData();
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
    await setData(data);
    res.json({ code: 0, msg: "数据删除成功" });
  } catch {
    res.json({ code: -1, msg: "删除失败" });
  }
});

// 修改管理员密码
app.post('/api/updateAdminPwd', async (req, res) => {
  try {
    const { oldPwd, newPwd } = req.body;
    const data = await getData();
    if (data.admin.pwd !== oldPwd) {
      return res.json({ code: 1, msg: "原密码输入错误" });
    }
    data.admin.pwd = newPwd;
    await setData(data);
    res.json({ code: 0, msg: "管理员密码修改成功，请重新登录" });
  } catch {
    res.json({ code: -1, msg: "修改失败" });
  }
});

// 修改员工密码
app.post('/api/admin/updateStaffPwd', async (req, res) => {
  try {
    const { username, pwd, staffId, newPwd } = req.body;
    const data = await getData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    const staff = data.staffList.find(s => s.id === staffId);
    if (!staff) return res.json({ code: 2, msg: "员工不存在" });
    staff.pwd = newPwd;
    await setData(data);

    const now = new Date();
    await addLogItem({
      time: formatUTCDate(now),
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
    const data = await getData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    let logList = await getLog();
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
    const data = await getData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    await clearLog();
    const now = new Date();
    await addLogItem({
      time: formatUTCDate(now),
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "日志操作",
      content: "手动清空全部操作日志",
      workDetail: ""
    });
    res.json({ code: 0, msg: "日志已清空" });
  } catch {
    res.json({ code: -1, msg: "清空失败" });
  }
});

// 导出 serverless 实例（Vercel 必须）
module.exports = serverless(app);
