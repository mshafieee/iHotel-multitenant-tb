# iHotel ↔ Greentech GRMS — 对接规范

**收件人：Greentech GRMS 技术团队**
**发件人：iHotel 平台团队**
**主题：API 能力、数据需求及统一格式提案**

---

## 1. 关于 iHotel

iHotel 是一个多租户的云端智能酒店管理平台。它通过通用物联网（IoT）适配层连接物理客房控制器（RCU）。单个 iHotel 服务器可同时管理多家酒店，每家酒店均配备独立的员工控制台、客人门户和自动化引擎——所有这些模块均与物理硬件进行实时通信。

---

## 2. iHotel 如何使用贵方 RCU

### 2.1 设备发现
在初始酒店设置阶段，iHotel 会调用贵方 API 来发现所有客房及其安装的设备：
- 通过 `GET /system/dept/open/list` 获取酒店列表
- 通过 `GET /mqtt/room/list2` 并传入 `hotelId` 获取客房列表
- 通过 `GET /mqtt/room/device/list2` 并传入 `roomId` 获取每间客房的设备分组

基于此，iHotel 会构建每间客房的设备拓扑结构：灯具（`d[]`）数量、调光器（`tgd[]`）数量、空调（`wk[]`）数量、窗帘（`cl[]`）数量以及服务标识（`fw[]`）数量。这些数量直接驱动 UI 渲染——员工控制台和客人门户会为每间客房精准渲染对应数量的控制按钮。

### 2.2 实时轮询
iHotel 每隔 5 秒对所有客房进行一次轮询。每个轮询周期内：
- 获取客房列表以读取房间级别状态字段
- 并发获取所有客房的设备分组
- 对比当前状态与上次状态
- 在毫秒级内通过 SSE（Server-Sent Events）将任何状态变更广播至所有已连接的客户端

**当前问题**：这要求每个客房需要 2 次 API 调用 + 1 次酒店列表调用 = 6 间客房每个周期需 13 次调用。请参见第 5 节中提出的统一格式，该格式可将此降为每房 1 次调用。

### 2.3 设备控制
iHotel 通过 `PUT /mqtt/room/device` 发送控制指令，以控制灯具、调光器、空调、窗帘和场景。

### 2.4 硬件场景触发
iHotel 与贵方预编程的 RCU 场景进行集成，以应对房间生命周期事件：
- **退房 (Check-out)** → 触发 `check out` 场景
- **入住 (Check-in)** → 触发 `check in` 场景

### 2.5 客人门户
每位客人通过二维码链接访问其客房控制界面——包括灯光、空调、窗帘、请勿打扰（DND）。指令经由 iHotel 服务器发送至贵方 RCU API。该门户通过 SSE 订阅实时状态更新。

---

## 3. 当前 API 存在的问题

| 问题 | 影响 |
|---|---|
| `checkStatus` 字段不可靠 | iHotel 已禁用该字段——房间占用状态与预订状态存在冲突 |
| `outStatus` 有时返回 `null` | DND（请勿打扰）状态在 UI 中闪烁/跳动 |
| 所有客房的 `fw[]` 数组均为空 | DND/MUR/SOS 服务标识无法被控制或读取 |
| 缺少门磁传感器字段 | 开门自动入住功能无法运行 |
| 缺少 PIR 人体感应字段 | 无人（NOT_OCCUPIED）节能自动化无法运行 |
| 缺少环境传感器字段（温度/湿度/CO₂） | 无法进行环境监测 |
| 每次轮询每间客房需 2 次 API 调用 | 2 倍的 TLS 开销——导致连接错误 |

---

## 4. 需求字段

### 4.1 房间级别（当前位于 `/mqtt/room/list2`）

