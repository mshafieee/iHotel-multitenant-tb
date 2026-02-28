/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  HILTON GRAND HOTEL — Room Controller Firmware v2.0                     ║
 * ║  Target: ESP32 (38-pin DevKit or equivalent)                            ║
 * ║  Hardware: 8-channel relay board only                                   ║
 * ║  Sensors / dimmers / motors: mocked — connect hardware later            ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  ThingsBoard MQTT message flows:                                         ║
 * ║  ┌────────────────────────────────────────────────────────────────────┐  ║
 * ║  │  DEVICE → SERVER                                                   │  ║
 * ║  │    Telemetry     v1/devices/me/telemetry          (sensor/state)   │  ║
 * ║  │    Client attrs  v1/devices/me/attributes         (identity)       │  ║
 * ║  │    RPC response  v1/devices/me/rpc/response/{id}                   │  ║
 * ║  │  SERVER → DEVICE                                                   │  ║
 * ║  │    Shared attrs  v1/devices/me/attributes         (commands/push)  │  ║
 * ║  │    Attr resp     v1/devices/me/attributes/response/{id}            │  ║
 * ║  │    RPC request   v1/devices/me/rpc/request/{id}                    │  ║
 * ║  └────────────────────────────────────────────────────────────────────┘  ║
 * ║                                                                          ║
 * ║  Relay → actuator mapping:                                               ║
 * ║    relay1  →  Line 1 (lighting circuit A)                               ║
 * ║    relay2  →  Line 2 (lighting circuit B)                               ║
 * ║    relay3  →  Line 3 (lighting circuit C)                               ║
 * ║    relay4  →  AC compressor / cooling contactor                         ║
 * ║    relay5  →  Fan HIGH speed                                            ║
 * ║    relay6  →  Fan MEDIUM speed                                          ║
 * ║    relay7  →  Fan LOW speed                                             ║
 * ║    relay8  →  Door lock solenoid (momentary unlock pulse)               ║
 * ║                                                                          ║
 * ║  All WiFi credentials, ThingsBoard token, and pin assignments are in    ║
 * ║  the ── USER CONFIGURATION ── section below.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ─────────────────────────────────────────────────────────────────────────────
// ── USER CONFIGURATION ── Edit this block only
// ─────────────────────────────────────────────────────────────────────────────

// Wi-Fi
constexpr char WIFI_SSID[]     = "shafiee_h";
constexpr char WIFI_PASSWORD[] = "pp8rse8e7jmwpeh";

// ThingsBoard MQTT
// NOTE: 192.168.43.x is a mobile-hotspot address — make sure the server
//       machine always gets this IP (set a static lease on your hotspot).
constexpr char     TB_HOST[]  = "192.168.43.170";
constexpr uint16_t TB_PORT    = 1883;
constexpr char     TB_TOKEN[] = "qhdnlCzbWdnZZ7B3rjXQ";

// Room identity (published as ThingsBoard client attributes)
// IMPORTANT: the ThingsBoard device name MUST be "gateway-room-1520"
//            so the server's extractRoom() matches this room correctly.
constexpr int  ROOM_NUMBER = 1520;
constexpr int  ROOM_FLOOR  = 15;
constexpr char ROOM_TYPE[] = "VIP";  // floor 15 → type index 3 = VIP ✓
constexpr char FW_VERSION[] = "2.0.0";
constexpr char GW_VERSION[] = "2.0.0";

// ── GPIO PIN MAP ──────────────────────────────────────────────────────────────
//
//  Relay board (8-channel, active-HIGH).
//  If your board is active-LOW (relay fires on LOW), flip RELAY_ON/RELAY_OFF.
constexpr int PIN_RELAY[8] = { 32, 33, 25, 26, 27, 14, 12, 13 };
//   index:                    0   1   2   3   4   5   6   7
//   actuator:                R1  R2  R3  R4  R5  R6  R7  R8
//             (Line1)(Line2)(Line3)(AcComp)(FanH)(FanM)(FanL)(DoorLock)

constexpr int RELAY_ON  = HIGH;   // change to LOW for active-LOW boards
constexpr int RELAY_OFF = LOW;

