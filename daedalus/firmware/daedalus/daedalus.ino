/*
 * Project Daedalus: firmware for a one-stick Bluetooth LE gamepad.
 *
 * Board:    ESP32-C6-WROOM-1 on the project's own PCB, or an ESP32-C6-DevKitC-1 for the breadboard prototype
 * Shows up: as a standard HID gamepad over Bluetooth LE (HID over GATT), no drivers, on Windows and macOS
 * Builds with the Arduino IDE 2:
 *   Boards Manager   "esp32" by Espressif Systems, version 3.x
 *   Library Manager  "NimBLE-Arduino" by h2zero, version 2.5 or newer
 *   Tools > Board    "ESP32C6 Dev Module"
 *   Tools > USB CDC On Boot   "Enabled"   (so Serial goes over the USB-C socket)
 *   Tools > CPU Frequency     "80MHz (WiFi)"
 *   Tools > Flash Size        "8MB (64Mb)"
 * Last compiled without errors against esp32 core 3.3.12 and NimBLE-Arduino 2.5.2.
 * The page at /daedalus/ has the wiring, the pin table and the step-by-step instructions.
 *
 * What the buttons do besides being buttons:
 *   Hold HOME for 5 s             forget every paired computer and start pairing again
 *   Hold START + SELECT for 3 s   calibrate the stick (leave it alone for 2 s, then roll it round the edge for 6 s)
 *   10 minutes with nothing touched, or 3 minutes with no computer found: the controller sleeps;
 *   HOME or START wakes it. The slide switch is the real off switch.
 *
 * Status light:
 *   slow blink        looking for a computer
 *   on for 3 s, off   connected
 *   two quick blinks every 4 s   battery under 10 %
 *   solid, then fast blink       stick calibration (centre, then edge)
 */

#include <Arduino.h>
#include <Preferences.h>
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#include "esp_sleep.h"
#include "driver/rtc_io.h"

// ----------------------------------------------------------------------------------------------- settings
static const char *DEVICE_NAME  = "Daedalus";
static const char *MANUFACTURER = "Project Daedalus";
// 0x1209 / 0x0001 is the pid.codes test ID: fine on your own desk, not for units you sell.
static const uint16_t USB_VID = 0x1209, USB_PID = 0x0001, DEVICE_VERSION = 0x0100;

// Stick orientation. If up/down or left/right come out backwards on your board, flip these.
static const bool STICK_INVERT_X = false;
static const bool STICK_INVERT_Y = false;
static const bool STICK_SWAP_XY  = false;

static const float INNER_DEADZONE = 0.08f;   // fraction of travel around the centre that reads as zero
                                             //   (the stick is specified to return to centre within 6.3 %)
static const float OUTER_DEADZONE = 0.04f;   // fraction at the edge that already reads as full
static const float STICK_CURVE    = 1.0f;    // 1 = output follows the stick exactly; 1.5 = finer control near the centre
static const uint32_t DEBOUNCE_MS = 5;
static const uint32_t IDLE_SLEEP_MS = 10UL * 60UL * 1000UL;
static const uint32_t SEARCH_SLEEP_MS = 3UL * 60UL * 1000UL;
static const int8_t TX_POWER_DBM = 3;        // plenty for a desk or a couch, and easier on the battery

// ----------------------------------------------------------------------------------------------- pins
// Exactly as drawn on the wiring sheet. Buttons connect the pin to ground when pressed.
static const uint8_t PIN_STICK_X   = 2;    // ADC1 channel 2
static const uint8_t PIN_STICK_Y   = 3;    // ADC1 channel 3
static const uint8_t PIN_BATTERY   = 6;    // ADC1 channel 6, battery through a 1M / 1M divider
static const uint8_t PIN_STICK_PWR = 8;    // LOW switches the stick's supply on (P-channel MOSFET, 10k pull-up)
static const uint8_t PIN_LED       = 15;   // HIGH = on

