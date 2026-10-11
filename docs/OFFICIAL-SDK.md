# 공식 SDK 어댑터와 테스트용 HA 검증

이 문서는 NAVER Maps JavaScript API v3와 Google Maps JavaScript API를 HA 지도 엔진으로 연결하는 방식과, 격리된 테스트용 HA에서 검증한 범위를 설명합니다.

## 구성

- `ha-map-extension.mjs`: `ha-map` 요소의 비공개 메서드인 `_createEngine`을 감쌉니다. `/map` 대시보드에 있는 지도 카드에서만 라우터를 반환하고, 다른 화면에서는 HA 원래 엔진을 그대로 반환합니다.
- `ha-map-router.mjs`: HA가 보기에는 하나의 MapEngine처럼 동작합니다. 마커, 원, 경로를 기록해 두었다가 엔진을 바꿀 때 새 엔진에 다시 그립니다.
- `ha-map-sdk.mjs`: 실제 `naver.maps.Map`, `google.maps.Map`과 각 SDK의 `OverlayView`, `Circle`, `Polyline`을 만드는 어댑터입니다.
- `ha-map-auto.mjs`: 지도 중심이 대한민국 경계 안에 있는지 판정해 NAVER 지도와 Google 지도를 자동으로 고릅니다.
- `ha-korea-map.js`: 운영 환경에서 사용하는 진입 모듈입니다. 키 설정 파일을 읽고 확장을 설치합니다.

Node 단위 테스트에서는 SDK를 흉내 내는 가짜 객체(fake)를 사용합니다. 이 테스트가 통과했다고 해서 실제 SDK 인증이나 지도 표시가 증명되지는 않습니다.

## 테스트용 HA

- 컨테이너 이름은 `ha-map-lab`이고, 버전은 Core 2026.10.1, Frontend 20260930.3입니다. LAN 주소는 `<HA 호스트>:18123`입니다.
- `/map/0` 기본 지도 대시보드에서만 확장이 동작합니다. 다른 대시보드와 편집 화면, `_forceLeaflet`이나 `rasterOnly` 상태, 알 수 없는 빌드에서는 원래 엔진을 그대로 사용합니다.
- `configuration.yaml`에 등록된 `extra_module_url: /local/ha-map-lab-bootstrap.mjs?v=dashboard-2`를 사용합니다. 모듈을 바꿀 때는 bootstrap 안에 있는 import 쿼리만 올리면 되므로 컨테이너를 재시작하지 않아도 됩니다.
- 이 환경은 개인 위치 대신 합성 좌표를 사용하는 실험 환경입니다. 운영 환경의 라이선스 승인이나 여러 지도 제공자를 함께 쓰는 구성이 약관에 맞는지는 보장하지 않습니다.

## 키 준비와 설정 생성

키를 채팅이나 로그에 붙여 넣지 않습니다. 저장소 루트에 있는 비공개 파일 `provider-keys.env`에 직접 입력합니다. NAVER Client Secret은 필요하지 않으므로 이 파일에 넣지 않습니다.

```sh
cd <저장소 루트>
test -e provider-keys.env || install -m 600 provider-keys.env.example provider-keys.env
chmod 600 provider-keys.env
# 편집기로 사용할 제공자의 공개 브라우저 키를 입력합니다.
# NAVER_MAP_KEY_ID=
# GOOGLE_MAPS_API_KEY=
python3 generate-provider-config.py --provider auto --opt-in \
  --boundary-url /local/ha-map-korea-boundary.geojson
```

