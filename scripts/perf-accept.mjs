/* global console, process */
import { spawnSync } from "node:child_process";

const durationMs = process.env.PERF_DURATION_MS ?? "60000";
const sharedEnvironment = {
  ...process.env,
  PERF_DURATION_MS: durationMs,
  PERF_ENFORCE: "1",
  PERF_REFRESH_HZ: "60",
  PERF_REQUIRE_EXPECTED_CADENCE: "1",
};

const scenarios = [
  { name: "short-dpr1-left", dpr: "1", scenario: "short", direction: "left" },
  { name: "large-dpr2-right", dpr: "2", scenario: "large", direction: "right" },
  { name: "max-dpr3-left", dpr: "3", scenario: "max", direction: "left" },
  { name: "whitespace-dpr3-right", dpr: "3", scenario: "whitespace", direction: "right" },
  { name: "emoji-dpr2-up", dpr: "2", scenario: "emoji", direction: "up" },
  { name: "flash-dpr1-down", dpr: "1", scenario: "short", direction: "down", flash: "1" },
];

for (const scenario of scenarios) {
  console.log(`\n[perf:accept] ${scenario.name}`);
  const result = spawnSync(
    process.execPath,
    ["scripts/perf-smoke.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...sharedEnvironment,
        PERF_DIRECTION: scenario.direction,
        PERF_DPR: scenario.dpr,
        PERF_FLASH: scenario.flash ?? "0",
        PERF_SCENARIO: scenario.scenario,
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(
    "\n[perf:accept] 60Hz production matrix passed. " +
      "Validate 120Hz/ProMotion on a real 120Hz device; headless Chromium cannot emulate it.",
  );
}
