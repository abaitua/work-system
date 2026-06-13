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
const LOG_KEY = "work_system_log";
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {},
  workItems: ["首件","巡检","入库","出货","外箱标","内箱标","特标","工单打印","核对物料"]
};
const DEFAULT_LOG = [];

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

// 格式化 中国时区(UTC+8) 时间 YYYY-MM-DD HH:mm:ss
function formatCSTDate() {
  const now = new Date();
  const offset = 8 * 60 * 60 * 1000;
  const cstTime = new Date(now.getTime() + offset);
  const year = cstTime.getUTCFullYear();
  const month = String(cstTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cstTime.getUTCDate()).padStart(2, '0');
  const h = String(cstTime.getUTCHours()).padStart(2, '0');
  const m = String(cstTime.getUTCMinutes()).padStart(2, '0');
  const s = String(cstTime.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
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

// 获取全部数据（包含工作项列表）
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
    res.json({ code: -1, msg: "获取失败" });
  }
});

// 保存工时
app.post('/api/saveWorkData', async (req, res) => {
  try {
    const data = await readData();
    const { staffId, day, workArr, staffName } = req.body;
    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;
    await writeData(data);

    let detailStr = "";
    const items = data.workItems;
    workArr.forEach((val, idx) => {
      detailStr += `${items[idx]}:${val}工时；`;
    });

    const timeStr = formatCSTDate();
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

    const timeStr = formatCSTDate();
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

// 新增：添加工作内容
app.post('/api/admin/addWorkItem', async (req, res) => {
  try {
    const { username, pwd, itemName } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    if (!itemName || itemName.trim() === "") {
      return res.json({ code: 2, msg: "工作内容不能为空" });
    }
    const name = itemName.trim();
    if (data.workItems.includes(name)) {
      return res.json({ code: 3, msg: "该工作内容已存在" });
    }
    data.workItems.push(name);
    await writeData(data);

    const timeStr = formatCSTDate();
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "工作内容管理",
      content: `新增工作内容：${name}`,
      workDetail: ""
    });
    res.json({ code: 0, msg: "添加成功" });
  } catch {
    res.json({ code: -1, msg: "添加失败" });
  }
});

// 新增：删除工作内容
app.post('/api/admin/delWorkItem', async (req, res) => {
  try {
    const { username, pwd, index } = req.body;
    const data = await readData();
    if (data.admin.username !== username || data.admin.pwd !== pwd) {
      return res.json({ code: 1, msg: "权限校验失败" });
    }
    if (index < 0 || index >= data.workItems.length) {
      return res.json({ code: 2, msg: "索引无效" });
    }
    const delName = data.workItems[index];
    data.workItems.splice(index, 1);
    await writeData(data);

    const timeStr = formatCSTDate();
    await addLog({
      time: timeStr,
      logDate: "",
      operator: "管理员",
      operatorId: "admin",
      type: "工作内容管理",
      content: `删除工作内容：${delName}`,
      workDetail: ""
    });
    res.json({ code: 0, msg: "删除成功" });
  } catch {
    res.json({ code: -1, msg: "删除失败" });
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

    const timeStr = formatCSTDate();
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