| 字段 | 需求值 | iHotel 用途 | 状态 |
|---|---|---|---|
| `hostId` | string | 房间标识符 | ✅ 正常工作 |
| `roomNum` | string | 房号 | ✅ 正常工作 |
| `deviceOnline` | `true` / `false` | 在线状态指示 | ✅ (对应 `hoststatus`) |
| `cardPower` | `true` / `false` | 插卡取电继电器 | ✅ (对应 `powerStatus`) |
| `doorLock` | `LOCKED` / `UNLOCKED` | 门锁状态 | ✅ (对应 `lockStatus`) |
| `acRunning` | `true` / `false` | 空调是否正在运行 | ✅ (对应 `airStatus`) |
| `dnd` | `true` / `false` | 请勿打扰 | ⚠️ 有时为 null |
| `mur` | `true` / `false` | 请即打扫请求 | ❌ 缺失 |
| `sos` | `true` / `false` | 紧急呼叫 (SOS) | ❌ 缺失 |
| `checkStatus` | `VACANT` / `CHECKED_IN` 等 | 硬件端占用状态 | ⚠️ 不可靠 |
| `doorContact` | `OPEN` / `CLOSED` | 物理门磁传感器 | ❌ **缺失——关键** |
| `pirMotion` | `true` / `false` | 人体移动传感器 | ❌ **缺失——关键** |
| `roomTemperature` | number | 环境温度 | ❌ 缺失 |
| `humidity` | number | 环境湿度 | ❌ 缺失 |
| `co2` | number | CO₂ 浓度 (ppm) | ❌ 缺失 |

### 4.2 设备数组（当前来自 `/mqtt/room/device/list2`）

所有设备数组应包含在同一房间的上行数据中（见第 5 节）。

---

## 5. 提议的统一上行数据格式（GET 响应）

我们提议为每间客房提供一个单一的统一 JSON 响应，在一个数据包（Payload）内合并所有房间级状态和设备状态。这消除了每个轮询周期内每间客房需要第二次 API 调用的必要性。

### 5.1 提议的响应结构

```json
{
  "hostId": "6C05000020C4",
  "roomNum": "102A",

  "deviceOnline":    true,
  "cardPower":       true,
  "checkStatus":     "CHECKED_IN",
  "doorLock":        "LOCKED",
  "doorContact":     "CLOSED",
  "pirMotion":       false,
  "dnd":             false,
  "mur":             false,
  "sos":             false,
  "acRunning":       true,

  "roomTemperature": 24.5,
  "humidity":        55,
  "co2":             420,
  "lightLevel":      320,

  "lamps": [
    { "id": 1, "name": "CEILING LIGHT",  "on": true  },
    { "id": 2, "name": "BEDSIDE LIGHT",  "on": false },
    { "id": 3, "name": "ENTRANCE LIGHT", "on": true  },
    { "id": 4, "name": "SOCKET",         "on": true  }
  ],

  "dimmers": [
    { "id": 10, "name": "SPOTLIGHT 1", "on": true,  "brightness": 80 },
    { "id": 11, "name": "SPOTLIGHT 2", "on": false, "brightness": 0  },
    { "id": 12, "name": "SPOTLIGHT 3", "on": true,  "brightness": 60 }
  ],

  "ac": [
    {
      "id":          20,
      "name":        "MAIN THERMOSTAT",
      "on":          true,
      "mode":        "COOL",
      "setTemp":     22,
      "currentTemp": 24.5,
      "fanSpeed":    "AUTO"
    }
  ],

  "curtains": [
    { "id": 30, "name": "MAIN CURTAIN", "position": 100, "state": "OPEN"   },
    { "id": 31, "name": "BLACKOUT",     "position": 0,   "state": "CLOSED" }
  ],

  "scenes": [
    { "id": 40, "name": "CHECK IN"      },
    { "id": 41, "name": "CHECK OUT"     },
    { "id": 42, "name": "WELCOME"       },
    { "id": 43, "name": "SLEEP"         },
    { "id": 44, "name": "DO NOT DISTURB"},
    { "id": 45, "name": "POWER MODE"    },
    { "id": 46, "name": "DOOR CONTACT"  },
    { "id": 47, "name": "SENSOR 1"      },
    { "id": 48, "name": "SENSOR 2"      }
  ]
}
```

### 5.2 字段值规范

| 字段 | 允许值 |
|---|---|
| `checkStatus` | `VACANT` / `RESERVED` / `CHECKED_IN` / `CHECKED_OUT` / `SERVICE` / `MAINTENANCE` |
| `doorLock` | `LOCKED` / `UNLOCKED` |
| `doorContact` | `OPEN` / `CLOSED` |
| `mode` (空调) | `COOL` / `HEAT` / `FAN` / `AUTO` |
| `fanSpeed` | `AUTO` / `LOW` / `MEDIUM` / `HIGH` |
| `curtain state` | `OPEN` / `CLOSED` / `MOVING` |
| 布尔值字段 | `true` / `false` |
| `brightness` / `position` | 整数 `0–100` |
| 温度 / 湿度 / CO₂ | 数值型，不带单位后缀 |