// ── TIMING CONSTANTS ─────────────────────────────────────────────────────────

// How often to send a full telemetry snapshot (ms)
constexpr unsigned long TELEMETRY_INTERVAL_MS      = 10000UL;

// Default door-unlock pulse duration (ms) — overridden by TB shared attr
constexpr unsigned long DEFAULT_UNLOCK_DURATION_MS = 3000UL;

// MQTT reconnect interval (ms)
constexpr unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000UL;

// ── MOCK SENSOR VALUES ────────────────────────────────────────────────────────
// Runtime variables — can be updated via Serial JSON injection for testing.
// Replace with real sensor reads when you add hardware.
float mockTemperature     = 22.5f;   // °C
float mockHumidity        = 45.0f;   // %RH
int   mockCo2             = 600;     // ppm
bool  mockPirStatus       = false;   // PIR motion detected
bool  mockDoorStatus      = false;   // door contact: false=CLOSED, true=OPEN
float mockElecConsumption = 0.0f;    // kWh cumulative
float mockWaterConsumption = 0.0f;   // m³ cumulative

// ── END USER CONFIGURATION ──
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// ThingsBoard MQTT topic constants
// ─────────────────────────────────────────────────────────────────────────────

constexpr char TOPIC_TELEMETRY[]   = "v1/devices/me/telemetry";
constexpr char TOPIC_CLIENT_ATTR[] = "v1/devices/me/attributes";
constexpr char TOPIC_ATTR_SUB[]    = "v1/devices/me/attributes";
constexpr char TOPIC_ATTR_REQ[]    = "v1/devices/me/attributes/request/1";
constexpr char TOPIC_ATTR_RESP[]   = "v1/devices/me/attributes/response/+";
constexpr char TOPIC_RPC_SUB[]     = "v1/devices/me/rpc/request/+";
constexpr char TOPIC_RPC_RESP_PFX[]= "v1/devices/me/rpc/response/";

// Shared attribute keys to request on connect (restores state after reboot).
constexpr char SHARED_ATTR_KEYS[] =
  "relay1,relay2,relay3,relay4,relay5,relay6,relay7,relay8,"
  "line1,line2,line3,dimmer1,dimmer2,"
  "acMode,acTemperatureSet,fanSpeed,"
  "curtainsPosition,blindsPosition,"
  "dndService,murService,sosService,"
  "roomStatus,doorUnlock,defaultUnlockDuration,pdMode";

// ─────────────────────────────────────────────────────────────────────────────
// AC / fan index constants (must match server values)
// ─────────────────────────────────────────────────────────────────────────────

constexpr uint8_t AC_OFF  = 0;
constexpr uint8_t AC_COOL = 1;
constexpr uint8_t AC_HEAT = 2;
constexpr uint8_t AC_FAN  = 3;
constexpr uint8_t AC_AUTO = 4;

constexpr uint8_t FAN_LOW  = 0;
constexpr uint8_t FAN_MED  = 1;
constexpr uint8_t FAN_HIGH = 2;
constexpr uint8_t FAN_AUTO = 3;  // treated as MED

// ─────────────────────────────────────────────────────────────────────────────
// Room state — mirrors ThingsBoard shared attributes
// ─────────────────────────────────────────────────────────────────────────────

struct RoomState {
  // Lighting lines (relays 1-3)
  bool    line1 = false, line2 = false, line3 = false;
  // Dimmers: state tracked only — no PWM hardware connected
  uint8_t dimmer1 = 0, dimmer2 = 0;
  // HVAC
  uint8_t acMode           = AC_OFF;
  float   acTemperatureSet = 22.0f;
  uint8_t fanSpeed         = FAN_AUTO;
  // Window coverings: position tracked only — no motor hardware connected
  uint8_t curtainsPosition = 0;
  uint8_t blindsPosition   = 0;
  // Door
  bool          doorUnlock       = false;
  unsigned long unlockDurationMs = DEFAULT_UNLOCK_DURATION_MS;
  // Guest service flags
  bool dndService = false, murService = false, sosService = false;
  // Hotel management
  uint8_t roomStatus = 0;  // 0=VACANT 1=OCCUPIED 2=MUR 3=MAINTENANCE
  bool    pdMode     = false;
};

