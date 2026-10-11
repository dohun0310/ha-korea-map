# HA 기본 지도 NAVER/Google 자동 전환 — 운영 설치 안내

> 상태: 격리 lab(HA 2026.10.1, frontend 20260930.3)에서 Node/Python 테스트와 HTTP 배포까지 확인했습니다. 실제 브라우저 화면 검증은 lab 기준입니다. 운영 HA 에는 아무것도 적용·접속하지 않았습니다. 아래 단계는 사용자가 직접 수행합니다.

## 무엇을 하는가

- `/map` 대시보드(`url_path: map`)의 지도 카드에서만 동작합니다. 다른 대시보드, 구역 편집기, 카드 편집 미리보기는 HA 원본 지도를 그대로 씁니다.
- **자동** 모드: 지도 중심이 대한민국 경계(근사, 12해리 버퍼) 안이면 NAVER, 밖이면 Google. 전체 보기(fitBounds) 대상이 한국·해외 혼합이면 Google.
  - 이동 후 600ms 동안 카메라가 멈춰 있어야 판정합니다(디바운스). 전환 사이 최소 간격은 2.5초이고, 전환 중에는 새 전환을 시작하지 않습니다.
  - 전환할 때 중심, 줌, 마커, 원, 경로를 그대로 유지합니다.
- 항상 자동으로만 동작합니다. 지도 위에 선택 칸, 상태 표시, 확대·축소 버튼을 띄우지 않습니다. 확대·축소는 손가락, 마우스 휠, 더블클릭으로 합니다.
- 실패 시 동작:
  - SDK 로딩·인증이 실패하면 HA 원본 지도로 돌아가고 **안전 모드**로 표시됩니다. 그 페이지에서는 원본 지도를 계속 쓰고, 새로고침하면 다시 시도합니다.
  - 경계 파일을 불러오지 못하면 자동 전환을 끄고 현재 지도를 유지합니다.
  - HA 버전이나 frontend 빌드가 pin 과 다르면 아무것도 바꾸지 않고 원본 지도를 씁니다.

## 0. 사전 확인 (버전 pin)

1. 설정 → 정보에서 Core 가 `2026.10.1`, Frontend 가 `20260930.3` 인지 확인합니다.
2. 운영 HA HTML 의 entrypoint 해시가 pin 과 같은지 확인합니다.
   ```sh
   curl -s http://<운영HA>:8123/ | grep -oE '/frontend_latest/(core|app)\.[0-9a-f]+\.js' | sort -u
   # pin: /frontend_latest/core.ecb6c9be4886db2c.js, /frontend_latest/app.6234b2ff06eb162a.js
   ```
   다르면 확장은 설치되지 않고 원본 지도가 유지됩니다. 아래 'HA 업데이트 시' 절차를 따르세요.

## 1. API 키 준비와 제한

키는 브라우저에 공개되는 공개 키입니다. 반드시 웹 사이트 제한을 거세요.

- **NAVER Cloud Platform Maps**: Application 을 등록하고 Dynamic Map(Web) 을 사용하도록 설정합니다. **Web 서비스 URL** 에 실제로 HA 에 접속하는 origin 만 등록합니다(예: `http://homeassistant.local:8123`, 외부 도메인). `NAVER_MAP_KEY_ID` 에는 Client ID(ncpKeyId)를 넣습니다.
- **Google Maps Platform**: Maps JavaScript API 를 활성화하고 결제 계정을 연결합니다.
  - Application restriction 은 **웹사이트(HTTP 리퍼러)**, 값은 실제 HA origin(`https://ha.example.com/*` 등)으로 설정합니다.
  - API restriction 은 **Maps JavaScript API 만** 허용합니다. 빠지면 `ApiTargetBlockedMapError` 가 나고 원본 지도로 복구됩니다(lab 에서 실측).
  - 예산 알림과 할당량 상한을 설정하세요.
- 서버용 키나 제한 없는 키는 넣지 마세요. HA 토큰은 SDK 로 전달되지 않습니다.

## 2. 파일 복사

`dist/ha-korea-map/` 의 파일을 운영 HA 의 `/config/www/ha-korea-map/` 에 복사합니다. 메인 진입 모듈은 `ha-korea-map.js` 입니다(HACS Dashboard 규칙: 저장소 이름과 같은 JS 파일).

