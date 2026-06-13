const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const app = express();

// 初始化Redis，捕获初始化异常
let redis = null;
try {
  redis = Redis.fromEnv();
} catch (err) {
  console.error('Redis 初始化失败:', err);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const DATA_KEY = "work_system_data";
const WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];

// 默认兜底数据（Redis挂了也能临时访问）
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};

async function initDefaultData() {
  if (!redis) return DEFAULT_DATA;
  await redis.set(DATA_KEY, DEFAULT_DATA);
  return DEFAULT_DATA;
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

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
  try {
    const data = await readData();
    const { username, pwd } = req.body;
    if (data.admin.username === username && data.admin.pwd === pwd) {
      res.json({ code: 0, msg: "登录成功" });
    } else {
      res.json({ code: 1, msg: "账号或密码错误" });
    }
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
    if (user) {
      res.json({ code: 0, msg: "登录成功", id: user.id, name: user.name });
    } else {
      res.json({ code: 1, msg: "账号或密码错误" });
    }
  } catch {
    res.json({ code: -1, msg: "服务异常" });
  }
});

// 获取全量数据
app.get('/api/getAllData', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch {
    res.json(DEFAULT_DATA);
  }
});

// 保存工时
app.post('/api/saveWorkData', async (req, res) => {
  try {
    const data = await readData();
    const { staffId, day, workArr } = req.body;
    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;
    await writeData(data);
    res.json({ code: 0, msg: "保存成功" });
  } catch {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 读取单人工时
app.get('/api/getStaffWork/:staffId', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.workData[req.params.staffId] || {});
  } catch {
    res.json({});
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

module.exports = app;