### 5.3 统一格式的优势

| | 当前方式 | 提议方式 |
|---|---|---|
| 每个周期每房 API 调用次数 | 2 | 1 |
| 每个周期总调用次数（6 间房） | 13 | 6 |
| 每分钟 TLS 连接数 | ~156 | ~72 |
| 状态一致性 | 两次调用可能捕获不同时间点的状态 | 单一原子快照 |
| 解析复杂度 | 需合并两种不同的响应结构 | 单一扁平结构 |

---

## 6. 提议的 PUT 指令格式（稀疏 / 局部更新）

### 设计原则
PUT 指令应是**稀疏的**——仅包含需要更改的字段。所有未提及的字段在 RCU 上保持不变。这是标准的 PATCH 语义。

**在每次 PUT 请求中，`hostId` 是唯一必填字段。** 其他所有字段均为可选。

### 6.1 示例

**开启单一灯具：**
```json
{ "hostId": "6C05000020C4", "lamps": [{ "id": 1, "on": true }] }
```

**通过单条原子指令关闭多个灯具：**
```json
{
  "hostId": "6C05000020C4",
  "lamps": [
    { "id": 1, "on": false },
    { "id": 2, "on": false },
    { "id": 3, "on": false }
  ]
}
```

**仅设置调光器亮度（保持开/关状态不变）：**
```json
{ "hostId": "6C05000020C4", "dimmers": [{ "id": 10, "brightness": 60 }] }
```

**开启空调并设为制冷模式 22°C：**
```json
{ "hostId": "6C05000020C4", "ac": [{ "id": 20, "on": true, "mode": "COOL", "setTemp": 22 }] }
```

**仅更改空调温度（保持模式和风速不变）：**
```json
{ "hostId": "6C05000020C4", "ac": [{ "id": 20, "setTemp": 24 }] }
```

**激活请勿打扰 (DND)：**
```json
{ "hostId": "6C05000020C4", "dnd": true }
```

**通过 ID 触发场景：**
```json
{ "hostId": "6C05000020C4", "scene": { "id": 41 } }
```

**退房 —— 原子化地关闭所有设备并触发场景：**
```json
{
  "hostId": "6C05000020C4",
  "scene": { "id": 41 },
  "dnd": false,
  "mur": false
}
```

### 6.2 规则总结

1. **仅包含需要更改的内容** —— 硬件上未提及的字段保持不变
2. **设备数组支持局部更新** —— 在 `lamps[]` 中发送单项数据仅针对该灯具；其他灯具不受影响
3. **`hostId` 始终为必填项**
4. **单次 PUT 中的多个设备类型以原子方式执行** —— 减少网络往返并确保一致性
5. **场景触发 + 标识更新可组合** 在单次 PUT 请求中

---

## 7. 需求汇总

| 优先级 | 需求 |
|---|---|
| 🔴 关键 | 在房间上行数据中新增 `doorContact` 字段 (`OPEN`/`CLOSED`) |
| 🔴 关键 | 在房间上行数据中新增 `pirMotion` 布尔字段 |
| 🔴 关键 | 将 `mur` 和 `sos` 开放为可读写的房间级字段 |
| 🔴 关键 | 使 `dnd` 可通过 PUT 写入（当前从 `outStatus` 仅为只读） |
| 🟠 高 | 修复 `checkStatus` 的可靠性 —— 应仅反映插卡/拔卡的硬件状态 |
| 🟠 高 | 修复 `outStatus` 返回 null 的问题 —— 应始终返回 `true`/`false` |
| 🟠 高 | 采用统一的单次调用上行数据格式（第 5 节） |
| 🟠 高 | 采用稀疏 PUT 格式（第 6 节） |
| 🟡 中 | 若存在传感器，请在房间上行数据中新增 `roomTemperature`、`humidity`、`co2` |
| 🟡 中 | 全局使用英文字段值（第 5.2 节） |
```