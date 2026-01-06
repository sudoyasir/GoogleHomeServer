# ESP32 Integration Guide

This guide explains how to integrate ESP32 smart home panels with the GoogleHomeServer.

## Overview

ESP32 devices communicate with ThingsBoard via MQTT and are managed through the GoogleHomeServer backend.

## Device Provisioning Flow

### 1. ESP32 Boot Sequence

When ESP32 boots for the first time:

```cpp
// 1. Connect to WiFi
WiFi.begin(ssid, password);

// 2. Call provisioning endpoint
HTTPClient http;
http.begin("https://your-server.com/api/device/register");
http.addHeader("Content-Type", "application/json");
http.addHeader("Authorization", "Bearer " + userJwtToken);

String payload = "{"
  "\"deviceName\": \"Living Room Panel\","
  "\"deviceType\": \"smart-home-panel\","
  "\"capabilities\": [\"light\", \"fan\", \"outlet\", \"speed\"],"
  "\"deviceLabel\": \"Living Room\""
"}";

int httpCode = http.POST(payload);

if(httpCode == 201) {
  // Parse response
  DynamicJsonDocument doc(1024);
  deserializeJson(doc, http.getString());
  
  // Store in preferences
  String deviceUuid = doc["device"]["deviceUuid"];
  String accessToken = doc["device"]["accessToken"];
  String mqttServer = doc["device"]["mqttServer"];
  int mqttPort = doc["device"]["mqttPort"];
  
  prefs.putString("device_uuid", deviceUuid);
  prefs.putString("access_token", accessToken);
  prefs.putString("mqtt_server", mqttServer);
  prefs.putInt("mqtt_port", mqttPort);
}
```

### 2. MQTT Connection

After provisioning, connect to MQTT:

```cpp
// Load stored credentials
String accessToken = prefs.getString("access_token");
String mqttServer = prefs.getString("mqtt_server");
int mqttPort = prefs.getInt("mqtt_port");

// Connect to MQTT
mqttClient.setServer(mqttServer.c_str(), mqttPort);
mqttClient.setCallback(mqttCallback);

// Username is access token, password is empty
mqttClient.connect("ESP32Client", accessToken.c_str(), "");

// Subscribe to RPC commands
mqttClient.subscribe("v1/devices/me/rpc/request/+");
```

## RPC Command Handling

### Device Control Commands

The ESP32 receives RPC commands in this format:

```json
{
  "method": "setDeviceState",
  "params": {
    "device_id": "device1",
    "state": true
  }
}
```

### Implementation

```cpp
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Parse JSON
  StaticJsonDocument<512> doc;
  deserializeJson(doc, payload, length);
  
  String method = doc["method"];
  JsonObject params = doc["params"];
  
  if(method == "setDeviceState") {
    const char* device_id = params["device_id"];
    bool state = params["state"];
    
    int index = find_device_by_id(device_id);
    if(index >= 0) {
      set_device_state(index, state);
      
      // Send response
      String response_topic = String("v1/devices/me/rpc/response/") + extractRequestId(topic);
      mqttClient.publish(response_topic.c_str(), "{\"success\":true}");
      
      // Send telemetry update
      mqtt_send_telemetry();
    }
  }
  else if(method == "setFanSpeed") {
    int speed = params["speed"];
    set_fan_speed(speed);
    mqtt_send_telemetry();
  }
}
```

## Telemetry Reporting

### Send Device States

```cpp
void mqtt_send_telemetry() {
  StaticJsonDocument<512> doc;
  
  // Device states
  doc["device1_state"] = devices[0].state ? 1 : 0;
  doc["device2_state"] = devices[1].state ? 1 : 0;
  doc["device3_state"] = devices[2].state ? 1 : 0;
  doc["device4_state"] = devices[3].state ? 1 : 0;
  
  // Fan speed
  doc["fan_speed"] = fan_speed;
  
  // Serialize and publish
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish("v1/devices/me/telemetry", payload.c_str());
}
```

### Send Attributes

```cpp
void mqtt_send_attributes() {
  StaticJsonDocument<1024> doc;
  
  // Device information
  doc["device_count"] = device_count;
  doc["fan_on"] = fan_is_on;
  doc["fan_speed"] = fan_speed;
  
  // Publish to attributes topic
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish("v1/devices/me/attributes", payload.c_str());
}
```