```
ha-korea-map.js  ha-map-extension.mjs  ha-map-router.mjs  ha-map-sdk.mjs
ha-map-controls.mjs   ha-map-auto.mjs       ha-map-korea-boundary.geojson  ATTRIBUTION.md
```

`dist/SHA256SUMS` 로 무결성을 확인합니다(`cd dist && sha256sum -c SHA256SUMS`). `/config/www` 를 이번에 새로 만들었다면 HA 를 재시작해야 `/local/` 이 열립니다.

## 3. 키 설정 파일 생성 (키는 이 파일에만 들어감)

어떤 기기에서 실행하든, 0600 권한의 키 파일을 만듭니다. 이 파일은 공유하지 마세요.

```
NAVER_MAP_KEY_ID=...
GOOGLE_MAPS_API_KEY=...
```

그다음 생성기를 실행합니다.

```sh
python3 dist/generate-provider-config.py --provider auto --opt-in \
  --keys /안전한/경로/provider-keys.env \
  --output /config/www/ha-korea-map/ha-map-config.mjs \
  --boundary-url /local/ha-korea-map/ha-map-korea-boundary.geojson \
  --boundary-file /config/www/ha-korea-map/ha-map-korea-boundary.geojson
```

- `--provider auto` 를 쓰려면 두 키가 모두 필요합니다. `--opt-in` 은 위치 전송과 과금 가능성에 동의한다는 뜻입니다.
- 한 가지만 쓰려면 `--provider naver` 또는 `--provider google`, 비활성화하려면 `--provider native` 를 씁니다.
- 생성된 `ha-map-config.mjs` 에는 공개 키가 들어 있습니다. Git 이나 백업 공유에서 제외하세요.

## 4. HA 등록

`configuration.yaml`:

```yaml
frontend:
  extra_module_url:
    - /local/ha-korea-map/ha-korea-map.js?v=auto-4
```

HA 를 재시작합니다. `extra_module_url` 은 재시작해야 반영됩니다.

## 5. 지도 대시보드 설정

지도 카드에는 따로 넣을 설정이 없습니다. 카드의 그룹화 버튼을 켜거나 꺼도 NAVER·Google 지도를 유지합니다. 지금은 제공자 지도에서 그룹 아이콘을 그리지 않고 마커를 하나씩 표시합니다.

## 6. 새로고침과 확인

- 브라우저에서 캐시를 무시하고 새로고침합니다(Ctrl+Shift+R / Cmd+Shift+R). 모바일 Companion 앱은 설정 → Companion app → 디버깅 → 프론트엔드 캐시 초기화 후 다시 엽니다.
- 개발자 콘솔에서 확인합니다.
  ```js
  await haMapExtensionReady            // installed: true 여야 함
  haMapExtension.diagnostics()         // routers[0].provider / auto / decision / decisionReason / control.text
  ```

## 파일 업데이트

모듈을 바꿀 때는 `ha-korea-map.js` 안의 import 쿼리(`?v=auto-4`)와 `ha-map-extension.mjs` 의 import 쿼리를 함께 올립니다. 그러면 `extra_module_url` 을 바꾸지 않아도 되고, 재시작 없이 캐시 무시 새로고침만으로 반영됩니다. 쿼리를 올리지 않으면 이전 모듈이 캐시에 남을 수 있습니다.

## 롤백

| 방법 | 재시작 | 효과 |
|---|---|---|
| `generate-provider-config.py --provider native --output /config/www/ha-korea-map/ha-map-config.mjs` 후 캐시 무시 새로고침 | 불필요 | SDK 를 요청하지 않고 원본 지도 사용 |
| 콘솔에서 `haMapExtension.uninstall()` | 불필요 | 현재 탭에서만 원래 factory 복원(새로고침하면 다시 설치됨) |
| `configuration.yaml` 에서 `extra_module_url` 항목 삭제 후 재시작, `/config/www/ha-korea-map/` 삭제 | 필요 | 완전 제거 |

## HA 업데이트 시 (pin 불일치)

HA 를 업데이트하면 Core·frontend 버전이나 entrypoint 해시가 바뀝니다. 확장은 이를 감지하면 **설치하지 않고 원본 지도를 그대로 둡니다**(fail-closed). 지도는 정상이지만 NAVER/Google 은 나오지 않습니다. 다시 쓰려면 다음 순서를 따릅니다.

