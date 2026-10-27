# 티끌모아 (moneybook)

여러 휴대폰에서 같이 쓰는 개인 가계부 웹앱입니다.

- 앱 주소: https://taichen2k.github.io/moneybook/
- 데이터는 깃허브 **비공개** 저장소 `taichen2k/moneybook-backup`의 `data/` 폴더에 저장됩니다.
  - `ledger.json` 설정 · 분류 · 계좌 · 예산 · 반복 내역
  - `tx_YYYY-MM.json` 월별 내역
  - `memo.json` 월 메모
- 접근 토큰은 각 기기에만 저장되고 이 저장소에는 올라오지 않습니다. 「할수있어」 토큰에 moneybook-backup 저장소도 허용해 두면 그 토큰을 그대로 쓸 수 있습니다.
- 하루 백업: 하루 한 번 앱을 열 때 `backups/YYYY-MM-DD.json`에 전체 장부를 저장하고 최근 7일치를 보관합니다. 더보기 → 동기화 연결에서 되돌릴 수 있습니다.
- 폰들은 20초마다, 그리고 앱을 열 때마다 서로 맞춥니다. 두 폰에서 같은 내역을 고치면 나중에 고친 쪽이 남습니다.

© 2026 티제이컴퍼니. All rights reserved.

## 같은 주소의 다른 앱과 충돌하지 않게
- 저장공간 이름은 모두 `moneybook.`으로 시작하고, 서비스워커는 `moneybook-`으로 시작하는 캐시만 지웁니다.
- 서비스워커 범위는 `/moneybook/` 안쪽만이라 할수있어(`/candoit/`)·정수리 Cam(`/directcam/`)을 건드리지 않습니다.
- 데이터는 가계부 전용 저장소 `moneybook-backup`에만 쓰므로 할수있어의 `candoit-backup`과 겹치지 않습니다.
