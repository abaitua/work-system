const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const serverless = require('serverless-http');

const app = express();
app.disable('x-powered-by');

// 基础中间件
app.use(express.json({ limit: '50kb' }));
// 静态资源：仅根目录html，避免路由冲突
app.use('/', express.static(path.resolve(__dirname, '../'), {
  index: false
}));

// 常量定义
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

// 全局内存缓存（Vercel 单实例缓存，兜底Redis）
let cache = {
  data: JSON.parse(JSON.stringify(DEFAULT_DATA)),
  log: [...DEFAULT_LOG],
  workList: [...DEFAULT_WORK_LIST],
  timeConfig: JSON.parse(JSON.stringify(DEFAULT_TIME_CONFIG))
};

// Redis 延迟初始化（解决冷启动崩溃）
let redis = null;
const getRedis = () => {
  if (!redis) {
    try {
      redis = Redis.fromEnv();
    } catch (e) {
      console.log('Redis 不可用，使用内存模式');
    }
  }
  return redis;
};

// 通用读写封装
async function getCache(key, defaultVal) {
  const r = getRedis();
  if (!r) return defaultVal;
  try {
    const res = await r.get(key);
    return res ?? defaultVal;
  } catch (e) {
    return defaultVal;
  }
}
async function setCache(key, val) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, val);
  } catch (e) {}
}

// 工具函数
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
  for(let i = 0; i < newLen; i++){
    res.push(oldArr[i] ?? 0);
  }
  return res;
}

// 路由：首页
app.get('/', async (req, res) => {
  res.sendFile(path.resolve(__dirname, '../index.html'), (err) => {
    if (err) res.status(404).send('页面不存在');
  });
});

// 工时配置接口
app.get('/api/getTimeConfig', async (req, res) => {
  const data = await getCache(TIME_CONFIG_KEY, DEFAULT_TIME_CONFIG);
  cache.timeConfig = data;
  res.json({ code: 0, data });
});
app.post('/api/saveTimeConfig', async (req, res) => {
  const cfg = req.body;
  cache.timeConfig = cfg;
  await setCache(TIME_CONFIG_KEY, cfg);
  res.json({ code: 0, msg: "配置已全局生效" });
});

// 工作项列表
app.get('/api/getWorkList', async (req, res) => {
  const list = await getCache(WORK_LIST_KEY, DEFAULT_WORK_LIST);
  cache.workList = list;
  res.json({ code: 0, list });
});
app.post('/api/saveWorkList', async (req, res) => {
  const { list } = req.body;
  if(!Array.isArray(list) || list.length === 0){
    return res.json({ code: 1, msg: "工作项列表不能为空" });
  }
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  const newLen = list.length;
  Object.values(data.workData).forEach(dayMap => {
    Object.keys(dayMap).forEach(dateKey => {
      dayMap[dateKey] = alignWorkArray(dayMap[dateKey], newLen);
    });
  });
  cache.data = data;
  cache.workList = list;
  await setCache(DATA_KEY, data);
  await setCache(WORK_LIST_KEY, list);

  const now = new Date();
  const logItem = {
    time: formatUTCDate(now),
    logDate: "",
    operator: "管理员",
    operatorId: "admin",
    type: "工作项编辑",
    content: `修改系统工作内容列表，当前共${list.length}项`,
    workDetail: list.join("、")
  };
  cache.log.unshift(logItem);
  await setCache(LOG_KEY, cache.log);
  res.json({ code: 0, msg: "保存成功" });
});

// 登录接口
app.post('/api/admin/login', async (req, res) => {
  const data = await getCache(DATA_KEY, DEFAULT_DATA);
  const { username, pwd } = req.body;
  res.json(data.admin.username === username && data.admin.pwd === pwd
    ? { code: 0, msg: "登录成功" }
    : { code: 1, msg: "账号或密码错误" });
});
app.post('/api/staff/login', async (req, res) => {
  const data = await getCache(DATA_KEY, DEFAULT_DATA);
  const { name, pwd } = req.body;
  const user = data.staffList.find(item => item.name === name && item.pwd === pwd);
  res.json(user
    ? { code: 0, msg: "登录成功", id: user.id, name: user.name }
    : { code: 1, msg: "账号或密码错误" });
});

// 数据查询
app.get('/api/getAllData', async (req, res) => {
  const data = await getCache(DATA_KEY, DEFAULT_DATA);
  res.json(data);
});
app.get('/api/getStaffWork/:staffId', async (req, res) => {
  const data = await getCache(DATA_KEY, DEFAULT_DATA);
  res.json(data.workData[req.params.staffId] || {});
});

// 保存工时
app.post('/api/saveWorkData', async (req, res) => {
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  const workList = await getCache(WORK_LIST_KEY, DEFAULT_WORK_LIST);
  const { staffId, day, workArr, staffName } = req.body;
  if (!data.workData[staffId]) data.workData[staffId] = {};
  data.workData[staffId][day] = workArr;
  cache.data = data;
  await setCache(DATA_KEY, data);

  let detailStr = "";
  workArr.forEach((val, idx) => {
    detailStr += `${workList[idx] || "未知项"}:${val}工时；`;
  });
  const now = new Date();
  const logItem = {
    time: formatUTCDate(now),
    logDate: day,
    operator: staffName || '未知员工',
    operatorId: staffId,
    type: "工时填报",
    content: `填写日期【${day}】`,
    workDetail: detailStr
  };
  cache.log.unshift(logItem);
  await setCache(LOG_KEY, cache.log);
  res.json({ code: 0, msg: "保存成功" });
});