enum Btn : uint8_t {                       // order = bit in the report (same order a DualShock 4 uses)
  B_SQUARE, B_CROSS, B_CIRCLE, B_TRIANGLE, B_L1, B_R1, B_L2, B_R2,
  B_SELECT, B_START, B_L3, B_R3_UNUSED, B_HOME, BTN_COUNT
};
static const int8_t BTN_PIN[BTN_COUNT] = {
  21,   // square   (west)
  20,   // cross    (south)
  19,   // circle   (east)
  18,   // triangle (north)
  10,   // L1
  22,   // R1
  0,    // L2
  1,    // R2
  23,   // select
  7,    // start    (can wake the controller)
  4,    // L3, the stick's click
  -1,   // R3: there is no right stick
  5     // home     (can wake the controller)
};
static const uint64_t WAKE_PINS = (1ULL << 5) | (1ULL << 7);

// ----------------------------------------------------------------------------------------------- HID report
// One input report, ID 1, 12 bytes:
//   16 buttons, then X, Y, Z, Rz as signed 16-bit (Z and Rz stay centred: no right stick), then Rx, Ry as
//   8-bit triggers (L2, R2: 0 or 255, because the triggers are switches).
static const uint8_t REPORT_MAP[] = {
  0x05, 0x01,        // Usage Page (Generic Desktop)
  0x09, 0x05,        // Usage (Game Pad)
  0xA1, 0x01,        // Collection (Application)
  0x85, 0x01,        //   Report ID (1)
  0x05, 0x09,        //   Usage Page (Button)
  0x19, 0x01,        //   Usage Minimum (1)
  0x29, 0x10,        //   Usage Maximum (16)
  0x15, 0x00,        //   Logical Minimum (0)
  0x25, 0x01,        //   Logical Maximum (1)
  0x75, 0x01,        //   Report Size (1)
  0x95, 0x10,        //   Report Count (16)
  0x81, 0x02,        //   Input (Data, Variable, Absolute)
  0x05, 0x01,        //   Usage Page (Generic Desktop)
  0x09, 0x01,        //   Usage (Pointer)
  0xA1, 0x00,        //   Collection (Physical)
  0x09, 0x30,        //     Usage (X)
  0x09, 0x31,        //     Usage (Y)
  0x09, 0x32,        //     Usage (Z)
  0x09, 0x35,        //     Usage (Rz)
  0x16, 0x01, 0x80,  //     Logical Minimum (-32767)
  0x26, 0xFF, 0x7F,  //     Logical Maximum (32767)
  0x75, 0x10,        //     Report Size (16)
  0x95, 0x04,        //     Report Count (4)
  0x81, 0x02,        //     Input (Data, Variable, Absolute)
  0xC0,              //   End Collection
  0x09, 0x33,        //   Usage (Rx)
  0x09, 0x34,        //   Usage (Ry)
  0x15, 0x00,        //   Logical Minimum (0)
  0x26, 0xFF, 0x00,  //   Logical Maximum (255)
  0x75, 0x08,        //   Report Size (8)
  0x95, 0x02,        //   Report Count (2)
  0x81, 0x02,        //   Input (Data, Variable, Absolute)
  0xC0               // End Collection
};

struct __attribute__((packed)) Report {
  uint16_t buttons;
  int16_t x, y, z, rz;
  uint8_t l2, r2;
};
static_assert(sizeof(Report) == 12, "report must be 12 bytes");

// ----------------------------------------------------------------------------------------------- state
static NimBLEServer *server = nullptr;
static NimBLEHIDDevice *hid = nullptr;
static NimBLECharacteristic *inputReport = nullptr;
static Preferences prefs;

static volatile bool connected = false;       // a computer is connected and the link is encrypted
static volatile bool linkUp = false;          // a computer is connected (maybe still pairing)
static volatile uint16_t connHandle = 0;
static volatile uint16_t connInterval = 0;    // in units of 1.25 ms, 0 = not known yet
static volatile uint32_t connectedAt = 0;
static volatile bool forceSend = true;     // send a full report as soon as a computer is listening

struct Cal { int cx, cy, minX, maxX, minY, maxY; };
static Cal cal = { 1650, 1650, 400, 2900, 400, 2900 };   // millivolts; replaced by the saved calibration
static bool calSaved = false;

static bool btnState[BTN_COUNT] = { false };
static uint32_t btnChanged[BTN_COUNT] = { 0 };
static float filtX = 1650, filtY = 1650;
static Report lastSent = { 0xFFFF, 0, 0, 0, 0, 0, 0 };
static uint32_t lastSendUs = 0, lastActivity = 0, searchStart = 0;
static uint8_t batteryPct = 100;

