// 메아리 — 디스코드 Rich Presence 단독 테스트
//
// 유튜브뮤직 없이, 가짜 곡 하나를 디스코드에 띄워서
// Client ID / 디스코드 연결이 제대로 되는지만 빠르게 확인하는 스크립트.
//
// 사용법:
//   node test/presence-test.mjs <DISCORD_CLIENT_ID>
//   또는
//   DISCORD_CLIENT_ID=12345 node test/presence-test.mjs
//   또는 npm:
//   npm run test:presence -- <DISCORD_CLIENT_ID>
//
// 준비:
//   - 디스코드 데스크탑 클라이언트가 켜져 있어야 함
//   - 사용자설정 → 활동 개인정보 → "현재 활동을 상태 메세지로 표시" 켜기

import { Client } from '@xhayper/discord-rpc';

const clientId = process.argv[2] || process.env.DISCORD_CLIENT_ID;

if (!clientId || clientId === 'YOUR_DISCORD_CLIENT_ID') {
  console.error('✗ Client ID 가 없어.');
  console.error('  사용법: node test/presence-test.mjs <DISCORD_CLIENT_ID>');
  console.error('  또는:   DISCORD_CLIENT_ID=...  npm run test:presence');
  process.exit(1);
}

const client = new Client({ clientId });

client.on('ready', async () => {
  console.log(`✓ 디스코드 연결됨: ${client.user?.username ?? '(이름 모름)'}`);

  const now = Date.now();
  const durationSec = 200; // 가짜 곡 길이 3분 20초

  try {
    await client.user?.setActivity({
      type: 2, // Listening (디스코드 판본에 따라 Playing 으로 보일 수 있음 — 정상)
      details: '테스트 곡 — 메아리',
      state: '테스트 가수',
      largeImageKey: 'logo', // 디스코드 Art Assets 에 올린 'logo' 키 (없으면 빈칸)
      largeImageText: '테스트 앨범',
      smallImageKey: 'logo',
      startTimestamp: now,
      endTimestamp: now + durationSec * 1000,
    });
    console.log('✓ 가짜 활동을 띄웠어. 디스코드 프로필에서 진행띠가 도는지 확인해봐.');
    console.log('  (이미지가 안 뜨면 개발자포털 Art Assets 에 키 이름 "logo" 로 이미지를 올렸는지 확인)');
    console.log('  종료하려면 Ctrl+C.');
  } catch (e) {
    console.error('✗ setActivity 실패:', e?.message ?? e);
    process.exit(1);
  }
});

client.login().catch((e) => {
  console.error('✗ 디스코드 연결 실패 — 디스코드 데스크탑이 켜져 있는지 확인해.');
  console.error('  ', e?.message ?? e);
  process.exit(1);
});

// Ctrl+C 로 깔끔하게 종료
process.on('SIGINT', async () => {
  try { await client.user?.clearActivity(); } catch { /* 무시 */ }
  console.log('\n활동 지우고 종료.');
  process.exit(0);
});