- 생성기는 `provider-keys.env`를 셸에서 실행하지 않고, 위의 두 필드만 읽어 형식을 검사합니다. 다른 변수는 브라우저로 보내지 않습니다.
- 테스트용 HA에서는 모듈과 경계 파일이 `/local/` 바로 아래에 있으므로 `--boundary-url`을 지정합니다. 운영 환경의 진입 모듈은 같은 폴더에 있는 경계 파일을 사용합니다.
- 생성된 `config/www/ha-map-lab-config.mjs`에는 브라우저에 공개되는 키만 들어갑니다. HA 토큰이나 서버용 비밀 값은 넣지 않습니다. 생성기는 키 파일의 소유자를 확인하고 권한을 0600으로 바꾸며, 출력 파일은 원자적으로 교체합니다.
- NAVER는 NCP Maps Application에서 Dynamic Map을 사용하도록 설정하고 Web 서비스 URL을 등록해야 합니다. SDK는 `ncpKeyId` 파라미터로 불러오며, 이전 방식인 `ncpClientId`는 사용하지 않습니다. NCP 콘솔 가이드는 조회 시 HTTP 403이 반환되어, 포트와 도메인을 어떻게 비교하는지는 확인하지 못했습니다.
- Google은 Maps JavaScript API를 활성화하고 결제를 설정한 다음, 웹사이트(HTTP 리퍼러) 제한과 API 제한을 적용합니다. 테스트용 HA에서는 `http://<HA 호스트>:18123/*`을 리퍼러로 등록합니다.
- 요금은 각 제공자의 요금표와 실제 사용량에 따라 결정됩니다. 지도를 새로 만들 때마다 지도 로드가 발생하므로, 자동 전환과 테마 변경은 사용량을 늘릴 수 있습니다.

## 그룹화(클러스터링)

지도 카드는 `cluster` 설정을 읽으며 기본값은 true입니다(Frontend 20260930.3 `hui-map-card.ts`: `this._config.cluster ?? true`). 라우터는 HA가 넘기는 `setClustering` 값을 저장해 현재 엔진에 전달하고, 엔진을 바꿀 때 같은 값을 다시 적용합니다. 그룹화 버튼을 눌러도 안전 모드로 바뀌지 않고 제공자 지도를 유지합니다. 현재 SDK 엔진은 그룹 아이콘을 그리지 않고 마커를 하나씩 표시합니다. 상태는 `haMapExtension.diagnostics().routers[0]`에 있는 `clustering`과 `clusterRendering` 값으로 확인합니다.

## 지도 스타일(다크 모드)

HA는 지도 카드의 `theme_mode`와 HA 테마의 다크 모드 설정으로 스타일을 정하고, 엔진의 `setMapStyle`로 결과를 전달합니다(`ha-map.ts`의 `_darkMode`, `_updateMapAppearance`). 전달되는 값은 팔레트 이름을 담고 있으며, 다크 모드일 때는 이름이 `-dark`로 끝납니다(`map-styles.ts`의 `paletteFor`). 확장은 이 규칙으로 다크 모드를 판단합니다.

- Google: 지도를 만들 때 `colorScheme`을 `DARK` 또는 `LIGHT`로 지정합니다. Google 문서는 이 옵션을 지도를 만들 때만 지정할 수 있다고 설명합니다. 그래서 테마가 바뀌면 엔진이 라우터에 지도를 다시 만들어 달라고 요청하고, 라우터는 같은 제공자의 새 엔진을 만들어 오버레이를 다시 그린 다음 이전 엔진을 제거합니다. Map ID가 필요하지 않습니다. JSON `styles` 배열도 Map ID 없이 실행 중에 바꿀 수 있지만, Google이 제공하는 다크 디자인이 아니라 직접 색을 정의해야 하므로 사용하지 않았습니다.
- NAVER: 공식 문서에서 찾은 스타일 지정 방법은 Style Editor에서 발행한 스타일 ID를 `customStyleId`로 지정하는 방법뿐이며, 이 방법은 GL 서브 모듈(`submodules=gl`)과 콘솔 작업이 필요합니다. 그래서 기본 동작으로는 HA가 자체 래스터 지도에 사용하는 필터(`invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2) saturate(0.3)`)를 타일 층에만 적용합니다.
  - 타일 층은 NAVER가 문서로 공개한 오버레이 pane(`getPanes()`)과 같은 부모 아래에 있는 형제 요소로 찾습니다. 링크나 글자를 포함한 요소는 제외합니다. 이 DOM 구조는 NAVER가 문서로 보장하는 내용이 아니므로, 실제 화면에서 로고와 저작권 표시가 변형되지 않았는지 확인해야 합니다.
  - 마커, 원, 경로가 있는 pane과 로고, 축척, 저작권 표시에는 필터를 적용하지 않습니다.
  - 이 필터는 공식 스타일이 아닙니다. NAVER 약관이 타일의 색 변형을 허용하는지는 확인하지 못했습니다.
  - `generate-provider-config.py`에 `--naver-style-light`, `--naver-style-dark`를 지정하면 필터 대신 공식 스타일을 사용합니다. 이 경로는 실제 키와 스타일 ID로 검증하지 않았습니다.