// ----------------------------------------------------------------------------------------------- Bluetooth
class ServerEvents : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s, NimBLEConnInfo &info) override {
    linkUp = true;
    connHandle = info.getConnHandle();
    connInterval = info.getConnInterval();
    connectedAt = millis();
  }
  void onDisconnect(NimBLEServer *s, NimBLEConnInfo &info, int reason) override {
    linkUp = false;
    connected = false;
    connInterval = 0;
    NimBLEDevice::startAdvertising();
  }
  void onAuthenticationComplete(NimBLEConnInfo &info) override {
    if (info.isEncrypted()) {
      connected = true;
      forceSend = true;
      connectedAt = millis();
    } else {
      // pairing failed (often: the computer still remembers an older pairing). Drop the link; the computer
      // will ask again, and "Hold HOME for 5 s" plus "Remove device" on the computer clears it for good.
      NimBLEDevice::getServer()->disconnect(info.getConnHandle());
    }
  }
  void onConnParamsUpdate(NimBLEConnInfo &info) override {
    connInterval = info.getConnInterval();
  }
};

static void startBluetooth() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setPower(TX_POWER_DBM);
  NimBLEDevice::setSecurityAuth(true, false, true);              // bond, no passkey, secure connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);     // "just works" pairing

  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerEvents());

  hid = new NimBLEHIDDevice(server);
  inputReport = hid->getInputReport(1);
  hid->setManufacturer(MANUFACTURER);
  hid->setPnp(0x02, USB_VID, USB_PID, DEVICE_VERSION);           // 0x02: the IDs are USB-style IDs
  hid->setHidInfo(0x00, 0x01);                                   // country 0, flags: normally connectable
  hid->setReportMap((uint8_t *)REPORT_MAP, sizeof(REPORT_MAP));
  hid->setBatteryLevel(batteryPct);
  server->start();                                               // start the HID, battery and device-info services

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->enableScanResponse(true);                                 // the name travels in the scan response
  adv->setAppearance(0x03C4);                                    // 0x03C4 = gamepad
  adv->addServiceUUID(hid->getHidService()->getUUID());
  adv->setName(DEVICE_NAME);
  adv->setPreferredParams(6, 12);                                // ask for 7.5 to 15 ms between packets
  adv->start();
  searchStart = millis();
}

// Ask the computer for the shortest gap between packets, one step at a time. Windows allows 7.5 ms. Apple's
// rules allow 15 ms, and say 11.25 ms "may be accepted by some devices" for controllers, so if a request is
// ignored we ask for the next one down the list. The 6 s timeout is the shortest Apple accepts.
static void tuneConnection() {
  if (!server) return;
  if (linkUp && !connected) {
    // Normally onAuthenticationComplete tells us the link is encrypted. Check as well, in case a computer
    // that already knows the controller encrypts without that event reaching us.
    static uint32_t lastCheck = 0;
    if (millis() - lastCheck > 300) {
      lastCheck = millis();
      if (server->getPeerInfoByHandle(connHandle).isEncrypted()) { connected = true; forceSend = true; connectedAt = millis(); }
    }
  }
  if (!connected) return;
  static const uint16_t WANT[] = { 6, 9, 12 };                   // 7.5 ms, 11.25 ms, 15 ms (units of 1.25 ms)
  static uint32_t forConn = 0, lastAsk = 0;
  static uint8_t step = 0;
  if (forConn != connectedAt) { forConn = connectedAt; lastAsk = 0; step = 0; }
  if (step >= 3) return;
  if (step > 0 && connInterval != 0 && connInterval <= WANT[step - 1]) { step = 3; return; }   // the last ask worked
  uint32_t now = millis();
  if ((step == 0 && now - connectedAt > 1500) || (step > 0 && now - lastAsk > 4000)) {
    server->updateConnParams(connHandle, WANT[step], WANT[step], 0, 600);
    lastAsk = now;
    step++;
  }
}

