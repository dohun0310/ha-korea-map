# 설치 안내

이 문서는 ha-korea-map을 운영 중인 Home Assistant(HA)에 설치하는 방법을 설명합니다. 설치 방법은 HACS로 설치하는 방법과 파일을 직접 복사하는 방법이 있습니다.

> 검증 범위: 격리된 테스트용 HA(Core 2026.10.1, Frontend 20260930.3)에서 Node·Python 테스트와 HTTP 배포를 확인했습니다. 브라우저 화면 검증도 이 테스트용 HA에서만 진행했습니다. HACS를 통한 실제 설치는 아직 확인하지 않았으며, 아래 HACS 절차는 HACS 공식 문서와 HACS 소스 코드를 근거로 작성했습니다.

## 동작 방식

- `/map` 대시보드(`url_path: map`)에 있는 지도 카드에서만 동작합니다. 다른 대시보드와 구역 편집기, 카드 편집 미리보기에서는 HA 원래 지도를 그대로 사용합니다.
- 지도 중심이 대한민국 경계 안에 있으면 NAVER 지도를, 밖에 있으면 Google 지도를 사용합니다. 전체 보기(fitBounds) 대상에 한국과 해외 위치가 함께 있으면 Google 지도를 사용합니다. 경계는 12해리 버퍼를 포함한 근사치입니다.
  - 지도를 움직인 뒤 600ms 동안 카메라가 멈춰 있어야 판정합니다. 전환 사이에는 최소 2.5초 간격을 두고, 전환하는 도중에는 새 전환을 시작하지 않습니다.
  - 전환할 때 중심, 줌, 마커, 원, 경로를 그대로 유지합니다.
