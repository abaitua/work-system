const express = require("express");
const path = require("path");
const { Redis } = require("@upstash/redis");

const app = express();

// 基础中间件
app.use(express.json());
// 指向根目录静态文件（index.html）
app.use(express.static(path.join(__dirname, "..")));

// Redis 初始化 + 异常捕获
let redis;
const DATA_KEY = "work_system_data";
const LOG_KEY = "work_system_log";
const WORK_LIST_KEY = "work_system_worklist";
const TIME_CONFIG_KEY = "work_system_time_config";

// 默认基础数据
const DEFAULT_DATA = {
  admin: { username: "admin", pwd: "123456" },
  staffList: [],
  workData: {}
};
const DEFAULT_LOG = [];
const DEFAULT_WORK_LIST = ["首件", "巡检", "出货", "外观", "包装"];
const DEFAULT_TIME_CONFIG = {
  "首件": 20,
  "巡检": 10,
  "出货": 15,
  "外观": 8,
  "包装": 5
};

// 连接Redis
try {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
  console.log("Redis 连接成功");
} catch (e) {
  console.error("Redis 连接失败", e);
}

// 初始化云端默认数据（空则写入）
async function initDefaultData() {
  if (!redis) return;
  try {
    let data = await redis.get(DATA_KEY);
    if (!data) await redis.set(DATA_KEY, JSON.stringify(DEFAULT_DATA));

    let log = await redis.get(LOG_KEY);
    if (!log) await redis.set(LOG_KEY, JSON.stringify(DEFAULT_LOG));

    let workList = await redis.get(WORK_LIST_KEY);
    if (!workList) await redis.set(WORK_LIST_KEY, JSON.stringify(DEFAULT_WORK_LIST));

    let timeCfg = await redis.get(TIME_CONFIG_KEY);
    if (!timeCfg) await redis.set(TIME_CONFIG_KEY, JSON.stringify(DEFAULT_TIME_CONFIG));
  } catch (err) {
    console.error("初始化数据失败", err);
  }
}
initDefaultData();

// 全局错误捕获
app.use((err, req, res, next) => {
  console.error("全局错误：", err);
  res.status(500).json({ code: -1, msg: "服务器内部错误" });
});

// ===================== 接口列表 =====================

// 1. 获取全部数据（员工+管理员+工时）
app.get("/api/getAllData", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  try {
    let data = await redis.get(DATA_KEY);
    data = data ? JSON.parse(data) : DEFAULT_DATA;
    res.json({ code: 0, data });
  } catch (err) {
    res.json({ code: -1, msg: "读取数据失败" });
  }
});

// 2. 新增员工
app.post("/api/addStaff", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  const { name, pwd } = req.body;
  if (!name || !pwd) return res.json({ code: 1, msg: "账号密码不能为空" });

  try {
    let data = await redis.get(DATA_KEY);
    data = data ? JSON.parse(data) : DEFAULT_DATA;

    const exist = data.staffList.find(item => item.name === name);
    if (exist) return res.json({ code: 1, msg: "员工已存在" });

    const newStaff = {
      id: Date.now().toString(),
      name,
      pwd
    };
    data.staffList.push(newStaff);
    // 持久化到Redis
    await redis.set(DATA_KEY, JSON.stringify(data));
    res.json({ code: 0, msg: "添加成功" });
  } catch (err) {
    res.json({ code: -1, msg: "添加失败" });
  }
});

// 3. 删除员工
app.delete("/api/delStaff/:id", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  const { id } = req.params;
  try {
    let data = await redis.get(DATA_KEY);
    data = data ? JSON.parse(data) : DEFAULT_DATA;

    data.staffList = data.staffList.filter(item => item.id !== id);
    delete data.workData[id];

    await redis.set(DATA_KEY, JSON.stringify(data));
    res.json({ code: 0, msg: "删除成功" });
  } catch (err) {
    res.json({ code: -1, msg: "删除失败" });
  }
});

// 4. 管理员登录
app.post("/api/adminLogin", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  const { username, pwd } = req.body;
  try {
    let data = await redis.get(DATA_KEY);
    data = data ? JSON.parse(data) : DEFAULT_DATA;

    if (data.admin.username === username && data.admin.pwd === pwd) {
      res.json({ code: 0, msg: "登录成功" });
    } else {
      res.json({ code: 1, msg: "账号或密码错误" });
    }
  } catch (err) {
    res.json({ code: -1, msg: "登录失败" });
  }
});

// 5. 员工登录
app.post("/api/staffLogin", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  const { name, pwd } = req.body;
  try {
    let data = await redis.get(DATA_KEY);
    data = data ? JSON.parse(data) : DEFAULT_DATA;

    const user = data.staffList.find(item => item.name === name && item.pwd === pwd);
    if (user) {
      res.json({ code: 0, msg: "登录成功", id: user.id, name: user.name });
    } else {
      res.json({ code: 1, msg: "账号或密码错误" });
    }
  } catch (err) {
    res.json({ code: -1, msg: "登录失败" });
  }
});

// 6. 保存工时数据
app.post("/api/saveWorkData", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  const { staffId, date, workArr, staffName } = req.body;
  try {
    let data = await redis.get(DATA_KEY);
    data = data ? JSON.parse(data) : DEFAULT_DATA;

    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][date] = workArr;

    await redis.set(DATA_KEY, JSON.stringify(data));
    res.json({ code: 0, msg: "工时保存成功" });
  } catch (err) {
    res.json({ code: -1, msg: "保存失败" });
  }
});

// 7. 获取工时配置/工作项
app.get("/api/getWorkList", async (req, res) => {
  if (!redis) return res.json({ code: -1, msg: "Redis未连接" });
  try {
    let list = await redis.get(WORK_LIST_KEY);
    let cfg = await redis.get(TIME_CONFIG_KEY);
    list = list ? JSON.parse(list) : DEFAULT_WORK_LIST;
    cfg = cfg ? JSON.parse(cfg) : DEFAULT_TIME_CONFIG;
    res.json({ code: 0, workList: list, timeConfig: cfg });
  } catch (err) {
    res.json({ code: -1, msg: "读取失败" });
  }
});

// Vercel Serverless 必须导出，禁止使用 app.listen
module.exports = app;