## 실제 화면 검증 기록

2026-10-11에 테스트용 HA에서 확인한 내용은 다음과 같습니다.

- NAVER: `/map/0`에서 지도가 표시되고, 안전 모드로 복구한 뒤 다시 NAVER 지도로 돌아오는 동작을 확인했습니다.
- Google: 당시 키의 API 제한에 Maps JavaScript API가 빠져 있어 `ApiTargetBlockedMapError`로 인증에 실패했고, 확장은 HA 원래 지도로 자동 복구했습니다.

그룹화 유지, 다크 모드, HACS 경로는 이 기록 이후에 추가했으므로 브라우저 검증이 아직 필요합니다.

## 브라우저 검증 방법

로그인된 브라우저에서 HA 인증 정보나 저장소를 읽지 않고, 다음 결과만 확인합니다.

```js
await window.haMapExtensionReady;
window.haMapExtension.diagnostics();
// routers[0].provider가 naver 또는 google이고, pending은 0, safeMode는 false여야 합니다.
// diagnostics에는 키, 좌표, 토큰이 들어 있지 않습니다.
await window.haMapExtension.recover(); // HA 원래 지도로 돌아가고 안전 모드로 바뀝니다.
await window.haMapExtension.resume("naver"); // 키와 opt-in이 설정된 제공자만 다시 켤 수 있습니다.
```

지도 위에는 선택 UI가 없으므로 수동 제어는 개발자 콘솔에서만 합니다. 제공자 지도의 확대·축소 버튼도 숨깁니다. 실제 화면에서는 다음 항목을 직접 확인해야 합니다.

- 지리 정보가 담긴 타일이 표시되는지 확인합니다.
- 마커를 누르면 more-info 창이 열리는지 확인합니다.
- 마커의 기준점과 위치, 미터 단위 정확도 원과 구역 원, 경로 선분과 점 제목이 맞게 표시되는지 확인합니다.
- 이동, 확대, 전체 보기가 동작하는지 확인합니다.
- 다른 대시보드와 구역 편집기에서 원래 지도를 사용하는지 확인합니다.
- 화면을 벗어날 때 DOM이 정리되는지 확인합니다.

SDK의 `tilesloaded` 이벤트가 발생했다는 사실만으로 인증이나 지도 내용이 올바르다고 판단하지 않습니다.

## 실패 처리

- SDK를 불러오는 시간이 초과되거나, 인증에 실패하거나, 첫 타일이 표시되지 않으면 안전 모드로 바꾸고 HA 원래 지도를 사용합니다.
- 기존 원래 지도가 정상이면 다시 만들지 않고 그대로 사용합니다. SDK 지도로 바뀐 뒤에 실패하면 원래 생성 함수로 새 지도를 만들고 오버레이를 다시 그립니다.
- 원래 지도를 만드는 작업마저 실패하면 `native-recovery-failed`로 표시하고, 성공한 것처럼 꾸미지 않습니다.
- 스크립트를 불러오지 못했거나 키가 바뀌었다면 페이지를 새로고침해야 다시 시도합니다. 로더는 한 문서에서 하나의 키만 사용합니다.

## 라우터와 SDK 세부 동작

- HA가 사용하는 `[위도, 경도]` 좌표를 각 SDK의 LatLng로 바꿉니다. 중심, 줌, 화면 범위, 크기 변경, 포함 여부 확인을 지원합니다.
- HA가 넘긴 마커 DOM을 그대로 SDK OverlayView 안으로 옮기므로 HA가 등록한 이벤트 리스너가 유지됩니다. 감싸는 요소에는 기준점, 크기, 접근성 속성, 포인터 설정을 적용합니다. NAVER는 `overlayImage` pane을, Google은 `overlayMouseTarget` pane을 사용합니다.
- 원의 반지름 단위는 미터입니다. GPS 정확도 원은 마커와 함께 만들어지고 함께 사라집니다. 경로는 HA가 나눈 선분과 점을 그대로 그립니다.
- 경로 점의 툴팁 HTML은 `<template>` 요소로 해석한 다음 글자만 꺼내 브라우저 기본 툴팁(title)으로 표시합니다. `<template>` 안에서는 이미지가 로드되지 않고 이벤트 핸들러도 실행되지 않습니다. HA의 원래 팝업 모양은 재현하지 않습니다.
- 원과 경로 핸들의 update와 remove는 엔진을 바꾸는 도중에도 최신 값을 유지합니다. 늦게 끝난 로더나 초기화 결과는 세대(generation) 번호로 무시하고 해당 엔진을 제거합니다. 새 엔진은 준비가 끝나기 전까지 숨겨 두므로 정상 동작 중인 지도를 가리지 않습니다.
- HA 타일 토큰은 원래 엔진에만 전달합니다. SDK 엔진에는 중심, 줌, 컨트롤 위치, 지도 스타일, 이벤트만 전달합니다. SDK를 사용하면 지도 중심, 화면 범위, 타일 요청, 브라우저 네트워크 정보가 제공자에게 전달되고, 마커·원·경로 좌표가 SDK 안으로 들어갑니다. HA 인증 토큰이나 hass 객체 전체는 보내지 않습니다. SDK 내부의 원격 측정까지 전송되지 않는다고 보장하지는 않습니다.
- 편집과 드래그 API는 구현하지 않았으며, 편집 화면에서는 확장이 동작하지 않습니다.

