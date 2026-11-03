// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 함박종합사회복지관 마음안심 팀
// 마음안심 서버 설정 — 가져다 쓰는 기관이 자기 서버 주소를 넣는 곳입니다.
// 비워 두면: 받아쓰기는 브라우저(크롬) 음성인식으로 동작하고, 동료 연결은 '알림 서버 미설정'으로 안내합니다.
window.MA_CONFIG = {
  // 음성인식 중계 서버(CLOVA Speech 연결) 주소. 예: 'wss://stt.example.org/stt'
  // 이 저장소에는 중계 서버가 들어 있지 않습니다. 없으면 비워 두세요.
  sttRelayUrl: '',
  // 알림 중계(ntfy) 서버 주소. 예: 'https://ntfy.example.org'
  // 실제 상담에는 접근 제어(토큰)를 켠 기관 자체 ntfy 서버를 쓰세요.
  // 공개 서버 'https://ntfy.sh'는 시연 전용입니다(채널 이름을 아는 사람은 누구나 읽고 보낼 수 있고, 12시간 보관됨).
  ntfyServer: '',
  // 알림 채널 이름 앞에 붙는 글자. 다른 기관과 겹치지 않게 기관 고유 값으로 바꾸세요.
  topicPrefix: 'maeum-anshim-'
};