// ----------------------------------------------------------------------------------------------- inputs
static void readButtons(uint32_t now) {
  for (uint8_t i = 0; i < BTN_COUNT; i++) {
    if (BTN_PIN[i] < 0) continue;
    bool raw = digitalRead(BTN_PIN[i]) == LOW;
    // The first edge counts at once (no added delay); then that button is ignored for a few milliseconds
    // while the contact settles.
    if (raw != btnState[i] && now - btnChanged[i] >= DEBOUNCE_MS) {
      btnState[i] = raw;
      btnChanged[i] = now;
      lastActivity = now;
    }
  }
}

// One axis as a fraction of its travel: -1 at one end, 0 at the centre, +1 at the other end.
static float axisFraction(float mv, int centre, int lo, int hi) {
  float span = mv >= centre ? (float)(hi - centre) : (float)(centre - lo);
  if (span < 50) span = 50;
  return (mv - centre) / span;
}

static void readStick(Report &r) {
  int rawX = analogReadMilliVolts(PIN_STICK_X);
  int rawY = analogReadMilliVolts(PIN_STICK_Y);
  filtX += (rawX - filtX) * 0.5f;                                // light smoothing: about 2 ms
  filtY += (rawY - filtY) * 0.5f;
  float vx = axisFraction(filtX, cal.cx, cal.minX, cal.maxX);
  float vy = axisFraction(filtY, cal.cy, cal.minY, cal.maxY);

  // The dead zones work on how far the stick is pushed, whatever the direction (a round dead zone). Treating
  // each axis on its own would leave a cross-shaped dead area and make slow diagonal moves snap to the axes.
  float push = sqrtf(vx * vx + vy * vy);
  float out = 0.0f;
  if (push > INNER_DEADZONE) {
    out = (push - INNER_DEADZONE) / (1.0f - INNER_DEADZONE - OUTER_DEADZONE);
    if (out > 1.0f) out = 1.0f;
    if (STICK_CURVE != 1.0f) out = powf(out, STICK_CURVE);
  }
  float k = push > 0.0f ? out / push : 0.0f;
  float fx = vx * k * 32767.0f, fy = vy * k * 32767.0f;
  if (STICK_INVERT_X) fx = -fx;
  if (STICK_INVERT_Y) fy = -fy;
  int16_t x = (int16_t)constrain(fx, -32767.0f, 32767.0f);
  int16_t y = (int16_t)constrain(fy, -32767.0f, 32767.0f);
  if (STICK_SWAP_XY) { int16_t t = x; x = y; y = t; }
  r.x = x;
  r.y = y;
  if (x != 0 || y != 0) {
    // moving the stick counts as activity, holding it still against the edge does not have to
    static int16_t ax = 0, ay = 0;
    if (abs(x - ax) > 2000 || abs(y - ay) > 2000) { ax = x; ay = y; lastActivity = millis(); }
  }
}

static void buildReport(Report &r) {
  r.buttons = 0;
  for (uint8_t i = 0; i < BTN_COUNT; i++) if (btnState[i]) r.buttons |= (uint16_t)(1u << i);
  r.z = 0;
  r.rz = 0;
  r.l2 = btnState[B_L2] ? 255 : 0;
  r.r2 = btnState[B_R2] ? 255 : 0;
  readStick(r);
}

static bool differs(const Report &a, const Report &b) {
  if (a.buttons != b.buttons || a.l2 != b.l2 || a.r2 != b.r2) return true;
  // ignore stick changes too small to matter, so a steady thumb does not flood the radio
  return abs(a.x - b.x) > 96 || abs(a.y - b.y) > 96 || (a.x == 0) != (b.x == 0) || (a.y == 0) != (b.y == 0);
}

static void sendIfChanged() {
  if (!connected || !inputReport) return;
  Report r;
  buildReport(r);
  if (!forceSend && !differs(r, lastSent)) return;
  // One report per radio slot at most: sending faster than the link can carry only builds a queue.
  uint32_t gapUs = (connInterval ? connInterval : 12) * 1250UL;
  uint32_t nowUs = micros();
  if (nowUs - lastSendUs < gapUs) return;
  inputReport->setValue((uint8_t *)&r, sizeof(r));
  inputReport->notify();
  lastSent = r;
  lastSendUs = nowUs;
  forceSend = false;
}