// 员工管理
app.post('/api/addStaff', async (req, res) => {
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  const { name, pwd } = req.body;
  if (data.staffList.some(s => s.name === name)) {
    return res.json({ code: 1, msg: "员工已存在" });
  }
  const newId = Date.now().toString();
  data.staffList.push({ id: newId, name, pwd });
  cache.data = data;
  await setCache(DATA_KEY, data);
  res.json({ code: 0, msg: "添加成功" });
});
app.delete('/api/delStaff/:id', async (req, res) => {
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  const id = req.params.id;
  data.staffList = data.staffList.filter(s => s.id !== id);
  delete data.workData[id];
  cache.data = data;
  await setCache(DATA_KEY, data);
  res.json({ code: 0, msg: "删除成功" });
});

// 批量删除数据
app.post('/api/admin/batchDeleteWork', async (req, res) => {
  const { username, pwd, staffId, year, month } = req.body;
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  if (data.admin.username !== username || data.admin.pwd !== pwd) {
    return res.json({ code: 1, msg: "权限校验失败" });
  }
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  if (staffId && data.workData[staffId]) {
    Object.keys(data.workData[staffId]).forEach(key => {
      if (key.startsWith(prefix)) delete data.workData[staffId][key];
    });
  } else {
    Object.values(data.workData).forEach(person => {
      Object.keys(person).forEach(key => {
        if (key.startsWith(prefix)) delete person[key];
      });
    });
  }
  cache.data = data;
  await setCache(DATA_KEY, data);
  res.json({ code: 0, msg: "数据删除成功" });
});

// 密码修改
app.post('/api/updateAdminPwd', async (req, res) => {
  const { oldPwd, newPwd } = req.body;
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  if (data.admin.pwd !== oldPwd) {
    return res.json({ code: 1, msg: "原密码输入错误" });
  }
  data.admin.pwd = newPwd;
  cache.data = data;
  await setCache(DATA_KEY, data);
  res.json({ code: 0, msg: "管理员密码修改成功，请使用新密码重新登录" });
});
app.post('/api/admin/updateStaffPwd', async (req, res) => {
  const { username, pwd, staffId, newPwd } = req.body;
  let data = await getCache(DATA_KEY, DEFAULT_DATA);
  if (data.admin.username !== username || data.admin.pwd !== pwd) {
    return res.json({ code: 1, msg: "权限校验失败" });
  }
  const staff = data.staffList.find(s => s.id === staffId);
  if (!staff) return res.json({ code: 2, msg: "员工不存在" });
  staff.pwd = newPwd;
  cache.data = data;
  await setCache(DATA_KEY, data);

  const now = new Date();
  const logItem = {
    time: formatUTCDate(now),
    logDate: "",
    operator: "管理员",
    operatorId: "admin",
    type: "密码修改",
    content: `修改员工【${staff.name}】登录密码`,
    workDetail: ""
  };
  cache.log.unshift(logItem);
  await setCache(LOG_KEY, cache.log);
  res.json({ code: 0, msg: "员工密码修改成功" });
});

// 日志接口
app.post('/api/admin/getLog', async (req, res) => {
  const { username, pwd, filterStaffId, filterDate } = req.body;
  const data = await getCache(DATA_KEY, DEFAULT_DATA);
  if (data.admin.username !== username || data.admin.pwd !== pwd) {
    return res.json({ code: 1, msg: "权限校验失败" });
  }
  let logList = await getCache(LOG_KEY, DEFAULT_LOG);
  if (filterStaffId && filterStaffId !== "") {
    logList = logList.filter(item => item.operatorId === filterStaffId);
  }
  if (filterDate && filterDate !== "") {
    logList = logList.filter(item => item.logDate === filterDate);
  }
  res.json({ code: 0, data: logList });
});
app.post('/api/admin/clearLog', async (req, res) => {
  const { username, pwd } = req.body;
  const data = await getCache(DATA_KEY, DEFAULT_DATA);
  if (data.admin.username !== username || data.admin.pwd !== pwd) {
    return res.json({ code: 1, msg: "权限校验失败" });
  }
  cache.log = [...DEFAULT_LOG];
  await setCache(LOG_KEY, DEFAULT_LOG);
  const now = new Date();
  const logItem = {
    time: formatUTCDate(now),
    logDate: "",
    operator: "管理员",
    operatorId: "admin",
    type: "日志操作",
    content: "手动清空全部操作日志",
    workDetail: ""
  };
  cache.log.unshift(logItem);
  await setCache(LOG_KEY, cache.log);
  res.json({ code: 0, msg: "日志已全部清空" });
});

// 导出为 Vercel Serverless 函数
module.exports = serverless(app);
