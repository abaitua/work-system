const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// 修复：根路径默认打开 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const DATA_PATH = path.join(__dirname, 'data.json');
const DAY_COUNT = 30;
const WORK_LIST = ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"];

// 初始化数据
function initDefaultData() {
  const initData = {
    admin: { username: "admin", pwd: "123456" },
    staffList: [],
    workData: {}
  };
  fs.writeFileSync(DATA_PATH, JSON.stringify(initData, null, 2), 'utf8');
  return initData;
}

// 读取数据
function readData() {
  if (!fs.existsSync(DATA_PATH)) return initDefaultData();
  const txt = fs.readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(txt);
}

// 写入数据
function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// 管理员登录接口
app.post('/api/admin/login', (req, res) => {
  const { username, pwd } = req.body;
  const data = readData();
  if (data.admin.username === username && data.admin.pwd === pwd) {
    res.json({ code: 0, msg: "登录成功" });
  } else {
    res.json({ code: 1, msg: "账号或密码错误" });
  }
});

// 员工登录接口
app.post('/api/staff/login', (req, res) => {
  const { name, pwd } = req.body;
  const data = readData();
  const staff = data.staffList.find(item => item.name === name && item.pwd === pwd);
  if (staff) {
    res.json({ code: 0, msg: "登录成功", id: staff.id, name: staff.name });
  } else {
    res.json({ code: 1, msg: "姓名或密码错误" });
  }
});

// 获取全部数据
app.get('/api/getAllData', (req, res) => {
  res.json(readData());
});

// 保存员工工时
app.post('/api/saveWorkData', (req, res) => {
  const { staffId, day, workArr } = req.body;
  const data = readData();
  if (!data.workData[staffId]) data.workData[staffId] = {};
  data.workData[staffId][day] = workArr;
  writeData(data);
  res.json({ code: 0, msg: "保存成功" });
});

// 读取单人员工工时
app.get('/api/getStaffWork/:staffId', (req, res) => {
  const staffId = req.params.staffId;
  const data = readData();
  res.json(data.workData[staffId] || {});
});

// 新增员工
app.post('/api/addStaff', (req, res) => {
  const { name, pwd } = req.body;
  const data = readData();
  if (data.staffList.some(s => s.name === name)) {
    return res.json({ code: 1, msg: "员工已存在" });
  }
  const newId = Date.now().toString();
  data.staffList.push({ id: newId, name, pwd });
  writeData(data);
  res.json({ code: 0, msg: "添加成功" });
});

// 删除员工
app.delete('/api/delStaff/:id', (req, res) => {
  const id = req.params.id;
  const data = readData();
  data.staffList = data.staffList.filter(s => s.id !== id);
  delete data.workData[id];
  writeData(data);
  res.json({ code: 0, msg: "删除成功" });
});

app.listen(PORT, () => {
  console.log(`服务启动成功，端口：${PORT}`);
});