// ─────────────────────────────────────────────────────────────────────────────
// Global objects
// ─────────────────────────────────────────────────────────────────────────────

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);
RoomState    room;

// Timers
unsigned long lastTelemetrySendMs = 0;
unsigned long lastMqttReconnectMs = 0;

// Door unlock state
bool          doorUnlockActive  = false;
unsigned long doorUnlockStartMs = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Forward declarations
// ─────────────────────────────────────────────────────────────────────────────

void connectWiFi();
void connectMqtt();
void requestSharedAttributes();

void mqttCallback(char* topic, byte* payload, unsigned int len);
void handleAttrResponse(const char* json, unsigned int len);
void handleAttributeUpdate(const char* json, unsigned int len);
void handleRpcRequest(const char* topic, const char* json, unsigned int len);

void publishTelemetry();
void publishClientAttributes();
void publishMini(const char* json);

void applyRelayPin(int index, bool state);
void applyLine(int lineIndex, bool state);
void applyACRelay(bool compressor);
void applyFanRelays(uint8_t speed);
void triggerDoorUnlock(unsigned long durationMs);
void applyPDMode(bool enable);

void processSerial();

// ─────────────────────────────────────────────────────────────────────────────
// setup()
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(50);

  Serial.println(F("\n╔══════════════════════════════════════════╗"));
  Serial.println(F(  "║  HILTON GRAND HOTEL — Room Controller    ║"));
  Serial.printf (   "║  Room %-3d  Floor %-2d  FW %s            ║\n",
                    ROOM_NUMBER, ROOM_FLOOR, FW_VERSION);
  Serial.println(F(  "╚══════════════════════════════════════════╝\n"));
  Serial.println(F("Serial debug: send JSON to inject commands, e.g."));
  Serial.println(F("  {\"line1\":true}  {\"acMode\":1,\"fanSpeed\":2}  {\"pdMode\":true}\n"));

  // ── Relay pins — all off on boot ─────────────────────────────────────
  for (int i = 0; i < 8; i++) {
    pinMode(PIN_RELAY[i], OUTPUT);
    digitalWrite(PIN_RELAY[i], RELAY_OFF);
  }

  // ── Network ──────────────────────────────────────────────────────────
  connectWiFi();

  mqtt.setServer(TB_HOST, TB_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048, 2048);  // TBPubSubClient requires (receive, send)

  connectMqtt();

  Serial.println(F("[Init] Setup complete\n"));
}

// ─────────────────────────────────────────────────────────────────────────────
// loop()
// ─────────────────────────────────────────────────────────────────────────────

void loop() {
  unsigned long now = millis();

  // ── Maintain network connections ─────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WiFi] Connection lost — reconnecting…"));
    connectWiFi();
  }

  if (!mqtt.connected()) {
    if (now - lastMqttReconnectMs >= MQTT_RECONNECT_INTERVAL_MS) {
      lastMqttReconnectMs = now;
      connectMqtt();
    }
  } else {
    mqtt.loop();
  }

  // ── Door lock: auto re-lock after unlock pulse expires ────────────────
  if (doorUnlockActive && (now - doorUnlockStartMs >= room.unlockDurationMs)) {
    Serial.println(F("[Door] Auto re-lock"));
    applyRelayPin(7, false);
    room.doorUnlock  = false;
    doorUnlockActive = false;
    publishMini("{\"doorUnlock\":false,\"relay8\":false}");
  }

  // ── Periodic full telemetry snapshot ─────────────────────────────────
  if (now - lastTelemetrySendMs >= TELEMETRY_INTERVAL_MS) {
    publishTelemetry();
    lastTelemetrySendMs = now;
  }

  // ── Serial debug interface ────────────────────────────────────────────
  processSerial();
}

// ─────────────────────────────────────────────────────────────────────────────
// Wi-Fi connection (blocks up to 20 s, then continues offline)
// ─────────────────────────────────────────────────────────────────────────────