1. 격리 lab 을 새 버전으로 올리고 `ha-map.ts` 의 `_createEngine`·MapEngine 계약이 바뀌었는지 확인합니다. 비공개 API 라 바뀔 수 있습니다.
2. lab 컨테이너 frontend manifest 와 `/map/0` HTML 에서 새 entrypoint(`core.*.js`, `app.*.js`)를 확인합니다.
3. 다음 위치의 버전 값을 갱신합니다.
   - `generate-provider-config.py` 의 `PIN`(coreVersion, frontendVersion, entrypoints)
   - `ha-map-extension.mjs` 의 `installHook`·`startAutoHook` 안에 하드코딩된 `'2026.10.1'`/`'20260930.3'`
4. Node/Python 테스트와 lab 브라우저 검증을 통과시킵니다.
5. 모듈 `?v=` 를 올려 dist 를 다시 빌드(`tools/build_dist.py`)하고 설정을 재생성합니다.

검증 전에 버전 값만 바꾸는 것은 권장하지 않습니다.

## 경계 데이터 출처·라이선스 (표기 의무)

`ha-map-korea-boundary.geojson` 은 공개 데이터를 가공한 근사치로, 법적 경계가 아닙니다. 웹에서 이 파일을 배포하는 셈이므로 `ATTRIBUTION.md` 를 함께 두고 다음 출처를 표기합니다.

- geoBoundaries gbOpen (commit 9469f09). KOR·CHN 은 Public Domain 입니다.
- **PRK: World Food Programme, OCHA ROAP — CC BY 3.0 IGO.** 출처 표기와 변경 사실 고지가 의무입니다.
- **JPN: 일본 국토교통성 国土数値情報 — CC BY 4.0.** 출처 표기와 변경 사실 고지가 의무입니다.
- Natural Earth v5.1.2 disputed areas (Public Domain): 독도, NLL 이남 도서.
- 변경 내용: bbox 자르기, 단순화, 12해리 버퍼, 근사 등거리선, 외국 육지 제거.

## 약관·과금 (미해결 사항)

- **Google Maps Platform 약관 3.2.3(e)**(Google 이 아닌 지도와 함께 또는 가까이에서 Google Maps 핵심 서비스 사용 금지 취지)가 같은 화면에서 NAVER 와 Google 을 전환하는 이 구성에 적용되는지는 **확인되지 않았습니다**. 법률 검토나 Google 확인 없이 적합하다고 볼 수 없습니다. 가정 내 사적 사용이라도 약관 위반 위험이 있습니다.
- NAVER Maps 이용약관의 타사 지도 병행 조건도 별도로 확인하세요.
- **과금**: Google Maps JavaScript API 는 지도 로드 단위로 과금될 수 있습니다. 자동 전환은 엔진을 바꿀 때마다 새 지도 인스턴스를 로드하므로 사용량이 늘 수 있습니다. 무료 사용량이나 비용 상한은 보장되지 않으니 예산 알림을 설정하세요. NAVER Cloud Maps 도 사용량 기준 요금이 적용될 수 있습니다.
- SDK 를 쓰면 지도 중심과 오버레이 좌표가 각 제공자 서버로 전송됩니다(타일 요청).

## 알려진 한계

- 경계는 근사치입니다. 대한해협, 서해 NLL, 한강 하구 근처에서는 수 km 오차가 있을 수 있습니다.
- 판정은 지도 중심점 기준입니다. 경계 근처를 패닝하면 전환이 일어날 수 있습니다(디바운스와 최소 간격으로 완화).
- NAVER 지도는 SDK 자체가 한국 범위(대략 위도 32.1~38.6, 경도 124.3~132.0)와 최소 줌 6으로 고정되어 있습니다. 그래서 NAVER 지도에서 손으로 끌어서 해외로 나갈 수는 없습니다. HA 의 자동 맞춤이나 `setView`·`panTo`·`fitBounds` 처럼 목적지가 정해진 이동은 목적지 기준으로 판정해 Google 로 전환합니다. 해외를 직접 둘러보려면 선택 칸에서 Google 을 고르세요.
- 다크 모드에서 Google 지도는 공식 colorScheme(DARK)을, NAVER 지도는 타일 층에만 HA와 같은 색 반전 필터(공식 스타일이 아님)를 씁니다. 그룹화를 켜도 제공자 지도에서는 마커를 하나씩 표시합니다.
- 첫 마운트가 훅 설치보다 빠를 수 있습니다(콜드 로드). 그때는 원본 지도가 보이고, 다시 들어오면 적용됩니다.
