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

const DATA_KEY = "work_system_data";
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {},
  logData: {}
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
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

// 保存工时 + 记录日志
app.post('/api/saveWorkData', async (req, res) => {
  try {
    const data = await readData();
    const { staffId, day, workArr } = req.body;
    const now = new Date();
    const timeStr = now.toLocaleString();

    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;

    if (!data.logData[staffId]) data.logData[staffId] = [];
    data.logData[staffId].push({
      date: day,
      time: timeStr,
      data: workArr
    });

    await writeData(data);
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
    delete data.logData[id];
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
    res.json({ code: 0, msg: "管理员密码修改成功，请重新登录" });
  } catch (err) {
    res.json({ code: -1, msg: "修改失败" });
  }
});

// 管理员修改员工密码
app.post('/api/editStaffPwd', async (req, res) => {
  try {
    const { staffId, newPwd } = req.body;
    const data = await readData();
    const staff = data.staffList.find(s => s.id === staffId);
    if (!staff) return res.json({ code: 1, msg: "员工不存在" });
    staff.pwd = newPwd;
    await writeData(data);
    res.json({ code: 0, msg: "员工密码修改成功" });
  } catch {
    res.json({ code: -1, msg: "修改失败" });
  }
});

// 获取员工日志
app.get('/api/getStaffLog/:staffId', async (req, res) => {
  try {
    const data = await readData();
    const log = data.logData[req.params.staffId] || [];
    res.json(log);
  } catch {
    res.json([]);
  }
});

// 新增：清空指定员工所有日志
app.delete('/api/clearStaffLog/:staffId', async (req, res) => {
  try {
    const data = await readData();
    const sid = req.params.staffId;
    delete data.logData[sid];
    await writeData(data);
    res.json({ code: 0, msg: "日志清空成功" });
  } catch {
    res.json({ code: -1, msg: "操作失败" });
  }
});

module.exports = app;
