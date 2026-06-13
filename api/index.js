const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 内存存储（Vercel 只读环境专用）
const DAY_COUNT = 30;
const WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];
let data = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { username, pwd } = req.body;
  if (data.admin.username === username && data.admin.pwd === pwd) {
    res.json({ code: 0, msg: "登录成功" });
  } else {
    res.json({ code: 1, msg: "账号或密码错误" });
  }
});

// 员工登录
app.post('/api/staff/login', (req, res) => {
  const { name, pwd } = req.body;
  const staff = data.staffList.find(item => item.name === name && item.pwd === pwd);
  if (staff) {
    res.json({ code: 0, msg: "登录成功", id: staff.id, name: staff.name });
  } else {
    res.json({ code: 1, msg: "姓名或密码错误" });
  }
});

app.get('/api/getAllData', (req, res) => {
  res.json(data);
});

// 保存工时
app.post('/api/saveWorkData', (req, res) => {
  const { staffId, day, workArr } = req.body;
  if (!data.workData[staffId]) data.workData[staffId] = {};
  data.workData[staffId][day] = workArr;
  res.json({ code: 0, msg: "保存成功" });
});

app.get('/api/getStaffWork/:staffId', (req, res) => {
  const staffId = req.params.staffId;
  res.json(data.workData[staffId] || {});
});

// 新增员工
app.post('/api/addStaff', (req, res) => {
  const { name, pwd } = req.body;
  if (data.staffList.some(s => s.name === name)) {
    return res.json({ code: 1, msg: "员工已存在" });
  }
  const newId = Date.now().toString();
  data.staffList.push({ id: newId, name, pwd });
  res.json({ code: 0, msg: "添加成功" });
});

// 删除员工
app.delete('/api/delStaff/:id', (req, res) => {
  const id = req.params.id;
  data.staffList = data.staffList.filter(s => s.id !== id);
  delete data.workData[id];
  res.json({ code: 0, msg: "删除成功" });
});

module.exports = app;

module.exports = app;
