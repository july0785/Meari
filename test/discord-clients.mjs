// 메아리 — 실행 중인 디스코드 클라이언트 목록
//
// 디스코드가 여러 개(안정판·PTB·Canary) 켜져 있으면 IPC 파이프(discord-ipc-N)가 여러 개 생기고,
// 각 파이프가 어느 빌드·어느 계정인지에 따라 활동이 어디에 표시되는지가 달라진다.
// 이 스크립트는 파이프마다 핸드셰이크만 해서(활동은 보내지 않음) 빌드와 계정 이름을 보여 준다.
//
// 사용법:
//   node test/discord-clients.mjs
//
// 결과를 보고 config.json 의 "discordTarget" 을 정하면 된다:
//   "auto"(기본: 안정판 우선) | "all" | "stable" | "ptb" | "canary" | 계정 이름

import net from 'node:net';

const CLIENT_ID = '1521567362812481658';

function probe(i) {
  return new Promise((resolve) => {
    const path = process.platform === 'win32'
      ? `\\\\?\\pipe\\discord-ipc-${i}`
      : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${i}`;
    let buf = Buffer.alloc(0);
    let done = false;
    const sock = net.connect(path);
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(r); };
    const timer = setTimeout(() => finish(null), 2000);
    sock.on('connect', () => {
      const json = Buffer.from(JSON.stringify({ v: 1, client_id: CLIENT_ID }));
      const head = Buffer.alloc(8);
      head.writeInt32LE(0, 0);
      head.writeInt32LE(json.length, 4);
      sock.write(Buffer.concat([head, json]));
    });
    sock.on('error', () => finish(null));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 8) return;
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) return;
      try {
        const msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'));
        if (msg?.evt === 'READY') {
          finish({ endpoint: msg.data?.config?.api_endpoint ?? '?', username: msg.data?.user?.username ?? '?' });
          return;
        }
      } catch { /* 무시 */ }
      finish(null);
    });
  });
}

const build = (ep) => (ep.includes('canary') ? 'Canary' : ep.includes('ptb') ? 'PTB' : '안정판');

const results = await Promise.all(Array.from({ length: 10 }, (_, i) => probe(i)));
const found = results.map((r, i) => (r ? { i, ...r } : null)).filter(Boolean);

if (found.length === 0) {
  console.log('실행 중인 디스코드 클라이언트를 찾지 못했어. 디스코드 데스크톱이 켜져 있는지 확인해.');
} else {
  console.log(`실행 중인 디스코드 클라이언트 ${found.length}개:\n`);
  for (const f of found) {
    console.log(`  discord-ipc-${f.i}  ${build(f.endpoint).padEnd(5)}  계정: ${f.username}   (${f.endpoint})`);
  }
  console.log('\n메아리 기본(discordTarget: "auto")은 안정판 > PTB > Canary 순으로 하나에만 표시해.');
  console.log('다른 쪽을 원하면 config.json 에 "discordTarget": "계정이름" 또는 "ptb" 등으로 지정.');
}
