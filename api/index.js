const express = require('express');
const { kv } = require('@vercel/kv');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// 全局常量
const DATA_KEY = "work_system_data";
const DAY_COUNT = 30;
const WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];

// 初始化默认数据
async function initDefaultData() {
  const initData = {
    admin: { username: "admin", pwd: "123456" },
    staffList: [],
    workData: {}
  };
  await kv.set(DATA_KEY, initData);
  return initData;
}

// 读取数据（从KV数据库）
async function readData() {
  let data = await kv.get(DATA_KEY);
  if (!data) {
    data = await initDefaultData();
  }
  return data;
}

// 写入数据（保存到KV数据库）
async function writeData(data) {
  await kv.set(DATA_KEY, data);
}

// 根路由 → 打开首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
  const { username, pwd } = req.body;
  const data = await readData();
  if (data.admin.username === username && data.admin.pwd === pwd) {
    res.json({ code: 0, msg: "登录成功" });
  } else {
    res.json({ code: 1, msg: "账号或密码错误" });
  }
});

// 员工登录
app.post('/api/staff/login', async (req, res) => {
  const { name, pwd } = req.body;
  const data = await readData();
  const staff = data.staffList.find(item => item.name === name && item.pwd === pwd);
  if (staff) {
    res.json({ code: 0, msg: "登录成功", id: staff.id, name: staff.name });
  } else {
    res.json({ code: 1, msg: "姓名或密码错误" });
  }
});

// 获取全部数据
app.get('/api/getAllData', async (req, res) => {
  const data = await readData();
  res.json(data);
});

// 保存员工每日工时
app.post('/api/saveWorkData', async (req, res) => {
  const { staffId, day, workArr } = req.body;
  const data = await readData();
  if (!data.workData[staffId]) data.workData[staffId] = {};
  data.workData[staffId][day] = workArr;
  await writeData(data);
  res.json({ code: 0, msg: "保存成功" });
});

// 读取单人员工工时
app.get('/api/getStaffWork/:staffId', async (req, res) => {
  const staffId = req.params.staffId;
  const data = await readData();
  res.json(data.workData[staffId] || {});
});

// 新增员工
app.post('/api/addStaff', async (req, res) => {
  const { name, pwd } = req.body;
  const data = await readData();
  if (data.staffList.some(s => s.name === name)) {
    return res.json({ code: 1, msg: "员工已存在" });
  }
  const newId = Date.now().toString();
  data.staffList.push({ id: newId, name, pwd });
  await writeData(data);
  res.json({ code: 0, msg: "添加成功" });
});

// 删除员工
app.delete('/api/delStaff/:id', async (req, res) => {
  const id = req.params.id;
  const data = await readData();
  data.staffList = data.staffList.filter(s => s.id !== id);
  delete data.workData[id];
  await writeData(data);
  res.json({ code: 0, msg: "删除成功" });
});

// Vercel 必须导出，禁止 app.listen
module.exports = app;
