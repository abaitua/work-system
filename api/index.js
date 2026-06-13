const express = require('express');
const { Redis } = require('@upstash/redis');
const path = require('path');
const app = express();

// 初始化Redis
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
  workData: {}
};

// 初始化默认数据
async function initDefaultData() {
  if (!redis) return DEFAULT_DATA;
  await redis.set(DATA_KEY, DEFAULT_DATA);
  return DEFAULT_DATA;
}

// 读取数据
async function readData() {
  if (!redis) return DEFAULT_DATA;
  let data = await redis.get(DATA_KEY);
  return data || await initDefaultData();
}

// 写入数据
async function writeData(data) {
  if (!redis) return;
  await redis.set(DATA_KEY, data);
}

// 首页路由
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

// 获取全量数据
app.get('/api/getAllData', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch {
    res.json(DEFAULT_DATA);
  }
});

// 保存工时数据
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

// 读取单人员工工时
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

// 管理员批量删除工时数据（清理存储）
app.post('/api/admin/batchDeleteWork', async (req, res) => {
  try {
    const { username, pwd, staffId, year, month } = req.body;
    const data = await readData();
    // 校验管理员权限
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "管理员权限验证失败" });
    }

    // 按条件删除
    if (staffId) {
      // 删除指定员工数据
      if (data.workData[staffId]) {
        if (year && month) {
          const prefix = `${year}-${String(month).padStart(2, '0')}`;
          Object.keys(data.workData[staffId]).forEach(key => {
            if (key.startsWith(prefix)) delete data.workData[staffId][key];
          });
        } else {
          data.workData[staffId] = {};
        }
      }
    } else {
      // 删除全部员工数据
      if (year && month) {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        Object.values(data.workData).forEach(person => {
          Object.keys(person).forEach(key => {
            if (key.startsWith(prefix)) delete person[key];
          });
        });
      } else {
        data.workData = {};
      }
    }

    await writeData(data);
    res.json({ code: 0, msg: "数据删除成功" });
  } catch (err) {
    res.json({ code: -1, msg: "数据删除失败" });
  }
});

module.exports = app;