// ----------------------------------------------------------------------------------------------- battery
static uint8_t percentFromMillivolts(int mv) {
  // a single lithium-polymer cell under a light load
  static const int V[] = { 3300, 3500, 3600, 3700, 3750, 3800, 3900, 4000, 4100, 4180 };
  static const int P[] = { 0, 5, 10, 25, 40, 55, 70, 82, 93, 100 };
  if (mv <= V[0]) return 0;
  for (int i = 1; i < 10; i++)
    if (mv <= V[i]) return (uint8_t)(P[i - 1] + (long)(P[i] - P[i - 1]) * (mv - V[i - 1]) / (V[i] - V[i - 1]));
  return 100;
}

static void readBattery(bool first) {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogReadMilliVolts(PIN_BATTERY);
  int mv = (int)(sum / 8) * 2;                                   // the divider halves it
  uint8_t pct = percentFromMillivolts(mv);
  // only ever step down slowly while running, so the number does not jump about with load
  if (first || pct > batteryPct + 5) batteryPct = pct;
  else if (pct < batteryPct) batteryPct--;
  if (hid) hid->setBatteryLevel(batteryPct, connected);
}

// ----------------------------------------------------------------------------------------------- light, sleep
static void showLight(uint32_t now) {
  bool on;
  if (!connected) on = (now % 1000) < 120;                                  // slow blink: searching
  else if (now - connectedAt < 3000) on = true;                             // just connected
  else if (batteryPct < 10) { uint32_t t = now % 4000; on = t < 80 || (t > 200 && t < 280); }
  else on = false;
  digitalWrite(PIN_LED, on ? HIGH : LOW);
}

static void goToSleep() {
  digitalWrite(PIN_LED, LOW);
  digitalWrite(PIN_STICK_PWR, HIGH);                             // stick off
  if (server && linkUp) { server->disconnect(connHandle); delay(200); }
  NimBLEDevice::deinit(true);
  // The PCB has its own pull-up resistors on HOME and START. These lines keep the chip's pull-ups on while
  // it sleeps as well, so a bare dev board on a breadboard does not wake itself up.
  rtc_gpio_pullup_en(GPIO_NUM_5);  rtc_gpio_pulldown_dis(GPIO_NUM_5);
  rtc_gpio_pullup_en(GPIO_NUM_7);  rtc_gpio_pulldown_dis(GPIO_NUM_7);
  esp_sleep_enable_ext1_wakeup(WAKE_PINS, ESP_EXT1_WAKEUP_ANY_LOW);
  esp_deep_sleep_start();                                        // HOME or START restarts the controller
}

// ----------------------------------------------------------------------------------------------- calibration
static void loadCalibration() {
  prefs.begin("stick", true);
  calSaved = prefs.getBool("ok", false);
  if (calSaved) {
    cal.cx = prefs.getInt("cx", cal.cx);     cal.cy = prefs.getInt("cy", cal.cy);
    cal.minX = prefs.getInt("minX", cal.minX); cal.maxX = prefs.getInt("maxX", cal.maxX);
    cal.minY = prefs.getInt("minY", cal.minY); cal.maxY = prefs.getInt("maxY", cal.maxY);
  }
  prefs.end();
}

static void measureCentre(uint32_t ms) {
  long sx = 0, sy = 0, n = 0;
  uint32_t end = millis() + ms;
  while (millis() < end) { sx += analogReadMilliVolts(PIN_STICK_X); sy += analogReadMilliVolts(PIN_STICK_Y); n++; delay(2); }
  if (n) { cal.cx = (int)(sx / n); cal.cy = (int)(sy / n); }
}

