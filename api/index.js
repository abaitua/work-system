const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// 静态资源托管 + 根路由（解决 Cannot GET / 线上报错）
app.use(express.static(path.resolve(__dirname, './')));
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, './index.html'), err => {
    if (err) res.status(404).send('页面不存在');
  });
});

const DATA_PATH = path.join(__dirname, 'data.json');

// 初始化数据文件
function initData() {
    if (!fs.existsSync(DATA_PATH)) {
        const init = {
            admin: { username: 'admin', pwd: '123456' },
            staffList: [],
            workData: {},
            logData: {},
            workList: ["首件", "巡检", "入库", "出货", "外箱标", "内箱标", "特标", "工单打印", "核对物料"]
        };
        fs.writeFileSync(DATA_PATH, JSON.stringify(init, null, 2));
    }
}

async function readData() {
    initData();
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

async function writeData(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
    const data = await readData();
    const { username, pwd } = req.body;
    if (username === data.admin.username && pwd === data.admin.pwd) {
        res.json({ code: 0, msg: '登录成功' });
    } else {
        res.json({ code: -1, msg: '账号或密码错误' });
    }
});

// 员工登录
app.post('/api/staff/login', async (req, res) => {
    const data = await readData();
    const { name, pwd } = req.body;
    const staff = data.staffList.find(x => x.name === name && x.pwd === pwd);
    if (staff) {
        res.json({ code: 0, id: staff.id, name: staff.name });
    } else {
        res.json({ code: -1, msg: '姓名或密码错误' });
    }
});

// 新增员工
app.post('/api/addStaff', async (req, res) => {
    const data = await readData();
    const { name, pwd } = req.body;
    if (data.staffList.find(x => x.name === name)) {
        return res.json({ code: -1, msg: '员工已存在' });
    }
    const id = Date.now().toString();
    data.staffList.push({ id, name, pwd });
    data.workData[id] = {};
    data.logData[id] = [];
    await writeData(data);
    res.json({ code: 0, msg: '新增成功' });
});

// 删除员工
app.delete('/api/delStaff/:id', async (req, res) => {
    const data = await readData();
    const id = req.params.id;
    data.staffList = data.staffList.filter(x => x.id !== id);
    delete data.workData[id];
    delete data.logData[id];
    await writeData(data);
    res.json({ code: 0, msg: '删除成功' });
});

// 修改员工密码
app.post('/api/updateStaffPwd/:id', async (req, res) => {
    const data = await readData();
    const id = req.params.id;
    const { pwd } = req.body;
    const staff = data.staffList.find(x => x.id === id);
    if (!staff) return res.json({ code: -1, msg: '员工不存在' });
    staff.pwd = pwd;
    await writeData(data);
    res.json({ code: 0, msg: '密码修改成功' });
});

// 保存工时数据
app.post('/api/saveWorkData', async (req, res) => {
    const data = await readData();
    const { staffId, day, workArr } = req.body;
    if (!data.workData[staffId]) data.workData[staffId] = {};
    data.workData[staffId][day] = workArr;
    await writeData(data);
    res.json({ code: 0 });
});

// 获取单人员工工时
app.get('/api/getStaffWork/:staffId', async (req, res) => {
    const data = await readData();
    res.json(data.workData[req.params.staffId] || {});
});

// 保存工作内容列表
app.post('/api/saveWorkList', async (req, res) => {
    const data = await readData();
    data.workList = req.body.workList;
    await writeData(data);
    res.json({ code: 0 });
});

// 新增操作日志
app.post('/api/addStaffLog', async (req, res) => {
    const data = await readData();
    const { staffId, date, time, data: arr } = req.body;
    if (!data.logData[staffId]) data.logData[staffId] = [];
    data.logData[staffId].push({ date, time, data: arr });
    await writeData(data);
    res.json({ code: 0 });
});

// 获取员工日志
app.get('/api/getStaffLog/:staffId', async (req, res) => {
    const data = await readData();
    res.json(data.logData[req.params.staffId] || []);
});

// 清空员工日志
app.delete('/api/clearStaffLog/:staffId', async (req, res) => {
    const data = await readData();
    delete data.logData[req.params.staffId];
    await writeData(data);
    res.json({ code: 0, msg: '日志已清空' });
});

// 批量删除指定年月工时
app.post('/api/admin/batchDeleteWork', async (req, res) => {
    const data = await readData();
    const { staffId, year, month } = req.body;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    if (staffId) {
        if (data.workData[staffId]) {
            Object.keys(data.workData[staffId]).forEach(k => {
                if (k.startsWith(prefix)) delete data.workData[staffId][k];
            });
        }
    } else {
        Object.keys(data.workData).forEach(sid => {
            Object.keys(data.workData[sid]).forEach(k => {
                if (k.startsWith(prefix)) delete data.workData[sid][k];
            });
        });
    }
    await writeData(data);
    res.json({ code: 0, msg: '删除成功' });
});

// 修改管理员密码
app.post('/api/updateAdminPwd', async (req, res) => {
    const data = await readData();
    const { oldPwd, newPwd } = req.body;
    if (data.admin.pwd !== oldPwd) return res.json({ code: -1, msg: '原密码错误' });
    data.admin.pwd = newPwd;
    await writeData(data);
    res.json({ code: 0, msg: '管理员密码修改成功' });
});

// 获取全部数据
app.get('/api/getAllData', async (req, res) => {
    const data = await readData();
    res.json(data);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`服务已启动，运行端口：${PORT}`);
});
