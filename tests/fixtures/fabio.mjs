#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FABIO_TEST_CALLS, `${JSON.stringify(args)}\n`);

if (args[0] === '--version') {
  console.log(process.env.FABIO_TEST_VERSION ?? 'fabio 0.79.0');
  process.exit(0);
}

const scenario = process.env.FABIO_TEST_SCENARIO;
const id = '00000000-0000-0000-0000-000000000000';
console.error('[timing] mock command');

if (args[0] === 'auth' && args[1] === 'status') {
  if (scenario === 'unauthenticated') process.exit(1);
  console.log('{"authenticated":true}');
} else if (args[0] === 'workspace' && args[1] === 'show') {
  if (scenario === 'forbidden' || scenario === 'not-found') {
    console.error(scenario === 'forbidden' ? 'HTTP 403 Forbidden' : 'HTTP 404 Not Found');
    process.exit(1);
  }
  if (scenario === 'empty-id') process.exit(0);
  if (scenario === 'null-id') {
    console.log('null');
    process.exit(0);
  }
  console.log(`\r\n${id}\r\n`);
} else if (args[1] === 'list') {
  if (scenario === 'list-error') {
    console.error('HTTP 403 Forbidden');
    process.exit(1);
  }
  if (scenario === 'existing') console.log(id);
  else if (scenario === 'null-name') console.log('null');
  else console.log(' \r\n');
} else if (args[1] === 'create') {
  if (scenario !== 'empty-create') console.log(id);
} else {
  console.error(`Unexpected mock command: ${args.join(' ')}`);
  process.exit(1);
}