static void calibrate() {
  digitalWrite(PIN_LED, HIGH);                                   // solid: hands off the stick
  delay(600);
  measureCentre(2000);
  int minX = cal.cx, maxX = cal.cx, minY = cal.cy, maxY = cal.cy;
  uint32_t end = millis() + 6000;
  while (millis() < end) {                                       // fast blink: roll the stick round the edge
    digitalWrite(PIN_LED, (millis() / 80) % 2 ? HIGH : LOW);
    int x = analogReadMilliVolts(PIN_STICK_X), y = analogReadMilliVolts(PIN_STICK_Y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    delay(2);
  }
  bool good = (cal.cx - minX) > 150 && (maxX - cal.cx) > 150 && (cal.cy - minY) > 150 && (maxY - cal.cy) > 150;
  if (good) {
    cal.minX = minX; cal.maxX = maxX; cal.minY = minY; cal.maxY = maxY;
    prefs.begin("stick", false);
    prefs.putInt("cx", cal.cx);     prefs.putInt("cy", cal.cy);
    prefs.putInt("minX", minX);     prefs.putInt("maxX", maxX);
    prefs.putInt("minY", minY);     prefs.putInt("maxY", maxY);
    prefs.putBool("ok", true);
    prefs.end();
    calSaved = true;
  } else {
    loadCalibration();                                           // the stick was not moved far enough: keep the old one
  }
  for (int i = 0; i < (good ? 3 : 8); i++) {                     // 3 slow blinks = saved, 8 quick = not saved
    digitalWrite(PIN_LED, HIGH); delay(good ? 250 : 60);
    digitalWrite(PIN_LED, LOW);  delay(good ? 250 : 60);
  }
  filtX = cal.cx;
  filtY = cal.cy;
  lastActivity = millis();
}

// Long presses: HOME 5 s = forget pairings; START + SELECT 3 s = calibrate.
static void checkLongPresses(uint32_t now) {
  static uint32_t homeSince = 0, comboSince = 0;
  if (btnState[B_HOME]) {
    if (!homeSince) homeSince = now;
    else if (now - homeSince > 5000) {
      homeSince = 0;
      if (server && linkUp) server->disconnect(connHandle);
      NimBLEDevice::deleteAllBonds();
      for (int i = 0; i < 6; i++) { digitalWrite(PIN_LED, HIGH); delay(60); digitalWrite(PIN_LED, LOW); delay(60); }
      NimBLEDevice::startAdvertising();
      searchStart = millis();
      btnState[B_HOME] = false;
    }
  } else homeSince = 0;

  if (btnState[B_START] && btnState[B_SELECT]) {
    if (!comboSince) comboSince = now;
    else if (now - comboSince > 3000) { comboSince = 0; calibrate(); }
  } else comboSince = 0;
}

// ----------------------------------------------------------------------------------------------- Arduino
void setup() {
  Serial.begin(115200);
  setCpuFrequencyMhz(80);

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);
  pinMode(PIN_STICK_PWR, OUTPUT);
  digitalWrite(PIN_STICK_PWR, LOW);                              // stick on
  for (uint8_t i = 0; i < BTN_COUNT; i++) if (BTN_PIN[i] >= 0) pinMode(BTN_PIN[i], INPUT_PULLUP);

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_STICK_X, ADC_11db);                // full 0 to 3.3 V range
  analogSetPinAttenuation(PIN_STICK_Y, ADC_11db);
  analogSetPinAttenuation(PIN_BATTERY, ADC_11db);
  delay(30);                                                     // let the stick's sensors settle

  loadCalibration();
  if (!calSaved) measureCentre(200);                             // first ever start: take the centre as it is now
  filtX = cal.cx;
  filtY = cal.cy;

  readBattery(true);
  startBluetooth();
  lastActivity = millis();
  Serial.printf("Daedalus ready. Stick centre %d, %d mV. Battery %u %%.\n", cal.cx, cal.cy, batteryPct);
}

void loop() {
  uint32_t now = millis();
  static uint32_t lastBattery = 0, lastPrint = 0;

  readButtons(now);
  checkLongPresses(now);
  sendIfChanged();
  tuneConnection();
  showLight(now);

  if (now - lastBattery > 10000) { lastBattery = now; readBattery(false); }

  if (connected) searchStart = now;
  if (now - lastActivity > IDLE_SLEEP_MS) goToSleep();
  if (!connected && now - searchStart > SEARCH_SLEEP_MS) goToSleep();

  // With the USB cable in and the Serial Monitor open, this prints what the controller sees twice a second:
  // useful when checking a freshly soldered board.
  if (Serial && now - lastPrint > 500) {
    lastPrint = now;
    Report r;
    buildReport(r);
    Serial.printf("buttons %04X  x %6d  y %6d  raw %4d %4d mV  battery %3u %%  %s  gap %u.%02u ms\n",
                  r.buttons, r.x, r.y, (int)filtX, (int)filtY, batteryPct,
                  connected ? "connected" : "searching",
                  (unsigned)(connInterval * 125 / 100), (unsigned)(connInterval * 125 % 100));
  }

  delay(1);                                                      // about a thousand passes a second
}
