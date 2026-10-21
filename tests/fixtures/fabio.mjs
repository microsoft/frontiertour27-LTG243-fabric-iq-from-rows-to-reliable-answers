#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

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
  if (scenario === 'existing' || /^(?:framing-|agent-query-error|evaluation-error)/.test(scenario)) console.log(id);
  else if (scenario === 'null-name') console.log('null');
  else console.log(' \r\n');
} else if (args[1] === 'create') {
  if (scenario !== 'empty-create') console.log(id);
} else if (args[0] === 'lakehouse' && args[1] === 'show') {
  if (scenario === 'schema-read-error') {
    console.error('Lakehouse metadata is unavailable.');
    process.exit(1);
  }
  console.log(scenario === 'enabled-schema' ? 'dbo' : 'null');
} else if (args[0] === 'lakehouse' && args[1] === 'list-tables') {
  const calls = readFileSync(process.env.FABIO_TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse);
  const attempts = calls.filter(call => call[0] === 'lakehouse' && call[1] === 'list-tables').length;
  if (scenario === 'metadata-lag' && attempts > 1) console.log('dash_campaign_performance');
} else if (args[0] === 'ontology' && args[1] === 'mcp-url') {
  console.log('https://example.invalid/ontology');
} else if (args[0] === 'ontology' && args[1] === 'search') {
  const calls = readFileSync(process.env.FABIO_TEST_CALLS, 'utf8').trim().split('\n').map(JSON.parse);
  const attempts = calls.filter(call => call[0] === 'ontology' && call[1] === 'search').length;
  if (scenario === 'graph-not-ready' || (scenario === 'graph-lag' && attempts === 1)) {
    console.error('The Graph Model is not ready. Please try again later.');
    process.exit(1);
  }
  if (scenario === 'graph-failure') {
    console.error('HTTP 403 Forbidden');
    process.exit(1);
  }
  console.log('Four affected regions.');
} else if (args[0] === 'ontology' && args[1] === 'list-entity-types') {
  console.log('26');
} else if (args[0] === 'data-agent' && args[1] === 'query') {
  if (scenario === 'agent-query-error') {
    console.error('Published agent could not be queried.');
    process.exit(1);
  }
  console.log('The ENSO signal affects four regions.');
} else if (args[0] === 'data-agent' && args[1] === 'evaluate') {
  if (scenario === 'evaluation-error') {
    console.error('Evaluation service unavailable.');
    process.exit(1);
  }
  console.log('Evaluation report.');
} else if (args[0] === 'semantic-model' && args[1] === 'query' && !args.some(arg => arg.includes('COUNTROWS'))) {
  console.log('ok');
} else if (args[1] === 'query' && ['semantic-model', 'lakehouse'].includes(args[0])) {
  if (scenario === 'framing-error') {
    console.error('Row-count query unavailable.');
    process.exit(1);
  }
  if (scenario === 'framing-null' && args[0] === 'lakehouse') process.exit(0);
  console.log(scenario === 'framing-stale' ? '0' : '2');
} else {
  console.error(`Unexpected mock command: ${args.join(' ')}`);
  process.exit(1);
}