- 지도 위에는 선택 칸이나 상태 표시, 확대·축소 버튼을 표시하지 않습니다. 확대와 축소는 손가락, 마우스 휠, 더블클릭으로 조작합니다.
- 카드에 있는 그룹화 버튼을 켜거나 꺼도 NAVER·Google 지도를 유지합니다. 현재 버전에서는 제공자 지도에 그룹 아이콘을 그리지 않고 마커를 하나씩 표시합니다.
- HA가 다크 모드이면 제공자 지도도 어둡게 표시합니다. 자세한 내용은 [다크 모드](#다크-모드)에 정리했습니다.
- 문제가 생겼을 때는 다음과 같이 동작합니다.
  - SDK를 불러오지 못하거나 인증에 실패하면 HA 원래 지도로 돌아가고 안전 모드로 바뀝니다. 그 페이지에서는 원래 지도를 계속 사용하고, 새로고침하면 다시 시도합니다.
  - 경계 파일을 불러오지 못하면 자동 전환을 끄고 현재 지도를 유지합니다.
  - HA 버전이나 Frontend 빌드가 고정(pin)된 값과 다르면 아무것도 바꾸지 않고 원래 지도를 사용합니다.
  - 키 설정 파일이 없으면 확장을 설치하지 않고 원래 지도를 사용합니다.

## 0. 버전 확인 (pin)

1. 설정 → 정보 화면에서 Core가 `2026.10.1`이고 Frontend가 `20260930.3`인지 확인합니다.
2. 운영 HA가 내려주는 HTML에서 entrypoint 해시가 pin과 같은지 확인합니다.
   ```sh
   curl -s http://<운영 HA 주소>:8123/ | grep -oE '/frontend_latest/(core|app)\.[0-9a-f]+\.js' | sort -u
   # pin: /frontend_latest/core.ecb6c9be4886db2c.js, /frontend_latest/app.6234b2ff06eb162a.js
   ```
   값이 다르면 확장은 설치되지 않고 원래 지도가 유지됩니다. 이때는 [HA를 업데이트할 때](#ha를-업데이트할-때) 절차를 따릅니다.

## 1. API 키 준비와 제한

두 키는 브라우저에 그대로 노출되는 공개 키입니다. 따라서 반드시 웹 사이트 제한을 걸어야 합니다.

- NAVER Cloud Platform Maps: Application을 등록하고 Dynamic Map(Web)을 사용하도록 설정합니다. Web 서비스 URL에는 HA에 실제로 접속하는 origin만 등록합니다(예: `http://homeassistant.local:8123`, 외부 도메인). `NAVER_MAP_KEY_ID`에는 Client ID(ncpKeyId)를 넣습니다. Client Secret은 필요하지 않습니다.
- Google Maps Platform: Maps JavaScript API를 활성화하고 결제 계정을 연결합니다.
  - Application restriction은 웹사이트(HTTP 리퍼러)로 선택하고, 값에는 실제 HA origin(예: `https://ha.example.com/*`)을 입력합니다.
  - API restriction에서는 Maps JavaScript API만 허용합니다. 이 API가 빠지면 `ApiTargetBlockedMapError`가 발생하고 원래 지도로 돌아갑니다. 이 현상은 테스트용 HA에서 실제로 확인했습니다.
  - 예산 알림과 할당량 상한을 설정합니다.
- 서버용 키나 제한이 없는 키는 사용하지 않습니다. HA 토큰은 SDK에 전달되지 않습니다.

## 2-A. HACS로 설치

HACS는 이 저장소를 Dashboard(plugin) 유형으로 다룹니다. 아직 HACS 기본 저장소 목록에 등록하지 않았으므로 사용자 지정 저장소로 추가해야 합니다.

1. HACS → 오른쪽 위 메뉴 → Custom repositories를 엽니다. 저장소 주소 `https://github.com/dohun0310/ha-korea-map`을 입력하고 유형은 Dashboard로 선택합니다.
2. 목록에서 HA Korea Map을 찾아 다운로드합니다. HACS는 저장소 `dist/` 폴더에 있는 파일을 모두 `/config/www/community/ha-korea-map/`에 내려받습니다. 이 폴더는 `/hacsfiles/ha-korea-map/` 경로로 제공됩니다.
3. 대시보드 리소스를 저장소(storage) 모드로 관리하고 있다면 HACS가 `/hacsfiles/ha-korea-map/ha-korea-map.js?hacstag=...`를 JavaScript 모듈 리소스로 자동 등록합니다. YAML 모드라면 HACS가 리소스를 등록하지 못하므로 직접 등록해야 합니다.
4. [3. 키 설정 파일 생성](#3-키-설정-파일-생성)을 진행합니다.
5. [4. 로딩 방식 선택](#4-로딩-방식-선택)에 설명한 이유로, `frontend.extra_module_url`에도 같은 파일을 등록하는 방법을 권장합니다.

HACS로 업데이트하면 `/config/www/community/ha-korea-map/` 폴더 안에 있는 파일이 새 버전으로 바뀝니다. 키 설정 파일은 이 폴더 밖에 두기 때문에 업데이트 후에도 그대로 남습니다.

## 2-B. 파일을 직접 복사해서 설치

1. 저장소 `dist/` 폴더에 있는 파일을 모두 운영 HA의 `/config/www/ha-korea-map/`에 복사합니다. 진입 모듈은 `ha-korea-map.js`입니다.
   ```
   ha-korea-map.js  ha-map-extension.mjs  ha-map-router.mjs  ha-map-sdk.mjs
   ha-map-auto.mjs  ha-map-korea-boundary.geojson  ATTRIBUTION.md  SHA256SUMS
   ```
2. `sha256sum -c SHA256SUMS` 명령으로 파일이 손상되지 않았는지 확인합니다. 이 명령은 복사한 폴더 안에서 실행합니다.
3. `/config/www` 폴더를 이번에 처음 만들었다면 HA를 재시작해야 `/local/` 경로가 열립니다.

## 3. 키 설정 파일 생성

키는 이 설정 파일에만 들어갑니다. 먼저 권한이 0600인 키 파일을 만듭니다. 이 파일은 다른 사람과 공유하지 않습니다.

```
NAVER_MAP_KEY_ID=...
GOOGLE_MAPS_API_KEY=...
```

그다음 저장소 루트에 있는 생성기를 실행합니다. 출력 위치는 설치 방법과 관계없이 `/config/www/ha-korea-map-config.mjs`입니다.

```sh
python3 generate-provider-config.py --provider auto --opt-in \
  --keys /안전한/경로/provider-keys.env \
  --output /config/www/ha-korea-map-config.mjs
```

- `--provider auto`를 사용하려면 두 키가 모두 필요합니다. `--opt-in`은 위치가 제공자에게 전송되고 요금이 발생할 수 있다는 점에 동의한다는 뜻입니다.
- 한 제공자만 사용하려면 `--provider naver` 또는 `--provider google`을 지정합니다. 확장을 끄려면 `--provider native`를 지정합니다.
- 경계 파일은 진입 모듈과 같은 폴더에 있는 사본을 사용합니다. 따라서 `--boundary-url`은 지정하지 않아도 됩니다.
- NAVER Style Editor에서 발행한 스타일을 사용하려면 `--naver-style-light <ID>`와 `--naver-style-dark <ID>`를 추가합니다. 이 옵션은 선택 사항입니다.
- 진입 모듈은 이 파일을 `/local/ha-korea-map-config.mjs` 경로로 읽습니다. 패키지 폴더 밖에 두는 이유는 HACS 업데이트가 이 파일을 덮어쓰지 않게 하기 위해서입니다.
- `/local/` 경로에 있는 파일은 로그인하지 않아도 내려받을 수 있습니다. 그래서 이 파일에 들어가는 키는 반드시 1단계에서 설명한 웹 사이트 제한을 걸어 둔 공개 키여야 합니다. 이 파일은 Git이나 공유 백업에도 넣지 않습니다.

## 4. 로딩 방식 선택

HA 프런트엔드에 모듈을 불러오는 방법은 두 가지가 있으며, 두 방법은 모듈을 불러오는 시점이 다릅니다. 아래 내용은 Frontend 20260930.3 소스 코드를 읽고 확인했습니다.

- `frontend.extra_module_url`: HA가 내려주는 HTML 안의 인라인 스크립트가 페이지를 처음 열 때 `import()`로 모듈을 불러옵니다(`src/html/index.html.template`).
- 대시보드 리소스(HACS가 자동으로 등록하는 방식): Lovelace 패널이 처음 열릴 때 대시보드 설정을 가져오는 작업과 동시에 리소스를 불러오기 시작하며, 리소스가 다 로드되기를 기다리지 않습니다(`src/panels/lovelace/ha-panel-lovelace.ts`).

확장은 `ha-map` 요소가 정의되고 HA 버전 정보가 준비되면 지도 엔진 생성 함수를 감쌉니다. HA는 지도 타일 토큰을 받은 다음에 엔진을 만들기 때문에, 보통은 확장이 먼저 설치됩니다. 하지만 모듈을 늦게 불러오면 첫 지도는 HA 원래 지도로 만들어질 수 있습니다. 이 경우에는 다른 화면으로 이동했다가 `/map`으로 돌아오면 확장이 적용됩니다. 대시보드 리소스 방식은 `extra_module_url` 방식보다 늦게 불러오기 시작하므로 이런 상황이 생길 가능성이 더 높다고 판단합니다. 다만 실제 발생 빈도는 측정하지 않았습니다.

따라서 다음과 같이 `extra_module_url`에 등록하는 방법을 권장합니다.

```yaml
frontend:
  extra_module_url:
    # HACS로 설치한 경우
    - /hacsfiles/ha-korea-map/ha-korea-map.js?v=auto-4
    # 직접 복사한 경우
    # - /local/ha-korea-map/ha-korea-map.js?v=auto-4
```

`extra_module_url`은 HA를 재시작해야 반영됩니다. HACS가 등록한 대시보드 리소스를 그대로 두어도 문제는 없습니다. 같은 모듈이 두 번 실행되더라도 진입 모듈이 이미 시작된 설치 작업을 다시 사용하므로, 엔진 생성 함수를 두 번 감싸지 않습니다.

## 5. 지도 카드 설정

지도 카드에는 따로 추가할 설정이 없습니다. 이전 버전에서 요구했던 `cluster: false`도 이제 필요하지 않습니다.

## 6. 새로고침과 확인

- 브라우저에서 캐시를 무시하고 새로고침합니다(Ctrl+Shift+R, Cmd+Shift+R). 모바일 Companion 앱은 설정 → Companion app → 디버깅에서 프런트엔드 캐시를 초기화한 다음 다시 엽니다.
- 개발자 콘솔에서 다음 내용을 확인합니다.
  ```js
  await haMapExtensionReady      // installed가 true여야 합니다
  haMapExtension.diagnostics()   // routers[0]: provider, safeMode, auto, decision, clustering, clusterRendering
  ```

## 다크 모드

HA는 지도 카드의 `theme_mode`(auto, light, dark)와 HA 테마의 다크 모드 설정을 바탕으로 지도 스타일을 정하고, 그 결과를 엔진의 `setMapStyle`로 전달합니다. 확장은 이 스타일의 팔레트 이름이 `-dark`로 끝나면 다크 모드로 판단합니다.

- Google 지도: 공식 옵션인 `colorScheme`을 `DARK` 또는 `LIGHT`로 지정합니다. Map ID나 콘솔 설정은 필요하지 않습니다. Google 문서에 따르면 이 옵션은 지도를 만들 때만 지정할 수 있으므로, 테마가 바뀌면 확장이 Google 지도를 새로 만듭니다. 새로 만들 때마다 지도 로드가 한 번 더 발생하므로 요금에 반영될 수 있습니다.
- NAVER 지도: NAVER Maps JavaScript API v3 문서에서는 Style Editor로 발행한 스타일 ID(`customStyleId`, GL 서브 모듈 필요) 외에 다크 모드 옵션을 찾지 못했습니다. 그래서 기본 동작으로는 타일 층에만 HA가 자체 래스터 지도에 쓰는 것과 같은 CSS 필터(`invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2) saturate(0.3)`)를 적용합니다.
  - 이 필터는 NAVER가 제공하는 공식 스타일이 아닙니다.
  - 마커, 원, 경로가 들어 있는 오버레이 층과 로고, 축척, 저작권 표시에는 필터를 적용하지 않습니다.
  - NAVER 약관이 지도 타일의 색 변형을 허용하는지는 확인하지 못했습니다.
  - Style Editor 스타일 ID를 설정하면 필터 대신 공식 스타일을 사용합니다. 이 경우에도 테마가 바뀌면 지도를 새로 만듭니다. 이 경로는 실제 키와 스타일 ID로 검증하지 않았습니다.

## 파일 업데이트

모듈을 바꿀 때는 `ha-korea-map.js`와 `ha-map-extension.mjs` 안에 있는 import 쿼리(`?v=auto-4`)를 함께 올립니다. 그러면 `extra_module_url`을 바꾸지 않아도 되고, HA를 재시작하지 않고 캐시를 무시한 새로고침만으로 새 모듈이 반영됩니다. 쿼리를 올리지 않으면 이전 모듈이 브라우저 캐시에 남을 수 있습니다.

## 릴리스 규칙

HACS는 GitHub 릴리스가 있으면 가장 최근 릴리스의 태그 이름을 버전으로 사용하고, 릴리스가 없으면 마지막 커밋 해시 앞 7자리를 사용합니다. 태그만 만들어서는 안 되고 릴리스를 발행해야 합니다. 이 저장소는 다음 규칙을 따릅니다.

- 태그 이름은 `vMAJOR.MINOR.PATCH` 형식을 사용합니다(예: `v0.4.0`).
- 릴리스에 `ha-korea-map.js`를 첨부 파일(asset)로 올리지 않습니다. HACS는 이 이름의 첨부 파일이 있으면 그 파일 하나만 내려받기 때문에, 함께 필요한 모듈과 경계 파일이 빠집니다.
- 릴리스를 만들기 전에 import 쿼리(`?v=`)를 올리고 `tools/build_dist.py`로 `dist/`를 다시 만듭니다.

## 롤백

| 방법 | 재시작 | 효과 |
|---|---|---|
| `generate-provider-config.py --provider native --output /config/www/ha-korea-map-config.mjs` 실행 후 캐시를 무시하고 새로고침 | 필요 없음 | SDK를 요청하지 않고 원래 지도를 사용합니다 |
| 콘솔에서 `haMapExtension.uninstall()` 실행 | 필요 없음 | 현재 탭에서만 원래 엔진 생성 함수를 복원합니다. 새로고침하면 다시 설치됩니다 |
| `extra_module_url` 항목과 HACS 리소스를 삭제하고 재시작한 뒤 패키지 폴더와 키 설정 파일 삭제 | 필요 | 확장을 완전히 제거합니다 |

## HA를 업데이트할 때

HA를 업데이트하면 Core·Frontend 버전이나 entrypoint 해시가 바뀝니다. 확장은 이 변화를 감지하면 설치되지 않고 원래 지도를 그대로 둡니다. 이때 지도는 정상적으로 보이지만 NAVER와 Google 지도는 나타나지 않습니다. hacs.json에 적은 최소 버전(`homeassistant`)은 설치 가능 여부만 판단하며, 확장이 동작하는 버전은 이 pin 값으로 정해집니다. 다시 사용하려면 다음 순서를 따릅니다.

1. 격리된 테스트용 HA를 새 버전으로 올리고, `ha-map.ts`에 있는 `_createEngine`과 MapEngine 계약이 바뀌었는지 확인합니다. 이 부분은 공개 API가 아니므로 버전마다 바뀔 수 있습니다.
2. 테스트용 컨테이너에 있는 Frontend manifest와 `/map/0` HTML에서 새 entrypoint(`core.*.js`, `app.*.js`)를 확인합니다.
3. 다음 위치에 있는 버전 값을 갱신합니다.
   - `generate-provider-config.py`의 `PIN`(coreVersion, frontendVersion, entrypoints)
   - `ha-map-extension.mjs`의 `installHook`과 `startAutoHook` 안에 직접 적은 `'2026.10.1'`과 `'20260930.3'`
4. Node·Python 테스트와 테스트용 HA 브라우저 검증을 통과시킵니다.
5. import 쿼리(`?v=`)를 올리고 `tools/build_dist.py`로 `dist/`를 다시 만든 다음, 키 설정 파일을 다시 생성합니다.

검증하지 않은 상태에서 버전 값만 바꾸는 방법은 권장하지 않습니다.

## 경계 데이터 출처와 라이선스

`ha-map-korea-boundary.geojson`은 공개 데이터를 가공해 만든 근사치이며, 법적 경계가 아닙니다. 이 파일을 웹으로 제공하게 되므로 `ATTRIBUTION.md`를 함께 두고 다음 출처를 표기합니다.

- geoBoundaries gbOpen (commit 9469f09): KOR과 CHN 데이터는 Public Domain입니다.
- PRK 데이터: World Food Programme, OCHA ROAP, CC BY 3.0 IGO. 출처 표기와 변경 사실 고지가 의무입니다.
- JPN 데이터: 일본 국토교통성 国土数値情報, CC BY 4.0. 출처 표기와 변경 사실 고지가 의무입니다.
- Natural Earth v5.1.2 disputed areas (Public Domain): 독도와 NLL 이남 도서를 포함하는 데 사용했습니다.
- 변경 내용: bbox 자르기, 단순화, 12해리 버퍼, 근사 등거리선 적용, 외국 육지 제거.

## 약관과 요금 (해결하지 못한 사항)

- Google Maps Platform 약관 3.2.3(e)는 Google 지도가 아닌 지도와 함께 또는 가까이에서 Google Maps 핵심 서비스를 사용하는 것을 금지하는 취지입니다. 같은 화면에서 NAVER와 Google 지도를 전환하는 이 구성에 이 조항이 적용되는지는 확인하지 못했습니다. 법률 검토나 Google의 확인 없이 이 구성이 약관에 맞는다고 판단할 수 없으며, 가정에서 개인적으로 사용하더라도 약관 위반 위험이 있습니다.
- NAVER Maps 이용약관이 다른 지도와 함께 사용하는 경우나 타일 색 변형을 어떻게 다루는지도 별도로 확인해야 합니다.
- 요금: Google Maps JavaScript API는 지도를 불러올 때마다 요금이 발생할 수 있습니다. 자동 전환이나 테마 변경으로 지도를 새로 만들 때마다 사용량이 늘어날 수 있습니다. 무료 사용량이나 비용 상한을 보장하지 않으므로 예산 알림을 설정해야 합니다. NAVER Cloud Maps에도 사용량에 따른 요금이 적용될 수 있습니다.
- SDK를 사용하면 지도 중심과 오버레이 좌표가 각 제공자 서버로 전송됩니다.

## 알려진 한계

- 경계는 근사치입니다. 대한해협, 서해 NLL, 한강 하구 근처에서는 수 km 오차가 생길 수 있습니다.
- 판정은 지도 중심점을 기준으로 합니다. 경계 근처에서 지도를 끌면 전환이 일어날 수 있으며, 디바운스와 최소 간격으로 이 현상을 줄였습니다.
- NAVER SDK는 지도 범위를 한국 주변(대략 위도 32.1~38.6, 경도 124.3~132.0)과 최소 줌 6으로 제한합니다. 그래서 NAVER 지도에서 손으로 끌어서 해외로 이동할 수는 없습니다. HA 자동 맞춤이나 `setView`, `panTo`, `fitBounds`처럼 목적지가 정해진 이동은 목적지를 기준으로 판정해 Google 지도로 전환합니다. 해외를 직접 둘러보려면 콘솔에서 `haMapExtension.select('google')`을 실행합니다.
- 현재 버전은 제공자 지도에 그룹 아이콘을 그리지 않고 마커를 하나씩 표시합니다.
- NAVER 다크 모드는 공식 스타일이 아니라 타일에 적용하는 CSS 필터입니다.
- 모듈을 늦게 불러오면 첫 지도가 HA 원래 지도로 만들어질 수 있습니다. 이 경우 다른 화면에 갔다가 돌아오면 확장이 적용됩니다.