void connectWiFi() {
  Serial.printf("[WiFi] Connecting to '%s'", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 20000UL) {
      Serial.println(F("\n[WiFi] Timeout — continuing without network"));
      return;
    }
    delay(500);
    Serial.print('.');
  }
  Serial.printf("\n[WiFi] Connected   IP: %s\n", WiFi.localIP().toString().c_str());
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT connection + subscriptions
// ─────────────────────────────────────────────────────────────────────────────

void connectMqtt() {
  Serial.print(F("[MQTT] Connecting to ThingsBoard…"));
  // ThingsBoard authenticates via device token passed as MQTT username
  if (mqtt.connect("HiltonRoomController", TB_TOKEN, "")) {
    Serial.println(F(" connected"));

    mqtt.subscribe(TOPIC_ATTR_SUB);    // receive shared attr updates (commands)
    mqtt.subscribe(TOPIC_ATTR_RESP);   // receive attr request response
    mqtt.subscribe(TOPIC_RPC_SUB);     // receive direct RPC (future-proof)

    publishClientAttributes();         // announce room identity
    requestSharedAttributes();         // restore actuator state after reboot

    Serial.println(F("[MQTT] Ready"));
  } else {
    Serial.printf("[MQTT] Failed  rc=%d — retry in %lus\n",
                  mqtt.state(), MQTT_RECONNECT_INTERVAL_MS / 1000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Request current shared attributes from ThingsBoard to restore state on reboot
// ─────────────────────────────────────────────────────────────────────────────

void requestSharedAttributes() {
  StaticJsonDocument<256> doc;
  doc["sharedKeys"] = SHARED_ATTR_KEYS;
  char buf[256];
  serializeJson(doc, buf);
  mqtt.publish(TOPIC_ATTR_REQ, buf);
  Serial.println(F("[MQTT] State sync request sent"));
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT message dispatcher
// ─────────────────────────────────────────────────────────────────────────────

void mqttCallback(char* topic, byte* payload, unsigned int len) {
  char json[len + 1];
  memcpy(json, payload, len);
  json[len] = '\0';

  Serial.printf("[MQTT] ← %s\n        %s\n", topic, json);

  String t(topic);
  if (t.startsWith(F("v1/devices/me/attributes/response/"))) {
    handleAttrResponse(json, len);
  } else if (t == F("v1/devices/me/attributes")) {
    handleAttributeUpdate(json, len);
  } else if (t.startsWith(F("v1/devices/me/rpc/request/"))) {
    handleRpcRequest(topic, json, len);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle attribute request response
// ThingsBoard format: { "shared": { "relay1": false, … } }
// ─────────────────────────────────────────────────────────────────────────────

void handleAttrResponse(const char* json, unsigned int len) {
  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, json, len)) {
    Serial.println(F("[AttrResp] JSON parse error"));
    return;
  }

  Serial.println(F("[AttrResp] Restoring state from server…"));

  if (doc.containsKey("shared") && doc["shared"].is<JsonObject>()) {
    char flat[1024];
    serializeJson(doc["shared"], flat);
    handleAttributeUpdate(flat, strlen(flat));
  } else {
    // Flat response (some ThingsBoard versions)
    handleAttributeUpdate(json, len);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle shared attribute update (the main command handler)
//
// The Hilton v2 server always sends BOTH relay keys (relay1-8) AND logical
// keys (line1-3, acMode, fanSpeed, etc.) in the same message.  We handle
// both forms so the firmware works even with raw ThingsBoard dashboard widgets.
// ─────────────────────────────────────────────────────────────────────────────

void handleAttributeUpdate(const char* json, unsigned int len) {
  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, json, len)) {
    Serial.println(F("[Attr] JSON parse error"));
    return;
  }

  // ── Lighting lines (relay1-3 / line1-3) ──────────────────────────────
  // Accept either key form; relay key takes precedence when both are present.
  if (doc.containsKey("relay1") || doc.containsKey("line1")) {
    room.line1 = doc.containsKey("relay1") ? doc["relay1"].as<bool>() : doc["line1"].as<bool>();
    applyLine(0, room.line1);
  }
  if (doc.containsKey("relay2") || doc.containsKey("line2")) {
    room.line2 = doc.containsKey("relay2") ? doc["relay2"].as<bool>() : doc["line2"].as<bool>();
    applyLine(1, room.line2);
  }
  if (doc.containsKey("relay3") || doc.containsKey("line3")) {
    room.line3 = doc.containsKey("relay3") ? doc["relay3"].as<bool>() : doc["line3"].as<bool>();
    applyLine(2, room.line3);
  }

  // ── AC compressor (relay4) ────────────────────────────────────────────
  if (doc.containsKey("relay4")) {
    applyACRelay(doc["relay4"].as<bool>());
  }

  // ── Fan speed relays (relay5=HIGH  relay6=MED  relay7=LOW) ───────────
  if (doc.containsKey("relay5")) applyRelayPin(4, doc["relay5"].as<bool>());
  if (doc.containsKey("relay6")) applyRelayPin(5, doc["relay6"].as<bool>());
  if (doc.containsKey("relay7")) applyRelayPin(6, doc["relay7"].as<bool>());

  // ── Door unlock (relay8 / doorUnlock) ────────────────────────────────
  if (doc.containsKey("relay8") && doc["relay8"].as<bool>())     triggerDoorUnlock(room.unlockDurationMs);
  if (doc.containsKey("doorUnlock") && doc["doorUnlock"].as<bool>()) triggerDoorUnlock(room.unlockDurationMs);

  // ── Dimmers: state only (no PWM hardware) ────────────────────────────
  if (doc.containsKey("dimmer1")) {
    room.dimmer1 = (uint8_t)constrain((int)doc["dimmer1"], 0, 100);
    Serial.printf("[Dimmer1] %d%% (mocked — no PWM output)\n", room.dimmer1);
  }
  if (doc.containsKey("dimmer2")) {
    room.dimmer2 = (uint8_t)constrain((int)doc["dimmer2"], 0, 100);
    Serial.printf("[Dimmer2] %d%% (mocked — no PWM output)\n", room.dimmer2);
  }

  // ── HVAC logical state ────────────────────────────────────────────────
  // Relay4-7 are driven above.  If only the logical keys arrive (e.g. from
  // serial debug or a raw RPC), derive the relay state from them here.
  bool hasAcRelay  = doc.containsKey("relay4");
  bool hasFanRelay = doc.containsKey("relay5") || doc.containsKey("relay6") || doc.containsKey("relay7");

  if (doc.containsKey("acMode")) {
    room.acMode = (uint8_t)(int)doc["acMode"];
    if (!hasAcRelay) {
      bool comp = (room.acMode == AC_COOL) ||
                  (room.acMode == AC_AUTO && room.acTemperatureSet <= 25.0f);
      applyACRelay(comp);
    }
  }
  if (doc.containsKey("acTemperatureSet")) {
    room.acTemperatureSet = (float)doc["acTemperatureSet"];
  }
  if (doc.containsKey("fanSpeed")) {
    room.fanSpeed = (uint8_t)(int)doc["fanSpeed"];
    if (!hasFanRelay) applyFanRelays(room.fanSpeed);
  }

  // ── Curtains / blinds: position tracked only (no motor hardware) ──────
  if (doc.containsKey("curtainsPosition")) {
    room.curtainsPosition = (uint8_t)constrain((int)doc["curtainsPosition"], 0, 100);
    Serial.printf("[Curtain] %d%% (mocked — no motor output)\n", room.curtainsPosition);
  }
  if (doc.containsKey("blindsPosition")) {
    room.blindsPosition = (uint8_t)constrain((int)doc["blindsPosition"], 0, 100);
    Serial.printf("[Blind]   %d%% (mocked — no motor output)\n", room.blindsPosition);
  }

  // ── Unlock duration configuration ────────────────────────────────────
  if (doc.containsKey("defaultUnlockDuration")) {
    room.unlockDurationMs = (unsigned long)((int)doc["defaultUnlockDuration"]) * 1000UL;
    Serial.printf("[Door] Unlock duration: %lu ms\n", room.unlockDurationMs);
  }

  // ── Service flags ─────────────────────────────────────────────────────
  if (doc.containsKey("dndService")) room.dndService = doc["dndService"].as<bool>();
  if (doc.containsKey("murService")) room.murService = doc["murService"].as<bool>();
  if (doc.containsKey("sosService")) room.sosService = doc["sosService"].as<bool>();

  // ── Room status ───────────────────────────────────────────────────────
  if (doc.containsKey("roomStatus")) {
    uint8_t newStatus = (uint8_t)(int)doc["roomStatus"];
    room.roomStatus = newStatus;
    // NOT_OCCUPIED (4): energy-save mode — lights off, AC setpoint raised to 26°C
    if (newStatus == 4) {
      Serial.println(F("[Status] NOT_OCCUPIED → lights off, AC setpoint 26°C"));
      if (!room.pdMode) {
        room.line1 = false; applyLine(0, false);
        room.line2 = false; applyLine(1, false);
        room.line3 = false; applyLine(2, false);
        room.dimmer1 = 0; room.dimmer2 = 0;
      }
      room.acTemperatureSet = 26.0f;
      publishMini("{\"line1\":false,\"line2\":false,\"line3\":false,\"dimmer1\":0,\"dimmer2\":0,\"acTemperatureSet\":26}");
    }
  }

  // ── PD Mode — always processed last ──────────────────────────────────
  if (doc.containsKey("pdMode")) {
    bool pd = doc["pdMode"].as<bool>();
    if (pd != room.pdMode) applyPDMode(pd);
  }

  // Publish updated state immediately so the server's ThingsBoard WebSocket
  // subscription receives confirmation within ~200 ms instead of waiting up
  // to 10 s for the next periodic snapshot.
  if (mqtt.connected()) publishTelemetry();
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle direct RPC request (future-proof; server uses shared attrs currently)
// ─────────────────────────────────────────────────────────────────────────────

void handleRpcRequest(const char* topic, const char* json, unsigned int len) {
  String topicStr(topic);
  String requestId = topicStr.substring(topicStr.lastIndexOf('/') + 1);

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, json, len)) return;

  const char* method = doc["method"];
  Serial.printf("[RPC] method=%s  id=%s\n", method ? method : "(null)", requestId.c_str());

  // Route params through the standard attribute handler
  if (method && doc["params"].is<JsonObject>()) {
    char params[512];
    serializeJson(doc["params"], params);
    handleAttributeUpdate(params, strlen(params));
  }

  String respTopic = String(TOPIC_RPC_RESP_PFX) + requestId;
  mqtt.publish(respTopic.c_str(), "{\"result\":\"OK\"}");
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish full telemetry snapshot
// Sensors are mocked with static constants — swap in real reads when ready.
// ─────────────────────────────────────────────────────────────────────────────

void publishTelemetry() {
  StaticJsonDocument<1024> doc;

  // ── Mock sensor values (updated via serial JSON injection) ─────────────
  doc["temperature"]         = mockTemperature;
  doc["humidity"]            = mockHumidity;
  doc["co2"]                 = mockCo2;
  doc["pirMotionStatus"]     = mockPirStatus;
  doc["doorStatus"]          = mockDoorStatus;
  doc["doorLockBattery"]     = 100;
  doc["doorContactsBattery"] = 100;
  doc["airQualityBattery"]   = 100;
  doc["waterMeterBattery"]   = 100;
  doc["elecConsumption"]     = mockElecConsumption;
  doc["waterConsumption"]    = mockWaterConsumption;

  // ── Actual relay / actuator state ─────────────────────────────────────
  doc["line1"]            = room.line1;
  doc["line2"]            = room.line2;
  doc["line3"]            = room.line3;
  doc["dimmer1"]          = room.dimmer1;
  doc["dimmer2"]          = room.dimmer2;
  doc["acMode"]           = room.acMode;
  doc["acTemperatureSet"] = room.acTemperatureSet;
  doc["fanSpeed"]         = room.fanSpeed;
  doc["curtainsPosition"] = room.curtainsPosition;
  doc["blindsPosition"]   = room.blindsPosition;
  doc["doorUnlock"]       = room.doorUnlock;
  doc["dndService"]       = room.dndService;
  doc["murService"]       = room.murService;
  doc["sosService"]       = room.sosService;
  doc["roomStatus"]       = room.roomStatus;
  doc["pdMode"]           = room.pdMode;

  // ── Device metadata ───────────────────────────────────────────────────
  doc["lastTelemetryTime"] = millis();
  doc["deviceStatus"]      = 0;      // 0=normal 1=boot 2=fault
  doc["firmwareVersion"]   = FW_VERSION;
  doc["gatewayVersion"]    = GW_VERSION;

  char buf[1024];
  size_t n = serializeJson(doc, buf);
  if (mqtt.publish(TOPIC_TELEMETRY, (uint8_t*)buf, n, false)) {
    Serial.println(F("[Telem] Snapshot published"));
  } else {
    Serial.println(F("[Telem] Publish failed"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish static device identity as client attributes
// ─────────────────────────────────────────────────────────────────────────────

void publishClientAttributes() {
  StaticJsonDocument<128> doc;
  doc["firmwareVersion"] = FW_VERSION;
  doc["gatewayVersion"]  = GW_VERSION;
  doc["floor"]           = ROOM_FLOOR;
  doc["roomNumber"]      = ROOM_NUMBER;
  doc["roomType"]        = ROOM_TYPE;
  char buf[128];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(TOPIC_CLIENT_ATTR, (uint8_t*)buf, n, false);
  Serial.println(F("[Attr] Client attributes published"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish a small immediate telemetry message (on-change events)
// ─────────────────────────────────────────────────────────────────────────────

void publishMini(const char* json) {
  mqtt.publish(TOPIC_TELEMETRY, json);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actuator drivers
// ─────────────────────────────────────────────────────────────────────────────

// Low-level relay GPIO write (respects RELAY_ON / RELAY_OFF polarity).
void applyRelayPin(int index, bool state) {
  if (index < 0 || index >= 8) return;
  digitalWrite(PIN_RELAY[index], state ? RELAY_ON : RELAY_OFF);
}

// Drive a lighting line relay; blocked when PD mode is active.
void applyLine(int lineIndex, bool state) {
  if (lineIndex < 0 || lineIndex >= 3) return;
  if (room.pdMode && state) {
    Serial.printf("[Line%d] Blocked — PD mode\n", lineIndex + 1);
    return;
  }
  applyRelayPin(lineIndex, state);
  Serial.printf("[Line%d] %s\n", lineIndex + 1, state ? "ON" : "OFF");
}

// Drive the AC compressor relay (relay4 = index 3).
void applyACRelay(bool compressor) {
  if (room.pdMode && compressor) {
    Serial.println(F("[AC] Blocked — PD mode"));
    return;
  }
  applyRelayPin(3, compressor);
  Serial.printf("[AC] Compressor %s\n", compressor ? "ON" : "OFF");
}

// Drive fan speed relays (relay5=HIGH  relay6=MED  relay7=LOW).
// Clears all three first so only one can be active at a time.
void applyFanRelays(uint8_t speed) {
  applyRelayPin(4, false);
  applyRelayPin(5, false);
  applyRelayPin(6, false);
  if (room.pdMode) { Serial.println(F("[Fan] All off — PD mode")); return; }
  switch (speed) {
    case FAN_LOW:  applyRelayPin(6, true); Serial.println(F("[Fan] LOW"));       break;
    case FAN_MED:  applyRelayPin(5, true); Serial.println(F("[Fan] MED"));       break;
    case FAN_HIGH: applyRelayPin(4, true); Serial.println(F("[Fan] HIGH"));      break;
    case FAN_AUTO: applyRelayPin(5, true); Serial.println(F("[Fan] AUTO→MED")); break;
    default:                               Serial.println(F("[Fan] OFF"));       break;
  }
}

// Trigger momentary door-unlock relay pulse (relay8 = index 7).
// Auto re-locks in loop() after unlockDurationMs.
void triggerDoorUnlock(unsigned long durationMs) {
  Serial.printf("[Door] Unlocking for %lu ms\n", durationMs);
  applyRelayPin(7, true);
  room.doorUnlock   = true;
  doorUnlockActive  = true;
  doorUnlockStartMs = millis();
  publishMini("{\"doorUnlock\":true,\"relay8\":true}");
}

// Power Down mode: cut all relays immediately.
// On clear: all outputs stay off; server will push desired state on next poll.
void applyPDMode(bool enable) {
  room.pdMode = enable;
  Serial.printf("[PD] Power Down %s\n", enable ? "ACTIVATED" : "CLEARED");

  if (enable) {
    for (int i = 0; i < 8; i++) applyRelayPin(i, false);
    doorUnlockActive = false;
    room.line1 = room.line2 = room.line3 = false;
    room.dimmer1 = room.dimmer2 = 0;
    room.acMode  = AC_OFF;
  }

  char buf[32];
  snprintf(buf, sizeof(buf), "{\"pdMode\":%s}", enable ? "true" : "false");
  publishMini(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// Serial debug interface
//
// Send a JSON command over Serial Monitor (115200 baud) to test without a
// dashboard. Handles both actuator keys AND sensor injection keys.
//
// Actuator commands:
//   {"line1":true}                        — lighting
//   {"acMode":1,"fanSpeed":2}             — HVAC
//   {"curtainsPosition":75}               — window coverings
//   {"pdMode":true}                       — power down
//   {"doorUnlock":true}                   — unlock door pulse
//   {"roomStatus":4}                      — force NOT_OCCUPIED for testing
//
// Sensor injection (mock values published on next telemetry tick):
//   {"temperature":28.5}
//   {"humidity":65.0}
//   {"co2":1400}
//   {"pirMotionStatus":true}              — motion DETECTED
//   {"doorStatus":true}                   — door OPEN
//   {"elecConsumption":125.5}
//   {"waterConsumption":3.2}
// ─────────────────────────────────────────────────────────────────────────────

void processSerial() {
  static String inputLine;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      inputLine.trim();
      if (inputLine.length() > 0) {
        Serial.printf("[Serial] → %s\n", inputLine.c_str());

        // Try to parse sensor injection keys first
        StaticJsonDocument<256> sensorDoc;
        if (!deserializeJson(sensorDoc, inputLine)) {
          bool sensorChanged = false;
          if (sensorDoc.containsKey("temperature")) {
            mockTemperature = sensorDoc["temperature"].as<float>();
            Serial.printf("[Sensor] temperature = %.1f°C\n", mockTemperature);
            sensorChanged = true;
          }
          if (sensorDoc.containsKey("humidity")) {
            mockHumidity = sensorDoc["humidity"].as<float>();
            Serial.printf("[Sensor] humidity = %.1f%%\n", mockHumidity);
            sensorChanged = true;
          }
          if (sensorDoc.containsKey("co2")) {
            mockCo2 = sensorDoc["co2"].as<int>();
            Serial.printf("[Sensor] co2 = %d ppm\n", mockCo2);
            sensorChanged = true;
          }
          if (sensorDoc.containsKey("pirMotionStatus")) {
            mockPirStatus = sensorDoc["pirMotionStatus"].as<bool>();
            Serial.printf("[Sensor] PIR = %s\n", mockPirStatus ? "DETECTED" : "CLEAR");
            sensorChanged = true;
          }
          if (sensorDoc.containsKey("doorStatus")) {
            mockDoorStatus = sensorDoc["doorStatus"].as<bool>();
            Serial.printf("[Sensor] door = %s\n", mockDoorStatus ? "OPEN" : "CLOSED");
            sensorChanged = true;
          }
          if (sensorDoc.containsKey("elecConsumption")) {
            mockElecConsumption = sensorDoc["elecConsumption"].as<float>();
            Serial.printf("[Sensor] elec = %.2f kWh\n", mockElecConsumption);
            sensorChanged = true;
          }
          if (sensorDoc.containsKey("waterConsumption")) {
            mockWaterConsumption = sensorDoc["waterConsumption"].as<float>();
            Serial.printf("[Sensor] water = %.3f m³\n", mockWaterConsumption);
            sensorChanged = true;
          }
          // If only sensor keys were present, publish immediately and skip actuator handler
          if (sensorChanged) publishTelemetry();
        }

        // Always run actuator handler — it safely ignores unknown keys
        handleAttributeUpdate(inputLine.c_str(), inputLine.length());
      }
      inputLine = "";
    } else if (c != '\r') {
      inputLine += c;
    }
  }
}
