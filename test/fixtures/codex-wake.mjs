import { createInterface } from 'node:readline';
const mode = process.argv[2];
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  const { id, method, params } = request;
  if (!method || id === undefined) return;
  if (method === 'initialize') return send({ id, result: {} });
  if (method === 'thread/resume' || method === 'thread/read') return send({ id, result: { thread: { id: params.threadId, cwd: mode === 'wrong-cwd' ? '/' : process.cwd(), status: { type: mode === 'busy' ? 'active' : 'idle' } } } });
  if (method === 'turn/interrupt') return send({ id, result: {} });
  if (method !== 'turn/start') return;
  const turn = { id: 'turn-1', status: 'completed' };
  if (mode === 'approval') {
    send({ id, result: { turn } });
    return send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: params.threadId, turnId: turn.id } });
  }
  if (mode === 'hang') return send({ id, result: { turn } });
  // Exercise completion notifications arriving before the request response.
  send({ method: 'item/completed', params: { threadId: 'unrelated', turnId: turn.id, item: { type: 'agentMessage', text: 'WRONG' } } });
  send({ method: 'item/completed', params: { threadId: params.threadId, turnId: turn.id, item: { type: 'agentMessage', text: 'Handled test message.' } } });
  send({ method: 'turn/completed', params: { threadId: params.threadId, turn: { ...turn, status: mode === 'failed' ? 'failed' : 'completed' } } });
  send({ id, result: { turn } });
});