## 롤백

```sh
cd <저장소 루트>
python3 generate-provider-config.py --provider native
# /map/0을 캐시를 무시하고 새로고침합니다.
```

즉시 원래 지도로 돌아가려면 `await window.haMapExtension.recover()`를 실행합니다. 훅을 완전히 제거하려면 `window.haMapExtension.uninstall()`을 실행한 다음 새로고침합니다. 다른 확장이 그 사이에 `_createEngine`을 바꿨다면 uninstall은 그 변경을 덮어쓰지 않습니다. 영구적으로 제거하려면 테스트용 HA의 `configuration.yaml`에서 `extra_module_url` 항목만 삭제하고, 승인을 받은 다음 이 컨테이너만 재시작합니다.

## 재현 가능한 검증

```sh
node --test --test-timeout=8000 test/*.test.mjs
python3 -m unittest discover -s test -p '*_test.py' -v
```

Node 테스트는 가짜 SDK로 실행하므로 인증, 요금, 실제 SDK 화면을 증명하지 않습니다. 로그인한 브라우저에서 실제 지도를 확인하는 검증은 별도 단계입니다.

## 근거 문서

요금 수치는 바뀔 수 있으므로 이 문서에 고정하지 않습니다.

- HA MapEngine 계약: https://github.com/home-assistant/frontend/blob/20260930.3/src/common/map/map-engine.ts
- HA 지도 스타일: https://github.com/home-assistant/frontend/blob/20260930.3/src/common/map/map-styles.ts
- HA 지도 요소: https://github.com/home-assistant/frontend/blob/20260930.3/src/components/map/ha-map.ts
- NAVER SDK 로드와 인증: https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html
- NAVER Application과 Dynamic Map: https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html
- NAVER OverlayView: https://navermaps.github.io/maps.js.ncp/docs/naver.maps.OverlayView.html
- NAVER Map(pane, 이벤트, `gl`, `customStyleId`): https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html
- NAVER Style Editor 연동: https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Style-Editor.html
- NAVER 서브 모듈: https://navermaps.github.io/maps.js.ncp/docs/tutorial-4-Submodules.html
- NAVER Maps 상품과 요금: https://www.ncloud.com/product/applicationService/maps
- Google SDK 로드: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
- Google 지도 색 구성(colorScheme): https://developers.google.com/maps/documentation/javascript/mapcolorscheme
- Google Map 옵션(`colorScheme`, `styles`): https://developers.google.com/maps/documentation/javascript/reference/map
- Google OverlayView: https://developers.google.com/maps/documentation/javascript/customoverlays
- Google 키 제한: https://developers.google.com/maps/api-security-best-practices
- Google 사용량과 요금: https://developers.google.com/maps/documentation/javascript/usage-and-billing
- Google 표시 의무와 정책: https://developers.google.com/maps/documentation/javascript/policies
- Google 서비스별 약관: https://cloud.google.com/maps-platform/terms/maps-service-terms

이 문서는 법률 자문이나 운영 허가에 대한 결론이 아닙니다. 공식 문서에 있는 승인, 표시, 요금 요구 사항과 여러 지도 제공자를 함께 쓰는 구성의 적용 조건은 실제 배포 전에 다시 확인해야 합니다.