## Capability Mapping

### Device Types → Google Home Types

| ESP32 Capability | Google Home Type | Traits |
|-----------------|------------------|--------|
| `light` | `action.devices.types.LIGHT` | OnOff, Brightness |
| `fan` | `action.devices.types.FAN` | OnOff, FanSpeed |
| `outlet` | `action.devices.types.OUTLET` | OnOff |
| `speed` | (adds FanSpeed trait) | FanSpeed |
| `dimmer` | (adds Brightness trait) | Brightness |

### Capability Declaration

When provisioning, declare capabilities:

```cpp
// For a fan with speed control
capabilities = ["fan", "speed"];

// For a dimmable light
capabilities = ["light", "dimmer"];

// For a simple outlet
capabilities = ["outlet"];
```

## Device Configuration Examples

### Example 1: 4 Lights + Fan

```json
{
  "deviceName": "Living Room Panel",
  "deviceType": "smart-home-panel",
  "capabilities": ["light", "fan", "speed"],
  "deviceLabel": "Living Room",
  "deviceConfig": {
    "devices": [
      {"label": "Ceiling Light", "type": "light"},
      {"label": "Wall Light", "type": "light"},
      {"label": "Table Lamp", "type": "light"},
      {"label": "Mood Light", "type": "light"}
    ],
    "fan": {
      "enabled": true,
      "speedLevels": 5
    }
  }
}
```

### Example 2: Mixed Devices

```json
{
  "deviceName": "Bedroom Panel",
  "deviceType": "smart-home-panel",
  "capabilities": ["light", "outlet", "dimmer"],
  "deviceLabel": "Bedroom",
  "deviceConfig": {
    "devices": [
      {"label": "Bed Light", "type": "light", "dimmable": true},
      {"label": "Desk Lamp", "type": "light"},
      {"label": "Phone Charger", "type": "outlet"},
      {"label": "Laptop", "type": "outlet"}
    ]
  }
}
```

## Troubleshooting

### Device Not Appearing in Google Home

1. Check device provisioned successfully: `GET /api/device/list`
2. Verify device is online in ThingsBoard
3. Check MQTT connection
4. Trigger SYNC: Ask Google "Sync my devices"

### RPC Commands Not Working

1. Check MQTT subscription: `v1/devices/me/rpc/request/+`
2. Verify callback function is registered
3. Check telemetry is being sent (required for RPC)
4. Review serial output for RPC messages

### Telemetry Not Updating

1. Verify MQTT publish succeeds
2. Check topic: `v1/devices/me/telemetry`
3. Ensure JSON is valid
4. Check ThingsBoard device activity

## Best Practices

### 1. Persistent Storage

Always store provisioning data in NVS:

```cpp
Preferences prefs;
prefs.begin("device", false);
prefs.putString("device_uuid", deviceUuid);
prefs.putString("access_token", accessToken);
prefs.end();
```

### 2. Connection Recovery

Implement reconnection logic:

```cpp
void loop() {
  if(!mqttClient.connected()) {
    reconnect_mqtt();
  }
  mqttClient.loop();
}
```

### 3. State Synchronization

Send telemetry on every state change:

```cpp
void set_device_state(int index, bool state) {
  devices[index].state = state;
  digitalWrite(devices[index].gpio_pin, state);
  mqtt_send_telemetry(); // Always report changes
}
```

### 4. Error Handling

Handle provisioning failures gracefully:

```cpp
int retries = 0;
while(retries < 3 && !provisioned) {
  int result = provision_device();
  if(result == 201) {
    provisioned = true;
  } else {
    retries++;
    delay(5000);
  }
}
```

## Security Considerations

### 1. Access Token Storage

- Store securely in NVS/Preferences
- Never hardcode in source code
- Rotate periodically (future feature)

### 2. MQTT Connection

- Use TLS for production (port 8883)
- Validate server certificate
- Use unique client IDs

### 3. User JWT Token

- Obtain from mobile app
- Store securely
- Refresh when expired
- Use for device provisioning only

## Next Steps

1. ✅ Implement provisioning in ESP32
2. ✅ Test MQTT connection
3. ✅ Implement RPC handlers
4. ✅ Test with Google Home
5. Monitor and optimize performance
