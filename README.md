# 티끌모아 (moneybook)

여러 휴대폰에서 같이 쓰는 개인 가계부 웹앱입니다.

- 앱 주소: https://taichen2k.github.io/moneybook/
- 데이터는 구글 **Firebase**(Firestore, 서울 리전) 프로젝트 `moneybook-926a4`의 `books/main` 아래에 저장됩니다.
  - `ledger/settings` 설정 · 분류 · 계좌 · 예산 · 반복 내역
  - `tx_YYYY-MM` 월별 내역 (한 건이 문서 하나)
  - `memo/YYYY-MM` 월 메모
- 구글 계정으로 로그인합니다. 보안 규칙에 등록된 계정(현재 taichen2k@gmail.com)만 읽고 쓸 수 있습니다.
- 백업: 더보기 → 계정·동기화·백업에서 전체 장부를 JSON 파일로 받고, 그 파일로 되돌릴 수 있습니다.
- 입력하면 다른 기기에 바로 나타납니다. 인터넷이 끊겨도 기기에 먼저 저장하고 연결되면 보냅니다.

© 2026 티제이컴퍼니. All rights reserved.

## 같은 주소의 다른 앱과 충돌하지 않게
- 저장공간 이름은 모두 `moneybook.`으로 시작하고, 서비스워커는 `moneybook-`으로 시작하는 캐시만 지웁니다.
- 서비스워커 범위는 `/moneybook/` 안쪽만이라 할수있어(`/candoit/`)·정수리 Cam(`/directcam/`)을 건드리지 않습니다.
- 데이터는 Firebase에만 쓰므로 할수있어의 `candoit-backup`과 겹치지 않습니다.

## 가족 계정 추가하는 법
Firebase 콘솔 → Firestore Database → 규칙에서 `['taichen2k@gmail.com']` 목록에 가족 이메일을 쉼표로 추가하고 게시합니다.
