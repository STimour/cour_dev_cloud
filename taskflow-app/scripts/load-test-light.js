// TP Scaling — k6 load test script
// Documentation: https://k6.io/docs/
//
// Usage:
//   k6 run scripts/load-test.js -- Play the scenario with options defined in the script
//   k6 run --vus 50 --duration 60s scripts/load-test.js -- Override options from the command line
//
// During execution, watch Grafana and see the metrics rise in real time.

import http from 'k6/http';
import { sleep, check } from 'k6';

// Light load scenario
export const options = {
  vus: 5,          // 5 utilisateurs virtuels simultanés
  duration: '30s', // pendant 30 secondes
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3004';

// Test token — replace with a real token after login
let token = __ENV.TOKEN || '';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  // GET /api/tasks — main load is on task-service, but it also exercises the gateway
  const tasksRes = http.get(`${BASE_URL}/api/tasks`, { headers });
  check(tasksRes, {
    'tasks status 200': (r) => r.status === 200,
    'tasks response < 200ms': (r) => r.timings.duration < 200,
  });

  sleep(1);
}
